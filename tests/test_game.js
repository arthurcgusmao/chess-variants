// Clock helpers and the Game's clock behaviour, in one-device mode with a fake time source.
import assert from 'node:assert';
import { formatClock, normaliseTime, newClock, readClock, timeLabel } from '../src/clock.js';
import { Game } from '../src/game.js';

assert.strictEqual(formatClock(300000), '5:00');
assert.strictEqual(formatClock(299001), '5:00'); assert.strictEqual(formatClock(299000), '4:59');
assert.strictEqual(formatClock(61000), '1:01'); assert.strictEqual(formatClock(10000), '0:10');
assert.strictEqual(formatClock(9999), '0:09.9'); assert.strictEqual(formatClock(7340), '0:07.3'); assert.strictEqual(formatClock(40), '0:00.0');
assert.strictEqual(formatClock(0), '0:00'); assert.strictEqual(formatClock(-500), '0:00');
assert.strictEqual(formatClock(3600000), '1:00:00'); assert.strictEqual(formatClock(3725000), '1:02:05');
assert.deepStrictEqual(normaliseTime({ minutes: 5, increment: 2 }), { minutes: 5, increment: 2 });
assert.deepStrictEqual(normaliseTime({}), { minutes: 0, increment: 0 });
assert.deepStrictEqual(normaliseTime(undefined), { minutes: 0, increment: 0 });
assert.deepStrictEqual(normaliseTime({ minutes: 0, increment: 10 }), { minutes: 0, increment: 0 });
assert.deepStrictEqual(normaliseTime({ minutes: '9999', increment: -3 }), { minutes: 180, increment: 0 });
assert.deepStrictEqual(normaliseTime({ minutes: 'x', increment: 'y' }), { minutes: 0, increment: 0 });
assert.deepStrictEqual(newClock(3), { w: 180000, b: 180000 });
assert.strictEqual(readClock({ w: 1, b: 'x' }), null); assert.strictEqual(readClock(null), null); assert.strictEqual(readClock({ w: -1, b: 5 }), null);
assert.deepStrictEqual(readClock({ w: 10, b: 20, extra: 1 }), { w: 10, b: 20 });
assert.strictEqual(timeLabel({ minutes: 5, increment: 2 }), '5+2'); assert.strictEqual(timeLabel({ minutes: 0, increment: 0 }), '');

const sq = (n) => 'abcdefgh'.indexOf(n[0]) + (Number(n[1]) - 1) * 8;
function localGame(opts) {
  const changes = [];
  const g = new Game((kind) => changes.push(kind));
  let t = 1000000; g.now = () => t; g.advance = (ms) => { t += ms; };
  g.startLocal('classic', opts); g.changes = changes;
  return g;
}
const play = (g, a, b) => g.play({ from: sq(a), to: sq(b) });

// 5 minutes + 2 seconds
let g = localGame({ minutes: 5, increment: 2 });
assert.ok(g.timed); assert.deepStrictEqual(g.clock, { w: 300000, b: 300000 }); assert.strictEqual(g.turnStart, null);
g.advance(30000); assert.strictEqual(g.tick(), false);
assert.strictEqual(g.remaining('w'), 300000, 'nothing runs before the first move');
assert.ok(play(g, 'e2', 'e4'));
assert.strictEqual(g.clock.w, 300000, 'the first move is free and earns no increment'); assert.notStrictEqual(g.turnStart, null);
g.advance(10000);
assert.strictEqual(g.remaining('b'), 290000); assert.strictEqual(g.remaining('w'), 300000);
assert.ok(play(g, 'e7', 'e5')); assert.strictEqual(g.clock.b, 292000);
g.advance(4000); assert.ok(play(g, 'g1', 'f3')); assert.strictEqual(g.clock.w, 298000);
assert.ok(!play(g, 'a2', 'a3'), 'not White’s turn');
// Black lets the clock run out: tick notices
g.advance(291999); assert.strictEqual(g.tick(), false); assert.strictEqual(g.result().over, null);
g.advance(1); assert.strictEqual(g.tick(), true);
assert.deepStrictEqual(g.result(), { over: 'time', winner: 'w', check: false });
assert.strictEqual(g.flagged, 'b'); assert.strictEqual(g.clock.b, 0); assert.strictEqual(g.turnStart, null);
assert.ok(!g.canMove()); assert.ok(!play(g, 'b8', 'c6')); assert.strictEqual(g.tick(), false);
// Rematch resets everything
g.rematch();
assert.deepStrictEqual(g.clock, { w: 300000, b: 300000 }); assert.strictEqual(g.flagged, null); assert.strictEqual(g.result().over, null);
assert.strictEqual(g.moves.length, 0); assert.strictEqual(g.turnStart, null);

// A move attempted after the time is gone loses on time instead
g = localGame({ minutes: 1, increment: 0 });
play(g, 'e2', 'e4'); g.advance(60001);
assert.ok(!play(g, 'e7', 'e5')); assert.strictEqual(g.flagged, 'b'); assert.strictEqual(g.moves.length, 1);

// Resigning stops the clock and keeps the time used
g = localGame({ minutes: 1, increment: 0 });
play(g, 'e2', 'e4'); g.advance(5000); g.resign();
assert.strictEqual(g.turnStart, null); assert.strictEqual(g.clock.b, 55000); assert.strictEqual(g.result().over, 'resign');
g.advance(100000); assert.strictEqual(g.tick(), false); assert.strictEqual(g.result().over, 'resign');

// Checkmate stops the clock (fool's mate)
g = localGame({ minutes: 1, increment: 5 });
play(g, 'f2', 'f3'); play(g, 'e7', 'e5'); play(g, 'g2', 'g4'); play(g, 'd8', 'h4');
assert.strictEqual(g.result().over, 'checkmate'); assert.strictEqual(g.turnStart, null);
g.advance(999999); assert.strictEqual(g.tick(), false); assert.strictEqual(g.result().over, 'checkmate');

// No clock: nothing ticks, moves work as before
g = localGame({});
assert.ok(!g.timed); play(g, 'e2', 'e4'); g.advance(1e9);
assert.strictEqual(g.tick(), false); assert.strictEqual(g.turnStart, null); assert.ok(play(g, 'e7', 'e5'));
assert.deepStrictEqual(g.opts, { castling: false, minutes: 0, increment: 0 });

console.log('clock + game tests passed');
