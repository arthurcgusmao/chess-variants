# chess-variants

Small-board chess variants for two players. Each variant is one static page; the two browsers
connect peer-to-peer (WebRTC via [PeerJS](https://peerjs.com)), so there is no game server.

| Variant | Folder | Rules |
| --- | --- | --- |
| Los Alamos | `los-alamos/` | 6×6, no bishops, no en passant, no pawn double-step; castling optional |
| 8×7 | `8x7/` | Classic chess on 8 files by 7 ranks |
| Cylinder | `cylinder/` | Classic 8×8 chess with the a- and h-files joined |
| Random Swap | `random-swap/` | Classic 8×8 chess plus the swap rule below |

**8×7.** The standard pieces and all classic rules on a board with seven ranks. Pawns start on
ranks 2 and 6, so only three empty ranks separate them and a double step from either side
lands on rank 4: whoever gets there first blocks that file's opposing double step. Pawns
promote on the far rank (7 for White, 1 for Black).

**Cylinder.** The standard starting position and all classic rules (castling, en passant, pawn
double-step), on a board whose left and right edges are joined. Every piece can cross that
edge, including pawn captures and en passant. A rook or queen on an empty rank may not travel
all the way round to its own square (no null moves). The page has buttons to turn the view;
they change only what you see.

**Random Swap.** All classic rules apply (castling, en passant, pawn double-step). In addition,
after you move a rook, bishop, knight or queen, it swaps type with another of your rooks,
bishops, knights or queens, picked at random among those of a different type. The two pieces
stay on their squares; only what they are changes. Pawn and king moves, castling and
promotions never trigger a swap. If you have no piece of a different type, nothing happens.
Checks and checkmate are judged after the swap. You may castle with an unmoved corner piece
whatever type it currently is; it moves to the square the king crossed, as a rook would.

**Castling option.** Original Los Alamos chess has no castling. The game creator can switch it on:
the king moves two squares toward a rook and that rook lands on the square the king crossed
(short: Kd1-f1 with Rf1-e1; long: Kd1-b1 with Ra1-c1). The usual conditions apply: neither piece
has moved, the squares between them are empty, and the king is not in check and does not cross
or land on an attacked square.

**Clock (all variants).** The game creator can pick a time per player (1 to 60 minutes) and an
increment per move. Clocks start after the first move, and a player whose time runs out loses.
Each browser keeps its own player's time and reports it with every move, so network delay is
not charged to anyone. Clocks stop while the two browsers are disconnected.

## Play

Open the variant page, choose **Create online game**, and send the invite link to your opponent.
The creator's browser hosts the game: keep that tab open and bookmark its URL (the one with `&host=1`).

## Develop

    python3 build.py                 # regenerates the pages after changing a template or PAGES
    npm test                         # rules, clock and game tests (node, no dependencies)
    python3 tests/test_ui.py         # two-browser test (needs playwright + Chrome)
    python3 -m http.server 8000      # then open http://localhost:8000/

There is no bundler: the pages load the modules in `src/` directly.

| File | Responsibility |
| --- | --- |
| `src/variants.js` | The variant table: board size, back rank, rule flags |
| `src/engine.js` | Rules: legal moves, applying a move, check, game end. Pure functions, no DOM |
| `src/game.js` | One game: move list, turns, clocks, resign and rematch, and the sync protocol |
| `src/clock.js` | Time controls on offer and clock helpers |
| `src/net.js` | The peer-to-peer connection (PeerJS). Knows nothing about chess |
| `src/storage.js` | Saved games in the browser |
| `src/view.js` | Draws the screen from a game |
| `src/pieces.js` | Piece artwork |
| `src/main.js` | Entry point: wires controls to the game |
| `src/styles.css` | Styles |
| `src/page.tpl.html`, `src/home.tpl.html` | Page templates used by `build.py` |

To add a variant: add an entry to `src/variants.js` (and a rule flag in `src/engine.js` if it
needs new behaviour), add a page to `PAGES` in `build.py`, and run the build.

`vendor/` holds PeerJS 1.5.5 (MIT licence).
