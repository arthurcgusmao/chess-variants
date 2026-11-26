/* Peer-to-peer transport over WebRTC (PeerJS). Knows nothing about chess.

   The host's browser registers a PeerJS id derived from the room code and the guest
   connects to it; after that, messages go directly between the two browsers. This module
   keeps that single connection alive, retrying on its own.

   connect({ room, role, onStatus, onOpen, onMessage, onIdTaken }) -> { send, close, open }
     role       'host' | 'guest'
     onStatus   called with: starting, waiting, connected, nohost, lost, taken, error
     onOpen     host only: a guest has just connected
     onMessage  a message arrived from the other player
     onIdTaken  host only: the room id is registered elsewhere. Return true to keep
                retrying; otherwise this link stops and the caller decides what to do. */
const PREFIX = 'varchess-room-';

function newPeer(id) {
  const Peer = globalThis.__TestPeer || globalThis.Peer;   // __TestPeer: stand-in used by tests/test_ui.py
  const peer = id ? new Peer(id) : new Peer();
  peer.on('disconnected', () => { if (!peer.destroyed) { try { peer.reconnect(); } catch (e) { /* retried below */ } } });
  return peer;
}

export function connect({ room, role, onStatus, onOpen, onMessage, onIdTaken }) {
  let peer = null, conn = null, timer = null, closed = false;
  const later = (fn, ms) => { clearTimeout(timer); timer = setTimeout(() => { if (!closed) fn(); }, ms); };
  const status = (s) => { if (!closed) onStatus(s); };

  function adopt(c) {
    c.on('data', (d) => { if (c === conn && !closed && d && typeof d === 'object') onMessage(d); });
  }

  function host() {
    if (peer) peer.destroy();
    status('starting');
    const p = peer = newPeer(PREFIX + room);
    p.on('open', () => { if (!conn) status('waiting'); });
    p.on('connection', (c) => {
      c.on('open', () => {
        if (conn && conn !== c) { try { conn.close(); } catch (e) { /* already gone */ } }
        conn = c; status('connected'); if (!closed) onOpen();
      });
      adopt(c);
      c.on('close', () => { if (conn === c) { conn = null; status('waiting'); } });
    });
    p.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        if (onIdTaken()) { status('taken'); later(host, 3000); }
      } else if (!conn) { status('error'); later(host, 4000); }
    });
  }

  function guest() {
    if (peer) peer.destroy();
    status('starting');
    const p = peer = newPeer();
    const dial = () => {
      if (p.destroyed) return;
      const c = p.connect(PREFIX + room, { reliable: true });
      c.on('open', () => { conn = c; status('connected'); });
      adopt(c);
      c.on('close', () => { if (conn === c) { conn = null; status('lost'); later(dial, 2000); } });
    };
    p.on('open', dial);
    p.on('error', (err) => {
      if (err.type === 'peer-unavailable') { status('nohost'); later(dial, 3000); }
      else if (!conn) { status('error'); later(guest, 4000); }
    });
  }

  if (role === 'host') host(); else guest();

  return {
    get open() { return !!(conn && conn.open); },
    send(msg) { if (conn && conn.open) conn.send(msg); },
    close() { closed = true; clearTimeout(timer); if (peer) peer.destroy(); peer = conn = null; },
  };
}
