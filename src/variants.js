/* Variant definitions. To add a variant, add an entry here and a page in build.py.

   `back` is White's back rank from the a-file; Black mirrors it. `promo` lists what a pawn
   may promote to. Rule flags (all default off):
     doubleStep       pawns may advance two squares from their start row
     enPassant        en passant captures
     castling         castling is always on
     castlingOptional the game creator may switch castling on
     wrap             cylinder board: the first and last files are joined
     swap             after moving a R/B/N/Q it swaps type with another of the mover's
                      R/B/N/Q of a different type, picked at random */
export const VARIANTS = {
  losalamos: { name: 'Los Alamos 6×6', blurb: 'No bishops', cols: 6, rows: 6, back: 'RNQKNR', promo: ['Q', 'R', 'N'], castlingOptional: true },
  classic:   { name: 'Classic 8×8', blurb: 'Standard chess', cols: 8, rows: 8, back: 'RNBQKBNR', promo: ['Q', 'R', 'B', 'N'],
               doubleStep: true, enPassant: true, castling: true },
  short:     { name: 'Chess 8×7', blurb: 'One rank fewer', cols: 8, rows: 7, back: 'RNBQKBNR', promo: ['Q', 'R', 'B', 'N'],
               doubleStep: true, enPassant: true, castling: true },
  cylinder:  { name: 'Cylinder 8×8', blurb: 'a- and h-files are joined', cols: 8, rows: 8, back: 'RNBQKBNR', promo: ['Q', 'R', 'B', 'N'],
               doubleStep: true, enPassant: true, castling: true, wrap: true },
  randomswap: { name: 'Random Swap 8×8', blurb: 'The piece you move swaps type', cols: 8, rows: 8, back: 'RNBQKBNR', promo: ['Q', 'R', 'B', 'N'],
               doubleStep: true, enPassant: true, castling: true, swap: true },
  norooks:   { name: 'Mini 6×6', blurb: 'No rooks', cols: 6, rows: 6, back: 'NBQKBN', promo: ['Q', 'B', 'N'] },
  gardner:   { name: 'Gardner 5×5', blurb: 'All piece types', cols: 5, rows: 5, back: 'RNBQK', promo: ['Q', 'R', 'B', 'N'] },
};
