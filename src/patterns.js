/* ------------------------------------------------------------------
   patterns.js — plane symmetry: which quarter-turn each tile gets.

   A pattern is an n x n block of rotations (0..3 quarter turns),
   repeated across the plane. cells[j * n + i] holds the rotation for
   the tile at column i, row j of the block. The block is always
   normalised so cell (0,0) is 0, because tile (0,0) is the drawing
   surface and must stay upright.
   ------------------------------------------------------------------ */

const PRESETS = [
  { id: 'translate', name: 'Translate', n: 1, fn: () => 0 },
  { id: 'pinwheel', name: 'Pinwheel', n: 2, fn: (i, j) => [[0, 1], [3, 2]][j][i] },
  { id: 'rows', name: 'Rows', n: 2, fn: (i, j) => 2 * (j % 2) },
  { id: 'columns', name: 'Columns', n: 2, fn: (i) => 2 * (i % 2) },
  { id: 'checker', name: 'Checker', n: 2, fn: (i, j) => 2 * ((i + j) % 2) },
  { id: 'triple', name: 'Triple', n: 3, fn: (i, j) => (i + j) % 3 },
  { id: 'cascade', name: 'Cascade', n: 4, fn: (i, j) => (i + j) % 4 },
  { id: 'windmill', name: 'Windmill', n: 4, fn: (i, j) => (2 * i + j) % 4 },
  { id: 'spin', name: 'Spin', n: 4, fn: (i, j) => (i * j) % 4 },
];

function normaliseCells(cells) {
  const base = cells[0];
  return cells.map((v) => ((v - base) % 4 + 4) % 4);
}

function cellsFromPreset(preset) {
  const { n, fn } = preset;
  const cells = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) cells.push(fn(i, j) % 4);
  return normaliseCells(cells);
}

function resizeCells(cells, oldN, newN) {
  const out = new Array(newN * newN).fill(0);
  for (let j = 0; j < newN; j++) {
    for (let i = 0; i < newN; i++) {
      out[j * newN + i] = i < oldN && j < oldN ? cells[j * oldN + i] : 0;
    }
  }
  return normaliseCells(out);
}

/* Quarter turns applied to tile (i, j). */
function rotAt(pattern, i, j) {
  const n = pattern.n;
  if (n === 1) return 0;
  return pattern.cells[mod(j, n) * n + mod(i, n)];
}

/* Which preset (if any) the current block matches. */
function matchPreset(pattern) {
  for (const p of PRESETS) {
    if (p.n !== pattern.n) continue;
    const c = cellsFromPreset(p);
    if (c.every((v, k) => v === pattern.cells[k])) return p.id;
  }
  return null;
}
