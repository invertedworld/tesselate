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
  const visit = (x, y) => {
    if (wrap) {
      x = x < 0 ? x + W : x >= W ? x - W : x;
      y = y < 0 ? y + H : y >= H ? y - H : y;
    } else if (x < 0 || y < 0 || x >= W || y >= H) {
      return;
    }
    const i = y * W + x;
    if (!mask[i] && !barrier[i]) { mask[i] = 1; stack.push(i); }
  };
  while (stack.length) {
    const i = stack.pop();
    const x = i % W, y = (i - x) / W;
    visit(x - 1, y); visit(x + 1, y); visit(x, y - 1); visit(x, y + 1);
  }
  return mask;
}

function dilate(mask, W, H, passes, wrap) {
  let cur = mask;
  for (let p = 0; p < passes; p++) {
    const next = cur.slice();
    const set = (x, y) => {
      if (wrap) {
        x = x < 0 ? x + W : x >= W ? x - W : x;
        y = y < 0 ? y + H : y >= H ? y - H : y;
      } else if (x < 0 || y < 0 || x >= W || y >= H) {
        return;
      }
      next[y * W + x] = 1;
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        if (!cur[y * W + x]) continue;
        set(x - 1, y); set(x + 1, y); set(x, y - 1); set(x, y + 1);
      }
    }
    cur = next;
  }
  return cur;
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

/* Turn a seed point + barrier grid into a vector `region` shape. */
function traceRegion(barrier, W, H, seed, opts = {}) {
  const grow = opts.grow == null ? 2 : opts.grow;
  const raw = floodMask(barrier, W, H, seed.x | 0, seed.y | 0, opts.wrap);
  if (!raw) return null;
  const mask = grow > 0 ? dilate(raw, W, H, grow, opts.wrap) : raw;
  const s = T / W;
  const eps = opts.eps == null ? 1.1 : opts.eps;
  const loops = maskToLoops(mask, W, H)
    .map((loop) => {
      // Close the ring before simplifying so the seam is not a corner.
      const ring = loop.concat([loop[0]]);
      const simp = simplify(ring, eps);
      simp.pop();
      return simp.map((p) => ({ x: p.x * s, y: p.y * s }));
    })
    .filter((l) => l.length >= 3);
  if (!loops.length) return null;
  // The grown mask comes back too: the caller uses it to work out which
  // marks the area was bounded by.
  return { shape: { kind: 'region', loops }, mask };
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

/* ---- Moving shapes about --------------------------------------- */

// Returns a NEW shape: shapes are treated as immutable so the undo
// stack and the Path2D cache can hold them by identity.
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
   A drafting frame turned an eighth of a turn. The lattice it snaps
   to is the square lattice plus its cell centres, which is the same
   diamond lattice you get by turning the grid 45 degrees — and it
   still repeats exactly every T, so marks placed on it meet across
   the tile seam.
   ---------------------------------------------------------------- */

const DIAG = Math.SQRT1_2;

const toDiag = (p) => ({ x: (p.x + p.y) * DIAG, y: (p.y - p.x) * DIAG });
const fromDiag = (p) => ({ x: (p.x - p.y) * DIAG, y: (p.x + p.y) * DIAG });

function snapDiag(p, n) {
  const d = T / n;
  const u = Math.round((p.x + p.y) / d);
  const v = Math.round((p.x - p.y) / d);
  return { x: ((u + v) * d) / 2, y: ((u - v) * d) / 2 };
}

/* Tidy a freehand stroke: drop the points that carry no shape, then
   ease what is left. The ends are pinned so the stroke still starts
   and finishes where the hand did. */
function smoothPath(pts, eps) {
  if (pts.length < 3) return pts;
  let out = simplify(pts, eps);
  for (let pass = 0; pass < 2 && out.length > 2; pass++) {
    const next = [out[0]];
    for (let i = 1; i < out.length - 1; i++) {
      const a = out[i - 1], b = out[i], c = out[i + 1];
      next.push({ x: (a.x + 2 * b.x + c.x) / 4, y: (a.y + 2 * b.y + c.y) / 4 });
    }
    next.push(out[out.length - 1]);
    out = next;
  }
  return out;
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
    default:
      return [];
  }
}
