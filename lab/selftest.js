/* ?selftest=1 — drives the lab with synthetic pointer events and writes
   what it found into the page, for a headless browser to read back. */
(function () {
  'use strict';
  const L = window.warpLab;
  const canvas = document.getElementById('stage');
  const box = canvas.getBoundingClientRect();
  const results = [];
  const ok = (what, pass, detail) => results.push(`${pass ? 'PASS' : 'FAIL'} ${what}${detail ? ' — ' + detail : ''}`);
  const fire = (type, x, y) => canvas.dispatchEvent(new PointerEvent(type, {
    clientX: box.left + x, clientY: box.top + y, pointerId: 7, button: 0,
    buttons: type === 'pointerup' ? 0 : 1, bubbles: true, pointerType: 'mouse',
  }));
  const drag = (from, to) => {
    fire('pointerdown', from.x, from.y);
    for (let t = 1; t <= 4; t++) fire('pointermove', from.x + ((to.x - from.x) * t) / 4, from.y + ((to.y - from.y) * t) / 4);
    fire('pointerup', to.x, to.y);
  };
  const toScreen = (p) => ({ x: L.lab.view.x + p.x * L.lab.view.scale, y: L.lab.view.y + p.y * L.lab.view.scale });
  const toPlane = (s) => ({ x: (s.x - L.lab.view.x) / L.lab.view.scale, y: (s.y - L.lab.view.y) / L.lab.view.scale });
  const dotOf = (k, i, j) => {
    L.drawAll();
    const a = L.lab.warp.anchors[k];
    return toScreen(L.field.warp(i == null ? a : placeOn(a, i, j, L.lab.pattern)));
  };
  const off = (p, q) => Math.hypot(p.x - q.x, p.y - q.y);
  const px = (d) => `${d.toFixed(2)} px off`;

  try {
    // The lens, one anchor on the plane.
    const centre = dotOf(0);
    const n0 = L.lab.warp.anchors.length;
    const click = { x: centre.x + 110, y: centre.y - 60 };
    fire('pointerdown', click.x, click.y);
    fire('pointerup', click.x, click.y);
    ok('a click drops an anchor', L.lab.warp.anchors.length === n0 + 1 && L.lab.sel === n0);
    const dot = dotOf(n0);
    ok('its dot lands under the click, inside the lens', off(dot, click) < 1, px(off(dot, click)));

    const to = { x: dot.x + 80, y: dot.y + 50 };
    drag(dot, to);
    ok('dragging the dot carries the anchor under the pointer', off(dotOf(n0), to) < 1, px(off(dotOf(n0), to)));
    ok('a drag does not drop another', L.lab.warp.anchors.length === n0 + 1);

    const a = L.lab.warp.anchors[n0];
    L.drawAll();
    const grip = toScreen(L.field.warp({ x: a.x + a.r, y: a.y }));
    const r0 = a.r;
    drag(grip, { x: grip.x + 30, y: grip.y });
    ok('the rim grip sizes it', a.r > r0 + 30, `${r0.toFixed(0)} → ${a.r.toFixed(0)}`);

    const q = { x: centre.x + 70, y: centre.y + 90 };
    const back = toScreen(L.field.warp(L.field.unwarp(toPlane(q))));
    ok('screen → drawing → screen', off(back, q) < 0.05, `${off(back, q).toFixed(4)} px`);

    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete' }));
    ok('Delete removes the anchor in hand', L.lab.warp.anchors.length === n0);

    // Anchors in every square.
    document.querySelector('[data-idea="field"]').click();
    const m0 = L.lab.warp.anchors.length;
    const tclick = { x: centre.x - 150, y: centre.y + 120 };
    fire('pointerdown', tclick.x, tclick.y);
    fire('pointerup', tclick.x, tclick.y);
    const b = L.lab.warp.anchors[m0];
    let best = Infinity;
    for (let j = -3; j <= 4; j++) for (let i = -3; i <= 4; i++) best = Math.min(best, off(dotOf(m0, i, j), tclick));
    ok('tiled: the dropped anchor shows under the click', best < 1, px(best));
    ok('tiled: it is kept in its square\'s own frame', !!b && b.x >= 0 && b.x <= T && b.y >= 0 && b.y <= T,
      b && `${b.x.toFixed(0)}, ${b.y.toFixed(0)}`);

    const tiled = L.buildSvg();
    ok('tiled SVG: one definition per block square, nothing written out', tiled.defs <= 1 + L.lab.pattern.n ** 2 && tiled.inline === 0,
      `${tiled.defs} definitions, ${(tiled.svg.length / 1024).toFixed(0)} KB`);
    document.querySelector('[data-idea="lens"]').click();
    const lens = L.buildSvg();
    ok('lens SVG: only the squares it reaches written out', lens.inline > 0 && lens.inline < lens.squares,
      `${lens.inline} of ${lens.squares}, ${(lens.svg.length / 1024).toFixed(0)} KB`);
  } catch (err) {
    ok('ran without throwing', false, String(err && err.stack || err));
  }

  const pre = document.createElement('pre');
  pre.id = 'selftest';
  pre.textContent = results.join('\n');
  document.body.appendChild(pre);
})();
