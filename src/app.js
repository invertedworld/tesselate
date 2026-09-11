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
  const TILE_BG = '#f4f0e5';
  const RULE_MINOR = 'rgba(23,22,15,0.09)';
  const SUB_RULE = 'rgba(23,22,15,0.14)';
  const SUB_FINE = 'rgba(23,22,15,0.07)';
  const RULE_MAJOR = 'rgba(23,22,15,0.2)';
  const ACCENT = '#cf4326';

  const MAX_TILES = 1500;   // caps how far you can zoom out
  const FILL_RES = 700;    // scratch resolution for area detection
  const FILL_GROW = 2;      // ~3 tile units, enough to tuck under a stroke
  const WRAP = [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
  const ORIGIN = [[0, 0]];

  /* Three ways to sit the work on the diagonal:
       off    everything square
       grid   only the drafting frame turns — the lattice becomes
              diamonds and the rectangle tool draws them, on a plane
              that stays square
       plane  the whole plane turns instead, tiles and rules with it,
              so a tile-aligned square reads as a diamond on screen */
  const DIAG_MODES = [['off', 'Off'], ['grid', 'Grid'], ['plane', 'Plane']];
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

  function paintJunctions(g, s, width) {
    if (!junctions.size || !ROUNDABLE[s.kind] || s.filled) return;
    for (const p of endpointsOf(s)) {
      if (!junctions.has(jkey(p))) continue;
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
    select: 'Select — click a mark to pick it up, drag to move it',
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
    clip: true,
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
  let selected = null;      // shape picked with the select tool
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
  const latticeAt = (p) => (diagGrid() ? snapDiag(p, effSub()) : snapPoint(p, effSub()));

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
      if (sh.kind === 'circle') {
        // the nearest point on the rim, wherever the cursor happens to be
        const dx = p.x - sh.c.x, dy = p.y - sh.c.y;
        const len = Math.hypot(dx, dy);
        if (len > 1e-6) {
          consider({ x: sh.c.x + (dx / len) * sh.r, y: sh.c.y + (dy / len) * sh.r, kind: 'edge' });
        }
      }
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
  function hairLine(ax, ay, bx, by) {
    const p = w2s(ax, ay), q = w2s(bx, by);
    if (crispRot) {
      if (Math.abs(p.x - q.x) < 0.01) { const x = Math.round(p.x) + 0.5; p.x = x; q.x = x; }
      if (Math.abs(p.y - q.y) < 0.01) { const y = Math.round(p.y) + 0.5; p.y = y; q.y = y; }
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

    applyView();

    if (!cleanFrame) {
      // the square being worked in reads a shade lighter than the rest
      ctx.fillStyle = TILE_BG;
      ctx.fillRect(activeTile.i * T, activeTile.j * T, T, T);
    }

    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (let j = R.j0; j <= R.j1; j++) {
      for (let i = R.i0; i <= R.i1; i++) {
        ctx.save();
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
          for (const sh of list) paintShape(sh, hair);
          if (o[0] || o[1]) ctx.translate(-o[0] * T, -o[1] * T);
        }
        ctx.restore();
      }
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cleanFrame) return;

    if (state.grid) drawRules(R);
    if (state.sub > 1) drawSubGrid(R.step);
    drawFrame();
    if (selected) drawSelection();
    if (hoverSnap) drawSnapMark();
    zoomEl.textContent = Math.round(scale * 100) + '%';
  }

  function paintShape(s, hair) {
    const p = s === draft ? draftPath : pathOf(s);
    if (s.layer === 'fill') {
      ctx.fillStyle = s.color;
      ctx.fill(p, 'evenodd');
    } else if (s.filled) {
      ctx.fillStyle = s.color;
      ctx.fill(p);
    } else {
      // A filled interior belongs to the mark itself, so it paints with
      // it — under its own border, above whatever the mark sits on.
      if (s.fillColor) {
        ctx.fillStyle = s.fillColor;
        ctx.fill(p);
      }
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
      (s.layer === 'fill' ? u.fills : u.strokes).push(s);
    });

    for (const u of [...units.values()].sort((a, b) => a.last - b.last)) {
      order.push(...u.fills, ...u.strokes);
    }
    return order;
  }

  // A halo around the picked mark, plus a dashed box, on the home tile.
  function drawSelection() {
    const shapes = moving ? moving.previews : groupOf(selected);
    if (!shapes.length) return;
    for (const shape of shapes) drawOneSelection(shape);
  }

  function drawOneSelection(shape) {
    if (!shape) return;
    const v = state.view;
    const solid = shape.layer === 'fill' || shape.filled;
    const pen = solid ? 0 : shape.width;

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
    const [cap, join] = capsOf(shape.kind);
    ctx.lineCap = cap;
    ctx.lineJoin = join;
    ctx.globalAlpha = 0.4;
    ctx.strokeStyle = rgbOf(shape.color) === ACCENT ? '#17160f' : ACCENT;
    ctx.lineWidth = pen + 8 / v.scale;
    ctx.stroke(pathOf(shape));
    ctx.globalAlpha = 1;
    paintShape(shape, 0.9 / v.scale);   // put the mark back on top
    ctx.restore();

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
    ctx.lineWidth = 1;
    if (minor) {
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
  }

  // The drafting lattice, drawn on the drawing surface only.
  function drawSubGrid(step) {
    if (step / state.sub < 5) return;   // too dense to read
    // The lattice sits on the square being worked in. A square lattice
    // and a diamond one both look the same under a quarter-turn, so the
    // tile's own rotation can be ignored here.
    const ax = activeTile.i * T, ay = activeTile.j * T;
    const hair = (a, b, c, d) => hairLine(ax + a, ay + b, ax + c, ay + d);
    const eff = effSub();
    // Finer levels first and fainter, so the lattice you asked for stays
    // the one that reads.
    if (eff > state.sub) latticePass(eff, eff / state.sub, SUB_FINE, hair);
    latticePass(state.sub, 1, SUB_RULE, hair);
  }

  function latticePass(n, skip, colour, hair) {
    const cell = T / n;
    ctx.lineWidth = 1;
    ctx.strokeStyle = colour;
    ctx.beginPath();

    if (diagGrid()) {
      // The two 45° families, cut exactly at the tile edge: x + y = c
      // runs corner to corner, and x - y = c likewise.
      for (let k = 1; k < 2 * n; k++) {
        if (skip > 1 && k % skip === 0) continue;
        const c = k * cell;
        hair(Math.max(0, c - T), Math.min(T, c), Math.min(T, c), Math.max(0, c - T));
      }
      for (let k = -(n - 1); k <= n - 1; k++) {
        if (skip > 1 && k % skip === 0) continue;
        const c = k * cell;
        hair(Math.max(0, c), Math.max(0, -c), Math.min(T, T + c), Math.min(T, T - c));
      }
      ctx.stroke();
      return;
    }

    for (let i = 1; i < n; i++) {
      if (skip > 1 && i % skip === 0) continue;
      hair(i * cell, 0, i * cell, T);
      hair(0, i * cell, T, i * cell);
    }
    ctx.stroke();
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
  function drawFrame() {
    const ax = activeTile.i * T, ay = activeTile.j * T;
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(23,22,15,0.3)';
    ctx.beginPath();
    hairLine(ax, ay, ax + T, ay);
    hairLine(ax + T, ay, ax + T, ay + T);
    hairLine(ax + T, ay + T, ax, ay + T);
    hairLine(ax, ay + T, ax, ay);
    ctx.stroke();
  }

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
    selected = null;
    if (!undoStack.length) return flash('Nothing to undo');
    redoStack.push(state.shapes.slice());
    state.shapes = undoStack.pop();
    afterChange();
  }

  function redo() {
    cancelDraft();
    selected = null;
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
        const hit = hitTest(w, { interior: true });
        selected = hit;
        requestDraw();
        if (!hit) return false;
        const members = groupOf(hit);
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
        // The same corner-to-corner drag, done on the turned frame.
        let a = toDiag(anchor), b = toDiag(snapping() ? snapAt(w) || w : w);
        if (shiftHeld) {
          const dx = b.x - a.x, dy = b.y - a.y;
          const m = Math.max(Math.abs(dx), Math.abs(dy));
          b = { x: a.x + (dx < 0 ? -m : m), y: a.y + (dy < 0 ? -m : m) };
        }
        draft.pts = [
          fromDiag(a), fromDiag({ x: b.x, y: a.y }),
          fromDiag(b), fromDiag({ x: a.x, y: b.y }),
        ];
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
    if (moving) {
      const m = moving;
      moving = null;
      if (m.dx || m.dy) {
        const swap = new Map(m.members.map((sh, k) => [sh, m.previews[k]]));
        replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), m.previews));
        selected = swap.get(m.base) || null;
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

  /* Topmost mark under the point. Outlines are tested first so a line
     lying across a filled area still wins. `interior` adds a final
     pass through the middle of unfilled closed shapes, which is what
     you want when picking something up but not when rubbing it out. */
  function hitTest(p, opts) {
    const o = opts || {};
    const tol = Math.max(7 / state.view.scale, 2);
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let hit = null;
    const passes = o.strokesOnly ? ['stroke']
      : o.interior ? ['stroke', 'fill', 'inside']
      : ['stroke', 'fill'];
    for (const pass of passes) {
      for (let k = state.shapes.length - 1; k >= 0; k--) {
        const s = state.shapes[k];
        const path = pathOf(s);
        if (pass === 'stroke') {
          if (s.layer !== 'stroke') continue;
          if (s.filled && ctx.isPointInPath(path, p.x, p.y)) { hit = s; break; }
          // `edgeOnly` keeps the border and the interior tellable apart,
          // which is what lets the fill tool recolour one or the other.
          if (!o.edgeOnly && s.fillColor && ctx.isPointInPath(path, p.x, p.y)) { hit = s; break; }
          ctx.lineWidth = Math.max(s.width, tol * 2);
          if (ctx.isPointInStroke(path, p.x, p.y)) { hit = s; break; }
        } else if (pass === 'fill') {
          if (s.layer !== 'fill') continue;
          if (ctx.isPointInPath(path, p.x, p.y, 'evenodd')) { hit = s; break; }
        } else {
          if (s.layer !== 'stroke' || s.filled || !CLOSED[s.kind]) continue;
          if (ctx.isPointInPath(path, p.x, p.y)) { hit = s; break; }
        }
      }
      if (hit) break;
    }
    ctx.restore();
    return hit;
  }

  function eraseAt(w) {
    const hit = hitTest(w);
    if (hit) replaceShapes(state.shapes.filter((s) => s !== hit));
  }

  /* ---------------- fill ----------------
     Rasterise the strokes of the tile into a scratch grid, flood the
     area under the cursor, then hand the boundary back as a polygon.
     Nothing raster is kept: the shape stored is a vector region.     */

  const fillCanvas = document.createElement('canvas');
  fillCanvas.width = fillCanvas.height = FILL_RES;
  const fctx = fillCanvas.getContext('2d', { willReadFrequently: true });

  function recolour(shape) {
    if (shape.color === state.color) return flash('Already that ink');
    const next = Object.assign({}, shape, { color: state.color });
    replaceShapes(state.shapes.map((sh) => (sh === shape ? next : sh)));
    if (selected === shape) selected = next;
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
    const onEdge = hitTest(w, { strokesOnly: true, edgeOnly: true });
    if (onEdge) return recolour(onEdge);

    const R = FILL_RES, k = R / T;
    fctx.setTransform(1, 0, 0, 1, 0, 0);
    fctx.clearRect(0, 0, R, R);
    fctx.setTransform(k, 0, 0, k, 0, 0);
    fctx.fillStyle = '#000';
    fctx.strokeStyle = '#000';
    fctx.lineCap = 'round';
    fctx.lineJoin = 'round';

    // Barriers have to be exactly what is on the tile — including the
    // wrapped copies when edge wrapping is on, or the fill runs straight
    // through lines that are plainly visible.
    // Each mark is laid down in a colour that encodes its index, so one
    // read gives both the barriers and which mark made each of them.
    const offs = state.wrap ? WRAP : ORIGIN;
    let barriers = 0;
    for (const o of offs) {
      if (o[0] || o[1]) fctx.translate(o[0] * T, o[1] * T);
      state.shapes.forEach((s, idx) => {
        if (s.layer !== 'stroke') return;
        const id = idx + 1;
        const col = `rgb(${id & 255},${(id >> 8) & 255},0)`;
        fctx.strokeStyle = col;
        fctx.fillStyle = col;
        const path = pathOf(s);
        if (s.filled) fctx.fill(path);
        else {
          const [cap, join] = capsOf(s.kind);
          fctx.lineCap = cap;
          fctx.lineJoin = join;
          const w = Math.max(s.width, 2 / k);
          fctx.lineWidth = w;
          fctx.stroke(path);
          paintJunctions(fctx, s, w);
        }
        barriers++;
      });
      if (o[0] || o[1]) fctx.translate(-o[0] * T, -o[1] * T);
    }
    if (!barriers) return flash('Draw an outline first');

    const px = fctx.getImageData(0, 0, R, R).data;
    const barrier = new Uint8Array(R * R);
    // Half covered counts as wall. A fainter threshold let the soft
    // edges of two converging strokes seal the gap between them long
    // before they actually met, so a narrow wedge stopped filling well
    // short of its point.
    for (let i = 0, n = R * R; i < n; i++) barrier[i] = px[i * 4 + 3] >= 128 ? 1 : 0;

    const seed = {
      x: clamp(Math.round(w.x * k), 0, R - 1),
      y: clamp(Math.round(w.y * k), 0, R - 1),
    };
    const raw = floodMask(barrier, R, R, seed.x, seed.y, state.wrap);
    if (!raw) return flash('No open area under the cursor');

    /* Which marks did the area come up against? Read from a little way
       outside it: only a stroke's fully opaque core carries a
       trustworthy index, because the canvas stores colour premultiplied
       by alpha and along a soft edge a small index like 3 comes back as
       2, naming an entirely different mark. */
    const reach = dilate(raw, R, R, 6, state.wrap);
    const bounding = new Set();
    for (let i = 0, n = R * R; i < n; i++) {
      if (!reach[i] || px[i * 4 + 3] !== 255) continue;
      const id = px[i * 4] | (px[i * 4 + 1] << 8);
      if (id >= 1 && id <= state.shapes.length) bounding.add(id - 1);
    }
    const walls = [...bounding].map((i) => state.shapes[i]).filter(Boolean);

    const grow = FILL_GROW;

    /* Where two marks converge, the passage between them narrows below
       one cell of the grid long before the marks themselves meet, and
       the flood gives up there — leaving a pocket of unfilled paper past
       the pinch. Growing the area bridges that pinch, so flooding a
       second time through the bridge picks the pocket up. Real ink is
       thicker than the bridge, so nothing escapes through it. */
    const bridged = dilate(raw, R, R, grow, state.wrap);
    const pinched = new Uint8Array(R * R);
    for (let i = 0, n = R * R; i < n; i++) pinched[i] = barrier[i] && !bridged[i] ? 1 : 0;
    const filled = floodMask(pinched, R, R, seed.x, seed.y, state.wrap) || raw;
    const mask = dilate(filled, R, R, grow, state.wrap);

    const traced = loopsFromMask(mask, R, R, 1);
    if (!traced) return flash('No open area under the cursor');
    // The grid can only place an edge to the nearest cell. Move each
    // point onto the true edge of the mark it belongs to, a hair inside
    // so it tucks under rather than meeting it exactly.
    const loops = snapLoopsToWalls(traced, walls, 2 / k, 0.4);
    const region = { kind: 'region', loops };

    const host = interiorHost(w, region);
    if (host) {
      if (host.fillColor === state.color) return flash('Already that ink');
      const next = Object.assign({}, host, { fillColor: state.color });
      replaceShapes(state.shapes.map((sh) => (sh === host ? next : sh)));
      if (selected === host) selected = next;
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
    // picture together.
    let top = false, bottom = false, left = false, right = false;
    for (let x = 0; x < R; x++) {
      if (raw[x]) top = true;
      if (raw[(R - 1) * R + x]) bottom = true;
    }
    for (let y = 0; y < R; y++) {
      if (raw[y * R]) left = true;
      if (raw[y * R + R - 1]) right = true;
    }
    const isGround = top && bottom && left && right;

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
      selected = null;
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
    if (mode === 'draw' && (draft || moving)) {
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

  /* trackpad: pinch arrives as a ctrl-flagged wheel, two-finger
     scroll as a plain one */
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    const s = screenPt(e);
    if (e.ctrlKey || e.metaKey) {
      zoomAt(s.x, s.y, Math.exp(-e.deltaY * 0.01));
    } else {
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? ch : 1;
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
    if (meta) return;

    if (selected && !draft && !pending) {
      const far = e.shiftKey ? 5 : 1;
      const step = (snapping() ? T / effSub() : 10) * far;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) {
        e.preventDefault();
        const members = groupOf(selected);
        const moved = moveGroup(members, d[0] * step, d[1] * step);
        const swap = new Map(members.map((sh, k) => [sh, moved[k]]));
        const was = selected;
        replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), moved));
        selected = swap.get(was) || null;
        return;
      }
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        const gone = new Set(groupOf(selected));
        selected = null;
        replaceShapes(state.shapes.filter((sh) => !gone.has(sh)));
        flash(gone.size > 1 ? `${gone.size} marks deleted` : 'Mark deleted');
        return;
      }
    }
    if (e.key === 'Shift') { shiftHeld = true; return; }
    if (e.key === 'Alt') { altHeld = true; noteHover(lastWorld); return; }
    if (e.key === 'Escape') {
      if (!cancelDraft() && selected) { selected = null; requestDraw(); }
      return;
    }
    if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
    if (k >= '1' && k <= '9') { setColor(currentColors()[+k - 1]); return; }
    if (k === '0') { setColor(currentColors()[9]); return; }
    if (k === '[') { setWidth(state.width - (state.width > 12 ? 4 : 1)); return; }
    if (k === ']') { setWidth(state.width + (state.width >= 12 ? 4 : 1)); return; }
    if (k === 'g') { toggle('grid'); return; }
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
    if (tool !== 'select') selected = null;
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
    if (selected && selected.color !== hex) {
      const next = Object.assign({}, selected, { color: hex });
      replaceShapes(state.shapes.map((sh) => (sh === selected ? next : sh)));
      selected = next;
    }
    saveSoon();
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
        : mode === 'grid' ? 'Alignment grid turned 45° · rectangles draw as diamonds'
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
    selected = null;
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

  const stamp = () => new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');

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
  const suggestName = () => (fileHandle && fileHandle.name) || `tessera-${stamp()}.json`;

  async function saveProject(asNew) {
    const text = projectJson();
    if (window.showSaveFilePicker) {
      try {
        let handle = asNew ? null : fileHandle;
        if (handle && !(await writable(handle))) handle = null;
        if (!handle) {
          handle = await window.showSaveFilePicker({ suggestedName: suggestName(), types: JSON_TYPES });
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
    const name = suggestName();
    download(name, new Blob([text], { type: 'application/json' }));
    setDirty(false);
    showFile(name);
    flash(`Saved ${name}`);
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
    selected = null;
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
      for (const s of paintOrder(state.shapes)) {
        const d = pathData(s);
        if (!d) continue;
        if (s.layer === 'fill') body.push(`<path d="${d}" ${svgPaint('fill', s.color)} fill-rule="evenodd"/>`);
        else if (s.filled) body.push(`<path d="${d}" ${svgPaint('fill', s.color)}/>`);
        else {
          const [cap, join] = capsOf(s.kind);
          const inner = s.fillColor ? svgPaint('fill', s.fillColor) : 'fill="none"';
          body.push(`<path d="${d}" ${inner} ${svgPaint('stroke', s.color)}`
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
