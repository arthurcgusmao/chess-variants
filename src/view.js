/* Draws the game screen from a Game plus the bits of state that are only about this
   screen (`ui`: selected square, pending promotion, how far a cylinder board is turned).
   Rendering is a full redraw; nothing here changes the game. */
import { sqName, other } from './engine.js';
import { pieceEl, PIECE_NAME, COLOR_NAME } from './pieces.js';
import { formatClock, timeLabel } from './clock.js';

const $ = (id) => document.getElementById(id);
const FILES = 'abcdefghij';

const LINK_TEXT = {
  connected: ['ok', 'Connected'],
  waiting: ['wait', 'Waiting for opponent'],
  nohost: ['wait', 'Host is not online — retrying'],
  lost: ['wait', 'Connection lost — retrying'],
  taken: ['wait', 'Room open in another tab — retrying'],
  error: ['bad', 'Network problem — retrying'],
};

function statusText(game, result) {
  const me = game.myColor, turn = game.state.turn;
  switch (result.over) {
    case 'checkmate': return 'Checkmate — ' + COLOR_NAME[result.winner] + ' wins';
    case 'time': return COLOR_NAME[other(result.winner)] + ' ran out of time — ' + COLOR_NAME[result.winner] + ' wins';
    case 'resign': return COLOR_NAME[other(result.winner)] + ' resigned — ' + COLOR_NAME[result.winner] + ' wins';
    case 'stalemate': return 'Draw — stalemate';
    case 'material': return 'Draw — not enough material';
    case 'repetition': return 'Draw — position repeated three times';
  }
  if (me && !game.connected) return game.moves.length ? 'Paused — waiting for connection' : 'Waiting for opponent to join';
  const who = me ? (turn === me ? 'Your move' : 'Opponent’s move') : COLOR_NAME[turn] + ' to move';
  return who + (result.check ? ' — check' : '');
}

function renderLink(game) {
  const pill = $('link');
  pill.hidden = !game.online;
  if (!game.online) return;
  const [cls, text] = LINK_TEXT[game.link] || ['wait', game.mode === 'host' ? 'Opening room…' : 'Connecting…'];
  pill.className = 'pill ' + cls;
  pill.textContent = text;
}

function corner(cls, text) {
  const el = document.createElement('i');
  el.className = cls; el.textContent = text;
  return el;
}

function renderBoard(game, ui, result) {
  const s = game.state, last = game.lastMove;
  const flip = game.myColor === 'b';
  const turned = game.variant.wrap ? ui.rot : 0;
  const targets = ui.sel === null ? [] : game.movesFrom(ui.sel).map((m) => m.to);
  const checked = result.check || result.over === 'checkmate' ? s.board.indexOf(s.turn + 'K') : -1;

  const board = $('board');
  board.style.setProperty('--cols', s.cols);
  board.style.setProperty('--rows', s.rows);
  board.textContent = '';
  for (let vr = 0; vr < s.rows; vr++) {
    for (let vc = 0; vc < s.cols; vc++) {
      // screen position -> board square: Black sees the board from the other side, and a
      // cylinder board can be turned by `ui.rot` files
      const row = flip ? vr : s.rows - 1 - vr;
      const col = ((flip ? s.cols - 1 - vc : vc) + turned + s.cols) % s.cols;
      const i = row * s.cols + col, piece = s.board[i];
      const sq = document.createElement('button');
      sq.type = 'button';
      sq.dataset.sq = i;
      sq.className = 'sq ' + ((row + col) % 2 === 0 ? 'dark' : 'light');
      if (i === ui.sel) sq.classList.add('sel');
      if (last && (i === last.from || i === last.to)) sq.classList.add('last');
      if (last && last.swap !== undefined && (i === last.swap || i === last.to)) sq.classList.add('swap');
      if (i === checked) sq.classList.add('check');
      if (targets.includes(i)) sq.classList.add(piece ? 'capture' : 'target');
      sq.setAttribute('aria-label', sqName(s, i) + (piece ? ' ' + COLOR_NAME[piece[0]] + ' ' + PIECE_NAME[piece[1]] : ''));
      if (piece) sq.appendChild(pieceEl(piece[0], piece[1]));
      if (vc === 0) sq.appendChild(corner('rk', row + 1));
      if (vr === s.rows - 1) sq.appendChild(corner('fl', FILES[col]));
      board.appendChild(sq);
    }
  }
}

function renderSwapNote(game) {
  const s = game.state, last = game.lastMove;
  const note = $('note');
  note.hidden = !(last && last.swap !== undefined);
  if (note.hidden) return;
  note.textContent = 'Swapped: ' + sqName(s, last.to) + ' is now a ' + PIECE_NAME[s.board[last.to][1]] +
    ', ' + sqName(s, last.swap) + ' is now a ' + PIECE_NAME[s.board[last.swap][1]] + '.';
}

function renderPromotion(game, ui) {
  const box = $('promo');
  box.hidden = !ui.promo;
  box.textContent = '';
  if (!ui.promo) return;
  for (const type of game.variant.promo) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'sq light'; b.dataset.promo = type;
    b.setAttribute('aria-label', 'Promote to ' + PIECE_NAME[type]);
    b.appendChild(pieceEl(game.state.turn, type));
    box.appendChild(b);
  }
}

function renderMoveList(game) {
  const list = $('moves');
  list.textContent = '';
  for (let i = 0; i < game.labels.length; i += 2) {
    const li = document.createElement('li');
    li.textContent = game.labels[i] + (game.labels[i + 1] ? '  ' + game.labels[i + 1] : '');
    list.appendChild(li);
  }
  list.scrollTop = list.scrollHeight;
}

const LOW_TIME_MS = 20000;

/* The two clocks: the opponent's above the board, this player's below (White below when
   both sides share a device). Cheap enough to call several times a second. */
export function renderClocks(game, now = Date.now()) {
  const show = game.timed && !!game.state;
  $('game').classList.toggle('has-clock', show);
  const bottom = game.myColor || 'w';
  for (const [id, color] of [['clock-top', other(bottom)], ['clock-bottom', bottom]]) {
    const el = $(id);
    el.hidden = !show;
    if (!show) continue;
    const left = game.remaining(color, now);
    const running = game.turnStart !== null && game.state.turn === color;
    el.className = 'clock' + (running ? ' running' : '') + (left < LOW_TIME_MS ? ' low' : '');
    el.querySelector('.who').textContent = COLOR_NAME[color] + (color === game.myColor ? ' (you)' : '');
    el.querySelector('.time').textContent = formatClock(left);
  }
}

export function render(game, ui) {
  renderLink(game);
  renderClocks(game);
  if (!game.state) { $('status').textContent = 'Joining game…'; return; }
  const result = game.result(), me = game.myColor;
  const playable = !game.online || game.connected;

  $('status').textContent = statusText(game, result);
  $('variant').textContent = game.variant.name + (game.opts.castling ? ' · castling' : '') +
    (game.timed ? ' · ' + timeLabel(game.opts) : '') +
    (me ? ' · you are ' + COLOR_NAME[me] : ' · one device');
  renderSwapNote(game);
  renderBoard(game, ui, result);
  renderPromotion(game, ui);
  renderMoveList(game);

  $('turn').hidden = !game.variant.wrap;
  $('invite').hidden = !(game.mode === 'host' && !game.connected);
  $('resign').hidden = !!result.over || !playable;
  $('rematch').hidden = !result.over || !playable;
}

export function showGameScreen() { $('lobby').hidden = true; $('game').hidden = false; }
