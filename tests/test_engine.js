import assert from 'node:assert';
import * as engine from '../src/engine.js';
import { VARIANTS } from '../src/variants.js';

const E = { ...engine, VARIANTS };

// Opening move counts worked out by hand
assert.strictEqual(E.legalMoves(E.newState('losalamos')).length, 10);
assert.strictEqual(E.legalMoves(E.newState('gardner')).length, 7);
assert.strictEqual(E.legalMoves(E.newState('norooks')).length, 8);

// Los Alamos starting squares
let s = E.newState('losalamos');
assert.strictEqual(s.board[2], 'wQ'); assert.strictEqual(s.board[3], 'wK');
assert.strictEqual(s.board[32], 'bQ'); assert.strictEqual(s.board[33], 'bK');

// No pawn double step
assert.ok(!E.findLegal(s, { from: 6, to: 18 }));
assert.ok(E.findLegal(s, { from: 6, to: 12 }));

// Constructed positions
function pos(vk, pieces, turn) {
  const st = E.newState(vk); st.board.fill('');
  for (const [sq, p] of Object.entries(pieces)) {
    const c = 'abcdefgh'.indexOf(sq[0]), r = Number(sq[1]) - 1; st.board[r * st.cols + c] = p;
  }
  st.turn = turn; st.keys = []; return st;
}
// Back-rank mate: black K a6, white Q b5 protected by K... use Q+R
let m = pos('losalamos', { a6: 'bK', a1: 'wR', b1: 'wR', f1: 'wK' }, 'b');
let o = E.outcome(m); assert.strictEqual(o.over, 'checkmate'); assert.strictEqual(o.winner, 'w');
// Stalemate: black K a6, white Q b4 (covers b5,b6,a... ) -> K a6 moves: a5,b5,b6. Q on c5 covers a5? no. Use Q b4 + K c6? adjacent kings illegal squares
m = pos('losalamos', { a6: 'bK', c5: 'wQ', f1: 'wK' }, 'b');
// Qc5 attacks a5? no (c5-b5-a5 along rank: yes it does), b6 (diag), b5 (rank). a6 itself not attacked.
o = E.outcome(m); assert.strictEqual(o.over, 'stalemate'); assert.strictEqual(o.check, false);
// Promotion options and no bishop in Los Alamos
m = pos('losalamos', { a5: 'wP', f1: 'wK', f6: 'bK' }, 'w');
const promos = E.legalMoves(m).filter((x) => x.from === 24).map((x) => x.promo).sort();
assert.deepStrictEqual(promos, ['N', 'Q', 'R']);
const after = E.applyMove(m, { from: 24, to: 30, promo: 'Q' });
assert.strictEqual(after.board[30], 'wQ');
assert.strictEqual(E.moveLabel(m, { from: 24, to: 30, promo: 'Q' }), 'a5-a6=Q+');
// Pinned piece cannot move: wK a1, wN a2, bR a6
m = pos('losalamos', { a1: 'wK', a2: 'wN', a6: 'bR', f6: 'bK' }, 'w');
assert.strictEqual(E.legalMoves(m, 6).length, 0);
// Insufficient material
m = pos('gardner', { a1: 'wK', e5: 'bK', c3: 'wN' }, 'w');
assert.strictEqual(E.outcome(m).over, 'material');

// Random playouts: invariants hold and games terminate or hit the cap
let seed = 12345; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
const tally = {};
for (const vk of ['losalamos', 'norooks', 'gardner']) {
  for (let g = 0; g < 150; g++) {
    let st = E.newState(vk), n = 0, out = E.outcome(st);
    while (!out.over && n < 400) {
      const mv = E.legalMoves(st); const pick = mv[Math.floor(rnd() * mv.length)];
      assert.ok(E.findLegal(st, pick)); E.moveLabel(st, pick);
      const mover = st.turn; st = E.applyMove(st, pick); n++;
      assert.strictEqual(st.board.filter((p) => p === 'wK').length, 1);
      assert.strictEqual(st.board.filter((p) => p === 'bK').length, 1);
      assert.ok(!E.inCheck(st, mover), 'mover left own king in check');
      const lastW = st.board.slice(-st.cols), firstB = st.board.slice(0, st.cols);
      assert.ok(!lastW.includes('wP') && !firstB.includes('bP'), 'unpromoted pawn');
      out = E.outcome(st);
    }
    const k = vk + ':' + (out.over || 'cap'); tally[k] = (tally[k] || 0) + 1;
  }
}
console.log('engine tests passed', tally);

// ---------- castling option ----------
(function () {
  const sq = (st, n) => 'abcdefgh'.indexOf(n[0]) + (Number(n[1]) - 1) * st.cols;
  function cpos(pieces, turn, rights) {
    const st = E.newState('losalamos', { castling: true }); st.board.fill('');
    for (const [n, p] of Object.entries(pieces)) st.board[sq(st, n)] = p;
    st.turn = turn; st.keys = []; st.cr = rights.map((n) => sq(st, n)); return st;
  }
  const castles = (st) => E.legalMoves(st).filter((m) => m.castle !== undefined);

  // Off by default, and no castle available from the start position even when on
  assert.strictEqual(E.newState('losalamos').castling, false);
  let st = E.newState('losalamos', { castling: true });
  assert.deepStrictEqual(st.cr, [0, 5, 30, 35]);
  assert.strictEqual(E.legalMoves(st).length, 10);

  // Both sides available on an empty back rank
  st = cpos({ a1: 'wR', d1: 'wK', f1: 'wR', d6: 'bK' }, 'w', ['a1', 'f1']);
  assert.strictEqual(castles(st).length, 2);
  let short = E.findLegal(st, { from: 3, to: 5 }), long = E.findLegal(st, { from: 3, to: 1 });
  assert.ok(short && long);
  assert.strictEqual(E.moveLabel(st, short), 'O-O'); assert.strictEqual(E.moveLabel(st, long), 'O-O-O');
  let a = E.applyMove(st, short);
  assert.strictEqual(a.board[5], 'wK'); assert.strictEqual(a.board[4], 'wR'); assert.strictEqual(a.board[3], ''); assert.strictEqual(a.board[0], 'wR');
  assert.deepStrictEqual(a.cr, []);
  a = E.applyMove(st, long);
  assert.strictEqual(a.board[1], 'wK'); assert.strictEqual(a.board[2], 'wR'); assert.strictEqual(a.board[0], ''); assert.strictEqual(a.board[3], '');
  // Same position with the option off: no castling
  const off = E.newState('losalamos'); off.board = st.board.slice(); off.keys = [];
  assert.ok(!E.findLegal(off, { from: 3, to: 5 }));

  // Blocked by a piece in between
  st = cpos({ a1: 'wR', b1: 'wN', d1: 'wK', e1: 'wN', f1: 'wR', d6: 'bK' }, 'w', ['a1', 'f1']);
  assert.strictEqual(castles(st).length, 0);
  // Not while in check
  st = cpos({ a1: 'wR', d1: 'wK', f1: 'wR', d5: 'bR', a6: 'bK' }, 'w', ['a1', 'f1']);
  assert.strictEqual(castles(st).length, 0);
  // Not across an attacked square (e1 attacked: short off; long still fine)
  st = cpos({ a1: 'wR', d1: 'wK', f1: 'wR', e5: 'bR', a6: 'bK' }, 'w', ['a1', 'f1']);
  assert.deepStrictEqual(castles(st).map((m) => m.to), [1]);
  // Not onto an attacked square (b1 attacked: long off; rook passing an attacked square is fine)
  st = cpos({ a1: 'wR', d1: 'wK', f1: 'wR', b5: 'bR', f6: 'bK' }, 'w', ['a1', 'f1']);
  assert.deepStrictEqual(castles(st).map((m) => m.to), [5]);
  st = cpos({ a1: 'wR', d1: 'wK', a5: 'bR', f6: 'bK' }, 'w', ['a1']);
  assert.deepStrictEqual(castles(st).map((m) => m.to), [1]);
  // Rights: lost by rook move, king move, and rook capture
  st = cpos({ a1: 'wR', d1: 'wK', f1: 'wR', d6: 'bK', f6: 'bR' }, 'w', ['a1', 'f1', 'f6']);
  assert.deepStrictEqual(E.applyMove(st, { from: 0, to: 6 }).cr, [5, 35]);
  assert.deepStrictEqual(E.applyMove(st, { from: 3, to: 9 }).cr, [35]);
  assert.deepStrictEqual(E.applyMove(st, { from: 5, to: 35 }).cr, [0]);
  // King returning home does not restore the right
  let b = E.applyMove(E.applyMove(E.applyMove(E.applyMove(st, { from: 3, to: 9 }), { from: 33, to: 32 }), { from: 9, to: 3 }), { from: 32, to: 33 });
  assert.strictEqual(castles(b).length, 0);
  // A king walking along the enemy back rank must not strip the enemy's rights
  st = cpos({ a6: 'bR', f6: 'bR', d6: 'wK', d1: 'bK' }, 'w', ['a6', 'f6']);
  assert.deepStrictEqual(E.applyMove(st, { from: 33, to: 32 }).cr, [30, 35]);
  // Black castles too
  st = cpos({ d1: 'wK', a6: 'bR', d6: 'bK', f6: 'bR' }, 'b', ['a6', 'f6']);
  a = E.applyMove(st, E.findLegal(st, { from: 33, to: 35 }));
  assert.strictEqual(a.board[35], 'bK'); assert.strictEqual(a.board[34], 'bR');

  // Random playouts with castling on
  let seed = 777, n = 0; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let g = 0; g < 300; g++) {
    let s2 = E.newState('losalamos', { castling: true }), ply = 0, out = E.outcome(s2);
    while (!out.over && ply < 300) {
      const mv = E.legalMoves(s2); const cs = mv.filter((m) => m.castle !== undefined);
      const pick = cs.length && rnd() < 0.5 ? cs[0] : mv[Math.floor(rnd() * mv.length)];
      assert.ok(E.findLegal(s2, { from: pick.from, to: pick.to, promo: pick.promo })); E.moveLabel(s2, pick);
      const mover = s2.turn, before = s2.board.filter(Boolean).length, cap = pick.castle === undefined && s2.board[pick.to] ? 1 : 0;
      s2 = E.applyMove(s2, pick); ply++; if (pick.castle !== undefined) n++;
      assert.strictEqual(s2.board.filter(Boolean).length, before - cap, 'piece count changed');
      assert.strictEqual(s2.board.filter((p) => p === 'wK').length, 1); assert.strictEqual(s2.board.filter((p) => p === 'bK').length, 1);
      assert.ok(!E.inCheck(s2, mover));
      out = E.outcome(s2);
    }
  }
  assert.ok(n > 50, 'castling rarely happened: ' + n);
  console.log('castling tests passed; castles in playouts:', n);
})();

// ---------- classic 8x8 rules (perft against published node counts) ----------
(function () {
  function fen(vk, str) {
    const [rowsStr, turn, cas, ep] = str.split(' ');
    const st = E.newState(vk); st.board.fill('');
    rowsStr.split('/').forEach((row, ri) => {
      let c = 0; const r = 7 - ri;
      for (const ch of row) {
        if (/\d/.test(ch)) { c += Number(ch); continue; }
        st.board[r * 8 + c++] = (ch === ch.toUpperCase() ? 'w' : 'b') + ch.toUpperCase();
      }
    });
    st.turn = turn; st.cr = [];
    if (cas.includes('Q')) st.cr.push(0); if (cas.includes('K')) st.cr.push(7);
    if (cas.includes('q')) st.cr.push(56); if (cas.includes('k')) st.cr.push(63);
    st.ep = ep === '-' ? -1 : 'abcdefgh'.indexOf(ep[0]) + (Number(ep[1]) - 1) * 8;
    st.keys = []; return st;
  }
  function perft(st, d) {
    const mv = E.legalMoves(st);
    if (d === 1) return mv.length;
    let n = 0; for (const m of mv) n += perft(E.applyMove(st, m), d - 1); return n;
  }
  const cases = [
    ['rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -', [20, 400, 8902]],
    ['r3k2r/p1ppqpb1/bn2pnp1/3PN3/1p2P3/2N2Q1p/PPPBBPPP/R3K2R w KQkq -', [48, 2039, 97862]],   // castling, pins
    ['8/2p5/3p4/KP5r/1R3p1k/8/4P1P1/8 w - -', [14, 191, 2812, 43238]],                           // en passant
    ['rnbq1k1r/pp1Pbppp/2p5/8/2B5/8/PPP1NnPP/RNBQK2R w KQ -', [44, 1486, 62379]],                // promotions
  ];
  for (const [f, counts] of cases) counts.forEach((want, i) => assert.strictEqual(perft(fen('classic', f), i + 1), want, f + ' depth ' + (i + 1)));
  assert.deepStrictEqual(E.newState('classic').cr, [0, 7, 56, 63]);
  // Los Alamos still has no double step or en passant
  assert.strictEqual(E.legalMoves(E.newState('losalamos')).length, 10);

  // ---------- random swap ----------
  let st = E.newState('randomswap');
  // Pawn and king moves never swap
  assert.deepStrictEqual(E.swapCandidates(st, E.findBase(st, { from: 12, to: 28 })), []);
  assert.ok(E.findLegal(st, { from: 12, to: 28 })); assert.ok(!E.findLegal(st, { from: 12, to: 28, swap: 0 }));
  // Knight g1-f3: partners are own R/B/Q (a1,c1,d1,f1,h1), never the other knight, pawns or king
  const nf3 = E.findBase(st, { from: 6, to: 21 });
  assert.deepStrictEqual(E.swapCandidates(st, nf3), [0, 2, 3, 5, 7]);
  assert.ok(!E.findLegal(st, { from: 6, to: 21 }), 'swap is mandatory when a partner exists');
  assert.ok(!E.findLegal(st, { from: 6, to: 21, swap: 1 })); assert.ok(!E.findLegal(st, { from: 6, to: 21, swap: 4 }));
  assert.ok(!E.findLegal(st, { from: 6, to: 21, swap: 59 }));
  const mv = E.findLegal(st, { from: 6, to: 21, swap: 3 });
  assert.strictEqual(E.moveLabel(st, mv), 'Ng1-f3↔d1');
  let a = E.applyMove(st, mv);
  assert.strictEqual(a.board[21], 'wQ'); assert.strictEqual(a.board[3], 'wN'); assert.strictEqual(a.board[6], '');
  // Castling works with any unmoved corner piece, whatever a swap turned it into
  st = fen('randomswap', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  assert.strictEqual(E.castleMoves(st).length, 2);
  st.board[7] = 'wN'; assert.strictEqual(E.castleMoves(st).length, 2);
  let c = E.applyMove(st, E.findLegal(st, { from: 4, to: 6 }));
  assert.strictEqual(c.board[6], 'wK'); assert.strictEqual(c.board[5], 'wN'); assert.strictEqual(c.board[7], ''); assert.strictEqual(c.board[4], '');
  st.board[0] = 'wQ'; c = E.applyMove(st, E.findLegal(st, { from: 4, to: 2 }));
  assert.strictEqual(c.board[2], 'wK'); assert.strictEqual(c.board[3], 'wQ'); assert.strictEqual(c.board[0], '');
  // ...but not once that corner piece has moved away and come back, or been replaced
  st = fen('randomswap', 'r3k2r/8/8/8/8/8/8/R3K2R w Qkq -'); st.board[7] = 'wB';
  assert.deepStrictEqual(E.castleMoves(st).map((m) => m.to), [2]);
  // ...and never with an enemy piece that captured its way into the corner
  st = fen('randomswap', 'r3k2r/8/8/8/8/8/8/R3K2n w Qkq -');
  assert.deepStrictEqual(E.castleMoves(st).map((m) => m.to), [2]);
  st = fen('randomswap', 'r3k2r/8/8/8/8/8/8/R3K2R w KQkq -');
  assert.deepStrictEqual(E.swapCandidates(st, E.castleMoves(st)[0]), []);
  // Only one piece type left: no swap, move stands alone
  st = fen('randomswap', '4k3/8/8/8/8/8/8/R3K2R w - -');
  assert.deepStrictEqual(E.swapCandidates(st, E.findBase(st, { from: 0, to: 8 })), []);
  assert.ok(E.findLegal(st, { from: 0, to: 8 }));
  // Check is judged after the swap: Ra1-a8 would check along the rank, but it becomes a knight
  st = fen('randomswap', '4k3/8/8/8/8/8/8/R3K1N1 w - -');
  const m2 = E.findLegal(st, { from: 0, to: 56, swap: 6 });
  assert.strictEqual(E.outcome(E.applyMove(st, m2)).check, false);
  assert.strictEqual(E.moveLabel(st, m2), 'Ra1-a8↔g1');
  // and the reverse: a knight move that becomes a rook check
  st = fen('randomswap', '4k3/8/8/8/8/8/8/1N2K2R w - -');
  const m3 = E.findLegal(st, { from: 1, to: 16 + 0, swap: 7 });   // Nb1-a3, swaps with Rh1 -> h1 knight, a3 rook: no check
  assert.strictEqual(E.outcome(E.applyMove(st, m3)).check, false);
  st = fen('randomswap', 'k7/8/8/8/8/8/8/1N2K2R w - -');
  const m4 = E.findLegal(st, { from: 1, to: 16, swap: 7 });        // a3 becomes a rook facing Ka8
  assert.strictEqual(E.outcome(E.applyMove(st, m4)).check, true);
  assert.strictEqual(E.moveLabel(st, m4), 'Nb1-a3↔h1+');

  // Random playouts: swaps keep material, never endanger the mover, games stay consistent
  let seed = 4242, swaps = 0, over = {}; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const material = (b, c) => b.filter((p) => p && p[0] === c).map((p) => p[1]).sort().join('');
  for (let g = 0; g < 60; g++) {
    let s2 = E.newState('randomswap'), ply = 0, out = E.outcome(s2);
    while (!out.over && ply < 200) {
      const bases = E.legalMoves(s2); const base = bases[Math.floor(rnd() * bases.length)];
      const c = E.swapCandidates(s2, base);
      const raw = c.length ? Object.assign({}, base, { swap: c[Math.floor(rnd() * c.length)] }) : base;
      const full = E.findLegal(s2, raw); assert.ok(full, 'full move rejected');
      E.moveLabel(s2, full);
      const mover = s2.turn, before = material(s2.board, mover);
      const afterBase = material(E.applyMove(s2, base).board, mover);
      s2 = E.applyMove(s2, full); ply++; if (full.swap !== undefined) swaps++;
      assert.strictEqual(material(s2.board, mover), afterBase, 'swap changed material');
      if (!full.promo) assert.strictEqual(afterBase, before);
      assert.ok(!E.inCheck(s2, mover), 'mover in check after swap');
      assert.strictEqual(s2.board.filter((p) => p === 'wK').length, 1); assert.strictEqual(s2.board.filter((p) => p === 'bK').length, 1);
      out = E.outcome(s2);
    }
    over[out.over || 'cap'] = (over[out.over || 'cap'] || 0) + 1;
  }
  assert.ok(swaps > 1000);
  console.log('classic + random-swap tests passed; swaps in playouts:', swaps, JSON.stringify(over));
})();

// ---------- cylinder chess ----------
(function () {
  const sq = (n) => 'abcdefgh'.indexOf(n[0]) + (Number(n[1]) - 1) * 8;
  const names = (st, list) => list.map((i) => E.sqName(st, i)).sort().join(' ');
  function pos(pieces, turn, extra) {
    const st = E.newState('cylinder'); st.board.fill('');
    for (const [n, p] of Object.entries(pieces)) st.board[sq(n)] = p;
    st.turn = turn; st.cr = []; st.ep = -1; st.keys = []; return Object.assign(st, extra || {});
  }
  const dests = (st, from) => names(st, E.legalMoves(st, sq(from)).map((m) => m.to));

  assert.strictEqual(E.legalMoves(E.newState('cylinder')).length, 20);
  // Rook on an empty rank reaches every other square of it once, never its own square
  let st = pos({ a4: 'wR', e1: 'wK', e8: 'bK' }, 'w');
  assert.strictEqual(dests(st, 'a4'), 'a1 a2 a3 a5 a6 a7 a8 b4 c4 d4 e4 f4 g4 h4');
  // Blocked one way round, open the other; captures across the edge
  st = pos({ a4: 'wR', h4: 'wN', c4: 'bP', e1: 'wK', e8: 'bK' }, 'w');
  assert.strictEqual(dests(st, 'a4'), 'a1 a2 a3 a5 a6 a7 a8 b4 c4');
  st = pos({ a4: 'wR', h4: 'bN', b4: 'wP', e1: 'wK', e8: 'bK' }, 'w');
  assert.strictEqual(dests(st, 'a4'), 'a1 a2 a3 a5 a6 a7 a8 h4');
  // Bishop, knight and king cross the edge
  st = pos({ h1: 'wB', e1: 'wK', e8: 'bK' }, 'w');
  assert.strictEqual(dests(st, 'h1'), 'a2 a8 b3 b7 c4 c6 d5 e4 e6 f3 f7 g2 g8');   // both diagonals, d5 reached both ways
  st = pos({ h1: 'wN', e1: 'wK', e8: 'bK' }, 'w');
  assert.strictEqual(dests(st, 'h1'), 'a3 b2 f2 g3');
  st = pos({ h1: 'wK', e8: 'bK' }, 'w');
  assert.strictEqual(dests(st, 'h1'), 'a1 a2 g1 g2 h2');
  // Pawn captures and en passant across the edge
  st = pos({ h4: 'wP', a5: 'bN', e1: 'wK', e8: 'bK' }, 'w');
  assert.strictEqual(dests(st, 'h4'), 'a5 h5');
  st = pos({ h5: 'wP', a7: 'bP', e1: 'wK', e8: 'bK' }, 'b');
  st = E.applyMove(st, E.findLegal(st, { from: sq('a7'), to: sq('a5') }));
  assert.strictEqual(st.ep, sq('a6')); assert.strictEqual(dests(st, 'h5'), 'a6 h6');
  const ep = E.findLegal(st, { from: sq('h5'), to: sq('a6') });
  assert.strictEqual(E.moveLabel(st, ep), 'h5xa6');
  let a = E.applyMove(st, ep);
  assert.strictEqual(a.board[sq('a6')], 'wP'); assert.strictEqual(a.board[sq('a5')], ''); assert.strictEqual(a.board[sq('h5')], '');
  // Check and mate through the edge
  st = pos({ a8: 'bK', g8: 'wR', e1: 'wK' }, 'b');
  assert.strictEqual(E.outcome(st).check, true);
  st = pos({ a8: 'bK', g8: 'wR', h8: 'bN', e1: 'wK' }, 'b');   // blocked through the edge, but open the long way round
  assert.strictEqual(E.outcome(st).check, true);
  st = pos({ a8: 'bK', g8: 'wR', h8: 'bN', c8: 'bN', e1: 'wK' }, 'b');
  assert.strictEqual(E.outcome(st).check, false);
  st = pos({ h8: 'bK', a7: 'wQ', a6: 'wK' }, 'b');      // queen next door through the edge, guarded by the king
  assert.strictEqual(E.outcome(st).check, true); assert.strictEqual(E.outcome(st).over, null);   // Kg8 still escapes
  st = pos({ a8: 'bK', c7: 'wR', d8: 'wR', e1: 'wK' }, 'b');   // rank 8 covered both ways, rank 7 covered all round
  assert.strictEqual(E.outcome(st).over, 'checkmate');
  // The same position on a flat board has the same result here, but a flat-board mate that relies on the edge fails:
  st = pos({ a8: 'bK', b6: 'wK', h8: 'wR' }, 'b');             // flat board: mate. Cylinder: rook is adjacent, Kxh8
  assert.strictEqual(E.outcome(st).over, null); assert.ok(E.findLegal(st, { from: sq('a8'), to: sq('h8') }));
  // Castling works as usual
  st = pos({ e1: 'wK', a1: 'wR', h1: 'wR', e8: 'bK' }, 'w', { cr: [0, 7] });
  assert.strictEqual(E.castleMoves(st).length, 2);
  // Flat variants are untouched
  st = E.newState('classic'); st.board.fill(''); st.board[sq('a4')] = 'wR'; st.board[sq('e1')] = 'wK'; st.board[sq('e8')] = 'bK'; st.cr = [];
  assert.strictEqual(E.legalMoves(st, sq('a4')).length, 14);
  assert.ok(!E.legalMoves(st, sq('e1')).some((m) => m.to % 8 === 0));

  let seed = 99, cross = 0; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  for (let g = 0; g < 40; g++) {
    let s2 = E.newState('cylinder'), ply = 0, out = E.outcome(s2);
    while (!out.over && ply < 200) {
      const mv = E.legalMoves(s2);
      assert.strictEqual(new Set(mv.map((m) => m.from + '-' + m.to + (m.promo || ''))).size, mv.length, 'duplicate move');
      const pick = mv[Math.floor(rnd() * mv.length)];
      assert.ok(pick.from !== pick.to); assert.ok(E.findLegal(s2, pick)); E.moveLabel(s2, pick);
      if (Math.abs((pick.from % 8) - (pick.to % 8)) > 4) cross++;
      const mover = s2.turn; s2 = E.applyMove(s2, pick); ply++;
      assert.ok(!E.inCheck(s2, mover));
      assert.strictEqual(s2.board.filter((p) => p === 'wK').length, 1); assert.strictEqual(s2.board.filter((p) => p === 'bK').length, 1);
      out = E.outcome(s2);
    }
  }
  assert.ok(cross > 100);
  console.log('cylinder tests passed; edge-crossing moves in playouts:', cross);
})();

// ---------- 8x7 ----------
(function () {
  const sq = (n) => 'abcdefgh'.indexOf(n[0]) + (Number(n[1]) - 1) * 8;
  const play = (st, a, b, extra) => E.applyMove(st, E.findLegal(st, { from: sq(a), to: sq(b), ...extra }));
  const dests = (st, from) => E.legalMoves(st, sq(from)).map((m) => E.sqName(st, m.to)).sort().join(' ');
  let st = E.newState('short');
  assert.strictEqual(st.board.length, 56);
  assert.strictEqual(st.board[sq('e6')], 'bP'); assert.strictEqual(st.board[sq('e7')], 'bK'); assert.strictEqual(st.board[sq('d7')], 'bQ');
  assert.deepStrictEqual(st.cr, [0, 7, 48, 55]);
  assert.strictEqual(E.legalMoves(st).length, 20);
  assert.strictEqual(dests(st, 'e2'), 'e3 e4');
  // Both sides double-step onto rank 4: the first pawn there blocks the other's double step
  st = play(st, 'e2', 'e4');
  assert.strictEqual(dests(st, 'e6'), 'e5'); assert.strictEqual(dests(st, 'd6'), 'd4 d5');
  // ...and a double step that lands beside an enemy pawn can be taken en passant
  st = play(st, 'd6', 'd4');
  assert.strictEqual(st.ep, sq('d5')); assert.strictEqual(dests(st, 'e4'), 'd5 e5');
  let a = play(st, 'e4', 'd5');
  assert.strictEqual(a.board[sq('d5')], 'wP'); assert.strictEqual(a.board[sq('d4')], '');
  // The right lapses after one move
  a = play(play(st, 'a2', 'a3'), 'a6', 'a5');
  assert.strictEqual(dests(a, 'e4'), 'e5');
  // Promotion on rank 7 for White and rank 1 for Black; castling as usual
  st = E.newState('short'); st.board.fill(''); st.cr = [];
  Object.entries({ a6: 'wP', e1: 'wK', h7: 'bK', h2: 'bP' }).forEach(([n, p]) => { st.board[sq(n)] = p; });
  assert.deepStrictEqual(E.legalMoves(st, sq('a6')).map((m) => m.promo).sort(), ['B', 'N', 'Q', 'R']);
  st.turn = 'b';
  assert.deepStrictEqual(E.legalMoves(st, sq('h2')).map((m) => m.promo).sort(), ['B', 'N', 'Q', 'R']);
  st = E.newState('short'); st.board.fill(''); st.cr = [0, 7, 48, 55];
  Object.entries({ a1: 'wR', e1: 'wK', h1: 'wR', a7: 'bR', e7: 'bK', h7: 'bR' }).forEach(([n, p]) => { st.board[sq(n)] = p; });
  assert.strictEqual(E.castleMoves(st).length, 2); st.turn = 'b'; assert.strictEqual(E.castleMoves(st).length, 2);

  let seed = 31337; const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff; const over = {};
  for (let g = 0; g < 60; g++) {
    let s2 = E.newState('short'), ply = 0, out = E.outcome(s2);
    while (!out.over && ply < 200) {
      const mv = E.legalMoves(s2); const pick = mv[Math.floor(rnd() * mv.length)];
      assert.ok(E.findLegal(s2, pick)); E.moveLabel(s2, pick);
      const mover = s2.turn; s2 = E.applyMove(s2, pick); ply++;
      assert.ok(!E.inCheck(s2, mover));
      assert.strictEqual(s2.board.filter((p) => p === 'wK').length, 1); assert.strictEqual(s2.board.filter((p) => p === 'bK').length, 1);
      assert.ok(!s2.board.slice(48).includes('wP') && !s2.board.slice(0, 8).includes('bP'), 'unpromoted pawn');
      out = E.outcome(s2);
    }
    over[out.over || 'cap'] = (over[out.over || 'cap'] || 0) + 1;
  }
  console.log('8x7 tests passed', JSON.stringify(over));
})();
