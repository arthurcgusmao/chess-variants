"""Browser test. The sandbox can't reach the PeerJS broker, so the two pages talk through
a stand-in Peer built on BroadcastChannel; everything above the transport is the real code."""
import subprocess, sys, time, pathlib
from playwright.sync_api import sync_playwright

ROOT = pathlib.Path(__file__).parent.parent
SHOTS = pathlib.Path(__file__).parent / 'shots'; SHOTS.mkdir(exist_ok=True)
FAKE = r"""
(() => {
  const ch = new BroadcastChannel('fakepeer');
  const peers = [];
  class Em { constructor(){ this.h = {}; } on(e, f){ (this.h[e] = this.h[e] || []).push(f); return this; }
    emit(e, ...a){ (this.h[e] || []).forEach((f) => f(...a)); } }
  class Conn extends Em { constructor(peer, cid){ super(); this.peer = peer; this.cid = cid; this.open = false; }
    send(d){ ch.postMessage({ type: 'data', cid: this.cid, from: this.peer.id, payload: JSON.parse(JSON.stringify(d)) }); }
    close(){ if (!this.open) return; this.open = false; ch.postMessage({ type: 'close', cid: this.cid, from: this.peer.id }); this.emit('close'); } }
  class Peer extends Em {
    constructor(id){ super(); this.id = id || 'anon-' + Math.random().toString(36).slice(2); this.destroyed = false; this.conns = {};
      peers.push(this); setTimeout(() => this.emit('open', this.id), 20); }
    connect(to){ const cid = Math.random().toString(36).slice(2); const c = new Conn(this, cid); this.conns[cid] = c;
      ch.postMessage({ type: 'connect', to, from: this.id, cid });
      setTimeout(() => { if (!c.open && !this.destroyed) this.emit('error', { type: 'peer-unavailable' }); }, 300); return c; }
    reconnect(){} destroy(){ this.destroyed = true; Object.values(this.conns).forEach((c) => c.close()); }
    _msg(m){ if (this.destroyed || m.from === this.id) return;
      if (m.type === 'connect' && m.to === this.id) { const c = new Conn(this, m.cid); this.conns[m.cid] = c; this.emit('connection', c);
        c.open = true; ch.postMessage({ type: 'accept', cid: m.cid, from: this.id }); c.emit('open'); }
      const c = this.conns[m.cid]; if (!c) return;
      if (m.type === 'accept') { c.open = true; c.emit('open'); }
      if (m.type === 'data' && c.open) c.emit('data', m.payload);
      if (m.type === 'close' && c.open) { c.open = false; c.emit('close'); } } }
  ch.onmessage = (e) => peers.forEach((p) => p._msg(e.data));
  addEventListener('pagehide', () => peers.forEach((p) => p.destroy()));
  window.__TestPeer = Peer;
})();
"""

def click_sq(page, i): page.click(f'#board [data-sq="{i}"]')
def move(page, a, b): click_sq(page, a); click_sq(page, b)
def wait_text(page, sel, text): page.wait_for_function("([s,t]) => document.querySelector(s).textContent.includes(t)", arg=[sel, text], timeout=8000)
def nmoves(page): return page.evaluate("window.__G.moves.length")

srv = subprocess.Popen([sys.executable, '-m', 'http.server', '8765', '--bind', '127.0.0.1'], cwd=ROOT, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
time.sleep(0.8)
URL = 'http://127.0.0.1:8765/los-alamos/'
errors = []
try:
    with sync_playwright() as pw:
        br = pw.chromium.launch(channel='chrome', headless=True)
        # --- real PeerJS bundle loads and exposes Peer; local mode works ---
        ctx0 = br.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2)
        p = ctx0.new_page(); p.on('pageerror', lambda e: errors.append(str(e)))
        p.goto(URL)
        assert p.evaluate("typeof window.Peer") == 'function'
        p.click('#local'); wait_text(p, '#status', 'White to move')
        assert p.locator('#board .sq').count() == 36
        click_sq(p, 1); assert p.locator('#board .target').count() == 2      # knight b1: a3, c3
        click_sq(p, 14); wait_text(p, '#status', 'Black to move')
        p.screenshot(path=str(SHOTS / 'shot_local.png'))
        ctx0.close()

        # --- online flow over the stand-in transport ---
        ctx = br.new_context(viewport={'width': 390, 'height': 780}, device_scale_factor=2)
        ctx.add_init_script(FAKE)
        host = ctx.new_page(); host.on('pageerror', lambda e: errors.append('host ' + str(e)))
        host.goto(URL); host.click('#create'); wait_text(host, '#link', 'Waiting for opponent'); wait_text(host, '#status', 'Waiting for opponent to join')
        assert 'host=1' in host.url
        invite = host.input_value('#invite-url'); assert 'host' not in invite.split('?')[1].replace('room=', '')
        host.screenshot(path=str(SHOTS / 'shot_host_wait.png'))
        guest = ctx.new_page(); guest.on('pageerror', lambda e: errors.append('guest ' + str(e)))
        guest.goto(invite)
        wait_text(guest, '#link', 'Connected'); wait_text(host, '#link', 'Connected')
        wait_text(guest, '#variant', 'you are Black'); wait_text(guest, '#status', 'Opponent')
        assert host.locator('#invite').is_hidden()
        # guest (black) cannot move out of turn
        click_sq(guest, 24); assert guest.locator('#board .sel').count() == 0
        move(host, 6, 12); wait_text(guest, '#status', 'Your move'); assert nmoves(guest) == 1
        # flipped board for black: first rendered square is a1 side reversed -> top-left is f1? (rank 1 at top, file f at left)
        assert guest.evaluate("document.querySelector('#board .sq').dataset.sq") == '5'
        move(guest, 24, 18); wait_text(host, '#status', 'Your move'); assert nmoves(host) == 2
        guest.screenshot(path=str(SHOTS / 'shot_guest.png'))
        # guest reloads -> resyncs from host
        guest.reload(); wait_text(guest, '#link', 'Connected'); wait_text(guest, '#status', 'Opponent'); assert nmoves(guest) == 2
        # host reloads -> restores from its storage, guest redials
        host.reload(); wait_text(host, '#link', 'Connected'); wait_text(guest, '#link', 'Connected')
        assert nmoves(host) == 2; wait_text(host, '#status', 'Your move')
        host.screenshot(path=str(SHOTS / 'shot_host.png'))
        move(host, 1, 14); wait_text(guest, '#status', 'Your move'); assert nmoves(guest) == 3
        # an illegal move injected over the wire is rejected and state is unchanged
        guest.evaluate("window.__G.conn.send({t:'move', g: window.__G.gameNo, i: 3, m:{from:30,to:0}})")
        time.sleep(0.3); assert nmoves(host) == 3
        # resign + rematch swaps colours
        guest.click('#resign'); guest.click('#resign'); wait_text(host, '#status', 'Black resigned'); wait_text(guest, '#status', 'White wins')
        guest.click('#rematch'); wait_text(guest, '#variant', 'you are White'); wait_text(host, '#variant', 'you are Black')
        assert nmoves(host) == 0 and nmoves(guest) == 0
        move(guest, 7, 13); wait_text(host, '#status', 'Your move')
        # guest opening the room before the host is online keeps retrying, then connects
        ctx2 = br.new_context(); ctx2.add_init_script(FAKE)
        g2 = ctx2.new_page(); g2.goto(URL + '?room=nobodyhere'); wait_text(g2, '#link', 'Host is not online')
        ctx2.close(); ctx.close(); br.close()
finally:
    srv.terminate()
assert not errors, errors
print('ui tests passed')
