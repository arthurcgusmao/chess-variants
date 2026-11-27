/* Chess-clock helpers: the time controls on offer, and pure functions over clock values.
   A clock is { w, b }: milliseconds each side has left. Who is running, and since when,
   is the Game's business (game.js). */
export const CLOCK_MINUTES = [0, 1, 3, 5, 10, 15, 30, 60];   // 0 = no clock
export const CLOCK_INCREMENTS = [0, 1, 2, 5, 10, 30];         // seconds added after each move

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

/* Cleans up a time control from the lobby, storage or the other player. */
export function normaliseTime(opts) {
  const minutes = clamp(Math.round(Number(opts && opts.minutes) || 0), 0, 180);
  const increment = minutes ? clamp(Math.round(Number(opts && opts.increment) || 0), 0, 60) : 0;
  return { minutes, increment };
}

export function newClock(minutes) {
  return { w: minutes * 60000, b: minutes * 60000 };
}

/* A clock received from storage or the other player, or null if it is not usable. */
export function readClock(c) {
  const ok = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0;
  return c && ok(c.w) && ok(c.b) ? { w: c.w, b: c.b } : null;
}

/* '5+2' for five minutes with a two-second increment, '' for no clock. */
export function timeLabel({ minutes, increment }) {
  return minutes ? minutes + '+' + increment : '';
}

/* 4:59, 1:05:00, and tenths under ten seconds (0:07.3). */
export function formatClock(ms) {
  if (ms <= 0) return '0:00';
  if (ms < 10000) return '0:0' + (Math.floor(ms / 100) / 10).toFixed(1);
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), s = total % 60;
  const two = (n) => String(n).padStart(2, '0');
  return h ? h + ':' + two(m) + ':' + two(s) : m + ':' + two(s);
}
