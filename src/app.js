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

  /* A gradient is ink like any other, written as text so that it saves,
     compares, keys a map and sits in a palette exactly the way a hex
     does — nothing downstream has to learn a second kind of value:

       lin(45,#cf4326,#2b4a9c)

     The angle is degrees clockwise from east. What the sweep is measured
     across is not the gradient's: it belongs to the stroke or the fill
     that wears it (see ACROSS), so one gradient in the palette can lie
     across a mark in one place and across the tile in another. Ink
     written before that carried it as a field of its own — lin(45,tile,…)
     — and is still read. */
  const GRAD_RE = /^lin\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(?:(shape|tile)\s*,\s*)?(.+?)\s*\)$/i;

  function parseInk(v) {
    if (typeof v !== 'string') return null;
    const m = GRAD_RE.exec(v.trim());
    if (!m) return null;
    const stops = m[3].split(',').map((c) => normHex(c));
    if (stops.length < 2 || stops.some((c) => !c)) return null;
    return { deg: ((+m[1] % 360) + 360) % 360, stops };
  }

  const gradText = (g) => `lin(${+g.deg.toFixed(1)},${g.stops.join(',')})`;

  // Either kind of ink, or null if it is neither.
  function normInk(v) {
    const g = parseInk(v);
    return g ? gradText(g) : normHex(v);
  }

  // What ink written the old way said its sweep ran across, or null.
  function acrossWritten(v) {
    const m = typeof v === 'string' && GRAD_RE.exec(v.trim());
    return m && m[2] ? m[2].toLowerCase() : null;
  }

  /* Whether a sweep lies across the mark that wears it — its own bounds,
     so every copy of it looks the same — or across the tile, so a whole
     figure fades together, belongs to the stroke or the fill, each on its
     own: `across` goes with a mark's `color` and `fillAcross` with its
     `fillColor`, and either is written only when it is the tile. Both
     repeat exactly, which a sweep across the plane could not — the plane
     has no edges to run between. */
  const ACROSS = { color: 'across', fillColor: 'fillAcross' };
  const acrossOf = (sh, slot) => (sh[ACROSS[slot]] === 'tile' ? 'tile' : 'shape');

  // A mark saved while the gradient said what it ran across has that
  // moved onto the stroke or fill wearing it.
  function settleAcross(sh) {
    for (const slot of ['color', 'fillColor']) {
      const was = acrossWritten(sh[slot]);
      if (!was) continue;
      sh[slot] = normInk(sh[slot]);
      if (was === 'tile') sh[ACROSS[slot]] = 'tile';
    }
  }

  function rgbOf(hex) {
    const g = parseInk(hex);
    if (g) return rgbOf(g.stops[0]);
    return (normHex(hex) || '#17160f').slice(0, 7);
  }

  /* The complement of a colour, whole: across the painter's wheel from it
     — red and green, blue and orange, yellow and violet — rather than the
     screen's, which pairs red with cyan and blue with yellow. The hue is
     carried onto the red, yellow and blue wheel, turned half way round and
     carried back, and the colour keeps its lightness and its strength. A
     grey has no complement, so it gets the grey across from it, black to
     white. A new gradient fades to it, so switching one on shows a sweep
     at once. */
  const SCREEN_HUE = [0, 35, 60, 120, 240, 285, 360];
  const PAINT_HUE = [0, 60, 120, 180, 240, 300, 360];
  function rehue(h, from, to) {
    let k = 1;
    while (h > from[k]) k++;
    return to[k - 1] + ((h - from[k - 1]) / (from[k] - from[k - 1])) * (to[k] - to[k - 1]);
  }
  function complement(ink) {
    const hex = rgbOf(ink);
    const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16));
    const hi = Math.max(...c), lo = Math.min(...c), d = hi - lo;
    let out;
    if (d < 40) out = c.map((v) => 255 - v);
    else {
      const [r, g, b] = c;
      const hue = 60 * (hi === r ? ((g - b) / d + 6) % 6 : hi === g ? (b - r) / d + 2 : (r - g) / d + 4);
      const h = rehue((rehue(hue, SCREEN_HUE, PAINT_HUE) + 180) % 360, PAINT_HUE, SCREEN_HUE);
      // Back to channels with the same brightest and dullest as before.
      out = [0, 8, 4].map((n) => {
        const k = (n + h / 30) % 12;
        return Math.round((hi + lo) / 2 - (d / 2) * Math.max(-1, Math.min(k - 3, 9 - k, 1)));
      });
    }
    return '#' + out.map((v) => v.toString(16).padStart(2, '0')).join('');
  }

  function alphaOf(hex) {
    const g = parseInk(hex);
    if (g) return alphaOf(g.stops[0]);
    const h = normHex(hex) || '';
    return h.length === 9 ? parseInt(h.slice(7), 16) : 255;
  }

  function withAlpha(hex, a) {
    const g = parseInk(hex);
    /* The slider sits under the hex field, and that field shows the
       stop the sweep starts from, so this does too. The far stop keeps
       whatever alpha it was given — which is how a fade to nothing stays
       a fade to nothing when the near end is dimmed. */
    if (g) return gradText({ ...g, stops: g.stops.map((c, i) => (i ? c : withAlpha(c, a))) });
    const v = clamp(Math.round(a), 0, 255);
    return v >= 255 ? rgbOf(hex) : rgbOf(hex) + v.toString(16).padStart(2, '0');
  }

  // CSS for a swatch: the sweep itself, so the palette shows what it is.
  function inkCss(v) {
    const g = parseInk(v);
    return g ? `linear-gradient(${g.deg + 90}deg, ${g.stops.join(', ')})` : v;
  }

  // SVG keeps colour and opacity in separate attributes, so a translucent
  // mark survives the trip into editors that never learned 8-digit hex.
  function svgPaint(attr, hex) {
    const a = alphaOf(hex);
    return `${attr}="${rgbOf(hex)}"` + (a < 255 ? ` ${attr}-opacity="${+(a / 255).toFixed(4)}"` : '');
  }

  const GROUND = '#ffffff';
  /* The squares themselves read over the lattice inside them: darker,
     and thicker where there is room for it, with the block's own
     boundaries heavier again. A drafting aid sits under the structure it
     is drafted on. */
  const RULE_MINOR = 'rgba(23,22,15,0.3)';
  const RULE_MAJOR = 'rgba(23,22,15,0.46)';
  // Dotted, so a third of the ink a solid line had: stronger to make it up.
  const SUB_RULE = 'rgba(86,156,214,0.9)';    // the lattice you asked for
  const SUB_FINE = 'rgba(86,156,214,0.5)';    // the levels it gains on zoom

  /* Below this many screen pixels apart the lattice stops being a guide
     and turns into a wash. A hairline every three pixels still reads as
     something to place a point on; five was dropping the finest grids at
     ordinary zooms, which is why 64 came up blank. */
  const SUB_MIN_PX = 3;
  /* The rail's accent is a shade brighter, for a dark ground; on the
     paper the original holds, and a mark drawn in the palette's own
     vermilion still matches it, so the halo knows to darken instead. */
  const ACCENT = '#cf4326';

  const MAX_TILES = 1500;   // caps how far you can zoom out
  /* Screen pixels to a tile unit at the closest — the tile 128 000 pixels
     across, some two hundred times the fitted view — so a detail can be
     drawn a fraction of a unit wide. */
  const MAX_ZOOM = 128;
  const FILL_RES = 700;    // scratch resolution for area detection
  const FILL_GROW = 2;      // ~3 tile units, enough to tuck under a stroke
  const FILL_MAX = 1400;    // the widest scratch grid, when one square is not enough

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

  /* The shape of the tile and how its copies lie are the tiling's —
     see patterns.js. Everything here asks it rather than assuming a
     square: where copy (i, j) puts a point, which copy a point of the
     plane is on, and which copies lie around one. */
  const tiling = () => tilingOf(state.pattern);
  const patternSig = () => `${shapeOf(state.pattern)}:${state.pattern.n}:${state.pattern.cells.join('')}`;

  function placeIn(p, i, j) {
    return tiling().place(p, state.pattern, i, j);
  }

  // World back into one copy's own frame — the inverse of placeIn.
  function unplaceIn(w, i, j) {
    return tiling().unplace(w, state.pattern, i, j);
  }

  const cellOf = (w) => cellAt(state.pattern, w);

  // Put copy (i, j)'s placement on a context, over what is there.
  function intoTile(g, i, j) {
    const m = tiling().matrix(state.pattern, i, j);
    g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
  }

  // The copies around (i, j) whose marks can reach into it, itself first.
  const around = (i, j, pad) => tiling().around(i, j, pad);

  function findCrossJunctions() {
    const sig = patternSig();
    if (crossFor && crossFor.list === state.shapes && crossFor.sig === sig) return;
    crossFor = { list: state.shapes, sig };
    crossJunctions = new Map();
    const pad = Math.min(overhang(state.shapes), 2);
    const marks = state.shapes.filter((s) => s.layer === 'stroke' && !s.filled && ROUNDABLE[s.kind]);
    if (!pad || !marks.length) return;

    const n = state.pattern.n, per = tiling().per(n);
    for (let b = 0; b < n; b++) {
      for (let a = 0; a < per; a++) {
        const seen = new Map();
        for (const c of around(a, b, pad)) {
          const di = c.i - a, dj = c.j - b;
          for (const s of marks) {
            for (const p of endpointsOf(s)) {
              const k = jkey(placeIn(p, c.i, c.j));
              const at = seen.get(k);
              if (at) at.push([di, dj, p]); else seen.set(k, [[di, dj, p]]);
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
    circle: 'Move, then click to set the far side · Esc to drop',
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
    circle: 'Circle — drag rim to rim, or click each end · Shift draws from the centre',
    rect: 'Rectangle — click a corner, then the opposite one · Shift squares it',
    fill: 'Fill — click an enclosed area, or a mark to recolour it',
    text: 'Text — click where the letters are to start, then type',
    typing: 'Typing — Enter sets it down, Shift-Enter takes a new line, Esc drops it',
    erase: 'Erase — click or drag across a mark',
    warp: 'Warp — click the paper to drop an anchor · drag its dot to move it, the square on its rim to size it',
  };

  const canvas = document.getElementById('stage');
  const ctx = canvas.getContext('2d');
  const hintEl = document.getElementById('hint');

  const state = {
    shapes: [],
    tool: 'pencil',
    color: PALETTE[2],
    across: 'shape',    // what a sweep laid down now lies across: 'shape' or 'tile'
    width: 9,
    smooth: 25,         // how far the pencil tidies a stroke, 0 to 100
    palette: BUILT_IN[0].name,
    palettes: [],       // the user's own named palettes
    recent: [],         // ink used on the drawing, newest first
    filled: false,
    typeSize: 140,      // how tall the letters of a text mark are set
    typeFace: 'sans',   // one of FACES, or a family found on this computer
    typeBold: false,
    typeItalic: false,
    grid: true,
    arrows: false,      // an arrow per square, showing the turn it carries
    snap: false,
    sub: 0,             // 0 while the grid is off
    subLast: 8,         // the size it comes back to when switched on
    diag: 'off',        // 'off' | 'grid' | 'plane'
    /* How the plane is bent on its way to the screen — see warp.js. It
       is replaced whole on every change and never edited in place, so an
       undo step can simply keep the one it had. */
    warp: { amount: 1, repeat: 'plane', ink: 'swell', anchors: [] },
    pattern: patternFromPreset(presetsFor('square')[1], 'square'),
    view: { scale: 0.5, x: 0, y: 0, rot: 0 },
  };

  /* What a drawing starts as, kept so *New* can put it all back. Only
     what belongs to the drawing: the palettes and the recently used
     strip are the table's, and survive it. */
  const DEFAULTS = {
    color: state.color,
    across: state.across,
    width: state.width,
    filled: state.filled,
    typeSize: state.typeSize,
    typeFace: state.typeFace,
    typeBold: state.typeBold,
    typeItalic: state.typeItalic,
    grid: state.grid,
    arrows: state.arrows,
    snap: state.snap,
    sub: state.sub,
    subLast: state.subLast,
    diag: state.diag,
    warp: state.warp,
    pattern: { shape: 'square', n: state.pattern.n, cells: state.pattern.cells.slice() },
    view: { ...state.view },
  };

  let undoStack = [];
  let redoStack = [];
  let draft = null;    // the mark currently being placed
  let pending = null;  // 'point' | 'bend': the live mark is between clicks
  let pressAt = null;  // where the press that started the mark landed, on screen
  let grip = null;     // a corner or a point of what is held, being dragged
  let hoverGrip = null;// the one under the pointer, so the turn ring can show
  let hitTile = null;  // the square whose copy the last hit test answered from
  let draftPath = null;

  let cw = 0, ch = 0, dpr = 1, rect = { left: 0, top: 0 };
  let mode = null;     // 'draw' | 'pan' | 'pinch'
  let panFrom = null;
  let pinchFrom = null;
  let anchor = null;        // the corner a rectangle is being drawn from,
                            // or the point a circle was started at
  let fromCentre = false;   // was Shift down when the circle was started?
  let picked = [];          // the marks the select tool is holding
  let lasso = null;         // the area being swept out with two fingers
  let moving = null;        // { index, preview, from, base } while dragging one
  /* Two modifiers, each with one job.

     Shift is snapping, wherever you are and whatever you are doing: it
     suspends it where it is on and asks for it where it is off, so the
     one key answers "not this time" and "just this once" both.

     Alt — or Control, for a hand that reaches there first — constrains:
     the direction of a line, the symmetry of an arc, the squareness of a
     rectangle, a circle grown from its middle. Everything a tool can be
     asked to hold to while it is being drawn. */
  let shiftHeld = false;
  let altHeld = false;
  let ctrlHeld = false;
  const constrain = () => altHeld || ctrlHeld;
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

  /* The warp sits between the plane and the view. `toPlane` and
     `planeToScreen` are the view alone; `toWorld` and `w2s` go through
     the warp as well — back through it on the way in, so that whatever is
     handed a point from the pointer is handed a point of the drawing, and
     out through it on the way to the screen. */
  function toPlane(sx, sy) {
    const v = state.view;
    const c = Math.cos(v.rot), n = Math.sin(v.rot);
    const dx = (sx - v.x) / v.scale, dy = (sy - v.y) / v.scale;
    return { x: dx * c + dy * n, y: dy * c - dx * n };
  }

  function planeToScreen(x, y) {
    const v = state.view;
    const c = Math.cos(v.rot), n = Math.sin(v.rot);
    return {
      x: v.x + (x * c - y * n) * v.scale,
      y: v.y + (x * n + y * c) * v.scale,
    };
  }

  function toWorld(sx, sy) {
    const p = toPlane(sx, sy);
    const f = warpField();
    return f.active ? f.unwarp(p) : p;
  }

  function w2s(x, y) {
    const f = warpField();
    if (!f.active) return planeToScreen(x, y);
    const q = f.warp({ x, y });
    return planeToScreen(q.x, q.y);
  }

  /* The warp in force. Rebuilt when the warp is replaced or a square of
     the block is turned, since a warp that repeats is laid square by
     square. */
  let liveWarp = NO_WARP;
  let liveWarpFor = { warp: null, cells: '' };
  function warpField() {
    const cells = patternSig();
    if (liveWarpFor.warp !== state.warp || liveWarpFor.cells !== cells) {
      liveWarp = makeWarp(state.warp, state.pattern);
      liveWarpFor = { warp: state.warp, cells };
    }
    return liveWarp;
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
     placement and turn — draw in a turned tile and the mark lands
     where you put it. */
  let activeTile = { i: 0, j: 0 };   // the square the grid is shown on
  let drawTile = null;               // the square a mark in progress belongs to

  /* The grid follows the pointer wherever it goes, but a mark keeps the
     frame it was started in, so its far end still lands under the
     cursor when that cursor has wandered into the next square. The
     lattice is the same in every square, so the one on show always
     agrees with what the mark is snapping to. */
  const frameTile = () => drawTile || activeTile;

  function toTileSpace(w) {
    const f = frameTile();
    return unplaceIn(w, f.i, f.j);
  }

  function fromTileSpace(p) {
    const f = frameTile();
    return placeIn(p, f.i, f.j);
  }

  function updateActive(w) {
    if (!draft && !pending && !moving && !lasso && !grip) drawTile = null;
    const { i, j } = cellOf(w);
    if (i !== activeTile.i || j !== activeTile.j) {
      activeTile = { i, j };
      requestDraw();
    }
  }

  const drawPt = (sx, sy) => toTileSpace(toWorld(sx, sy));

  // A few pixels of slack: marks that start right on the boundary are
  // the whole point of a tiling, so the edge should draw, not pan.
  const insideTile = (w, slackPx) => tiling().inside(w, (slackPx || 0) / state.view.scale);

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
    v.scale = clamp(s, minScale(), MAX_ZOOM);
    // put the tile's centre in the middle of the view, whatever the angle
    const c = Math.cos(v.rot), n = Math.sin(v.rot);
    const { x: mx, y: my } = tiling().c0;
    v.x = cw / 2 - (mx * c - my * n) * v.scale;
    v.y = ch / 2 - (mx * n + my * c) * v.scale;
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

  /* Z: the view fitted round what is held, in the square it is shown in,
     with a margin — however far in that takes it, up to the closest zoom
     there is. The view keeps its angle, so the box is measured as the
     screen has it, 45° plane and all. With nothing held it fits round
     everything on the tile, and with nothing on the tile it recentres. */
  const ZOOM_FIT = 0.8;    // of the view the box may fill

  function zoomToHeld() {
    const held = heldMarks();
    const marks = held.length ? held : state.shapes;
    const box = heldBox(marks);
    if (!box) { resetView(); return; }
    const f = held.length ? heldFrame() : activeTile;
    const v = state.view;
    const c = Math.cos(v.rot), n = Math.sin(v.rot);
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const p of [[box.x0, box.y0], [box.x1, box.y0], [box.x1, box.y1], [box.x0, box.y1]]) {
      const q = placeIn({ x: p[0], y: p[1] }, f.i, f.j);
      const x = q.x * c - q.y * n, y = q.x * n + q.y * c;
      x0 = Math.min(x0, x); y0 = Math.min(y0, y); x1 = Math.max(x1, x); y1 = Math.max(y1, y);
    }
    const w = Math.max(x1 - x0, 1e-6), h = Math.max(y1 - y0, 1e-6);
    v.scale = clamp(Math.min((cw * ZOOM_FIT) / w, (ch * ZOOM_FIT) / h), minScale(), MAX_ZOOM);
    v.x = cw / 2 - ((x0 + x1) / 2) * v.scale;
    v.y = ch / 2 - ((y0 + y1) / 2) * v.scale;
    requestDraw();
  }

  function zoomAt(px, py, factor) {
    const v = state.view;
    const s1 = clamp(v.scale * factor, minScale(), MAX_ZOOM);
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
  // The zoom a fresh view is fitted at — the tile three fifths of the
  // shorter side, a little less on the 45° plane.
  const fitScale = () => (cw && ch
    ? (Math.min(cw, ch) * (state.diag === 'plane' ? 0.42 : 0.6)) / T
    : state.view.scale);

  /* The thickness in hand, in tile units. The slider says how thick a
     stroke looks as it is drawn, not how thick it is on the tile: 9 at
     the fitted zoom is 9 units, and 9 zoomed in eight times over is an
     eighth of that, so a line drawn close in looks as thin as the slider
     said rather than eight times too heavy. Once down, a mark keeps the
     width it was given, and grows and shrinks with the zoom like
     everything else. */
  const penWidth = () => +((state.width * fitScale()) / state.view.scale).toPrecision(4);

  function effSub() {
    if (!state.sub) return 0;
    if (!cw || !ch) return state.sub;
    const fit = fitScale();
    // A hair of slack, so landing exactly on a doubling counts as one.
    const levels = clamp(Math.floor(Math.log2(state.view.scale / fit) + 1e-3), 0, 5);
    let n = state.sub * Math.pow(2, levels);
    while (n > state.sub && (T / n) * state.view.scale < 6) n /= 2;
    return n;
  }

  const snapping = () => state.snap !== shiftHeld;

  /* How many times the zoom has halved the lattice that was picked. The
     isometric frame is described by the picked count and this, not by
     the product: its rows are rounded to fit the tile, so the finer
     level has to be the picked one subdivided rather than a lattice
     worked out afresh for the larger count. */
  const subSkip = () => (state.sub && effSub() > state.sub ? effSub() / state.sub : 1);
  const latticeAt = (p) => (diagGrid()
    ? snapIso(p, state.sub || 12, subSkip())
    : snapPoint(p, effSub()));

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

  // Everything on the tile, boxed once, so a square that cannot possibly
  // hold a target can be passed over without asking each mark.
  function allBBox() {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sh of state.shapes) {
      if (sh.layer !== 'stroke') continue;
      const b = shapeBBox(sh);
      if (!b) continue;
      const pen = (sh.filled ? 0 : sh.width || 0) / 2;
      x0 = Math.min(x0, b.x0 - pen); y0 = Math.min(y0, b.y0 - pen);
      x1 = Math.max(x1, b.x1 + pen); y1 = Math.max(y1, b.y1 + pen);
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

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

    /* Every copy of a mark, not only the one this square drew. The plane
       is one tile over and over, so the end of a line is on screen many
       times over; catching the one under the pointer — and not its twin
       an inch away — is the whole point of a snap, and which square it
       happens to belong to is not something the hand knows about.

       Each square is searched in its own frame, quarter turn and all,
       and whatever it offers is carried back here, where the mark being
       drawn lives. A square whose marks cannot reach the pointer is
       passed over on a box test rather than asked mark by mark. */
    const bb = allBBox();
    if (!bb) return null;
    const home = frameTile();
    const world = placeIn(p, home.i, home.j);
    const reach = 1 + Math.min(overhang(state.shapes), 2);

    for (const { i, j } of around(home.i, home.j, reach)) {
      const q = unplaceIn(world, i, j);
      if (q.x < bb.x0 - tol || q.x > bb.x1 + tol
        || q.y < bb.y0 - tol || q.y > bb.y1 + tol) continue;
      const back = (t, kind) => {
        const w = placeIn(t, i, j);
        const h = unplaceIn(w, home.i, home.j);
        h.kind = kind;
        return h;
      };
      for (const sh of state.shapes) {
        if (sh.layer !== 'stroke') continue;
        for (const t of snapPointsOf(sh)) consider(back(t, t.kind));
        /* And anywhere along the mark itself, not only the points that
           have names. Without this, a click away from an end or a
           middle had nothing to catch on and fell through to the
           lattice — so with the lattice off there was nothing, and
           with it on what looked like snapping to the mark was really
           snapping to a grid point that happened to lie under it.
           Edges rank last, so an end still wins wherever one is in
           reach. */
        const near = nearestOnShape(sh, q);
        if (near) consider(back(near.p, 'edge'));
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

  const SNAP_TOOLS = { line: 1, curve: 1, circle: 1, rect: 1, text: 1 };

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
      const p = toPlane(sx, sy);
      if (p.x < x0) x0 = p.x;
      if (p.y < y0) y0 = p.y;
      if (p.x > x1) x1 = p.x;
      if (p.y > y1) y1 = p.y;
    }
    /* A warp keeps each disc to itself, so paper showing inside one came
       from inside it: the range need only reach as far out as the discs. */
    const g = warpField().reach;
    x0 -= g; y0 -= g; x1 += g; y1 += g;
    const t = tiling();
    const r = t.square
      ? { i0: Math.floor(x0 / T), i1: Math.floor(x1 / T), j0: Math.floor(y0 / T), j1: Math.floor(y1 / T) }
      : t.range(x0, y0, x1, y1);
    return {
      ...r,
      wx0: x0, wy0: y0, wx1: x1, wy1: y1,
      step: T * state.view.scale,
    };
  }

  /* Every copy whose ink can show in the range, when a mark may run
     `pad` tiles past its own. The square's range is exact; the other
     tilings' lattices lie aslant, so theirs is a parallelogram round the
     view and the copies wholly off it are dropped here. */
  function cellsOver(R, pad) {
    const t = tiling();
    const out = [];
    if (t.square) {
      for (let j = R.j0 - pad; j <= R.j1 + pad; j++) {
        for (let i = R.i0 - pad; i <= R.i1 + pad; i++) out.push([i, j]);
      }
      return out;
    }
    const g = pad * T + t.outR;
    const r = t.range(R.wx0 - g, R.wy0 - g, R.wx1 + g, R.wy1 + g);
    for (let j = r.j0; j <= r.j1; j++) {
      for (let i = r.i0; i <= r.i1; i++) {
        const o = t.origin(i, j);
        if (o.x >= R.wx0 - g && o.x <= R.wx1 + g && o.y >= R.wy0 - g && o.y <= R.wy1 + g) out.push([i, j]);
      }
    }
    return out;
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
    const f = warpField();
    if (f.active && f.touches({
      x0: Math.min(ax, bx), y0: Math.min(ay, by), x1: Math.max(ax, bx), y1: Math.max(ay, by),
    })) {
      tracePlane([{ x: ax, y: ay }, { x: bx, y: by }], false);
      return;
    }
    const p = planeToScreen(ax, ay), q = planeToScreen(bx, by);
    if (crispRot) {
      if (Math.abs(p.x - q.x) < 0.01) { const x = Math.round(p.x) + hairSnap; p.x = x; q.x = x; }
      if (Math.abs(p.y - q.y) < 0.01) { const y = Math.round(p.y) + hairSnap; p.y = y; q.y = y; }
    }
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(q.x, q.y);
  }

  /* A run on the plane, drawn onto the screen through the warp: split
     wherever the warp bends it, so a rule or the edge of a box crossing a
     disc comes out as the curve it has become. Adds to the path in hand,
     the way hairLine does. */
  const TRACE_PX = 0.35;

  function traceRun(run) {
    const f = warpField();
    const [line] = layRuns([run], f.active ? f.warp : (p) => p,
      TRACE_PX / state.view.scale, f.active ? f.seg : Infinity);
    if (!line || !line.pts.length) return;
    line.pts.forEach((p, k) => {
      const s = planeToScreen(p.x, p.y);
      if (k) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    if (line.closed) ctx.closePath();
  }

  const tracePlane = (pts, closed) => traceRun(polyRun(pts, closed));

  // What the plane should show: the committed shapes, with a shape
  // being dragged swapped for its moved copy, plus any live draft.
  function drawList() {
    if (!moving && !draft && !typing && !(grip && grip.previews)) return state.shapes;
    let list = state.shapes.slice();
    if (moving) {
      moving.members.forEach((m, k) => {
        const i = list.indexOf(m);
        if (i >= 0) list[i] = moving.previews[k];
      });
    }
    if (grip && grip.previews) {
      gripMembers(grip).forEach((m, k) => {
        const i = list.indexOf(m);
        if (i >= 0) list[i] = grip.previews[k];
      });
    }
    // The letters being typed stand in for the mark they came from,
    // which would otherwise show through them at its old wording.
    if (typing && typing.was) list = list.filter((sh) => sh !== typing.was);
    if (draft) list.push(draft);
    return list;
  }

  /* A mark may run past its own square and show on its neighbours. So a
     square just off screen can still put ink on screen, and the paint has
     to reach further than the view does. Capped, since a very long mark
     would otherwise have us painting the whole plane. */
  function overhang(list) {
    const t = tiling();
    let lo = 0, hi = T, out = false;
    for (const sh of list) {
      const b = shapeBBox(sh);
      if (!b) continue;
      const pen = (sh.width || 0) / 2;
      lo = Math.min(lo, b.x0 - pen, b.y0 - pen);
      hi = Math.max(hi, b.x1 + pen, b.y1 + pen);
      /* A tile that is not the square leaves corners of the square to
         its neighbours, so a mark can stay inside the square and still
         run onto the next tile. */
      if (!t.square && !out) {
        out = [[b.x0 - pen, b.y0 - pen], [b.x1 + pen, b.y0 - pen], [b.x0 - pen, b.y1 + pen], [b.x1 + pen, b.y1 + pen]]
          .some(([x, y]) => !t.inside({ x, y }));
      }
    }
    const far = Math.max(Math.ceil(-lo / T), Math.ceil((hi - T) / T), out ? 1 : 0);
    return clamp(far, 0, 3);
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

    cutLetters();
    draftPath = draft ? buildPath(draft) : null;
    const hair = 0.9 / scale;
    const list = paintOrder(drawList());
    /* Warped copies are kept per zoom step, a step being half an octave,
       and built to that step's tolerance so they stay true across the
       whole of it. */
    const bucket = Math.round(Math.log2(scale) * 2);
    paintWarp = { tol: WARP_PX / Math.pow(2, (bucket + 1) / 2), bucket, ink: state.warp.ink };
    draftWarps = new Map();
    junctions = findJunctions(list);
    findCrossJunctions();

    applyView();


    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    const pad = overhang(list);
    const cells = cellsOver(R, pad);
    const t = tiling();
    // One mark, laid in every square the view reaches.
    const overTiles = (sh) => {
      for (const [i, j] of cells) {
        ctx.save();
        tileKey = t.key(state.pattern, i, j);
        intoTile(ctx, i, j);
        if (sh.inside) paintShape(sh.inside, hair, 'inside', i, j);
        else paintShape(sh, hair, sh.fillColor ? 'outline' : undefined, i, j);
        ctx.restore();
      }
    };

    /* A mark runs over its neighbours, so finishing square by square
       would put everything the next square draws on top of everything
       this one drew — a fill two squares along landing over a border
       already laid down. The plane is painted mark by mark instead, each
       across every square, so depth means the same thing everywhere. */
    for (const sh of list) overTiles(sh);

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (cleanFrame) return;

    drawHaloRing();
    if (state.grid) drawRules(R);
    if (state.sub > 1) drawSubGrid(R);
    if (state.arrows) drawOrientation(R);
    if (picked.length) drawSelection();
    if (typing) drawCaret();
    if (lasso) drawLasso();
    if (state.tool === 'warp') drawAnchors(R);
    if (hoverSnap) drawSnapMark();
  }

  /* `part` paints one half of a mark that has both: 'inside' its own
     interior, 'outline' its border. They go down at different depths —
     see paintOrder — so the plane asks for them separately. */
  /* The ink of a mark's stroke or fill (`slot`) as the canvas wants it. A
     flat colour is its own string; a gradient becomes a sweep laid across
     whichever box that stroke or fill says — the mark's own bounds, or
     the tile. This runs inside the tile's own transform, so the box is in
     tile units and every copy of the mark across the plane gets the same
     sweep. */
  function inkStyle(s, slot) {
    const ink = s[slot];
    const g = parseInk(ink);
    if (!g) return ink;
    let box = { x0: 0, y0: 0, x1: T, y1: T };
    if (acrossOf(s, slot) === 'shape') {
      const b = shapeBBox(s);
      // A straight line has no thickness to its bounds; the ink does.
      const pad = s.layer === 'stroke' && !s.filled ? (s.width || 0) / 2 : 0;
      if (b) box = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
    }
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    const t = (g.deg * Math.PI) / 180;
    const ux = Math.cos(t), uy = Math.sin(t);
    // Half the box measured along the sweep, so the end stops land on it.
    const half = (Math.abs((box.x1 - box.x0) * ux) + Math.abs((box.y1 - box.y0) * uy)) / 2;
    if (!(half > 0.01)) return g.stops[0];
    const grad = ctx.createLinearGradient(cx - ux * half, cy - uy * half,
                                          cx + ux * half, cy + uy * half);
    const last = g.stops.length - 1;
    g.stops.forEach((c, i) => grad.addColorStop(i / last, c));
    return grad;
  }

  /* `i`, `j` say which square's copy is being painted, so that a copy
     the warp bends can be found; without them the mark goes down as it
     lies. */
  function paintShape(s, hair, part, i, j) {
    if (s.kind === 'image') { paintImage(ctx, s, i, j); return; }
    const bent = i == null ? null : warpedCopy(s, part, i, j, paintWarp);
    const p = bent ? bentPath(bent) : s === draft ? draftPath : pathOf(s);
    if (s.layer === 'fill') {
      ctx.fillStyle = inkStyle(s, 'color');
      ctx.fill(p, 'evenodd');
    } else if (s.filled) {
      ctx.fillStyle = inkStyle(s, 'color');
      ctx.fill(p);
    } else {
      if (s.fillColor && part !== 'outline') {
        ctx.fillStyle = inkStyle(s, 'fillColor');
        ctx.fill(p);
      }
      if (part === 'inside') return;
      const [cap, join] = capsOf(s.kind);
      ctx.lineCap = cap;
      ctx.lineJoin = join;
      const style = inkStyle(s, 'color');
      ctx.strokeStyle = style;
      ctx.fillStyle = style;
      // Swelled, a stroke is the area it covers, rounded joins and all.
      if (bent && bent.how === 'nonzero') { ctx.fill(p); return; }
      const w = Math.max(s.width, hair);
      ctx.lineWidth = w;
      ctx.stroke(p);
      if (!bent) paintJunctions(ctx, s, w);
      else if (bent.discs.length) ctx.fill(bentPath(bent, 'discs'));
    }
  }

  /* ---- pictures ----
     A picture is decoded once and kept against its data URL, so every
     copy of it across the plane, and every mark pasted from the same
     file, draws from the one image. Until it has decoded there is nothing
     to draw, and the plane is asked for again when it has. */
  const pictures = new Map();
  function pictureOf(src) {
    let got = pictures.get(src);
    if (!got) {
      const img = new Image();
      got = { img, ready: false, failed: false };
      img.onload = () => { got.ready = true; requestDraw(); };
      img.onerror = () => { got.failed = true; };
      img.src = src;
      pictures.set(src, got);
    }
    return got.ready ? got.img : null;
  }

  /* The picture through the affine its corners make of it — or, where
     the warp reaches this copy (`i`, `j`), bent with the plane: see
     imageMesh. */
  function paintImage(g, s, i, j) {
    const img = pictureOf(s.src);
    if (!img) return;
    g.save();
    g.imageSmoothingQuality = 'high';
    const mesh = i == null ? null : imageMesh(s, i, j);
    if (!mesh) {
      const m = imageMatrix(s);
      g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      g.drawImage(img, 0, 0, s.iw, s.ih);
      g.restore();
      return;
    }
    const b = meshBitmap(s, img, mesh);
    if (b) g.drawImage(b.canvas, b.x0, b.y0, b.w, b.h);
    g.restore();
  }

  /* A bent copy is drawn once, into a bitmap at the zoom step it was cut
     for, and that is what the plane paints from then on: a pan, a click,
     another mark moving, all cost one image per copy rather than a clip
     and a draw for every triangle. Kept against the mesh, which is itself
     kept against the mark, the warp and the zoom step, so it goes when any
     of those change. */
  const MESH_PX = 4096;      // the widest a bent copy's bitmap may be
  const meshBitmaps = new WeakMap();
  function meshBitmap(s, img, mesh) {
    let got = meshBitmaps.get(mesh);
    if (got) return got;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const t of mesh) {
      for (const p of t.d) {
        x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y);
      }
    }
    if (!(x1 > x0 && y1 > y0)) return null;
    // The near end of the zoom step, so the bitmap is never drawn up.
    const step = Math.round(Math.log2(state.view.scale) * 2);
    let k = Math.pow(2, (step + 1) / 2) * dpr;
    k = Math.min(k, MESH_PX / (x1 - x0), MESH_PX / (y1 - y0));
    const pad = 2 / k;
    x0 -= pad; y0 -= pad; x1 += pad; y1 += pad;
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.ceil((x1 - x0) * k));
    c.height = Math.max(1, Math.ceil((y1 - y0) * k));
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    /* Each triangle's clip is let out a little past its edges, so the
       triangles overlap by a hair: cut exactly, every edge of the mesh
       showed as a faint line of paper through the picture. */
    const grow = 0.7 / k;
    const kx = img.naturalWidth / s.iw || 1, ky = img.naturalHeight / s.ih || 1;
    for (const t of mesh) {
      const q = grown(t.d, grow);
      const m = t.m;
      g.save();
      g.setTransform(k, 0, 0, k, -x0 * k, -y0 * k);
      g.beginPath();
      g.moveTo(q[0].x, q[0].y); g.lineTo(q[1].x, q[1].y); g.lineTo(q[2].x, q[2].y);
      g.closePath();
      g.clip();
      g.transform(m[0], m[1], m[2], m[3], m[4], m[5]);
      // Only the part of the picture this triangle shows, and a pixel round it.
      const [sx0, sy0, sx1, sy1] = t.src;
      g.drawImage(img, sx0 * kx, sy0 * ky, (sx1 - sx0) * kx, (sy1 - sy0) * ky, sx0, sy0, sx1 - sx0, sy1 - sy0);
      g.restore();
    }
    got = { canvas: c, x0, y0, w: x1 - x0, h: y1 - y0 };
    meshBitmaps.set(mesh, got);
    return got;
  }

  /* A picture under the warp. Pixels cannot be bent the way a line's
     points can, so the picture is cut into triangles, the corners of
     each are carried through the warp as the points of a line would be,
     and each triangle is drawn as the flat piece of picture that lands
     on it. The cutting follows the warp: a piece is cut in four only
     while the warp bends it further from straight than a pixel on
     screen, or a unit in an SVG — finer costs more than it shows — so
     the picture is cut fine round the middle of a twirl and not at all
     where no disc reaches. A piece a disc could hide inside without
     touching any corner of it is cut regardless, down to half the
     smallest disc across. Kept against the mark, the warp and the
     zoom step, the way the warped copies of a line are. Null where the
     warp does not reach this copy. */
  const meshCache = new WeakMap();
  function imageMesh(s, i, j, fine) {
    const f = warpField();
    if (!f.active) return null;
    const step = Math.round(Math.log2(state.view.scale) * 2);
    const key = `${f.sig}|${fine ? 'svg' : step}|`
      + (f.tiled ? tiling().key(state.pattern, i, j) : `${i},${j}`);
    let byKey = meshCache.get(s);
    if (!byKey) meshCache.set(s, (byKey = new Map()));
    if (byKey.has(key)) return byKey.get(key);
    if (byKey.size > 64) byKey.clear();
    const box = copyBox(s, i, j);
    const mesh = box && f.touches(box) ? cutMesh(s, i, j, f, fine) : null;
    byKey.set(key, mesh);
    return mesh;
  }

  const MESH_DEEP = 6;       // at most 64 pieces a side

  function cutMesh(s, i, j, f, fine) {
    // A pixel on screen at the near end of the zoom step, so it holds across it.
    const tol = fine ? 1 : 1 / Math.pow(2, (Math.round(Math.log2(state.view.scale) * 2) + 1) / 2);
    const [p0, p1, , p3] = s.pts;
    const at = (u, v) => ({ x: p0.x + (p1.x - p0.x) * u + (p3.x - p0.x) * v, y: p0.y + (p1.y - p0.y) * u + (p3.y - p0.y) * v });
    const seen = new Map();
    const W = (u, v) => {
      const k = `${u},${v}`;
      let q = seen.get(k);
      if (!q) { q = unplaceIn(f.warp(placeIn(at(u, v), i, j)), i, j); seen.set(k, q); }
      return q;
    };
    const side = Math.max(Math.hypot(p1.x - p0.x, p1.y - p0.y), Math.hypot(p3.x - p0.x, p3.y - p0.y));
    const least = clamp(Math.ceil(Math.log2(side / (f.minR / 2))), 0, MESH_DEEP);
    const reached = (u0, v0, u1, v1) => {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const [u, v] of [[u0, v0], [u1, v0], [u1, v1], [u0, v1]]) {
        const w = placeIn(at(u, v), i, j);
        x0 = Math.min(x0, w.x); y0 = Math.min(y0, w.y); x1 = Math.max(x1, w.x); y1 = Math.max(y1, w.y);
      }
      return f.touches({ x0, y0, x1, y1 });
    };
    const off = (p, q, r) => Math.hypot(p.x - (q.x + r.x) / 2, p.y - (q.y + r.y) / 2);
    const tris = [];
    const piece = (u0, v0, u1, v1, d) => {
      const a = W(u0, v0), b = W(u1, v0), c = W(u1, v1), e = W(u0, v1);
      if (d < MESH_DEEP) {
        const um = (u0 + u1) / 2, vm = (v0 + v1) / 2;
        let cut = d < least && reached(u0, v0, u1, v1);
        if (!cut) {
          const m = W(um, vm);
          cut = Math.max(off(m, a, c), off(m, b, e), off(W(um, v0), a, b), off(W(u1, vm), b, c),
            off(W(um, v1), e, c), off(W(u0, vm), a, e)) > tol;
        }
        if (cut) {
          piece(u0, v0, um, vm, d + 1); piece(um, v0, u1, vm, d + 1);
          piece(u0, vm, um, v1, d + 1); piece(um, vm, u1, v1, d + 1);
          return;
        }
      }
      const S = (u, v) => ({ x: u * s.iw, y: v * s.ih });
      for (const [A, B, C, sa, sb, sc] of [
        [a, b, c, S(u0, v0), S(u1, v0), S(u1, v1)],
        [a, c, e, S(u0, v0), S(u1, v1), S(u0, v1)],
      ]) {
        const m = triangleAffine(sa, sb, sc, A, B, C);
        if (!m) continue;
        tris.push({
          d: [A, B, C], m,
          src: [
            Math.max(0, Math.min(sa.x, sb.x, sc.x) - 1), Math.max(0, Math.min(sa.y, sb.y, sc.y) - 1),
            Math.min(s.iw, Math.max(sa.x, sb.x, sc.x) + 1), Math.min(s.ih, Math.max(sa.y, sb.y, sc.y) + 1),
          ],
        });
      }
    };
    piece(0, 0, 1, 1, 0);
    return tris;
  }

  // The affine taking three points of the picture onto where they landed.
  function triangleAffine(sa, sb, sc, P, Q, R) {
    const ux = sb.x - sa.x, uy = sb.y - sa.y, vx = sc.x - sa.x, vy = sc.y - sa.y;
    const det = ux * vy - vx * uy;
    if (!det) return null;
    const qx = Q.x - P.x, qy = Q.y - P.y, rx = R.x - P.x, ry = R.y - P.y;
    const m0 = (qx * vy - rx * uy) / det, m2 = (rx * ux - qx * vx) / det;
    const m1 = (qy * vy - ry * uy) / det, m3 = (ry * ux - qy * vx) / det;
    return [m0, m1, m2, m3, P.x - m0 * sa.x - m2 * sa.y, P.y - m1 * sa.x - m3 * sa.y];
  }

  // A triangle with its corners pushed out from its middle by `d`.
  function grown(c, d) {
    const mx = (c[0].x + c[1].x + c[2].x) / 3, my = (c[0].y + c[1].y + c[2].y) / 3;
    return c.map((p) => {
      const dx = p.x - mx, dy = p.y - my, len = Math.hypot(dx, dy) || 1;
      return { x: p.x + (dx / len) * d * 2, y: p.y + (dy / len) * d * 2 };
    });
  }

  /* ---- warped copies ----
     One copy of a mark as a square shows it through the warp (warp.js).
     They are kept against the mark: marks are never changed in place, so
     one can hold its copies by identity the way pathOf holds its path.
     Keyed by the square — by its place in the block when anchors repeat,
     since a square a block along shows the very same copy — by which of
     its ends are rounded off there, and by the warp, zoom step and ink
     they were built for. Null says the warp does not reach that copy,
     which is then painted exactly as it always was. The mark being drawn
     is the exception: it changes under the same object as the pointer
     moves, so its copies last a frame. */
  const WARP_PX = 0.3;       // how far a warped chord may stray from the curve, on screen
  const warpCache = new WeakMap();
  let draftWarps = new Map();
  let paintWarp = { tol: 1, bucket: 0, ink: 'swell' };

  // The box one copy of a mark covers on the plane, ink and all.
  function copyBox(s, i, j) {
    const b = shapeBBox(s);
    if (!b) return null;
    const pen = (s.layer === 'stroke' && !s.filled ? s.width || 0 : 0) / 2;
    const p = placeIn({ x: b.x0 - pen, y: b.y0 - pen }, i, j);
    const q = placeIn({ x: b.x1 + pen, y: b.y1 + pen }, i, j);
    return { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
  }

  function warpedCopy(s, part, i, j, how) {
    const f = warpField();
    if (!f.active) return null;
    tileKey = tiling().key(state.pattern, i, j);
    const ends = s.layer === 'stroke' && !s.filled && part !== 'inside' && ROUNDABLE[s.kind]
      ? endpointsOf(s).filter(joined)
      : [];
    const sig = `${f.sig}|${how.bucket}|${how.ink}`;
    let key = `${part || ''}|${f.tiled ? tileKey : `${i},${j}`}|${ends.map(jkey).join(' ')}`;
    let copies;
    if (s === draft) {
      copies = draftWarps;
      key = `${sig}|${key}`;
    } else {
      let bySig = warpCache.get(s);
      if (!bySig) warpCache.set(s, (bySig = new Map()));
      copies = bySig.get(sig);
      if (!copies) {
        // A handful of warps to a mark: the one on screen, its halo, and
        // the few a drag or a zoom has just gone through.
        if (bySig.size >= 6) bySig.delete(bySig.keys().next().value);
        bySig.set(sig, (copies = new Map()));
      }
    }
    let got = copies.get(key);
    if (got === undefined) {
      const box = copyBox(s, i, j);
      got = box && f.touches(box)
        ? warpMark(s, part, i, j, state.pattern, f, how.tol, how.ink, ends)
        : null;
      copies.set(key, got);
    }
    return got;
  }

  function linesPath(lines) {
    const p = new Path2D();
    for (const l of lines) {
      if (!l.pts.length) continue;
      p.moveTo(l.pts[0].x, l.pts[0].y);
      for (let k = 1; k < l.pts.length; k++) p.lineTo(l.pts[k].x, l.pts[k].y);
      if (l.closed) p.closePath();
    }
    return p;
  }

  const bentPath = (got, which) => {
    const k = `${which || 'lines'}Path`;
    return got[k] || (got[k] = linesPath(got[which || 'lines']));
  };

  /* Painting order. A group is one unit and sits at a single depth, so
     moving it carries its fill and its border together; inside a unit
     the fill still goes down first, under its own outline. Fills that
     belong to no group are the ground the rest sits on, so they stay
     at the bottom.

     The ground and the units are handed back apart, since reordering
     depth works on them apart too: a unit goes up or down as one thing,
     and a fill in the ground never comes up through a mark. */
  function paintUnits(list) {
    const ground = list.filter((s) => s.layer === 'fill' && !s.group);

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
      if (!u) units.set(k, (u = { last: i, members: [] }));
      if (i > u.last) u.last = i;
      u.members.push(s);
    });
    return {
      ground,
      units: [...units.values()].sort((a, b) => a.last - b.last).map((u) => u.members),
    };
  }

  function paintOrder(list) {
    const { ground, units } = paintUnits(list);
    const order = ground;
    for (const members of units) {
      const fills = [], strokes = [];
      for (const s of members) {
        if (s.layer === 'fill') fills.push(s);
        else {
          /* A mark's own interior is a fill and belongs at fill depth. It
             used to be painted with the mark's border, which paintOrder
             puts above every separate fill — so an area filled inside a
             closed mark vanished under that mark's interior the moment it
             was drawn, and clicking the same spot again did nothing
             visible however many times you tried. */
          if (s.fillColor && !s.filled) fills.push({ inside: s });
          strokes.push(s);
        }
      }
      order.push(...fills, ...strokes);
    }
    return order;
  }

  /* A halo around each picked mark, the marks put back over it, and a
     dashed box round each — in three passes, not one mark at a time.
     Putting a mark back has to follow the order the plane paints in: a
     group holds a fill and the borders around it, and repainting them in
     the order they sit in the list put the fill last, burying every
     border it had. */
  const gripMembers = (g) => (g.kind === 'point' ? [g.shape] : g.members);

  function heldNow() {
    if (grip && grip.previews) return grip.previews.filter(Boolean);
    return (moving ? moving.previews : heldMarks()).filter(Boolean);
  }

  /* The glow round what is in hand: one ring round the lot, the same colour
     and the same reach all the way round, lying on the paper just outside
     the ink.

     Each mark used to lay a glow of its own under the marks, and they did
     not agree. A border in the accent's own vermilion glowed dark while the
     fill it held glowed vermilion; a stroke's glow reached out from its
     outer edge while a fill's reached out from under that stroke; and
     whatever was painted over a glow — a neighbour, a translucent ink — hid
     it or stained it. So the ink in hand is laid down once, grown by the
     reach, cut out again by itself, and what is left goes on top of the
     drawing: nothing of the marks in hand lies under it to be covered, and
     nothing else is painted over it. */
  const HALO_PX = 4;
  const haloCanvas = document.createElement('canvas');
  const hctx = haloCanvas.getContext('2d');

  function drawHaloRing() {
    const shapes = heldNow();
    if (!shapes.length) return;
    if (haloCanvas.width !== canvas.width || haloCanvas.height !== canvas.height) {
      haloCanvas.width = canvas.width;
      haloCanvas.height = canvas.height;
    }
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.globalCompositeOperation = 'source-over';
    hctx.clearRect(0, 0, haloCanvas.width, haloCanvas.height);
    const reach = (2 * HALO_PX) / state.view.scale;   // across a line, so HALO_PX either side
    const hair = 0.9 / state.view.scale;
    const inks = shapes.map((sh) => {
      const at = unitFrame(sh);
      return { at, ops: inkOf(sh, at, hair) };
    });
    hctx.fillStyle = '#000';
    hctx.strokeStyle = '#000';
    for (const cut of [false, true]) {
      hctx.globalCompositeOperation = cut ? 'destination-out' : 'source-over';
      for (const { at, ops } of inks) {
        inTileFrame(() => {
          // An area grown by a disc is the area and its edge stroked round.
          for (const op of ops) {
            hctx.fill(op.fill, op.rule);
            if (cut) continue;
            hctx.lineWidth = reach;
            hctx.lineCap = 'round';
            hctx.lineJoin = 'round';
            hctx.stroke(op.fill);
          }
        }, at, hctx);
      }
    }
    /* One colour for the whole of what is held: vermilion, or dark where
       any of it is in the vermilion itself, which a vermilion ring would
       only seem to thicken. */
    const vermilion = shapes.some((sh) => (sh.color && rgbOf(sh.color) === ACCENT)
      || (!!sh.fillColor && rgbOf(sh.fillColor) === ACCENT));
    hctx.setTransform(1, 0, 0, 1, 0, 0);
    hctx.globalCompositeOperation = 'source-in';
    hctx.fillStyle = vermilion ? '#17160f' : ACCENT;
    hctx.fillRect(0, 0, haloCanvas.width, haloCanvas.height);
    hctx.globalCompositeOperation = 'source-over';
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 0.4;
    ctx.drawImage(haloCanvas, 0, 0);
    ctx.restore();
  }

  /* A stroke as the area its ink covers — flat ends flat, mitred corners
     mitred — built by warp.js's outliner and kept against the mark, or
     against its warped copy, for as long as the zoom step lasts.

     The ring used to grow a stroke by stroking it wider with round ends.
     A flat-ended stroke has no round end, so the grown ink had a cap the
     stroke did not, cutting the stroke back out left that cap behind, and
     every flat end of a thick stroke wore a grey blob as wide as the
     stroke itself. Grown from the area, the ring is as wide round a flat
     end as anywhere else. */
  const strokeAreas = new WeakMap();

  function strokeArea(s, bent, width, cap, join) {
    const owner = bent || s;
    const key = `${width}|${paintWarp.tol}`;
    const had = strokeAreas.get(owner);
    if (had && had.key === key) return had.path;
    const lines = bent ? bent.lines : layRuns(warpRuns(s), (p) => p, paintWarp.tol, Infinity);
    const path = new Path2D();
    for (const poly of strokeOutline(lines, width / 2, cap, join)) {
      path.moveTo(poly[0].x, poly[0].y);
      for (let k = 1; k < poly.length; k++) path.lineTo(poly[k].x, poly[k].y);
      path.closePath();
    }
    strokeAreas.set(owner, { key, path });
    return path;
  }

  /* The ink one mark lays down in square `at`, as the plane paints it —
     warped or not — as areas to fill. */
  function inkOf(s, at, hair) {
    tileKey = tiling().key(state.pattern, at.i, at.j);
    if (s.layer === 'fill' || s.filled) {
      const bent = warpedCopy(s, undefined, at.i, at.j, paintWarp);
      return [{ fill: bent ? bentPath(bent) : pathOf(s), rule: s.layer === 'fill' ? 'evenodd' : 'nonzero' }];
    }
    const ops = [];
    if (s.fillColor) {
      const inside = warpedCopy(s, 'inside', at.i, at.j, paintWarp);
      ops.push({ fill: inside ? bentPath(inside) : pathOf(s), rule: 'nonzero' });
    }
    const bent = warpedCopy(s, s.fillColor ? 'outline' : undefined, at.i, at.j, paintWarp);
    if (bent && bent.how === 'nonzero') {
      ops.push({ fill: bentPath(bent), rule: 'nonzero' });
      return ops;
    }
    const [cap, join] = capsOf(s.kind);
    const width = Math.max(s.width, hair);
    ops.push({ fill: strokeArea(s, bent, width, cap, join), rule: 'nonzero' });
    if (bent) {
      if (bent.discs.length) ops.push({ fill: bentPath(bent, 'discs'), rule: 'nonzero' });
    } else if (ROUNDABLE[s.kind]) {
      for (const p of endpointsOf(s)) {
        if (!joined(p)) continue;
        const disc = new Path2D();
        disc.arc(p.x, p.y, width / 2, 0, Math.PI * 2);
        ops.push({ fill: disc, rule: 'nonzero' });
      }
    }
    return ops;
  }

  /* The box round what is held, and the grips on it.

     A corner grip sizes the lot about the corner opposite, so the one
     you are not holding stays put. Just outside each corner is a ring
     that turns it instead — near the corner rather than on it, which is
     where a hand reaches for a turn anyway, and it only shows while the
     pointer is there so the box stays quiet the rest of the time.

     A single line, arc or circle also gets grips on its own points, so
     its ends, its bend and its radius can be taken hold of directly
     rather than through a box. */
  const GRIP = 4.5;        // half a grip square, in screen pixels
  const SIZE_R = 8;        // a press this near a corner sizes
  const TURN_OFF = 22;     // how far out past a corner the turn ring sits
  const TURN_R = 8;        // the arc's own radius
  const TURN_GRAB = 12;    // and how near its middle you must press

  // The box round everything held, grips and all.
  function heldBox(shapes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sh of shapes) {
      const b = shapeBBox(sh);
      if (!b) continue;
      const pen = (sh.layer === 'fill' || sh.filled ? 0 : sh.width) / 2;
      x0 = Math.min(x0, b.x0 - pen); y0 = Math.min(y0, b.y0 - pen);
      x1 = Math.max(x1, b.x1 + pen); y1 = Math.max(y1, b.y1 + pen);
    }
    return x0 === Infinity ? null : { x0, y0, x1, y1 };
  }

  /* Where a corner's turn ring sits, and the middle of the band that
     summons it: out along the diagonal from the middle of the box, well
     clear of the corner grip. Drawing and hit testing both come from
     here, so the ring cannot be anywhere but where it is taken hold of.
     They overlapped once, and a press on the near side of the ring came
     back as a size, which read as the turn doing nothing at all. */
  const spotFrom = (c, mid) => {
    const dx = c.x - mid.x, dy = c.y - mid.y;
    const len = Math.hypot(dx, dy) || 1;
    const out = TURN_OFF / state.view.scale;
    return { x: c.x + (dx / len) * out, y: c.y + (dy / len) * out };
  };

  function turnSpot(box, i) {
    const mid = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    return spotFrom(boxCorners(box)[i], mid);
  }

  /* The corners of what is held, carried round by a turn in progress.
     The box is the one the turn started from, turned by however far it
     has gone — not the upright box round the marks as they are now,
     which swells and shrinks as a figure goes round and would have the
     grips crawling about instead of travelling with it. */
  function turnCorners() {
    const cs = boxCorners(grip.box);
    const a = grip.angle || 0;
    if (!a) return cs;
    const cos = Math.cos(a), sin = Math.sin(a), c = grip.centre;
    return cs.map((p) => {
      const dx = p.x - c.x, dy = p.y - c.y;
      return { x: c.x + dx * cos - dy * sin, y: c.y + dx * sin + dy * cos };
    });
  }

  const boxCorners = (b) => {
    const g = 7 / state.view.scale;
    return [
      { x: b.x0 - g, y: b.y0 - g }, { x: b.x1 + g, y: b.y0 - g },
      { x: b.x1 + g, y: b.y1 + g }, { x: b.x0 - g, y: b.y1 + g },
    ];
  };

  /* The points a single mark offers directly. `set` writes one back,
     which is what a drag of that grip does. */
  function pointGrips(sh) {
    if (!sh || sh.layer !== 'stroke') return [];
    const at = (x, y, set, what) => ({ x, y, set, what });
    if (sh.kind === 'line') {
      return [
        at(sh.a.x, sh.a.y, (p) => ({ ...sh, a: p }), 'this end'),
        at(sh.b.x, sh.b.y, (p) => ({ ...sh, b: p }), 'this end'),
      ];
    }
    if (sh.kind === 'curve') {
      // The bend grip sits on the arc, not on the control point, which
      // is off the curve entirely and means nothing to the eye.
      const m = { x: (sh.a.x + 2 * sh.c.x + sh.b.x) / 4, y: (sh.a.y + 2 * sh.c.y + sh.b.y) / 4 };
      return [
        at(sh.a.x, sh.a.y, (p) => ({ ...sh, a: p }), 'this end'),
        at(sh.b.x, sh.b.y, (p) => ({ ...sh, b: p }), 'this end'),
        at(m.x, m.y, (p) => ({ ...sh, c: quadThrough(sh.a, sh.b, p) }), 'the bend'),
      ];
    }
    if (sh.kind === 'circle') {
      const r = sh.r;
      return [
        at(sh.c.x + r, sh.c.y, (p) => ({ ...sh, r: Math.abs(p.x - sh.c.x) }), 'the radius'),
        at(sh.c.x - r, sh.c.y, (p) => ({ ...sh, r: Math.abs(p.x - sh.c.x) }), 'the radius'),
        at(sh.c.x, sh.c.y + r, (p) => ({ ...sh, r: Math.abs(p.y - sh.c.y) }), 'the radius'),
        at(sh.c.x, sh.c.y - r, (p) => ({ ...sh, r: Math.abs(p.y - sh.c.y) }), 'the radius'),
      ];
    }
    if (sh.kind === 'path' && sh.pts.length > 1) return pathGrips(sh);
    return [];
  }

  /* A pencil stroke's grips. A stroke kept as drawn carries a point every
     pixel or two, far too close to take hold of one at a time, so the
     grips are spread along it by how far apart they fall on screen, and
     a drag bends the stroke rather than one point of it: the pull is whole
     at the grip and eases off to nothing at the grips either side. Where
     the points are already that far apart, as a tidied stroke's often
     are, that is simply the one point moving.

     Like the bend of an arc, each grip sits on the stroke itself rather
     than on the point steering it. The stroke is drawn as quadratics
     through the midpoints, so it passes a quarter of the way between the
     midpoints either side and its own point — and a drag moves the point
     by whatever it takes to put that spot under the pointer. */
  const PATH_GAP = 40;     // screen pixels between the grips along a stroke

  /* Which points are grips depends on the zoom and on the stroke's shape,
     and a drag changes the shape. Picked afresh each frame, every grip
     past the one in hand would slide along the stroke as it bent, so the
     choice rides along on the shape the drag hands back. */
  const pathGripPicks = new WeakMap();

  function pathGripIndices(sh) {
    const had = pathGripPicks.get(sh);
    if (had && had.scale === state.view.scale) return had.idx;
    const pts = sh.pts, last = pts.length - 1;
    const gap = PATH_GAP / state.view.scale;
    const idx = [0];
    let run = 0;
    for (let i = 1; i < last; i++) {
      run += dist(pts[i - 1], pts[i]);
      if (run >= gap) { idx.push(i); run = 0; }
    }
    // The far end is always a grip; the one before it makes way if the
    // two would crowd each other.
    if (idx.length > 1 && run + dist(pts[last - 1], pts[last]) < gap / 2) idx.pop();
    idx.push(last);
    return idx;
  }

  function pathGrips(sh) {
    const pts = sh.pts, last = pts.length - 1;
    const idx = pathGripIndices(sh);
    const len = [0];
    for (let i = 1; i <= last; i++) len.push(len[i - 1] + dist(pts[i - 1], pts[i]));
    const ease = (t) => (1 - Math.cos(Math.PI * t)) / 2;
    const mid = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

    return idx.map((h, k) => {
      const lo = k > 0 ? idx[k - 1] : h;
      const hi = k < idx.length - 1 ? idx[k + 1] : h;
      // How much of the pull a point takes, by how far along the stroke it
      // lies between this grip and the next one out.
      const share = (i) => {
        if (i === h) return 1;
        if (i <= lo || i >= hi) return 0;
        return i < h
          ? ease((len[i] - len[lo]) / (len[h] - len[lo] || 1))
          : ease((len[hi] - len[i]) / (len[hi] - len[h] || 1));
      };
      // Where the stroke passes for this point, and how far that spot
      // travels for each unit the point does — its neighbours moving too.
      let at = pts[h], gain = 1;
      if (h > 0 && h < last) {
        const from = h === 1 ? pts[0] : mid(pts[h - 1], pts[h]);
        const to = mid(pts[h], pts[h + 1]);
        at = { x: (from.x + 2 * pts[h].x + to.x) / 4, y: (from.y + 2 * pts[h].y + to.y) / 4 };
        const back = h === 1 ? share(0) : (share(h - 1) + 1) / 2;
        gain = (back + 2 + (1 + share(h + 1)) / 2) / 4;
      }
      const set = (q) => {
        const dx = (q.x - at.x) / gain, dy = (q.y - at.y) / gain;
        const out = { ...sh, pts: pts.map((p, i) => {
          const s = share(i);
          return s ? { x: p.x + dx * s, y: p.y + dy * s } : p;
        }) };
        pathGripPicks.set(out, { scale: state.view.scale, idx });
        return out;
      };
      return { x: at.x, y: at.y, set, what: h === 0 || h === last ? 'this end' : 'the stroke' };
    });
  }

  // Everything the pointer could take hold of, nearest first.
  /* `w` is the pointer in its own square. Grips are matched out on the
     plane rather than in tile coordinates: a grip is drawn in one place
     only — the square the selection was taken in — and comparing tile
     coordinates would have it answer from every copy of that square at
     once, which is the very thing the box no longer does. */
  function gripAt(w) {
    const held = heldMarks();
    if (!held.length) return null;
    /* Measured on the screen, where the grips are drawn: through a warp,
       the plane can put a grip nearer or further than it shows. */
    const f = frameTile(), h = heldFrame();
    const pw = placeIn(w, f.i, f.j);
    const ps = w2s(pw.x, pw.y);
    const near = (p) => {
      const q = placeIn(p, h.i, h.j);
      const t = w2s(q.x, q.y);
      return Math.hypot(t.x - ps.x, t.y - ps.y);
    };

    if (held.length === 1) {
      for (const g of pointGrips(held[0])) {
        if (near(g) <= SIZE_R) {
          return { kind: 'point', shape: held[0], set: g.set, what: g.what, x: g.x, y: g.y };
        }
      }
    }
    const box = heldBox(held);
    if (!box) return null;
    const corners = boxCorners(box);
    const mid = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    // The corner squares size.
    let best = null;
    corners.forEach((c, i) => {
      const d = near(c);
      if (d <= SIZE_R && (!best || d < best.d)) best = { d, i };
    });
    if (best) {
      return { kind: 'size', at: best.i, members: held, box,
        anchor: corners[(best.i + 2) % 4], from: corners[best.i] };
    }
    // The ring out past each one turns.
    let turn = null;
    corners.forEach((c, i) => {
      const d = near(turnSpot(box, i));
      if (d <= TURN_GRAB && (!turn || d < turn.d)) turn = { d, i };
    });
    if (turn) {
      // The box is kept as it was: an upright box round a turning figure
      // grows and shrinks as it goes, and the grips would skitter with it.
      return { kind: 'turn', at: turn.i, members: held, centre: mid, box, from: corners[turn.i] };
    }
    return null;
  }

  function drawSelection() {
    const shapes = heldNow();
    if (!shapes.length) return;
    /* Turning: one box, the one the turn began with, carried round by
       however far it has gone. Measuring the marks afresh each frame
       would give the upright box round a figure mid-turn, which is a
       different shape every frame and says nothing about where the thing
       you took hold of has got to. */
    if (grip && grip.kind === 'turn' && grip.box) {
      drawSelectionQuad(turnCorners());
      drawGrips(shapes);
      return;
    }
    /* One box to a unit, not to a mark. A group is one thing, and a
       dashed box round each of its marks said the opposite — loudly,
       when the group was a figure of a dozen. Marks held loose still get
       one each, because loose is what they are. */
    const boxes = new Map();
    for (const sh of shapes) {
      const b = shapeBBox(sh);
      if (!b) continue;
      const pen = (sh.layer === 'fill' || sh.filled ? 0 : sh.width) / 2;
      const key = unitKey(sh);
      const had = boxes.get(key);
      const box = { x0: b.x0 - pen, y0: b.y0 - pen, x1: b.x1 + pen, y1: b.y1 + pen,
        at: unitFrame(sh) };
      if (!had) boxes.set(key, box);
      else {
        had.x0 = Math.min(had.x0, box.x0);
        had.y0 = Math.min(had.y0, box.y0);
        had.x1 = Math.max(had.x1, box.x1);
        had.y1 = Math.max(had.y1, box.y1);
      }
    }
    // Each unit's box in the square that unit is being shown in.
    for (const box of boxes.values()) drawSelectionBox(box, box.at);
    drawGrips(shapes);
  }

  function drawGrips(shapes) {
    const turning = !!(grip && grip.kind === 'turn' && grip.box);
    const box = turning ? grip.box : heldBox(shapes);
    if (!box) return;
    const corners = turning ? turnCorners() : boxCorners(box);
    const mid = turning ? grip.centre
      : { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    const f = heldFrame();
    const put = (p) => { const q = placeIn(p, f.i, f.j); return w2s(q.x, q.y); };
    const hot = grip || hoverGrip;
    ctx.save();
    ctx.lineWidth = 1;
    const square = (p, live) => {
      const t = put(p);
      ctx.beginPath();
      ctx.rect(t.x - GRIP, t.y - GRIP, GRIP * 2, GRIP * 2);
      ctx.fillStyle = live ? ACCENT : '#ffffff';
      ctx.fill();
      ctx.strokeStyle = '#17160f';
      ctx.stroke();
    };
    // The corners size; the grips a single mark offers move its own points.
    corners.forEach((c, i) => square(c, !!hot && hot.kind === 'size' && hot.at === i));
    if (shapes.length === 1) {
      for (const g of pointGrips(shapes[0])) {
        square(g, !!hot && hot.kind === 'point' && Math.hypot(g.x - hot.x, g.y - hot.y) < 1e-6);
      }
    }
    // A ring just outside a corner turns instead of sizing, and only
    // shows while the pointer is out there — the box stays quiet
    // otherwise, which is most of the time.
    if (hot && hot.kind === 'turn') {
      drawTurnRing(put(spotFrom(corners[hot.at], mid)), put(mid));
    }
    ctx.restore();
  }

  /* The turn ring: a quarter of an arc with a head on each end, sitting
     out past its corner and staying there — the pointer moves within the
     band that summons it, the ring does not follow. It is centred on the
     way out from the middle of what is held, so its ends come round to
     either side of the way the turn would go: out past the top right
     corner the heads point down and left, and so on round. */
  function drawTurnRing(at, mid) {
    const d = Math.atan2(at.y - mid.y, at.x - mid.x);
    const rad = (deg) => (deg * Math.PI) / 180;
    // A quarter of a circle, centred on the way out from the middle —
    // so it sits on the far side of the pointer and its ends come round
    // to either side of the way the turn would go.
    const a1 = d + rad(-45), a2 = d + rad(45);
    ctx.strokeStyle = '#17160f';
    ctx.fillStyle = '#17160f';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(at.x, at.y, TURN_R, a1, a2);
    ctx.stroke();
    // A head on each end, pointing the way the arc runs there.
    const head = (a, way) => {
      const px = at.x + Math.cos(a) * TURN_R, py = at.y + Math.sin(a) * TURN_R;
      const tx = -Math.sin(a) * way, ty = Math.cos(a) * way;   // along the arc
      const nx = -ty, ny = tx;                                  // across it
      ctx.beginPath();
      ctx.moveTo(px + tx * 4.2, py + ty * 4.2);
      ctx.lineTo(px - tx * 0.7 + nx * 2.6, py - ty * 0.7 + ny * 2.6);
      ctx.lineTo(px - tx * 0.7 - nx * 2.6, py - ty * 0.7 - ny * 2.6);
      ctx.closePath();
      ctx.fill();
    };
    head(a1, -1);
    head(a2, 1);
  }

  // The home square's own frame, where a mark's coordinates mean what
  // they say.
  function inTileFrame(draw, tile, into) {
    const g = into || ctx;
    const v = state.view;
    g.save();
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.translate(v.x, v.y);
    g.rotate(v.rot);
    g.scale(v.scale, v.scale);
    const f = tile || frameTile();
    intoTile(g, f.i, f.j);
    draw();
    g.restore();
  }

  const drawSelectionBox = (b, at) => drawSelectionQuad(boxCorners(b), at);

  // Four corners, not a box: a turn in progress carries them round, and
  // an upright box cannot say where they have got to.
  function drawSelectionQuad(pts, at) {
    // Drawn as a quad through the transform so it stays around the mark
    // when the plane is turned, and in the square that mark was picked up
    // in rather than whichever one the pointer is over.
    const f = at || heldFrame();
    const corners = pts.map((p) => placeIn(p, f.i, f.j));
    ctx.save();
    // Ink black, not the accent: the box says where a thing is, which is
    // not something that needs to shout.
    ctx.strokeStyle = '#17160f';
    ctx.globalAlpha = 0.75;
    ctx.lineWidth = 1;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    tracePlane(corners, true);
    ctx.stroke();
    ctx.restore();
  }


  function drawRules(R) {
    if (!tiling().square) return drawOutlineRules(R);
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

  /* The rules of a tiling that is not the square: every copy's outline,
     each edge drawn once, by the copy on one side of it. An edge between
     two blocks is a major rule, as the square's block lines are. */
  function drawOutlineRules(R) {
    const t = tiling();
    const n = state.pattern.n;
    const minor = R.step > 15;
    const room = R.step > 70;
    // One copy further out, so an edge at the rim is drawn by one of them.
    const cells = cellsOver(R, 1);
    if (cells.length > 6000) return;
    const inner = [], outer = [];
    for (const [i, j] of cells) {
      const o = t.origin(i, j);
      const vs = t.outline.map((p) => placeIn(p, i, j));
      const own = t.block(n, i, j);
      for (let k = 0; k < vs.length; k++) {
        const a = vs[k], b = vs[(k + 1) % vs.length];
        const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
        const nb = cellOf({ x: mx + (mx - o.x) * 0.05, y: my + (my - o.y) * 0.05 });
        // Each edge once: the copy that comes first draws it.
        if (nb.j < j || (nb.j === j && nb.i < i)) continue;
        (n > 1 && t.block(n, nb.i, nb.j) !== own ? outer : inner).push([a, b]);
      }
    }
    const pass = (edges, width, colour) => {
      if (!edges.length) return;
      ctx.lineWidth = width;
      ctx.strokeStyle = colour;
      ctx.beginPath();
      for (const [a, b] of edges) hairLine(a.x, a.y, b.x, b.y);
      ctx.stroke();
    };
    hairSnap = 0.5;
    if (minor) pass(inner, room ? 2 : 1, RULE_MINOR);
    else if (n === 1) pass(inner, 1, RULE_MAJOR);
    pass(outer, room ? 3 : 1, RULE_MAJOR);
    ctx.lineWidth = 1;
  }

  // The drafting lattice, drawn on the drawing surface only.
  /* The lattice lies over the whole plane, not just the square the
     pointer is in, and it is turned with each square: a quarter-turn
     carries a square lattice onto itself but not a triangular one, and
     what is drawn has to be what a mark placed there would line up
     with. */
  function tileFrames(R) {
    const t = tiling();
    return cellsOver(R, 0).map(([i, j]) => [i, j, t.angle(state.pattern, i, j)]);
  }

  /* An arrow in each square saying which way that square has been turned.
     A drawing under a block of quarter-turns reads as one figure, and it is
     easy to lose track of which square is which; the symmetry panel says it
     for the block, this says it on the plane itself.

     It sits at the top left of each SQUARE as drawn, and stays there: a
     badge carried round by the turn would land on a different corner every
     quarter, telling you the same thing twice and being harder to find for
     it. The arrow inside it does the turning. Vermilion and heavy, because
     it is an answer to a question you are asking, not part of the work. */
  const ARROW_PX = 9;          // half the arrow's length, on screen
  const ARROW_INSET = 15;      // how far in from the corner it sits

  function drawOrientation(R) {
    // Too small to read is worse than absent: it becomes noise along the
    // rules. The square has to be able to hold the badge and its inset.
    if (R.step < ARROW_INSET * 3) return;
    const frames = tileFrames(R);
    if (frames.length > 400) return;
    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    const t = tiling();
    for (const [i, j, deg] of frames) {
      /* The tile's own top-left corner as it lies, in world — the corner
         the eye goes to first, whichever way the copy is turned — moved in
         towards the middle; w2s carries whatever the view is doing to it. */
      const inset = ARROW_INSET / state.view.scale;
      const o = t.origin(i, j);
      const c = t.outline.map((q) => placeIn(q, i, j))
        .reduce((a, b) => (b.x + b.y < a.x + a.y - 1e-6 ? b : a));
      const dx = o.x - c.x, dy = o.y - c.y, len = Math.hypot(dx, dy);
      // Six triangles or three hexagons meet at a corner, so theirs sit
      // well in, clear of the neighbours' badges at the same corner.
      const step = t.square ? inset * Math.SQRT2 : Math.max(inset * 1.8, len * 0.38);
      const p = w2s(c.x + (dx / len) * step, c.y + (dy / len) * step);
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate((deg * Math.PI) / 180 + state.view.rot);
      const a = ARROW_PX;
      const head = a * 0.78;
      ctx.strokeStyle = ACCENT;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.moveTo(0, a);
      ctx.lineTo(0, -a);
      ctx.moveTo(-head * 0.62, -a + head * 0.62);
      ctx.lineTo(0, -a);
      ctx.lineTo(head * 0.62, -a + head * 0.62);
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  function drawSubGrid(R) {
    /* How close together the lines actually fall. On the isometric frame
       that is not the column width: the thirty degree families lie a row
       apart measured square to themselves, which is shorter. */
    let cell = T / state.sub;
    if (diagGrid()) {
      const { w, h } = isoBasis(state.sub);
      cell = Math.min(w, (h * Math.sqrt(3)) / 2);
    }
    if (cell * state.view.scale < SUB_MIN_PX) return;
    const frames = tileFrames(R);
    if (frames.length > 160) return;             // more squares than it helps to rule
    const eff = effSub();
    // Finer levels first and fainter, so the lattice you asked for stays
    // the one that reads.
    if (eff > state.sub) latticePass(eff, eff / state.sub, SUB_FINE, frames);
    latticePass(state.sub, 1, SUB_RULE, frames);
  }

  // A segment cut to the tile's outline, which is convex; null if none of it is on it.
  function clipToTile(t, a, b) {
    let t0 = 0, t1 = 1;
    const L = t.outline, m = L.length;
    const dx = b.x - a.x, dy = b.y - a.y;
    for (let k = 0; k < m; k++) {
      const p = L[k], q = L[(k + 1) % m];
      const ex = q.x - p.x, ey = q.y - p.y;
      // Inside is where ex·(y - p.y) - ey·(x - p.x) >= 0.
      const f0 = ex * (a.y - p.y) - ey * (a.x - p.x);
      const df = ex * dy - ey * dx;
      if (Math.abs(df) < 1e-12) { if (f0 < 0) return null; continue; }
      const r = -f0 / df;
      if (df > 0) t0 = Math.max(t0, r); else t1 = Math.min(t1, r);
      if (t0 >= t1) return null;
    }
    return [{ x: a.x + dx * t0, y: a.y + dy * t0 }, { x: a.x + dx * t1, y: a.y + dy * t1 }];
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
    /* Dotted, so the lattice cannot be taken for the tile rules: solid,
       the two differed only by a shade, and at most zooms the cells read
       as squares of the plane. Butt ends, since the round ones the marks
       are painted with would swell every dot into a dash. */
    ctx.save();
    ctx.setLineDash([1, 2]);
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
    ctx.strokeStyle = colour;
    ctx.beginPath();
    const t = tiling();
    for (const [i, j] of frames) {
      const hair = (a, b, c, d) => {
        // Kept to the tile: a tile that is not the square leaves the
        // square's corners to neighbours turned another way.
        const cut = t.square ? [{ x: a, y: b }, { x: c, y: d }] : clipToTile(t, { x: a, y: b }, { x: c, y: d });
        if (!cut) return;
        const p = placeIn(cut[0], i, j), q = placeIn(cut[1], i, j);
        hairLine(p.x, p.y, q.x, q.y);
      };
      latticeLines(n, skip, hair);
    }
    ctx.stroke();
    ctx.restore();
  }

  function latticeLines(n, skip, hair) {
    const cell = T / n;
    /* The tile's own edge is a line of the lattice like any other. It is
       left to the tile rules while those are showing, so the two do not
       stack a blue line over a grey one — but with them off nothing drew
       it at all, and the lattice came out with a gap two cells wide at
       every seam and a run of even cells in between. */
    const first = state.grid && tiling().square ? 1 : 0;

    if (diagGrid()) {
      // Columns and rows both come off the basis, which rounds them to
      // whole numbers of the tile so the lattice meets itself at a seam.
      // n is the level in force; skip says how far it was subdivided, so
      // the basis is built from the count that was picked.
      const { w, h, cols, rows } = isoBasis(n / skip, skip);
      const slope = h / (2 * w);          // half a row to the column
      const climb = cols / 2;             // rows a sloped line gains over the tile
      const drop = (k) => (skip > 1 && ((k % skip) + skip) % skip === 0);
      // Upright: the tile's own columns.
      for (let i = first; i < cols; i++) {
        if (drop(i)) continue;
        hair(i * w, 0, i * w, T);
      }
      // The two thirty degree families, y = ±slope·x + k·h, cut to the tile.
      for (let k = -Math.ceil(climb); k <= rows; k++) {
        if (!drop(k)) clipHair(slope, k * h, hair);
      }
      for (let k = 0; k <= rows + Math.ceil(climb); k++) {
        if (!drop(k)) clipHair(-slope, k * h, hair);
      }
      return;
    }

    for (let i = first; i < n; i++) {
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

  /* A step holds the marks, the warp and the symmetry block together, so
     undo takes an anchor back, or a square of the block turned, as
     readily as a line. All three are replaced rather than changed in
     place, so a step is a copy of a list and two references. */
  const snapshot = () => ({
    shapes: state.shapes.slice(), warp: state.warp, pattern: state.pattern,
  });

  function pushStep() {
    undoStack.push(snapshot());
    if (undoStack.length > 200) undoStack.shift();
    redoStack.length = 0;
  }

  function takeBack(step) {
    state.shapes = step.shapes;
    state.warp = step.warp;
    if (step.pattern !== state.pattern) usePattern(step.pattern);
    if (!state.warp.anchors[warpSel]) warpSel = -1;
    syncWarpPanel();
  }

  function commit(shape) {
    pushStep();
    state.shapes = state.shapes.concat([shape]);
    noteUsed([shape], true);
    afterChange();
  }

  /* `merge` writes over the step already on the stack instead of adding
     one. A slider drag fires an event a pixel; without it a single sweep
     of the alpha would need forty presses of undo to take back. */
  function replaceShapes(next, merge) {
    if (!merge) pushStep();
    noteUsed(changedMarks(state.shapes, next));
    state.shapes = next;
    afterChange();
  }

  /* True while a slider is being dragged, so every write it makes after
     the first folds into that one step. Closed by the control's `change`,
     which covers the mouse coming up and the arrow keys alike. */
  let sliderRun = false;

  /* Opening a drawing, or starting one, is a new session rather than an
     edit: the steps behind it belong to a picture that is no longer on
     the table, so undoing into them would make no sense. */
  function adoptShapes(next) {
    // A caret or a half-drawn mark belongs to the picture being put away.
    cancelDraft();
    undoStack.length = 0;
    redoStack.length = 0;
    state.shapes = next;
    afterChange();
  }

  function undo() {
    cancelDraft();
    select([]);
    if (!undoStack.length) return flash('Nothing to undo');
    redoStack.push(snapshot());
    takeBack(undoStack.pop());
    afterChange();
  }

  function redo() {
    cancelDraft();
    select([]);
    if (!redoStack.length) return flash('Nothing to redo');
    undoStack.push(snapshot());
    takeBack(redoStack.pop());
    afterChange();
  }

  function afterChange() {
    requestDraw();
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
      settleAcross(sh);
      /* A chain of groups is written only where there is more than one, and
         its outermost is the group, whatever the file says. */
      if (Array.isArray(sh.groups)) {
        const chain = sh.groups.filter((g) => Number.isInteger(g) && g > 0);
        if (chain.length > 1) { sh.groups = chain; sh.group = chain[0]; }
        else { delete sh.groups; if (chain.length) sh.group = chain[0]; }
      }
      for (const g of groupsOf(sh)) if (g >= groupSeq) groupSeq = g + 1;
      if (sh.id == null) sh.id = shapeSeq++;
      else if (sh.id >= shapeSeq) shapeSeq = sh.id + 1;
    }
  }

  function newStroke(extra) {
    return Object.assign({
      id: shapeSeq++, layer: 'stroke', width: penWidth(),
    }, inkFor('color'), extra);
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
        /* A grip answers before the marks under it: it sits on the box,
           which is usually over the very mark it belongs to. It is read
           against the square the selection is in, wherever the pointer
           has wandered to. */
        const g = gripAt(w);
        if (g) {
          drawTile = { ...heldFrame() };
          grip = g; hoverGrip = null; requestDraw();
          return true;
        }
        /* A mark that runs past its own square shows on the next one,
           and the ink you are pointing at there is a copy of it at
           coordinates this square knows nothing about. Without looking
           outward, half of a mark straddling a seam could be picked up
           and half could not, depending on which side of the seam the
           click landed — which is the same reach erase and the
           eyedropper have had all along. */
        const hit = hitTest(w, { interior: true, anyTile: true });
        const add = !!(e && (e.shiftKey || e.metaKey || e.ctrlKey));
        // Nothing under the press: drag an area out from it instead.
        if (!hit) {
          lasso = { a: w, b: w, base: add ? picked.slice() : [] };
          if (!add) select([]);
          requestDraw();
          return true;
        }
        /* The copy that was clicked, not one of its twins. `hitTile` is
           the square the ink under the pointer belonged to, which is the
           pointer's own square unless the click landed on ink that has
           run over from a neighbour. Everything from here — the box, the
           grips, and the drag itself — happens there. */
        const home = hitTile ? { i: hitTile.i, j: hitTile.j } : { ...activeTile };
        const from = unplaceIn(placeIn(w, frameTile().i, frameTile().j), home.i, home.j);
        drawTile = home;
        /* Shift adds a mark to what is held, or puts it back down. Any
           copy of it will do: the plane is one tile over and over, so the
           mark under the pointer is the same mark whichever square it was
           clicked in. What is already held keeps the square it was taken
           in, though — the square travels with each unit, so the copy you
           just clicked lights up and the ones already in hand stay where
           they were. */
        if (add) {
          const level = levelFor(hit);
          const unit = new Set(unitOf(hit, level).members);
          const had = picked.some((sh) => unit.has(sh));
          const next = had ? picked.filter((sh) => !unit.has(sh)) : picked.concat([hit]);
          select(next, home, new Map([[hit.id, level]]));
          requestDraw();
          return true;     // a pick, not the start of a move
        }
        /* Pressing on something already held moves the whole armful, and a
           press that comes up without moving goes a group further in — see
           endDraw. Anything else is picked up as far into its groups as the
           hand has already gone around it. */
        const held = heldMarks().includes(hit);
        if (!held) select([hit], home, levelFor(hit));
        requestDraw();
        const members = heldMarks();
        moving = { members, previews: members, base: hit, from, dx: 0, dy: 0, inward: held ? hit : null };
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
        /* Alt at the press grows the circle from its centre. Without
           it the drag runs rim to rim, which is what pulling a circle
           out of nothing reads as, and it puts the two points you place
           on the shape itself rather than one of them in its middle.
           The key is read off the press, not off the tracked flag, so
           it is the state at the moment the circle began that decides. */
        anchor = p;
        fromCentre = !!(e && (e.altKey || e.ctrlKey));
        draft = newStroke({ kind: 'circle', c: p, r: 0, filled: state.filled });
        break;
      case 'rect':
        anchor = p;
        draft = diagGrid()
          ? newStroke({ kind: 'poly', pts: [p, p, p, p], filled: state.filled })
          : newStroke({ kind: 'rect', x: p.x, y: p.y, w: 0, h: 0, filled: state.filled });
        break;
      case 'text': {
        /* A click inside what is being typed moves the caret into it and
           nothing else. Otherwise it sets the letters down: landing on
           text already there it opens that, at the letter pointed at,
           and landing on bare paper it starts again where it fell, so a
           row of labels is click, type, click.

           What is being typed answers for itself here; the mark it came
           from does not, being off the plane until it is set down. */
        if (typing && draft) {
          const live = hitTest(w, { textOnly: true, anyTile: true, extra: draft, skip: typing.was });
          if (live === draft) {
            typing.caret = caretFor(typing, w, { ...(hitTile || activeTile) });
            requestDraw();
            mode = null;
            return true;
          }
        }
        endTyping();
        const on = hitTest(w, { textOnly: true, anyTile: true });
        if (on) openTyping(on, { ...(hitTile || activeTile) }, w);
        else startTyping(p, { ...activeTile });
        mode = null;
        return true;
      }
      case 'fill':
        doFill(w);
        // One click, one deliberate colouring: written down at once, like
        // a mark put down, whether it made an area or recoloured one.
        usedNow();
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
    if (constrain() && diagGrid()) {
      const n = effSub();
      return isoRun(a, w, state.sub || 12, !!n && snapping(), subSkip());
    }
    if (constrain()) {
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

  /* The plane repeats, so a mark dragged a long way off is the same mark
     one period over, and it is brought back towards the home square
     rather than left to wander — measured on the group as a whole, so it
     never comes apart.

     The period is the block, not the tile. Under anything but Translate
     the next square along is turned, and a mark stepped one tile over
     was drawn by that square's turn instead: the picture changed under
     the hand the moment it was let go, and a figure across the seam came
     apart. A whole block over, every square it lands in is turned the
     same as the one it left, so nothing on the plane moves. Of the places
     that leaves, the one kept is the one whose middle is nearest the
     middle of the square — on a block of one, the square itself. */
  function homeShift(shapes) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const sh of shapes) {
      const b = shapeBBox(sh);
      if (!b) continue;
      x0 = Math.min(x0, b.x0); y0 = Math.min(y0, b.y0);
      x1 = Math.max(x1, b.x1); y1 = Math.max(y1, b.y1);
    }
    if (x0 === Infinity) return [0, 0];
    return tiling().homeShift(state.pattern.n, { x: (x0 + x1) / 2, y: (y0 + y1) / 2 });
  }

  /* A mark you just moved should sit above what it was moved onto, so
     it goes to the end of the list. Fills still paint beneath strokes —
     that is what keeps a fill under its own outline — so this puts the
     group on top of the others, not its fill on top of every line. */
  function raise(list, members) {
    const set = new Set(members);
    return list.filter((sh) => !set.has(sh)).concat(members);
  }

  // Moved, then brought home — with how far home was, since the square
  // their selection is shown in has to follow them (`followHome`).
  function moveGroup(shapes, dx, dy) {
    let marks = shapes.map((sh) => translateShape(sh, dx, dy));
    const [hx, hy] = homeShift(marks);
    if (hx || hy) marks = marks.map((sh) => translateShape(sh, hx, hy));
    return { marks, hx, hy };
  }

  function moveGrip(w) {
    // A turn reads the angle off the raw pointer: pulling it onto the
    // lattice first would fight the eighth it is being held to. A pencil
    // stroke's grips read it raw as well: the pencil never touches it.
    const freehand = grip.kind === 'point' && grip.shape.kind === 'path';
    const p = grip.kind === 'turn' || freehand ? w : sp(w);
    if (grip.kind === 'point') {
      grip.previews = [grip.set(p)];
    } else if (grip.kind === 'size') {
      /* One factor, not two: an ellipse is not a shape this can hold.
         It is read off whichever way the box has more room, so a long
         thin selection is sized by its length. The corner opposite is
         the anchor, so the one you are not holding stays where it is. */
      const a = grip.anchor;
      const wasX = grip.from.x - a.x, wasY = grip.from.y - a.y;
      const nowX = p.x - a.x, nowY = p.y - a.y;
      const k = Math.abs(wasX) > Math.abs(wasY) ? nowX / wasX : nowY / wasY;
      grip.factor = clamp(isFinite(k) ? k : 1, 0.02, 40);
      grip.previews = grip.members.map((sh) => scaleShape(sh, a.x, a.y, grip.factor));
    } else {
      const c = grip.centre;
      const was = Math.atan2(grip.from.y - c.y, grip.from.x - c.x);
      let ang = Math.atan2(p.y - c.y, p.x - c.x) - was;
      // A turn snaps like everything else: eighths while snapping is on,
      // any angle at all while it is off — and Shift flips whichever of
      // those you are in, the same as it does everywhere.
      if (snapping()) ang = Math.round(ang / (Math.PI / 4)) * (Math.PI / 4);
      grip.angle = ang;
      grip.previews = grip.members.map((sh) => rotateShape(sh, c.x, c.y, ang));
    }
    setHint(grip.kind === 'size'
      ? `Sizing — ${Math.round(grip.factor * 100)}%`
      : grip.kind === 'turn'
        ? `Turning — ${Math.round((grip.angle * 180) / Math.PI)}° · Shift for any angle`
        : `Moving ${grip.what}`, true);
    requestDraw();
  }

  function endGrip() {
    const g = grip;
    grip = null;
    if (!g || !g.previews) { requestDraw(); return; }
    let next = g.previews;
    const [hx, hy] = homeShift(next);
    if (hx || hy) next = next.map((sh) => translateShape(sh, hx, hy));
    const members = gripMembers(g);
    const swap = new Map(members.map((sh, i) => [sh, next[i]]));
    replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), next));
    select(picked.map((sh) => swap.get(sh) || sh));
    followHome(next, hx, hy);
    setHint(HINTS[state.tool] || HINTS.base);
  }

  function moveDraw(w) {
    if (grip) { moveGrip(w); return; }
    if (lasso) {
      /* A sweep belongs to the square it was started in, like any other
         mark in progress. Left to follow the pointer into the next one
         it was read in that square's frame instead, and the corner it
         was anchored at appeared to jump there with it. It keeps its
         own square, and the box stops at that square's edge rather than
         reaching into a neighbour it cannot pick anything up from. */
      lasso.b = { x: clamp(w.x, 0, T), y: clamp(w.y, 0, T) };
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
      /* A click is not a move. Release comes through here too, and with
         snapping on the anchor was pulled onto the nearest target even
         when the pointer had not moved at all — so clicking a mark to
         pick it up shifted it, and a shift across the square's middle
         sent the lot home a tile away. Until the press has travelled as
         far as a drag must, nothing moves. */
      if (Math.hypot(dx, dy) * state.view.scale < DRAG_MIN) {
        dx = 0;
        dy = 0;
      } else if (snapping()) {
        // Land the mark's own anchor on a target, so dragging both
        // keeps a snapped mark snapped and pulls a stray one into line.
        const a = anchorOf(moving.base);
        const t = snapAt({ x: a.x + dx, y: a.y + dy });
        if (t) { dx = t.x - a.x; dy = t.y - a.y; }
      }
      moving.dx = dx;
      moving.dy = dy;
      const g = dx || dy ? moveGroup(moving.members, dx, dy) : { marks: moving.members, hx: 0, hy: 0 };
      moving.previews = g.marks;
      moving.home = [g.hx, g.hy];
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
        let b = snapping() ? snapAt(w) || w : w;
        let pts = isoRhombus(anchor, b, state.sub || 12, subSkip());
        if (constrain() && pts.length === 4) {
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
        if (constrain()) {
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
        if (!fromCentre) {
          // Rim to rim: the press and the cursor are the two ends of a
          // diameter, so both land on the circle and the centre falls
          // where it must. Either end may snap like any other point.
          const b = sp(w);
          draft.c = { x: (anchor.x + b.x) / 2, y: (anchor.y + b.y) / 2 };
          draft.r = dist(anchor, b) / 2;
          break;
        }
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
        } else if (snapping()) {
          // Snapping asked for, with no lattice to give it: a coarse step
          // of its own is better than nothing to land on.
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

  function commitLive(dragged) {
    const d = draft;
    draft = null;
    pending = null;
    setHint(HINTS[state.tool] || HINTS.base);
    if (!d) return;
    if (tooSmall(d)) { requestDraw(); return; }
    commit(d);

    // The line tool carries on from where it stopped, so a run of clicks
    // draws a chain. Clicking the same point twice ends it, as does Esc.
    if (state.tool === 'line' && d.kind === 'line' && !dragged) {
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

  function endDraw(dragged) {
    if (grip) { endGrip(); return; }
    if (lasso) { endLasso(); return; }
    if (moving) {
      const m = moving;
      moving = null;
      if (m.dx || m.dy) {
        const swap = new Map(m.members.map((sh, k) => [sh, m.previews[k]]));
        replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), m.previews));
        select(picked.map((sh) => swap.get(sh) || sh));
        if (m.home) followHome(m.previews, m.home[0], m.home[1]);
      } else if (m.inward && !dragged) {
        goInto(m.inward);
      }
      requestDraw();
      return;
    }
    if (!draft) return;

    // Freehand always ends on release. Every other mark can be drawn
    // either way: clicked out corner to corner, or dragged in one go.
    if (draft.kind === 'path') {
      /* Freehand comes in jittery; smooth it before it is kept — unless
         Ctrl or Alt is down as it is let go, which keeps every point the
         hand laid. Read at the release rather than the press, so it can
         be decided with the stroke already down. */
      if (!constrain() && state.smooth > 0) {
        /* Smooth sets how far along the stroke the easing reaches, on the
           screen: about two pixels at 25, which takes out the jitter of a
           hand, and sixteen at 100, which evens out a broad wobble. At
           nothing, nothing is touched. */
        const radius = 16 * Math.pow(state.smooth / 100, 1.5);
        draft.pts = smoothPath(draft.pts, (0.5 + 0.35 * radius) / state.view.scale, radius / state.view.scale);
      }
      commitLive();
      return;
    }
    if (dragged) {
      // An arc still owes its bend, so a drag sets the chord and hands
      // it on to be bent — the same second step the clicked-out arc has.
      if (draft.kind === 'curve' && !tooSmall(draft)) {
        pending = 'bend';
        setHint(BEND_HINT, true);
        requestDraw();
        return;
      }
      commitLive(true);
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
    const m = constrain() ? bisectorFoot(draft.a, draft.b, w) : sp(w);
    draft.c = quadThrough(draft.a, draft.b, m);
    requestDraw();
  }

  function cancelDraft() {
    if (!draft && !pending && !moving && !grip && !warpDrag && !typing) return false;
    warpDrag = null;
    canvas.classList.remove('panning');
    draft = null;
    pending = null;
    moving = null;
    grip = null;
    // Dropped, not set down: what was typed goes with the draft it was.
    typing = null;
    typeDirty = false;
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

  /* Groups nest. A mark carries the chain of groups it sits in, outermost
     first: `group` is the outermost, as it always was, and `groups` the
     whole chain wherever there is more than one. Grouping a group with
     something else puts it inside the new group whole rather than melting
     it in, and ungrouping takes off one level. */
  function groupsOf(sh) {
    return sh.groups && sh.groups.length ? sh.groups : sh.group ? [sh.group] : [];
  }

  // A copy of a mark in this chain of groups, written the short way.
  function withGroups(sh, chain) {
    const out = Object.assign({}, sh);
    delete out.groups;
    delete out.group;
    if (chain.length) out.group = chain[0];
    if (chain.length > 1) out.groups = chain;
    return out;
  }

  /* What is held, unit by unit. A mark is picked up at a depth among its
     groups: at 0 it holds the whole of its outermost group, at 1 the group
     inside that, and so on, and past its last group it holds itself — which
     is how a click on something held goes a group further in. A unit that
     sits inside another unit held is part of that one, not a unit too. */
  let pickDepth = new Map();     // mark id -> how far into its groups it was picked
  let heldMemo = null;

  function unitOf(sh, depth) {
    const chain = groupsOf(sh);
    const d = Math.min(depth == null ? pickDepth.get(sh.id) || 0 : depth, chain.length);
    if (d === chain.length) return { key: `i${sh.id}`, group: null, depth: d, chain, members: [sh] };
    const id = chain[d];
    return {
      key: `g${id}`, group: id, depth: d, chain,
      members: state.shapes.filter((s) => groupsOf(s)[d] === id),
    };
  }

  function heldUnits() {
    if (heldMemo && heldMemo.picked === picked && heldMemo.shapes === state.shapes
        && heldMemo.depths === pickDepth) return heldMemo.units;
    const found = new Map();
    for (const sh of picked) {
      const u = unitOf(sh);
      if (!found.has(u.key)) found.set(u.key, u);
    }
    // Where a unit sits: its chain down to itself.
    const reach = (u) => (u.group == null ? u.chain.concat([`i${u.members[0].id}`]) : u.chain.slice(0, u.depth + 1));
    const all = [...found.values()];
    const units = all.filter((u) => {
      const e = reach(u);
      return !all.some((v) => {
        const f = reach(v);
        return v !== u && f.length < e.length && f.every((id, k) => e[k] === id);
      });
    });
    const byId = new Map();
    const marks = [];
    for (const u of units) {
      for (const m of u.members) {
        if (byId.has(m.id)) continue;
        byId.set(m.id, u.key);
        marks.push(m);
      }
    }
    heldMemo = { picked, shapes: state.shapes, depths: pickDepth, units, byId, marks };
    return units;
  }

  /* Holding one member of a group holds the group: what is outlined is
     what will move, recolour or go. */
  function heldMarks() {
    heldUnits();
    return heldMemo.marks.slice();
  }

  /* How far into its groups a mark is picked up: as far as the hand has
     already gone into the groups around it. Holding something inside a
     group, a click on another member of that group holds that member, not
     the whole group over again. */
  function levelFor(hit) {
    const chain = groupsOf(hit);
    let level = 0;
    for (const u of heldUnits()) {
      let k = 0;
      while (k < u.depth && k < chain.length && u.chain[k] === chain[k]) k++;
      if (k > level) level = k;
    }
    return level;
  }

  /* A click on something already held goes one group further in: to the
     group inside it that the pointer is over, or, with no group left, to
     the mark itself. */
  function goInto(hit) {
    const u = heldUnits().find((unit) => unit.members.includes(hit));
    if (!u || u.group == null) return;
    select([hit], pickedAt.get(u.key), u.depth + 1);
    const inner = heldUnits()[0];
    flash(inner && inner.group != null
      ? `Inside the group — ${inner.members.length} marks held`
      : 'Inside the group — one mark held');
    requestDraw();
  }

  /* A selection belongs to the square it was taken in, and stays there.
     The plane is one tile repeated, so every mark is on screen many times
     over; the box used to be drawn in whichever square the pointer
     happened to be over, which meant clicking one copy lit up another,
     and carrying the pointer across a seam threw the box to the copy in
     the next square. Neither is anything the drawing did. */
  /* The square is remembered per unit, not for the selection as a whole:
     picking up a second mark in another square should light up the copy
     that was clicked, and leave the first where it was. Keyed by the
     unit's id rather than the object, since every edit hands back fresh
     objects and the squares have to survive that. */
  let pickedAt = new Map();
  // The unit a held mark is held as — found by id, so the moving copies of
  // a mark part way through a drag answer to it as well.
  const unitKey = (sh) => {
    heldUnits();
    return heldMemo.byId.get(sh.id) || (sh.group ? `g${sh.group}` : `i${sh.id}`);
  };

  /* `depth` says how far into its groups each mark picked goes: one number
     for them all, or a map by id. A mark held already keeps the depth it
     had; anything else starts at its outermost group. */
  function select(list, tile, depth) {
    // A sweep over marks already in hand should not hold them twice.
    picked = [...new Set((list || []).filter(Boolean))];
    const depths = new Map();
    for (const sh of picked) {
      const d = depth instanceof Map ? depth.get(sh.id) : depth;
      depths.set(sh.id, d != null ? d : pickDepth.get(sh.id) || 0);
    }
    pickDepth = depths;
    if (!picked.length) { pickedAt = new Map(); syncEditButtons(); return; }
    const at = tile ? { i: tile.i, j: tile.j } : null;
    const next = new Map();
    for (const u of heldUnits()) {
      // Where it already was; failing that where this click landed;
      // failing that alongside whatever else is in hand.
      next.set(u.key, pickedAt.get(u.key) || at || firstAt() || { ...frameTile() });
    }
    pickedAt = next;
    syncEditButtons();
  }

  const firstAt = () => {
    for (const v of pickedAt.values()) return v;
    return null;
  };

  /* Bringing marks home moves them a whole block. That looks the same
     everywhere on the plane but in the one square their selection is
     shown in: there they have just gone a block away, and the box and
     grips went with them — off the copy in hand and onto one a block
     along. So that square moves the same distance the other way, onto a
     square turned just like it that is showing the copy the hand is on.
     A drag brings its marks home as it goes, so while one is under way
     the square follows it here, and it is written down on letting go. */
  function squareShifted(at, hx, hy) {
    if (!hx && !hy) return at;
    const o = placeIn({ x: 0, y: 0 }, at.i, at.j);
    const p = placeIn({ x: hx, y: hy }, at.i, at.j);
    return tiling().shifted(at, o.x - p.x, o.y - p.y);
  }

  function followHome(marks, hx, hy) {
    if (!hx && !hy) return;
    for (const k of new Set(marks.map(unitKey))) {
      const at = pickedAt.get(k);
      if (at) pickedAt.set(k, squareShifted(at, hx, hy));
    }
  }

  const movingFrame = (at) => (moving && moving.home ? squareShifted(at, ...moving.home) : at);

  // The square a mark is being shown in.
  const unitFrame = (sh) => movingFrame(pickedAt.get(unitKey(sh)) || frameTile());

  // The selection's home: where the first thing picked up still sits. The
  // grips work on the marks themselves, which are one tile's worth however
  // many squares their copies are being shown in, so they are drawn here.
  const heldFrame = () => movingFrame(firstAt() || frameTile());

  function syncEditButtons() {
    syncAcross();
    const g = document.getElementById('groupBtn');
    const u = document.getElementById('ungroupBtn');
    if (!g || !u) return;
    const marks = heldMarks();
    // Two things to bind means two units, not two marks: a group is one.
    const units = heldUnits();
    g.disabled = units.length < 2;
    u.disabled = !units.some((unit) => unit.group != null);
    for (const id of ['turnLeftBtn', 'turnRightBtn', 'flipXBtn', 'flipYBtn']) {
      document.getElementById(id).disabled = !marks.length;
    }
    // Up and to the top apply together, as do down and to the bottom:
    // anything that can go to the top has something directly above it.
    const rise = marks.length > 0 && !!restacked(marks, 'up');
    const sink = marks.length > 0 && !!restacked(marks, 'down');
    document.getElementById('upOneBtn').disabled = !rise;
    document.getElementById('toTopBtn').disabled = !rise;
    document.getElementById('downOneBtn').disabled = !sink;
    document.getElementById('toBottomBtn').disabled = !sink;
    document.getElementById('cutBtn').disabled = !marks.length;
    document.getElementById('copyBtn').disabled = !marks.length;
    document.getElementById('pasteBtn').disabled = !clipboard.length;
  }

  /* Binding marks together. A group moves, recolours and goes as one
     thing; a fill made against several marks is grouped with them
     automatically, and these two do the same by hand. */
  function groupPicked() {
    const units = heldUnits();
    if (units.length < 2) return flash('Hold two things — Shift-click to add to what you have');
    /* The new group goes where the things held sit together: inside every
       group they share, and round each of them whole. A unit held from
       deeper in comes out of the groups in between, so no group is left
       half inside the new one and half out of it. */
    let common = units[0].chain.slice(0, units[0].depth);
    for (const u of units) {
      let k = 0;
      while (k < common.length && k < u.depth && common[k] === u.chain[k]) k++;
      common = common.slice(0, k);
    }
    const gid = groupSeq++;
    const below = new Map();     // mark -> the chain it keeps inside the new group
    for (const u of units) for (const m of u.members) below.set(m, groupsOf(m).slice(u.depth));
    const swap = new Map();
    const next = state.shapes.map((sh) => {
      if (!below.has(sh)) return sh;
      const copy = withGroups(sh, common.concat([gid], below.get(sh)));
      swap.set(sh, copy);
      return copy;
    });
    replaceShapes(next);
    // What is held now is the new group.
    select(picked.map((sh) => swap.get(sh) || sh), null, common.length);
    flash(`${below.size} marks grouped`);
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
    followHome(turned, hx, hy);
    flash(`Turned 45° ${eighths > 0 ? 'clockwise' : 'anticlockwise'}`);
  }

  /* Turning over what is in hand, about the middle of what it makes
     together — so a figure mirrors as one thing rather than each mark
     flipping on its own spot and the figure coming apart. */
  function flipHeld(axis) {
    const marks = heldMarks();
    if (!marks.length) return flash('Nothing in hand to flip');
    const box = heldBox(marks);
    if (!box) return flash('Nothing in hand to flip');
    const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
    let flipped = marks.map((sh) => flipShape(sh, cx, cy, axis));
    const [hx, hy] = homeShift(flipped);
    if (hx || hy) flipped = flipped.map((sh) => translateShape(sh, hx, hy));
    const swap = new Map(marks.map((sh, k) => [sh, flipped[k]]));
    replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), flipped));
    select(picked.map((sh) => swap.get(sh) || sh));
    followHome(flipped, hx, hy);
    flash(axis === 'x' ? 'Flipped left to right' : 'Flipped top to bottom');
  }

  /* Depth, a step at a time or all the way. What gets stacked is what the
     plane paints as one — a group, or a fill with the borders it holds —
     so a figure goes up or down whole, and a step passes one other thing
     however many marks that thing is made of. Fills in no group are the
     ground, with a stack of their own: they reorder among themselves and
     never come up through a mark. The list is laid back out in the order
     it paints, which is the order a click looks for things in as well. */
  const RESTACKED = {
    top: 'Brought to the top', up: 'Brought up one',
    down: 'Sent down one', bottom: 'Sent to the bottom',
  };

  // One stack reordered, or null where nothing in it would move.
  function shiftStack(stack, held, how) {
    const mine = stack.map((u) => u.some((s) => held.has(s)));
    let order = stack.map((u, k) => k);
    if (how === 'top' || how === 'bottom') {
      const going = order.filter((k) => mine[k]);
      const staying = order.filter((k) => !mine[k]);
      order = how === 'top' ? staying.concat(going) : going.concat(staying);
    } else {
      /* Walked from the end it is heading for, so things held side by
         side each pass the same one and arrive side by side, rather than
         the first to move stepping into the way of the next. */
      const d = how === 'up' ? 1 : -1;
      for (let k = d > 0 ? order.length - 2 : 1; k >= 0 && k < order.length; k -= d) {
        if (mine[order[k]] && !mine[order[k + d]]) {
          [order[k], order[k + d]] = [order[k + d], order[k]];
        }
      }
    }
    return order.some((v, k) => v !== k) ? order.map((k) => stack[k]) : null;
  }

  function restacked(marks, how) {
    const held = new Set(marks);
    const { ground, units } = paintUnits(state.shapes);
    const floor = ground.map((s) => [s]);
    const lower = shiftStack(floor, held, how);
    const upper = shiftStack(units, held, how);
    if (!lower && !upper) return null;
    return [...(lower || floor), ...(upper || units)].flat();
  }

  function restackHeld(how) {
    const marks = heldMarks();
    if (!marks.length) return flash('Nothing in hand to restack');
    const next = restacked(marks, how);
    if (!next) return flash(how === 'top' || how === 'up' ? 'Already at the top' : 'Already at the bottom');
    replaceShapes(next);
    flash(RESTACKED[how]);
  }

  // One level off: the group held comes undone, and whatever was inside it
  // — marks, or groups of their own — is left as it was.
  function ungroupPicked() {
    const units = heldUnits().filter((u) => u.group != null);
    if (!units.length) return flash('Nothing grouped in what you are holding');
    const undone = new Map();    // mark -> the group taken off it
    for (const u of units) for (const m of u.members) undone.set(m, u.group);
    const swap = new Map();
    const next = state.shapes.map((sh) => {
      if (!undone.has(sh)) return sh;
      const copy = withGroups(sh, groupsOf(sh).filter((id) => id !== undone.get(sh)));
      swap.set(sh, copy);
      return copy;
    });
    replaceShapes(next);
    select(picked.map((sh) => swap.get(sh) || sh));
    flash(`${undone.size} marks let loose`);
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
    return '{\n "format": "tesselate-marks",\n "version": 1,\n "marks": [\n'
      + marks.map((sh) => '  ' + JSON.stringify(sh)).join(',\n') + '\n ]\n}\n';
  }

  /* Whether a mark read from outside — a file, the clipboard, storage —
     can be put on the table. A picture has to carry its own pixels as a
     data URL: one pointing anywhere else would be fetched, and a picture
     from another site taints the canvas, which stops the PNG export and
     the eyedropper dead. */
  function soundMark(sh) {
    if (!sh || !sh.kind) return false;
    if (sh.kind !== 'image') return true;
    return typeof sh.src === 'string' && /^data:image\/(png|jpeg|gif|webp|svg\+xml)[;,]/.test(sh.src)
      && Array.isArray(sh.pts) && sh.pts.length === 4
      && sh.pts.every((p) => p && Number.isFinite(p.x) && Number.isFinite(p.y))
      && sh.iw > 0 && sh.ih > 0;
  }

  function marksFromText(text) {
    let d = null;
    try { d = JSON.parse(text); } catch (err) { return null; }
    const list = d && (Array.isArray(d.marks) ? d.marks : Array.isArray(d.shapes) ? d.shapes : null);
    if (!list) return null;
    const marks = list.filter(soundMark);
    marks.forEach(settleAcross);
    return marks.length ? marks : null;
  }

  /* Fresh ids all round. A pasted group stays a group without joining a
     group already on the tile, and a pasted fill goes on naming the
     borders it came with rather than whichever marks hold those ids now. */
  /* `keep` says how many of a mark's outer groups its copy stays in — a
     duplicate made inside a group stays inside it — and every group below
     those is made afresh for the copies. */
  function reseat(marks, keep) {
    const ids = new Map();
    const groups = new Map();
    const out = marks.map((sh) => {
      const k = keep ? keep(sh) : 0;
      const chain = groupsOf(sh).map((g, i) => {
        if (i < k) return g;
        if (!groups.has(g)) groups.set(g, groupSeq++);
        return groups.get(g);
      });
      const copy = withGroups(sh, chain);
      ids.set(sh.id, shapeSeq);
      copy.id = shapeSeq++;
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
    const step = pasteStep() * pasteRun;
    const fresh = moveGroup(reseat(marks), step, step).marks;
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

  /* ---- pictures in ----
     A PNG or an SVG on the clipboard, or dropped on the plane, comes in as
     a picture mark: held, in the Select tool, so it can be moved, sized by
     its corners and turned by the ring at once. It is kept in the drawing
     as a data URL — in the file, the undo stack, the clipboard copy of it
     — so it goes wherever the drawing goes and needs nothing beside it.

     An SVG is kept as SVG, so it stays sharp however far in it is looked
     at. Anything else raster is kept as it came unless it is bigger than
     there is any use for, or heavier than the drawing can carry: the
     drawing is kept in the browser's own storage as it goes, which holds
     a few megabytes all told, and one photograph pasted as it came would
     fill it, so that nothing after it was kept. Such a picture is drawn
     down to PICTURE_MAX on its longer side and written again to fit
     PICTURE_CHARS — as WebP where the browser can write it and the
     picture has any transparency, as JPEG where it has none, a step
     smaller each time until it fits. */
  const PICTURE_MAX = 2048;       // longest side a raster is kept at, in its own pixels
  const PICTURE_CHARS = 1.5e6;    // the most a picture's data URL may run to
  const PICTURE_FIT = 0.6;        // of the tile, the longer side a picture lands at

  const SVG_TEXT = /^\s*(<\?xml[^>]*>\s*)?(<!--[\s\S]*?-->\s*)*(<!DOCTYPE[^>]*>\s*)?<svg[\s>]/i;

  const readAsUrl = (blob) => new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });

  const decoded = (src) => new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('not a picture'));
    img.src = src;
  });

  /* SVG text as a picture. It is given a width and a height of its own —
     from its viewBox where it has one — since without them an SVG has no
     size to be drawn at, and some browsers will not draw it at all. Its
     scripts go: a picture drawn from a data URL never runs them, but the
     file is written back out in the SVG export, and there is no call for
     them there either. */
  async function pictureFromSvg(text) {
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const root = doc.documentElement;
    if (!root || root.nodeName.toLowerCase() !== 'svg' || doc.querySelector('parsererror')) return null;
    for (const el of root.querySelectorAll('script, foreignObject')) el.remove();
    for (const el of [root, ...root.querySelectorAll('*')]) {
      for (const a of [...el.attributes]) if (/^on/i.test(a.name)) el.removeAttribute(a.name);
    }
    const num = (v) => {
      const m = /^\s*([\d.]+)\s*(px)?\s*$/.exec(v || '');
      return m ? +m[1] : 0;
    };
    const vb = (root.getAttribute('viewBox') || '').trim().split(/[\s,]+/).map(Number);
    let w = num(root.getAttribute('width')), h = num(root.getAttribute('height'));
    const hasBox = vb.length === 4 && vb[2] > 0 && vb[3] > 0;
    if (!(w && h)) {
      if (hasBox) {
        // One side given keeps the box's proportions for the other.
        if (w) h = (w * vb[3]) / vb[2];
        else if (h) w = (h * vb[2]) / vb[3];
        else { w = vb[2]; h = vb[3]; }
      } else { w = w || 300; h = h || 150; }
    }
    root.setAttribute('width', w);
    root.setAttribute('height', h);
    if (!root.getAttribute('xmlns')) root.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const out = new XMLSerializer().serializeToString(root);
    const bytes = new TextEncoder().encode(out);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    const src = 'data:image/svg+xml;base64,' + btoa(bin);
    await decoded(src);
    return { src, iw: w, ih: h };
  }

  async function pictureFromBlob(blob) {
    if (blob.type === 'image/svg+xml') return pictureFromSvg(await blob.text());
    const src = await readAsUrl(blob);
    const img = await decoded(src);
    const w = img.naturalWidth, h = img.naturalHeight;
    if (!w || !h) return null;
    let k = Math.min(1, PICTURE_MAX / Math.max(w, h));
    if (k === 1 && src.length <= PICTURE_CHARS && /^data:image\/(png|jpeg|gif|webp)[;,]/.test(src)) {
      return { src, iw: w, ih: h };
    }
    const c = document.createElement('canvas');
    const g = c.getContext('2d', { willReadFrequently: true });
    const draw = () => {
      c.width = Math.max(1, Math.round(w * k));
      c.height = Math.max(1, Math.round(h * k));
      g.imageSmoothingQuality = 'high';
      g.drawImage(img, 0, 0, c.width, c.height);
    };
    draw();
    // Any pixel short of opaque, and the picture needs its alpha kept.
    const px = g.getImageData(0, 0, c.width, c.height).data;
    let clear = false;
    for (let i = 3; i < px.length; i += 4) if (px[i] < 255) { clear = true; break; }
    const write = () => {
      const png = c.toDataURL('image/png');
      if (png.length <= PICTURE_CHARS) return png;
      if (!clear) return c.toDataURL('image/jpeg', 0.9);
      const webp = c.toDataURL('image/webp', 0.9);
      // A browser that cannot write WebP hands back a PNG instead.
      return webp.startsWith('data:image/webp') ? webp : png;
    };
    let out = write();
    while (out.length > PICTURE_CHARS && Math.max(c.width, c.height) > 256) {
      k *= 0.75;
      draw();
      out = write();
    }
    return { src: out, iw: c.width, ih: c.height };
  }

  /* Lands upright on the screen, in the middle of the view, in whichever
     tile is there — its corners taken back into that tile's own frame, so
     in a turned tile it is the mark that is turned, not the picture as
     you see it. */
  function placePicture(pic) {
    cancelDraft();
    const w0 = toWorld(cw / 2, ch / 2);
    const tile = cellOf(w0);
    const side = PICTURE_FIT * T * state.view.scale;
    const k = side / Math.max(pic.iw, pic.ih);
    const hw = (pic.iw * k) / 2, hh = (pic.ih * k) / 2;
    const pts = [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]
      .map(([dx, dy]) => unplaceIn(toWorld(cw / 2 + dx, ch / 2 + dy), tile.i, tile.j));
    const mark = {
      id: shapeSeq++, kind: 'image', layer: 'stroke', filled: true, width: 0,
      pts, src: pic.src, iw: pic.iw, ih: pic.ih,
    };
    setTool('select');
    replaceShapes(state.shapes.concat([mark]));
    select([mark], tile);
    flash('Picture placed — drag to move it, a corner to size it, the ring beside one to turn it');
  }

  async function takePicture(what) {
    try {
      const pic = typeof what === 'string' ? await pictureFromSvg(what) : await pictureFromBlob(what);
      if (!pic) return flash('That is not a picture this can read');
      placePicture(pic);
    } catch (err) {
      flash('That picture could not be read');
    }
  }

  // A picture on a paste or a drop, if there is one: a file first, then SVG as text.
  function pictureIn(data) {
    if (!data) return null;
    for (const f of data.files || []) if (/^image\//.test(f.type)) return f;
    for (const item of data.items || []) {
      if (item.kind === 'file' && /^image\//.test(item.type)) {
        const f = item.getAsFile();
        if (f) return f;
      }
    }
    const text = data.getData ? data.getData('text/plain') : '';
    return SVG_TEXT.test(text) ? text : null;
  }

  canvas.addEventListener('dragover', (e) => {
    if (e.dataTransfer && [...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
    }
  });
  canvas.addEventListener('drop', (e) => {
    const pic = pictureIn(e.dataTransfer);
    if (!pic) return;
    e.preventDefault();
    takePicture(pic);
  });

  document.addEventListener('paste', (e) => {
    if (inField(e.target)) return;
    e.preventDefault();
    // The browser did raise it for ⌘V, so the key need not paste for it —
    // or it came too late, after the key already had.
    if (pasteWait) { clearTimeout(pasteWait); pasteWait = 0; }
    else if (performance.now() - pastedByKeyAt < 1500) return;
    const pic = pictureIn(e.clipboardData);
    if (pic) return takePicture(pic);
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

  /* How far a paste steps from what it copied: a cell of
     the lattice while snapping to one — and with no lattice showing there
     is no cell, so the ordinary step, rather than a whole tile over a cell
     of nothing. */
  const pasteStep = () => (snapping() && state.sub ? T / effSub() : 40);

  /* ⌘V is left to the browser, whose paste event hands the clipboard over
     without asking. Where none comes — a page with nothing editable on it,
     in some browsers — the clipboard is asked for outright, which may ask
     the user first, and failing that the last copy made here is pasted. */
  let pasteWait = 0;
  let pastedByKeyAt = -Infinity;

  function pasteByKey() {
    clearTimeout(pasteWait);
    pasteWait = setTimeout(() => {
      pasteWait = 0;
      pastedByKeyAt = performance.now();
      // A picture on the clipboard, where it can be asked for.
      const image = navigator.clipboard && navigator.clipboard.read
        ? navigator.clipboard.read().then(async (items) => {
          for (const item of items) {
            const type = item.types.find((t) => /^image\//.test(t));
            if (type) return item.getType(type);
          }
          return null;
        }).catch(() => null)
        : Promise.resolve(null);
      image.then((blob) => {
        if (blob) return takePicture(blob);
        const read = navigator.clipboard && navigator.clipboard.readText
          ? navigator.clipboard.readText()
          : Promise.reject(new Error('no clipboard to read'));
        read.then((text) => (SVG_TEXT.test(text) ? takePicture(text) : pasteMarks(marksFromText(text) || clipboard)),
          () => pasteMarks(clipboard));
      });
    }, 80);
  }

  /* A copy of what is held, a little to the right of it and below, held in
     its place — without going near the clipboard, so whatever was copied
     last is still there to paste. Right and below as the screen has them:
     the step is measured there, from the middle of what is held, and taken
     back into the drawing through the square the selection is shown in.
     Stepped along the tile's own axes, a copy in a turned square went up or
     left instead, and the 45° plane or a warp would each send it another
     way again. Duplicating again copies the copy, a little further on. */
  const DUP_PX = 16;

  function duplicateHeld() {
    const marks = heldMarks();
    const box = heldBox(marks);
    if (!box) return flash('Nothing in hand to duplicate');
    const f = heldFrame();
    const c = { x: (box.x0 + box.x1) / 2, y: (box.y0 + box.y1) / 2 };
    const w = placeIn(c, f.i, f.j);
    const s = w2s(w.x, w.y);
    const to = unplaceIn(toWorld(s.x + DUP_PX, s.y + DUP_PX), f.i, f.j);
    // Made inside a group, the copy stays in it, held as far in.
    const depthOf = new Map();
    for (const u of heldUnits()) for (const m of u.members) depthOf.set(m.id, u.depth);
    const copies = reseat(marks, (sh) => depthOf.get(sh.id) || 0);
    const { marks: fresh, hx, hy } = moveGroup(copies, to.x - c.x, to.y - c.y);
    replaceShapes(raise(state.shapes.concat(fresh), fresh));
    select(fresh, null, new Map(fresh.map((sh, k) => [sh.id, depthOf.get(marks[k].id) || 0])));
    // Brought home a block, the copy takes its selection with it.
    followHome(fresh, hx, hy);
    flash(`${fresh.length} ${fresh.length === 1 ? 'mark' : 'marks'} duplicated`);
  }

  /* Topmost mark under the point. Outlines are tested first so a line
     lying across a filled area still wins. `interior` adds a final
     pass through the middle of unfilled closed shapes, which is what
     you want when picking something up but not when rubbing it out. */
  /* A mark may run past its own square and show on its neighbours — so
     the ink under the cursor can belong to a neighbour's copy of it, at
     coordinates this square knows nothing about. That
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
    const passes = o.textOnly ? ['type']
      : o.fillsOnly ? ['fill']
      : o.strokesOnly ? ['edge', 'interior']
      : o.interior ? ['edge', 'interior', 'fill', 'inside']
      : ['edge', 'interior', 'fill'];
    /* Fills answer in the order they are painted, so the one found is the
       one that can be seen. A fill in no group is the ground and paints
       under every figure wherever it sits in the list — and asked in list
       order, a ground laid after a figure answered for a click in the
       middle of the figure. */
    const fills = passes.includes('fill')
      ? paintOrder(state.shapes).filter((s) => s.layer === 'fill')
      : null;

    /* Where to look. This square first; then, with `anyTile`, outward
       from it — because a mark may run past its own square and, with
       show on their neighbours, so the ink under the cursor can belong
       to a neighbour's copy at coordinates this square knows nothing
       about. That ink was untouchable: the tool looked only where this
       square would have drawn the mark, found nothing, and did nothing.
       Each pass is tried in every square before the next begins, so a
       border anywhere beats a fill here — which is the order they are
       painted in, and so the order they are seen in. */
    hitTile = drawTile || activeTile;
    const home = hitTile;
    const spots = [{ q: p, i: home.i, j: home.j }];
    if (o.anyTile) {
      const pad = Math.min(overhang(state.shapes), 2);
      if (pad) {
        const world = placeIn(p, home.i, home.j);
        for (const { i, j } of around(home.i, home.j, pad).slice(1)) {
          spots.push({ q: unplaceIn(world, i, j), i, j });
        }
      }
    }

    for (const pass of passes) {
      for (const spot of spots) {
        const hit = hitPass(spot.q, o, pass, fills);
        // Which square's copy of it was under the pointer, so a click can
        // light up the one that was clicked rather than one of its twins.
        if (hit) { hitTile = { i: spot.i, j: spot.j }; return hit; }
      }
    }
    return null;
  }

  function hitPass(p, o, pass, fills) {
    // Never under two units — until two units is more than 16 pixels,
    // which close in would reach marks nowhere near the pointer.
    const tol = Math.max(7 / state.view.scale, Math.min(2, 16 / state.view.scale));
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    let hit = null;
    const list = pass === 'fill' && fills ? fills
      : pass === 'type' && o.extra ? state.shapes.concat([o.extra])
      : state.shapes;
    for (let k = list.length - 1; k >= 0; k--) {
      const s = list[k];
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
      } else if (pass === 'type') {
        /* Text answers for the block its words fill, not for the ink of
           the letters: a letter is mostly the paper between its strokes,
           and hunting for a stem to land on is no way to get at a word.
           Asked from the top down, the nearest to hand answers. */
        if (s === o.skip || (!s.type && s !== o.extra)) continue;
        const b = shapeBBox(s);
        if (b && p.x >= b.x0 && p.x <= b.x1 && p.y >= b.y0 && p.y <= b.y1) { hit = s; break; }
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

  /* The cells of the scratch grid that are the tile's own, grown by a
     couple of cells, for a tile that is not the square. The same every
     time for the same grid, so kept. */
  let domainFor = { sig: '', dom: null };
  function tileDomain(t, R, k, ox, oy) {
    const sig = `${t.id}:${R}:${k}:${ox}:${oy}`;
    if (domainFor.sig === sig) return domainFor.dom;
    const dom = new Uint8Array(R * R);
    const g = 2.5 / k;
    for (let y = 0; y < R; y++) {
      for (let x = 0; x < R; x++) {
        if (t.inside({ x: (x + 0.5) / k + ox, y: (y + 0.5) / k + oy }, g)) dom[y * R + x] = 1;
      }
    }
    domainFor = { sig, dom };
    return dom;
  }

  /* The flooded area on the tile's own cells: does it reach the rim of
     them anywhere, and does it reach every edge of the tile? The second
     is what says it is the ground the marks sit on. */
  function domainHit(t, m, dom, R, k, ox, oy) {
    let any = false;
    for (let y = 0; y < R && !any; y++) {
      for (let x = 0; x < R; x++) {
        const i = y * R + x;
        if (!m[i]) continue;
        if (x === 0 || y === 0 || x === R - 1 || y === R - 1
          || !dom[i - 1] || !dom[i + 1] || !dom[i - R] || !dom[i + R]) { any = true; break; }
      }
    }
    const L = t.outline;
    const c = t.c0;
    const all = L.every((a, e) => {
      const b = L[(e + 1) % L.length];
      for (let s = 1; s < 24; s++) {
        const f = s / 24;
        let x = a.x + (b.x - a.x) * f, y = a.y + (b.y - a.y) * f;
        // A few cells in from the edge, towards the middle.
        const dx = c.x - x, dy = c.y - y, len = Math.hypot(dx, dy);
        x += (dx / len) * (3 / k); y += (dy / len) * (3 / k);
        const gx = Math.floor((x - ox) * k), gy = Math.floor((y - oy) * k);
        if (gx >= 0 && gy >= 0 && gx < R && gy < R && m[gy * R + gx]) return true;
      }
      return false;
    });
    return { any, all };
  }

  /* A ring cut to a convex outline (Sutherland–Hodgman). A ring that
     was a hole stays one: the part of it inside the outline keeps the
     way it runs. */
  function clipLoop(loop, outline) {
    let out = loop;
    const m = outline.length;
    for (let e = 0; e < m && out.length; e++) {
      const p = outline[e], q = outline[(e + 1) % m];
      const ex = q.x - p.x, ey = q.y - p.y;
      const side = (v) => ex * (v.y - p.y) - ey * (v.x - p.x);
      const next = [];
      for (let i = 0; i < out.length; i++) {
        const a = out[i], b = out[(i + 1) % out.length];
        const sa = side(a), sb = side(b);
        if (sa >= 0) next.push(a);
        if ((sa >= 0) !== (sb >= 0)) {
          const f = sa / (sa - sb);
          next.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f });
        }
      }
      out = next;
    }
    return out;
  }

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
    if (shape.kind === 'image') return flash('A picture takes no ink');
    if (wears(shape, 'color')) return flash('Already that ink');
    const next = Object.assign({}, shape, inkFor('color'));
    replaceShapes(state.shapes.map((sh) => (sh === shape ? next : sh)));
    select(picked.map((sh) => (sh === shape ? next : sh)));
    flash('Mark recoloured');
  }

  // Every mark bound up with this one takes the ink: fills, borders, and
  // the inside of any mark that carries one.
  function recolourFigure(shape) {
    const members = new Set(groupOf(shape).filter((sh) => sh.kind !== 'image'));
    const has = (sh) => wears(sh, 'color') && (!sh.fillColor || wears(sh, 'fillColor'));
    if ([...members].every(has)) return flash('Already that ink');
    const swap = new Map();
    const next = state.shapes.map((sh) => {
      if (!members.has(sh)) return sh;
      const copy = Object.assign({}, sh, inkFor('color'));
      if (sh.fillColor) Object.assign(copy, inkFor('fillColor'));
      swap.set(sh, copy);
      return copy;
    });
    replaceShapes(next);
    select(picked.map((sh) => swap.get(sh) || sh));
    flash(members.size > 1 ? `${members.size} marks recoloured` : 'Mark recoloured');
  }

  // The paper a region covers, by its largest ring — enough to tell an
  // area from a part cut out of it, and the same in any square's frame.
  function ringArea(loops) {
    let most = 0;
    for (const l of loops) {
      let a = 0;
      for (let i = 0, n = l.length; i < n; i++) {
        const p = l[i], q = l[(i + 1) % n];
        a += p.x * q.y - q.x * p.y;
      }
      most = Math.max(most, Math.abs(a / 2));
    }
    return most;
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

    const home = drawTile || activeTile;
    const t = tiling();
    const pad = Math.min(overhang(state.shapes), 2);
    // Back out of the home copy's placement: the plane into its own frame.
    const [ha, hb, hc, hd, he, hf] = t.matrix(state.pattern, home.i, home.j);
    const back = [ha, hc, hb, hd, -(ha * he + hb * hf), -(hc * he + hd * hf)];

    /* Which squares lay ink on the grid. It has to reach `pad` squares
       past the grid's own edge, not past the home square's: when the
       grid widens to the ring of neighbours, the squares beyond that
       ring still run ink into it, and leaving them out left the barrier
       full of holes exactly where the flood was about to be judged on
       whether it had escaped. */
    const placesFor = (rings) => around(home.i, home.j, rings + pad);
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
    let px, barrier, walls, mask, traced, grow, raw, edges, isGround, seeds, dom;

    /* Zoomed in, a cell of the tile's grid is many pixels across, and an
       area drawn close in — between lines a fraction of a unit thick, a
       few units apart — is smaller than the grid can see. So close in,
       the flood is tried first on a grid laid over the view alone, about
       a cell to the pixel. An area that stays inside it is traced there;
       one that runs to its edge is bigger than the view, and the tile's
       own grid sees it well enough, so it goes on as it always did. */
    const cellPx = (T / FILL_RES) * state.view.scale;
    let win = null;
    if (cellPx > 3) {
      const side = Math.min(T, (Math.max(cw, ch) * 1.1) / state.view.scale);
      win = {
        ox: w.x - side / 2, oy: w.y - side / 2, span: side,
        R: clamp(Math.round(side * state.view.scale), 64, FILL_MAX),
      };
    }

    for (;;) {
      const places = placesFor(win ? 1 : rings);
      if (win) {
        ({ ox, oy, span, R } = win);
      } else {
        ox = -rings * T;
        oy = -rings * T;
        span = (1 + 2 * rings) * T;
        R = Math.min(FILL_MAX, Math.round((FILL_RES * span) / T));
      }
      k = R / span;
      if (fillCanvas.width !== R) fillCanvas.width = fillCanvas.height = R;
      fctx.setTransform(1, 0, 0, 1, 0, 0);
      fctx.clearRect(0, 0, R, R);
      fctx.lineCap = 'round';
      fctx.lineJoin = 'round';

      /* Barriers have to be everything the eye can see holding the area
         in, not only this square's own marks. A mark runs over its
         neighbours, so the squares around this one lay ink
         on it as well — and an area enclosed by that ink flooded
         straight out, because the flood had never been told about it.
         Each neighbour is drawn through its own quarter-turn and mapped
         back into this square's frame.
         Each mark is laid down in a colour that encodes its index, so
         one read gives both the barriers and which mark made each. */
      let thinnest = Infinity;   // the narrowest wall, in cells
      for (const c of places) {
        tileKey = t.key(state.pattern, c.i, c.j);
        fctx.setTransform(k, 0, 0, k, -ox * k, -oy * k);
        fctx.transform(back[0], back[1], back[2], back[3], back[4], back[5]);
        intoTile(fctx, c.i, c.j);
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
        });
      }
      /* No marks at all is not a reason to refuse: the whole tile is one
         open area, and filling it is how the paper gets a colour. It
         comes out as the ground, the same as filling round a figure
         does, so a mark drawn afterwards still sits on top of it. */

      px = fctx.getImageData(0, 0, R, R).data;
      barrier = new Uint8Array(R * R);
      // Half covered counts as wall. A fainter threshold let the soft
      // edges of two converging strokes seal the gap between them long
      // before they actually met, so a narrow wedge stopped filling well
      // short of its point.
      for (let i = 0, n = R * R; i < n; i++) barrier[i] = px[i * 4 + 3] >= 128 ? 1 : 0;

      /* A tile that is not the square shares the square's grid with the
         corners of its neighbours. On the tile's own grid the flood is
         kept to the tile — grown a couple of cells past its edge, so an
         area running over the seam is seen to — and whatever it leaves
         there is cut back to the edge exactly once it is traced. */
      dom = !win && !rings && !t.square ? tileDomain(t, R, k, ox, oy) : null;
      if (dom) for (let i = 0, n = R * R; i < n; i++) if (!dom[i]) barrier[i] = 1;

      const seed = {
        x: clamp(Math.round((w.x - ox) * k), 0, R - 1),
        y: clamp(Math.round((w.y - oy) * k), 0, R - 1),
      };
      raw = floodMask(barrier, R, R, seed.x, seed.y, false);
      if (!raw) return flash('No open area under the cursor');
      seeds = [seed];

      /* Still running when it met the edge of the grid? Then the area
         goes on into the next square and the grid was too small. Two
         things are not that: the ground the marks sit on, which meets
         all four edges and is a square; and an area still running at the
         widest grid, which was never enclosed at all, so it is traced
         over the square again — a mark the size of the square tiles,
         where one the size of three does not.

         All four edges only reads as the ground on the square's own
         grid. On the widened one it says the flood ran out to every edge
         of nine squares, which is the opposite of enclosed — and read as
         the ground it was kept, so a fill clicked in the corner of the
         square came back two and a half squares across and its copies
         tiled over everything around them. */
      edges = dom ? domainHit(t, raw, dom, R, k, ox, oy) : edgesHit(raw, R);
      if (win) {
        if (edges.any) { win = null; continue; }
        isGround = false;
      } else isGround = !rings && edges.all;
      if (!cropped && edges.any && !isGround) {
        if (rings < maxRings) { rings++; continue; }
        if (rings) { rings = 0; cropped = true; continue; }
      }

      /* An area that runs off the square's edge goes on into the next
         square — and the next square is this same tile again. So where
         it leaves, it comes back: the point a cell past the edge is a
         point of this tile, read in the neighbour's own frame, quarter
         turn and all. Flooding on from there carries the area round to
         wherever else in the tile it belongs.

         Without it a band straddling a seam filled only on this side of
         it, since the rest of the band is a different part of the same
         tile, and looked as though the fill had stopped at nothing. It
         crosses no ink: the flood beyond the seam runs on the same
         barrier as the flood before it. */
      if (cropped) {
        const step = 1 / k;
        for (let pass = 0; pass < 8; pass++) {
          const found = [];
          const over = (gx, gy, dx, dy) => {
            if (!raw[gy * R + gx]) return;
            const q = { x: (gx + 0.5 + dx) * step, y: (gy + 0.5 + dy) * step };
            const world = placeIn(q, home.i, home.j);
            const there = cellOf(world);
            const b = unplaceIn(world, there.i, there.j);
            const bx = clamp(Math.round(b.x * k), 0, R - 1);
            const by = clamp(Math.round(b.y * k), 0, R - 1);
            if (!raw[by * R + bx] && !barrier[by * R + bx]) found.push({ x: bx, y: by });
          };
          if (!dom) {
            for (let a = 0; a < R; a++) {
              over(R - 1, a, 1, 0); over(0, a, -1, 0);
              over(a, R - 1, 0, 1); over(a, 0, 0, -1);
            }
          } else {
            // The rim of the tile's own cells, wherever it runs.
            for (let gy = 0; gy < R; gy++) {
              for (let gx = 0; gx < R; gx++) {
                if (!raw[gy * R + gx]) continue;
                for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
                  const nx = gx + dx, ny = gy + dy;
                  if (nx < 0 || ny < 0 || nx >= R || ny >= R || !dom[ny * R + nx]) over(gx, gy, dx, dy);
                }
              }
            }
          }
          let grew = false;
          for (const s of found) {
            if (raw[s.y * R + s.x]) continue;
            const more = floodMask(barrier, R, R, s.x, s.y, false);
            if (!more) continue;
            for (let i = 0, n = R * R; i < n; i++) if (more[i]) raw[i] = 1;
            seeds.push(s);
            grew = true;
          }
          if (!grew) break;
        }
      }

      /* Which marks did the area come up against? Read from a little way
         outside it: only a stroke's fully opaque core carries a
         trustworthy index, because the canvas stores colour premultiplied
         by alpha and along a soft edge a small index like 3 comes back as
         2, naming an entirely different mark. */
      const near = dilate(raw, R, R, 6, false);
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
      const bridged = dilate(raw, R, R, grow, false);
      const pinched = new Uint8Array(R * R);
      for (let i = 0, n = R * R; i < n; i++) pinched[i] = barrier[i] && !bridged[i] ? 1 : 0;
      // Every place the area was reached from, so a part of it that came
      // round a seam is bridged like the part the click landed in.
      let filled = null;
      for (const s of seeds) {
        const f = floodMask(pinched, R, R, s.x, s.y, false);
        if (!f) continue;
        if (!filled) { filled = f; continue; }
        for (let i = 0, n = R * R; i < n; i++) if (f[i]) filled[i] = 1;
      }
      mask = dilate(filled || raw, R, R, grow, false);
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
    /* The flood is grown twice over — once to bridge a pinch, once to
       tuck the edge under the ink — so the traced ring can stand a good
       two `grow` inside a wall, plus the cell it was placed to. Asked to
       reach back only two cells, the snap could not see the wall it had
       gone past and left the point where it lay: the fill sat seven
       units inside a stroke nine and a half wide, and the stroke looked
       thin along everything that had been filled against it. */
    let loops = snapLoopsToWalls(traced, walls, (2 * grow + 2) / k, 0.6);
    // Kept to the tile, where the flood was: see `dom` above.
    if (dom) loops = loops.map((l) => clipLoop(l, t.outline)).filter((l) => l.length >= 3);

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

    /* Clicked inside a figure that is filled already: the figure takes the
       ink whole — every fill in it and every border bound up with it. Left
       to the rest of this, an area still held in got another polygon
       stacked on the ones before, so a star came to hold four fills in
       four colours round an outline still in the first; and one whose
       border had been sized away from it flooded out and coloured the
       paper behind instead.

       The fill is found by what is under the pointer, so a copy run over
       from a neighbour answers as well, and compared by area rather than
       by box, which that copy's own quarter-turn would have turned. An
       area much smaller than the fill is a part cut out of it by a newer
       line, and is filled on top as a new area, as it always was. */
    const under = hitTest(w, { fillsOnly: true, anyTile: true });
    if (under && under.loops && ringArea(region.loops) >= 0.9 * ringArea(under.loops)) {
      return recolourFigure(under);
    }

    const host = interiorHost(w, region);
    if (host) {
      // An inside it has already is the figure being recoloured.
      if (host.fillColor) return recolourFigure(host);
      const next = Object.assign({}, host, inkFor('fillColor'));
      replaceShapes(state.shapes.map((sh) => (sh === host ? next : sh)));
      select(picked.map((sh) => (sh === host ? next : sh)));
      return flash('Filled — border and interior are one mark');
    }

    region.id = shapeSeq++;
    region.layer = 'fill';
    Object.assign(region, inkFor('color'));
    // Remember what the area came up against, so it can never be painted
    // over the top of it.
    region.walls = walls.map((sh) => sh.id).filter((v) => v != null);

    // The ground the marks sit on is not the inside of any of them, so
    // grouping it would tie the whole picture together — `isGround`, from
    // the flood above.
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
      pushStep();
      state.shapes = next.concat([region]);
      noteUsed([region], true);
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

  /* ---------------- text ---------------- */

  /* Letters are marks like any other. What is typed is rastered once and
     the boundary of its ink walked into closed rings — the same tracer
     the fill uses — so a text mark is a region: it moves, turns,
     mirrors, bends under the warp, wears a sweep and writes itself out
     as outlines, and nothing downstream of it has to know what a letter
     is. No raster is kept; the bitmap is scratch, as it is for a fill.

     The trace is made at one size whatever size is asked for and the
     rings scaled on the way out, so the letters are cut as finely at 20
     as at 400 and the size slider costs nothing to drag. */
  const TYPE_PX = 320;      // how tall the letters are rastered
  const TYPE_PAD = 10;      // clear cells round them, so every ring closes
  /* How far a ring may stand off the letter it was traced from, in those
     cells. It is the resolution that buys a smooth curve, not this: a
     traced edge climbs a staircase a cell high, so anything under a cell
     asks for every stair to be kept and the rings come back ten times
     the size for a curve that is no truer. A cell of a letter three
     hundred tall is a third of a percent of it. */
  const TYPE_EPS = 1;
  const TYPE_LEAD = 1.3;    // line to line, against the size
  /* Three faces every computer has, named for what they are rather than
     for a font, so a drawing made on one machine is cut from something
     close on the next. Anything else this computer holds is asked for by
     name — see the picker. */
  const FACES = {
    sans: 'ui-sans-serif, system-ui, "Helvetica Neue", Arial, sans-serif',
    serif: 'ui-serif, Georgia, "Times New Roman", Times, serif',
    mono: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
  };
  const FACE_NAMES = { sans: 'Sans', serif: 'Serif', mono: 'Mono' };
  // The families found on this computer, once it has been asked.
  let localFaces = [];

  let typing = null;        // what is being typed, before it is set down
  let typeDirty = false;    // the letters need cutting again this frame
  let typeCanvas = null;
  let typeTrace = { sig: '' };

  /* A family off the picker is asked for by name, with the plain sans
     behind it in case the font has gone since the drawing was made. */
  function faceOf(name) {
    if (FACES[name]) return FACES[name];
    return `"${String(name).replace(/["\\]/g, '')}", ${FACES.sans}`;
  }

  const typeFont = () => `${state.typeItalic ? 'italic ' : ''}${state.typeBold ? '700 ' : ''}`
    + `${TYPE_PX}px ${faceOf(state.typeFace)}`;

  function typeCtx() {
    if (!typeCanvas) typeCanvas = document.createElement('canvas');
    const g = typeCanvas.getContext('2d', { willReadFrequently: true });
    g.font = typeFont();
    return g;
  }

  const typeLead = () => Math.round(TYPE_PX * TYPE_LEAD);

  /* The rings round what is typed, in the cells they were traced on,
     kept against the words and the face they came from: a change of
     size or of place is then arithmetic on them rather than another
     trace. */
  function typeOutline(text) {
    const sig = `${state.typeFace}|${state.typeBold ? 'b' : ''}${state.typeItalic ? 'i' : ''}|${text}`;
    if (typeTrace.sig === sig) return typeTrace;
    const lines = text.split('\n');
    const lead = typeLead();
    let wide = 0;
    for (const l of lines) wide = Math.max(wide, typeCtx().measureText(l).width);
    const W = Math.ceil(wide) + TYPE_PAD * 2;
    const H = lead * lines.length + TYPE_PAD * 2;
    typeCanvas.width = W;
    typeCanvas.height = H;
    // Sizing a canvas empties it and puts its context back to the
    // defaults, so the face goes on again here rather than above.
    const g = typeCtx();
    g.textBaseline = 'top';
    g.fillStyle = '#000';
    lines.forEach((l, k) => g.fillText(l, TYPE_PAD, TYPE_PAD + k * lead));
    // Half cover is where the edge of a letter lies. Read a byte at a
    // time: reading the pixel as a word and taking its top byte is a few
    // milliseconds quicker on a long line, and wrong on a machine that
    // orders its bytes the other way.
    const px = g.getImageData(0, 0, W, H).data;
    const mask = new Uint8Array(W * H);
    for (let i = 0; i < mask.length; i++) mask[i] = px[i * 4 + 3] > 127 ? 1 : 0;
    typeTrace = { sig, loops: loopsFromInk(mask, W, H, TYPE_EPS) };
    return typeTrace;
  }

  /* What is typed, as a mark: the rings put where the caret was, scaled
     to the size in hand and then through whatever has been done to the
     mark since it was first set down — nothing, for a new one. The point
     clicked is the top left of the first line, which is where the caret
     stands and what the letters grow from.

     The mark keeps the words and how they were set, so that clicking it
     opens them again. */
  function typeMark(t) {
    if (!t.text.trim()) return null;
    const got = typeOutline(t.text);
    if (!got.loops) return null;
    const k = state.typeSize / TYPE_PX;
    const ox = t.at.x - TYPE_PAD * k, oy = t.at.y - TYPE_PAD * k;
    const m = t.m || IDENT;
    /* Kept to a hundredth of a tile unit. The rings come off the easing
       as full floats, seventeen digits of a number whose last fourteen
       say nothing — they made a word of two letters a forty-kilobyte
       mark, and the file is meant to be read. */
    const r2 = (v) => Math.round(v * 100) / 100;
    const put = (p) => {
      const q = mapAffine(m, { x: ox + p.x * k, y: oy + p.y * k });
      return { x: r2(q.x), y: r2(q.y) };
    };
    return Object.assign({
      id: t.id,
      kind: 'region',
      layer: 'stroke',
      filled: true,
      loops: got.loops.map((l) => l.map(put)),
      type: {
        text: t.text,
        size: state.typeSize,
        face: state.typeFace,
        bold: state.typeBold || undefined,
        italic: state.typeItalic || undefined,
        at: t.at,
        // An upright mark that has not been moved says so by saying
        // nothing, which keeps the file clean.
        m: m === IDENT ? undefined : m,
      },
    }, inkFor('color'));
  }

  /* The letters as they stand are kept under `draft`, so they are
     painted in every square and bent by the warp exactly as they will be
     once they are set down: what is being typed is already the mark.

     A keystroke asks for them to be cut again but does not cut them. A
     burst of typing would otherwise trace the whole line once per key,
     and a long line takes tens of milliseconds to trace; the frame does
     it instead, so however fast the keys come there is one trace to show
     them. */
  function retype() {
    typeDirty = true;
    requestDraw();
  }

  // Called by the frame, just before the plane is painted.
  function cutLetters() {
    if (!typeDirty) return;
    typeDirty = false;
    draft = typing ? typeMark(typing) : null;
  }

  function startTyping(at, tile) {
    typing = { id: shapeSeq++, at, m: IDENT, tile, text: '', caret: 0, was: null };
    draft = null;
    setHint(HINTS.typing, true);
    requestDraw();
  }

  /* Clicking letters that are already down opens them again. The words
     come back with the size, the face and the ink they were set in — the
     ink as the eyedropper would take it, so a re-cut keeps its colour
     and changing the ink while it is open still recolours it — and the
     caret goes to the end of them. The mark itself is held out of the
     picture until it is set down again, so what is on the plane while
     you type is what you will get: in the place, at the turn and in the
     mirror the old one had. */
  function openTyping(mark, tile, w) {
    const t = mark.type;
    state.typeSize = clamp(Math.round(t.size), 20, 400);
    if (t.face && typeof t.face === 'string') state.typeFace = t.face;
    state.typeBold = !!t.bold;
    state.typeItalic = !!t.italic;
    syncType();
    syncToggles();
    if (mark.color) {
      // Not `takeInk`: that is the eyedropper, which drops a flat colour
      // on to the end of a sweep already in hand rather than replacing
      // it. What the letters were written in is what should come back.
      if (parseInk(mark.color)) state.across = acrossOf(mark, 'color');
      setColor(mark.color, true, true);
      syncAcross();
    }
    /* The caret goes where the click fell, so a word is opened at the
       letter you pointed at. It is worked out after the size and the
       face are in hand, since both go into the measuring. */
    typing = { id: mark.id, at: t.at, m: t.m || IDENT, tile, text: t.text, caret: t.text.length, was: mark };
    if (w) typing.caret = caretFor(typing, w, tile);
    setHint(HINTS.typing, true);
    retype();
  }

  /* Setting down what is typed. The ink, the size and the face are read
     now rather than when the caret was placed, so a colour or a size
     chosen part way through belongs to the whole of it. */
  function endTyping() {
    const t = typing;
    if (!t) return false;
    const mark = typeMark(t);
    typing = null;
    typeDirty = false;
    draft = null;
    setHint(HINTS[state.tool]);
    /* Opened and set down again: the new cut takes the old one's place
       in the stack, and with it the group it was bound into. Emptied of
       its words altogether, the mark goes with them. */
    if (t.was) {
      if (mark && t.was.group != null) mark.group = t.was.group;
      replaceShapes(mark
        ? state.shapes.map((sh) => (sh === t.was ? mark : sh))
        : state.shapes.filter((sh) => sh !== t.was));
      usedNow();
      flash(mark ? 'Text set down again' : 'Emptied of words — the mark has gone with them');
      return true;
    }
    if (!mark) { requestDraw(); return false; }
    commit(mark);
    usedNow();
    flash('Text set down — it is a mark now, like any other');
    return true;
  }

  /* Which letter a click falls before. The point is taken back through
     the mark's own affine into the upright letters it was cut from — so
     a word that has been turned or mirrored is read as though it never
     had been — then to the line it lands on, and within that line to
     whichever gap between letters it is nearest.

     `tile` is the square whose copy was clicked, which may be a
     neighbour's: the plane is one tile over and over, so the click is
     put back into the coordinates the mark itself is kept in. */
  function caretFor(t, w, tile) {
    const home = frameTile();
    const q = mapAffine(invAffine(t.m || IDENT),
      unplaceIn(placeIn(w, home.i, home.j), tile.i, tile.j));
    const k = state.typeSize / TYPE_PX;
    const lines = t.text.split('\n');
    const row = clamp(Math.floor((q.y - t.at.y) / (typeLead() * k)), 0, lines.length - 1);
    const line = lines[row];
    const want = (q.x - t.at.x) / k;
    const g = typeCtx();
    let col = 0, near = Infinity;
    for (let i = 0; i <= line.length; i++) {
      const off = Math.abs(g.measureText(line.slice(0, i)).width - want);
      if (off >= near) continue;
      near = off;
      col = i;
    }
    let at = 0;
    for (let r = 0; r < row; r++) at += lines[r].length + 1;
    return clamp(at + col, 0, t.text.length);
  }

  /* Where the caret stands in what has been typed: which line it is on,
     how far into that line, and where that line begins. The caret is an
     offset into the text rather than a place on the plane, so every move
     and every edit is done on the string and the letters follow. */
  function caretSpot(t) {
    const lines = t.text.split('\n');
    let at = 0;
    for (let row = 0; row < lines.length; row++) {
      if (t.caret <= at + lines[row].length) return { lines, row, col: t.caret - at, start: at };
      at += lines[row].length + 1;
    }
    const row = lines.length - 1;
    return { lines, row, col: lines[row].length, start: at - lines[row].length - 1 };
  }

  /* The near edge of the word `dir` away: over whatever spaces lie that
     way, then over the run of letters beyond them. A new line is a space
     like any other, so a jump at the end of one carries on to the next. */
  function wordEdge(text, from, dir) {
    const word = (c) => c && /\S/.test(c);
    let i = from;
    if (dir < 0) {
      while (i > 0 && !word(text[i - 1])) i--;
      while (i > 0 && word(text[i - 1])) i--;
    } else {
      while (i < text.length && !word(text[i])) i++;
      while (i < text.length && word(text[i])) i++;
    }
    return i;
  }

  /* Moving the caret. Left and right by a letter, by a word with Alt, or
     to the end of the line with ⌘; up and down by a line, holding the
     column where the line reaches that far and stopping at its end
     where it does not. Returns false for a key that moves nothing, so
     the caller can leave it to whatever else wants it. */
  function moveCaret(e) {
    const t = typing;
    const { lines, row, col, start } = caretSpot(t);
    const wide = e.metaKey || e.ctrlKey;
    const toRow = (r) => {
      const at = r < row
        ? start - lines[r].length - 1
        : start + lines[row].length + 1;
      return at + Math.min(col, lines[r].length);
    };
    let to = null;
    switch (e.key) {
      case 'ArrowLeft':
        to = wide ? start : e.altKey ? wordEdge(t.text, t.caret, -1) : t.caret - 1;
        break;
      case 'ArrowRight':
        to = wide ? start + lines[row].length
          : e.altKey ? wordEdge(t.text, t.caret, 1) : t.caret + 1;
        break;
      case 'ArrowUp': to = row > 0 ? toRow(row - 1) : 0; break;
      case 'ArrowDown': to = row < lines.length - 1 ? toRow(row + 1) : t.text.length; break;
      case 'Home': to = start; break;
      case 'End': to = start + lines[row].length; break;
      default: return false;
    }
    t.caret = clamp(to, 0, t.text.length);
    requestDraw();     // the letters have not changed, only the caret
    return true;
  }

  // Put something in where the caret stands, and leave it after.
  function typeIn(str) {
    typing.text = typing.text.slice(0, typing.caret) + str + typing.text.slice(typing.caret);
    typing.caret += str.length;
    retype();
  }

  /* One key of typing. Held apart from the rest of the keyboard because
     while a caret is down the keys are letters and not shortcuts. */
  function typeKey(e) {
    if (e.key === 'Escape') { cancelDraft(); return true; }
    if (e.key === 'Enter') {
      e.preventDefault();
      // A line of its own is Shift-Enter; Enter on its own is done.
      if (e.shiftKey) { typeIn('\n'); return true; }
      endTyping();
      return true;
    }
    if (moveCaret(e)) { e.preventDefault(); return true; }
    if (e.key === 'Backspace') {
      e.preventDefault();
      if (typing.caret > 0) {
        typing.text = typing.text.slice(0, typing.caret - 1) + typing.text.slice(typing.caret);
        typing.caret--;
        retype();
      }
      return true;
    }
    // Forward delete takes the letter the caret stands before, which is
    // worth having now that it can stand anywhere.
    if (e.key === 'Delete') {
      e.preventDefault();
      if (typing.caret < typing.text.length) {
        typing.text = typing.text.slice(0, typing.caret) + typing.text.slice(typing.caret + 1);
        retype();
      }
      return true;
    }
    if (e.key.length === 1) {
      e.preventDefault();
      typeIn(e.key);
      return true;
    }
    // Anything else — a function key, a page key — is swallowed rather
    // than let through to a shortcut it would trigger mid-word.
    return true;
  }

  /* The caret stands where the next letter will go, in the square the
     text was started in and in no other: it says where the hand is,
     which is not part of the picture, and one in every square would be a
     field of them. It does not blink; nothing else on the plane does. */
  function drawCaret() {
    const { lines, row, col } = caretSpot(typing);
    const k = state.typeSize / TYPE_PX;
    const x = typing.at.x + typeCtx().measureText(lines[row].slice(0, col)).width * k;
    const y = typing.at.y + row * typeLead() * k;
    const m = typing.m || IDENT;
    const f = typing.tile;
    // Through the mark's own affine, so the caret stands in the letters
    // of a word that has been turned or mirrored rather than beside them.
    const a = mapAffine(m, { x, y });
    const b = mapAffine(m, { x, y: y + state.typeSize });
    ctx.save();
    ctx.strokeStyle = ACCENT;
    ctx.lineWidth = 2;
    ctx.lineCap = 'butt';
    ctx.beginPath();
    tracePlane([placeIn(a, f.i, f.j), placeIn(b, f.i, f.j)], false);
    ctx.stroke();
    ctx.restore();
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
    altHeld = e.altKey; ctrlHeld = e.ctrlKey; shiftHeld = e.shiftKey;
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
    pressAt = s;
    if (state.tool === 'warp') { startWarp(s); return; }
    if (startDraw(w, e) === false) {
      // nothing under the cursor to pick up — drag the plane instead
      mode = 'pan';
      panFrom = { x: s.x, y: s.y, vx: state.view.x, vy: state.view.y };
      canvas.classList.add('panning');
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    const s = screenPt(e);
    altHeld = e.altKey; ctrlHeld = e.ctrlKey; shiftHeld = e.shiftKey;
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
    if (warpDrag) { moveWarp(s); return; }
    if (pending === 'bend') { bendPending(w); return; }
    if (pending === 'point' || mode === 'draw') { moveDraw(w); return; }
    if (state.tool === 'warp') {
      canvas.classList.toggle('grabbable', !!anchorAt(s));
      return;
    }
    if (state.tool === 'select') {
      const g = gripAt(w);
      const was = hoverGrip ? `${hoverGrip.kind}${hoverGrip.at}${hoverGrip.x || 0}` : '';
      const now = g ? `${g.kind}${g.at}${g.x || 0}` : '';
      hoverGrip = g;
      if (now !== was) requestDraw();
      canvas.classList.toggle('grabbable',
        !g && insideTile(w, 5) && !!hitTest(w, { interior: true, anyTile: true }));
      canvas.classList.toggle('gripping', !!g);
    }
  });

  /* A press that slides a few pixels is a click — most trackpad clicks
     travel that far — but one drawn right out is a drag, and a drag says
     where the mark ends as plainly as a second click would. Past this
     many pixels the release sets the mark instead of leaving it live.
     It sits above every threshold `tooSmall` discards at, so a mark that
     was drawn out far enough to set is always one worth keeping. */
  const DRAG_MIN = 6;

  function release(e) {
    pointers.delete(e.pointerId);
    const s = screenPt(e);
    // A quick flick can release past the last pointermove; take the
    // release position as the final one.
    if (mode === 'draw' && (draft || moving || lasso || grip)) {
      moveDraw(drawPt(s.x, s.y));
    }
    const dragged = !!pressAt && Math.hypot(s.x - pressAt.x, s.y - pressAt.y) >= DRAG_MIN;
    pressAt = null;
    if (warpDrag) { endWarp(e.type !== 'pointercancel'); mode = null; return; }
    if (mode === 'pinch') {
      if (pointers.size < 2) { mode = null; pinchFrom = null; }
      return;
    }
    if (mode === 'pan') {
      canvas.classList.remove('panning');
      mode = null;
      return;
    }
    if (mode === 'draw') { endDraw(dragged); mode = null; }
  }

  canvas.addEventListener('pointerleave', () => {
    if (hoverGrip) { hoverGrip = null; requestDraw(); }
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
      // What the sweep picked up belongs to the square it was drawn in.
      // Marks already in hand keep the square they were taken in.
      select(base.concat(caught), frameTile());
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
      .map(([x, y]) => fromTileSpace({ x, y }));
    ctx.save();
    ctx.beginPath();
    // Through the warp, the sweep is as bent as the paper it covers.
    tracePlane(pts, true);
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
    c: 'circle', r: 'rect', t: 'text', f: 'fill', e: 'erase', w: 'warp',
  };

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement || e.target instanceof HTMLSelectElement) return;
    /* A modifier is state, not an action, so it is taken down before
       anything else looks at the key. Control held on its own used to
       read as the start of a shortcut and never reached the flag at all,
       which left it constraining nothing. Shift changes what will be
       snapped to, so the mark under the cursor is worked out afresh the
       moment it moves. */
    if (e.key === 'Shift') { shiftHeld = true; noteHover(lastWorld); requestDraw(); return; }
    if (e.key === 'Alt') { altHeld = true; return; }
    if (e.key === 'Control') { ctrlHeld = true; return; }
    if (e.key === 'Escape' && (closeNewPrompt() || closeShapePrompt())) { e.preventDefault(); return; }
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
    /* Everything on the tile. It takes the select tool up as well, since
       picking marks up and then having no way to move them would be an
       odd place to be left. */
    if (meta && k === 'a') {
      e.preventDefault();
      cancelDraft();
      if (!state.shapes.length) return flash('Nothing on the tile');
      setTool('select');
      select(state.shapes.slice(), null, 0);
      requestDraw();
      const n = picked.length;
      return flash(`${n} ${n === 1 ? 'mark' : 'marks'} picked up`);
    }
    /* Copy and cut are taken here rather than left to the browser: with
       nothing selected on the page, some browsers never raise a copy event
       for the keys at all. Holding nothing, the keys are the browser's. */
    if (meta && (k === 'c' || k === 'x') && !e.shiftKey && !e.altKey) {
      if (!heldMarks().length) return;
      e.preventDefault();
      copyToSystem(copyHeld(k === 'x'));
      return;
    }
    if (meta && k === 'v' && !e.shiftKey && !e.altKey) { pasteByKey(); return; }
    // ⌘D would otherwise bookmark the page.
    if (meta && k === 'd' && !e.shiftKey && !e.altKey) { e.preventDefault(); duplicateHeld(); return; }
    /* The line-end moves are ⌘← and ⌘→ on this keyboard, so they are
       taken before every other unclaimed shortcut is dropped below. */
    if (typing && meta && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      moveCaret(e);
      return;
    }
    if (meta) return;

    /* A caret is down: every key from here is a letter. The shortcuts
       above it still work, so undo and save are never out of reach. */
    if (typing && typeKey(e)) return;

    if (state.tool === 'warp' && state.warp.anchors[warpSel]
        && (e.key === 'Delete' || e.key === 'Backspace')) {
      e.preventDefault();
      removeAnchor();
      return;
    }

    if (picked.length && !draft && !pending) {
      const far = e.altKey || e.ctrlKey ? 5 : 1;
      // A lattice cell while snapping to one; with the grid off there is none.
      const step = (snapping() && state.sub ? T / effSub() : 10) * far;
      const d = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key];
      if (d) {
        e.preventDefault();
        const members = heldMarks();
        const { marks: moved, hx, hy } = moveGroup(members, d[0] * step, d[1] * step);
        const swap = new Map(members.map((sh, k) => [sh, moved[k]]));
        replaceShapes(raise(state.shapes.map((sh) => swap.get(sh) || sh), moved));
        select(picked.map((sh) => swap.get(sh) || sh));
        followHome(moved, hx, hy);
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
    if (e.key === 'Escape') {
      if (dropper) { armDropper(false); return; }
      if (state.tool === 'warp' && !warpDrag && warpSel >= 0) {
        warpSel = -1;
        syncWarpPanel();
        requestDraw();
        return;
      }
      if (endLasso(true)) { requestDraw(); return; }
      if (!cancelDraft() && picked.length) { select([]); requestDraw(); }
      return;
    }
    if (k === 'i') { armDropper(!dropper); return; }
    if (TOOL_KEYS[k]) { setTool(TOOL_KEYS[k]); return; }
    if (k >= '1' && k <= '9') { takeSwatch(currentColors()[+k - 1]); return; }
    if (k === '0') { takeSwatch(currentColors()[9]); return; }
    if (k === '[') { setWidth(state.width - (state.width > 12 ? 4 : 1)); return; }
    if (k === ']') { setWidth(state.width + (state.width >= 12 ? 4 : 1)); return; }
    if (k === 'g') { groupPicked(); return; }
    if (k === 'u') { ungroupPicked(); return; }
    /* The tile rules have been moved twice now: they gave up G to
       grouping, then T to text, which wants the letter it is named
       after more than a switch does. X is what the two of them have
       traded, and the switch itself says so. */
    if (k === 'x') { toggle('grid'); return; }
    if (k === 's') { toggle('snap'); return; }
    // D steps through the sizes, and switches the grid on where it is
    // off — the switch itself is the way to turn it back off.
    if (k === 'd') {
      setSub(state.sub ? SUBS[(SUBS.indexOf(state.sub) + 1) % SUBS.length] : state.subLast || 8);
      return;
    }
    if (k === 'h') { resetView(); return; }
    if (k === 'z') { zoomToHeld(); return; }
    if (k === '=' || k === '+') { zoomAt(cw / 2, ch / 2, 1.2); return; }
    if (k === '-') { zoomAt(cw / 2, ch / 2, 1 / 1.2); return; }
  });

  window.addEventListener('blur', () => {
    pointers.clear();
    shiftHeld = altHeld = ctrlHeld = false;
    canvas.classList.remove('outside', 'panning');
  });

  window.addEventListener('keyup', (e) => {
    if (e.key === ' ') e.preventDefault();
    if (e.key === 'Shift') { shiftHeld = false; noteHover(lastWorld); requestDraw(); }
    if (e.key === 'Alt') altHeld = false;
    if (e.key === 'Control') ctrlHeld = false;
  });

  /* ---------------- ui ---------------- */

  let hintTimer = 0;
  /* The running commentary along the bottom is gone. Every tool still
     says what it did; there is simply nowhere on the plane for it to be
     said, so it is said to no one. Keeping the call sites means the day
     somewhere is wanted for it, they all still work. */
  function setHint(text, live) {
    clearTimeout(hintTimer);
    if (!hintEl) return;
    hintEl.textContent = text;
    hintEl.classList.toggle('live', !!live);
  }
  function flash(text) {
    setHint(text, true);
    hintTimer = setTimeout(() => setHint(HINTS[state.tool] || HINTS.base), 1900);
  }

  function setTool(tool) {
    hoverGrip = null;
    /* Reaching for another tool with a word half typed sets it down
       rather than throwing it away — Esc is how you throw it away. */
    if (typing) endTyping();
    if (pending) cancelDraft();
    if (tool !== 'select') select([]);
    endLasso(true);
    if (dropper) armDropper(false);
    state.tool = tool;
    canvas.classList.toggle('selecting', tool === 'select');
    canvas.classList.remove('grabbable');
    requestDraw();       // the anchors show only while the warp tool is up
    for (const b of document.querySelectorAll('.tool')) b.classList.toggle('on', b.dataset.tool === tool);
    /* Under the tools, in a box named for the tool in hand, its own
       controls and no others: snapping for the tools that snap, the width
       for the tools that draw strokes and for Select, which sets it on what
       it holds; the buttons that work on what is held for Select, Filled
       shapes for Circle and Rect, Smooth for the pencil, and the warp for
       Warp. Each says in `data-for` which tools it belongs to, and a tool
       with none has no box. */
    syncAcross();
    document.getElementById('toolCardTitle').textContent = document.querySelector(`.tool[data-tool="${tool}"] em`).textContent;
    setHint(HINTS[tool] || HINTS.base);
    saveSoon();
  }

  /* The ink in hand as it goes on to a stroke or a fill: the colour and,
     with a sweep, the way the sweep lies across it. */
  function inkFor(slot) {
    return { [slot]: state.color, [ACROSS[slot]]: parseInk(state.color) && state.across === 'tile' ? 'tile' : undefined };
  }
  // Whether a stroke or fill wears the ink in hand already, lying the same way.
  function wears(sh, slot) {
    return sh[slot] === state.color && (!parseInk(state.color) || acrossOf(sh, slot) === state.across);
  }

  /* Each control in the tool box says in `data-for` which tools it belongs
     to, and a tool with none has no box. What a sweep lies across says
     `data-when="sweep"` as well: it shows only while there is a gradient
     about — in hand, or for Select, which has no ink of its own to show,
     on something held. */
  function syncToolCard() {
    const tool = state.tool;
    const sweep = tool === 'select' ? heldSweeps().length > 0 : !!parseInk(state.color);
    for (const el of document.querySelectorAll('[data-for]')) {
      el.hidden = !el.dataset.for.split(' ').includes(tool) || (el.dataset.when === 'sweep' && !sweep);
    }
    const toolCard = document.getElementById('toolCard');
    toolCard.hidden = ![...toolCard.querySelectorAll('[data-for]')].some((el) => !el.hidden);
  }

  // Every stroke and fill held that wears a sweep, as [mark, slot].
  function heldSweeps() {
    const out = [];
    for (const sh of heldMarks()) {
      for (const slot of ['color', 'fillColor']) if (parseInk(sh[slot])) out.push([sh, slot]);
    }
    return out;
  }

  /* What a sweep lies across: the marks to come, or — with something held
     that wears one — what it holds, lit only if they all agree. */
  function syncAcross() {
    const worn = heldSweeps();
    const ways = new Set(worn.length ? worn.map(([sh, slot]) => acrossOf(sh, slot)) : [state.across]);
    for (const b of document.getElementById('acrossModes').children) {
      b.classList.toggle('on', ways.size === 1 && ways.has(b.dataset.across));
    }
    syncToolCard();
  }

  function setColor(raw, quiet, inkOnly) {
    const hex = normInk(raw);
    if (!hex) return;
    state.color = hex;
    syncMixer(quiet);
    // Letters part way through take the new ink at once, the way a mark
    // being dragged out does.
    if (typing) retype();
    if (!inkOnly && picked.length) {
      const swap = new Map();
      // Every mark held, not only the ones clicked: a group is held whole.
      // A stroke that already wore a sweep keeps the way it lay; one taking
      // a sweep for the first time lies the way the hand says.
      for (const sh of heldMarks()) {
        if (sh.kind === 'image') continue;   // a picture takes no ink
        if (sh.color !== hex) swap.set(sh, Object.assign({}, sh, parseInk(sh.color) ? { color: hex } : inkFor('color')));
      }
      if (swap.size) {
        replaceShapes(state.shapes.map((sh) => swap.get(sh) || sh), sliderRun);
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

  function armDropper(on, btn) {
    dropper = on;
    // With a gradient in hand, the eyedropper that lights is the one on the
    // end it is going to fill.
    const lit = btn || (parseInk(state.color) ? ends[gradEnd].drop : document.getElementById('dropBtn'));
    for (const b of document.querySelectorAll('.mini.drop')) b.classList.toggle('armed', on && b === lit);
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
    // A picture has no ink of its own; what is under the pointer is taken off the paper.
    if (mark && mark.kind !== 'image') {
      const slot = !border && mark.layer === 'stroke' && !mark.filled && mark.fillColor
        ? 'fillColor'
        : 'color';
      const hex = mark[slot];
      // A sweep comes off with the way it lay there.
      if (parseInk(hex)) state.across = acrossOf(mark, slot);
      takeInk(hex);
      syncAcross();
      return flash(`Took ${hex}`);
    }
    const x = clamp(Math.round(s.x * dpr), 0, canvas.width - 1);
    const y = clamp(Math.round(s.y * dpr), 0, canvas.height - 1);
    const px = ctx.getImageData(x, y, 1, 1).data;
    if (px[3] < 8) return flash('Nothing there to take');
    const hex = '#' + [px[0], px[1], px[2]].map((v) => v.toString(16).padStart(2, '0')).join('');
    takeInk(hex);
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
        ? (state.sub ? `Snapping to marks and a ${state.sub} × ${state.sub} grid · hold Shift to suspend it`
                     : 'Snapping to marks · hold Shift to suspend it')
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

  const SUBS = [2, 3, 4, 6, 8, 12, 16, 32, 64];
  const subWrap = document.getElementById('subs');
  const gridOnBtn = document.getElementById('gridOn');
  SUBS.forEach((n) => {
    const b = document.createElement('button');
    b.dataset.sub = n;
    b.textContent = n;
    b.title = `${n} × ${n} grid — D cycles`;
    b.addEventListener('click', () => setSub(n));
    subWrap.appendChild(b);
  });

  /* Off is the switch above the sizes, not a size of its own. Turning
     the grid off keeps the size it was on, so switching back on returns
     the grid the user was working to rather than a default. */
  gridOnBtn.addEventListener('click', () => setSub(state.sub ? 0 : state.subLast || 8));

  function setSub(n) {
    if (n) state.subLast = n;
    state.sub = n;
    hoverSnap = null;
    // The snap switch is left exactly as the user set it. With no
    // lattice there is simply nothing to snap to, so it shows as
    // inactive rather than being flipped behind their back.
    syncToggles();
    if (state.snap) {
      flash(n ? `Snapping to a ${n} × ${n} grid · hold Shift to suspend it`
              : 'Grid off — snapping to marks only');
    }
    requestDraw();
    saveSoon();
  }

  function syncToggles() {
    for (const b of document.querySelectorAll('[data-toggle]')) {
      b.classList.toggle('on', !!state[b.dataset.toggle]);
    }
    gridOnBtn.classList.toggle('on', !!state.sub);
    for (const b of subWrap.children) {
      b.classList.toggle('on', +b.dataset.sub === state.sub);
      b.disabled = !state.sub;
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
  document.getElementById('flipXBtn').addEventListener('click', () => flipHeld('x'));
  document.getElementById('flipYBtn').addEventListener('click', () => flipHeld('y'));
  document.getElementById('turnLeftBtn').addEventListener('click', () => turnHeld(-1));
  document.getElementById('turnRightBtn').addEventListener('click', () => turnHeld(1));
  document.getElementById('toBottomBtn').addEventListener('click', () => restackHeld('bottom'));
  document.getElementById('downOneBtn').addEventListener('click', () => restackHeld('down'));
  document.getElementById('upOneBtn').addEventListener('click', () => restackHeld('up'));
  document.getElementById('toTopBtn').addEventListener('click', () => restackHeld('top'));
  document.getElementById('cutBtn').addEventListener('click', () => copyToSystem(copyHeld(true)));
  document.getElementById('copyBtn').addEventListener('click', () => copyToSystem(copyHeld(false)));
  document.getElementById('pasteBtn').addEventListener('click', () => pasteMarks(clipboard));

  /* ---------------- palette ---------------- */

  const swatchWrap = document.getElementById('swatches');
  const recentWrap = document.getElementById('recent');
  const RECENT_MAX = 10;
  const palSel = document.getElementById('palSel');
  const palNameRow = document.getElementById('palNameRow');
  const palNameInput = document.getElementById('palName');
  const palDelBtn = document.getElementById('palDel');
  const palRenameBtn = document.getElementById('palRename');
  const palSaveBtn = document.getElementById('palSave');
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

  /* A name nothing else answers to. `mine` is the palette being renamed,
     which does not count against itself — otherwise keeping the name and
     changing only its case would come back as “Reds 2”. */
  function freeName(base, mine) {
    const taken = (n) => BUILT_IN.some((p) => p.name === n)
      || state.palettes.some((p) => p.name === n && p !== mine);
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
    palRenameBtn.disabled = !isMine();
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
      b.title = hex + (!parseInk(hex) && a < 255 ? ` (${Math.round((a / 255) * 100)}%)` : '') + key;
      b.innerHTML = `<span class="well chk"><i style="background:${inkCss(hex)}"></i></span>`
        + (mine ? '<i class="kill" title="Remove this colour">\u00d7</i>' : '');
      b.addEventListener('click', (e) => {
        // `closest`, not the class of the target itself: the cross is
        // small and anything that ends up inside it still counts.
        if (e.target.closest('.kill')) { dropSwatch(idx); return; }
        takeSwatch(hex);
      });
      dragSwatch(b, hex, 'palette');
      swatchWrap.appendChild(b);
    });
    markSwatches();
  }

  /* The ten slots under the palette. They are drawn whether or not there
     is anything in them, so the strip keeps its shape as it fills. */
  function buildRecent() {
    recentWrap.innerHTML = '';
    for (let i = 0; i < RECENT_MAX; i++) {
      const ink = state.recent[i];
      if (!ink) {
        const slot = document.createElement('span');
        slot.className = 'slot';
        recentWrap.appendChild(slot);
        continue;
      }
      const b = document.createElement('button');
      b.className = 'swatch';
      b.dataset.color = ink;
      const a = alphaOf(ink);
      b.title = ink + (!parseInk(ink) && a < 255 ? ` (${Math.round((a / 255) * 100)}%)` : '');
      b.innerHTML = `<span class="well chk"><i style="background:${inkCss(ink)}"></i></span>`
        + '<i class="kill" title="Take this out">\u00d7</i>';
      b.addEventListener('click', (e) => {
        if (e.target.closest('.kill')) { dropRecent(i); return; }
        takeSwatch(ink);
      });
      dragSwatch(b, ink, 'recent');
      recentWrap.appendChild(b);
    }
    syncRecent();
  }

  /* A colour can be dragged from either strip to the other, and lands
     there as a copy — the one you dragged stays put. Where it came from
     is kept here rather than read back out of the drag, which carries a
     plain string the browser will hand to any window that will take it;
     what matters is which of our own two strips it left, and a drop back
     into that one is nothing at all. */
  let dragging = null;

  function dragSwatch(b, ink, from) {
    b.draggable = true;
    b.addEventListener('dragstart', (e) => {
      dragging = { ink, from };
      e.dataTransfer.effectAllowed = 'copy';
      // A payload of some kind, or the drag will not start at all.
      e.dataTransfer.setData('text/plain', ink);
    });
    b.addEventListener('dragend', () => { dragging = null; clearCarets(); });
  }

  /* Where a drop would land: before the swatch nearest the pointer, or
     after it once the pointer is past its middle. Only the filled slots
     are asked — the recent strip draws its empty ones so the row keeps
     its shape, and a drop over that tail belongs at the end of what is
     actually there, not eight places along. */
  function dropIndex(el, e) {
    const kids = [...el.querySelectorAll('.swatch')];
    if (!kids.length) return 0;
    let at = 0, best = Infinity;
    kids.forEach((k, i) => {
      const r = k.getBoundingClientRect();
      const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
      const d = Math.hypot(e.clientX - cx, e.clientY - cy);
      if (d < best) { best = d; at = e.clientX > cx ? i + 1 : i; }
    });
    return at;
  }

  // The caret, drawn on the swatch it would go in front of — or behind
  // the last one, where it would go on the end.
  function showCaret(el, at) {
    const kids = [...el.querySelectorAll('.swatch')];
    for (const k of kids) k.classList.remove('ins-before', 'ins-after');
    if (at == null || !kids.length) return;
    if (at < kids.length) kids[at].classList.add('ins-before');
    else kids[kids.length - 1].classList.add('ins-after');
  }

  const clearCarets = () => {
    showCaret(swatchWrap, null);
    showCaret(recentWrap, null);
    for (const el of [swatchWrap, recentWrap].concat(ends.map((e) => e.box))) el.classList.remove('drop');
  };

  function dropSwatches(el, mine, put) {
    el.addEventListener('dragover', (e) => {
      if (!dragging) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = dragging.from === mine ? 'move' : 'copy';
      el.classList.add('drop');
      showCaret(el, dropIndex(el, e));
    });
    el.addEventListener('dragleave', (e) => {
      if (!el.contains(e.relatedTarget)) { el.classList.remove('drop'); showCaret(el, null); }
    });
    el.addEventListener('drop', (e) => {
      if (!dragging) return;
      e.preventDefault();
      const at = dropIndex(el, e);
      const ink = dragging.ink;
      clearCarets();
      put(ink, at);
    });
  }

  /* Into the palette at a given place. A colour already there is moved
     rather than doubled, which is what makes dragging within the strip a
     reordering; one from elsewhere is a copy. */
  function putInPalette(ink, at) {
    if (!normInk(ink)) return;
    let pal = ownPalette(state.palette);
    if (!pal) {
      // Built-ins stay as printed; take a copy and work on that instead.
      pal = { name: freeName('My ' + state.palette), colors: currentColors().slice() };
      state.palettes.push(pal);
      state.palette = pal.name;
      buildPalettePicker();
      flash(`Copied into “${pal.name}”`);
    }
    const had = pal.colors.indexOf(ink);
    if (had < 0 && pal.colors.length >= 40) return flash('That palette is full');
    const list = pal.colors.slice();
    let k = clamp(at, 0, list.length);
    if (had >= 0) { list.splice(had, 1); if (had < k) k -= 1; }
    list.splice(k, 0, ink);
    pal.colors = list;
    buildPalettePicker();
    buildSwatches();
    saveSoon();
  }

  function putInRecent(ink, at) {
    if (!normInk(ink)) return;
    const list = state.recent.slice();
    const had = list.indexOf(ink);
    let k = clamp(at, 0, list.length);
    if (had >= 0) { list.splice(had, 1); if (had < k) k -= 1; }
    list.splice(k, 0, ink);
    state.recent = list.slice(0, RECENT_MAX);
    buildRecent();
    saveSoon();
  }

  dropSwatches(swatchWrap, 'palette', putInPalette);
  dropSwatches(recentWrap, 'recent', putInRecent);

  /* Taking one out by hand. The strip keeps itself, so this was not needed
     while everything in it arrived by being used — the eleventh colour
     pushed the oldest off the end and that was the whole of it. Dragging
     one in from the palette changed that: something put there on purpose
     should be removable on purpose, rather than waiting for ten newer
     colours to shift it. */
  function dropRecent(idx) {
    if (idx < 0 || idx >= state.recent.length) return;
    state.recent = state.recent.filter((_, i) => i !== idx);
    buildRecent();
    saveSoon();
  }

  const syncRecent = () => markSwatches();

  // The swatch of the ink in hand.
  function markSwatches() {
    for (const b of document.querySelectorAll('.swatch')) {
      b.classList.toggle('on', b.dataset.color === state.color);
    }
  }

  /* Ink the palette does not already hold, newest first and one of each —
     put there once it has been used on the drawing (see noteUsed), or by
     hand when a colour is dragged in. */
  let rememberTimer = 0;
  function remember(ink, asked) {
    if (!ink) return;
    // Ink already on the palette is a click away as it is — unless it was
    // dragged here, which is someone asking for it in as many words.
    if (!asked && currentColors().includes(ink)) return;
    const next = [ink].concat(state.recent.filter((v) => v !== ink)).slice(0, RECENT_MAX);
    if (next.join('|') === state.recent.join('|')) return;
    state.recent = next;
    buildRecent();
    saveSoon();
  }
  /* The strip keeps ink that has been used on the drawing — a mark drawn
     in it, an area filled with it, a mark recoloured to it — and not every
     colour the ink passes through on its way to one: a hex typed, a colour
     dimmed, a gradient set up, a colour taken with the eyedropper waits
     until it has been put down on something. A new mark, or a click of the
     fill tool, is written down the moment it is made: its colour is the
     one that was wanted. A mark recoloured otherwise waits until things
     settle, and is written down only if it
     still wears the colour then — a drag of the alpha, or of the system
     picker, across something held passes through forty colours, and only
     the one it stops at is on a mark by then. Undo, redo and opening a
     drawing do not come through here, so bringing ink back is not using
     it. */
  let usedSoon = new Set();
  function noteUsed(marks, now) {
    for (const sh of marks) {
      if (sh.color) usedSoon.add(sh.color);
      if (sh.fillColor) usedSoon.add(sh.fillColor);
    }
    if (!usedSoon.size) return;
    clearTimeout(rememberTimer);
    if (now) usedNow();
    else rememberTimer = setTimeout(usedNow, 700);
  }
  function usedNow() {
    clearTimeout(rememberTimer);
    if (!usedSoon.size) return;
    const onPaper = new Set();
    for (const sh of state.shapes) {
      if (sh.color) onPaper.add(sh.color);
      if (sh.fillColor) onPaper.add(sh.fillColor);
    }
    const used = [...usedSoon].filter((ink) => onPaper.has(ink));
    usedSoon = new Set();
    for (const ink of used) remember(ink);
  }

  // The marks in `next` that are new, or wear a colour they did not before.
  function changedMarks(prev, next) {
    const was = new Map(prev.map((sh) => [sh.id, sh]));
    return next.filter((sh) => {
      const old = was.get(sh.id);
      return !old || old.color !== sh.color || old.fillColor !== sh.fillColor;
    });
  }

  /* The mixer always shows the ink in hand — except the hex field while
     it is being typed into, which would fight the cursor. With a gradient
     in hand the flat mixer and its alpha give way to the gradient's own,
     and the + goes with the ink, beside the sweep: it keeps the whole of
     it. Each end of the sweep has an eyedropper of its own. */
  function syncMixer(quiet) {
    const hex = state.color;
    const g = parseInk(hex);
    const a = alphaOf(hex);
    mixPreview.style.background = inkCss(hex);
    hexPick.value = rgbOf(hex);
    document.getElementById('inkFlat').hidden = !!g;
    const tools = document.getElementById(g ? 'gradTools' : 'inkTools');
    const add = document.getElementById('addSwatch');
    if (add.parentNode !== tools) tools.append(add);
    syncGrad(g, quiet);
    markSwatches();
    syncAcross();
    alphaInput.value = Math.round((a / 255) * 100);
    alphaVal.textContent = alphaInput.value;
    if (!quiet && document.activeElement !== hexInput) {
      // The field edits the stop the sweep starts from, not the text of
      // the whole gradient — the row below owns the rest of it.
      hexInput.value = g ? g.stops[0] : hex;
      hexInput.classList.remove('bad');
    }
  }

  function usePalette(name) {
    // The name row is editing one particular palette; switching away
    // from it would leave Rename pointed at something else entirely.
    closeNameRow();
    state.palette = activePaletteName(name);
    buildPalettePicker();
    buildSwatches();
    saveSoon();
  }
  function activePaletteName(name) {
    return (ownPalette(name) || BUILT_IN.find((p) => p.name === name) || BUILT_IN[0]).name;
  }

  // The button puts it on the end; a drop says where.
  const addSwatch = () => addToPalette(state.color);

  function addToPalette(hex) {
    if (!normInk(hex)) return;
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
    // A palette may be emptied right out: it can be made that way, so
    // there is nothing to protect by refusing the last one.
    if (!pal || !pal.colors.length) return;
    pal.colors.splice(idx, 1);
    buildPalettePicker();
    buildSwatches();
    saveSoon();
  }

  /* The one row does both jobs: naming a palette that does not exist
     yet, and renaming one that does. Which it is doing is held here, so
     Save and Enter do not each have to work it out again. */
  let naming = null;   // null, 'new', or the palette being renamed

  function openNameRow(what) {
    naming = what;
    palNameRow.hidden = false;
    palNameInput.value = what === 'new' ? freeName('My palette') : what.name;
    palSaveBtn.textContent = what === 'new' ? 'Save' : 'Rename';
    palNameInput.focus();
    palNameInput.select();
  }
  function closeNameRow() { palNameRow.hidden = true; naming = null; }

  function commitName() {
    if (!naming) return;
    const name = palNameInput.value.trim().slice(0, 22);
    if (!name) { palNameInput.focus(); return flash('Give the palette a name'); }
    if (naming !== 'new') {
      const pal = naming;
      const was = pal.name;
      pal.name = freeName(name, pal);
      // The palette in use is named, not pointed at, so it has to follow.
      if (state.palette === was) state.palette = pal.name;
      closeNameRow();
      buildPalettePicker();
      saveSoon();
      return flash(`“${was}” is now “${pal.name}”`);
    }
    // Empty: a new palette is somewhere to put colours, not a copy of
    // the ones already to hand. `+` fills it, and the ten recently used
    // slots underneath are where they come from.
    const pal = { name: freeName(name), colors: [] };
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
    if (naming === pal) closeNameRow();
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
    if (naming === 'new') closeNameRow(); else openNameRow('new');
  });
  palRenameBtn.addEventListener('click', () => {
    const pal = ownPalette(state.palette);
    if (!pal) return flash('The built-in palettes keep their names');
    if (naming === pal) closeNameRow(); else openNameRow(pal);
  });
  palSaveBtn.addEventListener('click', commitName);
  document.getElementById('palCancel').addEventListener('click', closeNameRow);
  palNameInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); commitName(); }
    if (e.key === 'Escape') { e.preventDefault(); closeNameRow(); }
  });
  palDelBtn.addEventListener('click', deletePalette);
  document.getElementById('addSwatch').addEventListener('click', addSwatch);
  document.getElementById('dropBtn').addEventListener('click', () => armDropper(!dropper));

  hexInput.addEventListener('input', () => {
    const hex = normHex(hexInput.value);
    hexInput.classList.toggle('bad', !hex && hexInput.value.trim() !== '');
    if (!hex) return;
    // With a gradient in hand the field is its first stop, not the ink.
    const g = parseInk(state.color);
    setColor(g ? gradText({ ...g, stops: [hex].concat(g.stops.slice(1)) }) : hex, true);
  });
  hexInput.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') { e.preventDefault(); hexInput.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); hexInput.blur(); }
  });
  hexInput.addEventListener('blur', () => { hexInput.classList.remove('bad'); syncMixer(); });
  hexPick.addEventListener('input', () => setColor(withAlpha(hexPick.value, alphaOf(state.color))));

  /* ---------------- gradient ---------------- */

  const gradBody = document.getElementById('gradBody');
  const gradOn = document.getElementById('gradOn');
  const gradAngle = document.getElementById('gradAngle');
  const gradDial = document.getElementById('gradDial');

  /* Each end of the sweep keeps everything that belongs to it together:
     its well, its hex, the system picker and its own alpha. They used to
     be scattered — the start's in the flat mixer at the top with its alpha
     under it, the end's in a row further down, the width slider between —
     so no one end could be seen whole. */
  const ends = [0, 1].map((i) => ({
    box: document.getElementById(`gradStop${i}`),
    well: document.getElementById(`gradWell${i}`),
    hex: document.getElementById(`gradHex${i}`),
    pick: document.getElementById(`gradPick${i}`),
    drop: document.getElementById(`gradDrop${i}`),
    alpha: document.getElementById(`gradAlpha${i}`),
    alphaVal: document.getElementById(`gradAlphaVal${i}`),
  }));
  let gradEnd = 1;     // the end whose eyedropper is out

  // The two ends of a sweep, whatever a file may carry between them.
  const endsOf = (g) => [g.stops[0], g.stops[g.stops.length - 1]];

  /* What the sweep was last set to. Switching the gradient off leaves
     only the colour it started from, so without this, switching it back
     on would rebuild a default and quietly throw away the angle, the
     anchor and the colour it faded to. */
  let lastGrad = null;

  function syncGrad(g, quiet) {
    if (g) lastGrad = g;
    gradOn.classList.toggle('on', !!g);
    gradBody.hidden = !g;
    if (!g) return;
    const two = endsOf(g);
    ends.forEach((e, i) => {
      const c = two[i];
      e.well.querySelector('i').style.background = c;
      e.pick.value = rgbOf(c);
      e.alpha.value = Math.round((alphaOf(c) / 255) * 100);
      e.alphaVal.textContent = e.alpha.value;
      if (!quiet && document.activeElement !== e.hex) {
        e.hex.value = c;
        e.hex.classList.remove('bad');
      }
    });
    if (document.activeElement !== gradAngle) gradAngle.value = g.deg;
    // The dial: the sweep as it will fall, CSS's angle being ours a quarter on.
    document.getElementById('gradDialInk').style.background = `linear-gradient(${g.deg + 90}deg, ${two.join(', ')})`;
    document.getElementById('gradDialHand').setAttribute('transform', `rotate(${g.deg})`);
    gradDial.setAttribute('aria-valuenow', String(g.deg));
  }

  // Change one part of the sweep and leave the rest as it was.
  function editGrad(patch) {
    const g = parseInk(state.color);
    if (!g) return;
    setColor(gradText({ ...g, ...patch }));
  }

  // One end of the sweep set, the other left as it was.
  function setEnd(i, c, quiet) {
    const g = parseInk(state.color);
    if (!g) return;
    const stops = g.stops.slice();
    stops[i ? stops.length - 1 : 0] = c;
    setColor(gradText({ ...g, stops }), quiet);
  }

  /* A colour taken with the eyedropper. With a gradient in hand it fills
     the end whose eyedropper it was, and the sweep stays. */
  function takeInk(value) {
    const ink = normInk(value);
    if (!ink) return;
    if (parseInk(state.color) && !parseInk(ink)) setEnd(gradEnd, ink);
    else setColor(ink);
  }

  /* A swatch — from the palette, the recent strip or a number key — is
     the ink it shows, whole: a plain colour puts the gradient away and a
     gradient brings it out, and the switch follows either way. The sweep
     put away is remembered, so switching back on returns it. A swatch
     goes into one end of a sweep by being dragged there. */
  function takeSwatch(value) {
    const ink = normInk(value);
    if (ink) setColor(ink);
  }

  gradOn.addEventListener('click', () => {
    const g = parseInk(state.color);
    // Switching it off keeps the colour it started from, so the ink does
    // not jump. Switching it on comes back to the sweep that was there
    // before, or — the first time — runs from the ink in hand, at full
    // strength, to its complement, also at full strength, so there is a
    // sweep to see the moment it is switched on.
    if (g) return setColor(g.stops[0]);
    const was = lastGrad;
    setColor(gradText({
      deg: was ? was.deg : 90,
      // The near stop is the ink in hand: that is what the switch was
      // showing while the gradient was off, and it may have been changed
      // since.
      stops: was
        ? [state.color].concat(was.stops.slice(1))
        : [rgbOf(state.color), complement(state.color)],
    }));
  });

  ends.forEach((e, i) => {
    // A plain swatch dragged from either strip onto an end fills it: the
    // way a sweep is mixed from the palette, now that a click on a swatch
    // takes its ink whole.
    const fills = () => dragging && !parseInk(dragging.ink) && parseInk(state.color);
    e.box.addEventListener('dragover', (ev) => {
      if (!fills()) return;
      ev.preventDefault();
      ev.dataTransfer.dropEffect = 'copy';
      e.box.classList.add('drop');
    });
    e.box.addEventListener('dragleave', (ev) => {
      if (!e.box.contains(ev.relatedTarget)) e.box.classList.remove('drop');
    });
    e.box.addEventListener('drop', (ev) => {
      if (!fills()) return;
      ev.preventDefault();
      e.box.classList.remove('drop');
      setEnd(i, dragging.ink);
    });
    e.drop.addEventListener('click', () => {
      gradEnd = i;
      armDropper(!(dropper && e.drop.classList.contains('armed')), e.drop);
    });
    e.hex.addEventListener('input', () => {
      const hex = normHex(e.hex.value);
      e.hex.classList.toggle('bad', !hex && e.hex.value.trim() !== '');
      if (hex) setEnd(i, hex, true);
    });
    e.hex.addEventListener('keydown', (ev) => {
      ev.stopPropagation();
      if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); e.hex.blur(); }
    });
    e.hex.addEventListener('blur', () => { e.hex.classList.remove('bad'); syncMixer(); });
    e.pick.addEventListener('input', () => {
      const g = parseInk(state.color);
      if (g) setEnd(i, withAlpha(e.pick.value, alphaOf(endsOf(g)[i])));
    });
    /* Either end may fade all the way to nothing — a fade that stops just
       short leaves a visible edge where it ends — but not both at once,
       which would be ink no one could find again. */
    e.alpha.addEventListener('input', () => {
      const g = parseInk(state.color);
      if (!g) return;
      const two = endsOf(g);
      let v = +e.alpha.value;
      if (v === 0 && alphaOf(two[1 - i]) === 0) v = 1;
      setEnd(i, withAlpha(two[i], (v / 100) * 255));
      sliderRun = true;
    });
    e.alpha.addEventListener('change', () => { sliderRun = false; });
  });

  // The two ends change places.
  document.getElementById('gradSwap').addEventListener('click', () => {
    const g = parseInk(state.color);
    if (!g) return;
    setColor(gradText({ ...g, stops: g.stops.slice().reverse() }));
    flash('Ends swapped');
  });
  // The degrees, typed. A field part way through being typed is left alone.
  gradAngle.addEventListener('input', () => {
    const v = parseFloat(gradAngle.value);
    if (!isFinite(v)) return;
    editGrad({ deg: ((Math.round(v) % 360) + 360) % 360 });
    sliderRun = true;
  });
  gradAngle.addEventListener('keydown', (ev) => {
    ev.stopPropagation();
    if (ev.key === 'Enter' || ev.key === 'Escape') { ev.preventDefault(); gradAngle.blur(); }
  });
  gradAngle.addEventListener('blur', () => syncMixer());

  /* The angle, turned by hand. Drag anywhere on the dial and the sweep
     points from its middle to the pointer — five degrees at a time, or to
     the nearest eighth with Alt, the way a line is held to 45°. A drag is
     one step to undo, like a slider run. Focused, the arrow keys step it,
     and are kept from nudging whatever is held on the plane as well. */
  const dialAngle = (ev) => {
    const r = gradDial.getBoundingClientRect();
    const a = (Math.atan2(ev.clientY - (r.top + r.height / 2), ev.clientX - (r.left + r.width / 2)) * 180) / Math.PI;
    const step = ev.altKey || ev.ctrlKey ? 45 : 5;
    return (((Math.round(a / step) * step) % 360) + 360) % 360;
  };
  gradDial.addEventListener('pointerdown', (ev) => {
    if (!parseInk(state.color)) return;
    ev.preventDefault();
    gradDial.focus();
    gradDial.setPointerCapture(ev.pointerId);
    gradDial.classList.add('turning');
    sliderRun = false;
    editGrad({ deg: dialAngle(ev) });
    sliderRun = true;
  });
  gradDial.addEventListener('pointermove', (ev) => {
    if (!gradDial.hasPointerCapture(ev.pointerId)) return;
    const g = parseInk(state.color);
    const deg = dialAngle(ev);
    if (g && g.deg !== deg) editGrad({ deg });
  });
  const dialDone = () => { gradDial.classList.remove('turning'); sliderRun = false; };
  gradDial.addEventListener('pointerup', dialDone);
  gradDial.addEventListener('pointercancel', dialDone);
  gradDial.addEventListener('keydown', (ev) => {
    const way = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[ev.key];
    if (!way) return;
    ev.preventDefault();
    ev.stopPropagation();
    const g = parseInk(state.color);
    if (!g) return;
    const step = ev.shiftKey ? 45 : 5;
    editGrad({ deg: (((Math.round(g.deg / step) + way) * step) % 360 + 360) % 360 });
  });

  /* What a sweep lies across is set for the marks to come and, with
     something held, on every stroke and fill held that wears one. */
  document.getElementById('acrossModes').addEventListener('click', (e) => {
    const b = e.target.closest('[data-across]');
    if (!b) return;
    state.across = b.dataset.across;
    if (typing) retype();
    const tile = state.across === 'tile' ? 'tile' : undefined;
    applyToHeld((sh) => {
      let next = null;
      for (const slot of ['color', 'fillColor']) {
        if (parseInk(sh[slot]) && acrossOf(sh, slot) !== state.across) {
          next = Object.assign(next || Object.assign({}, sh), { [ACROSS[slot]]: tile });
        }
      }
      return next;
    });
    syncAcross();
    saveSoon();
  });

  /* ---------------- the sliders, with something in hand ---------------- */

  /* A slider run is one step to undo, not one per pixel of travel: the
     first change in a drag records where it started and the rest write
     over it. `change` closes the run, which covers both the mouse coming
     up and the arrow keys. */
  function applyToHeld(fn) {
    const held = heldMarks();
    if (!held.length) return;
    const swap = new Map();
    for (const sh of held) {
      if (sh.kind === 'image') continue;     // a picture takes no ink
      const next = fn(sh);
      if (next) swap.set(sh, next);
    }
    if (!swap.size) return;
    replaceShapes(state.shapes.map((sh) => swap.get(sh) || sh), sliderRun);
    select(picked.map((sh) => swap.get(sh) || sh));
  }

  alphaInput.addEventListener('input', () => {
    alphaVal.textContent = alphaInput.value;
    const a = (+alphaInput.value / 100) * 255;
    // Each mark keeps its own colour and only loses opacity — setting
    // them all to the ink in hand is what picking a colour is for.
    applyToHeld((sh) => {
      const color = withAlpha(sh.color, a);
      const fillColor = sh.fillColor ? withAlpha(sh.fillColor, a) : undefined;
      if (color === sh.color && fillColor === sh.fillColor) return null;
      return Object.assign({}, sh, fillColor === undefined ? { color } : { color, fillColor });
    });
    setColor(withAlpha(state.color, a), false, true);
    sliderRun = true;
  });

  document.getElementById('width').addEventListener('input', (e) => {
    setWidth(clamp(Math.round(+e.target.value), 1, 64));
    // What is held takes the thickness as it looks at this zoom, too.
    const w = penWidth();
    applyToHeld((sh) => (sh.layer === 'stroke' && !sh.filled && sh.width !== w
      ? Object.assign({}, sh, { width: w })
      : null));
    sliderRun = true;
  });

  /* How far the pencil tidies a stroke as it is let go. A setting of the
     hand rather than of the picture, so it is kept with the table, not
     written into the drawing. */
  const smoothInput = document.getElementById('smooth');
  function syncSmooth() {
    smoothInput.value = state.smooth;
    document.getElementById('smoothVal').textContent = state.smooth;
  }
  smoothInput.addEventListener('input', () => {
    state.smooth = clamp(Math.round(+smoothInput.value), 0, 100);
    syncSmooth();
    saveSoon();
  });

  /* The text controls. Each hands the keyboard back to the tile as it is
     let go: a range or a button keeps the focus once it has been used,
     and every letter typed after that would go to it rather than to what
     is being typed. Size and face are read afresh whenever the letters
     are traced, so both answer while a word is half typed. */
  const typeSizeInput = document.getElementById('typeSize');
  const faceSel = document.getElementById('typeFace');
  const FIND_FACES = '\u0000find';

  /* The picker. The three faces are always in it; under them go whatever
     families this computer holds, once it has been asked for them —
     which it is only when the last entry is chosen, since asking raises
     a permission of the browser's own and that should follow from
     something the hand did rather than from opening a drawing.

     A family chosen before is kept in the list whether or not it has
     been asked for again, so a drawing opened on a fresh morning still
     says what it was set in. The letters are traced either way, so a
     face that has since gone off the machine costs the marks nothing —
     only a re-cut would fall back to the plain sans. */
  function buildFaces() {
    const chosen = state.typeFace;
    faceSel.innerHTML = '';
    const add = (to, value, label) => {
      const o = document.createElement('option');
      o.value = value;
      o.textContent = label;
      to.appendChild(o);
    };
    for (const k of ['sans', 'serif', 'mono']) add(faceSel, k, FACE_NAMES[k]);
    const named = localFaces.slice();
    if (!FACES[chosen] && !named.includes(chosen)) named.unshift(chosen);
    if (named.length) {
      const g = document.createElement('optgroup');
      g.label = 'On this computer';
      for (const f of named) add(g, f, f);
      faceSel.appendChild(g);
    }
    if (window.queryLocalFonts && !localFaces.length) {
      add(faceSel, FIND_FACES, named.length ? 'Look again\u2026' : 'Fonts on this computer\u2026');
    }
    faceSel.value = chosen;
  }

  async function findFaces() {
    try {
      const got = await window.queryLocalFonts();
      const seen = new Set();
      localFaces = [];
      for (const f of got) if (f.family && !seen.has(f.family)) { seen.add(f.family); localFaces.push(f.family); }
      localFaces.sort((a, b) => a.localeCompare(b));
      buildFaces();
      flash(localFaces.length
        ? `${localFaces.length} faces on this computer`
        : 'No faces came back');
    } catch (err) {
      // Refused, or the browser has no such thing. Either way the three
      // faces are still there and nothing is broken.
      flash('The browser did not hand its fonts over');
    }
  }

  function syncType() {
    typeSizeInput.value = state.typeSize;
    document.getElementById('typeSizeVal').textContent = state.typeSize;
    if (faceSel.value !== state.typeFace) buildFaces();
  }
  typeSizeInput.addEventListener('input', () => {
    state.typeSize = clamp(Math.round(+typeSizeInput.value), 20, 400);
    syncType();
    if (typing) retype();
    saveSoon();
  });
  typeSizeInput.addEventListener('change', () => typeSizeInput.blur());
  faceSel.addEventListener('change', () => {
    if (faceSel.value === FIND_FACES) {
      faceSel.value = state.typeFace;
      faceSel.blur();
      findFaces();
      return;
    }
    state.typeFace = faceSel.value;
    if (typing) retype();
    faceSel.blur();
    saveSoon();
  });
  for (const id of ['typeBoldBtn', 'typeItalicBtn']) {
    document.getElementById(id).addEventListener('click', (e) => {
      // `toggle` has already flipped it; this only takes the focus back.
      if (typing) retype();
      e.currentTarget.blur();
    });
  }

  // Letting go of any slider closes its run, so the next one is its own
  // step to undo.
  for (const el of [alphaInput, document.getElementById('width'), gradAngle]) {
    el.addEventListener('change', () => { sliderRun = false; });
  }
  for (const b of document.querySelectorAll('[data-toggle]')) {
    b.addEventListener('click', () => toggle(b.dataset.toggle));
  }

  /* warp ---------------------------------------------------------- */

  /* Anchors on the plane and the rail that works on them; what an anchor
     does is in warp.js. Every change replaces `state.warp` whole and goes
     on the undo stack with the marks. A slider run or a drag is one step,
     as it is for ink. */

  let warpSel = -1;      // the anchor in hand
  let warpDrag = null;   // an anchor being moved or sized, or a press that may yet drop one

  const warpAmount = document.getElementById('warpAmount');
  const warpBulge = document.getElementById('warpBulge');
  const warpTwirl = document.getElementById('warpTwirl');
  const warpRadius = document.getElementById('warpRadius');
  const DOT_R = 10;      // how near a press has to come to an anchor's dot

  function cleanWarp(w) {
    const out = { amount: 1, repeat: 'plane', ink: 'swell', anchors: [] };
    if (!w || typeof w !== 'object') return out;
    if (typeof w.amount === 'number' && isFinite(w.amount)) out.amount = clamp(w.amount, 0, 1);
    if (w.repeat === 'tile') out.repeat = 'tile';
    if (w.ink === 'bend') out.ink = 'bend';
    if (Array.isArray(w.anchors)) {
      out.anchors = w.anchors
        .filter((a) => a && [a.x, a.y, a.r].every((v) => typeof v === 'number' && isFinite(v)))
        .slice(0, 64)
        .map((a) => ({
          x: a.x, y: a.y, r: clamp(a.r, 10, 5000),
          bulge: clamp(+a.bulge || 0, -1, 1), twirl: clamp(+a.twirl || 0, -1, 1),
        }));
    }
    return out;
  }

  function setWarp(next, merge) {
    if (!merge) pushStep();
    state.warp = next;
    afterChange();
    syncWarpPanel();
  }

  const withAnchor = (k, patch) => ({
    ...state.warp,
    anchors: state.warp.anchors.map((a, i) => (i === k ? { ...a, ...patch } : a)),
  });

  const inSquare = (q) => ({ x: clamp(q.x, 0, T), y: clamp(q.y, 0, T) });

  /* Where anchor k has to go for its dot to show under the screen point
     `s` — in square (i, j)'s own frame where anchors repeat. Aimed rather
     than simply taken back through the warp, so that it lands under the
     hand inside another anchor's disc as well. */
  function aimAt(spec, k, i, j, s) {
    const own = (q) => (i == null ? { x: q.x, y: q.y } : inSquare(unplaceIn(q, i, j)));
    return own(aimAnchor(spec, state.pattern, k, toPlane(s.x, s.y), own));
  }

  // Every anchor at every place it sits in range, where the warp shows it.
  function anchorHandles(R) {
    const out = [];
    const tiled = state.warp.repeat === 'tile';
    const squares = (R.i1 - R.i0 + 1) * (R.j1 - R.j0 + 1);
    state.warp.anchors.forEach((a, k) => {
      if (!tiled) { out.push({ k, i: null, j: null, c: a, r: a.r }); return; }
      if (squares > 400) return;
      for (let j = R.j0; j <= R.j1; j++) {
        for (let i = R.i0; i <= R.i1; i++) out.push({ k, i, j, c: placeIn(a, i, j), r: a.r });
      }
    });
    for (const h of out) {
      h.at = w2s(h.c.x, h.c.y);
      h.grip = w2s(h.c.x + h.r, h.c.y);
    }
    return out;
  }

  // The rim grip of the anchor in hand, or else the nearest dot.
  function anchorAt(s) {
    let best = null;
    for (const h of anchorHandles(tileRange())) {
      if (h.k === warpSel && Math.hypot(h.grip.x - s.x, h.grip.y - s.y) <= SIZE_R) return { h, part: 'rim' };
      const d = Math.hypot(h.at.x - s.x, h.at.y - s.y);
      if (d <= DOT_R && (!best || d < best.d)) best = { h, part: 'centre', d };
    }
    return best;
  }

  /* A dot on each anchor, and a ring for its disc: round every anchor on
     the plane, and round the one in hand where anchors repeat — a ring in
     every square would bury the drawing. The one in hand has a grip on
     its rim for the radius. */
  function drawAnchors(R) {
    const tiled = state.warp.repeat === 'tile';
    ctx.save();
    for (const h of anchorHandles(R)) {
      const held = h.k === warpSel;
      if (held || !tiled) {
        ctx.beginPath();
        traceRun(circleRun(h.c, h.r));
        ctx.setLineDash(held ? [6, 4] : [2, 4]);
        ctx.lineWidth = held ? 1.5 : 1;
        ctx.strokeStyle = held ? ACCENT : 'rgba(23,22,15,0.5)';
        ctx.stroke();
        ctx.setLineDash([]);
      }
      ctx.beginPath();
      ctx.arc(h.at.x, h.at.y, held ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = held ? ACCENT : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#17160f';
      ctx.stroke();
      if (held) {
        ctx.beginPath();
        ctx.rect(h.grip.x - GRIP, h.grip.y - GRIP, GRIP * 2, GRIP * 2);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.lineWidth = 1;
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  function startWarp(s) {
    const hit = anchorAt(s);
    if (hit) {
      warpSel = hit.h.k;
      warpDrag = { kind: hit.part, h: hit.h, press: s, moved: false, pushed: false };
      syncWarpPanel();
      requestDraw();
      return;
    }
    warpDrag = { kind: 'press', press: s, vx: state.view.x, vy: state.view.y, moved: false };
  }

  function moveWarp(s) {
    const d = warpDrag;
    if (!d.moved && Math.hypot(s.x - d.press.x, s.y - d.press.y) < DRAG_MIN) return;
    d.moved = true;
    if (d.kind === 'press') {
      // Pressed on bare paper and pulled: the plane pans.
      state.view.x = d.vx + s.x - d.press.x;
      state.view.y = d.vy + s.y - d.press.y;
      canvas.classList.add('panning');
      requestDraw();
      return;
    }
    const k = d.h.k;
    if (d.kind === 'centre') {
      setWarp(withAnchor(k, aimAt(state.warp, k, d.h.i, d.h.j, s)), d.pushed);
    } else {
      // A disc leaves its own rim where it is, so the rim is read back
      // through every anchor but this one.
      const a = state.warp.anchors[k];
      const w = makeWarp(state.warp, state.pattern, k).unwarp(toPlane(s.x, s.y));
      const c = d.h.i == null ? a : placeIn(a, d.h.i, d.h.j);
      setWarp(withAnchor(k, { r: clamp(Math.hypot(w.x - c.x, w.y - c.y), 10, 5000) }), d.pushed);
    }
    d.pushed = true;
  }

  // `landed` is false when the press was taken away rather than let go.
  function endWarp(landed) {
    const d = warpDrag;
    warpDrag = null;
    canvas.classList.remove('panning');
    if (d.kind === 'press' && !d.moved && landed) dropAnchor(d.press);
    requestDraw();
  }

  function dropAnchor(s) {
    const w = toWorld(s.x, s.y);
    const tiled = state.warp.repeat === 'tile';
    const c = tiled ? cellOf(w) : { i: null, j: null };
    const { i, j } = c;
    const at = tiled ? unplaceIn(w, i, j) : w;
    const anchors = state.warp.anchors.concat([
      { x: at.x, y: at.y, r: tiled ? 250 : 400, bulge: 0.5, twirl: 0 },
    ]);
    const k = anchors.length - 1;
    anchors[k] = { ...anchors[k], ...aimAt({ ...state.warp, anchors }, k, i, j, s) };
    warpSel = k;
    setWarp({ ...state.warp, anchors });
    flash(state.warp.amount > 0
      ? 'Anchor dropped — drag its dot to move it, the square on its rim to size it'
      : 'Anchor dropped — but the warp amount is at nothing, so it has nothing to show');
  }

  function removeAnchor() {
    if (!state.warp.anchors[warpSel]) return;
    const k = warpSel;
    warpSel = -1;
    setWarp({ ...state.warp, anchors: state.warp.anchors.filter((a, i) => i !== k) });
    flash('Anchor removed');
  }

  function syncWarpPanel() {
    const w = state.warp;
    warpAmount.value = Math.round(w.amount * 100);
    document.getElementById('warpAmountVal').textContent = warpAmount.value;
    for (const b of document.getElementById('warpRepeat').children) b.classList.toggle('on', b.dataset.repeat === w.repeat);
    for (const b of document.getElementById('warpInk').children) b.classList.toggle('on', b.dataset.ink === w.ink);
    const a = w.anchors[warpSel];
    const none = document.getElementById('warpNone');
    document.getElementById('warpAnchor').hidden = !a;
    none.hidden = !!a;
    const count = w.anchors.length;
    // Shown only while the warp tool is in hand, so it need not ask for it.
    none.textContent = count
      ? `${count} ${count === 1 ? 'anchor' : 'anchors'} · click a dot to hold one, or the paper for another`
      : 'Click the paper to drop an anchor.';
    if (!a) return;
    warpBulge.value = Math.round(a.bulge * 100);
    document.getElementById('warpBulgeVal').textContent = warpBulge.value;
    warpTwirl.value = Math.round(a.twirl * 100);
    document.getElementById('warpTwirlVal').textContent = warpTwirl.value;
    warpRadius.value = Math.round(a.r);
    document.getElementById('warpRadiusVal').textContent = Math.round(a.r);
  }

  warpAmount.addEventListener('input', () => {
    setWarp({ ...state.warp, amount: +warpAmount.value / 100 }, sliderRun);
    sliderRun = true;
  });
  const anchorSlider = (el, read) => el.addEventListener('input', () => {
    if (!state.warp.anchors[warpSel]) return;
    setWarp(withAnchor(warpSel, read(+el.value)), sliderRun);
    sliderRun = true;
  });
  anchorSlider(warpBulge, (v) => ({ bulge: v / 100 }));
  anchorSlider(warpTwirl, (v) => ({ twirl: v / 100 }));
  anchorSlider(warpRadius, (v) => ({ r: v }));
  for (const el of [warpAmount, warpBulge, warpTwirl, warpRadius]) {
    el.addEventListener('change', () => { sliderRun = false; });
  }

  /* Switching how anchors sit keeps each where it was as near as it can:
     one on the plane goes into the square it was over, and one in a
     square comes out at that square's place in the first one. */
  document.getElementById('warpRepeat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-repeat]');
    if (!b || b.dataset.repeat === state.warp.repeat) return;
    const tiled = b.dataset.repeat === 'tile';
    const anchors = tiled
      ? state.warp.anchors.map((a) => ({
        ...a, ...unplaceIn(a, cellOf(a).i, cellOf(a).j), r: Math.min(a.r, T),
      }))
      : state.warp.anchors;
    setWarp({ ...state.warp, repeat: b.dataset.repeat, anchors });
    flash(tiled ? 'Anchors repeat in every square — still a tiling' : 'Anchors sit once on the plane — a lens');
  });

  document.getElementById('warpInk').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ink]');
    if (!b || b.dataset.ink === state.warp.ink) return;
    setWarp({ ...state.warp, ink: b.dataset.ink });
  });

  document.getElementById('warpRemove').addEventListener('click', removeAnchor);

  /* symmetry ------------------------------------------------------ */

  // An arrow is the clearest possible read on which way a tile faces.
  const CELL_ARROW = '<text x="12" y="12" text-anchor="middle" dominant-baseline="central">\u2B06\uFE0F</text>';

  // The tile's own outline, drawn round the arrow and turned with it.
  function cellGlyph(t) {
    if (t.square) return CELL_ARROW;
    const k = 22 / T;
    const pts = t.outline.map((p) => `${(12 + (p.x - t.c0.x) * k).toFixed(2)},${(12 + (p.y - t.c0.y) * k).toFixed(2)}`);
    return `<polygon class="outline" points="${pts.join(' ')}"/>`
      + `<g transform="translate(12 12) scale(0.6) translate(-12 -12)">${CELL_ARROW}</g>`;
  }

  /* The shape of the tile. Every mark on the table was drawn to the one
     there is, so another shape is another drawing: choosing one starts a
     new one, and asks first, in the panel, whether to save what is there
     when it is not already safely in a file. */
  const shapeWrap = document.getElementById('shapes');
  const shapePrompt = document.getElementById('shapeConfirm');
  let shapeAsked = null;

  SHAPE_IDS.forEach((id) => {
    const b = document.createElement('button');
    b.dataset.shape = id;
    b.textContent = TILINGS[id].name;
    b.title = `Draw on a ${TILINGS[id].name.toLowerCase()} tile — starts a new drawing`;
    b.addEventListener('click', () => chooseShape(id));
    shapeWrap.appendChild(b);
  });

  function closeShapePrompt() {
    if (shapePrompt.hidden) return false;
    shapePrompt.hidden = true;
    shapeAsked = null;
    syncSymmetry();
    return true;
  }

  function chooseShape(id) {
    closeShapePrompt();
    if (id === shapeOf(state.pattern)) return;
    cancelDraft();
    select([]);
    requestDraw();
    const unsaved = state.shapes.length && (dirty || !fileNameEl.textContent);
    if (!unsaved) return startNew(false, id);
    shapeAsked = id;
    shapePrompt.hidden = false;
    for (const b of shapeWrap.children) b.classList.toggle('on', b.dataset.shape === id);
    document.getElementById('shapeName').textContent = TILINGS[id].name.toLowerCase();
    document.getElementById('shapeYes').focus();
  }

  document.getElementById('shapeYes').addEventListener('click', async () => {
    const id = shapeAsked;
    // Only start over once the drawing is safely down.
    if (id && await saveProject(false)) startNew(false, id);
  });
  document.getElementById('shapeNo').addEventListener('click', () => {
    if (shapeAsked) startNew(false, shapeAsked);
  });
  document.getElementById('shapeCancel').addEventListener('click', closeShapePrompt);

  // What a fresh drawing on each shape starts with.
  const FIRST_PATTERN = { hex: 'trio', tri: 'rosette' };
  function firstPattern(shape) {
    if (shape === 'square') return { ...DEFAULTS.pattern, cells: DEFAULTS.pattern.cells.slice() };
    const list = presetsFor(shape);
    return patternFromPreset(list.find((p) => p.id === FIRST_PATTERN[shape]) || list[0], shape);
  }

  const presetWrap = document.getElementById('presets');
  const sizeWrap = document.getElementById('sizes');
  const gridWrap = document.getElementById('patternGrid');
  const turnNote = document.getElementById('turnNote');
  const TURN_WORD = { square: 'a quarter', hex: 'a sixth', tri: 'a third' };

  /* The presets and the block sizes belong to the shape, so both are
     laid out again when it changes. A triangle's block holds whole pairs
     of up and down, so it is twice as wide as it is deep, and stops at
     three deep before it outgrows the rail. */
  function buildShapeControls() {
    const shape = shapeOf(state.pattern);
    presetWrap.innerHTML = '';
    presetsFor(shape).forEach((p) => {
      const b = document.createElement('button');
      b.className = 'chip';
      b.dataset.preset = p.id;
      b.textContent = p.name;
      b.addEventListener('click', () => setPattern(patternFromPreset(p, shape)));
      presetWrap.appendChild(b);
    });
    sizeWrap.innerHTML = '';
    const t = tiling();
    (shape === 'tri' ? [1, 2, 3] : [1, 2, 3, 4]).forEach((n) => {
      const b = document.createElement('button');
      b.dataset.size = n;
      b.textContent = n;
      b.title = `${t.per(n)} × ${n} block`;
      b.addEventListener('click', () => {
        if (state.pattern.n === n) return;
        /* A smaller block drops the tiles outside it. The step behind
           holds the old one whole, so the turns come back with undo. */
        setPattern({ shape, n, cells: resizeCells(state.pattern, n) });
      });
      sizeWrap.appendChild(b);
    });
    turnNote.textContent = shape === 'tri'
      ? 'Click a tile to turn it a third. A down triangle is an up one turned, so its arrow leans. The upright arrow is your drawing surface.'
      : `Click a tile to turn it ${TURN_WORD[shape]}. The upright arrow is your drawing surface.`;
    buildPatternGrid();
  }

  function buildPatternGrid() {
    const t = tiling();
    const n = state.pattern.n, per = t.per(n);
    gridWrap.style.gridTemplateColumns = `repeat(${per}, 1fr)`;
    gridWrap.style.maxWidth = per > 4 ? `${Math.round(per * 26 + 20)}px` : '';
    gridWrap.dataset.shape = t.id;
    gridWrap.innerHTML = '';
    const glyph = cellGlyph(t);
    for (let j = 0; j < n; j++) {
      for (let i = 0; i < per; i++) {
        const idx = j * per + i;
        const b = document.createElement('button');
        b.className = 'cell' + (idx === 0 ? ' src' : '');
        b.dataset.idx = idx;
        b.dataset.i = i;
        b.dataset.j = j;
        b.title = idx === 0 ? 'The drawing surface — always upright' : `Tile ${i},${j}`;
        b.innerHTML = `<svg viewBox="0 0 24 24">${glyph}</svg>`;
        if (idx > 0) {
          b.addEventListener('click', () => {
            const cells = state.pattern.cells.slice();
            cells[idx] = (cells[idx] + 1) % t.turns;
            setPattern({ ...state.pattern, cells });
          });
        }
        gridWrap.appendChild(b);
      }
    }
    syncSymmetry();
  }

  function syncSymmetry() {
    const { n } = state.pattern;
    const t = tiling();
    for (const b of gridWrap.children) {
      const deg = t.angle(state.pattern, +b.dataset.i, +b.dataset.j);
      b.querySelector('svg').style.transform = `rotate(${deg}deg)`;
    }
    const id = matchPreset(state.pattern);
    for (const b of presetWrap.children) b.classList.toggle('on', b.dataset.preset === id);
    for (const b of sizeWrap.children) b.classList.toggle('on', +b.dataset.size === n);
    if (!shapeAsked) for (const b of shapeWrap.children) b.classList.toggle('on', b.dataset.shape === t.id);
  }

  /* Put a block in force and show it. The squares are only rebuilt when
     the size changes; turning one keeps the buttons, and with them
     whatever the keyboard was on. Undo comes back through here too. */
  function usePattern(next) {
    const reshaped = shapeOf(next) !== shapeOf(state.pattern);
    const sized = next.n !== state.pattern.n;
    state.pattern = next;
    if (reshaped) buildShapeControls();
    else if (sized) buildPatternGrid();
    else syncSymmetry();
  }

  /* Changing the symmetry is an edit of the drawing like any other: it
     goes on the stack, it marks the table dirty, and undo takes it back.
     A block is replaced rather than turned in place, so the step behind
     it still holds the one it was made with. */
  function setPattern(next) {
    pushStep();
    usePattern(next);
    afterChange();
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

  /* A new drawing starts where a first one would: the same symmetry, the
     same grid, the same ink. Anything a drawing carries is a setting of
     that drawing and goes with it — but the palettes and the recently
     mixed strip belong to the table rather than to any one picture, so
     they stay put. The view is put back too, since a clean tile at the
     zoom and corner of the last one is not a clean start. */
  function startNew(quiet, shape) {
    closeNewPrompt();
    closeShapePrompt();
    // A new drawing keeps the shape of tile in use, unless it was asked
    // for because of another.
    state.pattern = firstPattern(shape || shapeOf(state.pattern));
    buildShapeControls();
    state.grid = DEFAULTS.grid;
    state.arrows = DEFAULTS.arrows;
    state.snap = DEFAULTS.snap;
    state.subLast = DEFAULTS.subLast;
    state.filled = DEFAULTS.filled;
    state.typeSize = DEFAULTS.typeSize;
    state.typeFace = DEFAULTS.typeFace;
    state.typeBold = DEFAULTS.typeBold;
    state.typeItalic = DEFAULTS.typeItalic;
    syncType();
    setDiag(DEFAULTS.diag, true);
    setWidth(DEFAULTS.width);
    state.across = DEFAULTS.across;
    setColor(DEFAULTS.color, false, true);
    setSub(DEFAULTS.sub);
    state.view = { ...DEFAULTS.view };
    if (cw) resetView();
    state.warp = DEFAULTS.warp;
    warpSel = -1;
    syncWarpPanel();
    syncToggles();
    adoptShapes([]);
    setFile(null, '');
    setDirty(false);
    if (!quiet) {
      flash(shape ? `New drawing on a ${TILINGS[shape].name.toLowerCase()} tile — a clean tile and no history`
        : 'New drawing — a clean tile and no history');
    }
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

     A .tesselate.json holds the artwork and nothing else: the marks, the
     symmetry block they repeat under, and the three plane settings that
     change what the pattern looks like. Which tool is in hand, the
     lattice, the palette — none of that belongs to the drawing.

     Where the browser has the File System Access API, the handle of the
     file that was opened or saved is kept, so Save writes back to it
     without asking again; the handle is stashed in IndexedDB so it
     survives a reload. Everywhere else Save falls back to a download.
     (The pattern is lifted from swimlane-studio, which does the same
     for its diagram source.) */

  const FORMAT = 'tesselate';
  const fileNameEl = document.getElementById('fileName');
  let fileHandle = null;
  let dirty = false;

  const HANDLE_DB = 'tesselate';
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
      plane: {
        grid: state.grid, arrows: state.arrows, snap: state.snap,
        sub: state.sub, subLast: state.subLast, diag: state.diag, warp: state.warp,
      },
      ink: {
        color: state.color, across: state.across, width: state.width, filled: state.filled,
        typeSize: state.typeSize, typeFace: state.typeFace,
        typeBold: state.typeBold, typeItalic: state.typeItalic,
      },
      palette: {
        name: state.palette,
        palettes: state.palettes,
        recent: state.recent,
      },
    };
    const lines = Object.entries(head).map(([k, v]) => ` ${JSON.stringify(k)}: ${JSON.stringify(v)}`);
    const marks = state.shapes.map((sh) => '  ' + JSON.stringify(sh)).join(',\n');
    return '{\n' + lines.join(',\n') + ',\n "shapes": [\n' + marks + '\n ]\n}\n';
  }

  const JSON_TYPES = [{ description: 'Tesselate drawing', accept: { 'application/json': ['.json'] } }];
  /* The name a save should carry. With a handle it is that file's. With
     none — no picker, so the drawing goes to the downloads folder — Save
     keeps offering the name it last used, which is as near as a download
     gets to writing back over something; Save as asks for a fresh one. */
  let lastName = '';
  const suggestName = (asNew) => (fileHandle && fileHandle.name)
    || (!asNew && lastName) || `tesselate-${stamp()}.json`;

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
    const marks = d.shapes.filter(soundMark);
    if (!marks.length) return flash('No marks in that file');

    /* A file from before there were shapes has none, and is squares. Its
       marks were drawn to that shape, so the shape comes with them even
       when the turns do not hold together. */
    const p = validPattern(d.pattern);
    const shape = d.pattern && TILINGS[d.pattern.shape] ? d.pattern.shape : 'square';
    state.pattern = p || (shape !== shapeOf(state.pattern) ? firstPattern(shape) : state.pattern);
    closeShapePrompt();
    buildShapeControls();
    /* A drawing carries the bench it was made at as well as the marks:
       the grid it was drawn to, the ink in hand, and the colours mixed
       for it — which are no use to it sitting in another table's
       storage. Everything is checked on the way in, and anything a file
       does not carry is left as it is, so older ones still open. */
    const plane = d.plane || {};
    for (const f of ['grid', 'arrows', 'snap']) if (typeof plane[f] === 'boolean') state[f] = plane[f];
    if (plane.sub === 0 || SUBS.includes(plane.sub)) state.sub = plane.sub;
    if (SUBS.includes(plane.subLast)) state.subLast = plane.subLast;
    if (DIAG_MODES.some(([id]) => id === plane.diag)) setDiag(plane.diag, true);
    // A warp belongs to the drawing it was set up on. One saved before
    // there was a warp had none, and opens flat.
    state.warp = cleanWarp(plane.warp);
    warpSel = -1;
    syncWarpPanel();

    const pal = d.palette || {};
    if (Array.isArray(pal.palettes)) {
      state.palettes = pal.palettes
        .filter((q) => q && typeof q.name === 'string' && Array.isArray(q.colors))
        .slice(0, 40)
        .map((q) => ({ name: q.name.slice(0, 22), colors: q.colors.map(normInk).filter(Boolean).slice(0, 40) }))
        .filter((q) => q.name);
    }
    if (Array.isArray(pal.recent)) {
      state.recent = pal.recent.map(normInk).filter(Boolean).slice(0, RECENT_MAX);
    }
    if (typeof pal.name === 'string') state.palette = pal.name;
    buildPalettePicker();
    buildSwatches();
    buildRecent();

    const ink = d.ink || {};
    if (typeof ink.filled === 'boolean') state.filled = ink.filled;
    if (typeof ink.typeBold === 'boolean') state.typeBold = ink.typeBold;
    if (typeof ink.typeItalic === 'boolean') state.typeItalic = ink.typeItalic;
    if (typeof ink.typeSize === 'number') state.typeSize = clamp(Math.round(ink.typeSize), 20, 400);
    if (ink.typeFace && typeof ink.typeFace === 'string') state.typeFace = ink.typeFace.slice(0, 80);
    syncType();
    if (typeof ink.width === 'number') setWidth(ink.width);
    const across = ink.across || acrossWritten(ink.color);
    if (across === 'shape' || across === 'tile') state.across = across;
    if (normInk(ink.color)) setColor(ink.color, false, true);

    setSub(state.sub);
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
     write back to that this browser cannot give us. Save as goes with
     it: with nowhere to write back to, every download is already a new
     file, so the second button would only do what the first does. */
  if (!window.showSaveFilePicker) {
    // Only the words change: the glyphs are the buttons now, and writing
    // over them would leave the toolbar blank.
    const say = (id, label, title) => {
      const b = document.getElementById(id);
      b.setAttribute('aria-label', label);
      b.title = title;
    };
    say('loadJson', 'Open a drawing', 'Open a drawing — ⌘O · from the file chooser');
    say('saveJson', 'Download',
      'Download the drawing — ⌘S · this browser has no file picker, '
      + 'so it goes to your downloads under the name it last used');
    document.getElementById('saveJsonAs').hidden = true;
    // The exports drop a file in the same place, so they say the same word.
    say('exportSvg', 'Download SVG', 'Download the tiling as an SVG');
    say('exportPng', 'Download PNG', 'Download the tiling as a PNG');
  }

  document.getElementById('loadJson').addEventListener('click', loadProject);
  document.getElementById('saveJson').addEventListener('click', () => saveProject(false));
  document.getElementById('saveJsonAs').addEventListener('click', () => saveProject(true));

  document.getElementById('exportSvg').addEventListener('click', () => {
    if (!state.shapes.length) return flash('Nothing to save yet');
    download(`tesselate-${stamp()}.svg`, new Blob([buildSvg()], { type: 'image/svg+xml' }));
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
      download(`tesselate-${stamp()}.png`, b);
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
    const R = tileRange();
    const { i0, i1, j0, j1 } = R;
    const n = state.pattern.n;
    const t = tiling();
    // Whole blocks, at least a couple of repeats, so the saved sheet
    // reads as a pattern however far you happen to be zoomed in.
    const span = (a, b) => {
      const least = Math.max(4, n * 2);
      const start = Math.floor(a / n) * n;
      const count = Math.min(20, Math.max(least, Math.ceil((b - start + 1) / n) * n));
      return [start, start + count - 1];
    };
    /* The square's sheet is whole squares. The others' lattices lie
       aslant, so their sheet is the view — at least a couple of blocks
       of it, and no more than twenty tiles — with the tiles at its rim
       cut by its edge. */
    let sheet, cells;
    if (t.square) {
      const [ia, ib] = span(i0, i1);
      const [ja, jb] = span(j0, j1);
      sheet = { x: ia * T, y: ja * T, w: (ib - ia + 1) * T, h: (jb - ja + 1) * T };
      cells = [];
      for (let j = ja; j <= jb; j++) for (let i = ia; i <= ib; i++) cells.push([i, j]);
    } else {
      const least = Math.max(4, n * 2) * T;
      const fit = (a, b) => {
        const c = (a + b) / 2, half = clamp(b - a, least, 20 * T) / 2;
        return [c - half, c + half];
      };
      const [x0, x1] = fit(R.wx0, R.wx1);
      const [y0, y1] = fit(R.wy0, R.wy1);
      sheet = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
      cells = cellsOver({ wx0: x0, wy0: y0, wx1: x1, wy1: y1 }, overhang(state.shapes));
    }
    const w = sheet.w, h = sheet.h;

    /* A gradient goes into the file as a def the marks point at. The
       coordinates are the tile's own, so one def serves every copy the
       sheet instances — the sweep repeats with the square, exactly as it
       does on screen. */
    const defs = [];
    const gradOf = new Map();
    function svgInk(attr, sh, slot) {
      const ink = sh[slot];
      const g = parseInk(ink);
      if (!g) return svgPaint(attr, ink);
      let box = { x0: 0, y0: 0, x1: T, y1: T };
      if (acrossOf(sh, slot) === 'shape') {
        const b = shapeBBox(sh);
        const pad = sh.layer === 'stroke' && !sh.filled ? (sh.width || 0) / 2 : 0;
        if (b) box = { x0: b.x0 - pad, y0: b.y0 - pad, x1: b.x1 + pad, y1: b.y1 + pad };
      }
      const cx = (box.x0 + box.x1) / 2, cy = (box.y0 + box.y1) / 2;
      const t = (g.deg * Math.PI) / 180, ux = Math.cos(t), uy = Math.sin(t);
      const half = (Math.abs((box.x1 - box.x0) * ux) + Math.abs((box.y1 - box.y0) * uy)) / 2;
      if (!(half > 0.01)) return svgPaint(attr, g.stops[0]);
      const num = (v) => +v.toFixed(2);
      const key = `${g.deg}|${g.stops.join(',')}|${num(cx)}|${num(cy)}|${num(half)}`;
      let id = gradOf.get(key);
      if (!id) {
        id = `g${gradOf.size + 1}`;
        gradOf.set(key, id);
        const last = g.stops.length - 1;
        const stops = g.stops.map((c, i) => {
          const a = alphaOf(c);
          return `<stop offset="${+(i / last).toFixed(4)}" stop-color="${rgbOf(c)}"`
            + (a < 255 ? ` stop-opacity="${+(a / 255).toFixed(4)}"` : '') + '/>';
        }).join('');
        defs.push(`<linearGradient id="${id}" gradientUnits="userSpaceOnUse"`
          + ` x1="${num(cx - ux * half)}" y1="${num(cy - uy * half)}"`
          + ` x2="${num(cx + ux * half)}" y2="${num(cy + uy * half)}">${stops}</linearGradient>`);
      }
      return `${attr}="url(#${id})"`;
    }

    /* One square's marks. Handed a square, the copies the warp reaches
       there are written warped, in that square's own frame, and `bent`
       says whether there were any; handed none, it is the plain tile. */
    const order = paintOrder(state.shapes);
    findCrossJunctions();
    const svgWarp = { tol: 0.25, bucket: 'svg', ink: state.warp.ink };
    // Each picture once, however many places show it.
    const pictureIds = new Map();
    let clipSeq = 0;
    const pictureDef = (s) => {
      let id = pictureIds.get(s.src);
      if (!id) {
        id = `picture-${pictureIds.size + 1}`;
        pictureIds.set(s.src, id);
        defs.push(`<image id="${id}" href="${s.src}" xlink:href="${s.src}" width="${s.iw}" height="${s.ih}" preserveAspectRatio="none"/>`);
      }
      return id;
    };
    const marksFor = (at) => {
      const out = [];
      let bent = false;
      for (const entry of order) {
        // A mark's interior comes through on its own, at fill depth.
        const s = entry.inside || entry;
        if (s.kind === 'image') {
          /* The picture goes in once, as the file it came as, and every
             place it shows points at it. Where the warp reaches a copy it
             goes in as the mesh the plane draws: a triangle of it at a
             time, each clipped to where it landed. */
          const id = pictureDef(s);
          const mesh = at ? imageMesh(s, at.i, at.j, true) : null;
          if (!mesh) {
            const m = imageMatrix(s).map((v) => +v.toFixed(6)).join(' ');
            out.push(`<use href="#${id}" xlink:href="#${id}" transform="matrix(${m})"/>`);
            continue;
          }
          bent = true;
          for (const t of mesh) {
            const m = t.m;
            const q = grown(t.d, 0.25);
            const clip = `clip${++clipSeq}`;
            defs.push(`<clipPath id="${clip}"><path d="M${q.map((p) => `${n2(p.x)} ${n2(p.y)}`).join('L')}Z"/></clipPath>`);
            out.push(`<g clip-path="url(#${clip})"><use href="#${id}" xlink:href="#${id}"`
              + ` transform="matrix(${m.map((v) => +v.toFixed(6)).join(' ')})"/></g>`);
          }
          continue;
        }
        const part = entry.inside ? 'inside' : s.fillColor ? 'outline' : undefined;
        const got = at ? warpedCopy(s, part, at.i, at.j, svgWarp) : null;
        if (got) bent = true;
        const d = got ? linesData(got.lines) : pathData(s);
        if (!d) continue;
        if (entry.inside) {
          out.push(`<path d="${d}" ${svgInk('fill', s, 'fillColor')}/>`);
          continue;
        }
        if (s.layer === 'fill') out.push(`<path d="${d}" ${svgInk('fill', s, 'color')} fill-rule="evenodd"/>`);
        // Swelled, a stroke is written as the area it covers.
        else if (s.filled || (got && got.how === 'nonzero')) out.push(`<path d="${d}" ${svgInk('fill', s, 'color')}/>`);
        else {
          const [cap, join] = capsOf(s.kind);
          out.push(`<path d="${d}" fill="none" ${svgInk('stroke', s, 'color')}`
            + ` stroke-width="${s.width}" stroke-linecap="${cap}" stroke-linejoin="${join}"/>`);
          if (got) {
            if (got.discs.length) out.push(`<path d="${linesData(got.discs)}" ${svgInk('fill', s, 'color')}/>`);
          } else if (ROUNDABLE[s.kind]) {
            for (const p of endpointsOf(s)) {
              if (!junctions.has(jkey(p))) continue;
              out.push(`<circle cx="${p.x}" cy="${p.y}" r="${s.width / 2}" ${svgInk('fill', s, 'color')}/>`);
            }
          }
        }
      }
      return { bent, text: out.join('\n      ') };
    };
    const plain = marksFor(null).text;

    /* A warp that repeats is the same in every square a block along, so
       each square of the block the warp reaches gets one definition, and
       every square on the sheet points at its own. A lens is on the plane
       once: the squares it reaches are written out in full where they
       stand, and every other square is the plain tile, as it always was. */
    const warp = warpField();
    const bentDefs = [];
    const cellDef = new Map();
    if (warp.active && warp.tiled) {
      for (let cj = 0; cj < n; cj++) {
        for (let ci = 0; ci < t.per(n); ci++) {
          const b = marksFor({ i: ci, j: cj });
          if (!b.bent) continue;
          cellDef.set(`${ci},${cj}`, `tile-${ci}-${cj}`);
          bentDefs.push(`<g id="tile-${ci}-${cj}">\n      ${b.text}\n    </g>`);
        }
      }
    }

    const uses = [];
    const num = (v) => +v.toFixed(4);
    for (const [i, j] of cells) {
      let tf;
      if (t.square) {
        const r = rotAt(state.pattern, i, j);
        tf = `translate(${i * T} ${j * T})` + (r ? ` rotate(${r * 90} ${T / 2} ${T / 2})` : '');
      } else {
        tf = `matrix(${t.matrix(state.pattern, i, j).map(num).join(' ')})`;
      }
      if (warp.active && !warp.tiled) {
        const b = marksFor({ i, j });
        if (b.bent) {
          uses.push(`<g transform="${tf}">\n    ${b.text}\n  </g>`);
          continue;
        }
      }
      const id = (warp.active && warp.tiled && cellDef.get(t.key(state.pattern, i, j))) || 'tile';
      uses.push(`<use href="#${id}" xlink:href="#${id}" transform="${tf}"/>`);
    }

    return `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${num(w / 2)}" height="${num(h / 2)}" viewBox="${num(sheet.x)} ${num(sheet.y)} ${num(w)} ${num(h)}">
  <defs>
    ${defs.join('\n    ')}
    <g id="tile">
      ${plain}
    </g>
    ${bentDefs.join('\n    ')}
  </defs>
  ${uses.join('\n  ')}
</svg>
`;
  }

  /* ---------------- persistence ---------------- */

  const KEY = 'tesselate.v1';
  const WAS_KEY = 'tessera.v1';   // what the table was called before
  let saveTimer = 0;
  let warnedFull = false;
  function saveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        localStorage.setItem(KEY, JSON.stringify({
          shapes: state.shapes, pattern: state.pattern, tool: state.tool,
          color: state.color, across: state.across, width: state.width, filled: state.filled,
          typeSize: state.typeSize, typeFace: state.typeFace,
          typeBold: state.typeBold, typeItalic: state.typeItalic,
          palette: state.palette, palettes: state.palettes, recent: state.recent,
          grid: state.grid, arrows: state.arrows, snap: state.snap, sub: state.sub,
          subLast: state.subLast, diag: state.diag, warp: state.warp, smooth: state.smooth,
        }));
      } catch (err) {
        /* Private mode is not worth interrupting for. Running out of room
           is: pictures are big, and a drawing that cannot be kept here is
           lost with the tab unless it goes to a file. Said once a run. */
        if (!warnedFull && err && err.name === 'QuotaExceededError') {
          warnedFull = true;
          flash('Too big to keep in this browser — save it to a file');
        }
      }
    }, 400);
  }

  function restore() {
    let d = null;
    // Read what the table was called before if it has not been written
    // under the new name yet, so a rename does not lose the drawing.
    try {
      d = JSON.parse(localStorage.getItem(KEY) || localStorage.getItem(WAS_KEY) || 'null');
    } catch (err) { d = null; }
    if (!d) return;
    if (Array.isArray(d.shapes)) state.shapes = d.shapes.filter(soundMark);
    adoptIds(state.shapes);
    const p = validPattern(d.pattern);
    if (p) state.pattern = p;
    if (Array.isArray(d.palettes)) {
      state.palettes = d.palettes
        .filter((p) => p && typeof p.name === 'string' && Array.isArray(p.colors))
        .slice(0, 40)
        .map((p) => ({
          name: p.name.slice(0, 22),
          colors: p.colors.map(normInk).filter(Boolean).slice(0, 40),
        }))
        .filter((p) => p.name);
    }
    if (Array.isArray(d.recent)) {
      state.recent = d.recent.map(normInk).filter(Boolean).slice(0, RECENT_MAX);
    }
    if (typeof d.palette === 'string') state.palette = d.palette;
    if (normInk(d.color)) state.color = normInk(d.color);
    const across = d.across || acrossWritten(d.color);
    if (across === 'shape' || across === 'tile') state.across = across;
    if (typeof d.width === 'number') state.width = clamp(d.width, 1, 64);
    if (typeof d.typeSize === 'number') state.typeSize = clamp(Math.round(d.typeSize), 20, 400);
    if (d.typeFace && typeof d.typeFace === 'string') state.typeFace = d.typeFace.slice(0, 80);
    for (const f of ['filled', 'typeBold', 'typeItalic', 'grid', 'arrows', 'snap']) {
      if (typeof d[f] === 'boolean') state[f] = d[f];
    }
    if (typeof d.diag === 'boolean') state.diag = d.diag ? 'plane' : 'off';
    else if (DIAG_MODES.some(([id]) => id === d.diag)) state.diag = d.diag;
    if (d.sub === 0 || SUBS.includes(d.sub)) state.sub = d.sub;
    if (SUBS.includes(d.subLast)) state.subLast = d.subLast;
    else if (state.sub) state.subLast = state.sub;
    if (Object.values(TOOL_KEYS).includes(d.tool)) state.tool = d.tool;
    if (d.warp) state.warp = cleanWarp(d.warp);
    if (typeof d.smooth === 'number' && isFinite(d.smooth)) state.smooth = clamp(Math.round(d.smooth), 0, 100);
  }

  /* ---------------- boot ---------------- */

  restore();
  buildShapeControls();
  setDiag(state.diag, true);
  setSub(state.sub);
  setTool(state.tool);
  buildPalettePicker();
  buildSwatches();
  buildRecent();
  setColor(state.color);
  setWidth(state.width);
  syncToggles();
  syncWarpPanel();
  syncSmooth();
  buildFaces();
  syncType();
  resize();
  afterChange();
  setDirty(false);   // what was restored is what was last put down
  setHint(HINTS.base);

  window.addEventListener('resize', resize);
  if (window.ResizeObserver) new ResizeObserver(resize).observe(canvas.parentElement);
  document.addEventListener('gesturestart', (e) => e.preventDefault());
})();
