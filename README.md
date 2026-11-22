# chess-variants

Small-board chess variants for two players. Each variant is one static page; the two browsers
connect peer-to-peer (WebRTC via [PeerJS](https://peerjs.com)), so there is no game server.

| Variant | Folder | Rules |
| --- | --- | --- |
| Los Alamos | `los-alamos/` | 6×6, no bishops, no en passant, no pawn double-step; castling optional |
| Random Swap | `random-swap/` | Classic 8×8 chess plus the swap rule below |

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

## Play

Open the variant page, choose **Create online game**, and send the invite link to your opponent.
The creator's browser hosts the game: keep that tab open and bookmark its URL (the one with `&host=1`).

## Develop

    python3 build.py                      # rebuilds <variant>/index.html from src/
    node tests/test_engine.js             # rules tests
    python3 tests/test_ui.py              # two-browser test (needs playwright + Chrome)
    python3 -m http.server 8000           # then open http://localhost:8000/los-alamos/

- `src/engine.js`: rules engine; board size and piece set come from the `VARIANTS` table.
- `src/app.js`: UI and peer-to-peer sync.
- `build.py`: `PAGES` maps a folder name to the variants that page offers.

To add a variant: add an entry to `VARIANTS` in `src/engine.js`, add a page to `PAGES` in
`build.py`, run the build, and link the new folder from `index.html`.

`vendor/` holds PeerJS 1.5.5 (MIT licence).
