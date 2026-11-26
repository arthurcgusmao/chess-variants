/* One game between two players: the move list, whose turn it is, and keeping both
   browsers in step. No DOM here; the view reads this object and is told when it changes.

   Both browsers run the same rules engine and exchange only moves. The host's move list is
   the source of truth when the two reconnect.

   Messages (host <-> guest):
     init    host -> guest   full game: variant, options, colours, all moves
     sync    guest -> host   "I hold more moves than you sent" (host lost its storage)
     hello   guest -> host   please send init again
     move    either          one move, with its index in the game
     resign  either
     rematch guest -> host   start the next game (the host does it and sends init) */
import { VARIANTS } from './variants.js';
import { newState, legalMoves, findBase, findLegal, swapCandidates, applyMove, outcome, moveLabel, other } from './engine.js';
import { saveGame, loadGame } from './storage.js';
import { connect } from './net.js';

const ROOM_ALPHABET = 'abcdefghjkmnpqrstuvwxyz23456789';   // no look-alike characters

export class Game {
  /* onChange(kind): 'position' when the board changed, 'link' when only the connection did. */
  constructor(onChange) {
    this.onChange = onChange;
    this.mode = null;            // 'local' | 'host' | 'guest'
    this.room = null;
    this.vk = null;              // variant key
    this.opts = { castling: false };   // rule options chosen by whoever created the game
    this.hostColor = 'w';
    this.gameNo = 1;             // goes up with each rematch
    this.moves = [];
    this.labels = [];            // notation for each move
    this.resigned = null;        // colour that resigned, or null
    this.state = null;           // engine state after all moves; null until a guest receives the game
    this.link = 'idle';          // connection status, see net.js
    this.net = null;
  }

  /* ---------- queries ---------- */
  get variant() { return VARIANTS[this.vk]; }
  get online() { return this.mode !== 'local'; }
  get connected() { return this.link === 'connected'; }
  /* The colour this browser plays, or null when both sides share one device. */
  get myColor() { return !this.online ? null : this.mode === 'host' ? this.hostColor : other(this.hostColor); }
  get lastMove() { return this.moves[this.moves.length - 1]; }

  /* { over, winner, check }, where `over` is null or the reason the game ended. */
  result() {
    if (this.resigned) return { over: 'resign', winner: other(this.resigned), check: false };
    return outcome(this.state);
  }

  canMove() {
    if (!this.state || this.result().over) return false;
    return !this.online || (this.connected && this.state.turn === this.myColor);
  }

  movesFrom(square) { return legalMoves(this.state, square); }

  /* ---------- starting a game ---------- */
  startLocal(vk, opts) {
    this.mode = 'local'; this.resigned = null;
    this.#replay(vk, [], opts);
    this.onChange('position');
  }

  /* Creates a room hosted by this browser and returns its code. */
  createRoom(vk, opts, color) {
    let code = '';
    for (let i = 0; i < 8; i++) code += ROOM_ALPHABET[Math.floor(Math.random() * ROOM_ALPHABET.length)];
    this.mode = 'host'; this.room = code; this.hostColor = color; this.gameNo = 1; this.resigned = null;
    this.#replay(vk, [], opts);
    this.#save();
    return code;
  }

  /* Opens a room from its link, restoring any game saved in this browser. */
  openRoom(room, role, defaultVariant) {
    this.room = room; this.mode = role;
    const saved = loadGame(room, role);
    if (saved && this.#replay(saved.vk, saved.moves, saved.opts || {})) {
      this.hostColor = saved.hostColor === 'b' ? 'b' : 'w';
      this.gameNo = saved.gameNo || 1;
      this.resigned = saved.resigned || null;
    } else if (role === 'host') {
      this.#replay(defaultVariant, [], {});
    }
    this.goOnline();
  }

  goOnline() {
    if (this.net) this.net.close();
    this.net = connect({
      room: this.room,
      role: this.mode,
      onStatus: (s) => { this.link = s; this.onChange('link'); },
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
    this.#push(full);
    this.net?.send({ t: 'move', g: this.gameNo, i: this.moves.length - 1, m: full });
    return true;
  }

  resign() {
    if (this.result().over) return;
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
    this.resigned = null;
    this.#replay(this.vk, [], this.opts);
    this.#save(); this.#sendInit();
    this.onChange('position');
  }

  /* ---------- internals ---------- */
  /* Rebuilds the game from a move list, validating every move. False (and no change) if any is illegal. */
  #replay(vk, moves, opts) {
    if (!VARIANTS[vk] || !Array.isArray(moves)) return false;
    const o = { castling: !!(opts && opts.castling) };
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
    this.#save();
    this.onChange('position');
  }

  #save() {
    if (!this.online) return;
    saveGame(this.room, this.mode, {
      vk: this.vk, opts: this.opts, hostColor: this.hostColor, gameNo: this.gameNo, moves: this.moves, resigned: this.resigned,
    });
  }

  #sendInit() {
    this.net?.send({
      t: 'init', vk: this.vk, opts: this.opts, hostColor: this.hostColor, g: this.gameNo, moves: this.moves, resigned: this.resigned,
    });
  }

  #receive(d) {
    const host = this.mode === 'host';
    if (d.t === 'init' && !host) this.#onInit(d);
    else if (d.t === 'sync' && host) this.#onSync(d);
    else if (d.t === 'move') this.#onMove(d);
    else if (d.t === 'hello' && host) this.#sendInit();
    else if (d.t === 'resign') this.#onResign(d);
    else if (d.t === 'rematch' && host) this.rematch();
  }

  #onInit(d) {
    const mine = { had: !!this.state, g: this.gameNo, vk: this.vk, moves: this.moves };
    if (!this.#replay(d.vk, d.moves, d.opts || {})) return;
    this.hostColor = d.hostColor === 'b' ? 'b' : 'w'; this.gameNo = d.g; this.resigned = d.resigned || null;
    // If the host lost moves we still have (it cleared its storage, say), offer ours back.
    if (mine.had && mine.g === d.g && mine.vk === d.vk && mine.moves.length > d.moves.length) {
      this.net.send({ t: 'sync', g: mine.g, moves: mine.moves });
    }
    this.#save();
    this.onChange('position');
  }

  #onSync(d) {
    if (d.g === this.gameNo && Array.isArray(d.moves) && d.moves.length > this.moves.length) {
      const keep = this.moves;
      const extendsOurs = keep.every((m, i) => d.moves[i] && d.moves[i].from === m.from && d.moves[i].to === m.to);
      if (extendsOurs && this.#replay(this.vk, d.moves, this.opts)) { this.#save(); this.onChange('position'); }
    }
    this.#sendInit();
  }

  #onMove(d) {
    const expected = d.g === this.gameNo && d.i === this.moves.length && !this.result().over &&
      this.state.turn === other(this.myColor);
    const move = expected ? findLegal(this.state, d.m) : null;
    if (move) this.#push(move);
    else if (this.mode === 'host') this.#sendInit();   // out of step: the host's list wins
    else this.net.send({ t: 'hello' });
  }

  #onResign(d) {
    if (d.g !== this.gameNo || this.result().over) return;
    this.resigned = other(this.myColor);
    this.#save();
    this.onChange('position');
  }
}
