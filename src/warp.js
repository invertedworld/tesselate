/* ------------------------------------------------------------------
   warp.js — bending the plane without touching the drawing.

   A warp is a way of looking at the plane, the way the 45° frame is:
   the marks stay exactly as drawn, in tile units, and every point is
   carried through the warp on its way out to the screen and back
   through it on its way in from the pointer. Nothing that works on the
   marks themselves — snapping, hit tests, the fill tracer — has to know.

   The warp is a FLOW. Each anchor is a field of velocities that is zero
   outside its disc: a push out from its centre (bulge, or a pull in —
   pinch) and a push round it (twirl), both fading to nothing at the
   rim. A point is carried along the sum of every field for one unit of
   time. That is chosen over moving points directly because a flow can
   never fold: however strong the anchors are and however they overlap,
   no two points land on one. Every point on screen has exactly one
   point of the drawing under it, and running the same flow backwards
   finds it.

   Anchors sit one of two ways:
     plane   once, at a place on the plane — a lens laid over it
     tile    in every square, turned with it — the warp repeats exactly
             as the drawing does, so what comes out is still a tiling

   Needs geometry.js (T, mod, n2, simplify) and patterns.js (the tilings).
   ------------------------------------------------------------------ */

const WARP_BULGE = 1.5;          // full bulge: the centre drawn e^1.5, about 4.5 times up
const WARP_TWIRL = 2 * Math.PI;  // full twirl: the centre turned once round

const clamp01 = (v) => (v > 0 ? (v < 1 ? v : 1) : 0);

function placeOn(p, i, j, pattern) {
  return tilingOf(pattern).place(p, pattern, i, j);
}

function takeOff(w, i, j, pattern) {
  return tilingOf(pattern).unplace(w, pattern, i, j);
}

const NO_WARP = {
  active: false, tiled: false, sig: 'none', reach: 0, minR: Infinity, mag: 1, seg: Infinity, steps: 0,
  warp: (p) => p, unwarp: (p) => p, touches: () => false,
};

/* `skip` leaves one anchor out — the one being dragged, so the pointer
   is taken back through everything but the thing it is moving. */
function makeWarp(spec, pattern, skip) {
  const amt = spec ? clamp01(spec.amount) : 0;
  const tiled = !!spec && spec.repeat === 'tile';
  const live = [];
  if (amt > 0) {
    (spec.anchors || []).forEach((a, k) => {
      if (k !== skip && a.r > 0 && (a.bulge || a.twirl)) live.push(a);
    });
  }
  if (!live.length) return NO_WARP;

  const A = live.length, n = pattern.n;
  const tl = tilingOf(pattern), per = tl.per(n);
  const R2 = new Float64Array(A), KB = new Float64Array(A), KT = new Float64Array(A);
  let reach = 0, minR = Infinity, mag = 1;
  live.forEach((a, k) => {
    R2[k] = a.r * a.r;
    KB[k] = a.bulge * WARP_BULGE * amt;
    KT[k] = a.twirl * WARP_TWIRL * amt;
    reach = Math.max(reach, a.r);
    minR = Math.min(minR, a.r);
    mag = Math.max(mag, Math.exp(Math.abs(KB[k])) * (1 + Math.abs(KT[k])));
  });

  /* Where each disc sits, listed per tile of the block: every disc —
     the tile's own or a neighbour's — that reaches into that tile, as
     an offset from the tile's middle. A point asks only the list for
     the tile it is in. On the plane there is one list, of every anchor
     where it was put. A tile anywhere is its block tile moved whole
     blocks, so the lists serve the whole plane. */
  const XS = [], YS = [], KS = [];
  if (!tiled) {
    XS.push(Float64Array.from(live, (a) => a.x));
    YS.push(Float64Array.from(live, (a) => a.y));
    KS.push(Int32Array.from(live, (a, k) => k));
  } else {
    const ring = Math.ceil(reach / T);
    for (let cj = 0; cj < n; cj++) {
      for (let ci = 0; ci < per; ci++) {
        const o = tl.origin(ci, cj);
        const xs = [], ys = [], ks = [];
        for (const c of tl.around(ci, cj, ring)) {
          for (let k = 0; k < A; k++) {
            const q = placeOn(live[k], c.i, c.j, pattern);
            const x = q.x - o.x, y = q.y - o.y;
            // Near enough the tile — within its round — to be asked about.
            const d = Math.max(0, Math.hypot(x, y) - tl.outR);
            if (d * d < R2[k]) { xs.push(x); ys.push(y); ks.push(k); }
          }
        }
        XS.push(Float64Array.from(xs));
        YS.push(Float64Array.from(ys));
        KS.push(Int32Array.from(ks));
      }
    }
  }

  // Enough steps that the way back retraces the way out to well under a
  // unit, judged by the most any one square has piled on it.
  let rate = 0;
  for (const ks of KS) {
    let r = 0;
    for (const k of ks) r += Math.abs(KB[k]) + 2 * Math.abs(KT[k]);
    rate = Math.max(rate, r);
  }
  const steps = Math.min(96, Math.max(3, Math.ceil(rate * 2.5)));

  const V = new Float64Array(2);
  function vel(x, y) {
    let vx = 0, vy = 0, ox = 0, oy = 0, cell = 0;
    if (tiled) {
      const c = cellAt(pattern, { x, y });
      const o = tl.origin(c.i, c.j);
      ox = o.x; oy = o.y;
      cell = tl.index(pattern, c.i, c.j);
    }
    const xs = XS[cell], ys = YS[cell], ks = KS[cell];
    for (let m = 0; m < xs.length; m++) {
      const k = ks[m];
      const dx = x - ox - xs[m], dy = y - oy - ys[m];
      const d2 = dx * dx + dy * dy;
      if (d2 >= R2[k]) continue;
      // (1 - u²)², which meets the rim flat, so nothing kinks there.
      const e = 1 - d2 / R2[k], f = e * e;
      vx += (KB[k] * dx - KT[k] * dy) * f;
      vy += (KB[k] * dy + KT[k] * dx) * f;
    }
    V[0] = vx; V[1] = vy;
  }

  // Classic Runge–Kutta. A point with nowhere to go stays put, which is
  // every point outside the discs: those cost one look and no more.
  function flow(p, dir) {
    let x = p.x, y = p.y;
    vel(x, y);
    if (V[0] === 0 && V[1] === 0) return { x, y };
    const h = dir / steps;
    for (let s = 0; s < steps; s++) {
      if (s) vel(x, y);
      const ax = V[0], ay = V[1];
      vel(x + (ax * h) / 2, y + (ay * h) / 2);
      const bx = V[0], by = V[1];
      vel(x + (bx * h) / 2, y + (by * h) / 2);
      const cx = V[0], cy = V[1];
      vel(x + cx * h, y + cy * h);
      x += (h / 6) * (ax + 2 * bx + 2 * cx + V[0]);
      y += (h / 6) * (ay + 2 * by + 2 * cy + V[1]);
    }
    return { x, y };
  }

  /* Does any disc, at any place it sits, reach into the box? A copy of a
     mark that none reaches is drawn exactly as it always was. */
  function touches(b) {
    const hit = (xs, ys, ks, ox, oy) => {
      for (let m = 0; m < xs.length; m++) {
        const x = xs[m] + ox, y = ys[m] + oy;
        const dx = Math.max(b.x0 - x, 0, x - b.x1), dy = Math.max(b.y0 - y, 0, y - b.y1);
        if (dx * dx + dy * dy < R2[ks[m]]) return true;
      }
      return false;
    };
    if (!tiled) return hit(XS[0], YS[0], KS[0], 0, 0);
    const g = tl.square ? 0 : tl.outR;
    const r = tl.square
      ? { i0: Math.floor(b.x0 / T), i1: Math.floor(b.x1 / T), j0: Math.floor(b.y0 / T), j1: Math.floor(b.y1 / T) }
      : tl.range(b.x0 - g, b.y0 - g, b.x1 + g, b.y1 + g);
    if ((r.i1 - r.i0 + 1) * (r.j1 - r.j0 + 1) > 4096) return true;
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const cell = tl.index(pattern, i, j);
        const o = tl.origin(i, j);
        if (hit(XS[cell], YS[cell], KS[cell], o.x, o.y)) return true;
      }
    }
    return false;
  }

  return {
    active: true,
    sig: JSON.stringify([amt, tiled, tl.id, n, pattern.cells, skip, live.map((a) => [a.x, a.y, a.r, a.bulge, a.twirl])]),
    tiled, reach, minR, mag, steps,
    seg: minR / 3,     // no straight run longer than this goes through a disc unsplit
    warp: (p) => flow(p, 1),
    unwarp: (p) => flow(p, -1),
    touches,
  };
}

/* Where anchor k has to be for its dot to show at `p` on the plane.

   An anchor never moves its own centre, but the anchors around it do,
   and then its own flow carries the difference on — a bulge doubles it.
   So an anchor put down, or dragged, inside another disc would not land
   under the hand if it were simply taken back through the warp. Newton's
   method on the whole warp, the anchor's own field travelling with it,
   puts it there. `own` turns a place on the plane into the anchor's own
   coordinates: the place itself for a lens, its square's frame for one
   that repeats. */
function aimAnchor(spec, pattern, k, p, own) {
  const shown = (c) => {
    const anchors = spec.anchors.slice();
    anchors[k] = Object.assign({}, spec.anchors[k], own(c));
    return makeWarp(Object.assign({}, spec, { anchors }), pattern).warp(c);
  };
  let c = makeWarp(spec, pattern, k).unwarp(p);
  let q = shown(c), err = Math.hypot(p.x - q.x, p.y - q.y);
  for (let it = 0; it < 12 && err > 0.02; it++) {
    const h = 0.5;
    const qx = shown({ x: c.x + h, y: c.y }), qy = shown({ x: c.x, y: c.y + h });
    const a = (qx.x - q.x) / h, b = (qy.x - q.x) / h, cc = (qx.y - q.y) / h, d = (qy.y - q.y) / h;
    const det = a * d - b * cc;
    if (!(Math.abs(det) > 1e-9)) break;
    const ex = p.x - q.x, ey = p.y - q.y;
    let sx = (d * ex - b * ey) / det, sy = (a * ey - cc * ex) / det;
    let next, nq, nerr, tries = 0;
    do {                                      // halve the step until it helps
      next = { x: c.x + sx, y: c.y + sy };
      nq = shown(next);
      nerr = Math.hypot(p.x - nq.x, p.y - nq.y);
      sx /= 2; sy /= 2;
    } while (nerr >= err && ++tries < 6);
    if (nerr >= err) break;
    c = next; q = nq; err = nerr;
  }
  return c;
}

/* ---- Laying a mark through the warp ---------------------------------

   A mark is taken apart into runs of pieces — each piece a t ∈ [0, 1]
   going to a point, carrying on from where the last one stopped, so a
   corner between two pieces stays a corner. Those are laid flat first,
   as a polyline close enough to the mark to survive the most the warp
   magnifies, and pared of the points that carry no shape; then each
   straight run is walked through the warp and split wherever the chord
   between two warped points strays from the bent run by more than
   `tol`. */

// A piece hands back its own end points at 0 and 1, so pieces meeting at
// a corner meet at one object and that corner is warped once.
const lerpPiece = (a, b) => ({
  base: 1,
  at: (t) => (t === 0 ? a : t === 1 ? b : { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }),
});

/* A quadratic bows furthest from its chord at its middle, so one split
   looked at there is enough to start from; how long it could be is its
   control polygon, which the curve never outruns. */
const quadPiece = (a, c, b) => ({
  base: 1,
  len: Math.hypot(c.x - a.x, c.y - a.y) + Math.hypot(b.x - c.x, b.y - c.y),
  at: (t) => {
    if (t === 0) return a;
    if (t === 1) return b;
    const u = 1 - t;
    return { x: u * u * a.x + 2 * u * t * c.x + t * t * b.x, y: u * u * a.y + 2 * u * t * c.y + t * t * b.y };
  },
});

function circleRun(c, r) {
  const start = { x: c.x + r, y: c.y };
  return {
    closed: true,
    pieces: [{
      base: 16, len: 2 * Math.PI * r,
      at: (t) => (t === 0 || t === 1 ? start
        : { x: c.x + r * Math.cos(2 * Math.PI * t), y: c.y + r * Math.sin(2 * Math.PI * t) }),
    }],
  };
}

function polyRun(pts, closed) {
  const pieces = [];
  const m = closed ? pts.length : pts.length - 1;
  for (let k = 0; k < m; k++) pieces.push(lerpPiece(pts[k], pts[(k + 1) % pts.length]));
  return { closed, pieces };
}

function warpRuns(s) {
  switch (s.kind) {
    case 'line': return [polyRun([s.a, s.b], false)];
    case 'curve': return [{ closed: false, pieces: [quadPiece(s.a, s.c, s.b)] }];
    case 'circle': return [circleRun(s.c, Math.max(0.4, s.r))];
    case 'rect': {
      const { x, y, w, h } = s;
      return [polyRun([{ x, y }, { x: x + w, y }, { x: x + w, y: y + h }, { x, y: y + h }], true)];
    }
    case 'poly': return s.pts.length ? [polyRun(s.pts, true)] : [];
    case 'region': return s.loops.filter((l) => l.length >= 3).map((l) => polyRun(l, true));
    case 'path': {
      // The same quadratics through the midpoints buildPath draws.
      const pts = s.pts;
      if (!pts.length) return [];
      if (pts.length === 1) return [polyRun([pts[0], { x: pts[0].x + 0.01, y: pts[0].y }], false)];
      if (pts.length === 2) return [polyRun(pts, false)];
      const pieces = [];
      let from = pts[0];
      for (let i = 1; i < pts.length - 1; i++) {
        const to = { x: (pts[i].x + pts[i + 1].x) / 2, y: (pts[i].y + pts[i + 1].y) / 2 };
        pieces.push(quadPiece(from, pts[i], to));
        from = to;
      }
      pieces.push(lerpPiece(from, pts[pts.length - 1]));
      return [{ closed: false, pieces }];
    }
  }
  return [];
}

function refine(at, map, t0, q0, t1, q1, tol2, depth, out) {
  if (depth > 9) return;
  const tm = (t0 + t1) / 2, qm = map(at(tm));
  const ex = qm.x - (q0.x + q1.x) / 2, ey = qm.y - (q0.y + q1.y) / 2;
  if (ex * ex + ey * ey <= tol2) return;
  refine(at, map, t0, q0, tm, qm, tol2, depth + 1, out);
  out.push(qm);
  refine(at, map, tm, qm, t1, q1, tol2, depth + 1, out);
}

/* Runs to polylines: [{ closed, pts }]. `seg` is how short a piece has to
   be before a single midpoint can be trusted to tell whether it bends —
   a line through a bulge can come back to its chord at the middle and
   still bow either side of it. */
function layRuns(runs, map, tol, seg) {
  const tol2 = tol * tol;
  const out = [];
  for (const run of runs) {
    const pts = [];
    let last = null;
    for (const piece of run.pieces) {
      const a = piece.at(0), b = piece.at(1);
      const size = piece.len || Math.hypot(b.x - a.x, b.y - a.y);
      const splits = Math.min(512, Math.max(piece.base, Math.ceil(size / seg)));
      let t0 = 0, q0 = last || map(a);
      if (!last) pts.push(q0);
      for (let s = 1; s <= splits; s++) {
        const t1 = s / splits, q1 = map(piece.at(t1));
        refine(piece.at, map, t0, q0, t1, q1, tol2, 0, pts);
        pts.push(q1);
        t0 = t1; q0 = q1;
      }
      last = q0;
    }
    if (run.closed && pts.length > 2) pts.pop();   // it came back round to where it started
    out.push({ closed: run.closed, pts });
  }
  return out;
}

// Drop the points that carry no shape. A pencil stroke kept as drawn has
// one every unit or two, and every one of them would be warped.
function pared(line, eps) {
  if (line.pts.length < 3) return line;
  if (!line.closed) return { closed: false, pts: simplify(line.pts, eps) };
  const ring = simplify(line.pts.concat([line.pts[0]]), eps);
  ring.pop();
  return { closed: true, pts: ring.length >= 3 ? ring : line.pts };
}

// A map that warps each point object once, however many pieces share it.
function once(map) {
  const seen = new Map();
  return (p) => {
    let q = seen.get(p);
    if (!q) { q = map(p); seen.set(p, q); }
    return q;
  };
}

/* ---- A stroke as the area it covers ---------------------------------

   Stroking a warped centreline keeps the width the mark was given, and
   a lens that magnifies the paper should magnify the ink on it. It also
   has to: a fill is tucked a hair under the edge of the stroke around
   it, and in a bulge that edge moves out while a constant stroke stays
   put, leaving a ring of bare paper between fill and border. So the
   stroke is outlined where it is still flat — one piece per segment,
   one per join, one per round end, every piece wound the same way — and
   the outline is warped as an area. Filled nonzero, the pieces make
   their union once over, so translucent ink stays even where they
   overlap. The warp is a flow, and a flow never turns anything over,
   so the winding survives it. */

function woundUp(poly) {
  let a = 0;
  for (let i = 0, n = poly.length; i < n; i++) {
    const p = poly[i], q = poly[(i + 1) % n];
    a += p.x * q.y - q.x * p.y;
  }
  if (Math.abs(a) < 1e-9) return null;
  return a < 0 ? poly.reverse() : poly;
}

function strokeOutline(lines, half, cap, join) {
  const out = [];
  const add = (poly) => { const w = woundUp(poly); if (w) out.push(w); };
  const arcInto = (c, a0, sweep, list) => {
    const steps = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 16)));
    for (let s = 1; s < steps; s++) {
      const a = a0 + (sweep * s) / steps;
      list.push({ x: c.x + Math.cos(a) * half, y: c.y + Math.sin(a) * half });
    }
  };
  const off = (p, nm, side) => ({ x: p.x + nm.x * half * side, y: p.y + nm.y * half * side });

  for (const line of lines) {
    const P = [];
    for (const p of line.pts) {
      const q = P[P.length - 1];
      if (!q || Math.hypot(p.x - q.x, p.y - q.y) > 1e-6) P.push(p);
    }
    let closed = line.closed;
    if (closed && P.length > 1 && Math.hypot(P[0].x - P[P.length - 1].x, P[0].y - P[P.length - 1].y) < 1e-6) P.pop();
    if (P.length < 2) {
      if (P.length === 1 && cap === 'round') {
        const disc = [];
        arcInto(P[0], 0, 2 * Math.PI, disc);
        add(disc);
      }
      continue;
    }
    if (closed && P.length < 3) closed = false;
    const m = closed ? P.length : P.length - 1;
    const N = [];
    for (let k = 0; k < m; k++) {
      const a = P[k], b = P[(k + 1) % P.length];
      const len = Math.hypot(b.x - a.x, b.y - a.y);
      N.push({ x: -(b.y - a.y) / len, y: (b.x - a.x) / len });
    }
    // The segment, through its own centre points, so the join beside it
    // shares an edge with it exactly and no sliver can open between.
    for (let k = 0; k < m; k++) {
      const a = P[k], b = P[(k + 1) % P.length], nk = N[k];
      add([a, off(a, nk, 1), off(b, nk, 1), b, off(b, nk, -1), off(a, nk, -1)]);
    }
    const joinAt = (p, n1, n2) => {
      const cross = n1.x * n2.y - n1.y * n2.x;
      const dot = n1.x * n2.x + n1.y * n2.y;
      if (Math.abs(cross) < 1e-12 && dot > 0) return;
      const side = cross > 0 ? -1 : 1;        // the outside of the bend
      const o1 = off(p, n1, side), o2 = off(p, n2, side);
      if (join === 'miter') {
        const mx = n1.x + n2.x, my = n1.y + n2.y, ml2 = mx * mx + my * my;
        if (ml2 > 0.04) {                      // canvas's miter limit of 10
          const k = (side * half * 2) / ml2;
          add([p, o1, { x: p.x + mx * k, y: p.y + my * k }, o2]);
        } else {
          add([p, o1, o2]);
        }
        return;
      }
      const a1 = Math.atan2(n1.y * side, n1.x * side);
      let sweep = Math.atan2(n2.y * side, n2.x * side) - a1;
      while (sweep > Math.PI) sweep -= 2 * Math.PI;
      while (sweep < -Math.PI) sweep += 2 * Math.PI;
      const fan = [p, o1];
      arcInto(p, a1, sweep, fan);
      fan.push(o2);
      add(fan);
    };
    for (let k = 0; k + 1 < m; k++) joinAt(P[k + 1], N[k], N[k + 1]);
    if (closed) joinAt(P[0], N[m - 1], N[0]);
    if (!closed && cap === 'round') {
      const n0 = N[0], nl = N[m - 1], p0 = P[0], pl = P[P.length - 1];
      const s = [p0, off(p0, n0, 1)];
      arcInto(p0, Math.atan2(n0.y, n0.x), Math.PI, s);
      s.push(off(p0, n0, -1));
      add(s);
      const e = [pl, off(pl, nl, 1)];
      arcInto(pl, Math.atan2(nl.y, nl.x), -Math.PI, e);
      e.push(off(pl, nl, -1));
      add(e);
    }
  }
  return out;
}

/* ---- One copy of one mark -------------------------------------------

   The copy a square (i, j) shows, carried through the warp and brought
   back into that square's own frame — so the square's quarter-turn can
   still be laid on as a transform, and a tiled warp, which is the same
   in every square a block apart, can be kept once per square of the
   block. `how` says how to paint what comes back: 'stroke' along the
   lines, or filled by the rule it names. */

const WARP_CAPS = { path: ['round', 'round'], rect: ['butt', 'miter'], poly: ['butt', 'miter'] };
const warpCaps = (kind) => WARP_CAPS[kind] || ['butt', 'round'];

function warpMark(s, part, i, j, pattern, field, tol, ink, discs) {
  const map = once((p) => takeOff(field.warp(placeOn(p, i, j, pattern)), i, j, pattern));
  const fine = tol / field.mag;
  const flat = (runs) => layRuns(runs, (p) => p, fine, Infinity).map((l) => pared(l, fine));
  const bent = (lines) => layRuns(lines.map((l) => polyRun(l.pts, l.closed)), map, tol, field.seg);
  const lines = flat(warpRuns(s));
  if (s.layer === 'fill') return { how: 'evenodd', lines: bent(lines) };
  if (s.filled || part === 'inside') return { how: 'nonzero', lines: bent(lines) };
  const [cap, join] = warpCaps(s.kind);
  const half = s.width / 2;
  const ends = flat((discs || []).map((p) => circleRun(p, half)));
  if (ink === 'bend') return { how: 'stroke', cap, join, lines: bent(lines), discs: bent(ends) };
  const polys = strokeOutline(lines, half, cap, join);
  for (const l of ends) {
    const w = woundUp(l.pts.slice());
    if (w) polys.push(w);
  }
  return { how: 'nonzero', lines: bent(polys.map((p) => ({ closed: true, pts: p }))) };
}

function linesData(lines) {
  let d = '';
  for (const l of lines) {
    if (!l.pts.length) continue;
    d += 'M' + l.pts.map((p) => `${n2(p.x)} ${n2(p.y)}`).join('L') + (l.closed ? 'Z' : '');
  }
  return d;
}
