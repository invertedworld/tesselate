/* ------------------------------------------------------------------
   geometry.js — vector primitives, path building, contour tracing
   Everything here works in TILE UNITS: the drawing tile is the
   square [0,T] x [0,T]. No raster data is ever stored in the model;
   the bitmap in traceRegion() is a scratch buffer used only to
   discover the boundary of a filled area, which is then emitted as
   a vector polygon.
   ------------------------------------------------------------------ */

const T = 1000;

const mod = (a, b) => ((a % b) + b) % b;
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

/* ---- Path2D construction (used by the canvas renderer) ---------- */

function buildPath(shape) {
  const p = new Path2D();
  switch (shape.kind) {
    case 'path': {
      const pts = shape.pts;
      if (!pts.length) break;
      if (pts.length === 1) {
        // A tap: emit a zero-length segment so the round cap shows a dot.
        p.moveTo(pts[0].x, pts[0].y);
        p.lineTo(pts[0].x + 0.01, pts[0].y);
        break;
      }
      p.moveTo(pts[0].x, pts[0].y);
      if (pts.length === 2) {
        p.lineTo(pts[1].x, pts[1].y);
        break;
      }
      // Quadratics through the midpoints keep freehand strokes smooth.
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        p.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
      }
      const last = pts[pts.length - 1];
      p.lineTo(last.x, last.y);
      break;
    }
    case 'line':
      p.moveTo(shape.a.x, shape.a.y);
      p.lineTo(shape.b.x, shape.b.y);
      break;
    case 'curve':
      p.moveTo(shape.a.x, shape.a.y);
      p.quadraticCurveTo(shape.c.x, shape.c.y, shape.b.x, shape.b.y);
      break;
    case 'circle':
      p.arc(shape.c.x, shape.c.y, Math.max(0.4, shape.r), 0, Math.PI * 2);
      break;
    case 'rect':
      p.rect(shape.x, shape.y, shape.w, shape.h);
      break;
    case 'poly':
      if (!shape.pts.length) break;
      p.moveTo(shape.pts[0].x, shape.pts[0].y);
      for (let i = 1; i < shape.pts.length; i++) p.lineTo(shape.pts[i].x, shape.pts[i].y);
      p.closePath();
      break;
    case 'region':
      for (const loop of shape.loops) {
        if (loop.length < 3) continue;
        p.moveTo(loop[0].x, loop[0].y);
        for (let i = 1; i < loop.length; i++) p.lineTo(loop[i].x, loop[i].y);
        p.closePath();
      }
      break;
  }
  return p;
}

/* ---- SVG path data (used by the exporter) ----------------------- */

const n2 = (v) => (Math.round(v * 100) / 100).toString();

function pathData(shape) {
  switch (shape.kind) {
    case 'path': {
      const pts = shape.pts;
      if (!pts.length) return '';
      if (pts.length === 1) return `M${n2(pts[0].x)} ${n2(pts[0].y)}l0.01 0`;
      let d = `M${n2(pts[0].x)} ${n2(pts[0].y)}`;
      if (pts.length === 2) return d + `L${n2(pts[1].x)} ${n2(pts[1].y)}`;
      for (let i = 1; i < pts.length - 1; i++) {
        const mx = (pts[i].x + pts[i + 1].x) / 2;
        const my = (pts[i].y + pts[i + 1].y) / 2;
        d += `Q${n2(pts[i].x)} ${n2(pts[i].y)} ${n2(mx)} ${n2(my)}`;
      }
      const last = pts[pts.length - 1];
      return d + `L${n2(last.x)} ${n2(last.y)}`;
    }
    case 'line':
      return `M${n2(shape.a.x)} ${n2(shape.a.y)}L${n2(shape.b.x)} ${n2(shape.b.y)}`;
    case 'curve':
      return `M${n2(shape.a.x)} ${n2(shape.a.y)}Q${n2(shape.c.x)} ${n2(shape.c.y)} ${n2(shape.b.x)} ${n2(shape.b.y)}`;
    case 'circle': {
      const { c, r } = shape;
      return `M${n2(c.x - r)} ${n2(c.y)}a${n2(r)} ${n2(r)} 0 1 0 ${n2(r * 2)} 0a${n2(r)} ${n2(r)} 0 1 0 ${n2(-r * 2)} 0Z`;
    }
    case 'rect':
      return `M${n2(shape.x)} ${n2(shape.y)}h${n2(shape.w)}v${n2(shape.h)}h${n2(-shape.w)}Z`;
    case 'poly':
      if (!shape.pts.length) return '';
      return 'M' + shape.pts.map((p) => `${n2(p.x)} ${n2(p.y)}`).join('L') + 'Z';
    case 'region':
      return shape.loops
        .filter((l) => l.length >= 3)
        .map((l) => 'M' + l.map((p) => `${n2(p.x)} ${n2(p.y)}`).join('L') + 'Z')
        .join('');
  }
  return '';
}

/* ---- Douglas-Peucker simplification ---------------------------- */

function simplify(pts, eps) {
  if (pts.length < 3) return pts.slice();
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [i0, i1] = stack.pop();
    const a = pts[i0], b = pts[i1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const len = Math.hypot(dx, dy);
    // A closed ring hands us a zero-length base segment; fall back to
    // radial distance so the first split lands on the farthest point.
    const flat = len < 1e-9;
    let far = -1, fd = eps;
    for (let i = i0 + 1; i < i1; i++) {
      const d = flat
        ? Math.hypot(pts[i].x - a.x, pts[i].y - a.y)
        : Math.abs((pts[i].x - a.x) * dy - (pts[i].y - a.y) * dx) / len;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) {
      keep[far] = 1;
      stack.push([i0, far], [far, i1]);
    }
  }
  const out = [];
  for (let i = 0; i < pts.length; i++) if (keep[i]) out.push(pts[i]);
  return out;
}

/* ---- Flood fill -> vector polygon ------------------------------
   `barrier` is a WxH byte grid (1 = ink). We flood the connected
   free area containing the seed, grow it slightly so it tucks under
   the surrounding strokes, then walk the mask boundary and emit
   closed polygons (outer contour plus any holes) in tile units.
   ---------------------------------------------------------------- */

/* `wrap` makes the tile a torus: an area that runs off one edge carries
   on at the opposite one, so a shape straddling the seam is a single
   area and fills in one go. */
function floodMask(barrier, W, H, sx, sy, wrap) {
  if (sx < 0 || sy < 0 || sx >= W || sy >= H) return null;
  if (barrier[sy * W + sx]) return null;
  const mask = new Uint8Array(W * H);
  const stack = [sy * W + sx];
  mask[sy * W + sx] = 1;
  /* Eight-connected, not four. Where two marks converge the gap between
     them is a diagonal channel, and a diagonal channel one cell wide has
     no shared edges for a four-connected flood to cross — it needs twice
     the width, which is exactly the band that was left unfilled at a
     sharp point. */
  const DX = [-1, 1, 0, 0, -1, 1, -1, 1];
  const DY = [0, 0, -1, 1, -1, -1, 1, 1];
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i - x) / W;
    for (let k = 0; k < 8; k++) {
      let nx = x + DX[k];
      let ny = y + DY[k];
      if (wrap) {
        if (nx < 0) nx += W; else if (nx >= W) nx -= W;
        if (ny < 0) ny += H; else if (ny >= H) ny -= H;
      } else if (nx < 0 || ny < 0 || nx >= W || ny >= H) {
        continue;
      }
      const j = ny * W + nx;
      if (!mask[j] && !barrier[j]) { mask[j] = 1; stack.push(j); }
    }
  }
  return mask;
}

/* Grow a mask by `r` cells. Done as two linear sweeps per axis — each
   row and column asks only how far the nearest set cell is — so the cost
   does not climb with the radius, which matters when the scratch grid is
   a couple of million cells. The result is a square growth rather than a
   diamond one; for tucking a fill under a stroke that is if anything the
   more useful shape. */
function dilate(mask, W, H, r, wrap) {
  if (r <= 0) return mask;
  const big = 1 << 28;
  const laps = wrap ? 2 : 1;   // a second lap carries the ends round
  const mid = new Uint8Array(W * H);
  const out = new Uint8Array(W * H);
  const dist = new Int32Array(Math.max(W, H));
  let d;

  for (let y = 0; y < H; y++) {
    const row = y * W;
    d = big;
    for (let lap = 0; lap < laps; lap++) {
      for (let x = 0; x < W; x++) {
        d = mask[row + x] ? 0 : d + 1;
        if (lap === 0 || d < dist[x]) dist[x] = d;
      }
    }
    d = big;
    for (let lap = 0; lap < laps; lap++) {
      for (let x = W - 1; x >= 0; x--) {
        d = mask[row + x] ? 0 : d + 1;
        if (d < dist[x]) dist[x] = d;
      }
    }
    for (let x = 0; x < W; x++) if (dist[x] <= r) mid[row + x] = 1;
  }

  for (let x = 0; x < W; x++) {
    d = big;
    for (let lap = 0; lap < laps; lap++) {
      for (let y = 0; y < H; y++) {
        d = mid[y * W + x] ? 0 : d + 1;
        if (lap === 0 || d < dist[y]) dist[y] = d;
      }
    }
    d = big;
    for (let lap = 0; lap < laps; lap++) {
      for (let y = H - 1; y >= 0; y--) {
        d = mid[y * W + x] ? 0 : d + 1;
        if (d < dist[y]) dist[y] = d;
      }
    }
    for (let y = 0; y < H; y++) if (dist[y] <= r) out[y * W + x] = 1;
  }
  return out;
}

// Walk mask boundaries into closed loops of grid-aligned points.
function maskToLoops(mask, W, H) {
  const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : mask[y * W + x]);
  const key = (x, y) => y * (W + 1) + x;
  const out = new Map(); // vertex key -> list of outgoing vertices

  const push = (x1, y1, x2, y2) => {
    const k = key(x1, y1);
    let arr = out.get(k);
    if (!arr) out.set(k, (arr = []));
    arr.push([x2, y2]);
  };

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      if (!mask[y * W + x]) continue;
      if (!at(x, y - 1)) push(x, y, x + 1, y);
      if (!at(x + 1, y)) push(x + 1, y, x + 1, y + 1);
      if (!at(x, y + 1)) push(x + 1, y + 1, x, y + 1);
      if (!at(x - 1, y)) push(x, y + 1, x, y);
    }
  }

  const loops = [];
  for (const startKey of Array.from(out.keys())) {
    let arr = out.get(startKey);
    while (arr && arr.length) {
      const sx = startKey % (W + 1);
      const sy = (startKey - sx) / (W + 1);
      const loop = [{ x: sx, y: sy }];
      let cx = sx, cy = sy;
      // Follow consistently-oriented edges until we return to the start.
      for (let guard = 0; guard < 4 * W * H + 8; guard++) {
        const bucket = out.get(key(cx, cy));
        if (!bucket || !bucket.length) break;
        const [nx, ny] = bucket.pop();
        cx = nx; cy = ny;
        if (cx === sx && cy === sy) break;
        loop.push({ x: cx, y: cy });
      }
      if (loop.length >= 4) loops.push(loop);
      arr = out.get(startKey);
    }
  }
  return loops;
}

/* Take the staircase off a traced ring without rounding its corners.

   Which is which is a question of distance, not of angle. Tracing a
   circle leaves a ring whose points all sit within a cell of the true
   edge — the places are right — but the path between them crosses and
   recrosses it, so every arm turns back on the last by fifty degrees or
   more. Judging a corner by how sharply it turns calls each of those a
   corner and leaves the whole staircase standing, which is what a
   zoomed-in fill edge showed. A corner worth keeping is one that stands
   well off the line between its neighbours: the tip of a wedge is tens
   of cells out, a stair is under one. So that is what is asked.

   The move is a quarter of the way towards the neighbours, repeated,
   and held within `cap` of where the trace put the point throughout —
   so the ring never walks away from the area that was flooded, however
   many passes it takes. Each pass halves what is left of the staircase;
   three take a cell of it down to well under a pixel on the paper. */
function ease(ring, cap, passes) {
  const n = ring.length;
  const keep = ring.map((p, i) => {
    const a = ring[(i - 1 + n) % n], b = ring[(i + 1) % n];
    const ux = b.x - a.x, uy = b.y - a.y;
    const len = Math.hypot(ux, uy);
    if (len < 1e-9) return false;
    // How far the point stands off the line through its neighbours.
    return Math.abs((p.x - a.x) * uy - (p.y - a.y) * ux) / len > cap * 1.5;
  });
  let cur = ring;
  for (let pass = 0; pass < (passes || 3); pass++) {
    const prev = cur;
    cur = prev.map((p, i) => {
      if (keep[i]) return p;
      const a = prev[(i - 1 + n) % n], b = prev[(i + 1) % n];
      const o = ring[i];
      let mx = (a.x + 2 * p.x + b.x) / 4 - o.x;
      let my = (a.y + 2 * p.y + b.y) / 4 - o.y;
      const m = Math.hypot(mx, my);
      if (m > cap) { mx = (mx * cap) / m; my = (my * cap) / m; }
      return { x: o.x + mx, y: o.y + my };
    });
  }
  return cur;
}

/* Closed polygons round the ink of a mask, in the mask's own cells.
   The fill lays its grid over the tile and wants tile units back; the
   letters of a text mark are rastered at their own size and are put
   where they belong by the caller, so the cells are handed back as
   they are. */
function loopsFromInk(mask, W, H, eps) {
  const loops = maskToLoops(mask, W, H)
    .map((loop) => {
      // Close the ring before simplifying so the seam is not a corner.
      const ring = loop.concat([loop[0]]);
      const simp = simplify(ring, eps);
      simp.pop();
      /* Easing takes the staircase off the traced edge, but a sharp
         corner has to be left where it is: averaging pulls a point like
         the tip of a wedge inwards, which opens a notch exactly where
         the fill most needs to reach. The ends wrap round, since these
         rings are closed. */
      return simp.length < 4 ? simp : ease(simp, eps);
    })
    .filter((l) => l.length >= 3);
  return loops.length ? loops : null;
}

/* Turn a grown mask into closed polygons in tile units. */
function loopsFromMask(mask, W, H, eps) {
  const scale = T / W;
  const loops = loopsFromInk(mask, W, H, eps == null ? 2 : eps);
  return loops && loops.map((l) => l.map((p) => ({ x: p.x * scale, y: p.y * scale })));
}

/* ---- Misc helpers ---------------------------------------------- */

function snapAngle(a, b, step) {
  const d = Math.hypot(b.x - a.x, b.y - a.y);
  const ang = Math.atan2(b.y - a.y, b.x - a.x);
  const q = Math.round(ang / step) * step;
  return { x: a.x + Math.cos(q) * d, y: a.y + Math.sin(q) * d };
}

// Control point of a quadratic that passes through `m` at t = 0.5.
function quadThrough(a, b, m) {
  return { x: 2 * m.x - (a.x + b.x) / 2, y: 2 * m.y - (a.y + b.y) / 2 };
}

function loopsBBox(loops) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const l of loops) {
    for (const p of l) {
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
  }
  return { x0, y0, x1, y1 };
}

function bboxNear(a, b, tol) {
  return Math.abs(a.x0 - b.x0) <= tol && Math.abs(a.y0 - b.y0) <= tol
      && Math.abs(a.x1 - b.x1) <= tol && Math.abs(a.y1 - b.y1) <= tol;
}

/* Nearest point of an n x n lattice over the tile. */
function snapPoint(p, n) {
  const step = T / n;
  return { x: Math.round(p.x / step) * step, y: Math.round(p.y / step) * step };
}

/* ---- What a mark was made from --------------------------------- */

/* A text mark carries the words it was cut from, so that they can be
   edited and the letters cut again. What has been done to the mark
   since is carried beside them as a single affine rather than being
   lost in its points: the rings are cut upright, at the size and place
   they were asked for, and put through it. So a word turned and
   mirrored yesterday is still turned and mirrored when a letter is
   added to it today, and growing it grows from the corner it was
   started at.

   Marks are replaced rather than changed, so the recipe is replaced
   with them and an undo step keeps the one it had. */
const IDENT = [1, 0, 0, 1, 0, 0];

// x' = a·x + c·y + e, y' = b·x + d·y + f — the canvas's own order.
function mapAffine(m, p) {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

// `n` first, then `m`.
function mulAffine(m, n) {
  return [
    m[0] * n[0] + m[2] * n[1],
    m[1] * n[0] + m[3] * n[1],
    m[0] * n[2] + m[2] * n[3],
    m[1] * n[2] + m[3] * n[3],
    m[0] * n[4] + m[2] * n[5] + m[4],
    m[1] * n[4] + m[3] * n[5] + m[5],
  ];
}

/* The way back: a point on the plane into the upright letters a text
   mark was cut from. A mark that has been flattened to nothing has no
   way back, and is left where it is. */
function invAffine(m) {
  const det = m[0] * m[3] - m[2] * m[1];
  if (!det) return IDENT;
  const a = m[3] / det, b = -m[1] / det, c = -m[2] / det, d = m[0] / det;
  return [a, b, c, d, -(a * m[4] + c * m[5]), -(b * m[4] + d * m[5])];
}

/* Carry a mark's recipe through whatever has just been done to its
   points. A mark with none is left alone. */
function keepRecipe(out, s, m) {
  if (s.type) out.type = Object.assign({}, s.type, { m: mulAffine(m, s.type.m || IDENT) });
}

/* ---- Moving shapes about --------------------------------------- */

// Returns a NEW shape: shapes are treated as immutable so the undo
// stack and the Path2D cache can hold them by identity.
/* Turning a mark about a point. Every kind holds its own points, so the
   turn is applied to each of them — except an upright box, which cannot
   hold a turn at all: it becomes the four-cornered polygon the turn has
   just made of it. */
/* Scale a mark about a point. Uniform only: an ellipse is not a shape
   this can hold, so a circle has to come out a circle. The stroke keeps
   the width it was given — how heavy a line is was a choice about the
   mark, not about how big it is drawn. */
function scaleShape(s, cx, cy, k) {
  const mp = (p) => ({ x: cx + (p.x - cx) * k, y: cy + (p.y - cy) * k });
  const out = Object.assign({}, s);
  switch (s.kind) {
    case 'path': case 'poly': out.pts = s.pts.map(mp); break;
    case 'line': out.a = mp(s.a); out.b = mp(s.b); break;
    case 'curve': out.a = mp(s.a); out.b = mp(s.b); out.c = mp(s.c); break;
    case 'circle': out.c = mp(s.c); out.r = Math.abs(s.r * k); break;
    case 'rect': {
      const q0 = mp({ x: s.x, y: s.y });
      const q1 = mp({ x: s.x + s.w, y: s.y + s.h });
      out.x = Math.min(q0.x, q1.x); out.y = Math.min(q0.y, q1.y);
      out.w = Math.abs(q1.x - q0.x); out.h = Math.abs(q1.y - q0.y);
      break;
    }
    case 'region': out.loops = s.loops.map((l) => l.map(mp)); break;
  }
  keepRecipe(out, s, [k, 0, 0, k, cx * (1 - k), cy * (1 - k)]);
  return out;
}

/* Mirror a mark about a line through (cx, cy), across or down. A
   rectangle mirrors to a rectangle, so unlike a turn it stays one. */
function flipShape(s, cx, cy, axis) {
  const mp = (p) => (axis === 'x'
    ? { x: 2 * cx - p.x, y: p.y }
    : { x: p.x, y: 2 * cy - p.y });
  const out = Object.assign({}, s);
  switch (s.kind) {
    // A loop turned over runs the other way round; even-odd filling does
    // not care, and neither does a stroke.
    case 'path': case 'poly': out.pts = s.pts.map(mp); break;
    case 'line': out.a = mp(s.a); out.b = mp(s.b); break;
    case 'curve': out.a = mp(s.a); out.b = mp(s.b); out.c = mp(s.c); break;
    case 'circle': out.c = mp(s.c); break;
    case 'rect': {
      const q0 = mp({ x: s.x, y: s.y });
      const q1 = mp({ x: s.x + s.w, y: s.y + s.h });
      out.x = Math.min(q0.x, q1.x); out.y = Math.min(q0.y, q1.y);
      break;
    }
    case 'region': out.loops = s.loops.map((l) => l.map(mp)); break;
  }
  keepRecipe(out, s, axis === 'x' ? [-1, 0, 0, 1, 2 * cx, 0] : [1, 0, 0, -1, 0, 2 * cy]);
  return out;
}

function rotateShape(s, cx, cy, ang) {
  const c = Math.cos(ang), n = Math.sin(ang);
  const mp = (p) => {
    const dx = p.x - cx, dy = p.y - cy;
    return { x: cx + dx * c - dy * n, y: cy + dx * n + dy * c };
  };
  const out = Object.assign({}, s);
  switch (s.kind) {
    case 'path': case 'poly': out.pts = s.pts.map(mp); break;
    case 'line': out.a = mp(s.a); out.b = mp(s.b); break;
    case 'curve': out.a = mp(s.a); out.b = mp(s.b); out.c = mp(s.c); break;
    case 'circle': out.c = mp(s.c); break;
    case 'rect': {
      const { x, y, w, h } = s;
      out.kind = 'poly';
      out.pts = [{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }].map(mp);
      delete out.x; delete out.y; delete out.w; delete out.h;
      break;
    }
    case 'region': out.loops = s.loops.map((l) => l.map(mp)); break;
  }
  keepRecipe(out, s, [c, n, -n, c, cx - c * cx + n * cy, cy - n * cx - c * cy]);
  return out;
}

function translateShape(s, dx, dy) {
  const mp = (p) => ({ x: p.x + dx, y: p.y + dy });
  const out = Object.assign({}, s);
  switch (s.kind) {
    case 'path': case 'poly': out.pts = s.pts.map(mp); break;
    case 'line': out.a = mp(s.a); out.b = mp(s.b); break;
    case 'curve': out.a = mp(s.a); out.b = mp(s.b); out.c = mp(s.c); break;
    case 'circle': out.c = mp(s.c); break;
    case 'rect': out.x = s.x + dx; out.y = s.y + dy; break;
    case 'region': out.loops = s.loops.map((l) => l.map(mp)); break;
  }
  keepRecipe(out, s, [1, 0, 0, 1, dx, dy]);
  return out;
}

function shapeBBox(s) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const addX = (x) => { if (x < x0) x0 = x; if (x > x1) x1 = x; };
  const addY = (y) => { if (y < y0) y0 = y; if (y > y1) y1 = y; };
  const add = (x, y) => { addX(x); addY(y); };

  switch (s.kind) {
    case 'path': case 'poly': for (const p of s.pts) add(p.x, p.y); break;
    case 'line': add(s.a.x, s.a.y); add(s.b.x, s.b.y); break;
    case 'curve': {
      // Use the curve's own turning point, not the control point,
      // which usually sits well outside the drawn arc.
      const ext = (a, c, b) => {
        const den = a - 2 * c + b;
        if (Math.abs(den) < 1e-9) return null;
        const t = (a - c) / den;
        if (t <= 0 || t >= 1) return null;
        return (1 - t) * (1 - t) * a + 2 * (1 - t) * t * c + t * t * b;
      };
      add(s.a.x, s.a.y);
      add(s.b.x, s.b.y);
      const ex = ext(s.a.x, s.c.x, s.b.x);
      const ey = ext(s.a.y, s.c.y, s.b.y);
      if (ex !== null) addX(ex);
      if (ey !== null) addY(ey);
      break;
    }
    case 'circle':
      addX(s.c.x - s.r); addX(s.c.x + s.r);
      addY(s.c.y - s.r); addY(s.c.y + s.r);
      break;
    case 'rect':
      add(s.x, s.y); add(s.x + s.w, s.y + s.h);
      break;
    case 'region':
      for (const l of s.loops) for (const p of l) add(p.x, p.y);
      break;
  }
  if (x0 === Infinity) return null;
  return { x0, y0, x1, y1 };
}

/* The point a shape was snapped by when it was drawn — used so that
   dragging it with snapping on lands it back on the lattice. */
function anchorOf(s) {
  switch (s.kind) {
    case 'path': case 'poly': return s.pts[0];
    case 'line': case 'curve': return s.a;
    case 'circle': return s.c;
    case 'rect': return { x: s.x, y: s.y };
    default: {
      const b = shapeBBox(s);
      return b ? { x: b.x0, y: b.y0 } : { x: 0, y: 0 };
    }
  }
}

/* ---- The 45 degree frame ---------------------------------------
   The isometric frame. Three families of lines a sixth of a turn
   apart — upright, and thirty degrees either side of level — so every
   step from a lattice point is the same length whichever of the six
   ways it goes. That is the thing a square lattice cannot do: a step
   along its diagonal is √2 of a step along its side, turned or not.

   The upright lines are the tile's own columns, T/n apart, so they
   land on its edges. The rows they carry cannot also divide T: a
   triangular lattice and a square tile have no common measure. So
   this frame is a drafting aid within the square rather than
   something that repeats across the seam.
   ---------------------------------------------------------------- */

const ISO_ROW = 2 / Math.sqrt(3);      // the row step that is equilateral

/* Lattice points are i*(w, h/2) + j*(0, h): columns w apart, every
   other column dropped half a row, which is what makes the triangles.

   A row step of 2/√3 columns makes those triangles exactly equilateral
   — and leaves the lattice unable to repeat. The tile is a whole number
   of columns across but 0.866·n rows down, so every seam catches the
   rows partway through a step and the plane does not meet itself. On a
   tiling, repeating wins: the rows are laid a whole number to the tile,
   at the count nearest that ratio, which is within one per cent of
   equilateral from eight columns up and never worse than a sixth.

   The columns have to come in pairs too. The thirty degree lines climb
   half a row per column, so crossing a tile they climb n/2 rows — whole
   only when n is even. An odd count is taken up to the next even one
   rather than drawn knowing it cannot meet itself across the seam. */
function isoBasis(n, skip) {
  /* `skip` is how many times the zoom has halved the lattice. The finer
     level has to be the picked one subdivided, not a lattice worked out
     afresh for twice the count: the rows are rounded to fit the tile,
     and twice a rounding is not the rounding of twice, so the two came
     out crossing each other instead of nesting. */
  const s = Math.max(1, skip || 1);
  const cols = n + (n & 1);
  const rows = Math.max(1, Math.round(cols / ISO_ROW));
  return { w: T / (cols * s), h: T / (rows * s), cols: cols * s, rows: rows * s };
}

// The six ways out of a lattice point, all the same length.
function isoDirs(n, skip) {
  const { w, h } = isoBasis(n, skip);
  return [
    { x: w, y: h / 2 }, { x: 0, y: h }, { x: -w, y: h / 2 },
    { x: -w, y: -h / 2 }, { x: 0, y: -h }, { x: w, y: -h / 2 },
  ];
}

function snapIso(p, n, skip) {
  const { w, h } = isoBasis(n, skip);
  const i = p.x / w;
  let best = null, bd = Infinity;
  // The cell is a rhombus, so the nearest point is one of its corners:
  // the two columns either side, and a row either side of each.
  for (const ii of [Math.floor(i), Math.ceil(i)]) {
    const jr = p.y / h - ii / 2;
    for (const jj of [Math.floor(jr), Math.ceil(jr)]) {
      const q = { x: ii * w, y: (jj + ii / 2) * h };
      const d = (q.x - p.x) * (q.x - p.x) + (q.y - p.y) * (q.y - p.y);
      if (d < bd) { bd = d; best = q; }
    }
  }
  return best;
}

/* The rhombus a corner-to-corner drag makes on this frame. The drag
   lies in one of the six wedges between neighbouring directions; those
   two are its sides, which is why every box drawn this way is a face of
   an isometric cube. The far corner stays under the cursor. */
function isoRhombus(a, b, n, skip) {
  const dirs = isoDirs(n, skip);
  const vx = b.x - a.x, vy = b.y - a.y;
  for (let k = 0; k < 6; k++) {
    const u = dirs[k], t = dirs[(k + 1) % 6];
    const det = u.x * t.y - u.y * t.x;
    if (!det) continue;
    const s = (vx * t.y - vy * t.x) / det;
    const r = (u.x * vy - u.y * vx) / det;
    if (s < -1e-9 || r < -1e-9) continue;
    return [
      { x: a.x, y: a.y },
      { x: a.x + u.x * s, y: a.y + u.y * s },
      { x: a.x + vx, y: a.y + vy },
      { x: a.x + t.x * r, y: a.y + t.y * r },
    ];
  }
  return [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
}

// Hold a run to one of the six ways out, a whole number of steps along.
function isoRun(a, w, n, quantise, skip) {
  const dirs = isoDirs(n, skip);
  const vx = w.x - a.x, vy = w.y - a.y;
  const len = Math.hypot(vx, vy);
  if (len < 1e-9) return { x: a.x, y: a.y };
  let best = dirs[0], bd = -Infinity;
  for (const d of dirs) {
    const dl = Math.hypot(d.x, d.y);
    const dot = (vx * d.x + vy * d.y) / dl;
    if (dot > bd) { bd = dot; best = d; }
  }
  const step = Math.hypot(best.x, best.y);
  const ux = best.x / step, uy = best.y / step;
  const along = Math.max(0, vx * ux + vy * uy);
  const q = quantise ? Math.max(step, Math.round(along / step) * step) : along;
  return { x: a.x + ux * q, y: a.y + uy * q };
}

/* Tidy a freehand stroke: ease its wobble out over `radius`, then drop
   the points that no longer carry any shape (`eps`).

   The easing is a gaussian taken along the stroke's own length — the
   stroke is first laid out in even steps, a third of the radius apart —
   so it smooths the same however fast or slow the hand moved, and a
   bigger radius reaches a broader wobble. Easing a point with its
   neighbours only, as this used to, took out the jitter between one
   sample and the next and nothing longer, however many times it ran.
   The ends are pinned, and the easing narrows towards them, so the
   stroke still starts and finishes where the hand did. */
function smoothPath(pts, eps, radius) {
  if (pts.length < 3) return pts;
  if (!(radius > 0)) return simplify(pts, eps);
  const step = radius / 3;
  const even = [pts[0]];
  let since = 0;                       // how far along since the last step laid
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    let t = step - since;
    for (; t <= len; t += step) {
      even.push({ x: a.x + ((b.x - a.x) * t) / len, y: a.y + ((b.y - a.y) * t) / len });
    }
    since = len - (t - step);
  }
  even.push(pts[pts.length - 1]);
  const n = even.length;
  const reach = 9;                     // three standard deviations, in steps
  const weight = [];
  for (let k = 0; k <= reach; k++) weight.push(Math.exp(-(k * k) / 18));
  const eased = even.map((p, i) => {
    const w = Math.min(reach, i, n - 1 - i);
    let sx = 0, sy = 0, sw = 0;
    for (let k = -w; k <= w; k++) {
      const q = even[i + k], g = weight[k < 0 ? -k : k];
      sx += q.x * g; sy += q.y * g; sw += g;
    }
    return { x: sx / sw, y: sy / sw };
  });
  return simplify(eased, eps);
}

/* The loose ends of an open mark. Closed shapes have none. */
function endpointsOf(s) {
  if (s.kind === 'line' || s.kind === 'curve') return [s.a, s.b];
  if (s.kind === 'path' && s.pts.length) return [s.pts[0], s.pts[s.pts.length - 1]];
  return [];
}

/* Points on an existing mark that are worth snapping to. The pencil is
   left out on purpose: freehand has nothing to do with the grid or with
   these. A circle's rim is handled by the caller, since the nearest
   point on it depends on where the cursor is. */
function snapPointsOf(s) {
  const at = (p, kind) => ({ x: p.x, y: p.y, kind });
  switch (s.kind) {
    case 'line':
      return [at(s.a, 'end'), at(s.b, 'end'),
        { x: (s.a.x + s.b.x) / 2, y: (s.a.y + s.b.y) / 2, kind: 'mid' }];
    case 'curve':
      // the point halfway along the arc, not halfway along its chord
      return [at(s.a, 'end'), at(s.b, 'end'), {
        x: (s.a.x + 2 * s.c.x + s.b.x) / 4,
        y: (s.a.y + 2 * s.c.y + s.b.y) / 4,
        kind: 'mid',
      }];
    case 'circle':
      return [
        at(s.c, 'centre'),
        { x: s.c.x - s.r, y: s.c.y, kind: 'edge' },
        { x: s.c.x + s.r, y: s.c.y, kind: 'edge' },
        { x: s.c.x, y: s.c.y - s.r, kind: 'edge' },
        { x: s.c.x, y: s.c.y + s.r, kind: 'edge' },
      ];
    case 'rect':
      return [
        { x: s.x, y: s.y, kind: 'corner' },
        { x: s.x + s.w, y: s.y, kind: 'corner' },
        { x: s.x + s.w, y: s.y + s.h, kind: 'corner' },
        { x: s.x, y: s.y + s.h, kind: 'corner' },
        { x: s.x + s.w / 2, y: s.y + s.h / 2, kind: 'centre' },
      ];
    case 'poly':
      return s.pts.map((p) => at(p, 'corner'));
    case 'path':
      // Freehand ignores the lattice, but where it started and stopped
      // is still somewhere another mark may want to meet it.
      return s.pts.length ? [at(s.pts[0], 'end'), at(s.pts[s.pts.length - 1], 'end')] : [];
    default:
      return [];
  }
}

/* Put `m` on the perpendicular bisector of a-b, keeping how far out it
   is. An arc bent through a point on that line is symmetrical: its apex
   sits square above the middle of its chord. */
function bisectorFoot(a, b, m) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len < 1e-9) return m;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const nx = -dy / len, ny = dx / len;
  const t = (m.x - mid.x) * nx + (m.y - mid.y) * ny;
  return { x: mid.x + nx * t, y: mid.y + ny * t };
}

/* ---- Putting a traced fill onto the real edges ------------------
   A raster flood can only place a boundary to the nearest cell, so a
   fill traced from one either falls short of the mark that bounds it or
   spills past it. The marks themselves are exact though, so the traced
   ring is used for its topology only — which area was clicked — and each
   of its points is then moved onto the true edge of whichever mark it is
   closest to, half that mark's width out from its centreline, less a
   hair so it tucks under rather than meeting it exactly.
   ---------------------------------------------------------------- */

function nearestOnSegment(a, b, v) {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 < 1e-12 ? 0 : Math.max(0, Math.min(1, ((v.x - a.x) * dx + (v.y - a.y) * dy) / len2));
  const p = { x: a.x + dx * t, y: a.y + dy * t };
  return { p, d: Math.hypot(v.x - p.x, v.y - p.y) };
}

function nearestOnPolyline(pts, v, closed) {
  let best = null;
  const n = pts.length;
  for (let i = 0; i + 1 < n || (closed && i < n); i++) {
    const hit = nearestOnSegment(pts[i % n], pts[(i + 1) % n], v);
    if (!best || hit.d < best.d) best = hit;
  }
  return best;
}

function nearestOnShape(s, v) {
  switch (s.kind) {
    case 'line':
      return nearestOnSegment(s.a, s.b, v);
    case 'curve': {
      // sample the arc, then bisect around the closest sample
      const at = (t) => { const u = 1 - t; return {
        x: u * u * s.a.x + 2 * u * t * s.c.x + t * t * s.b.x,
        y: u * u * s.a.y + 2 * u * t * s.c.y + t * t * s.b.y }; };
      let bt = 0, bd = Infinity;
      for (let i = 0; i <= 24; i++) {
        const t = i / 24, d = Math.hypot(at(t).x - v.x, at(t).y - v.y);
        if (d < bd) { bd = d; bt = t; }
      }
      let step = 1 / 24;
      for (let k = 0; k < 12; k++) {
        step /= 2;
        for (const t of [bt - step, bt + step]) {
          if (t < 0 || t > 1) continue;
          const d = Math.hypot(at(t).x - v.x, at(t).y - v.y);
          if (d < bd) { bd = d; bt = t; }
        }
      }
      return { p: at(bt), d: bd };
    }
    case 'circle': {
      const dx = v.x - s.c.x, dy = v.y - s.c.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return null;
      return { p: { x: s.c.x + (dx / len) * s.r, y: s.c.y + (dy / len) * s.r }, d: Math.abs(len - s.r) };
    }
    case 'rect':
      return nearestOnPolyline([
        { x: s.x, y: s.y }, { x: s.x + s.w, y: s.y },
        { x: s.x + s.w, y: s.y + s.h }, { x: s.x, y: s.y + s.h },
      ], v, true);
    case 'poly':
      return nearestOnPolyline(s.pts, v, true);
    case 'path':
      return s.pts.length > 1 ? nearestOnPolyline(s.pts, v, false) : null;
    default:
      return null;
  }
}

/* Put a point at `want` from a wall's centreline, on the side it is
   already on. */
function offWall(s, v, want) {
  const hit = nearestOnShape(s, v);
  if (!hit || hit.d < 1e-6) return null;
  const k = want / hit.d;
  return { x: hit.p.x + (v.x - hit.p.x) * k, y: hit.p.y + (v.y - hit.p.y) * k };
}

/* Two points on the same wall are joined by a straight chord, and along
   a round wall that chord cuts inside it — by the sagitta, which on a
   circle of any size grows as the square of the gap between them. The
   points were tucked a hair under the ink; the chord between them was
   not, and came out from under it, leaving a bare crescent between fill
   and border. So the wall is followed: halve the chord, put the middle
   back on the wall, and keep halving until what is left is under a
   quarter unit. A straight wall passes the test first time and gains
   nothing. */
function followWall(s, a, b, want, depth, out) {
  if (depth <= 0) return;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const q = offWall(s, mid, want);
  if (!q) return;
  if (Math.hypot(q.x - mid.x, q.y - mid.y) < 0.15) return;
  followWall(s, a, q, want, depth - 1, out);
  out.push(q);
  followWall(s, q, b, want, depth - 1, out);
}

function snapLoopsToWalls(loops, walls, tol, inset) {
  if (!walls.length) return loops;
  return loops.map((loop) => {
    const put = loop.map((v) => {
      let best = null, bestErr = tol;
      for (const s of walls) {
        const half = (s.filled ? 0 : s.width) / 2;
        if (half <= 0) continue;
        const hit = nearestOnShape(s, v);
        if (!hit || hit.d < 1e-6) continue;
        const err = Math.abs(hit.d - half);
        if (err < bestErr) { bestErr = err; best = { hit, half, wall: s }; }
      }
      if (!best) return { p: v, wall: null, want: 0 };
      const want = Math.max(0, best.half - inset);
      const k = want / best.hit.d;
      return {
        p: {
          x: best.hit.p.x + (v.x - best.hit.p.x) * k,
          y: best.hit.p.y + (v.y - best.hit.p.y) * k,
        },
        wall: best.wall,
        want,
      };
    });

    const out = [];
    for (let i = 0; i < put.length; i++) {
      const a = put[i], b = put[(i + 1) % put.length];
      out.push(a.p);
      if (a.wall && a.wall === b.wall) followWall(a.wall, a.p, b.p, a.want, 6, out);
    }
    return out;
  });
}
