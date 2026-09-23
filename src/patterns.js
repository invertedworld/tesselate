/* ------------------------------------------------------------------
   patterns.js — plane symmetry: the shape of the tile, and which turn
   each copy of it gets.

   A tiling says where copy (i, j) of the tile sits and how the plane is
   carved into them. Three shapes:

     square   the plain grid; each copy turns by quarters
     hex      flat-topped hexagons; each turns by sixths
     tri      equilateral triangles, pointing up and down by turns. A
              down triangle is an up one turned an odd number of sixths
              about its own middle, so each copy turns by thirds on top
              of what its place already asks for

   Every tile fits the square [0,T] x [0,T] and turns about its own
   middle, `c0`, which is where the drawing surface — copy (0,0) —
   sits, upright. Copies lie on a lattice: copy (i, j) is at
   c0 + u·A + j·B (+ off[s]), where u and s come from i — for the
   triangle two copies share a lattice point, one up and one down, and
   i = 2u + s; for the others i = u.

   A pattern is a block of turns, `per` copies across (n, or 2n for the
   triangle, so the block holds whole up-and-down pairs) by n down,
   repeated across the plane by n·A and n·B. cells[j * per + i] holds
   the turn for copy (i, j) of the block. The block is always
   normalised so cell (0,0) is 0, because copy (0,0) is the drawing
   surface and must stay upright.
   ------------------------------------------------------------------ */

const SQ3 = Math.sqrt(3);

/* cos and sin of a whole number of degrees, exact where the angle is a
   multiple of thirty: a quarter-turn is still a swap of components, and
   a mark carried round a block comes back to the coordinates it left. */
function turnCS(deg) {
  const r = (deg * Math.PI) / 180;
  const tidy = (v) => {
    const h = Math.round(v * 2) / 2;
    return Math.abs(v - h) < 1e-12 ? h : v;
  };
  return [tidy(Math.cos(r)), tidy(Math.sin(r))];
}

function makeTiling(o) {
  const t = Object.assign({ kinds: 1, off: [{ x: 0, y: 0 }], base: [0] }, o);
  const { A, B, c0, kinds } = t;
  const det = A.x * B.y - A.y * B.x;

  // Where a point sits on the lattice, in steps of A and B from c0.
  t.frac = (w) => {
    const dx = w.x - c0.x, dy = w.y - c0.y;
    return { u: (dx * B.y - dy * B.x) / det, v: (A.x * dy - A.y * dx) / det };
  };

  t.per = (n) => n * kinds;
  t.count = (n) => n * kinds * n;
  t.index = (pattern, i, j) => {
    const per = pattern.n * kinds;
    return mod(j, pattern.n) * per + mod(i, per);
  };
  t.key = (pattern, i, j) => `${mod(i, pattern.n * kinds)},${mod(j, pattern.n)}`;

  t.origin = (i, j) => {
    const u = Math.floor(i / kinds), s = i - u * kinds;
    return {
      x: c0.x + u * A.x + j * B.x + t.off[s].x,
      y: c0.y + u * A.y + j * B.y + t.off[s].y,
    };
  };

  // Degrees copy (i, j) is turned through.
  t.angle = (pattern, i, j) => {
    const s = mod(i, kinds);
    const v = pattern.n === 1 && kinds === 1 ? 0 : pattern.cells[t.index(pattern, i, j)] || 0;
    return t.base[s] + v * t.step;
  };

  /* Copy (i, j)'s placement as a canvas matrix [a b c d e f], taking
     the tile's own coordinates to the plane. */
  t.matrix = (pattern, i, j) => {
    const [c, s] = turnCS(t.angle(pattern, i, j));
    const o = t.origin(i, j);
    return [c, s, -s, c, o.x - (c * c0.x - s * c0.y), o.y - (s * c0.x + c * c0.y)];
  };

  t.place = (p, pattern, i, j) => {
    const [c, s] = turnCS(t.angle(pattern, i, j));
    const o = t.origin(i, j);
    const dx = p.x - c0.x, dy = p.y - c0.y;
    return { x: o.x + dx * c - dy * s, y: o.y + dx * s + dy * c };
  };

  t.unplace = (w, pattern, i, j) => {
    const [c, s] = turnCS(t.angle(pattern, i, j));
    const o = t.origin(i, j);
    const dx = w.x - o.x, dy = w.y - o.y;
    return { x: c0.x + dx * c + dy * s, y: c0.y - dx * s + dy * c };
  };

  // Copies whose tiles might reach into a box on the plane.
  t.range = (x0, y0, x1, y1) => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const [x, y] of [[x0, y0], [x1, y0], [x0, y1], [x1, y1]]) {
      const f = t.frac({ x, y });
      u0 = Math.min(u0, f.u); u1 = Math.max(u1, f.u);
      v0 = Math.min(v0, f.v); v1 = Math.max(v1, f.v);
    }
    return {
      i0: (Math.floor(u0) - 1) * kinds, i1: (Math.ceil(u1) + 1) * kinds + kinds - 1,
      j0: Math.floor(v0) - 1, j1: Math.ceil(v1) + 1,
    };
  };

  /* The copies around (i, j) whose marks can reach into it, when a
     mark may run `pad` tiles past its own: nearest first, the copy
     itself leading. */
  t.around = (i, j, pad) => {
    const o = t.origin(i, j);
    const far = pad * T + t.outR + t.inR + 1;
    const out = [];
    const r = t.range(o.x - far, o.y - far, o.x + far, o.y + far);
    for (let b = r.j0; b <= r.j1; b++) {
      for (let a = r.i0; a <= r.i1; a++) {
        const q = t.origin(a, b);
        const d = Math.hypot(q.x - o.x, q.y - o.y);
        if (t.square ? Math.max(Math.abs(a - i), Math.abs(b - j)) <= pad : (pad ? d <= far : d < 1)) {
          out.push({ i: a, j: b, d });
        }
      }
    }
    return out.sort((p, q) => p.d - q.d);
  };

  /* The whole-block step nearest to carrying `c` (a point of the tile's
     own coordinates) back to the middle of the tile. */
  t.homeShift = (n, c) => {
    const f = t.frac(c);
    const ku = Math.round(f.u / n), kv = Math.round(f.v / n);
    return [-(ku * n * A.x + kv * n * B.x) || 0, -(ku * n * A.y + kv * n * B.y) || 0];
  };

  // The copy a step on the plane of (dx, dy) — whole blocks — lands on.
  t.shifted = (at, dx, dy) => {
    const du = (dx * B.y - dy * B.x) / det, dv = (A.x * dy - A.y * dx) / det;
    return { i: at.i + Math.round(du) * kinds, j: at.j + Math.round(dv) };
  };

  // Which block a copy belongs to.
  t.block = (n, i, j) => `${Math.floor(Math.floor(i / kinds) / n)},${Math.floor(j / n)}`;

  // Is a point of the tile's own coordinates on it, give or take `slack`?
  t.inside = (p, slack) => {
    const g = slack || 0;
    const L = t.outline, m = L.length;
    for (let k = 0; k < m; k++) {
      const a = L[k], b = L[(k + 1) % m];
      const ex = b.x - a.x, ey = b.y - a.y;
      // Outline runs clockwise on screen, so the inside is to the right.
      if ((ex * (p.y - a.y) - ey * (p.x - a.x)) / Math.hypot(ex, ey) < -g) return false;
    }
    return true;
  };

  return t;
}

const TRI_H = (T * SQ3) / 2;
const TRI_TOP = (T - TRI_H) / 2;
const HEX_R = T / 2;

const TILINGS = {
  square: makeTiling({
    id: 'square', name: 'Square', square: true,
    turns: 4, step: 90,
    A: { x: T, y: 0 }, B: { x: 0, y: T }, c0: { x: T / 2, y: T / 2 },
    outline: [{ x: 0, y: 0 }, { x: T, y: 0 }, { x: T, y: T }, { x: 0, y: T }],
    inR: T / 2, outR: (T * Math.SQRT2) / 2,
  }),
  hex: makeTiling({
    id: 'hex', name: 'Hex',
    turns: 6, step: 60,
    A: { x: 1.5 * HEX_R, y: (SQ3 / 2) * HEX_R }, B: { x: 0, y: SQ3 * HEX_R },
    c0: { x: T / 2, y: T / 2 },
    outline: [0, 1, 2, 3, 4, 5].map((k) => ({
      x: T / 2 + HEX_R * Math.cos(((k + 3) * Math.PI) / 3),
      y: T / 2 + HEX_R * Math.sin(((k + 3) * Math.PI) / 3),
    })),
    inR: (SQ3 / 2) * HEX_R, outR: HEX_R,
  }),
  tri: makeTiling({
    id: 'tri', name: 'Triangle',
    turns: 3, step: 120, kinds: 2,
    A: { x: T, y: 0 }, B: { x: T / 2, y: TRI_H },
    c0: { x: T / 2, y: TRI_TOP + (2 * TRI_H) / 3 },
    // The down triangle beside each up one, turned a sixth.
    off: [{ x: 0, y: 0 }, { x: T / 2, y: -TRI_H / 3 }],
    base: [0, 60],
    outline: [{ x: T / 2, y: TRI_TOP }, { x: T, y: TRI_TOP + TRI_H }, { x: 0, y: TRI_TOP + TRI_H }],
    inR: TRI_H / 3, outR: (2 * TRI_H) / 3,
  }),
};

const SHAPE_IDS = ['square', 'hex', 'tri'];
const tilingOf = (pattern) => TILINGS[pattern && pattern.shape] || TILINGS.square;
const shapeOf = (pattern) => tilingOf(pattern).id;

/* The copy of the tile a point of the plane is on. The hexagon is the
   nearest centre; the triangle is whichever half of its rhombus the
   point falls in. */
function cellAt(pattern, w) {
  const t = tilingOf(pattern);
  if (t.square) return { i: Math.floor(w.x / T), j: Math.floor(w.y / T) };
  const f = t.frac(w);
  if (t.id === 'hex') {
    let best = null, bd = Infinity;
    for (const du of [0, 1]) {
      for (const dv of [0, 1]) {
        const i = Math.floor(f.u) + du, j = Math.floor(f.v) + dv;
        const o = t.origin(i, j);
        const d = (o.x - w.x) ** 2 + (o.y - w.y) ** 2;
        if (d < bd) { bd = d; best = { i, j }; }
      }
    }
    return best;
  }
  /* The triangle: each rhombus of the lattice holds an up triangle
     round the lattice point it is named for and a down one to its left,
     which belongs to the point before. */
  const u = f.u + 2 / 3, v = f.v + 2 / 3;     // measured from the rhombus corner
  const u0 = Math.floor(u), v0 = Math.floor(v);
  const a = u - u0, b = v - v0;
  return a + b >= 1 ? { i: 2 * u0, j: v0 } : { i: 2 * u0 - 1, j: v0 };
}

/* ---- presets ------------------------------------------------------ */

/* A turn about a corner the copies share, rather than about each copy's
   own middle: every copy is turned the way its direction from its hub
   says, so the copies round each hub read as one figure spun round it.
   `hub(f)` says whether a corner — in lattice steps from c0 — is one;
   every copy has to have exactly one of its corners on a hub. */
function spunAbout(t, hub, ref) {
  const pat = { shape: t.id, n: 1, cells: [0, 0] };
  return (i, j) => {
    const o = t.origin(i, j);
    let at = null;
    for (const p of t.outline) {
      const w = t.place(p, pat, i, j);
      if (hub(t.frac(w))) { at = w; break; }
    }
    if (!at) return 0;
    // Upright is the copy lying `ref` degrees round from its hub.
    const deg = (Math.atan2(o.y - at.y, o.x - at.x) * 180) / Math.PI - ref;
    return mod(Math.round((deg - t.base[mod(i, t.kinds)]) / t.step), t.turns);
  };
}

// A lattice position near enough whole, or null.
const whole = (x) => (Math.abs(x - Math.round(x)) < 1e-6 ? Math.round(x) : null);

const PRESETS = {
  square: [
    { id: 'translate', name: 'Translate', n: 1, fn: () => 0 },
    { id: 'pinwheel', name: 'Pinwheel', n: 2, fn: (i, j) => [[0, 1], [3, 2]][j][i] },
    { id: 'rows', name: 'Rows', n: 2, fn: (i, j) => 2 * (j % 2) },
    { id: 'columns', name: 'Columns', n: 2, fn: (i) => 2 * (i % 2) },
    { id: 'checker', name: 'Checker', n: 2, fn: (i, j) => 2 * ((i + j) % 2) },
    { id: 'triple', name: 'Triple', n: 3, fn: (i, j) => (i + j) % 3 },
    { id: 'cascade', name: 'Cascade', n: 4, fn: (i, j) => (i + j) % 4 },
    { id: 'windmill', name: 'Windmill', n: 4, fn: (i, j) => (2 * i + j) % 4 },
    { id: 'spin', name: 'Spin', n: 4, fn: (i, j) => (i * j) % 4 },
  ],
  hex: [
    { id: 'translate', name: 'Translate', n: 1, fn: () => 0 },
    { id: 'rows', name: 'Rows', n: 2, fn: (i, j) => 3 * (j % 2) },
    { id: 'columns', name: 'Columns', n: 2, fn: (i) => 3 * (i % 2) },
    /* Three hexagons meet at every corner. Of the corners a third of
       the way along A from a centre, one in three is a hub, and each
       hexagon has exactly one of them. */
    { id: 'trio', name: 'Trio', n: 3, fn: spunAbout(TILINGS.hex, (f) => {
      const u = whole(f.u - 2 / 3), v = whole(f.v + 1 / 3);
      return u != null && v != null && mod(u + 2 * v, 3) === 0;
    }, 60) },
    { id: 'cascade', name: 'Cascade', n: 3, fn: (i, j) => 2 * ((i + j) % 3) },
    { id: 'spin', name: 'Spin', n: 4, fn: (i, j) => (i + 2 * j) % 6 },
  ],
  tri: [
    { id: 'alternate', name: 'Alternate', n: 1, fn: () => 0 },
    { id: 'halfturn', name: 'Half-turn', n: 1, fn: (i) => i % 2 },
    /* Six triangles meet at every corner; one corner in three is a hub,
       and every triangle has exactly one of its corners on one. */
    { id: 'rosette', name: 'Rosette', n: 3, fn: spunAbout(TILINGS.tri, (f) => {
      const u = whole(f.u + 2 / 3), v = whole(f.v + 2 / 3);
      return u != null && v != null && mod(u - v, 3) === 0;
    }, 90) },
    { id: 'rows', name: 'Rows', n: 2, fn: (i, j) => j % 2 },
    { id: 'cascade', name: 'Cascade', n: 3, fn: (i, j) => (Math.floor(i / 2) + j) % 3 },
  ],
};

const presetsFor = (shape) => PRESETS[shape] || PRESETS.square;

function normaliseCells(cells, turns) {
  const q = turns || 4;
  const base = cells[0];
  return cells.map((v) => ((v - base) % q + q) % q);
}

function cellsFromPreset(preset, shape) {
  const t = TILINGS[shape] || TILINGS.square;
  const { n, fn } = preset;
  const per = t.per(n);
  const cells = [];
  for (let j = 0; j < n; j++) for (let i = 0; i < per; i++) cells.push(mod(fn(i, j), t.turns));
  return normaliseCells(cells, t.turns);
}

function patternFromPreset(preset, shape) {
  return { shape, n: preset.n, cells: cellsFromPreset(preset, shape) };
}

function resizeCells(pattern, newN) {
  const t = tilingOf(pattern);
  const per0 = t.per(pattern.n), per1 = t.per(newN);
  const out = new Array(per1 * newN).fill(0);
  for (let j = 0; j < newN; j++) {
    for (let i = 0; i < per1; i++) {
      out[j * per1 + i] = i < per0 && j < pattern.n ? pattern.cells[j * per0 + i] : 0;
    }
  }
  return normaliseCells(out, t.turns);
}

// A pattern read from a file or from storage, if it holds together.
function validPattern(p) {
  if (!p || !(p.n >= 1 && p.n <= 4) || !Array.isArray(p.cells)) return null;
  const shape = p.shape && TILINGS[p.shape] ? p.shape : 'square';
  const t = TILINGS[shape];
  if (p.cells.length !== t.count(p.n)) return null;
  if (!p.cells.every((v) => Number.isInteger(v) && v >= 0 && v < t.turns)) return null;
  return { shape, n: p.n, cells: p.cells.slice() };
}

/* Turns applied to copy (i, j), in the tiling's own step. */
function rotAt(pattern, i, j) {
  if (pattern.n === 1 && tilingOf(pattern).kinds === 1) return 0;
  return pattern.cells[tilingOf(pattern).index(pattern, i, j)];
}

/* Which preset (if any) the current block matches. */
function matchPreset(pattern) {
  const shape = shapeOf(pattern);
  for (const p of presetsFor(shape)) {
    if (p.n !== pattern.n) continue;
    const c = cellsFromPreset(p, shape);
    if (c.every((v, k) => v === pattern.cells[k])) return p.id;
  }
  return null;
}
