/* One game between two players: the move list, whose turn it is, the clocks, and keeping
   both browsers in step. No DOM here; the view reads this object and is told when it changes.

   Both browsers run the same rules engine and exchange only moves. The host's move list is
   the source of truth when the two reconnect.

   Clocks: `clock` holds each side's time as of `turnStart`, the moment the current turn
   started counting on this device (null while the clock is stopped). Each device is the
   authority on its own player's time and reports it with every move, so network delay is
   never charged to anyone. Clocks start after the first move and stop while the two
   browsers are disconnected.

   Messages (host <-> guest):
     init    host -> guest   full game: variant, options, colours, all moves, clocks
     sync    guest -> host   "I hold more moves than you sent" (host lost its storage)
     hello   guest -> host   please send init again
     move    either          one move, its index in the game, and the clocks after it
     clock   guest -> host   the guest's own remaining time, after a reconnect
     flag    either          a player ran out of time
     resign  either
     rematch guest -> host   start the next game (the host does it and sends init) */
import { VARIANTS } from './variants.js';
import { newState, legalMoves, findBase, findLegal, swapCandidates, applyMove, outcome, moveLabel, other } from './engine.js';
import { normaliseTime, newClock, readClock } from './clock.js';
import { saveGame, loadGame } from './storage.js';
import { connect } from './net.js';

const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no look-alike characters
const FLAG_GRACE_MS = 3000;    // how far past zero the opponent's clock may look before we call it
const BANK_EVERY_MS = 5000;    // how often our own running time is written down, so a reload cannot win it back

export class Game {
  /* onChange(kind): 'position' when the board changed, 'link' when only the connection did. */
  constructor(onChange) {
    this.onChange = onChange;
    this.now = () => Date.now();   // replaceable in tests
    this.mode = null;            // 'local' | 'host' | 'guest'
    this.room = null;
    this.vk = null;              // variant key
    this.opts = this.#options({});   // chosen by whoever created the game: { castling, minutes, increment }
    this.hostColor = 'w';
    this.gameNo = 1;             // goes up with each rematch
    this.moves = [];
    this.labels = [];            // notation for each move
    this.resigned = null;        // colour that resigned, or null
    this.flagged = null;         // colour that ran out of time, or null
    this.clock = newClock(0);
    this.turnStart = null;
    this.lastBank = 0;
    this.state = null;           // engine state after all moves; null until a guest receives the game
    this.link = 'idle';          // connection status, see net.js
    this.net = null;
  }

  /* ---------- queries ---------- */
  get variant() { return VARIANTS[this.vk]; }
  get online() { return this.mode !== 'local'; }
  get connected() { return this.link === 'connected'; }
  get timed() { return this.opts.minutes > 0; }
  /* The colour this browser plays, or null when both sides share one device. */
  get myColor() { return !this.online ? null : this.mode === 'host' ? this.hostColor : other(this.hostColor); }
  get lastMove() { return this.moves[this.moves.length - 1]; }

  /* { over, winner, check }, where `over` is null or the reason the game ended. */
  result() {
    if (this.resigned) return { over: 'resign', winner: other(this.resigned), check: false };
    if (this.flagged) return { over: 'time', winner: other(this.flagged), check: false };
    return outcome(this.state);
  }

  canMove() {
    if (!this.state || this.result().over) return false;
    return !this.online || (this.connected && this.state.turn === this.myColor);
  }

  movesFrom(square) { return legalMoves(this.state, square); }

  /* Time a side has left right now, in milliseconds. */
  remaining(color, now = this.now()) {
    const running = this.turnStart !== null && this.state && this.state.turn === color;
    return this.clock[color] - (running ? now - this.turnStart : 0);
  }

  /* ---------- starting a game ---------- */
  startLocal(vk, opts) {
    this.mode = 'local';
    this.#newGame(vk, opts);
    this.onChange('position');
  }

  /* Creates a room hosted by this browser and returns its code. */
  createRoom(vk, opts, color) {
    let code = '';
    for (let i = 0; i < 8; i++) code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    this.mode = 'host'; this.room = code; this.hostColor = color; this.gameNo = 1;
    this.#newGame(vk, opts);
    this.#save();
    return code;
  }

  /* Opens a room from its link, restoring any game saved in this browser. */
  openRoom(room, role, defaultVariant) {
    this.room = room; this.mode = role;
    const saved = loadGame(room, role);
    if (saved && this.#replay(saved.vk, saved.moves, saved.opts)) {
      this.hostColor = saved.hostColor === 'b' ? 'b' : 'w';
      this.gameNo = saved.gameNo || 1;
      this.resigned = saved.resigned || null;
      this.flagged = saved.flagged || null;
      this.clock = readClock(saved.clock) || newClock(this.opts.minutes);
    } else if (role === 'host') {
      this.#newGame(defaultVariant, {});
    }
    this.goOnline();
  }

  goOnline() {
    if (this.net) this.net.close();
    this.net = connect({
      room: this.room,
      role: this.mode,
      onStatus: (s) => this.#onLink(s),
      onOpen: () => this.#sendInit(),
      onMessage: (d) => this.#receive(d),
      // The room id is held elsewhere. With no record of hosting it, we are really the guest.
      onIdTaken: () => {
        if (loadGame(this.room, 'host')) return true;
        this.mode = 'guest'; this.goOnline();
        return false;
      },
    });
  }

  /* ---------- actions by this player ---------- */
  /* Plays { from, to, promo? } if it is legal and this player's turn. */
  play(move) {
    if (!this.canMove()) return false;
    const base = findBase(this.state, move);
    if (!base) return false;
    // Swap variants: the mover's browser rolls the dice and sends the result with the move.
    const partners = swapCandidates(this.state, base);
    const full = findLegal(this.state, partners.length
      ? { ...base, swap: partners[Math.floor(Math.random() * partners.length)] } : base);
    if (!full) return false;

    const mover = this.state.turn;
    if (this.turnStart !== null) {             // the clock is running: charge the time used, add the increment
      const left = this.remaining(mover);
      if (left <= 0) { this.#flag(mover); return false; }
      this.clock = { ...this.clock, [mover]: left + this.opts.increment * 1000 };
    }
    this.#push(full);
    this.net?.send({ t: 'move', g: this.gameNo, i: this.moves.length - 1, m: full, c: this.clock });
    return true;
  }

  resign() {
    if (this.result().over) return;
    this.#stopClock();
    this.resigned = this.online ? this.myColor : this.state.turn;
    this.#save();
    this.net?.send({ t: 'resign', g: this.gameNo });
    this.onChange('position');
  }

  /* Next game with colours swapped. Only the host starts it; a guest asks the host. */
  rematch() {
    if (!this.result().over) return;
    if (this.mode === 'guest') { this.net.send({ t: 'rematch' }); return; }
    if (this.mode === 'host') { this.gameNo += 1; this.hostColor = other(this.hostColor); }
    this.#newGame(this.vk, this.opts);
    this.#save(); this.#sendInit();
    this.onChange('position');
  }

  /* Call a few times a second while a clock is showing: notices flag fall, and writes our
     own running time down now and then. Returns true if the game just ended on time. */
  tick(now = this.now()) {
    if (this.turnStart === null || !this.state) return false;
    const turn = this.state.turn;
    const ours = !this.online || turn === this.myColor;
    const left = this.remaining(turn, now);
    if (left <= (ours ? 0 : -FLAG_GRACE_MS)) { this.#flag(turn); return true; }
    if (ours && this.online && now - this.lastBank >= BANK_EVERY_MS) {
      this.clock = { ...this.clock, [turn]: left };
      this.turnStart = now; this.lastBank = now;
      this.#save();
    }
    return false;
  }

  /* ---------- internals: game state ---------- */
  #options(opts) {
    return { castling: !!(opts && opts.castling), ...normaliseTime(opts) };
  }

  #newGame(vk, opts) {
    this.resigned = null; this.flagged = null; this.turnStart = null;
    this.#replay(vk, [], opts);
    this.clock = newClock(this.opts.minutes);
  }

  /* Rebuilds the game from a move list, validating every move. False (and no change) if any is illegal. */
  #replay(vk, moves, opts) {
    if (!VARIANTS[vk] || !Array.isArray(moves)) return false;
    const o = this.#options(opts);
    let s = newState(vk, o);
    const labels = [], clean = [];
    for (const raw of moves) {
      if (outcome(s).over) return false;
      const m = findLegal(s, raw);
      if (!m) return false;
      labels.push(moveLabel(s, m)); clean.push(m); s = applyMove(s, m);
    }
    this.vk = vk; this.opts = o; this.moves = clean; this.labels = labels; this.state = s;
    return true;
  }

  #push(move) {
    this.labels.push(moveLabel(this.state, move));
    this.moves.push(move);
    this.state = applyMove(this.state, move);
    this.#restartClock();
    this.#save();
    this.onChange('position');
  }

  #save() {
    if (!this.online) return;
    saveGame(this.room, this.mode, {
      vk: this.vk, opts: this.opts, hostColor: this.hostColor, gameNo: this.gameNo, moves: this.moves,
      resigned: this.resigned, flagged: this.flagged, clock: this.clock,
    });
  }

  /* ---------- internals: clock ---------- */
  /* Starts the side to move counting from now, if the clock should be running at all. */
  #restartClock() {
    const run = this.timed && this.moves.length > 0 && !this.result().over && (!this.online || this.connected);
    this.turnStart = run ? this.now() : null;
    this.lastBank = this.turnStart || 0;
  }

  /* Stops the clock. Our own time used so far this turn is kept; the opponent keeps theirs. */
  #stopClock() {
    if (this.turnStart === null) return;
    const turn = this.state.turn;
    if (!this.online || turn === this.myColor) this.clock = { ...this.clock, [turn]: Math.max(0, this.remaining(turn)) };
    this.turnStart = null;
  }

  #flag(color) {
    if (this.result().over) return;
    this.turnStart = null;
    this.clock = { ...this.clock, [color]: 0 };
    this.flagged = color;
    this.#save();
    this.net?.send({ t: 'flag', g: this.gameNo, color });
    this.onChange('position');
  }

  #onLink(status) {
    const was = this.connected;
    this.link = status;
    if (was && !this.connected) { this.#stopClock(); this.#save(); }
    // The host resumes the clock as soon as the guest is back; the guest resumes when the game arrives (init).
    if (!was && this.connected && this.mode === 'host') this.#restartClock();
    this.onChange('link');
  }

  /* ---------- internals: messages ---------- */
  #sendInit() {
    this.net?.send({
      t: 'init', vk: this.vk, opts: this.opts, hostColor: this.hostColor, g: this.gameNo, moves: this.moves,
      resigned: this.resigned, flagged: this.flagged, clock: this.clock,
    });
  }

  #receive(d) {
    const host = this.mode === 'host';
    if (d.t === 'init' && !host) this.#onInit(d);
    else if (d.t === 'sync' && host) this.#onSync(d);
    else if (d.t === 'move') this.#onMove(d);
    else if (d.t === 'clock' && host) this.#onClock(d);
    else if (d.t === 'flag') this.#onFlag(d);
    else if (d.t === 'hello' && host) this.#sendInit();
    else if (d.t === 'resign') this.#onResign(d);
    else if (d.t === 'rematch' && host) this.rematch();
  }

  #onInit(d) {
    const mine = { had: !!this.state, g: this.gameNo, vk: this.vk, moves: this.moves, clock: this.clock };
    if (!this.#replay(d.vk, d.moves, d.opts)) return;
    this.hostColor = d.hostColor === 'b' ? 'b' : 'w'; this.gameNo = d.g;
    this.resigned = d.resigned || null; this.flagged = d.flagged || null;
    this.clock = readClock(d.clock) || newClock(this.opts.minutes);
    const sameGame = mine.had && mine.g === d.g && mine.vk === d.vk;
    // If the host lost moves we still have (it cleared its storage, say), offer ours back.
    if (sameGame && mine.moves.length > d.moves.length) this.net.send({ t: 'sync', g: mine.g, moves: mine.moves });
    // Our own time is ours to report: if we had used more than the host knows, tell it.
    const me = this.myColor;
    if (this.timed && sameGame && mine.moves.length === d.moves.length && mine.clock[me] < this.clock[me]) {
      this.clock = { ...this.clock, [me]: mine.clock[me] };
      this.net.send({ t: 'clock', g: this.gameNo, i: this.moves.length, ms: this.clock[me] });
    }
    this.#restartClock();
    this.#save();
    this.onChange('position');
  }

  #onSync(d) {
    if (d.g === this.gameNo && Array.isArray(d.moves) && d.moves.length > this.moves.length) {
      const keep = this.moves;
      const extendsOurs = keep.every((m, i) => d.moves[i] && d.moves[i].from === m.from && d.moves[i].to === m.to);
      if (extendsOurs && this.#replay(this.vk, d.moves, this.opts)) { this.#restartClock(); this.#save(); this.onChange('position'); }
    }
    this.#sendInit();
  }

  #onMove(d) {
    const mover = other(this.myColor);
    const expected = d.g === this.gameNo && d.i === this.moves.length && !this.result().over && this.state.turn === mover;
    const move = expected ? findLegal(this.state, d.m) : null;
    if (!move) {
      if (this.mode === 'host') this.#sendInit();   // out of step: the host's list wins
      else this.net.send({ t: 'hello' });
      return;
    }
    if (this.timed) {
      // The mover reports their own clock; it can never be more than they had plus the increment.
      const reported = readClock(d.c);
      const most = this.clock[mover] + this.opts.increment * 1000;
      const left = reported ? Math.min(reported[mover], most) : Math.max(0, this.remaining(mover));
      this.clock = { ...this.clock, [mover]: left };
    }
    this.#push(move);
  }

  #onClock(d) {
    const guest = other(this.hostColor);
    if (d.g !== this.gameNo || d.i !== this.moves.length || typeof d.ms !== 'number' || !(d.ms >= 0)) return;
    if (d.ms < this.clock[guest]) { this.clock = { ...this.clock, [guest]: d.ms }; this.#save(); this.onChange('link'); }
  }

  #onFlag(d) {
    if (d.g !== this.gameNo || this.result().over || (d.color !== 'w' && d.color !== 'b')) return;
    this.turnStart = null;
    this.clock = { ...this.clock, [d.color]: 0 };
    this.flagged = d.color;
    this.#save();
    this.onChange('position');
  }

  #onResign(d) {
    if (d.g !== this.gameNo || this.result().over) return;
    this.#stopClock();
    this.resigned = other(this.myColor);
    this.#save();
    this.onChange('position');
  }
}
