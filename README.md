# chess-variants

Small-board chess variants for two players. Each variant is one static page; the two browsers
connect peer-to-peer (WebRTC via [PeerJS](https://peerjs.com)), so there is no game server.

| Variant | Folder | Rules |
| --- | --- | --- |
| Los Alamos | `los-alamos/` | 6×6, no bishops, no castling, no en passant, no pawn double-step |

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
