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
def nmoves(page): return page.evaluate("window.__game.moves.length")

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
        guest.evaluate("window.__game.net.send({t:'move', g: window.__game.gameNo, i: 3, m:{from:30,to:0}})")
        time.sleep(0.3); assert nmoves(host) == 3
        # resign + rematch swaps colours
        guest.click('#resign'); guest.click('#resign'); wait_text(host, '#status', 'Black resigned'); wait_text(guest, '#status', 'White wins')
        guest.click('#rematch'); wait_text(guest, '#variant', 'you are White'); wait_text(host, '#variant', 'you are Black')
        assert nmoves(host) == 0 and nmoves(guest) == 0
        move(guest, 7, 13); wait_text(host, '#status', 'Your move')
        # --- castling option: chosen by the creator, synced to the guest, survives reloads ---
        assert host.evaluate("window.__game.opts.castling") is False
        h2 = ctx.new_page(); h2.on('pageerror', lambda e: errors.append('h2 ' + str(e)))
        h2.goto(URL); h2.check('#opt-castling'); h2.click('#create'); wait_text(h2, '#link', 'Waiting for opponent')
        g3 = ctx.new_page(); g3.on('pageerror', lambda e: errors.append('g3 ' + str(e)))
        g3.goto(h2.input_value('#invite-url')); wait_text(g3, '#link', 'Connected'); wait_text(g3, '#variant', 'castling')
        move(h2, 4, 17); wait_text(g3, '#status', 'Your move')          # Ne1-f3
        move(g3, 24, 18); wait_text(h2, '#status', 'Your move')          # a5-a4
        click_sq(h2, 3); assert h2.locator('#board [data-sq="5"].capture').count() == 1
        h2.screenshot(path=str(SHOTS / 'shot_castle_target.png'))
        click_sq(h2, 5); wait_text(g3, '#status', 'Your move')           # O-O
        for pg in (h2, g3):
            assert pg.evaluate("[window.__game.state.board[5], window.__game.state.board[4], window.__game.state.board[3]].join()") == 'wK,wR,'
            wait_text(pg, '#moves', 'O-O')
        g3.reload(); wait_text(g3, '#link', 'Connected'); wait_text(g3, '#moves', 'O-O'); assert nmoves(g3) == 3
        h2.reload(); wait_text(h2, '#link', 'Connected'); wait_text(h2, '#variant', 'castling'); assert nmoves(h2) == 3
        h2.screenshot(path=str(SHOTS / 'shot_castled.png'))
        # a castle sent over the wire in a game without the option is rejected
        n0 = nmoves(host)
        guest.evaluate("window.__game.net.send({t:'move', g: window.__game.gameNo, i: window.__game.moves.length, m:{from:3,to:5}})")
        time.sleep(0.3); assert nmoves(host) == n0
        # lobby shows the option
        lob = ctx.new_page(); lob.goto(URL); lob.screenshot(path=str(SHOTS / 'shot_lobby.png')); lob.close()
        h2.close(); g3.close()
        # --- Random Swap page: classic 8x8 with the swap rule ---
        SWAP = URL.replace('/los-alamos/', '/random-swap/')
        board = "JSON.stringify(window.__game.state.board)"
        rs = ctx.new_page(); rs.on('pageerror', lambda e: errors.append('rs ' + str(e)))
        rs.goto(SWAP); assert rs.locator('#castle-field').is_hidden(); assert rs.locator('#variant-field').is_hidden()
        rs.screenshot(path=str(SHOTS / 'shot_swap_lobby.png'))
        rs.click('#create'); wait_text(rs, '#link', 'Waiting for opponent')
        assert rs.locator('#board .sq').count() == 64
        rg = ctx.new_page(); rg.on('pageerror', lambda e: errors.append('rg ' + str(e)))
        rg.goto(rs.input_value('#invite-url')); wait_text(rg, '#link', 'Connected'); wait_text(rg, '#variant', 'Random Swap')
        click_sq(rs, 12); assert rs.locator('#board .target').count() == 2      # e2: e3 and e4
        click_sq(rs, 28); wait_text(rg, '#status', 'Your move'); assert rs.locator('#note').is_hidden()
        move(rg, 52, 36); wait_text(rs, '#status', 'Your move')                  # e7-e5
        move(rs, 6, 21); wait_text(rg, '#status', 'Your move')                   # Ng1-f3, must swap
        m = rs.evaluate("window.__game.moves[2]"); assert m['swap'] in (0, 2, 3, 5, 7), m
        assert rs.evaluate("window.__game.state.board[21]") != 'wN' and rs.evaluate(f"window.__game.state.board[{m['swap']}]") == 'wN'
        assert rs.evaluate(board) == rg.evaluate(board)
        wait_text(rs, '#note', 'Swapped: f3 is now a'); wait_text(rg, '#note', 'Swapped: f3 is now a'); wait_text(rg, '#moves', '↔')
        assert rs.locator('#board .swap').count() == 2
        rs.screenshot(path=str(SHOTS / 'shot_swap.png'))
        # a swap partner the rules don't allow is rejected over the wire (black knight b8-c6 with a pawn)
        rg.evaluate("window.__game.net.send({t:'move', g: window.__game.gameNo, i: 3, m:{from:57,to:42,swap:48}})")
        time.sleep(0.3); assert nmoves(rs) == 3
        rg.evaluate("window.__game.net.send({t:'move', g: window.__game.gameNo, i: 3, m:{from:57,to:42}})")
        time.sleep(0.3); assert nmoves(rs) == 3
        wait_text(rg, '#status', 'Your move'); move(rg, 57, 42); wait_text(rs, '#status', 'Your move'); assert nmoves(rs) == 4
        assert rs.evaluate(board) == rg.evaluate(board)
        before = rs.evaluate(board)
        rg.reload(); wait_text(rg, '#link', 'Connected'); wait_text(rg, '#status', 'Opponent'); assert rg.evaluate(board) == before
        rs.reload(); wait_text(rs, '#link', 'Connected'); wait_text(rs, '#status', 'Your move'); assert rs.evaluate(board) == before
        rg.screenshot(path=str(SHOTS / 'shot_swap_black.png'))
        rs.close(); rg.close()
        # --- 8x7 page ---
        sh = ctx.new_page(); sh.on('pageerror', lambda e: errors.append('sh ' + str(e)))
        sh.goto(URL.replace('/los-alamos/', '/8x7/')); assert sh.locator('#castle-field').is_hidden()
        sh.click('#local'); wait_text(sh, '#status', 'White to move'); wait_text(sh, '#variant', '8×7')
        assert sh.locator('#board .sq').count() == 56 and sh.locator('#turn').is_hidden()
        click_sq(sh, 12); assert sh.locator('#board .target').count() == 2      # e2: e3, e4
        click_sq(sh, 28); wait_text(sh, '#status', 'Black to move')             # e2-e4
        click_sq(sh, 44); assert sh.locator('#board .target').count() == 1      # e6 can only reach e5 now
        click_sq(sh, 44); move(sh, 43, 27); wait_text(sh, '#status', 'White to move')   # d6-d4, beside e4
        click_sq(sh, 28); assert sh.locator('#board [data-sq="35"].target').count() == 1  # en passant on d5
        click_sq(sh, 35); wait_text(sh, '#moves', 'e4xd5'); assert sh.evaluate("window.__game.state.board[27]") == ''
        sh.screenshot(path=str(SHOTS / 'shot_8x7.png'))
        sh.close()
        # --- Cylinder page ---
        CYL = URL.replace('/los-alamos/', '/cylinder/')
        first = "document.querySelector('#board .sq').dataset.sq"
        cy = ctx.new_page(); cy.on('pageerror', lambda e: errors.append('cy ' + str(e)))
        cy.goto(CYL); assert cy.locator('#castle-field').is_hidden()
        cy.click('#local'); wait_text(cy, '#status', 'White to move'); assert cy.locator('#turn').is_visible()
        assert cy.evaluate(first) == '56'                                   # a8 top-left
        cy.click('#turn-right'); assert cy.evaluate(first) == '57'          # view turned one file: b8 top-left
        for _ in range(7): cy.click('#turn-right')
        assert cy.evaluate(first) == '56'
        for _ in range(4): cy.click('#turn-left')
        assert cy.evaluate(first) == '60'                                   # seam now in the middle
        # 1.h4 a5 2.Rh3 Nc6: the rook on h3 has a3 next door through the edge
        move(cy, 15, 31); move(cy, 48, 32); move(cy, 7, 23); move(cy, 57, 42)
        click_sq(cy, 23)
        assert cy.locator('#board [data-sq="16"].target').count() == 1
        cy.screenshot(path=str(SHOTS / 'shot_cylinder.png'))
        move(cy, 31, 32); wait_text(cy, '#moves', 'h4xa5')                  # the h-pawn takes on a5 across the edge
        cy.close()
        # online: variant reaches the guest
        ch = ctx.new_page(); ch.goto(CYL); ch.click('#create'); wait_text(ch, '#link', 'Waiting for opponent')
        cg = ctx.new_page(); cg.on('pageerror', lambda e: errors.append('cg ' + str(e)))
        cg.goto(ch.input_value('#invite-url')); wait_text(cg, '#link', 'Connected'); wait_text(cg, '#variant', 'Cylinder')
        move(ch, 12, 28); wait_text(cg, '#status', 'Your move'); assert cg.locator('#turn').is_visible()
        cg.click('#turn-right'); move(cg, 52, 36); wait_text(ch, '#status', 'Your move')
        ch.close(); cg.close()
        los = ctx.new_page(); los.goto(URL); los.click('#local'); assert los.locator('#turn').is_hidden(); los.close()
        # guest opening the room before the host is online keeps retrying, then connects
        ctx2 = br.new_context(); ctx2.add_init_script(FAKE)
        g2 = ctx2.new_page(); g2.goto(URL + '?room=nobodyhere'); wait_text(g2, '#link', 'Host is not online')
        ctx2.close(); ctx.close(); br.close()
finally:
    srv.terminate()
assert not errors, errors
print('ui tests passed')
