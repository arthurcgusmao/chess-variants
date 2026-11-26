/* Piece artwork, drawn as inline SVG so it looks the same on every phone and OS. */
const BASE = '<path d="M11 39.5h23v-3.5h-23z"/>';
const SHAPE = {
  P: '<circle cx="22.5" cy="13" r="5.5"/><path d="M22.5 18C17 22 15 29 13 36h19c-2-7-4-14-9.5-18z"/>',
  R: '<path d="M12 36v-3h2l1.5-15H13V9h4v3h3.5V9h4v3H28V9h4v9h-2.5L31 33h2v3z"/>',
  N: '<path d="M13 36c0-8 4-11 6-15-3 1-6 3-8 2-1-2 1-6 4-9l1-5 4 3c7-1 13 5 13 15v9z"/><circle class="d" cx="17.5" cy="16.5" r="1.1"/>',
  B: '<circle cx="22.5" cy="6.5" r="2.2"/><path d="M22.5 9c-5.5 6-7 10.5-7 14.5 0 3.5 2.5 5.5 3.5 6.5l-3 6h13l-3-6c1-1 3.5-3 3.5-6.5 0-4-1.5-8.5-7-14.5z"/><path class="d" d="M22.5 15.5l3 5.5"/>',
  Q: '<path d="M9 14l5 16h17l5-16-7 10-2.5-13-4 12-4-12L16 24z"/><path d="M14 30l-1 6h19l-1-6z"/><circle cx="9" cy="13" r="2"/><circle cx="18.5" cy="10" r="2"/><circle cx="26.5" cy="10" r="2"/><circle cx="36" cy="13" r="2"/>',
  K: '<path class="x" d="M22.5 4.5V13M19 8h7"/><path d="M22.5 13c-4.5 0-6.5 4-5 8-4.5-4-9.5-1-8.5 5 .5 4 4 5 5 10h17c1-5 4.5-6 5-10 1-6-4-9-8.5-5 1.5-4-.5-8-5-8z"/>',
};

export const PIECE_NAME = { K: 'king', Q: 'queen', R: 'rook', B: 'bishop', N: 'knight', P: 'pawn' };
export const COLOR_NAME = { w: 'White', b: 'Black' };

/* A <span> holding the drawing for one piece; colour is 'w' or 'b', type one of KQRBNP. */
export function pieceEl(color, type) {
  const el = document.createElement('span');
  el.className = 'pc ' + color;
  el.innerHTML = '<svg viewBox="0 0 45 45" aria-hidden="true">' + SHAPE[type] + BASE + '</svg>';
  return el;
}
