'use strict';
/* ---------- UI + peer-to-peer sync ----------
   The host's browser registers a PeerJS id derived from the room code; the
   guest connects to it. Both sides run the same rules engine and exchange
   only moves. The host's move list is the source of truth on reconnect. */
(function () {
  const PREFIX = 'varchess-room-';
  /* Piece shapes drawn as inline SVG so they look the same on every phone and OS. */
  const BASE = '<path d="M11 39.5h23v-3.5h-23z"/>';
  const SHAPE = {
    P: '<circle cx="22.5" cy="13" r="5.5"/><path d="M22.5 18C17 22 15 29 13 36h19c-2-7-4-14-9.5-18z"/>',
    R: '<path d="M12 36v-3h2l1.5-15H13V9h4v3h3.5V9h4v3H28V9h4v9h-2.5L31 33h2v3z"/>',
    N: '<path d="M13 36c0-8 4-11 6-15-3 1-6 3-8 2-1-2 1-6 4-9l1-5 4 3c7-1 13 5 13 15v9z"/><circle class="d" cx="17.5" cy="16.5" r="1.1"/>',
    B: '<circle cx="22.5" cy="6.5" r="2.2"/><path d="M22.5 9c-5.5 6-7 10.5-7 14.5 0 3.5 2.5 5.5 3.5 6.5l-3 6h13l-3-6c1-1 3.5-3 3.5-6.500 0-4-1.5-8.5-7-14.5z"/><path class="d" d="M22.5 15.5l3 5.5"/>',
    Q: '<path d="M9 14l5 16h17l5-16-7 10-2.5-13-4 12-4-12L16 24z"/><path d="M14 30l-1 6h19l-1-6z"/><circle cx="9" cy="13" r="2"/><circle cx="18.5" cy="10" r="2"/><circle cx="26.5" cy="10" r="2"/><circle cx="36" cy="13" r="2"/>',
    K: '<path class="x" d="M22.5 4.5V13M19 8h7"/><path d="M22.5 13c-4.5 0-6.5 4-5 8-4.5-4-9.5-1-8.5 5 .5 4 4 5 5 10h17c1-5 4.5-6 5-10 1-6-4-9-8.5-5 1.5-4-.5-8-5-8z"/>',
  };
  function pieceEl(color, type) {
    const g = document.createElement('span');
    g.className = 'pc ' + color;
    g.innerHTML = '<svg viewBox="0 0 45 45" aria-hidden="true">' + SHAPE[type] + BASE + '</svg>';
    return g;
  }
  const NAME = { w: 'White', b: 'Black' };
  const PIECE = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
  const $ = (id) => document.getElementById(id);

  const G = {
    mode: null,          // 'local' | 'host' | 'guest'
    room: null,
    vk: 'losalamos',
    opts: { castling: false },   // per-game rule options, chosen by whoever creates the game
    hostColor: 'w',
    gameNo: 1,
    moves: [],           // [{from,to,promo?}]
    resigned: null,      // color that resigned, or null
    state: null, labels: [], sel: null, promo: null,
    peer: null, conn: null, link: 'idle', retry: null,
  };

  /* ---------- storage (best effort) ---------- */
  const storeKey = () => 'varchess:' + G.room + ':' + G.mode;
  function save() {
    if (G.mode === 'local') return;
    try {
      localStorage.setItem(storeKey(), JSON.stringify({
        vk: G.vk, opts: G.opts, hostColor: G.hostColor, gameNo: G.gameNo, moves: G.moves, resigned: G.resigned,
      }));
    } catch (e) { /* private mode etc. */ }
  }
  function load(room, mode) {
    try { return JSON.parse(localStorage.getItem('varchess:' + room + ':' + mode)); } catch (e) { return null; }
  }

  /* ---------- game state ---------- */
  function rebuild(vk, moves, opts) {
    if (!VARIANTS[vk] || !Array.isArray(moves)) return false;
    const o = { castling: !!(opts || G.opts).castling };
    let s = newState(vk, o); const labels = []; const clean = [];
    for (const raw of moves) {
      if (outcome(s).over) return false;
      const m = findLegal(s, raw);
      if (!m) return false;
      labels.push(moveLabel(s, m)); clean.push(m); s = applyMove(s, m);
    }
    G.vk = vk; G.opts = o; G.moves = clean; G.state = s; G.labels = labels; G.sel = null; G.promo = null;
    return true;
  }
  const myColor = () => (G.mode === 'local' ? null : G.mode === 'host' ? G.hostColor : other(G.hostColor));
  function result() {
    if (G.resigned) return { over: 'resign', winner: other(G.resigned), check: false };
    return outcome(G.state);
  }
  function canMove() {
    if (result().over) return false;
    if (G.mode === 'local') return true;
    return G.link === 'connected' && G.state.turn === myColor();
  }

  function playLocalMove(m) {
    if (!canMove()) return;
    const base = findBase(G.state, m);
    if (!base) return;
    // Swap variants: the mover's browser rolls the dice and sends the result with the move.
    const cands = swapCandidates(G.state, base);
    const legal = findLegal(G.state, cands.length
      ? Object.assign({}, base, { swap: cands[Math.floor(Math.random() * cands.length)] }) : base);
    if (!legal) return;
    G.labels.push(moveLabel(G.state, legal));
    G.moves.push(legal); G.state = applyMove(G.state, legal); G.sel = null; G.promo = null;
    save();
    send({ t: 'move', g: G.gameNo, i: G.moves.length - 1, m: legal });
    render();
  }

  /* ---------- networking ---------- */
  function send(msg) { if (G.conn && G.conn.open) G.conn.send(msg); }
  function sendInit() {
    send({ t: 'init', vk: G.vk, opts: G.opts, hostColor: G.hostColor, g: G.gameNo, moves: G.moves, resigned: G.resigned });
  }
  function setLink(v) { G.link = v; render(); }
  function later(fn, ms) { clearTimeout(G.retry); G.retry = setTimeout(fn, ms); }
  function newPeer(id) {
    const Ctor = window.__TestPeer || window.Peer;
    const p = id ? new Ctor(id) : new Ctor();
    p.on('disconnected', () => { if (!p.destroyed) { try { p.reconnect(); } catch (e) { /* ignore */ } } });
    return p;
  }

  function startHost() {
    if (G.peer) G.peer.destroy();
    setLink('starting');
    const p = G.peer = newPeer(PREFIX + G.room);
    p.on('open', () => { if (G.link !== 'connected') setLink('waiting'); });
    p.on('connection', (c) => {
      c.on('open', () => {
        if (G.conn && G.conn !== c) { try { G.conn.close(); } catch (e) { /* ignore */ } }
        G.conn = c; setLink('connected'); sendInit();
      });
      c.on('data', (d) => onData(d, c));
      c.on('close', () => { if (G.conn === c) { G.conn = null; setLink('waiting'); } });
    });
    p.on('error', (err) => {
      if (err.type === 'unavailable-id') {
        // Room id is held elsewhere. If we have no record of hosting it, we're really the guest.
        if (!load(G.room, 'host')) { G.mode = 'guest'; startGuest(); return; }
        setLink('taken'); later(startHost, 3000);
      } else if (!G.conn) { setLink('error'); later(startHost, 4000); }
    });
  }

  function startGuest() {
    if (G.peer) G.peer.destroy();
    setLink('starting');
    const p = G.peer = newPeer();
    const dial = () => {
      if (p.destroyed) return;
      const c = p.connect(PREFIX + G.room, { reliable: true });
      c.on('open', () => { G.conn = c; setLink('connected'); });
      c.on('data', (d) => onData(d, c));
      c.on('close', () => { if (G.conn === c) { G.conn = null; setLink('lost'); later(dial, 2000); } });
    };
    p.on('open', dial);
    p.on('error', (err) => {
      if (err.type === 'peer-unavailable') { setLink('nohost'); later(dial, 3000); }
      else if (!G.conn) { setLink('error'); later(startGuest, 4000); }
    });
  }

  function onData(d, c) {
    if (c !== G.conn || !d || typeof d !== 'object') return;
    if (d.t === 'init' && G.mode === 'guest') {
      const mine = { g: G.gameNo, vk: G.vk, moves: G.moves.slice(), had: !!G.state };
      if (!rebuild(d.vk, d.moves, d.opts || {})) return;
      G.hostColor = d.hostColor === 'b' ? 'b' : 'w'; G.gameNo = d.g; G.resigned = d.resigned || null;
      // If the host lost moves we still have (e.g. it cleared its storage), offer ours back.
      if (mine.had && mine.g === d.g && mine.vk === d.vk && mine.moves.length > d.moves.length) {
        send({ t: 'sync', g: mine.g, moves: mine.moves });
      }
      save(); render();
    } else if (d.t === 'sync' && G.mode === 'host') {
      if (d.g === G.gameNo && Array.isArray(d.moves) && d.moves.length > G.moves.length) {
        const keep = G.moves.slice();
        const prefixOk = keep.every((m, i) => d.moves[i] && d.moves[i].from === m.from && d.moves[i].to === m.to);
        if (!prefixOk || !rebuild(G.vk, d.moves)) rebuild(G.vk, keep);
        save(); render();
      }
      sendInit();
    } else if (d.t === 'move') {
      const ok = d.g === G.gameNo && d.i === G.moves.length && !result().over &&
        G.state.turn === other(myColor()) && findLegal(G.state, d.m);
      if (ok) {
        const m = findLegal(G.state, d.m);
        G.labels.push(moveLabel(G.state, m)); G.moves.push(m); G.state = applyMove(G.state, m);
        G.sel = null; G.promo = null; save(); render();
      } else if (G.mode === 'host') sendInit(); else send({ t: 'hello' });
    } else if (d.t === 'hello' && G.mode === 'host') {
      sendInit();
    } else if (d.t === 'resign') {
      if (d.g === G.gameNo && !result().over) { G.resigned = other(myColor()); save(); render(); }
    } else if (d.t === 'rematch' && G.mode === 'host') {
      rematch();
    }
  }

  function rematch() {
    if (!result().over) return;
    if (G.mode === 'guest') { send({ t: 'rematch' }); return; }
    if (G.mode === 'host') { G.gameNo += 1; G.hostColor = other(G.hostColor); }
    G.resigned = null; rebuild(G.vk, []);
    save(); sendInit(); render();
  }

  /* ---------- rendering ---------- */
  function linkText() {
    const host = G.mode === 'host';
    switch (G.link) {
      case 'connected': return ['ok', 'Connected'];
      case 'waiting': return ['wait', 'Waiting for opponent'];
      case 'nohost': return ['wait', 'Host is not online — retrying'];
      case 'lost': return ['wait', 'Connection lost — retrying'];
      case 'taken': return ['wait', 'Room open in another tab — retrying'];
      case 'error': return ['bad', 'Network problem — retrying'];
      default: return ['wait', host ? 'Opening room…' : 'Connecting…'];
    }
  }

  function statusText() {
    const r = result(); const me = myColor();
    if (r.over === 'checkmate') return 'Checkmate — ' + NAME[r.winner] + ' wins';
    if (r.over === 'resign') return NAME[other(r.winner)] + ' resigned — ' + NAME[r.winner] + ' wins';
    if (r.over === 'stalemate') return 'Draw — stalemate';
    if (r.over === 'material') return 'Draw — not enough material';
    if (r.over === 'repetition') return 'Draw — position repeated three times';
    if (me && G.link !== 'connected') return G.moves.length ? 'Paused — waiting for connection' : 'Waiting for opponent to join';
    const who = me ? (G.state.turn === me ? 'Your move' : 'Opponent’s move') : NAME[G.state.turn] + ' to move';
    return who + (r.check ? ' — check' : '');
  }

  function render() {
    const online = G.mode !== 'local';
    const pill = $('link');
    pill.hidden = !online;
    if (online) { const [cls, txt] = linkText(); pill.className = 'pill ' + cls; pill.textContent = txt; }
    if (!G.state) { $('status').textContent = 'Joining game…'; return; }
    const s = G.state, me = myColor(), flip = me === 'b';
    const board = $('board');
    board.style.setProperty('--cols', s.cols); board.style.setProperty('--rows', s.rows);
    board.textContent = '';
    const targets = G.sel === null ? [] : legalMoves(s, G.sel).map((m) => m.to);
    const last = G.moves[G.moves.length - 1];
    const r = result();
    const checked = r.check || r.over === 'checkmate' ? s.board.indexOf(s.turn + 'K') : -1;
    for (let vr = 0; vr < s.rows; vr++) {
      for (let vc = 0; vc < s.cols; vc++) {
        const row = flip ? vr : s.rows - 1 - vr, col = flip ? s.cols - 1 - vc : vc;
        const i = row * s.cols + col, p = s.board[i];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'sq ' + ((row + col) % 2 === 0 ? 'dark' : 'light');
        if (i === G.sel) b.classList.add('sel');
        if (last && (i === last.from || i === last.to)) b.classList.add('last');
        if (last && last.swap !== undefined && (i === last.swap || i === last.to)) b.classList.add('swap');
        if (i === checked) b.classList.add('check');
        if (targets.includes(i)) b.classList.add(p ? 'capture' : 'target');
        b.dataset.sq = i;
        b.setAttribute('aria-label', sqName(s, i) + (p ? ' ' + NAME[p[0]] + ' ' + p[1] : ''));
        if (p) {
          b.appendChild(pieceEl(p[0], p[1]));
        }
        if (vc === 0) { const n = document.createElement('i'); n.className = 'rk'; n.textContent = row + 1; b.appendChild(n); }
        if (vr === s.rows - 1) { const n = document.createElement('i'); n.className = 'fl'; n.textContent = 'abcdefghij'[col]; b.appendChild(n); }
        board.appendChild(b);
      }
    }

    $('status').textContent = statusText();
    const note = $('note');
    note.hidden = !(last && last.swap !== undefined);
    if (!note.hidden) {
      note.textContent = 'Swapped: ' + sqName(s, last.to) + ' is now a ' + PIECE[s.board[last.to][1]] +
        ', ' + sqName(s, last.swap) + ' is now a ' + PIECE[s.board[last.swap][1]] + '.';
    }
    $('variant').textContent = VARIANTS[s.vk].name + (G.opts.castling ? ' · castling' : '') + (me ? ' · you are ' + NAME[me] : ' · one device');
    $('invite').hidden = !(G.mode === 'host' && G.link !== 'connected');
    $('resign').hidden = !!r.over || (online && G.link !== 'connected');
    $('rematch').hidden = !r.over || (online && G.link !== 'connected');

    const promo = $('promo');
    promo.hidden = !G.promo;
    promo.textContent = '';
    if (G.promo) {
      for (const t of VARIANTS[s.vk].promo) {
        const b = document.createElement('button');
        b.type = 'button'; b.className = 'sq light'; b.dataset.promo = t;
        b.setAttribute('aria-label', 'Promote to ' + t);
        b.appendChild(pieceEl(s.turn, t)); promo.appendChild(b);
      }
    }

    const ol = $('moves');
    ol.textContent = '';
    for (let i = 0; i < G.labels.length; i += 2) {
      const li = document.createElement('li');
      li.textContent = G.labels[i] + (G.labels[i + 1] ? '  ' + G.labels[i + 1] : '');
      ol.appendChild(li);
    }
    ol.scrollTop = ol.scrollHeight;
  }

  /* ---------- input ---------- */
  function onSquare(i) {
    if (!canMove()) return;
    const s = G.state;
    if (G.sel !== null) {
      const opts = legalMoves(s, G.sel).filter((m) => m.to === i);
      if (opts.length === 1 && !opts[0].promo) { playLocalMove(opts[0]); return; }
      if (opts.length) { G.promo = { from: G.sel, to: i }; render(); return; }
    }
    G.promo = null;
    G.sel = s.board[i] && s.board[i][0] === s.turn && i !== G.sel ? i : null;
    render();
  }

  function inviteUrl() { return location.href.split(/[?#]/)[0] + '?room=' + G.room; }

  function showGame() { $('lobby').hidden = true; $('game').hidden = false; render(); }

  function boot() {
    const sel = $('pick-variant');
    const offered = (window.PAGE_VARIANTS || Object.keys(VARIANTS)).filter((k) => VARIANTS[k]);
    $('variant-field').hidden = offered.length < 2;
    for (const k of offered) {
      const o = document.createElement('option');
      o.value = k; o.textContent = VARIANTS[k].name + ' — ' + VARIANTS[k].blurb; sel.appendChild(o);
    }

    // The castling switch only applies to variants where castling is optional.
    const syncOptions = () => { $('castle-field').hidden = !VARIANTS[sel.value].castlingOptional; };
    const wantCastling = () => !!VARIANTS[sel.value].castlingOptional && $('opt-castling').checked;
    sel.addEventListener('change', syncOptions); syncOptions();

    $('board').addEventListener('click', (e) => {
      const b = e.target.closest('[data-sq]'); if (b) onSquare(Number(b.dataset.sq));
    });
    $('promo').addEventListener('click', (e) => {
      const b = e.target.closest('[data-promo]');
      if (b && G.promo) playLocalMove({ from: G.promo.from, to: G.promo.to, promo: b.dataset.promo });
    });
    $('resign').addEventListener('click', (e) => {
      const btn = e.currentTarget;
      if (btn.dataset.armed !== '1') {           // two-tap confirm instead of a blocking dialog
        btn.dataset.armed = '1'; btn.textContent = 'Tap again to resign';
        setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Resign'; }, 3000);
        return;
      }
      btn.dataset.armed = ''; btn.textContent = 'Resign';
      if (result().over) return;
      G.resigned = G.mode === 'local' ? G.state.turn : myColor();
      save(); send({ t: 'resign', g: G.gameNo }); render();
    });
    $('rematch').addEventListener('click', rematch);
    $('copy').addEventListener('click', async () => {
      const box = $('invite-url');
      try { await navigator.clipboard.writeText(box.value); $('copy').textContent = 'Copied'; }
      catch (e) { box.focus(); box.select(); $('copy').textContent = 'Select & copy'; }
      setTimeout(() => { $('copy').textContent = 'Copy link'; }, 2000);
    });

    $('create').addEventListener('click', () => {
      const pick = $('pick-color').value;
      const color = pick === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
      const abc = 'abcdefghjkmnpqrstuvwxyz23456789';
      let code = ''; for (let i = 0; i < 8; i++) code += abc[Math.floor(Math.random() * abc.length)];
      G.mode = 'host'; G.room = code; G.hostColor = color; G.gameNo = 1; G.resigned = null;
      rebuild(sel.value, [], { castling: wantCastling() }); save();
      const url = location.href.split(/[?#]/)[0] + '?room=' + code + '&host=1';
      try { history.pushState(null, '', url); } catch (e) { location.href = url; return; }
      enterOnline();
    });
    $('local').addEventListener('click', () => {
      G.mode = 'local'; G.resigned = null; rebuild(sel.value, [], { castling: wantCastling() }); showGame();
    });

    const q = new URLSearchParams(location.search);
    const room = (q.get('room') || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
    if (room) {
      G.room = room; G.mode = q.get('host') === '1' ? 'host' : 'guest';
      const saved = load(room, G.mode);
      if (saved && rebuild(saved.vk, saved.moves, saved.opts || {})) {
        G.hostColor = saved.hostColor === 'b' ? 'b' : 'w'; G.gameNo = saved.gameNo || 1; G.resigned = saved.resigned || null;
      } else if (G.mode === 'host') { rebuild((window.PAGE_VARIANTS || ['losalamos'])[0], [], {}); }
      enterOnline();
    }
  }

  function enterOnline() {
    $('invite-url').value = inviteUrl();
    $('lobby').hidden = true; $('game').hidden = false;
    if (G.mode === 'host') startHost(); else startGuest();
    render();
  }

  window.__G = G; // handy for debugging in the console
  boot();
})();
