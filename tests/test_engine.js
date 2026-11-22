const E = require('../src/engine.js');
const assert = require('assert');

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
for (const vk of Object.keys(E.VARIANTS)) {
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
