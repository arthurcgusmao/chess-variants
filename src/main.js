/* Entry point: wires the lobby and the board's controls to a Game and redraws on change.
   Which variants a page offers comes from <body data-variants="..."> (set by build.py). */
import { VARIANTS } from './variants.js';
import { Game } from './game.js';
import { CLOCK_MINUTES, CLOCK_INCREMENTS } from './clock.js';
import { render, renderClocks, showGameScreen } from './view.js';

const $ = (id) => document.getElementById(id);
const pageUrl = () => location.href.split(/[?#]/)[0];

// State that is only about this screen, not about the game.
const ui = {
  sel: null,     // selected square
  promo: null,   // { from, to } while the player picks a promotion piece
  rot: 0,        // cylinder boards: how many files the view is turned
};

const game = new Game((kind) => {
  if (kind === 'position') { ui.sel = null; ui.promo = null; }
  render(game, ui);
});
window.__game = game;   // for debugging in the console, and for tests/test_ui.py

// Keeps the clocks moving. A flag fall changes the game, which triggers a full redraw by itself.
setInterval(() => { if (game.timed && !game.tick()) renderClocks(game); }, 200);

/* ---------- board ---------- */
function onSquare(i) {
  if (!game.canMove()) return;
  const s = game.state;
  if (ui.sel !== null) {
    const options = game.movesFrom(ui.sel).filter((m) => m.to === i);
    if (options.length === 1 && !options[0].promo) { game.play(options[0]); return; }
    if (options.length) { ui.promo = { from: ui.sel, to: i }; render(game, ui); return; }   // several = promotion choices
  }
  ui.promo = null;
  ui.sel = s.board[i] && s.board[i][0] === s.turn && i !== ui.sel ? i : null;
  render(game, ui);
}

$('board').addEventListener('click', (e) => {
  const sq = e.target.closest('[data-sq]');
  if (sq) onSquare(Number(sq.dataset.sq));
});

$('promo').addEventListener('click', (e) => {
  const b = e.target.closest('[data-promo]');
  if (b && ui.promo) game.play({ ...ui.promo, promo: b.dataset.promo });
});

// Cylinder boards: turn the view so the joined edge can sit anywhere. Purely visual.
function turnBoard(files) {
  if (!game.state) return;
  const dir = game.myColor === 'b' ? -files : files;
  ui.rot = (ui.rot + dir + game.state.cols) % game.state.cols;
  render(game, ui);
}
$('turn-left').addEventListener('click', () => turnBoard(-1));
$('turn-right').addEventListener('click', () => turnBoard(1));

/* ---------- game controls ---------- */
$('resign').addEventListener('click', (e) => {
  const btn = e.currentTarget;
  if (btn.dataset.armed !== '1') {          // two taps to confirm, instead of a blocking dialog
    btn.dataset.armed = '1'; btn.textContent = 'Tap again to resign';
    setTimeout(() => { btn.dataset.armed = ''; btn.textContent = 'Resign'; }, 3000);
    return;
  }
  btn.dataset.armed = ''; btn.textContent = 'Resign';
  game.resign();
});

$('rematch').addEventListener('click', () => game.rematch());

$('copy').addEventListener('click', async () => {
  const box = $('invite-url'), btn = $('copy');
  try { await navigator.clipboard.writeText(box.value); btn.textContent = 'Copied'; }
  catch (e) { box.focus(); box.select(); btn.textContent = 'Select & copy'; }
  setTimeout(() => { btn.textContent = 'Copy link'; }, 2000);
});

/* ---------- lobby ---------- */
const offered = (document.body.dataset.variants || '').split(',').filter((k) => VARIANTS[k]);
const variantPick = $('pick-variant');
for (const k of offered) {
  const o = document.createElement('option');
  o.value = k; o.textContent = VARIANTS[k].name + ' — ' + VARIANTS[k].blurb;
  variantPick.appendChild(o);
}
$('variant-field').hidden = offered.length < 2;

// The castling switch only applies to variants where castling is optional.
const castlingOptional = () => !!VARIANTS[variantPick.value].castlingOptional;

// Time control: minutes per player, and seconds added after each move.
const minutesPick = $('pick-minutes'), incrementPick = $('pick-increment');
for (const m of CLOCK_MINUTES) minutesPick.add(new Option(m ? m + ' min each' : 'No clock', m));
for (const s of CLOCK_INCREMENTS) incrementPick.add(new Option(s ? '+' + s + ' s per move' : 'No increment', s));

const chosenOptions = () => ({
  castling: castlingOptional() && $('opt-castling').checked,
  minutes: Number(minutesPick.value),
  increment: Number(incrementPick.value),
});
function syncOptions() {
  $('castle-field').hidden = !castlingOptional();
  $('increment-field').hidden = minutesPick.value === '0';
}
variantPick.addEventListener('change', syncOptions);
minutesPick.addEventListener('change', syncOptions);
syncOptions();

function enterRoom() {
  $('invite-url').value = pageUrl() + '?room=' + game.room;
  showGameScreen();
  render(game, ui);
}

$('create').addEventListener('click', () => {
  const pick = $('pick-color').value;
  const color = pick === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : pick;
  const room = game.createRoom(variantPick.value, chosenOptions(), color);
  // The host's own URL carries host=1; the invite link does not.
  const url = pageUrl() + '?room=' + room + '&host=1';
  try { history.pushState(null, '', url); } catch (e) { location.href = url; return; }
  game.goOnline();
  enterRoom();
});

$('local').addEventListener('click', () => {
  showGameScreen();
  game.startLocal(variantPick.value, chosenOptions());
});

/* ---------- arriving through a room link ---------- */
const query = new URLSearchParams(location.search);
const room = (query.get('room') || '').replace(/[^a-z0-9]/gi, '').slice(0, 24);
if (room) {
  game.openRoom(room, query.get('host') === '1' ? 'host' : 'guest', offered[0]);
  enterRoom();
}
