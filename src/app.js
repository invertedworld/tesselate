/* ------------------------------------------------------------------
   app.js — the drawing table.

   The model is pure vector: an ordered list of shapes in tile units.
   The plane is drawn by replaying those shapes once per visible tile
   with a quarter-turn from the symmetry block, so every mark appears
   in every tile the instant it is made.
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  /* Palettes. The built-ins are read-only; asking to add a colour to one
     forks it into a palette of your own, which is what you wanted anyway. */
  const BUILT_IN = [
    { name: 'Riso', colors: [
      '#17160f', '#57534a', '#cf4326', '#e2574c', '#e08a1e',
      '#c9a227', '#8fae3c', '#4e8f45', '#237f86', '#2b4a9c',
      '#5aa7d8', '#6c4a9e', '#c4407c', '#f0a6b4', '#fbf9f3',
    ] },
    { name: 'Bauhaus', colors: [
      '#0f0f0f', '#3b3b3b', '#7a7a7a', '#d8d5cc', '#ffffff',
      '#d8232a', '#f06d3a', '#f5a623', '#f4d35e', '#1c4f9c',
      '#2f80ed', '#1f9d8f', '#2aa757', '#8b3f98', '#e56a9c',
    ] },
    { name: 'Graphite', colors: [
      '#0b0b0b', '#1f1e1a', '#35332c', '#4b483f', '#615d52',
      '#787366', '#8f897a', '#a69f8f', '#bdb5a4', '#d3cbba',
      '#e6dfd0', '#f6f2e8', '#ffffff', '#6b5a3e', '#a08654',
    ] },
  ];
  const PALETTE = BUILT_IN[0].colors;

  /* ---------------- colour ----------------
     A colour is '#rrggbb', or '#rrggbbaa' once it is less than solid —
     opaque colours keep their short form so older saves still match. */

  function normHex(str) {
    if (typeof str !== 'string') return null;
    let h = str.trim().replace(/^#/, '').toLowerCase();
    if (!/^[0-9a-f]+$/.test(h)) return null;
    if (h.length === 3 || h.length === 4) h = h.split('').map((c) => c + c).join('');
    if (h.length !== 6 && h.length !== 8) return null;
    if (h.length === 8 && h.slice(6) === 'ff') h = h.slice(0, 6);
    return '#' + h;
  }

  function rgbOf(hex) { return (normHex(hex) || '#17160f').slice(0, 7); }

  function alphaOf(hex) {
    const h = normHex(hex) || '';
    return h.length === 9 ? parseInt(h.slice(7), 16) : 255;
  }

  function withAlpha(hex, a) {
    const v = clamp(Math.round(a), 0, 255);
    return v >= 255 ? rgbOf(hex) : rgbOf(hex) + v.toString(16).padStart(2, '0');
  }

  // SVG keeps colour and opacity in separate attributes, so a translucent
  // mark survives the trip into editors that never learned 8-digit hex.
  function svgPaint(attr, hex) {
    const a = alphaOf(hex);
    return `${attr}="${rgbOf(hex)}"` + (a < 255 ? ` ${attr}-opacity="${+(a / 255).toFixed(4)}"` : '');
  }

  const GROUND = '#ede8db';
  /* The squares themselves read over the lattice inside them: darker,
     and thicker where there is room for it, with the block's own
     boundaries heavier again. A drafting aid sits under the structure it
     is drafted on. */
  const RULE_MINOR = 'rgba(23,22,15,0.3)';
  const RULE_MAJOR = 'rgba(23,22,15,0.46)';
  const SUB_RULE = 'rgba(23,22,15,0.13)';
  const SUB_FINE = 'rgba(23,22,15,0.065)';
  const ACCENT = '#cf4326';

  const MAX_TILES = 1500;   // caps how far you can zoom out
  const FILL_RES = 700;    // scratch resolution for area detection
  const FILL_GROW = 2;      // ~3 tile units, enough to tuck under a stroke
  const FILL_MAX = 1400;    // the widest scratch grid, when one square is not enough
  const WRAP = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORIGIN = [[0, 0]];

  /* Three ways to sit the work on the diagonal:
       off    everything square
       grid   only the drafting frame turns — the lattice becomes
              diamonds and the rectangle tool draws them, on a plane
              that stays square
       plane  the whole plane turns instead, tiles and rules with it,
              so a tile-aligned square reads as a diamond on screen */
  const DIAG_MODES = [['off', 'Square'], ['grid', 'Iso'], ['plane', '45°']];
  const diagGrid = () => state.diag === 'grid';

  /* Straight geometry gets flat ends so a stroke stops exactly where it
     was placed — on a grid point, or flush with the tile edge where it
     has to meet its own reflection. Rectangles mitre for sharp corners.
     Freehand keeps round ends, and needs them: a single tap is drawn as
     a zero-length segment. */
  const CAPS = { path: ['round', 'round'], rect: ['butt', 'miter'], poly: ['butt', 'miter'] };
  const capsOf = (kind) => CAPS[kind] || ['butt', 'round'];

  /* Flat ends stop exactly where they were placed, but two of them
     meeting at a corner leave a notch on the outside of it. So where
     ends coincide the corner is rounded off: a disc the width of the
     stroke, which is the same outline a round cap would give — just
     only where one is wanted. */
  const jkey = (p) => `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;
  let junctions = new Set();

  function findJunctions(list) {
    const seen = new Map();
    for (const s of list) {
      if (s.layer !== 'stroke' || s.filled) continue;
      for (const p of endpointsOf(s)) {
        const k = jkey(p);
        seen.set(k, (seen.get(k) || 0) + 1);
      }
    }
    const out = new Set();
    for (const [k, n] of seen) if (n >= 2) out.add(k);
    return out;
  }

  // Freehand already ends round, so only the straight tools need this.
  const ROUNDABLE = { line: 1, curve: 1 };

  /* Marks meet across the seam as well as within a square. A mark that
     runs past its own edge can meet another square's copy end to end,
     and that corner needs rounding as much as any other — without it the
     two flat ends leave a wedge of paper on the outside of the bend.
     Which ends meet depends only on where a square sits in the block, so
     it is worked out once per block position and kept until the marks
     change. */
  let crossJunctions = new Map();     // "a,b" in the block -> local ends
  let crossFor = null;
  let tileKey = '0,0';                // block position of the square being painted

  const joined = (p) => {
    const k = jkey(p);
    if (junctions.has(k)) return true;
    const set = crossJunctions.get(tileKey);
    return !!set && set.has(k);
  };

  function placeIn(p, i, j) {
    const r = rotAt(state.pattern, i, j);
    let dx = p.x - T / 2, dy = p.y - T / 2;
    for (let k = r; k > 0; k--) { const t = dx; dx = -dy; dy = t; }
    return { x: dx + T / 2 + i * T, y: dy + T / 2 + j * T };
  }

  function findCrossJunctions() {
    const sig = `${state.pattern.n}:${state.pattern.cells.join('')}:${state.clip}`;
    if (crossFor && crossFor.list === state.shapes && crossFor.sig === sig) return;
    crossFor = { list: state.shapes, sig };
    crossJunctions = new Map();
    // Clipped marks stop at the edge, so nothing of theirs reaches a neighbour.
    const pad = state.clip ? 0 : Math.min(overhang(state.shapes), 2);
    const marks = state.shapes.filter((s) => s.layer === 'stroke' && !s.filled && ROUNDABLE[s.kind]);
    if (!pad || !marks.length) return;

    const n = state.pattern.n;
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < n; a++) {
        const seen = new Map();
        for (let dj = -pad; dj <= pad; dj++) {
          for (let di = -pad; di <= pad; di++) {
            for (const s of marks) {
              for (const p of endpointsOf(s)) {
                const k = jkey(placeIn(p, a + di, b + dj));
                const at = seen.get(k);
                if (at) at.push([di, dj, p]); else seen.set(k, [[di, dj, p]]);
              }
            }
          }
        }
        const set = new Set();
        for (const list of seen.values()) {
          if (list.length < 2) continue;
          // the disc goes where this square's own copy of that end lies
          for (const [di, dj, p] of list) if (!di && !dj) set.add(jkey(p));
        }
        if (set.size) crossJunctions.set(`${a},${b}`, set);
      }
    }
  }

  function paintJunctions(g, s, width) {
    if (!ROUNDABLE[s.kind] || s.filled) return;
    if (!junctions.size && !crossJunctions.size) return;
    for (const p of endpointsOf(s)) {
      if (!joined(p)) continue;
      g.beginPath();
      g.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
      g.fill();
    }
  }

  // What the live mark is waiting for once the first click is done.
  const HOLD_HINT = {
    line: 'Move, then click to set the end · Esc to drop',
    curve: 'Move, then click to set the far end of the arc · Esc to drop',
    circle: 'Move out, then click to set the radius · Esc to drop',
    rect: 'Move, then click to set the far corner · Esc to drop',
    poly: 'Move, then click to set the far corner · Esc to drop',
  };
  const BEND_HINT = 'Move to bend the arc, click to set it · Shift keeps it symmetrical';
  const CHAIN_HINT = 'Click to set the next point · Esc to finish the chain';

  const HINTS = {
    base: 'Draw in any square · two-finger scroll to pan · pinch to zoom',
    select: 'Select — click to pick up, Shift-click to add · drag the paper to sweep an area',
    pencil: 'Pencil — draw freely inside the frame',
    line: 'Line — click each point in turn; Esc finishes · Shift holds it square or to 45°',
    curve: 'Arc — click the two ends, then click to set the bend',
    circle: 'Circle — click the centre, then click to set the radius',
    rect: 'Rectangle — click a corner, then the opposite one · Shift squares it',
    fill: 'Fill — click an enclosed area, or a mark to recolour it',
    erase: 'Erase — click or drag across a mark',
  };

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const hintEl = document.getElementById('hint');
  const zoomEl = document.getElementById('zoomVal');

  const state = {
    shapes: [],
    tool: 'pencil',
    color: PALETTE[2],
    width: 9,
    palette: BUILT_IN[0].name,
    palettes: [],       // the user's own named palettes
    filled: false,
    grid: true,
    clip: false,
    wrap: false,
    snap: false,
    sub: 0,
    diag: 'off',        // 'off' | 'grid' | 'plane'
    pattern: { n: 2, cells: cellsFromPreset(PRESETS[1]) },
    view: { scale: 0.5, x: 0, y: 0, rot: 0 },
  };

  let undoStack = [];
  let redoStack = [];
  let draft = null;    // the mark currently being placed
  let pending = null;  // 'point' | 'bend': the live mark is between clicks
  let draftPath = null;

  let cw = 0, ch = 0, dpr = 1, rect = { left: 0, top: 0 };
  let mode = null;     // 'draw' | 'pan' | 'pinch'
  let panFrom = null;
  let pinchFrom = null;
  let anchor = null;        // the corner a rectangle is being drawn from
  let picked = [];          // the marks the select tool is holding
  let lasso = null;         // the area being swept out with two fingers
  let moving = null;        // { index, preview, from, base } while dragging one
  let shiftHeld = false;
  let altHeld = false;
  let hoverSnap = null;   // lattice point the next mark would land on
  const pointers = new Map();

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const pathCache = new WeakMap();

  function pathOf(shape) {
    let p = pathCache.get(shape);
    if (!p) { p = buildPath(shape); pathCache.set(shape, p); }
    return p;
  }

  /* ---------------- view ---------------- */

  /* The plane sits at  screen = pan + R(rot) · scale · world.  The 45°
     switch just sets rot, so the tiles, their rules, the drafting
     lattice and every mark all turn together. Everything the renderer
     draws goes through one of these three. */

  function toWorld(sx, sy) {
    const v = state.view;
    const c = Math.cos(v.rot), n = Math.sin(v.rot);
    const dx = (sx - v.x) / v.scale, dy = (sy - v.y) / v.scale;
    return { x: dx * c + dy * n, y: dy * c - dx * n };
  }

  function w2s(x, y) {
    const v = state.view;
    const c = Math.cos(v.rot), n = Math.sin(v.rot);
    return {
      x: v.x + (x * c - y * n) * v.scale,
      y: v.y + (x * n + y * c) * v.scale,
    };
  }

  function applyView() {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.translate(state.view.x, state.view.y);
    ctx.rotate(state.view.rot);
    ctx.scale(state.view.scale, state.view.scale);
  }

  /* Any square can be drawn in: whichever one the pointer is over
     becomes the drawing surface. Marks are still kept in one tile's
     coordinates, so a point is mapped back through that square's own
     placement and quarter-turn — draw in a turned tile and the mark
     lands where you put it. The turns are exact right angles, so this
     is done by swapping components rather than with sin and cos. */
  let activeTile = { i: 0, j: 0 };   // the square the grid is shown on
  let drawTile = null;               // the square a mark in progress belongs to

  /* The grid follows the pointer wherever it goes, but a mark keeps the
     frame it was started in, so its far end still lands under the
     cursor when that cursor has wandered into the next square. The
     lattice is the same in every square, so the one on show always
     agrees with what the mark is snapping to. */
  const frameTile = () => drawTile || activeTile;
  const tileRot = () => rotAt(state.pattern, frameTile().i, frameTile().j);

  function toTileSpace(w) {
    const f = frameTile();
    let dx = w.x - f.i * T - T / 2;
    let dy = w.y - f.j * T - T / 2;
    for (let k = tileRot(); k > 0; k--) { const t = dx; dx = dy; dy = -t; }
    return { x: dx + T / 2, y: dy + T / 2 };
  }

  function fromTileSpace(p) {
    const f = frameTile();
    let dx = p.x - T / 2, dy = p.y - T / 2;
    for (let k = tileRot(); k > 0; k--) { const t = dx; dx = -dy; dy = t; }
    return { x: dx + T / 2 + f.i * T, y: dy + T / 2 + f.j * T };
  }

  function updateActive(w) {
    if (!draft && !pending && !moving) drawTile = null;
    const i = Math.floor(w.x / T), j = Math.floor(w.y / T);
    if (i !== activeTile.i || j !== activeTile.j) {
      activeTile = { i, j };
      requestDraw();
    }
  }

  const drawPt = (sx, sy) => toTileSpace(toWorld(sx, sy));

  // A few pixels of slack: marks that start right on the boundary are
  // the whole point of a tiling, so the edge should draw, not pan.
  const insideTile = (w, slackPx) => {
    const g = (slackPx || 0) / state.view.scale;
    return w.x >= -g && w.y >= -g && w.x <= T + g && w.y <= T + g;
  };

  function minScale() {
    if (!cw || !ch) return 0.02;
    const c = Math.abs(Math.cos(state.view.rot));
    const n = Math.abs(Math.sin(state.view.rot));
    const bw = cw * c + ch * n, bh = cw * n + ch * c;
    return Math.max(0.015, Math.sqrt((bw * bh) / MAX_TILES) / T);
  }

  function resetView() {
    const v = state.view;
    v.rot = state.diag === 'plane' ? Math.PI / 4 : 0;
    const s = (Math.min(cw, ch) * (state.diag === 'plane' ? 0.42 : 0.6)) / T;
    v.scale = clamp(s, minScale(), 8);
    // put the tile's centre in the middle of the view, whatever the angle
    const c = Math.cos(v.rot), n = Math.sin(v.rot);
    const mid = (T / 2) * v.scale;
    v.x = cw / 2 - (mid * c - mid * n);
    v.y = ch / 2 - (mid * n + mid * c);
    requestDraw();
  }

  // Turn the plane about a screen point, keeping the world under it put.
  function rotateAt(px, py, dTheta) {
    if (!dTheta) return;
    const v = state.view;
    const c = Math.cos(dTheta), n = Math.sin(dTheta);
    const ax = v.x - px, ay = v.y - py;
    v.x = px + (ax * c - ay * n);
    v.y = py + (ax * n + ay * c);
    v.rot += dTheta;
    v.scale = Math.max(v.scale, minScale());
    requestDraw();
  }

  function zoomAt(px, py, factor) {
    const v = state.view;
    const s1 = clamp(v.scale * factor, minScale(), 8);
    if (s1 === v.scale) return;
    v.x = px - (px - v.x) * (s1 / v.scale);
    v.y = py - (py - v.y) * (s1 / v.scale);
    v.scale = s1;
    requestDraw();
  }

  function resize() {
    const first = !cw;
    const r = canvas.getBoundingClientRect();
    rect = { left: r.left, top: r.top };
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = Math.max(1, Math.round(r.width));
    ch = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    if (first) resetView();
    else {
      state.view.scale = Math.max(state.view.scale, minScale());
      requestDraw();
    }
  }

  // Alt is read straight off each event, so the modifier can never
  // stick if a keyup goes missing.
  /* The lattice you set is what you see at the fitted zoom; every
     doubling of the zoom halves the cells again, so closing in gives
     you finer places to put things. Each level contains the one above
     it, so a mark placed close in still lines up with one placed far
     out. */
  function effSub() {
    if (!state.sub) return 0;
    if (!cw || !ch) return state.sub;
    const fit = (Math.min(cw, ch) * (state.diag === 'plane' ? 0.42 : 0.6)) / T;
    // A hair of slack, so landing exactly on a doubling counts as one.
    const levels = clamp(Math.floor(Math.log2(state.view.scale / fit) + 1e-3), 0, 5);
    let n = state.sub * Math.pow(2, levels);
    while (n > state.sub && (T / n) * state.view.scale < 6) n /= 2;
    return n;
  }

  const snapping = () => state.snap && !altHeld;
  const latticeAt = (p) => (diagGrid() ? snapIso(p, effSub()) : snapPoint(p, effSub()));

  /* Marks already on the tile are snap targets in their own right: the
     ends and middles of lines and arcs, the centres and rims of circles,
     the corners of rectangles. They take precedence over the lattice
     when one is within reach of the cursor, and they work whether or not
     a lattice is showing. */
  /* Targets are ranked, not just measured. Where several marks meet,
     their midpoints and rims crowd around the junction and would win on
     distance alone, so a point one of them ends at beats a point one of
     them merely passes through. */
  const SNAP_RANK = { end: 0, corner: 0, centre: 1, mid: 2, edge: 3 };

  function objectSnap(p) {
    const tol = 12 / state.view.scale;
    let best = null, bestRank = Infinity, bestD = Infinity;
    const consider = (q) => {
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d > tol) return;
      const rank = SNAP_RANK[q.kind];
      if (rank < bestRank || (rank === bestRank && d < bestD)) {
        best = q; bestRank = rank; bestD = d;
      }
    };
    for (const sh of state.shapes) {
      if (sh.layer !== 'stroke') continue;
      for (const q of snapPointsOf(sh)) consider(q);
      /* And anywhere along the mark itself, not only the points that
         have names. Without this, a click away from an end or a middle
         had nothing to catch on and fell through to the lattice — so
         with the lattice off there was nothing, and with it on what
         looked like snapping to the mark was really snapping to a grid
         point that happened to lie under it. Edges rank last, so an end
         still wins wherever one is in reach. */
      const near = nearestOnShape(sh, p);
      if (near) consider({ x: near.p.x, y: near.p.y, kind: 'edge' });
    }
    return best;
  }

  function snapAt(p) {
    const hit = objectSnap(p);
    if (hit) return hit;
    if (!state.sub) return null;
    const g = latticeAt(p);
    g.kind = 'grid';
    return g;
  }

  const sp = (w) => (snapping() ? snapAt(w) || w : w);

  const SNAP_TOOLS = { line: 1, curve: 1, circle: 1, rect: 1 };

  function noteHover(w) {
    const show = snapping() && SNAP_TOOLS[state.tool]
      && (draft || pending || insideTile(w, 5));
    const t = show ? snapAt(w) : null;
    let next = null;
    if (t) {
      const q = fromTileSpace(t);
      next = { x: q.x, y: q.y, kind: t.kind };
    }
    const same = (!next && !hoverSnap)
      || (next && hoverSnap && next.x === hoverSnap.x
          && next.y === hoverSnap.y && next.kind === hoverSnap.kind);
    hoverSnap = next;
    if (!same) requestDraw();
  }

  /* ---------------- render ---------------- */

  let frame = 0;
  function requestDraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; drawAll(); });
  }

  // The world region on screen is a turned rectangle; tiles are laid
  // out over its bounding box.
  function tileRange() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [cw, 0], [0, ch], [cw, ch]]) {
      const p = toWorld(sx, sy);
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    return {
      i0: Math.floor(x0 / T), i1: Math.floor(x1 / T),
      j0: Math.floor(y0 / T), j1: Math.floor(y1 / T),
      wx0: x0, wy0: y0, wx1: x1, wy1: y1,
      step: T * state.view.scale,
    };
  }

  /* Overlay rules are given in world coordinates and stroked in screen
     space, so they stay a hairline at any zoom. With the plane square
     they also snap to the pixel grid; turned, they simply draw true. */
  let cleanFrame = false;   // exporting: artwork only, no drawing aids
  let crispRot = true;
  /* An odd-width line lands crisply sitting on a half pixel, an even one
     sitting on a whole one. */
  let hairSnap = 0.5;
  function hairLine(ax, ay, bx, by) {
    const p = w2s(ax, ay), q = w2s(bx, by);
    if (crispRot) {
      if (Math.abs(p.x - q.x) < 0.01) { const x = Math.round(p.x) + hairSnap; p.x = x; q.x = x; }
      if (Math.abs(p.y - q.y) < 0.01) { const y = Math.round(p.y) + hairSnap; p.y = y; q.y = y; }
    }
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }

  // What the plane should show: the committed shapes, with a shape
  // being dragged swapped for its moved copy, plus any live draft.
  function drawList() {
    if (!moving && !draft) return state.shapes;
    const list = state.shapes.slice();
    if (moving) {
      moving.members.forEach((m, k) => {
        const i = list.indexOf(m);
        if (i >= 0) list[i] = moving.previews[k];
      });
    }
    if (draft) list.push(draft);
    return list;
  }

  /* A mark may run past its own square, and with clipping off it shows
     there. So a square just off screen can still put ink on screen, and
     the paint has to reach further than the view does. Capped, since a
     very long mark would otherwise have us painting the whole plane. */
  function overhang(list) {
    if (state.clip) return 0;
    let lo = 0, hi = T;
    for (const sh of list) {
      const b = shapeBBox(sh);
      if (!b) continue;
      const pen = (sh.width || 0) / 2;
      lo = Math.min(lo, b.x0 - pen, b.y0 - pen);
      hi = Math.max(hi, b.x1 + pen, b.y1 + pen);
    }
    return clamp(Math.max(Math.ceil(-lo / T), Math.ceil((hi - T) / T)), 0, 3);
  }

  function drawAll() {
    const { scale } = state.view;
    const R = tileRange();
    crispRot = Math.abs(Math.sin(2 * state.view.rot)) < 1e-6;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cleanFrame) {
      ctx.clearRect(0, 0, cw, ch);
    } else {
      ctx.fillStyle = GROUND;
      ctx.fillRect(0, 0, cw, ch);
    }

    draftPath = draft ? buildPath(draft) : null;
    const hair = 0.9 / scale;
    const offs = state.wrap ? WRAP : ORIGIN;
    const list = paintOrder(drawList());
    junctions = findJunctions(list);
    findCrossJunctions();

    applyView();

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pad = overhang(list);
    const overTiles = (marks) => {
      for (let j = R.j0 - pad; j <= R.j1 + pad; j++) {
        for (let i = R.i0 - pad; i <= R.i1 + pad; i++) {
          ctx.save();
          tileKey = `${mod(i, state.pattern.n)},${mod(j, state.pattern.n)}`;
          ctx.translate(i * T, j * T);
          const r = rotAt(state.pattern, i, j);
          if (r) {
            ctx.translate(T / 2, T / 2);
            ctx.rotate((r * Math.PI) / 2);
            ctx.translate(-T / 2, -T / 2);
          }
          if (state.clip) {
            ctx.beginPath();
            ctx.rect(0, 0, T, T);
            ctx.clip();
          }
          for (const o of offs) {
            if (o[0] || o[1]) ctx.translate(o[0] * T, o[1] * T);
            for (const sh of marks) {
              if (sh.inside) paintShape(sh.inside, hair, 'inside');
              else paintShape(sh, hair, sh.fillColor ? 'outline' : undefined);
            }
            if (o[0] || o[1]) ctx.translate(-o[0] * T, -o[1] * T);
          }
          ctx.restore();
        }
      }
    };

    /* With every mark cut at its own edge, a square can be finished
       before the next is started. Without clipping a mark runs over its
       neighbours, and finishing square by square puts everything the
       next square draws on top of everything this one drew — a fill two
       squares along landing over a border already laid down. So the
       plane is painted mark by mark instead, each across every square,
       and depth means the same thing everywhere. */
    if (state.clip) overTiles(list);
    else for (const sh of list) overTiles([sh]);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cleanFrame) return;

    if (state.grid) drawRules(R);
    if (state.sub > 1) drawSubGrid(R);
    if (picked.length) drawSelection();
    if (lasso) drawLasso();
    if (hoverSnap) drawSnapMark();
    zoomEl.textContent = Math.round(scale * 100) + '%';
  }

  /* `part` paints one half of a mark that has both: 'inside' its own
     interior, 'outline' its border. They go down at different depths —
     see paintOrder — so the plane asks for them separately. */
  function paintShape(s, hair, part) {
    const p = s === draft ? draftPath : pathOf(s);
    if (s.layer === 'fill') {
      ctx.fillStyle = s.color;
      ctx.fill(p, 'evenodd');
    } else if (s.filled) {
      ctx.fillStyle = s.color;
      ctx.fill(p);
    } else {
      if (s.fillColor && part !== 'outline') {
        ctx.fillStyle = s.fillColor;
        ctx.fill(p);
      }
      if (part === 'inside') return;
      const [cap, join] = capsOf(s.kind);
      ctx.lineCap = cap;
      ctx.lineJoin = join;
      ctx.strokeStyle = s.color;
      ctx.fillStyle = s.color;
      const w = Math.max(s.width, hair);
      ctx.lineWidth = w;
      ctx.stroke(p);
      paintJunctions(ctx, s, w);
    }
  }

  /* Painting order. A group is one unit and sits at a single depth, so
     moving it carries its fill and its border together; inside a unit
     the fill still goes down first, under its own outline. Fills that
     belong to no group are the ground the rest sits on, so they stay
     at the bottom. */
  function paintOrder(list) {
    const order = [];
    for (const s of list) if (s.layer === 'fill' && !s.group) order.push(s);

    /* Each shape sits in a unit — its group, or itself. A fill then pulls
       the marks that bound it into its own unit, wherever else they
       belong, because a fill must never be painted over its own border.
       Within a unit the fill goes down first, so the whole figure sits at
       one depth with its outline on top. */
    const key = new Map();
    list.forEach((s, i) => {
      if (s.layer === 'fill' && !s.group) return;
      key.set(s, s.group ? `g${s.group}` : `i${i}`);
    });
    const byId = new Map();
    for (const s of list) if (s.id != null) byId.set(s.id, s);
    for (const s of list) {
      if (s.layer !== 'fill' || !s.walls || !key.has(s)) continue;
      for (const wid of s.walls) {
        const w = byId.get(wid);
        if (w && key.has(w)) key.set(w, key.get(s));
      }
    }

    const units = new Map();
    list.forEach((s, i) => {
      const k = key.get(s);
      if (k === undefined) return;
      let u = units.get(k);
      if (!u) units.set(k, (u = { last: i, fills: [], strokes: [] }));
      if (i > u.last) u.last = i;
      if (s.layer === 'fill') u.fills.push(s);
      else {
        /* A mark's own interior is a fill and belongs at fill depth. It
           used to be painted with the mark's border, which paintOrder
           puts above every separate fill — so an area filled inside a
           closed mark vanished under that mark's interior the moment it
           was drawn, and clicking the same spot again did nothing
           visible however many times you tried. */
        if (s.fillColor && !s.filled) u.fills.push({ inside: s });
        u.strokes.push(s);
      }
    });

    for (const u of [...units.values()].sort((a, b) => a.last - b.last)) {
      order.push(...u.fills, ...u.strokes);
    }
    return order;
  }

  /* A halo around each picked mark, the marks put back over it, and a
     dashed box round each — in three passes, not one mark at a time.
     Putting a mark back has to follow the order the plane paints in: a
     group holds a fill and the borders around it, and repainting them in
     the order they sit in the list put the fill last, burying every
     border it had. */
  function drawSelection() {
    const shapes = (moving ? moving.previews : heldMarks()).filter(Boolean);
    if (!shapes.length) return;
    const hair = 0.9 / state.view.scale;
    for (const shape of shapes) inTileFrame(() => drawHalo(shape));
    for (const entry of paintOrder(shapes)) {
      inTileFrame(() => {
        if (entry.inside) paintShape(entry.inside, hair, 'inside');
        else paintShape(entry, hair, entry.fillColor ? 'outline' : undefined);
      });
    }
    for (const shape of shapes) drawSelectionBox(shape);
  }

  // The home square's own frame, where a mark's coordinates mean what
  // they say.
  function inTileFrame(draw) {
    ctx.save();
    applyView();
    const f = frameTile();
    ctx.translate(f.i * T, f.j * T);
    const tr = tileRot();
    if (tr) {
      ctx.translate(T / 2, T / 2);
      ctx.rotate((tr * Math.PI) / 2);
      ctx.translate(-T / 2, -T / 2);
    }
    draw();
    ctx.restore();
  }

  function drawHalo(shape) {
    const solid = shape.layer === 'fill' || shape.filled;
    const pen = solid ? 0 : shape.width;
    const [cap, join] = capsOf(shape.kind);
    ctx.lineCap = cap;
    ctx.lineJoin = join;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = rgbOf(shape.color) === ACCENT ? '#17160f' : ACCENT;
    ctx.lineWidth = pen + 8 / state.view.scale;
    ctx.stroke(pathOf(shape));
    ctx.globalAlpha = 1;
  }

  function drawSelectionBox(shape) {
    const v = state.view;
    const solid = shape.layer === 'fill' || shape.filled;
    const pen = solid ? 0 : shape.width;
    const b = shapeBBox(shape);
    if (!b) return;
    // Drawn as a quad through the transform so it stays around the mark
    // when the plane is turned.
    const g = pen / 2 + 7 / v.scale;
    const corners = [
      [b.x0 - g, b.y0 - g], [b.x1 + g, b.y0 - g],
      [b.x1 + g, b.y1 + g], [b.x0 - g, b.y1 + g],
    ].map(([x, y]) => {
      const q = fromTileSpace({ x, y });
      return w2s(q.x, q.y);
    });
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.globalAlpha = 0.7;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    ctx.moveTo(corners[0].x, corners[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(corners[i].x, corners[i].y);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }


  function drawRules(R) {
    const n = state.pattern.n;
    const minor = R.step > 15;
    // A wider line only helps while the squares are big enough to carry
    // it; packed together they would close up into a grey wash.
    const room = R.step > 70;
    if (minor) {
      ctx.lineWidth = room ? 2 : 1;
      hairSnap = room ? 0 : 0.5;
      ctx.strokeStyle = RULE_MINOR;
      ctx.beginPath();
      for (let i = R.i0; i <= R.i1 + 1; i++) {
        if (n > 1 && mod(i, n) === 0) continue;
        hairLine(i * T, R.wy0, i * T, R.wy1);
      }
      for (let j = R.j0; j <= R.j1 + 1; j++) {
        if (n > 1 && mod(j, n) === 0) continue;
        hairLine(R.wx0, j * T, R.wx1, j * T);
      }
      ctx.stroke();
    }
    if (n > 1 || !minor) {
      ctx.lineWidth = room ? 3 : 1;
      hairSnap = 0.5;
      ctx.strokeStyle = RULE_MAJOR;
      ctx.beginPath();
      const s = n > 1 ? n : 1;
      for (let i = Math.floor(R.i0 / s) * s; i <= R.i1 + s; i += s) {
        hairLine(i * T, R.wy0, i * T, R.wy1);
      }
      for (let j = Math.floor(R.j0 / s) * s; j <= R.j1 + s; j += s) {
        hairLine(R.wx0, j * T, R.wx1, j * T);
      }
      ctx.stroke();
    }
    ctx.lineWidth = 1;
    hairSnap = 0.5;
  }

  // The drafting lattice, drawn on the drawing surface only.
  /* The lattice lies over the whole plane, not just the square the
     pointer is in, and it is turned with each square: a quarter-turn
     carries a square lattice onto itself but not a triangular one, and
     what is drawn has to be what a mark placed there would line up
     with. */
  function tileFrames(R) {
    const out = [];
    for (let j = R.j0; j <= R.j1; j++) {
      for (let i = R.i0; i <= R.i1; i++) out.push([i, j, rotAt(state.pattern, i, j)]);
    }
    return out;
  }

  function drawSubGrid(R) {
    if (R.step / state.sub < 5) return;          // too dense to read
    const frames = tileFrames(R);
    if (frames.length > 160) return;             // more squares than it helps to rule
    const eff = effSub();
    // Finer levels first and fainter, so the lattice you asked for stays
    // the one that reads.
    if (eff > state.sub) latticePass(eff, eff / state.sub, SUB_FINE, frames);
    latticePass(state.sub, 1, SUB_RULE, frames);
  }

  // y = m·x + c, cut to the tile square.
  function clipHair(m, c, hair) {
    const cut = (y) => (y - c) / m;
    let x0 = 0, y0 = c, x1 = T, y1 = m * T + c;
    if (y0 < 0) { x0 = cut(0); y0 = 0; } else if (y0 > T) { x0 = cut(T); y0 = T; }
    if (y1 < 0) { x1 = cut(0); y1 = 0; } else if (y1 > T) { x1 = cut(T); y1 = T; }
    if (x1 - x0 < 1e-6 || x0 < -1e-6 || x1 > T + 1e-6) return;
    hair(x0, y0, x1, y1);
  }

  function latticePass(n, skip, colour, frames) {
    ctx.lineWidth = 1;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    for (const [i, j, rot] of frames) {
      const put = (x, y) => {
        let dx = x - T / 2, dy = y - T / 2;
        for (let k = rot; k > 0; k--) { const t = dx; dx = -dy; dy = t; }
        return [dx + T / 2 + i * T, dy + T / 2 + j * T];
      };
      const hair = (a, b, c, d) => {
        const p = put(a, b), q = put(c, d);
        hairLine(p[0], p[1], q[0], q[1]);
      };
      latticeLines(n, skip, hair);
    }
    ctx.stroke();
  }

  function latticeLines(n, skip, hair) {
    const cell = T / n;

    if (diagGrid()) {
      const { w, h } = isoBasis(n);
      const slope = h / (2 * w);          // a thirty degree rise
      const drop = (k) => (skip > 1 && ((k % skip) + skip) % skip === 0);
      // Upright: the tile's own columns.
      for (let i = 1; i < n; i++) {
        if (drop(i)) continue;
        hair(i * w, 0, i * w, T);
      }
      // The two thirty degree families, y = ±slope·x + k·h, cut to the tile.
      for (let k = Math.ceil((-slope * T) / h); k <= Math.floor(T / h); k++) {
        if (!drop(k)) clipHair(slope, k * h, hair);
      }
      for (let k = 0; k <= Math.floor((T + slope * T) / h); k++) {
        if (!drop(k)) clipHair(-slope, k * h, hair);
      }
      return;
    }

    for (let i = 1; i < n; i++) {
      if (skip > 1 && i % skip === 0) continue;
      hair(i * cell, 0, i * cell, T);
      hair(0, i * cell, T, i * cell);
    }
  }

  // Where the next point will actually land.
  // What the next point will land on: a red cross, whatever kind of
  // target caught it.
  function drawSnapMark() {
    const p = w2s(hoverSnap.x, hoverSnap.y);
    const x = Math.round(p.x) + 0.5, y = Math.round(p.y) + 0.5;
    const a = 5;
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(x - a, y - a); ctx.lineTo(x + a, y + a);
    ctx.moveTo(x + a, y - a); ctx.lineTo(x - a, y + a);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Printer's crop marks around the drawing surface.
  /* ---------------- history ---------------- */

  function commit(shape) {
    undoStack.push(state.shapes.slice());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
    state.shapes = state.shapes.concat([shape]);
    afterChange();
  }

  function replaceShapes(next) {
    undoStack.push(state.shapes.slice());
    redoStack.length = 0;
    state.shapes = next;
    afterChange();
  }

  /* Opening a drawing, or starting one, is a new session rather than an
     edit: the steps behind it belong to a picture that is no longer on
     the table, so undoing into them would make no sense. */
  function adoptShapes(next) {
    undoStack.length = 0;
    redoStack.length = 0;
    state.shapes = next;
    afterChange();
  }

  function undo() {
    cancelDraft();
    select([]);
    if (!undoStack.length) return flash('Nothing to undo');
    redoStack.push(state.shapes.slice());
    state.shapes = undoStack.pop();
    afterChange();
  }

  function redo() {
    cancelDraft();
    select([]);
    if (!redoStack.length) return flash('Nothing to redo');
    undoStack.push(state.shapes.slice());
    state.shapes = redoStack.pop();
    afterChange();
  }

  function afterChange() {
    requestDraw();
    document.getElementById('shapeCount').textContent =
      state.shapes.length + (state.shapes.length === 1 ? ' shape' : ' shapes');
    document.getElementById('undo').disabled = !undoStack.length;
    syncEditButtons();
    document.getElementById('redo').disabled = !redoStack.length;
    if (!state.shapes.length) closeNewPrompt();
    setDirty(true);
    saveSoon();
  }

  /* ---------------- drawing ---------------- */

  // Marks are copied rather than mutated, so they carry an id that
  // survives being moved or recoloured.
  let shapeSeq = 1;

  /* Marks arriving from a file or a saved session keep their own ids —
     a fill names the marks that bound it — so the counters move past
     whatever came in. */
  function adoptIds(list) {
    for (const sh of list) {
      if (sh.group >= groupSeq) groupSeq = sh.group + 1;
      if (sh.id == null) sh.id = shapeSeq++;
      else if (sh.id >= shapeSeq) shapeSeq = sh.id + 1;
    }
  }

  function newStroke(extra) {
    return Object.assign({
      id: shapeSeq++, layer: 'stroke', color: state.color, width: state.width,
    }, extra);
  }

  // Returns false when the press turned out to be nothing to draw, so
  // the caller can treat it as a pan instead.
  function startDraw(w, e) {
    const p = sp(w);
    drawTile = activeTile;
    switch (state.tool) {
      case 'select': {
        drawTile = activeTile;
        endLasso(true);
        const hit = hitTest(w, { interior: true });
        const add = !!(e && (e.shiftKey || e.metaKey || e.ctrlKey));
        // Nothing under the press: drag an area out from it instead.
        if (!hit) {
          lasso = { a: w, b: w, base: add ? picked.slice() : [] };
          if (!add) select([]);
          requestDraw();
          return true;
        }
        // Shift adds a mark to what is held, or puts it back down.
        if (add) {
          const unit = new Set(groupOf(hit));
          const had = picked.some((sh) => unit.has(sh));
          select(had ? picked.filter((sh) => !unit.has(sh)) : picked.concat([hit]));
          requestDraw();
          return true;     // a pick, not the start of a move
        }
        // Pressing on something already held moves the whole armful.
        if (!heldMarks().includes(hit)) select([hit]);
        requestDraw();
        const members = heldMarks();
        moving = { members, previews: members, base: hit, from: w, dx: 0, dy: 0 };
        return true;
      }
      case 'pencil':
        // Freehand ignores the lattice outright — that is what the line
        // tool is for.
        draft = newStroke({ kind: 'path', pts: [w] });
        break;
      case 'line':
        draft = newStroke({ kind: 'line', a: p, b: p });
        break;
      case 'curve':
        draft = newStroke({ kind: 'curve', a: p, b: p, c: p });
        break;
      case 'circle':
        draft = newStroke({ kind: 'circle', c: p, r: 0, filled: state.filled });
        break;
      case 'rect':
        anchor = p;
        draft = diagGrid()
          ? newStroke({ kind: 'poly', pts: [p, p, p, p], filled: state.filled })
          : newStroke({ kind: 'rect', x: p.x, y: p.y, w: 0, h: 0, filled: state.filled });
        break;
      case 'fill':
        doFill(w);
        mode = null;
        return true;
      case 'erase':
        eraseAt(w);
        return true;
    }
    requestDraw();
    return true;
  }

  /* Shift holds a mark to the eight directions — horizontal, vertical
     and the two diagonals — and takes precedence over snapping, since
     asking for a direction is the more specific request. With a lattice
     up, the length is then quantised along that direction so the far end
     still lands on it: a whole cell along the axes, a cell's diagonal
     across them. */
  function endPoint(a, w) {
    if (shiftHeld && diagGrid()) {
      const n = effSub();
      return isoRun(a, w, n || state.sub || 12, !!n && snapping());
    }
    if (shiftHeld) {
      const p = snapAngle(a, w, Math.PI / 4);
      if (!snapping() || !state.sub) return p;
      const dx = p.x - a.x, dy = p.y - a.y;
      const len = Math.hypot(dx, dy);
      if (len < 1e-9) return p;
      const diagonal = Math.abs(dx) > 1e-9 && Math.abs(dy) > 1e-9;
      const unit = (T / effSub()) * (diagonal ? Math.SQRT2 : 1);
      const q = Math.round(len / unit) * unit;
      return { x: a.x + (dx / len) * q, y: a.y + (dy / len) * q };
    }
    if (snapping()) return snapAt(w) || w;
    return w;
  }

  /* The plane repeats every tile, so a mark dragged into a neighbour is
     the same mark one period over. Bring it back to the home tile:
     left where it lands it would sit outside every tile's clip and
     could never be drawn again. */
  // Whole-tile steps that bring a set of marks back to the home square,
  // measured on the group as a whole so it never comes apart.
  function homeShift(shapes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sh of shapes) {
      const b = shapeBBox(sh);
      if (!b) continue;
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    if (x0 === Infinity) return [0, 0];
    return [
      -Math.floor((x0 + x1) / 2 / T) * T,
      -Math.floor((y0 + y1) / 2 / T) * T,
    ];
  }

  /* A mark you just moved should sit above what it was moved onto, so
     it goes to the end of the list. Fills still paint beneath strokes —
     that is what keeps a fill under its own outline — so this puts the
     group on top of the others, not its fill on top of every line. */
  function raise(list, members) {
    const set = new Set(members);
    return list.filter((sh) => !set.has(sh)).concat(members);
  }

  function moveGroup(shapes, dx, dy) {
    let moved = shapes.map((sh) => translateShape(sh, dx, dy));
    const [hx, hy] = homeShift(moved);
    if (hx || hy) moved = moved.map((sh) => translateShape(sh, hx, hy));
    return moved;
  }

  function moveDraw(w) {
    if (lasso) {
      lasso.b = w;
      select(lasso.base.concat(caughtBy(lassoBox())));
      setHint(picked.length
        ? `Sweeping — ${picked.length} ${picked.length === 1 ? 'mark' : 'marks'} inside`
        : 'Sweeping an area — anything wholly inside it is picked up', true);
      requestDraw();
      return;
    }
    if (moving) {
      let dx = w.x - moving.from.x;
      let dy = w.y - moving.from.y;
      if (snapping()) {
        // Land the mark's own anchor on a target, so dragging both
        // keeps a snapped mark snapped and pulls a stray one into line.
        const a = anchorOf(moving.base);
        const t = snapAt({ x: a.x + dx, y: a.y + dy });
        if (t) { dx = t.x - a.x; dy = t.y - a.y; }
      }
      moving.dx = dx;
      moving.dy = dy;
      moving.previews = dx || dy ? moveGroup(moving.members, dx, dy) : moving.members;
      requestDraw();
      return;
    }
    if (!draft) {
      if (state.tool === 'erase') eraseAt(w);
      return;
    }
    switch (draft.kind) {
      case 'path': {
        const last = draft.pts[draft.pts.length - 1];
        if (dist(last, w) * state.view.scale > 1.6) draft.pts.push(w);
        break;
      }
      case 'line':
        draft.b = endPoint(draft.a, w);
        break;
      case 'curve':
        draft.b = endPoint(draft.a, w);
        draft.c = { x: (draft.a.x + draft.b.x) / 2, y: (draft.a.y + draft.b.y) / 2 };
        break;
      case 'poly': {
        /* The same corner-to-corner drag, read on the isometric frame:
           the drag falls in one of the six wedges and the two
           directions around it are the sides, so every box drawn here
           is a face of a cube. Shift makes it a rhombus with equal
           sides — the face itself rather than a panel of one. */
        const n = effSub() || state.sub || 12;
        let b = snapping() ? snapAt(w) || w : w;
        let pts = isoRhombus(anchor, b, n);
        if (shiftHeld && pts.length === 4) {
          const la = dist(pts[0], pts[1]), lb = dist(pts[0], pts[3]);
          const m = Math.max(la, lb);
          const at = (p, len) => (len < 1e-9 ? p : {
            x: pts[0].x + ((p.x - pts[0].x) * m) / len,
            y: pts[0].y + ((p.y - pts[0].y) * m) / len,
          });
          const u = at(pts[1], la), v = at(pts[3], lb);
          pts = [pts[0], u, { x: u.x + v.x - pts[0].x, y: u.y + v.y - pts[0].y }, v];
        }
        draft.pts = pts;
        break;
      }
      case 'rect': {
        let q = snapping() ? snapAt(w) || w : w;
        if (shiftHeld) {
          // Square off the longer side. On the lattice both sides are
          // whole steps, so this stays on it.
          const dx = q.x - anchor.x, dy = q.y - anchor.y;
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          q = { x: anchor.x + (dx < 0 ? -m : m), y: anchor.y + (dy < 0 ? -m : m) };
        }
        draft.x = Math.min(anchor.x, q.x);
        draft.y = Math.min(anchor.y, q.y);
        draft.w = Math.abs(q.x - anchor.x);
        draft.h = Math.abs(q.y - anchor.y);
        break;
      }
      case 'circle': {
        let r = dist(draft.c, w);
        const hit = snapping() ? objectSnap(w) : null;
        if (hit) {
          // let the rim pass exactly through whatever it reached
          r = dist(draft.c, hit);
        } else if (snapping() && state.sub) {
          // Half a cell at a time, so a circle can sit on the lattice
          // or halfway between it.
          const half = T / effSub() / 2;
          r = Math.round(r / half) * half;
        } else if (shiftHeld) {
          r = Math.round(r / 25) * 25;
        }
        draft.r = r;
        break;
      }
    }
    requestDraw();
  }

  const tooSmall = (d) => {
    const k = state.view.scale;
    if (d.kind === 'line') return dist(d.a, d.b) * k < 2;
    if (d.kind === 'circle') return d.r * k < 2;
    if (d.kind === 'rect') return d.w * k < 2 && d.h * k < 2;
    if (d.kind === 'poly') {
      // Both corners can land on one diagonal, which folds the quad
      // flat; area, not bounding box, is what decides here.
      let area = 0;
      for (let i = 0, n = d.pts.length; i < n; i++) {
        const p = d.pts[i], q = d.pts[(i + 1) % n];
        area += p.x * q.y - q.x * p.y;
      }
      return Math.abs(area / 2) * k * k < 4;
    }
    if (d.kind === 'curve') return dist(d.a, d.b) * k < 4;
    return false;
  };

  function commitLive() {
    const d = draft;
    draft = null;
    pending = null;
    setHint(HINTS[state.tool] || HINTS.base);
    if (!d) return;
    if (tooSmall(d)) { requestDraw(); return; }
    commit(d);

    // The line tool carries on from where it stopped, so a run of clicks
    // draws a chain. Clicking the same point twice ends it, as does Esc.
    if (state.tool === 'line' && d.kind === 'line') {
      draft = newStroke({ kind: 'line', a: d.b, b: d.b });
      pending = 'point';
      setHint(CHAIN_HINT, true);
      requestDraw();
    }
  }

  // A click on a live mark either sets it, or — for a curve — moves it
  // on to being bent.
  function advancePending() {
    if (pending === 'point' && draft && draft.kind === 'curve') {
      if (tooSmall(draft)) { cancelDraft(); return; }
      pending = 'bend';
      setHint(BEND_HINT, true);
      requestDraw();
      return;
    }
    commitLive();
  }

  function endDraw() {
    if (lasso) { endLasso(); return; }
    if (moving) {
      const m = moving;
      moving = null;
      if (m.dx || m.dy) {
        const swap = new Map(m.members.map((sh, k) => [sh, m.previews[k]]));
        replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), m.previews));
        select(picked.map((sh) => swap.get(sh) || sh));
      }
      requestDraw();
      return;
    }
    if (!draft) return;

    // Freehand is the only tool that ends on release. Every other mark
    // stays live when the button comes up and follows the cursor until
    // the next click sets it — a press that slides a few pixels, which
    // is most trackpad clicks, must not count as a finished drag.
    if (draft.kind === 'path') {
      // Freehand comes in jittery; smooth it before it is kept.
      draft.pts = smoothPath(draft.pts, 1.6 / state.view.scale);
      commitLive();
      return;
    }
    pending = 'point';
    setHint(HOLD_HINT[draft.kind] || 'Move, then click to set it', true);
    requestDraw();
  }

  function bendPending(w) {
    // Shift holds the apex square above the middle of the chord, which
    // is what makes the arc symmetrical. Like the line's direction
    // constraint, it takes precedence over snapping.
    const m = shiftHeld ? bisectorFoot(draft.a, draft.b, w) : sp(w);
    draft.c = quadThrough(draft.a, draft.b, m);
    requestDraw();
  }

  function cancelDraft() {
    if (!draft && !pending && !moving) return false;
    draft = null;
    pending = null;
    moving = null;
    setHint(HINTS[state.tool]);
    requestDraw();
    return true;
  }

  /* ---------------- erase ---------------- */

  const CLOSED = { circle: 1, rect: 1, poly: 1 };

  /* A fill bounded by several marks is grouped with them, so the lot
     moves as one thing. Marks that enclose nothing stay ungrouped. */
  let groupSeq = 1;
  const groupOf = (shape) => (shape && shape.group
    ? state.shapes.filter((s) => s.group === shape.group)
    : shape ? [shape] : []);

  /* Holding one member of a group holds the group: what is outlined is
     what will move, recolour or go. */
  function heldMarks() {
    const out = [], seen = new Set();
    for (const sh of picked) {
      for (const m of groupOf(sh)) if (!seen.has(m)) { seen.add(m); out.push(m); }
    }
    return out;
  }

  function select(list) {
    // A sweep over marks already in hand should not hold them twice.
    picked = [...new Set((list || []).filter(Boolean))];
    syncEditButtons();
  }

  function syncEditButtons() {
    const g = document.getElementById('groupBtn');
    const u = document.getElementById('ungroupBtn');
    if (!g || !u) return;
    const marks = heldMarks();
    // Two things to bind means two units, not two marks: a group is one.
    const units = new Set(marks.map((sh) => sh.group || sh));
    g.disabled = units.size < 2;
    u.disabled = !marks.some((sh) => sh.group);
    document.getElementById('turnLeftBtn').disabled = !marks.length;
    document.getElementById('turnRightBtn').disabled = !marks.length;
    document.getElementById('cutBtn').disabled = !marks.length;
    document.getElementById('copyBtn').disabled = !marks.length;
    document.getElementById('pasteBtn').disabled = !clipboard.length;
  }

  /* Binding marks together. A group moves, recolours and goes as one
     thing; a fill made against several marks is grouped with them
     automatically, and these two do the same by hand. */
  function groupPicked() {
    const marks = heldMarks();
    const units = new Set(marks.map((sh) => sh.group || sh));
    if (units.size < 2) return flash('Hold two things — Shift-click to add to what you have');
    const gid = groupSeq++;
    const set = new Set(marks);
    const swap = new Map();
    const next = state.shapes.map((sh) => {
      if (!set.has(sh)) return sh;
      const copy = Object.assign({}, sh, { group: gid });
      swap.set(sh, copy);
      return copy;
    });
    replaceShapes(next);
    select(picked.map((sh) => swap.get(sh) || sh));
    flash(`${marks.length} marks grouped`);
  }

  /* Turning what is in hand. Several marks turn about the centre of what
     they make together, so a figure keeps its shape rather than each
     mark spinning on its own. */
  function turnHeld(eighths) {
    const marks = heldMarks();
    if (!marks.length) return flash('Nothing in hand to turn');
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sh of marks) {
      const b = shapeBBox(sh);
      if (!b) continue;
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    if (x0 === Infinity) return flash('Nothing in hand to turn');
    const ang = (eighths * Math.PI) / 4;
    let turned = marks.map((sh) => rotateShape(sh, (x0 + x1) / 2, (y0 + y1) / 2, ang));
    const [hx, hy] = homeShift(turned);
    if (hx || hy) turned = turned.map((sh) => translateShape(sh, hx, hy));
    const swap = new Map(marks.map((sh, k) => [sh, turned[k]]));
    replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), turned));
    select(picked.map((sh) => swap.get(sh) || sh));
    flash(`Turned 45° ${eighths > 0 ? 'clockwise' : 'anticlockwise'}`);
  }

  function ungroupPicked() {
    const marks = heldMarks().filter((sh) => sh.group);
    if (!marks.length) return flash('Nothing grouped in what you are holding');
    const set = new Set(marks);
    const swap = new Map();
    const next = state.shapes.map((sh) => {
      if (!set.has(sh)) return sh;
      const copy = Object.assign({}, sh);
      delete copy.group;
      swap.set(sh, copy);
      return copy;
    });
    replaceShapes(next);
    select(picked.map((sh) => swap.get(sh) || sh));
    flash(`${marks.length} marks let loose`);
  }

  /* ---------------- cut, copy, paste ----------------

     The marks go on the real clipboard as the same JSON a drawing is
     saved as, so a figure can be carried to another tile, another tab or
     another day — and read on the way. Reading the clipboard outright
     needs a permission prompt, so the paste comes off the browser's own
     paste event, which hands it over without asking; a copy kept here
     backs the buttons up. */

  let clipboard = [];
  let pasteRun = 0;

  const inField = (t) => t instanceof HTMLInputElement
    || t instanceof HTMLSelectElement || t instanceof HTMLTextAreaElement;

  function marksToText(marks) {
    return '{\n "format": "tessera-marks",\n "version": 1,\n "marks": [\n'
      + marks.map((sh) => '  ' + JSON.stringify(sh)).join(',\n') + '\n ]\n}\n';
  }

  function marksFromText(text) {
    let d = null;
    try { d = JSON.parse(text); } catch (err) { return null; }
    const list = d && (Array.isArray(d.marks) ? d.marks : Array.isArray(d.shapes) ? d.shapes : null);
    if (!list) return null;
    const marks = list.filter((sh) => sh && sh.kind);
    return marks.length ? marks : null;
  }

  /* Fresh ids all round. A pasted group stays a group without joining a
     group already on the tile, and a pasted fill goes on naming the
     borders it came with rather than whichever marks hold those ids now. */
  function reseat(marks) {
    const ids = new Map();
    const groups = new Map();
    const out = marks.map((sh) => {
      const copy = Object.assign({}, sh);
      ids.set(sh.id, shapeSeq);
      copy.id = shapeSeq++;
      if (sh.group) {
        if (!groups.has(sh.group)) groups.set(sh.group, groupSeq++);
        copy.group = groups.get(sh.group);
      }
      return copy;
    });
    for (const sh of out) {
      if (Array.isArray(sh.walls)) sh.walls = sh.walls.map((id) => ids.get(id)).filter((v) => v != null);
    }
    return out;
  }

  function copyHeld(cut) {
    const marks = heldMarks();
    if (!marks.length) { flash('Nothing in hand to ' + (cut ? 'cut' : 'copy')); return null; }
    clipboard = marks.map((sh) => Object.assign({}, sh));
    pasteRun = 0;
    syncEditButtons();
    const many = marks.length === 1 ? 'mark' : 'marks';
    if (cut) {
      const gone = new Set(marks);
      select([]);
      replaceShapes(state.shapes.filter((sh) => !gone.has(sh)));
    }
    flash(`${marks.length} ${many} ${cut ? 'cut' : 'copied'}`);
    return marksToText(clipboard);
  }

  function pasteMarks(marks) {
    if (!marks || !marks.length) return flash('Nothing to paste');
    pasteRun++;
    const step = (snapping() ? T / effSub() : 40) * pasteRun;
    const fresh = moveGroup(reseat(marks), step, step);
    setTool('select');
    replaceShapes(raise(state.shapes.concat(fresh), fresh));
    select(fresh);
    const many = fresh.length === 1 ? 'mark' : 'marks';
    flash(`${fresh.length} ${many} pasted — drag to place`);
  }

  document.addEventListener('copy', (e) => {
    if (inField(e.target) || !heldMarks().length) return;
    e.preventDefault();
    const text = copyHeld(false);
    if (text && e.clipboardData) e.clipboardData.setData('text/plain', text);
  });

  document.addEventListener('cut', (e) => {
    if (inField(e.target) || !heldMarks().length) return;
    e.preventDefault();
    const text = copyHeld(true);
    if (text && e.clipboardData) e.clipboardData.setData('text/plain', text);
  });

  document.addEventListener('paste', (e) => {
    if (inField(e.target)) return;
    e.preventDefault();
    const text = e.clipboardData ? e.clipboardData.getData('text/plain') : '';
    pasteMarks(marksFromText(text) || clipboard);
  });

  // The buttons take the same road, except that only the paste event may
  // read the clipboard without asking, so they fall back to this copy.
  function copyToSystem(text) {
    if (text && navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => {});
    }
  }

  /* Topmost mark under the point. Outlines are tested first so a line
     lying across a filled area still wins. `interior` adds a final
     pass through the middle of unfilled closed shapes, which is what
     you want when picking something up but not when rubbing it out. */
  // World back into one square's own frame — the inverse of placeIn.
  function unplaceIn(w, i, j) {
    const r = rotAt(state.pattern, i, j);
    let dx = w.x - i * T - T / 2, dy = w.y - j * T - T / 2;
    for (let k = (4 - r) % 4; k > 0; k--) { const t = dx; dx = -dy; dy = t; }
    return { x: dx + T / 2, y: dy + T / 2 };
  }

  /* A mark may run past its own square and, with clipping off, show
     there — so the ink under the cursor can belong to a neighbour's
     copy of it, at coordinates this square knows nothing about. That
     ink was unerasable: the tool looked only where this square would
     have drawn the mark, found nothing, and did nothing. `anyTile` looks
     outward from this square as well, mapping the point back through
     each neighbour's own quarter-turn. It is off where a hit starts a
     drag, since a mark grabbed by a turned neighbour's copy would
     follow the pointer turned. */
  function hitTest(p, opts) {
    const o = opts || {};
    /* In order of what the eye would pick out: a border first, then the
       interior a closed mark carries, then a fill, then the inside of an
       open shape. Borders and interiors used to be one pass, so a mark
       holding an interior answered for every click inside itself — and a
       line drawn across such a mark could not be got at, whatever you
       did. Now the border wins wherever it is. */
    const passes = o.strokesOnly ? ['edge', 'interior']
      : o.interior ? ['edge', 'interior', 'fill', 'inside']
      : ['edge', 'interior', 'fill'];

    /* Where to look. This square first; then, with `anyTile`, outward
       from it — because a mark may run past its own square and, with
       clipping off, show there, so the ink under the cursor can belong
       to a neighbour's copy at coordinates this square knows nothing
       about. That ink was untouchable: the tool looked only where this
       square would have drawn the mark, found nothing, and did nothing.
       Each pass is tried in every square before the next begins, so a
       border anywhere beats a fill here — which is the order they are
       painted in, and so the order they are seen in. */
    const spots = [p];
    if (o.anyTile && !state.clip) {
      const pad = Math.min(overhang(state.shapes), 2);
      if (pad) {
        const home = drawTile || activeTile;
        const world = placeIn(p, home.i, home.j);
        for (let ring = 1; ring <= pad; ring++) {
          for (let dj = -ring; dj <= ring; dj++) {
            for (let di = -ring; di <= ring; di++) {
              if (Math.max(Math.abs(di), Math.abs(dj)) !== ring) continue;
              spots.push(unplaceIn(world, home.i + di, home.j + dj));
            }
          }
        }
      }
    }

    for (const pass of passes) {
      for (const q of spots) {
        const hit = hitPass(q, o, pass);
        if (hit) return hit;
      }
    }
    return null;
  }

  function hitPass(p, o, pass) {
    const tol = Math.max(7 / state.view.scale, 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let hit = null;
    for (let k = state.shapes.length - 1; k >= 0; k--) {
      const s = state.shapes[k];
      const path = pathOf(s);
      if (pass === 'edge') {
        if (s.layer !== 'stroke') continue;
        // A solid shape is all ink, so its whole area is its border.
        if (s.filled && ctx.isPointInPath(path, p.x, p.y)) { hit = s; break; }
        ctx.lineWidth = Math.max(s.width, tol * 2);
        if (ctx.isPointInStroke(path, p.x, p.y)) { hit = s; break; }
      } else if (pass === 'interior') {
        // `edgeOnly` keeps the border and the interior tellable apart,
        // which is what lets the fill tool recolour one or the other.
        if (s.layer !== 'stroke' || o.edgeOnly || s.filled || !s.fillColor) continue;
        if (ctx.isPointInPath(path, p.x, p.y)) { hit = s; break; }
      } else if (pass === 'fill') {
        if (s.layer !== 'fill') continue;
        if (ctx.isPointInPath(path, p.x, p.y, 'evenodd')) { hit = s; break; }
      } else {
        if (s.layer !== 'stroke' || s.filled || !CLOSED[s.kind]) continue;
        if (ctx.isPointInPath(path, p.x, p.y)) { hit = s; break; }
      }
    }
    ctx.restore();
    return hit;
  }

  function eraseAt(w) {
    const hit = hitTest(w, { anyTile: true });
    if (hit) replaceShapes(state.shapes.filter((s) => s !== hit));
  }

  /* ---------------- fill ----------------
     Rasterise the strokes of the tile into a scratch grid, flood the
     area under the cursor, then hand the boundary back as a polygon.
     Nothing raster is kept: the shape stored is a vector region.     */

  const fillCanvas = document.createElement('canvas');
  fillCanvas.width = fillCanvas.height = FILL_RES;
  const fctx = fillCanvas.getContext('2d', { willReadFrequently: true });

  // Which edges of its grid does the flooded area run up to?
  function edgesHit(m, R) {
    let top = false, bottom = false, left = false, right = false;
    const last = (R - 1) * R;
    for (let x = 0; x < R; x++) {
      if (m[x]) top = true;
      if (m[last + x]) bottom = true;
    }
    for (let y = 0; y < R; y++) {
      if (m[y * R]) left = true;
      if (m[y * R + R - 1]) right = true;
    }
    return {
      any: top || bottom || left || right,
      all: top && bottom && left && right,
    };
  }

  function recolour(shape) {
    if (shape.color === state.color) return flash('Already that ink');
    const next = Object.assign({}, shape, { color: state.color });
    replaceShapes(state.shapes.map((sh) => (sh === shape ? next : sh)));
    select(picked.map((sh) => (sh === shape ? next : sh)));
    flash('Mark recoloured');
  }

  /* If a flooded area turns out to be exactly the inside of one closed
     mark, it belongs to that mark rather than being a separate polygon
     slid underneath it. */
  function interiorHost(p, region) {
    const rb = loopsBBox(region.loops);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let host = null;
    for (let k = state.shapes.length - 1; k >= 0; k--) {
      const s = state.shapes[k];
      if (s.layer !== 'stroke' || s.filled || !CLOSED[s.kind]) continue;
      if (!ctx.isPointInPath(pathOf(s), p.x, p.y)) continue;
      const sb = shapeBBox(s);
      // The traced area sits half a stroke inside the path and is grown
      // slightly, so it lands near the mark's own box, never far from it.
      if (sb && bboxNear(sb, rb, s.width / 2 + 8)) host = s;
      break;   // only the topmost mark around the point can own it
    }
    ctx.restore();
    return host;
  }

  function doFill(w) {
    // Landing on a mark's border recolours the border. Interiors and
    // filled areas fall through to the flood below, so a region can
    // still be cut up by new lines and its parts filled separately.
    const onEdge = hitTest(w, { strokesOnly: true, edgeOnly: true, anyTile: true });
    if (onEdge) return recolour(onEdge);

    const offs = state.wrap ? WRAP : ORIGIN;
    const home = drawTile || activeTile;
    const r0 = rotAt(state.pattern, home.i, home.j);
    const pad = state.clip ? 0 : Math.min(overhang(state.shapes), 2);
    const places = [];
    for (let dj = -pad; dj <= pad; dj++) {
      for (let di = -pad; di <= pad; di++) {
        places.push([di, dj, rotAt(state.pattern, home.i + di, home.j + dj)]);
      }
    }
    findCrossJunctions();

    /* The flood runs on a grid laid over the square. An area held in
       partly by a neighbour's ink runs past that square's edge, and a
       fill that stopped there left a bite out of the shape — so when the
       flood reaches the edge of its grid, the grid is laid again over
       the square and the ring around it and the flood run afresh. Most
       fills never touch the edge and pay nothing for it; the ones that
       do are traced at a slightly coarser cell, which the snap onto the
       walls afterwards makes good anyway. */
    let rings = 0;
    let cropped = false;           // gave up looking for a closed boundary
    const maxRings = pad ? 1 : 0;  // the square and the ring around it
    let ox = 0, oy = 0, span = T, R = FILL_RES, k = R / T;
    let px, barrier, walls, mask, traced, grow, raw, edges;

    for (;;) {
      ox = -rings * T;
      oy = -rings * T;
      span = (1 + 2 * rings) * T;
      R = Math.min(FILL_MAX, Math.round((FILL_RES * span) / T));
      k = R / span;
      // Wrapping makes a torus of one square; a wider grid is not one.
      const wrapOK = state.wrap && !rings;
      if (fillCanvas.width !== R) fillCanvas.width = fillCanvas.height = R;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, R, R);
      fctx.lineCap = 'round';
      fctx.lineJoin = 'round';

      /* Barriers have to be everything the eye can see holding the area
         in, not only this square's own marks. With clipping off a mark
         runs over its neighbours, so the squares around this one lay ink
         on it as well — and an area enclosed by that ink flooded
         straight out, because the flood had never been told about it.
         Each neighbour is drawn through its own quarter-turn and mapped
         back into this square's frame; the wrapped copies come too, when
         edge wrapping is on.
         Each mark is laid down in a colour that encodes its index, so
         one read gives both the barriers and which mark made each. */
      let barriers = 0;
      let thinnest = Infinity;   // the narrowest wall, in cells
      for (const [di, dj, r] of places) {
        tileKey = `${mod(home.i + di, state.pattern.n)},${mod(home.j + dj, state.pattern.n)}`;
        for (const o of offs) {
          fctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
          fctx.translate(T / 2, T / 2);
          fctx.rotate((-r0 * Math.PI) / 2);
          fctx.translate(di * T, dj * T);
          fctx.rotate((r * Math.PI) / 2);
          fctx.translate(-T / 2, -T / 2);
          fctx.translate(o[0] * T, o[1] * T);
          state.shapes.forEach((sh, idx) => {
            if (sh.layer !== 'stroke') return;
            const id = idx + 1;
            const col = `rgb(${id & 255},${(id >> 8) & 255},0)`;
            fctx.strokeStyle = col;
            fctx.fillStyle = col;
            const path = pathOf(sh);
            if (sh.filled) fctx.fill(path);
            else {
              const [cap, join] = capsOf(sh.kind);
              fctx.lineCap = cap;
              fctx.lineJoin = join;
              const pen = Math.max(sh.width, 2 / k);
              fctx.lineWidth = pen;
              fctx.stroke(path);
              paintJunctions(fctx, sh, pen);
              if (pen * k < thinnest) thinnest = pen * k;
            }
            barriers++;
          });
        }
      }
      if (!barriers) return flash('Draw an outline first');

      px = fctx.getImageData(0, 0, R, R).data;
      barrier = new Uint8Array(R * R);
      // Half covered counts as wall. A fainter threshold let the soft
      // edges of two converging strokes seal the gap between them long
      // before they actually met, so a narrow wedge stopped filling well
      // short of its point.
      for (let i = 0, n = R * R; i < n; i++) barrier[i] = px[i * 4 + 3] >= 128 ? 1 : 0;

      const seed = {
        x: clamp(Math.round((w.x - ox) * k), 0, R - 1),
        y: clamp(Math.round((w.y - oy) * k), 0, R - 1),
      };
      raw = floodMask(barrier, R, R, seed.x, seed.y, wrapOK);
      if (!raw) return flash('No open area under the cursor');

      /* Still running when it met the edge of the grid? Then the area
         goes on into the next square and the grid was too small. Two
         things are not that: an area meeting all four edges is the
         ground the marks sit on, and the ground is a square; and an area
         still running at the widest grid was never enclosed at all, so
         it is traced over the square again — a mark the size of the
         square tiles, where one the size of three does not. */
      edges = edgesHit(raw, R);
      if (!cropped && edges.any && !edges.all) {
        if (rings < maxRings) { rings++; continue; }
        if (rings) { rings = 0; cropped = true; continue; }
      }

      /* Which marks did the area come up against? Read from a little way
         outside it: only a stroke's fully opaque core carries a
         trustworthy index, because the canvas stores colour premultiplied
         by alpha and along a soft edge a small index like 3 comes back as
         2, naming an entirely different mark. */
      const near = dilate(raw, R, R, 6, wrapOK);
      const bounding = new Set();
      for (let i = 0, n = R * R; i < n; i++) {
        if (!near[i] || px[i * 4 + 3] !== 255) continue;
        const id = px[i * 4] | (px[i * 4 + 1] << 8);
        if (id >= 1 && id <= state.shapes.length) bounding.add(id - 1);
      }
      walls = [...bounding].map((i) => state.shapes[i]).filter(Boolean);

      /* How far the flood may be grown — for the bridge, and for the
         tuck at the end — is set by the thinnest wall in play. Both eat
         into a wall from the inside, and neither may eat one through: a
         mark two cells wide on the scratch grid can spare none, so a
         thin outline gets no bridging at all. A fill that stops a hair
         short of a pinch is a great deal better than one that escapes
         the shape entirely, which is what a 5-unit outline used to let
         it do. */
      grow = clamp(Math.floor((thinnest - 1) / 2), 0, FILL_GROW);

      /* Where two marks converge, the passage between them narrows below
         one cell of the grid long before the marks themselves meet, and
         the flood gives up there — leaving a pocket of unfilled paper
         past the pinch. Growing the area bridges that pinch, so flooding
         a second time through the bridge picks the pocket up. */
      const bridged = dilate(raw, R, R, grow, wrapOK);
      const pinched = new Uint8Array(R * R);
      for (let i = 0, n = R * R; i < n; i++) pinched[i] = barrier[i] && !bridged[i] ? 1 : 0;
      const filled = floodMask(pinched, R, R, seed.x, seed.y, wrapOK) || raw;
      mask = dilate(filled, R, R, grow, wrapOK);
      break;
    }

    const cells = loopsFromMask(mask, R, R, 1);
    if (!cells) return flash('No open area under the cursor');
    // Cell coordinates back into the square's own, wherever the grid sat.
    const scale = span / T;
    traced = cells.map((l) => l.map((p) => ({ x: p.x * scale + ox, y: p.y * scale + oy })));
    // The grid can only place an edge to the nearest cell. Move each
    // point onto the true edge of the mark it belongs to, a hair inside
    // so it tucks under rather than meeting it exactly.
    const loops = snapLoopsToWalls(traced, walls, 2 / k, 0.6);

    /* Everything traced came off a grid laid over this one tile, so a
       loop that lies wholly outside it is not part of the area that was
       clicked. Keeping one leaves a splinter of fill a tile away, which
       then travels with the mark and turns up in its selection. A loop
       may still overhang the edge by the depth of the tuck. */
    const near = loops.filter((l) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const p of l) {
        if (p.x < x0) x0 = p.x;
        if (p.x > x1) x1 = p.x;
        if (p.y < y0) y0 = p.y;
        if (p.y > y1) y1 = p.y;
      }
      const m = 8;
      return x1 >= ox - m && x0 <= ox + span + m && y1 >= oy - m && y0 <= oy + span + m;
    });
    if (!near.length) return flash('No open area under the cursor');
    const region = { kind: 'region', loops: near };

    const host = interiorHost(w, region);
    if (host) {
      if (host.fillColor === state.color) return flash('Already that ink');
      const next = Object.assign({}, host, { fillColor: state.color });
      replaceShapes(state.shapes.map((sh) => (sh === host ? next : sh)));
      select(picked.map((sh) => (sh === host ? next : sh)));
      return flash('Filled — border and interior are one mark');
    }

    region.id = shapeSeq++;
    region.layer = 'fill';
    region.color = state.color;
    // Remember what the area came up against, so it can never be painted
    // over the top of it.
    region.walls = walls.map((sh) => sh.id).filter((v) => v != null);

    // An area that reaches all four edges is the ground the marks sit
    // on, not the inside of any of them; grouping it would tie the whole
    // picture together. An area that had to be traced over more than one
    // square is by definition not it.
    const isGround = !rings && edges.all;

    if (walls.length && !isGround) {
      /* Every fill makes its own group, out of the marks around it that
         are not already spoken for. A mark that already belongs to a
         group keeps it — otherwise a later fill crossing an earlier
         shape would walk off with half of its border. */
      const free = walls.filter((sh) => !sh.group);
      let next = state.shapes;
      let gid;
      if (free.length) {
        gid = groupSeq++;
        const claim = new Set(free);
        next = state.shapes.map((sh) => (claim.has(sh)
          ? Object.assign({}, sh, { group: gid })
          : sh));
      } else {
        // Everything around it is already grouped: join the topmost.
        gid = walls.reduce((a, b) =>
          (state.shapes.indexOf(b) > state.shapes.indexOf(a) ? b : a)).group;
      }
      region.group = gid;
      undoStack.push(state.shapes.slice());
      redoStack.length = 0;
      state.shapes = next.concat([region]);
      select([]);
      afterChange();
      const n = free.length || walls.length;
      return flash(n > 1
        ? `Filled — grouped with the ${n} marks around it`
        : 'Filled — grouped with the mark around it');
    }

    // Filling the same area again should recolour it in place rather
    // than stack another polygon under the first one.
    const bb = loopsBBox(region.loops);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    const same = state.shapes.find((sh) => sh.layer === 'fill'
      && sh.loops.length === region.loops.length
      && bboxNear(loopsBBox(sh.loops), bb, 8)
      && ctx.isPointInPath(pathOf(sh), w.x, w.y, 'evenodd'));
    ctx.restore();

    if (same) replaceShapes(state.shapes.map((sh) => (sh === same ? region : sh)));
    else commit(region);
  }

  /* ---------------- pointer input ---------------- */

  let lastWorld = { x: -1e6, y: -1e6 };
  const screenPt = (e) => ({ x: e.clientX - rect.left, y: e.clientY - rect.top });

  canvas.addEventListener('pointerdown', (e) => {
    const s = screenPt(e);
    // A mouse only ever has one pointer, so anything else still in the
    // map is stale — left behind by a pointerup we never saw. Without
    // this the next press looks like a two-finger pinch and drawing
    // quietly stops working.
    if (e.pointerType === 'mouse') pointers.clear();
    altHeld = e.altKey;
    pointers.set(e.pointerId, s);
    if (pointers.size === 2) { startPinch(); return; }
    if (pointers.size > 2) return;
    canvas.setPointerCapture(e.pointerId);
    updateActive(toWorld(s.x, s.y));
    const w = drawPt(s.x, s.y);

    const panGesture = e.button === 1 || e.button === 2;
    if (dropper && !panGesture) { pickFrom(s, w); return; }

    // A mark waiting on its next click is set wherever that click lands,
    // including in another square.
    if (pending && !panGesture) { advancePending(); return; }

    if (panGesture) {
      mode = 'pan';
      panFrom = { x: s.x, y: s.y, vx: state.view.x, vy: state.view.y };
      canvas.classList.add('panning');
      return;
    }
    mode = 'draw';
    if (startDraw(w, e) === false) {
      // nothing under the cursor to pick up — drag the plane instead
      mode = 'pan';
      panFrom = { x: s.x, y: s.y, vx: state.view.x, vy: state.view.y };
      canvas.classList.add('panning');
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const s = screenPt(e);
    altHeld = e.altKey;
    if (pointers.has(e.pointerId)) pointers.set(e.pointerId, s);

    if (mode === 'pinch' && pointers.size >= 2) { movePinch(); return; }
    if (mode === 'pan') {
      state.view.x = panFrom.vx + (s.x - panFrom.x);
      state.view.y = panFrom.vy + (s.y - panFrom.y);
      requestDraw();
      return;
    }
    updateActive(toWorld(s.x, s.y));
    const w = drawPt(s.x, s.y);
    lastWorld = w;
    noteHover(w);
    if (pending === 'bend') { bendPending(w); return; }
    if (pending === 'point' || mode === 'draw') { moveDraw(w); return; }
    if (state.tool === 'select') {
      canvas.classList.toggle('grabbable', insideTile(w, 5) && !!hitTest(w, { interior: true }));
    }
  });

  function release(e) {
    pointers.delete(e.pointerId);
    // A quick flick can release past the last pointermove; take the
    // release position as the final one.
    if (mode === 'draw' && (draft || moving || lasso)) {
      const s = screenPt(e);
      moveDraw(drawPt(s.x, s.y));
    }
    if (mode === 'pinch') {
      if (pointers.size < 2) { mode = null; pinchFrom = null; }
      return;
    }
    if (mode === 'pan') {
      canvas.classList.remove('panning');
      mode = null;
      return;
    }
    if (mode === 'draw') { endDraw(); mode = null; }
  }

  canvas.addEventListener('pointerleave', () => {
    if (hoverSnap) { hoverSnap = null; requestDraw(); }
  });
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  /* Sweeping an area. With the select tool up, a drag that starts on
     empty paper pulls a box out from where it began; the count follows
     the pointer, and everything wholly inside is held on release. */
  function caughtBy(box) {
    return box ? state.shapes.filter((sh) => holds(box, shapeBBox(sh))) : [];
  }

  function lassoBox() {
    if (!lasso) return null;
    const a = lasso.a, b = lasso.b;
    const box = {
      x0: Math.min(a.x, b.x), y0: Math.min(a.y, b.y),
      x1: Math.max(a.x, b.x), y1: Math.max(a.y, b.y),
    };
    const least = 6 / state.view.scale;
    return box.x1 - box.x0 > least && box.y1 - box.y0 > least ? box : null;
  }

  // Wholly inside, not merely touched: sweeping over a figure should not
  // drag in the ground it is sitting on.
  function holds(box, b) {
    return !!b && b.x0 >= box.x0 && b.y0 >= box.y0 && b.x1 <= box.x1 && b.y1 <= box.y1;
  }

  function endLasso(drop) {
    if (!lasso) return false;
    const box = drop ? null : lassoBox();
    const base = lasso.base;
    lasso = null;
    if (drop) select(base);
    if (box) {
      const caught = caughtBy(box);
      select(base.concat(caught));
      flash(caught.length
        ? `${caught.length} ${caught.length === 1 ? 'mark' : 'marks'} picked up`
        : 'Nothing wholly inside that area');
    }
    requestDraw();
    return true;
  }

  function drawLasso() {
    const box = lassoBox();
    if (!box) return;
    const pts = [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]]
      .map(([x, y]) => { const q = fromTileSpace({ x, y }); return w2s(q.x, q.y); });
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < 4; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.closePath();
    ctx.fillStyle = 'rgba(207, 67, 38, 0.07)';
    ctx.fill();
    ctx.strokeStyle = ACCENT;
    ctx.globalAlpha = 0.8;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.restore();
  }

  /* trackpad: pinch arrives as a ctrl-flagged wheel, two-finger
     scroll as a plain one */
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = screenPt(e);
    const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? ch : 1;
    if (e.ctrlKey || e.metaKey) {
      zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.01));
    } else {
      state.view.x -= e.deltaX * k;
      state.view.y -= e.deltaY * k;
      requestDraw();
    }
  }, { passive: false });

  // Safari trackpad / touch gestures
  let gestureScale = 1, gestureAt = { x: 0, y: 0 };
  canvas.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    gestureScale = e.scale || 1;
    gestureAt = screenPt(e);
  });
  canvas.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    const s = e.scale || 1;
    zoomAt(gestureAt.x, gestureAt.y, s / gestureScale);
    gestureScale = s;
  });

  function startPinch() {
    cancelDraft();
    if (mode === 'pan') canvas.classList.remove('panning');
    mode = 'pinch';
    const [a, b] = Array.from(pointers.values());
    pinchFrom = {
      d: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
      c: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 },
    };
  }

  function movePinch() {
    const [a, b] = Array.from(pointers.values());
    const d = Math.max(1, Math.hypot(a.x - b.x, a.y - b.y));
    const c = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    zoomAt(pinchFrom.c.x, pinchFrom.c.y, d / pinchFrom.d);
    state.view.x += c.x - pinchFrom.c.x;
    state.view.y += c.y - pinchFrom.c.y;
    pinchFrom = { d, c };
    requestDraw();
  }

  /* ---------------- keyboard ---------------- */

  const TOOL_KEYS = {
    ' ': 'select', p: 'pencil', l: 'line', a: 'curve',
    c: 'circle', r: 'rect', f: 'fill', e: 'erase',
  };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    if (e.key === 'Escape' && closeNewPrompt()) { e.preventDefault(); return; }
    // Space picks a tool now, so stop the browser scrolling the page or
    // re-clicking whichever button still holds focus.
    if (e.key === ' ') e.preventDefault();
    const k = e.key.toLowerCase();
    const meta = e.metaKey || e.ctrlKey;

    if (meta && k === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (meta && k === 'y') { e.preventDefault(); redo(); return; }
    if (meta && k === 's') { e.preventDefault(); saveProject(e.shiftKey); return; }
    if (meta && k === 'o') { e.preventDefault(); loadProject(); return; }
    if (meta && k === 'g') { e.preventDefault(); e.shiftKey ? ungroupPicked() : groupPicked(); return; }
    if (meta) return;

    if (picked.length && !draft && !pending) {
      const far = e.shiftKey ? 5 : 1;
      const step = (snapping() ? T / effSub() : 10) * far;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) {
        e.preventDefault();
        const members = heldMarks();
        const moved = moveGroup(members, d[0] * step, d[1] * step);
        const swap = new Map(members.map((sh, k) => [sh, moved[k]]));
        replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), moved));
        select(picked.map((sh) => swap.get(sh) || sh));
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const gone = new Set(heldMarks());
        select([]);
        replaceShapes(state.shapes.filter((sh) => !gone.has(sh)));
        flash(gone.size > 1 ? `${gone.size} marks deleted` : 'Mark deleted');
        return;
      }
    }
    if (e.key === 'Shift') { shiftHeld = true; return; }
    if (e.key === 'Alt') { altHeld = true; noteHover(lastWorld); return; }
    if (e.key === 'Escape') {
      if (dropper) { armDropper(false); return; }
      if (endLasso(true)) { requestDraw(); return; }
      if (!cancelDraft() && picked.length) { select([]); requestDraw(); }
      return;
    }
    if (k === 'i') { armDropper(!dropper); return; }
    if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
    if (k >= '1' && k <= '9') { setColor(currentColors()[+k - 1]); return; }
    if (k === '0') { setColor(currentColors()[9]); return; }
    if (k === '[') { setWidth(state.width - (state.width > 12 ? 4 : 1)); return; }
    if (k === ']') { setWidth(state.width + (state.width >= 12 ? 4 : 1)); return; }
    if (k === 'g') { groupPicked(); return; }
    if (k === 'u') { ungroupPicked(); return; }
    // Tile rules gave up G to grouping; T for tiles.
    if (k === 't') { toggle('grid'); return; }
    if (k === 's') { toggle('snap'); return; }
    if (k === 'd') { setSub(SUBS[(SUBS.indexOf(state.sub) + 1) % SUBS.length]); return; }
    if (k === 'k') { toggle('clip'); return; }
    if (k === 'w') { toggle('wrap'); return; }
    if (k === 'h') { resetView(); return; }
    if (k === '=' || k === '+') { zoomAt(cw / 2, ch / 2, 1.2); return; }
    if (k === '-') { zoomAt(cw / 2, ch / 2, 1 / 1.2); return; }
  });

  window.addEventListener('blur', () => {
    pointers.clear();
    shiftHeld = altHeld = false;
    canvas.classList.remove('outside', 'panning');
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') e.preventDefault();
    if (e.key === 'Shift') shiftHeld = false;
    if (e.key === 'Alt') { altHeld = false; noteHover(lastWorld); }
  });

  /* ---------------- ui ---------------- */

  let hintTimer = 0;
  function setHint(text, live) {
    clearTimeout(hintTimer);
    hintEl.textContent = text;
    hintEl.classList.toggle('live', !!live);
  }
  function flash(text) {
    setHint(text, true);
    hintTimer = setTimeout(() => setHint(HINTS[state.tool] || HINTS.base), 1900);
  }

  function setTool(tool) {
    if (pending) cancelDraft();
    if (tool !== 'select') select([]);
    endLasso(true);
    if (dropper) armDropper(false);
    state.tool = tool;
    canvas.classList.toggle('selecting', tool === 'select');
    canvas.classList.remove('grabbable');
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === tool);
    setHint(HINTS[tool] || HINTS.base);
    saveSoon();
  }

  function setColor(raw, quiet) {
    const hex = normHex(raw);
    if (!hex) return;
    state.color = hex;
    for (const b of document.querySelectorAll('.swatch')) b.classList.toggle('on', b.dataset.color === hex);
    syncMixer(quiet);
    if (picked.length) {
      const swap = new Map();
      for (const sh of picked) if (sh.color !== hex) swap.set(sh, Object.assign({}, sh, { color: hex }));
      if (swap.size) {
        replaceShapes(state.shapes.map((sh) => swap.get(sh) || sh));
        select(picked.map((sh) => swap.get(sh) || sh));
      }
    }
    saveSoon();
  }

  /* The eyedropper reads the canvas, not the screen: the paper grain
     lies over the whole window on a multiply blend, so anything sampled
     off the screen would come back tinted and grainy, never the colour
     that is actually in the drawing. */
  let dropper = false;

  function armDropper(on) {
    dropper = on;
    document.getElementById('dropBtn').classList.toggle('armed', on);
    canvas.classList.toggle('dropping', on);
    if (on) setHint('Click anywhere in the drawing to take its colour · Esc to stop', true);
    else setHint(HINTS[state.tool] || HINTS.base);
  }

  /* Ask the mark first, and the canvas only if there is no mark. A
     stroke two units wide is half soft edge, and a pixel read off that
     edge is the mark's colour mixed with whatever is behind it — never
     the colour the mark is actually drawn in, which is the one being
     asked for. */
  function pickFrom(s, w) {
    armDropper(false);
    const border = hitTest(w, { strokesOnly: true, edgeOnly: true, anyTile: true });
    const mark = border || hitTest(w, { interior: true, anyTile: true });
    if (mark) {
      const hex = !border && mark.layer === 'stroke' && !mark.filled && mark.fillColor
        ? mark.fillColor
        : mark.color;
      setColor(hex);
      return flash(`Took ${hex}`);
    }
    const x = clamp(Math.round(s.x * dpr), 0, canvas.width - 1);
    const y = clamp(Math.round(s.y * dpr), 0, canvas.height - 1);
    const px = ctx.getImageData(x, y, 1, 1).data;
    if (px[3] < 8) return flash('Nothing there to take');
    const hex = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    setColor(hex);
    flash(`Took ${hex} off the paper`);
  }

  function setWidth(v) {
    state.width = clamp(Math.round(v), 1, 64);
    document.getElementById('width').value = state.width;
    document.getElementById('widthVal').textContent = state.width;
    saveSoon();
  }

  function toggle(name) {
    state[name] = !state[name];
    syncToggles();
    if (name === 'snap') {
      // Asking for snapping with no lattice to snap to isn't useful;
      // give it a reasonable one.
      flash(state.snap
        ? (state.sub ? `Snapping to marks and a ${state.sub} × ${state.sub} grid · hold Alt to ignore`
                     : 'Snapping to marks · hold Alt to ignore')
        : 'Snapping off');
      hoverSnap = null;
    }
    requestDraw();
    saveSoon();
  }

  const modeWrap = document.getElementById('diagModes');
  DIAG_MODES.forEach(([id, name]) => {
    const b = document.createElement('button');
    b.dataset.diag = id;
    b.textContent = name;
    b.title = id === 'off' ? 'Everything square'
      : id === 'grid' ? 'Turn the alignment grid only — rectangles draw as diamonds'
      : 'Turn the whole plane, tiles and rules with it';
    b.addEventListener('click', () => setDiag(id));
    modeWrap.appendChild(b);
  });

  function setDiag(mode, quiet) {
    state.diag = mode;
    for (const b of modeWrap.children) b.classList.toggle('on', b.dataset.diag === mode);
    rotateAt(cw / 2, ch / 2, (mode === 'plane' ? Math.PI / 4 : 0) - state.view.rot);
    hoverSnap = null;
    cancelDraft();
    if (!quiet) {
      flash(mode === 'plane' ? 'Whole plane turned 45°'
        : mode === 'grid' ? 'Isometric frame · every step the same length · boxes draw as cube faces'
        : 'Square again');
    }
    requestDraw();
    saveSoon();
  }

  const SUBS = [0, 2, 3, 4, 6, 8, 12, 16];
  const subWrap = document.getElementById('subs');
  SUBS.forEach((n) => {
    const b = document.createElement('button');
    b.dataset.sub = n;
    b.textContent = n === 0 ? 'Off' : n;
    b.title = n === 0 ? 'No alignment grid — D cycles' : `${n} × ${n} grid — D cycles`;
    b.addEventListener('click', () => setSub(n));
    subWrap.appendChild(b);
  });

  function setSub(n) {
    state.sub = n;
    for (const b of subWrap.children) b.classList.toggle('on', +b.dataset.sub === n);
    hoverSnap = null;
    // The snap switch is left exactly as the user set it. With no
    // lattice there is simply nothing to snap to, so it shows as
    // inactive rather than being flipped behind their back.
    syncToggles();
    if (state.snap) {
      flash(n ? `Snapping to a ${n} × ${n} grid · hold Alt to ignore`
              : 'Grid off — snapping to marks only');
    }
    requestDraw();
    saveSoon();
  }

  function syncToggles() {
    for (const b of document.querySelectorAll('[data-toggle]')) {
      b.classList.toggle('on', !!state[b.dataset.toggle]);
    }
  }

  document.querySelector('.rail').addEventListener('pointerdown', () => {
    if (pending) cancelDraft();
  }, true);

  document.getElementById('tools').addEventListener('click', (e) => {
    const b = e.target.closest('.tool');
    if (b) setTool(b.dataset.tool);
  });

  document.getElementById('groupBtn').addEventListener('click', groupPicked);
  document.getElementById('ungroupBtn').addEventListener('click', ungroupPicked);
  document.getElementById('turnLeftBtn').addEventListener('click', () => turnHeld(-1));
  document.getElementById('turnRightBtn').addEventListener('click', () => turnHeld(1));
  document.getElementById('cutBtn').addEventListener('click', () => copyToSystem(copyHeld(true)));
  document.getElementById('copyBtn').addEventListener('click', () => copyToSystem(copyHeld(false)));
  document.getElementById('pasteBtn').addEventListener('click', () => pasteMarks(clipboard));

  /* ---------------- palette ---------------- */

  const swatchWrap = document.getElementById('swatches');
  const palSel = document.getElementById('palSel');
  const palNameRow = document.getElementById('palNameRow');
  const palNameInput = document.getElementById('palName');
  const palDelBtn = document.getElementById('palDel');
  const hexInput = document.getElementById('hexInput');
  const hexPick = document.getElementById('hexPick');
  const mixPreview = document.getElementById('mixInk');
  const alphaInput = document.getElementById('alpha');
  const alphaVal = document.getElementById('alphaVal');

  let delArmed = 0;

  function ownPalette(name) {
    return state.palettes.find((p) => p.name === name) || null;
  }
  function activePalette() {
    return ownPalette(state.palette)
      || BUILT_IN.find((p) => p.name === state.palette)
      || BUILT_IN[0];
  }
  function currentColors() { return activePalette().colors; }
  function isMine() { return !!ownPalette(state.palette); }

  function freeName(base) {
    const taken = (n) => BUILT_IN.some((p) => p.name === n) || !!ownPalette(n);
    if (!taken(base)) return base;
    for (let i = 2; ; i++) if (!taken(`${base} ${i}`)) return `${base} ${i}`;
  }

  function buildPalettePicker() {
    palSel.innerHTML = '';
    const mk = (label, list) => {
      if (!list.length) return;
      const g = document.createElement('optgroup');
      g.label = label;
      for (const p of list) {
        const o = document.createElement('option');
        o.value = p.name;
        o.textContent = `${p.name} · ${p.colors.length}`;
        g.appendChild(o);
      }
      palSel.appendChild(g);
    };
    mk('Built in', BUILT_IN);
    mk('Yours', state.palettes);
    palSel.value = activePalette().name;
    palDelBtn.disabled = !isMine();
    disarmDelete();
  }

  function buildSwatches() {
    const mine = isMine();
    swatchWrap.innerHTML = '';
    currentColors().forEach((hex, idx) => {
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.color = hex;
      const a = alphaOf(hex);
      const key = idx < 10 ? ` — ${idx === 9 ? 0 : idx + 1}` : '';
      b.title = hex + (a < 255 ? ` (${Math.round((a / 255) * 100)}%)` : '') + key;
      b.innerHTML = `<span class="well chk"><i style="background:${hex}"></i></span>`
        + (mine ? '<i class="kill" title="Remove this colour">\u00d7</i>' : '');
      b.addEventListener('click', (e) => {
        if (e.target.classList.contains('kill')) { dropSwatch(idx); return; }
        setColor(hex);
      });
      swatchWrap.appendChild(b);
    });
    for (const b of swatchWrap.children) b.classList.toggle('on', b.dataset.color === state.color);
  }

  // The mixer always shows the ink in hand — except the hex field while
  // it is being typed into, which would fight the cursor.
  function syncMixer(quiet) {
    const hex = state.color;
    const a = alphaOf(hex);
    mixPreview.style.background = hex;
    hexPick.value = rgbOf(hex);
    alphaInput.value = Math.round((a / 255) * 100);
    alphaVal.textContent = alphaInput.value;
    if (!quiet && document.activeElement !== hexInput) {
      hexInput.value = hex;
      hexInput.classList.remove('bad');
    }
  }

  function usePalette(name) {
    state.palette = activePaletteName(name);
    buildPalettePicker();
    buildSwatches();
    saveSoon();
  }
  function activePaletteName(name) {
    return (ownPalette(name) || BUILT_IN.find((p) => p.name === name) || BUILT_IN[0]).name;
  }

  function addSwatch() {
    const hex = state.color;
    let pal = ownPalette(state.palette);
    if (!pal) {
      // Built-ins stay as printed; take a copy and add to that instead.
      pal = { name: freeName('My ' + state.palette), colors: currentColors().slice() };
      state.palettes.push(pal);
      state.palette = pal.name;
      buildPalettePicker();
      flash(`Copied into “${pal.name}”`);
    }
    if (pal.colors.includes(hex)) { buildSwatches(); return flash('Already in the palette'); }
    if (pal.colors.length >= 40) return flash('That palette is full');
    pal.colors.push(hex);
    buildPalettePicker();
    buildSwatches();
    saveSoon();
  }

  function dropSwatch(idx) {
    const pal = ownPalette(state.palette);
    if (!pal || pal.colors.length <= 1) return flash('A palette keeps at least one colour');
    pal.colors.splice(idx, 1);
    buildPalettePicker();
    buildSwatches();
    saveSoon();
  }

  function openNameRow() {
    palNameRow.hidden = false;
    palNameInput.value = freeName('My palette');
    palNameInput.focus();
    palNameInput.select();
  }
  function closeNameRow() { palNameRow.hidden = true; }

  function saveNewPalette() {
    const name = palNameInput.value.trim().slice(0, 22);
    if (!name) { palNameInput.focus(); return flash('Give the palette a name'); }
    const pal = { name: freeName(name), colors: currentColors().slice() };
    state.palettes.push(pal);
    state.palette = pal.name;
    closeNameRow();
    buildPalettePicker();
    buildSwatches();
    saveSoon();
    flash(`Palette “${pal.name}” saved`);
  }

  function disarmDelete() {
    clearTimeout(delArmed);
    palDelBtn.classList.remove('armed');
    palDelBtn.textContent = 'Del';
  }

  function deletePalette() {
    const pal = ownPalette(state.palette);
    if (!pal) return;
    if (!palDelBtn.classList.contains('armed')) {
      palDelBtn.classList.add('armed');
      palDelBtn.textContent = 'Sure?';
      delArmed = setTimeout(disarmDelete, 3000);
      return;
    }
    state.palettes = state.palettes.filter((p) => p !== pal);
    state.palette = (state.palettes[0] || BUILT_IN[0]).name;
    disarmDelete();
    buildPalettePicker();
    buildSwatches();
    saveSoon();
    flash(`Palette “${pal.name}” deleted`);
  }

  palSel.addEventListener('change', () => usePalette(palSel.value));
  document.getElementById('palNew').addEventListener('click', () => {
    if (palNameRow.hidden) openNameRow(); else closeNameRow();
  });
  document.getElementById('palSave').addEventListener('click', saveNewPalette);
  document.getElementById('palCancel').addEventListener('click', closeNameRow);
  palNameInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); saveNewPalette(); }
    if (e.key === 'Escape') { e.preventDefault(); closeNameRow(); }
  });
  palDelBtn.addEventListener('click', deletePalette);
  document.getElementById('addSwatch').addEventListener('click', addSwatch);
  document.getElementById('dropBtn').addEventListener('click', () => armDropper(!dropper));

  hexInput.addEventListener('input', () => {
    const hex = normHex(hexInput.value);
    hexInput.classList.toggle('bad', !hex && hexInput.value.trim() !== '');
    if (hex) setColor(hex, true);
  });
  hexInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); hexInput.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); hexInput.blur(); }
  });
  hexInput.addEventListener('blur', () => { hexInput.classList.remove('bad'); syncMixer(); });
  hexPick.addEventListener('input', () => setColor(withAlpha(hexPick.value, alphaOf(state.color))));

  alphaInput.addEventListener('input', () => {
    alphaVal.textContent = alphaInput.value;
    setColor(withAlpha(state.color, (+alphaInput.value / 100) * 255));
  });

  document.getElementById('width').addEventListener('input', (e) => setWidth(+e.target.value));
  for (const b of document.querySelectorAll('[data-toggle]')) {
    b.addEventListener('click', () => toggle(b.dataset.toggle));
  }

  /* symmetry ------------------------------------------------------ */

  // An arrow is the clearest possible read on which way a tile faces.
  const CELL_GLYPH = '<text x="12" y="12" text-anchor="middle" dominant-baseline="central">\u2B06\uFE0F</text>';

  const presetWrap = document.getElementById('presets');
  PRESETS.forEach((p) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.preset = p.id;
    b.textContent = p.name;
    b.addEventListener('click', () => {
      state.pattern = { n: p.n, cells: cellsFromPreset(p) };
      buildPatternGrid();
      syncSymmetry();
      requestDraw();
      saveSoon();
    });
    presetWrap.appendChild(b);
  });

  const sizeWrap = document.getElementById('sizes');
  [1, 2, 3, 4].forEach((n) => {
    const b = document.createElement('button');
    b.dataset.size = n;
    b.textContent = n;
    b.title = `${n} × ${n} block`;
    b.addEventListener('click', () => {
      if (state.pattern.n === n) return;
      state.pattern = { n, cells: resizeCells(state.pattern.cells, state.pattern.n, n) };
      buildPatternGrid();
      syncSymmetry();
      requestDraw();
      saveSoon();
    });
    sizeWrap.appendChild(b);
  });

  const gridWrap = document.getElementById('patternGrid');

  function buildPatternGrid() {
    const n = state.pattern.n;
    gridWrap.style.gridTemplateColumns = `repeat(${n}, 1fr)`;
    gridWrap.innerHTML = '';
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < n; i++) {
        const idx = j * n + i;
        const b = document.createElement('button');
        b.className = 'cell' + (idx === 0 ? ' src' : '');
        b.dataset.idx = idx;
        b.title = idx === 0 ? 'The drawing surface — always upright' : `Tile ${i},${j}`;
        b.innerHTML = `<svg viewBox="0 0 24 24">${CELL_GLYPH}</svg>`;
        if (idx > 0) {
          b.addEventListener('click', () => {
            state.pattern.cells[idx] = (state.pattern.cells[idx] + 1) % 4;
            syncSymmetry();
            requestDraw();
            saveSoon();
          });
        }
        gridWrap.appendChild(b);
      }
    }
    syncSymmetry();
  }

  function syncSymmetry() {
    const { n, cells } = state.pattern;
    for (const b of gridWrap.children) {
      const rot = cells[+b.dataset.idx] || 0;
      b.querySelector('svg').style.transform = `rotate(${rot * 90}deg)`;
    }
    const id = matchPreset(state.pattern);
    for (const b of presetWrap.children) b.classList.toggle('on', b.dataset.preset === id);
    for (const b of sizeWrap.children) b.classList.toggle('on', +b.dataset.size === n);
  }

  /* table --------------------------------------------------------- */

  document.getElementById('undo').addEventListener('click', undo);
  document.getElementById('redo').addEventListener('click', redo);
  /* Starting again offers to save what is on the table first, in the
     rail — a browser box would take the focus away from the drawing and
     looks nothing like the rest. A new drawing belongs to no file, so
     the handle goes with it. */
  const newBtn = document.getElementById('newDrawing');
  const newPrompt = document.getElementById('newConfirm');

  function closeNewPrompt() {
    if (newPrompt.hidden) return false;
    newPrompt.hidden = true;
    newBtn.classList.remove('armed');
    return true;
  }

  function startNew(quiet) {
    closeNewPrompt();
    adoptShapes([]);
    setFile(null, '');
    setDirty(false);
    if (!quiet) flash('New drawing — a clean tile and no history');
  }

  newBtn.addEventListener('click', () => {
    const dropped = cancelDraft();
    select([]);
    requestDraw();
    // Nothing on the table is nothing to save; just let go of the file.
    if (!state.shapes.length) {
      if (fileHandle || fileNameEl.textContent) return startNew();
      return flash(dropped ? 'Unfinished mark dropped' : 'The tile is already empty');
    }
    newPrompt.hidden = false;
    newBtn.classList.add('armed');   // it stays put: hiding it would reflow the row
    document.getElementById('newYes').focus();
  });

  document.getElementById('newYes').addEventListener('click', async () => {
    // Only start over once the drawing is safely down. Backing out of
    // the file picker leaves the table exactly as it was.
    if (await saveProject(false)) startNew(true);
  });
  document.getElementById('newNo').addEventListener('click', () => startNew());
  document.getElementById('newCancel').addEventListener('click', closeNewPrompt);

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  const stamp = () => new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');

  /* ---------------- the drawing as a file ----------------

     A .tessera.json holds the artwork and nothing else: the marks, the
     symmetry block they repeat under, and the three plane settings that
     change what the pattern looks like. Which tool is in hand, the
     lattice, the palette — none of that belongs to the drawing.

     Where the browser has the File System Access API, the handle of the
     file that was opened or saved is kept, so Save writes back to it
     without asking again; the handle is stashed in IndexedDB so it
     survives a reload. Everywhere else Save falls back to a download.
     (The pattern is lifted from swimlane-studio, which does the same
     for its diagram source.) */

  const FORMAT = 'tessera';
  const fileNameEl = document.getElementById('fileName');
  let fileHandle = null;
  let dirty = false;

  const HANDLE_DB = 'tessera';
  const HANDLE_STORE = 'handles';
  const HANDLE_KEY = 'current-file';

  function idbHandle(mode, run) {
    return new Promise((resolve, reject) => {
      if (!window.indexedDB) { resolve(undefined); return; }
      const open = indexedDB.open(HANDLE_DB, 1);
      open.onupgradeneeded = () => open.result.createObjectStore(HANDLE_STORE);
      open.onerror = () => reject(open.error);
      open.onsuccess = () => {
        const db = open.result;
        const tx = db.transaction(HANDLE_STORE, mode);
        const req = run(tx.objectStore(HANDLE_STORE));
        tx.oncomplete = () => { db.close(); resolve(req && req.result); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      };
    });
  }
  const getHandle = () => idbHandle('readonly', (st) => st.get(HANDLE_KEY)).catch(() => undefined);
  const putHandle = (h) => idbHandle('readwrite', (st) => st.put(h, HANDLE_KEY)).catch(() => {});
  const dropHandle = () => idbHandle('readwrite', (st) => st.delete(HANDLE_KEY)).catch(() => {});

  function showFile(name) {
    fileNameEl.textContent = name || '';
    fileNameEl.hidden = !name;
    fileNameEl.classList.toggle('dirty', !!name && dirty);
  }
  function setDirty(v) {
    dirty = v;
    fileNameEl.classList.toggle('dirty', !!fileNameEl.textContent && dirty);
  }
  function setFile(handle, name) {
    fileHandle = handle || null;
    if (handle) putHandle(handle); else dropHandle();
    showFile(name != null ? name : (handle ? handle.name : ''));
  }

  (async () => {
    try {
      const h = await getHandle();
      if (h) { fileHandle = h; showFile(h.name); }
    } catch (err) { /* no handle to pick up */ }
  })();

  // Still allowed to write to it? Chrome drops the grant on a reload and
  // asks once, the first time you save after coming back.
  async function writable(handle) {
    if (!handle.queryPermission) return true;
    const opts = { mode: 'readwrite' };
    if ((await handle.queryPermission(opts)) === 'granted') return true;
    return (await handle.requestPermission(opts)) === 'granted';
  }

  /* One mark per line: the file stays a diff you can read. */
  function projectJson() {
    const head = {
      format: FORMAT,
      version: 1,
      saved: new Date().toISOString(),
      tile: T,
      pattern: state.pattern,
      plane: { clip: state.clip, wrap: state.wrap, diag: state.diag },
    };
    const lines = Object.entries(head).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    const marks = state.shapes.map((sh) => '  ' + JSON.stringify(sh)).join(',\n');
    return '{\n' + lines.join(',\n') + ',\n "shapes": [\n' + marks + '\n ]\n}\n';
  }

  const JSON_TYPES = [{ description: 'Tessera drawing', accept: { 'application/json': ['.json'] } }];
  /* The name a save should carry. With a handle it is that file's. With
     none — no picker, so the drawing goes to the downloads folder — Save
     keeps offering the name it last used, which is as near as a download
     gets to writing back over something; Save as asks for a fresh one. */
  let lastName = '';
  const suggestName = (asNew) => (fileHandle && fileHandle.name)
    || (!asNew && lastName) || `tessera-${stamp()}.json`;

  async function saveProject(asNew) {
    const text = projectJson();
    if (window.showSaveFilePicker) {
      try {
        let handle = asNew ? null : fileHandle;
        if (handle && !(await writable(handle))) handle = null;
        if (!handle) {
          handle = await window.showSaveFilePicker({ suggestedName: suggestName(asNew), types: JSON_TYPES });
        }
        const out = await handle.createWritable();
        await out.write(text);
        await out.close();
        setDirty(false);
        setFile(handle, handle.name);
        flash(`Saved ${handle.name}`);
        return true;
      } catch (err) {
        if (err && err.name !== 'AbortError') flash('That file could not be written');
        return false;   // backed out of the picker, or the write failed
      }
    }
    /* No file picker here — Safari and Firefox have no File System
       Access API — so the drawing goes to the downloads folder and
       nothing can be written back over. */
    const name = suggestName(asNew);
    lastName = name;
    download(name, new Blob([text], { type: 'application/json' }));
    setDirty(false);
    showFile(name);
    flash(`Downloaded ${name}`);
    return true;
  }

  function openProject(text, name, handle) {
    let d = null;
    try { d = JSON.parse(text); } catch (err) { return flash('That file is not JSON'); }
    if (!d || !Array.isArray(d.shapes)) return flash('No drawing in that file');
    const marks = d.shapes.filter((sh) => sh && sh.kind);
    if (!marks.length) return flash('No marks in that file');

    const p = d.pattern;
    if (p && p.n >= 1 && p.n <= 4 && Array.isArray(p.cells) && p.cells.length === p.n * p.n) {
      state.pattern = p;
      buildPatternGrid();
    }
    const plane = d.plane || {};
    for (const f of ['clip', 'wrap']) if (typeof plane[f] === 'boolean') state[f] = plane[f];
    if (DIAG_MODES.some(([id]) => id === plane.diag)) setDiag(plane.diag, true);
    syncToggles();

    cancelDraft();
    select([]);
    adoptIds(marks);
    adoptShapes(marks);
    setDirty(false);
    setFile(handle || null, name);
    const n = marks.length;
    flash(`Loaded ${name} — ${n} ${n === 1 ? 'mark' : 'marks'}`);
  }

  const loadInput = document.createElement('input');
  loadInput.type = 'file';
  loadInput.accept = '.json,application/json';
  loadInput.hidden = true;
  document.body.appendChild(loadInput);
  loadInput.addEventListener('change', async () => {
    const file = loadInput.files && loadInput.files[0];
    if (!file) return;
    // No handle from the plain input, so a later Save has to ask where.
    openProject(await file.text(), file.name, null);
  });

  async function loadProject() {
    if (window.showOpenFilePicker) {
      try {
        const [handle] = await window.showOpenFilePicker({ types: JSON_TYPES });
        const file = await handle.getFile();
        openProject(await file.text(), file.name, handle);
      } catch (err) {
        if (err && err.name !== 'AbortError') flash('That file could not be read');
      }
      return;
    }
    loadInput.value = '';   // so the same file can be picked twice
    loadInput.click();
  }

  /* Where there is no picker the button is not saving, it is
     downloading, and it should say so rather than promise a file to
     write back to that this browser cannot give us. */
  if (!window.showSaveFilePicker) {
    document.getElementById('loadJson').title =
      'Open a drawing — ⌘O · from the file chooser';
    const s1 = document.getElementById('saveJson');
    s1.textContent = 'Download';
    s1.title = 'Download the drawing — ⌘S · this browser has no file picker, '
      + 'so it goes to your downloads under the name it last used';
    const s2 = document.getElementById('saveJsonAs');
    s2.textContent = 'Download as';
    s2.title = 'Download the drawing under a new name — ⇧⌘S · this browser has '
      + 'no file picker';
    // The exports drop a file in the same place, so they say the same word.
    document.getElementById('exportSvg').textContent = 'Download SVG';
    document.getElementById('exportPng').textContent = 'Download PNG';
  }

  document.getElementById('loadJson').addEventListener('click', loadProject);
  document.getElementById('saveJson').addEventListener('click', () => saveProject(false));
  document.getElementById('saveJsonAs').addEventListener('click', () => saveProject(true));

  document.getElementById('exportSvg').addEventListener('click', () => {
    if (!state.shapes.length) return flash('Nothing to save yet');
    download(`tessera-${stamp()}.svg`, new Blob([buildSvg()], { type: 'image/svg+xml' }));
    flash('SVG saved');
  });

  // Paint one frame with the marks alone, grab it, then put the drawing
  // aids back. toBlob takes the canvas as it stands at the call, so the
  // repaint can be asked for straight away.
  function cleanPng() {
    cleanFrame = true;
    drawAll();
    cleanFrame = false;
    const blob = new Promise((resolve, reject) => {
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('no png'))), 'image/png');
    });
    requestDraw();
    return blob;
  }

  document.getElementById('exportPng').addEventListener('click', () => {
    cleanPng().then((b) => {
      download(`tessera-${stamp()}.png`, b);
      flash('PNG saved — marks only, on a clear ground');
    }, () => flash('The image could not be made'));
  });

  document.getElementById('copyPng').addEventListener('click', () => {
    if (!state.shapes.length) return flash('Nothing to copy yet');
    if (!navigator.clipboard || !window.ClipboardItem) {
      return flash('This browser keeps images off the clipboard');
    }
    /* The blob is handed over as a promise rather than awaited first:
       the clipboard only opens to a click, and awaiting spends it. */
    navigator.clipboard.write([new ClipboardItem({ 'image/png': cleanPng() })]).then(
      () => flash('PNG copied — paste it anywhere'),
      () => flash('The browser would not give up the clipboard'),
    );
  });

  function buildSvg() {
    junctions = findJunctions(state.shapes);
    const { i0, i1, j0, j1 } = tileRange();
    const n = state.pattern.n;
    // Whole blocks, at least a couple of repeats, so the saved sheet
    // reads as a pattern however far you happen to be zoomed in.
    const span = (a, b) => {
      const least = Math.max(4, n * 2);
      const start = Math.floor(a / n) * n;
      const count = Math.min(20, Math.max(least, Math.ceil((b - start + 1) / n) * n));
      return [start, start + count - 1];
    };
    const [ia, ib] = span(i0, i1);
    const [ja, jb] = span(j0, j1);
    const w = (ib - ia + 1) * T, h = (jb - ja + 1) * T;

    const body = [];
    {
      for (const entry of paintOrder(state.shapes)) {
        // A mark's interior comes through on its own, at fill depth.
        const s = entry.inside || entry;
        const d = pathData(s);
        if (!d) continue;
        if (entry.inside) {
          body.push(`<path d="${d}" ${svgPaint('fill', s.fillColor)}/>`);
          continue;
        }
        if (s.layer === 'fill') body.push(`<path d="${d}" ${svgPaint('fill', s.color)} fill-rule="evenodd"/>`);
        else if (s.filled) body.push(`<path d="${d}" ${svgPaint('fill', s.color)}/>`);
        else {
          const [cap, join] = capsOf(s.kind);
          body.push(`<path d="${d}" fill="none" ${svgPaint('stroke', s.color)}`
            + ` stroke-width="${s.width}" stroke-linecap="${cap}" stroke-linejoin="${join}"/>`);
          if (ROUNDABLE[s.kind]) {
            for (const p of endpointsOf(s)) {
              if (!junctions.has(jkey(p))) continue;
              body.push(`<circle cx="${p.x}" cy="${p.y}" r="${s.width / 2}" ${svgPaint('fill', s.color)}/>`);
            }
          }
        }
      }
    }

    const uses = [];
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        const r = rotAt(state.pattern, i, j);
        const t = `translate(${i * T} ${j * T})` + (r ? ` rotate(${r * 90} ${T / 2} ${T / 2})` : '');
        uses.push(`<use href="#tile" xlink:href="#tile" transform="${t}"${state.clip ? ' clip-path="url(#tileclip)"' : ''}/>`);
      }
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${w / 2}" height="${h / 2}" viewBox="${ia * T} ${ja * T} ${w} ${h}">
  <defs>
    <clipPath id="tileclip"><rect x="0" y="0" width="${T}" height="${T}"/></clipPath>
    <g id="tile">
      ${body.join('\n      ')}
    </g>
  </defs>
  ${uses.join('\n  ')}
</svg>
`;
  }

  /* ---------------- persistence ---------------- */

  const KEY = 'tessera.v1';
  let saveTimer = 0;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          shapes: state.shapes, pattern: state.pattern, tool: state.tool,
          color: state.color, width: state.width, filled: state.filled,
          palette: state.palette, palettes: state.palettes,
          grid: state.grid, clip: state.clip, wrap: state.wrap,
          snap: state.snap, sub: state.sub, diag: state.diag,
        }));
      } catch (err) { /* private mode, quota — not worth interrupting for */ }
    }, 400);
  }

  function restore() {
    let d = null;
    try { d = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (err) { d = null; }
    if (!d) return;
    if (Array.isArray(d.shapes)) state.shapes = d.shapes.filter((s) => s && s.kind);
    adoptIds(state.shapes);
    if (d.pattern && d.pattern.n >= 1 && d.pattern.n <= 4 && Array.isArray(d.pattern.cells)
        && d.pattern.cells.length === d.pattern.n * d.pattern.n) state.pattern = d.pattern;
    if (Array.isArray(d.palettes)) {
      state.palettes = d.palettes
        .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.colors))
        .slice(0, 40)
        .map((p) => ({
          name: p.name.slice(0, 22),
          colors: p.colors.map(normHex).filter(Boolean).slice(0, 40),
        }))
        .filter((p) => p.name && p.colors.length);
    }
    if (typeof d.palette === 'string') state.palette = d.palette;
    if (normHex(d.color)) state.color = normHex(d.color);
    if (typeof d.width === 'number') state.width = clamp(d.width, 1, 64);
    for (const f of ['filled', 'grid', 'clip', 'wrap', 'snap']) {
      if (typeof d[f] === 'boolean') state[f] = d[f];
    }
    if (typeof d.diag === 'boolean') state.diag = d.diag ? 'plane' : 'off';
    else if (DIAG_MODES.some(([id]) => id === d.diag)) state.diag = d.diag;
    if (SUBS.includes(d.sub)) state.sub = d.sub;
    if (Object.values(TOOL_KEYS).includes(d.tool)) state.tool = d.tool;
  }

  /* ---------------- boot ---------------- */

  restore();
  buildPatternGrid();
  setDiag(state.diag, true);
  setSub(state.sub);
  setTool(state.tool);
  buildPalettePicker();
  buildSwatches();
  setColor(state.color);
  setWidth(state.width);
  syncToggles();
  resize();
  afterChange();
  setDirty(false);   // what was restored is what was last put down
  setHint(HINTS.base);

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
})();
