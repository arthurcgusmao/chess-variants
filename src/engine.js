'use strict';
/* ---------- Rules engine: pure functions, no DOM. Board-size agnostic. ----------
   Add a variant by adding an entry here. `back` is White's back rank from the
   a-file; Black mirrors it. All variants: pawns move one step, no en passant.
   Castling is a per-game option (see castleMoves). */
const VARIANTS = {
  losalamos: { name: 'Los Alamos 6×6', blurb: 'No bishops', cols: 6, rows: 6, back: 'RNQKNR', promo: ['Q', 'R', 'N'] },
  norooks:   { name: 'Mini 6×6', blurb: 'No rooks', cols: 6, rows: 6, back: 'NBQKBN', promo: ['Q', 'B', 'N'] },
  gardner:   { name: 'Gardner 5×5', blurb: 'All piece types', cols: 5, rows: 5, back: 'RNBQK', promo: ['Q', 'R', 'B', 'N'] },
};

const ORTHO = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const DIAG = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
const JUMPS = [[1, 2], [2, 1], [-1, 2], [-2, 1], [1, -2], [2, -1], [-1, -2], [-2, -1]];
const other = (c) => (c === 'w' ? 'b' : 'w');

function posKey(s) { return s.board.join(',') + s.turn + s.cr.join('.'); }

/* opts.castling: allow castling. s.cr lists the rook squares that still have the right. */
function newState(vk, opts) {
  const v = VARIANTS[vk];
  const b = new Array(v.cols * v.rows).fill('');
  for (let c = 0; c < v.cols; c++) {
    b[c] = 'w' + v.back[c];
    b[v.cols + c] = 'wP';
    b[(v.rows - 2) * v.cols + c] = 'bP';
    b[(v.rows - 1) * v.cols + c] = 'b' + v.back[c];
  }
  const castling = !!(opts && opts.castling);
  const cr = [];
  if (castling) for (let i = 0; i < b.length; i++) if (b[i] && b[i][1] === 'R') cr.push(i);
  const s = { vk, cols: v.cols, rows: v.rows, board: b, turn: 'w', keys: [], castling, cr };
  s.keys.push(posKey(s));
  return s;
}

/* Squares a piece on `from` attacks (regardless of what stands there). */
function attacks(s, from) {
  const p = s.board[from]; const out = [];
  if (!p) return out;
  const col = p[0], t = p[1];
  const r = Math.floor(from / s.cols), c = from % s.cols;
  const inside = (rr, cc) => rr >= 0 && rr < s.rows && cc >= 0 && cc < s.cols;
  const step = (list) => { for (const [dr, dc] of list) if (inside(r + dr, c + dc)) out.push((r + dr) * s.cols + c + dc); };
  const slide = (list) => {
    for (const [dr, dc] of list) {
      let rr = r + dr, cc = c + dc;
      while (inside(rr, cc)) { out.push(rr * s.cols + cc); if (s.board[rr * s.cols + cc]) break; rr += dr; cc += dc; }
    }
  };
  if (t === 'P') { const d = col === 'w' ? 1 : -1; step([[d, 1], [d, -1]]); }
  else if (t === 'N') step(JUMPS);
  else if (t === 'K') step(ORTHO.concat(DIAG));
  else if (t === 'R') slide(ORTHO);
  else if (t === 'B') slide(DIAG);
  else if (t === 'Q') slide(ORTHO.concat(DIAG));
  return out;
}

function isAttacked(s, sq, by) {
  for (let i = 0; i < s.board.length; i++) {
    if (s.board[i] && s.board[i][0] === by && attacks(s, i).includes(sq)) return true;
  }
  return false;
}

function inCheck(s, color) {
  const k = s.board.indexOf(color + 'K');
  return k >= 0 && isAttacked(s, k, other(color));
}

function pseudoMoves(s, from) {
  const p = s.board[from]; const out = [];
  if (!p) return out;
  const col = p[0], t = p[1];
  if (t !== 'P') {
    for (const to of attacks(s, from)) if (!s.board[to] || s.board[to][0] !== col) out.push({ from, to });
    return out;
  }
  const d = col === 'w' ? 1 : -1;
  const r = Math.floor(from / s.cols);
  const lastRank = col === 'w' ? s.rows - 1 : 0;
  const targets = [];
  const fwd = from + d * s.cols;
  if (fwd >= 0 && fwd < s.board.length && !s.board[fwd]) targets.push(fwd);
  for (const to of attacks(s, from)) if (s.board[to] && s.board[to][0] !== col) targets.push(to);
  for (const to of targets) {
    if (r + d === lastRank) for (const promo of VARIANTS[s.vk].promo) out.push({ from, to, promo });
    else out.push({ from, to });
  }
  return out;
}

/* Returns a new state; does not check legality. */
function applyMove(s, m) {
  const b = s.board.slice();
  const p = b[m.from];
  let cr = s.cr;
  if (m.castle !== undefined) {
    const rook = b[m.castle];
    b[m.from] = ''; b[m.castle] = '';
    b[m.to] = p; b[m.from + Math.sign(m.to - m.from)] = rook;
  } else {
    b[m.to] = m.promo ? p[0] + m.promo : p;
    b[m.from] = '';
  }
  if (cr.length) {
    // A right is lost when its rook moves or is captured, or when that side's king moves.
    const homeRow = p[1] === 'K' ? (p[0] === 'w' ? 0 : s.rows - 1) : -1;
    cr = cr.filter((r) => r !== m.from && r !== m.to && Math.floor(r / s.cols) !== homeRow);
  }
  const n = { vk: s.vk, cols: s.cols, rows: s.rows, board: b, turn: other(s.turn), keys: s.keys.slice(), castling: s.castling, cr };
  n.keys.push(posKey(n));
  return n;
}

/* Castling, generalised to any board width: the king moves two squares toward a rook and
   that rook lands on the square the king crossed. Needs: neither piece has moved, every
   square between them is empty, the king is not in check, and it neither crosses nor
   lands on an attacked square. On 6x6 Los Alamos (king on d): short = Kd1-f1 + Rf1-e1,
   long = Kd1-b1 + Ra1-c1. */
function castleMoves(s) {
  const out = [];
  if (!s.castling || !s.cr.length) return out;
  const me = s.turn, foe = other(me);
  const k = s.board.indexOf(me + 'K');
  if (k < 0 || isAttacked(s, k, foe)) return out;
  const row = Math.floor(k / s.cols), kc = k % s.cols;
  for (const r of s.cr) {
    if (Math.floor(r / s.cols) !== row || s.board[r] !== me + 'R') continue;
    const dir = Math.sign(r - k), tc = kc + 2 * dir;
    if (tc < 0 || tc >= s.cols) continue;
    const kt = k + 2 * dir, rt = k + dir;
    let clear = true;
    for (let q = k + dir; q !== r; q += dir) if (s.board[q]) clear = false;
    for (const q of [kt, rt]) if (q !== k && q !== r && s.board[q]) clear = false;
    if (!clear) continue;
    const lifted = { cols: s.cols, rows: s.rows, board: s.board.slice() };
    lifted.board[k] = '';
    if (isAttacked(lifted, rt, foe)) continue;
    const m = { from: k, to: kt, castle: r };
    if (!inCheck(applyMove(s, m), me)) out.push(m);
  }
  return out;
}

function legalMoves(s, onlyFrom) {
  const out = [];
  for (let i = 0; i < s.board.length; i++) {
    if (onlyFrom !== undefined && i !== onlyFrom) continue;
    if (!s.board[i] || s.board[i][0] !== s.turn) continue;
    for (const m of pseudoMoves(s, i)) if (!inCheck(applyMove(s, m), s.turn)) out.push(m);
  }
  for (const m of castleMoves(s)) if (onlyFrom === undefined || onlyFrom === m.from) out.push(m);
  return out;
}

function findLegal(s, m) {
  if (!m || typeof m.from !== 'number' || typeof m.to !== 'number') return null;
  return legalMoves(s, m.from).find((x) => x.to === m.to && (x.promo || null) === (m.promo || null)) || null;
}

function insufficient(s) {
  const rest = s.board.filter((p) => p && p[1] !== 'K');
  return rest.length === 0 || (rest.length === 1 && (rest[0][1] === 'N' || rest[0][1] === 'B'));
}

/* { check, over: null|'checkmate'|'stalemate'|'material'|'repetition', winner: 'w'|'b'|null } */
function outcome(s) {
  const check = inCheck(s, s.turn);
  if (legalMoves(s).length === 0) {
    return check ? { check, over: 'checkmate', winner: other(s.turn) } : { check, over: 'stalemate', winner: null };
  }
  if (insufficient(s)) return { check, over: 'material', winner: null };
  const last = s.keys[s.keys.length - 1];
  if (s.keys.filter((k) => k === last).length >= 3) return { check, over: 'repetition', winner: null };
  return { check, over: null, winner: null };
}

function sqName(s, i) { return 'abcdefghij'[i % s.cols] + (Math.floor(i / s.cols) + 1); }

/* Long notation for a legal move, e.g. Nb1-c3, a5xb6=Q+ */
function moveLabel(s, m) {
  const p = s.board[m.from];
  let t = m.castle !== undefined ? (m.to > m.from ? 'O-O' : 'O-O-O')
    : (p[1] === 'P' ? '' : p[1]) + sqName(s, m.from) + (s.board[m.to] ? 'x' : '-') + sqName(s, m.to);
  if (m.promo) t += '=' + m.promo;
  const o = outcome(applyMove(s, m));
  if (o.over === 'checkmate') t += '#'; else if (o.check) t += '+';
  return t;
}

if (typeof module !== 'undefined') {
  module.exports = { VARIANTS, newState, castleMoves, legalMoves, findLegal, applyMove, outcome, inCheck, moveLabel, sqName, other };
}
