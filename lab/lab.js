/* ------------------------------------------------------------------
   lab.js — the warp lab. Not the table: a bench for finding out how a
   warp should look and behave before any of it goes into src/app.js.
   It shows the drawing on the table in this browser, if there is one,
   or a demo drawing of its own, and lets anchors be dropped on it.
   ------------------------------------------------------------------ */

(function () {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const canvas = $('stage');
  const ctx = canvas.getContext('2d');
  const query = new URLSearchParams(location.search);

  const GROUND = '#ffffff';
  const RULE_MINOR = 'rgba(23,22,15,0.3)';
  const RULE_MAJOR = 'rgba(23,22,15,0.46)';
  const SUB_RULE = 'rgba(86,156,214,0.9)';
  const ACCENT = '#cf4326';
  const TOL_PX = 0.3;       // how far a warped chord may stray from the curve, on screen

  /* ---------------- the drawing ---------------- */

  function demoShapes() {
    let id = 1;
    const mk = (o) => Object.assign({ id: id++, layer: 'stroke' }, o);
    const ink = '#17160f';
    const A = { x: 250, y: 250 }, B = { x: 750, y: 250 }, C = { x: 500, y: 700 };
    const ab = mk({ kind: 'line', a: A, b: B, color: ink, width: 10, group: 1 });
    const bc = mk({ kind: 'line', a: B, b: C, color: ink, width: 10, group: 1 });
    const ca = mk({ kind: 'line', a: C, b: A, color: ink, width: 10, group: 1 });
    /* The fill tucked 0.6 under the inside edge of its border, which is
       where the fill tool leaves one — and exactly what a warp that keeps
       stroke widths would pull a ring of paper open along. */
    const la = Math.hypot(C.x - B.x, C.y - B.y);
    const lb = Math.hypot(A.x - C.x, A.y - C.y);
    const lc = Math.hypot(B.x - A.x, B.y - A.y);
    const per = la + lb + lc;
    const I = { x: (la * A.x + lb * B.x + lc * C.x) / per, y: (la * A.y + lb * B.y + lc * C.y) / per };
    const rho = Math.abs((B.x - A.x) * (C.y - A.y) - (C.x - A.x) * (B.y - A.y)) / per;
    const k = (rho - (5 - 0.6)) / rho;
    const tri = [A, B, C].map((p) => ({ x: I.x + (p.x - I.x) * k, y: I.y + (p.y - I.y) * k }));
    const fill = { id: id++, layer: 'fill', kind: 'region', color: '#cf4326', loops: [tri],
      group: 1, walls: [ab.id, bc.id, ca.id] };
    return [
      mk({ kind: 'curve', a: { x: 0, y: 850 }, b: { x: 1000, y: 850 }, c: { x: 500, y: 1250 }, color: '#2b4a9c', width: 14 }),
      mk({ kind: 'line', a: { x: 0, y: 0 }, b: A, color: ink, width: 6 }),
      mk({ kind: 'line', a: { x: 1000, y: 0 }, b: B, color: ink, width: 6 }),
      ab, bc, ca, fill,
      mk({ kind: 'circle', c: { x: 500, y: 400 }, r: 90, color: '#237f86', width: 8, fillColor: '#c9a227' }),
      mk({ kind: 'circle', c: { x: 1000, y: 500 }, r: 60, color: '#e08a1e', width: 9, filled: true }),
      mk({ kind: 'rect', x: 800, y: 600, w: 130, h: 130, color: '#6c4a9e', width: 8 }),
    ];
  }

  const PINWHEEL = { n: 2, cells: cellsFromPreset(PRESETS[1]) };

  // The drawing left on the table, when the lab is served from the same place.
  function tableDrawing() {
    try {
      const d = JSON.parse(localStorage.getItem('tesselate.v1') || 'null');
      if (!d || !Array.isArray(d.shapes)) return null;
      const shapes = d.shapes.filter((s) => s && s.kind);
      if (!shapes.length) return null;
      const p = d.pattern;
      const ok = p && p.n >= 1 && p.n <= 4 && Array.isArray(p.cells) && p.cells.length === p.n * p.n;
      return { shapes, pattern: ok ? p : PINWHEEL };
    } catch (err) {
      return null;
    }
  }

  const table = query.get('drawing') === 'demo' ? null : tableDrawing();

  const lab = {
    source: table ? 'table' : 'demo',
    shapes: [],
    pattern: PINWHEEL,
    warp: { amount: 1, repeat: 'plane', anchors: [] },
    ink: query.get('ink') === 'bend' ? 'bend' : 'swell',
    bendRules: query.get('rules') !== '0',
    tiles: true,
    lattice: query.has('grid') ? +query.get('grid') : 8,
    sel: -1,
    view: { x: 0, y: 0, scale: 0.25 },
  };

  function useSource(which) {
    lab.source = which === 'table' && table ? 'table' : 'demo';
    const d = lab.source === 'table' ? table : { shapes: demoShapes(), pattern: PINWHEEL };
    lab.shapes = d.shapes;
    lab.pattern = d.pattern;
    order = paintOrder(lab.shapes);
    junctions = junctionsOf(lab.shapes);
  }

  /* ---------------- ideas to start from ---------------- */

  const IDEAS = [
    { id: 'lens', name: 'Lens', repeat: 'plane',
      anchors: [{ x: 1000, y: 1000, r: 1000, bulge: 0.6, twirl: 0 }],
      note: 'One anchor on the plane. Everything under it bends — marks, tiles, grid — and inside the lens the pattern no longer repeats exactly.' },
    { id: 'pinch', name: 'Pinch', repeat: 'plane',
      anchors: [{ x: 1000, y: 1000, r: 1300, bulge: -0.5, twirl: 0 }],
      note: 'The same anchor pulling in. A flow cannot fold, so a pinch only ever squeezes.' },
    { id: 'twirl', name: 'Twirl', repeat: 'plane',
      anchors: [{ x: 1000, y: 1000, r: 1200, bulge: 0, twirl: 0.4 }],
      note: 'Turning instead of swelling. The rim stays where it was, so the lens meets the flat plane without a kink.' },
    { id: 'pair', name: 'Two lenses', repeat: 'plane',
      anchors: [{ x: 600, y: 700, r: 700, bulge: 0.55, twirl: 0 }, { x: 1500, y: 1350, r: 800, bulge: -0.4, twirl: 0.25 }],
      note: 'Anchors add. Where their discs overlap, a point is carried along both at once.' },
    { id: 'inside', name: 'Straight seams', repeat: 'tile',
      anchors: [{ x: 500, y: 500, r: 490, bulge: 0.5, twirl: 0 }],
      note: 'The anchor repeats in every square and its disc stays inside it: the seams stay straight and it is still a tiling.' },
    { id: 'seams', name: 'Curved tiles', repeat: 'tile',
      anchors: [{ x: 500, y: 0, r: 430, bulge: 0, twirl: 0.3 }],
      note: 'The anchor sits on a seam and repeats with every square’s turn, so the tile edges bend — and the bent tiles still fit together.' },
    { id: 'field', name: 'Field', repeat: 'tile',
      anchors: [{ x: 250, y: 250, r: 300, bulge: 0.5, twirl: 0.15 }, { x: 750, y: 750, r: 300, bulge: -0.45, twirl: 0 }],
      note: 'Two repeating anchors, a bulge and a pinch, in every square.' },
  ];

  function useIdea(idea) {
    lab.warp.repeat = idea.repeat;
    lab.warp.anchors = idea.anchors.map((a) => ({ ...a }));
    lab.sel = lab.warp.anchors.length === 1 ? 0 : -1;
    lab.idea = idea.id;
    $('presetNote').textContent = idea.note;
    syncPanel();
    requestDraw();
  }

  /* ---------------- painting order and junctions, as the table has them ---------------- */

  let order = [];
  let junctions = new Set();

  function paintOrder(list) {
    const ground = list.filter((s) => s.layer === 'fill' && !s.group);
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
    const out = ground.slice();
    for (const u of [...units.values()].sort((a, b) => a.last - b.last)) {
      const fills = [], strokes = [];
      for (const s of u.members) {
        if (s.layer === 'fill') fills.push(s);
        else {
          if (s.fillColor && !s.filled) fills.push({ inside: s });
          strokes.push(s);
        }
      }
      out.push(...fills, ...strokes);
    }
    return out;
  }

  const jkey = (p) => `${Math.round(p.x * 4)},${Math.round(p.y * 4)}`;

  function junctionsOf(list) {
    const seen = new Map();
    for (const s of list) {
      if (s.layer !== 'stroke' || s.filled) continue;
      for (const p of endpointsOf(s)) seen.set(jkey(p), (seen.get(jkey(p)) || 0) + 1);
    }
    return new Set([...seen].filter(([, n]) => n >= 2).map(([k]) => k));
  }

  const discsOf = (s) => (s.layer === 'stroke' && !s.filled && (s.kind === 'line' || s.kind === 'curve')
    ? endpointsOf(s).filter((p) => junctions.has(jkey(p)))
    : []);

  // A gradient is shown by the colour it starts from; the lab is about shape.
  function flatInk(v) {
    if (typeof v !== 'string') return '#17160f';
    const m = /^lin\([^,]*,[^,]*,\s*(#[0-9a-f]+)/i.exec(v.trim());
    return m ? m[1] : v;
  }

  function svgPaint(attr, v) {
    const h = flatInk(v).replace('#', '');
    const a = h.length === 8 ? parseInt(h.slice(6), 16) / 255 : 1;
    return `${attr}="#${h.slice(0, 6)}"` + (a < 1 ? ` ${attr}-opacity="${+a.toFixed(4)}"` : '');
  }

  function overhang(list) {
    let lo = 0, hi = T;
    for (const s of list) {
      const b = shapeBBox(s);
      if (!b) continue;
      const pen = (s.width || 0) / 2;
      lo = Math.min(lo, b.x0 - pen, b.y0 - pen);
      hi = Math.max(hi, b.x1 + pen, b.y1 + pen);
    }
    return clamp(Math.max(Math.ceil(-lo / T), Math.ceil((hi - T) / T)), 0, 3);
  }

  /* ---------------- the warp ---------------- */

  let field = NO_WARP, fieldSig = '';
  function refreshField() {
    const sig = JSON.stringify([lab.warp, lab.pattern]);
    if (sig !== fieldSig) { field = makeWarp(lab.warp, lab.pattern); fieldSig = sig; }
  }

  // The box one copy of a mark covers on the plane, ink and all.
  function copyBox(s, i, j) {
    const b = shapeBBox(s);
    if (!b) return null;
    const pen = (s.layer === 'stroke' && !s.filled ? s.width || 0 : 0) / 2;
    const p = placeOn({ x: b.x0 - pen, y: b.y0 - pen }, i, j, lab.pattern);
    const q = placeOn({ x: b.x1 + pen, y: b.y1 + pen }, i, j, lab.pattern);
    return { x0: Math.min(p.x, q.x), y0: Math.min(p.y, q.y), x1: Math.max(p.x, q.x), y1: Math.max(p.y, q.y) };
  }

  /* Warped copies are kept per mark. A tiled warp is the same in every
     square a whole block along, so it keeps one per square of the block;
     a lens keeps one per square it actually reaches. Null says the warp
     does not reach this copy, and it is drawn as it always was. */
  const warpCache = new WeakMap();
  let buildMs = 0, built = 0;

  function warpedCopy(s, part, i, j, tol, bucket) {
    const n = lab.pattern.n;
    const where = field.tiled ? `${mod(i, n)},${mod(j, n)}` : `${i},${j}`;
    const key = `${part || ''}|${where}`;
    const sig = `${field.sig}|${bucket}|${lab.ink}`;
    let m = warpCache.get(s);
    if (!m || m.sig !== sig) { m = { sig, copies: new Map() }; warpCache.set(s, m); }
    let got = m.copies.get(key);
    if (got === undefined) {
      const box = copyBox(s, i, j);
      if (!box || !field.touches(box)) got = null;
      else {
        const t0 = performance.now();
        got = warpMark(s, part, i, j, lab.pattern, field, tol, lab.ink, discsOf(s));
        buildMs += performance.now() - t0;
        built++;
      }
      m.copies.set(key, got);
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

  const pathOnce = (w, field2) => w[field2 + 'Path'] || (w[field2 + 'Path'] = linesPath(w[field2]));

  /* ---------------- view ---------------- */

  let cw = 0, ch = 0, dpr = 1;
  let clean = query.get('clean') === '1';
  const toWorld = (s) => ({ x: (s.x - lab.view.x) / lab.view.scale, y: (s.y - lab.view.y) / lab.view.scale });
  const w2s = (p) => ({ x: lab.view.x + p.x * lab.view.scale, y: lab.view.y + p.y * lab.view.scale });
  const tolWorld = () => TOL_PX / lab.view.scale;

  function fitView() {
    const v = lab.view;
    v.scale = Math.min(cw, ch) / ((+query.get('tiles') || 3.2) * T);
    v.x = cw / 2 - T * v.scale;
    v.y = ch / 2 - T * v.scale;
  }

  function zoomAt(s, factor) {
    const v = lab.view;
    const s1 = clamp(v.scale * factor, 0.02, 8);
    v.x = s.x - (s.x - v.x) * (s1 / v.scale);
    v.y = s.y - (s.y - v.y) * (s1 / v.scale);
    v.scale = s1;
    requestDraw();
  }

  function viewBox() {
    const a = toWorld({ x: 0, y: 0 }), b = toWorld({ x: cw, y: ch });
    return { x0: a.x, y0: a.y, x1: b.x, y1: b.y };
  }

  function resize() {
    const r = canvas.getBoundingClientRect();
    const first = !cw;
    dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    cw = Math.max(1, Math.round(r.width));
    ch = Math.max(1, Math.round(r.height));
    canvas.width = Math.round(cw * dpr);
    canvas.height = Math.round(ch * dpr);
    if (first) fitView();
    requestDraw();
  }

  /* ---------------- render ---------------- */

  let frame = 0;
  function requestDraw() {
    if (frame) return;
    frame = requestAnimationFrame(() => { frame = 0; drawAll(); });
  }

  function tileTransform(i, j) {
    const v = lab.view, k = v.scale * dpr;
    ctx.setTransform(k, 0, 0, k, (v.x + i * T * v.scale) * dpr, (v.y + j * T * v.scale) * dpr);
    const r = rotAt(lab.pattern, i, j);
    if (r) {
      ctx.translate(T / 2, T / 2);
      ctx.rotate((r * Math.PI) / 2);
      ctx.translate(-T / 2, -T / 2);
    }
  }

  const plainPaths = new WeakMap();
  function plainPath(s) {
    let p = plainPaths.get(s);
    if (!p) { p = buildPath(s); plainPaths.set(s, p); }
    return p;
  }

  function paintCopy(s, part, i, j, tol, bucket) {
    const w = field.active ? warpedCopy(s, part, i, j, tol, bucket) : null;
    const path = w ? pathOnce(w, 'lines') : plainPath(s);
    if (s.layer === 'fill') { ctx.fillStyle = flatInk(s.color); ctx.fill(path, 'evenodd'); return; }
    if (s.filled) { ctx.fillStyle = flatInk(s.color); ctx.fill(path); return; }
    if (part === 'inside') { ctx.fillStyle = flatInk(s.fillColor); ctx.fill(path); return; }
    const ink = flatInk(s.color);
    ctx.fillStyle = ink;
    ctx.strokeStyle = ink;
    if (w && w.how === 'nonzero') { ctx.fill(path); return; }
    const [cap, join] = warpCaps(s.kind);
    ctx.lineCap = cap;
    ctx.lineJoin = join;
    ctx.lineWidth = s.width;
    ctx.stroke(path);
    if (w) { if (w.discs && w.discs.length) ctx.fill(pathOnce(w, 'discs')); return; }
    for (const p of discsOf(s)) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, s.width / 2, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  const meets = (b, v, g) => !!b && b.x1 >= v.x0 - g && b.x0 <= v.x1 + g && b.y1 >= v.y0 - g && b.y0 <= v.y1 + g;

  function drawAll() {
    const t0 = performance.now();
    refreshField();
    buildMs = 0;
    built = 0;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (clean) ctx.clearRect(0, 0, cw, ch);
    else { ctx.fillStyle = GROUND; ctx.fillRect(0, 0, cw, ch); }

    const vb = viewBox();
    // A flow keeps each disc to itself, so paper shown inside one came
    // from inside it: the view need only reach out as far as the discs.
    const g = field.active ? field.reach : 0;
    const pad = overhang(lab.shapes);
    const i0 = Math.floor((vb.x0 - g) / T) - pad, i1 = Math.floor((vb.x1 + g) / T) + pad;
    const j0 = Math.floor((vb.y0 - g) / T) - pad, j1 = Math.floor((vb.y1 + g) / T) + pad;
    const bucket = Math.round(Math.log2(lab.view.scale) * 2);
    const tol = TOL_PX / Math.pow(2, (bucket + 1) / 2);
    let copies = 0;
    if ((i1 - i0 + 1) * (j1 - j0 + 1) <= 4000) {
      for (const entry of order) {
        const s = entry.inside || entry;
        const part = entry.inside ? 'inside' : s.fillColor ? 'outline' : null;
        for (let j = j0; j <= j1; j++) {
          for (let i = i0; i <= i1; i++) {
            if (!meets(copyBox(s, i, j), vb, g)) continue;
            tileTransform(i, j);
            paintCopy(s, part, i, j, tol, bucket);
            copies++;
          }
        }
      }
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    if (clean) return;
    if (lab.tiles) drawRules(vb);
    if (lab.lattice) drawLattice(vb);
    drawAnchors(vb);
    if (hover && !drag) drawHover();
    const ms = performance.now() - t0;
    $('stats').textContent = `${copies} copies drawn · ${built} warped in ${buildMs.toFixed(0)} ms`
      + ` · frame ${ms.toFixed(0)} ms` + (field.active ? ` · ${field.steps} flow steps` : ' · no warp');
  }

  /* A straight run on the plane, as the screen shows it: through the warp
     where the rules bend with it, straight where they do not. */
  function screenRun(a, b, map) {
    const flat = [w2s(map ? map(a) : a), w2s(map ? map(b) : b)];
    if (!field.active || !lab.bendRules) return flat;
    const wa = map ? (p) => field.warp(map(p)) : field.warp;
    const ea = map ? map(a) : a, eb = map ? map(b) : b;
    const box = { x0: Math.min(ea.x, eb.x), y0: Math.min(ea.y, eb.y), x1: Math.max(ea.x, eb.x), y1: Math.max(ea.y, eb.y) };
    if (!field.touches(box)) return flat;
    return layRuns([polyRun([a, b], false)], wa, tolWorld(), field.seg)[0].pts.map(w2s);
  }

  const trace = (pts, closed) => {
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k].x, pts[k].y);
    if (closed) ctx.closePath();
  };

  function drawRules(vb) {
    const n = lab.pattern.n;
    const step = T * lab.view.scale;
    const g = field.active ? field.reach : 0;
    const x0 = vb.x0 - g, x1 = vb.x1 + g, y0 = vb.y0 - g, y1 = vb.y1 + g;
    const i0 = Math.floor(x0 / T), i1 = Math.ceil(x1 / T), j0 = Math.floor(y0 / T), j1 = Math.ceil(y1 / T);
    const room = step > 70;
    const pass = (major) => {
      ctx.beginPath();
      for (let i = i0; i <= i1; i++) {
        if ((n > 1 && mod(i, n) === 0) !== major) continue;
        trace(screenRun({ x: i * T, y: y0 }, { x: i * T, y: y1 }));
      }
      for (let j = j0; j <= j1; j++) {
        if ((n > 1 && mod(j, n) === 0) !== major) continue;
        trace(screenRun({ x: x0, y: j * T }, { x: x1, y: j * T }));
      }
      ctx.stroke();
    };
    ctx.lineWidth = room ? 2 : 1;
    ctx.strokeStyle = RULE_MINOR;
    if (step > 15) pass(false);
    ctx.lineWidth = room ? 3 : 1;
    ctx.strokeStyle = RULE_MAJOR;
    pass(true);
    ctx.lineWidth = 1;
  }

  function drawLattice(vb) {
    const sub = lab.lattice, cell = T / sub;
    if (cell * lab.view.scale < 4) return;
    const i0 = Math.floor(vb.x0 / T), i1 = Math.floor(vb.x1 / T);
    const j0 = Math.floor(vb.y0 / T), j1 = Math.floor(vb.y1 / T);
    if ((i1 - i0 + 1) * (j1 - j0 + 1) > 160) return;
    ctx.save();
    ctx.setLineDash([1, 2]);
    ctx.lineCap = 'butt';
    ctx.lineWidth = 1;
    ctx.strokeStyle = SUB_RULE;
    ctx.beginPath();
    for (let j = j0; j <= j1; j++) {
      for (let i = i0; i <= i1; i++) {
        const put = (p) => placeOn(p, i, j, lab.pattern);
        for (let k = lab.tiles ? 1 : 0; k < sub; k++) {
          trace(screenRun({ x: k * cell, y: 0 }, { x: k * cell, y: T }, put));
          trace(screenRun({ x: 0, y: k * cell }, { x: T, y: k * cell }, put));
        }
      }
    }
    ctx.stroke();
    ctx.restore();
  }

  /* ---------------- anchors on the plane ---------------- */

  let handles = [];

  // Each anchor, at each place it sits in view, where the warp shows it.
  function handleList(vb) {
    const out = [];
    const tiled = lab.warp.repeat === 'tile';
    const i0 = Math.floor(vb.x0 / T) - 1, i1 = Math.floor(vb.x1 / T) + 1;
    const j0 = Math.floor(vb.y0 / T) - 1, j1 = Math.floor(vb.y1 / T) + 1;
    lab.warp.anchors.forEach((a, k) => {
      if (!tiled) { out.push({ k, i: null, j: null, c: { x: a.x, y: a.y }, r: a.r }); return; }
      if ((i1 - i0 + 1) * (j1 - j0 + 1) > 400) return;
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) out.push({ k, i, j, c: placeOn(a, i, j, lab.pattern), r: a.r });
      }
    });
    for (const h of out) {
      h.at = w2s(field.warp(h.c));
      h.grip = w2s(field.warp({ x: h.c.x + h.r, y: h.c.y }));
    }
    return out;
  }

  function drawAnchors(vb) {
    handles = handleList(vb);
    const tiled = lab.warp.repeat === 'tile';
    ctx.save();
    for (const h of handles) {
      const sel = h.k === lab.sel;
      if (sel || !tiled) {
        const rim = layRuns([circleRun(h.c, h.r)], field.warp, tolWorld(), field.seg)[0].pts.map(w2s);
        ctx.beginPath();
        trace(rim, true);
        ctx.setLineDash(sel ? [6, 4] : [2, 4]);
        ctx.lineWidth = sel ? 1.5 : 1;
        ctx.strokeStyle = sel ? ACCENT : 'rgba(23,22,15,0.5)';
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.arc(h.at.x, h.at.y, sel ? 5.5 : 4, 0, Math.PI * 2);
      ctx.fillStyle = sel ? ACCENT : '#ffffff';
      ctx.fill();
      ctx.lineWidth = 1.2;
      ctx.strokeStyle = '#17160f';
      ctx.stroke();
      if (sel) {
        ctx.beginPath();
        ctx.rect(h.grip.x - 4.5, h.grip.y - 4.5, 9, 9);
        ctx.fillStyle = '#ffffff';
        ctx.fill();
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  /* Where the pointer is on the drawing, found by running the flow back:
     the cross sits on the lattice point a mark would snap to, and should
     sit on a crossing of the bent grid wherever it is. */
  function drawHover() {
    if (!lab.lattice) return;
    const w = field.unwarp(toWorld(hover));
    const i = Math.floor(w.x / T), j = Math.floor(w.y / T);
    const m = takeOff(w, i, j, lab.pattern);
    const q = w2s(field.warp(placeOn(snapPoint(m, lab.lattice), i, j, lab.pattern)));
    ctx.lineWidth = 1.4;
    ctx.strokeStyle = ACCENT;
    ctx.beginPath();
    ctx.moveTo(q.x - 5, q.y - 5); ctx.lineTo(q.x + 5, q.y + 5);
    ctx.moveTo(q.x + 5, q.y - 5); ctx.lineTo(q.x - 5, q.y + 5);
    ctx.stroke();
    $('readout').textContent = `square ${i},${j} · drawing at ${m.x.toFixed(1)}, ${m.y.toFixed(1)}`;
  }

  /* ---------------- pointer ---------------- */

  let drag = null, hover = null;
  const screenPt = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  function handleAt(s) {
    let best = null;
    const near = (p) => Math.hypot(p.x - s.x, p.y - s.y);
    for (const h of handles) {
      if (h.k === lab.sel && near(h.grip) <= 9) return { h, part: 'rim' };
      const d = near(h.at);
      if (d <= 10 && (!best || d < best.d)) best = { h, part: 'centre', d };
    }
    return best;
  }

  const clamped = (q) => ({ x: clamp(q.x, 0, T), y: clamp(q.y, 0, T) });

  /* Put anchor k where its dot shows under the screen point `s` — in
     square (i, j)'s frame if it repeats. Aimed, not just taken back, so
     it lands under the hand inside another disc as well. */
  function aim(k, i, j, s) {
    const tiled = i != null;
    const own = (q) => (tiled ? clamped(takeOff(q, i, j, lab.pattern)) : q);
    const at = own(aimAnchor(lab.warp, lab.pattern, k, toWorld(s), own));
    lab.warp.anchors[k].x = at.x;
    lab.warp.anchors[k].y = at.y;
  }

  function dropAnchor(s) {
    const w = field.unwarp(toWorld(s));
    const tiled = lab.warp.repeat === 'tile';
    const i = Math.floor(w.x / T), j = Math.floor(w.y / T);
    const at = tiled ? takeOff(w, i, j, lab.pattern) : w;
    lab.warp.anchors.push({ x: at.x, y: at.y, r: tiled ? 260 : 600, bulge: 0.5, twirl: 0 });
    lab.sel = lab.warp.anchors.length - 1;
    aim(lab.sel, tiled ? i : null, tiled ? j : null, s);
    syncPanel();
    requestDraw();
  }

  canvas.addEventListener('pointerdown', (e) => {
    const s = screenPt(e);
    try { canvas.setPointerCapture(e.pointerId); } catch (err) { /* a synthetic pointer */ }
    const hit = handleAt(s);
    if (hit) {
      lab.sel = hit.h.k;
      drag = { kind: hit.part, h: hit.h, press: s };
      syncPanel();
      requestDraw();
      return;
    }
    drag = { kind: 'press', press: s, vx: lab.view.x, vy: lab.view.y, moved: false };
  });

  canvas.addEventListener('pointermove', (e) => {
    const s = screenPt(e);
    hover = s;
    if (!drag) {
      canvas.classList.toggle('on-handle', !!handleAt(s));
      requestDraw();
      return;
    }
    if (drag.kind === 'press') {
      if (Math.hypot(s.x - drag.press.x, s.y - drag.press.y) > 5) drag.moved = true;
      if (drag.moved) {
        lab.view.x = drag.vx + s.x - drag.press.x;
        lab.view.y = drag.vy + s.y - drag.press.y;
      }
      requestDraw();
      return;
    }
    if (drag.kind === 'centre') {
      aim(drag.h.k, drag.h.i, drag.h.j, s);
    } else {
      // A disc leaves its own rim where it is, so the rim is taken back
      // through every anchor but the one in hand.
      const a = lab.warp.anchors[drag.h.k];
      const w = makeWarp(lab.warp, lab.pattern, drag.h.k).unwarp(toWorld(s));
      const c = drag.h.i == null ? a : placeOn(a, drag.h.i, drag.h.j, lab.pattern);
      a.r = clamp(Math.hypot(w.x - c.x, w.y - c.y), 30, 4000);
    }
    syncPanel();
    requestDraw();
  });

  const release = () => {
    if (drag && drag.kind === 'press' && !drag.moved) dropAnchor(drag.press);
    drag = null;
    requestDraw();
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('pointerleave', () => { hover = null; requestDraw(); });

  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) zoomAt(screenPt(e), Math.exp(-e.deltaY * 0.01));
    else { lab.view.x -= e.deltaX; lab.view.y -= e.deltaY; requestDraw(); }
  }, { passive: false });

  window.addEventListener('keydown', (e) => {
    if (e.target instanceof HTMLInputElement) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && lab.warp.anchors[lab.sel]) {
      e.preventDefault();
      lab.warp.anchors.splice(lab.sel, 1);
      lab.sel = -1;
      syncPanel();
      requestDraw();
    }
    if (e.key === 'Escape') { lab.sel = -1; syncPanel(); requestDraw(); }
    if (e.key === 'h') { fitView(); requestDraw(); }
  });

  /* ---------------- rail ---------------- */

  const presetWrap = $('presets');
  for (const idea of IDEAS) {
    const b = document.createElement('button');
    b.className = 'chip';
    b.dataset.idea = idea.id;
    b.textContent = idea.name;
    b.addEventListener('click', () => useIdea(idea));
    presetWrap.appendChild(b);
  }

  function syncPanel() {
    $('amount').value = Math.round(lab.warp.amount * 100);
    $('amountVal').textContent = $('amount').value;
    for (const b of $('repeat').children) b.classList.toggle('on', b.dataset.repeat === lab.warp.repeat);
    for (const b of $('ink').children) b.classList.toggle('on', b.dataset.ink === lab.ink);
    for (const b of $('lattice').children) b.classList.toggle('on', +b.dataset.lattice === lab.lattice);
    for (const b of presetWrap.children) b.classList.toggle('on', b.dataset.idea === lab.idea);
    $('bendRules').classList.toggle('on', lab.bendRules);
    $('tilesOn').classList.toggle('on', lab.tiles);
    $('demoOn').classList.toggle('on', lab.source === 'demo');
    $('demoOn').disabled = !table;
    const a = lab.warp.anchors[lab.sel];
    $('anchorBody').hidden = !a;
    $('anchorNone').hidden = !!a;
    if (!a) return;
    $('bulge').value = Math.round(a.bulge * 100);
    $('bulgeVal').textContent = $('bulge').value;
    $('twirl').value = Math.round(a.twirl * 100);
    $('twirlVal').textContent = $('twirl').value;
    $('radius').value = Math.round(a.r);
    $('radiusVal').textContent = Math.round(a.r);
  }

  const edit = (fn) => () => { fn(); lab.idea = null; syncPanel(); requestDraw(); };
  const held = () => lab.warp.anchors[lab.sel];

  $('amount').addEventListener('input', () => { lab.warp.amount = +$('amount').value / 100; syncPanel(); requestDraw(); });
  $('bulge').addEventListener('input', edit(() => { if (held()) held().bulge = +$('bulge').value / 100; }));
  $('twirl').addEventListener('input', edit(() => { if (held()) held().twirl = +$('twirl').value / 100; }));
  $('radius').addEventListener('input', edit(() => { if (held()) held().r = +$('radius').value; }));
  $('removeAnchor').addEventListener('click', edit(() => {
    if (!held()) return;
    lab.warp.anchors.splice(lab.sel, 1);
    lab.sel = -1;
  }));

  /* Switching how anchors sit keeps each where it is on screen as near as
     it can: an anchor on the plane goes into the square it was over, and
     one in a square comes out at that square's place in the first one. */
  $('repeat').addEventListener('click', (e) => {
    const b = e.target.closest('[data-repeat]');
    if (!b || b.dataset.repeat === lab.warp.repeat) return;
    if (b.dataset.repeat === 'tile') {
      lab.warp.anchors = lab.warp.anchors.map((a) => {
        const p = takeOff(a, Math.floor(a.x / T), Math.floor(a.y / T), lab.pattern);
        return { ...a, x: p.x, y: p.y, r: Math.min(a.r, T) };
      });
    }
    lab.warp.repeat = b.dataset.repeat;
    lab.idea = null;
    syncPanel();
    requestDraw();
  });
  $('ink').addEventListener('click', (e) => {
    const b = e.target.closest('[data-ink]');
    if (b) { lab.ink = b.dataset.ink; syncPanel(); requestDraw(); }
  });
  $('lattice').addEventListener('click', (e) => {
    const b = e.target.closest('[data-lattice]');
    if (b) { lab.lattice = +b.dataset.lattice; syncPanel(); requestDraw(); }
  });
  $('bendRules').addEventListener('click', () => { lab.bendRules = !lab.bendRules; syncPanel(); requestDraw(); });
  $('tilesOn').addEventListener('click', () => { lab.tiles = !lab.tiles; syncPanel(); requestDraw(); });
  $('demoOn').addEventListener('click', () => {
    useSource(lab.source === 'demo' ? 'table' : 'demo');
    syncPanel();
    requestDraw();
  });

  /* ---------------- out ---------------- */

  function download(name, blob) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = name;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }

  /* The sheet the table would save, warped. Where the warp repeats, each
     square of the block gets one warped definition and every square on
     the sheet points at its own, turned into place — the file stays one
     tile's worth per block square however large the sheet. A lens is
     only once on the plane, so the squares it reaches are written out in
     full and every other square is the plain tile, as it always was. */
  function buildSvg() {
    refreshField();
    const vb = viewBox();
    const n = lab.pattern.n;
    const span = (a, b) => {
      const least = Math.max(4, n * 2);
      const start = Math.floor(a / n) * n;
      const count = Math.min(20, Math.max(least, Math.ceil((b - start + 1) / n) * n));
      return [start, start + count - 1];
    };
    const [ia, ib] = span(Math.floor(vb.x0 / T), Math.floor(vb.x1 / T));
    const [ja, jb] = span(Math.floor(vb.y0 / T), Math.floor(vb.y1 / T));
    const w = (ib - ia + 1) * T, h = (jb - ja + 1) * T;
    const TOL = 0.25;

    const plainEl = (s, part) => {
      const d = pathData(s);
      if (!d) return '';
      if (part === 'inside') return `<path d="${d}" ${svgPaint('fill', s.fillColor)}/>`;
      if (s.layer === 'fill') return `<path d="${d}" ${svgPaint('fill', s.color)} fill-rule="evenodd"/>`;
      if (s.filled) return `<path d="${d}" ${svgPaint('fill', s.color)}/>`;
      const [cap, join] = warpCaps(s.kind);
      return `<path d="${d}" fill="none" ${svgPaint('stroke', s.color)} stroke-width="${s.width}"`
        + ` stroke-linecap="${cap}" stroke-linejoin="${join}"/>`
        + discsOf(s).map((p) => `<circle cx="${n2(p.x)}" cy="${n2(p.y)}" r="${s.width / 2}" ${svgPaint('fill', s.color)}/>`).join('');
    };
    const warpedEl = (s, part, got) => {
      const d = linesData(got.lines);
      if (!d) return '';
      const ink = part === 'inside' ? s.fillColor : s.color;
      if (got.how === 'evenodd') return `<path d="${d}" ${svgPaint('fill', ink)} fill-rule="evenodd"/>`;
      if (got.how === 'nonzero') return `<path d="${d}" ${svgPaint('fill', ink)}/>`;
      return `<path d="${d}" fill="none" ${svgPaint('stroke', ink)} stroke-width="${s.width}"`
        + ` stroke-linecap="${got.cap}" stroke-linejoin="${got.join}"/>`
        + (got.discs.length ? `<path d="${linesData(got.discs)}" ${svgPaint('fill', ink)}/>` : '');
    };
    // One square's marks, warped where the warp reaches them. `bent` says
    // whether it reached any.
    const body = (i, j) => {
      let bent = false;
      const els = order.map((entry) => {
        const s = entry.inside || entry;
        const part = entry.inside ? 'inside' : s.fillColor ? 'outline' : null;
        const got = field.active ? warpedCopy(s, part, i, j, TOL, 'svg') : null;
        if (got) bent = true;
        return got ? warpedEl(s, part, got) : plainEl(s, part);
      }).filter(Boolean);
      return { bent, text: els.join('\n      ') };
    };
    const place = (i, j) => {
      const r = rotAt(lab.pattern, i, j);
      return `translate(${i * T} ${j * T})` + (r ? ` rotate(${r * 90} ${T / 2} ${T / 2})` : '');
    };

    const defs = [`<g id="tile">\n      ${order.map((e) => plainEl(e.inside || e, e.inside ? 'inside' : null)).filter(Boolean).join('\n      ')}\n    </g>`];
    const cellDef = new Map();
    if (field.active && field.tiled) {
      for (let cj = 0; cj < n; cj++) {
        for (let ci = 0; ci < n; ci++) {
          const b = body(ci, cj);
          if (!b.bent) continue;
          cellDef.set(`${ci},${cj}`, `c${ci}-${cj}`);
          defs.push(`<g id="c${ci}-${cj}">\n      ${b.text}\n    </g>`);
        }
      }
    }
    const sheet = [];
    let inline = 0;
    for (let j = ja; j <= jb; j++) {
      for (let i = ia; i <= ib; i++) {
        let id = 'tile';
        if (field.active && field.tiled) id = cellDef.get(`${mod(i, n)},${mod(j, n)}`) || 'tile';
        else if (field.active) {
          const b = body(i, j);
          if (b.bent) {
            inline++;
            sheet.push(`<g transform="${place(i, j)}">\n      ${b.text}\n  </g>`);
            continue;
          }
        }
        sheet.push(`<use href="#${id}" xlink:href="#${id}" transform="${place(i, j)}"/>`);
      }
    }
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"
     width="${w / 2}" height="${h / 2}" viewBox="${ia * T} ${ja * T} ${w} ${h}">
  <defs>
    ${defs.join('\n    ')}
  </defs>
  ${sheet.join('\n  ')}
</svg>
`;
    return { svg, defs: defs.length, inline, squares: sheet.length };
  }

  $('svgBtn').addEventListener('click', () => {
    const out = buildSvg();
    download(`tesselate-warp-${Date.now()}.svg`, new Blob([out.svg], { type: 'image/svg+xml' }));
    $('stats').textContent = `SVG: ${(out.svg.length / 1024).toFixed(0)} KB · ${out.squares} squares`
      + ` · ${out.defs} definitions · ${out.inline} written out in full`;
  });

  $('pngBtn').addEventListener('click', () => {
    clean = true;
    drawAll();
    clean = false;
    canvas.toBlob((b) => b && download(`tesselate-warp-${Date.now()}.png`, b), 'image/png');
    requestDraw();
  });

  /* ---------------- boot ---------------- */

  useSource(lab.source);
  const first = IDEAS.find((i) => i.id === query.get('idea')) || IDEAS[0];
  if (query.has('amount')) lab.warp.amount = clamp(+query.get('amount') / 100, 0, 1);
  resize();
  useIdea(first);
  if (query.has('sel')) lab.sel = +query.get('sel');
  syncPanel();
  drawAll();
  window.addEventListener('resize', resize);
  window.warpLab = { lab, buildSvg, drawAll, get field() { return field; } };

  // ?svg=1 shows the saved SVG in place of the canvas, to hold the two side by side.
  if (query.get('svg') === '1') {
    const out = buildSvg();
    const img = document.createElement('img');
    img.src = URL.createObjectURL(new Blob([out.svg], { type: 'image/svg+xml' }));
    const wrap = document.createElement('div');
    wrap.className = 'svg-view';
    wrap.appendChild(img);
    document.body.appendChild(wrap);
    document.title = `${(out.svg.length / 1024).toFixed(0)} KB · ${out.defs} defs · ${out.inline} inline`;
  }
})();
