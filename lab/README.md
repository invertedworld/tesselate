# Warp lab

The bench the **Warp** tool was worked out on. The tool itself is in the table
now — see *Warp* in the main README — and its engine is `src/warp.js`, which
the lab loads from there. The lab stays as a place to try anchors on a drawing
and compare ideas side by side.

    ./serve.py 8000        # then localhost:8000/lab/warp.html

Served from the same place as the table, it shows the drawing left on the
table in that browser; otherwise, or with *Demo drawing* ticked, a drawing of
its own. The chips along the top are the ideas below. Click the paper to drop
an anchor, drag its dot to move it, the square on its rim to size it, `Delete`
to remove it, `H` to recentre.

Query parameters, for looking at one thing at a time: `idea=lens|pinch|twirl|pair|inside|seams|field`,
`ink=bend`, `rules=0`, `grid=0|4|8|16`, `tiles=` (how many squares fit the
short side), `amount=0..100`, `drawing=demo`, `clean=1`, `svg=1` (shows the
exported SVG in place of the canvas), `selftest=1` (drives the lab with
synthetic pointer events and writes the results into the page).

| File | |
|---|---|
| `lab.js` | the bench: rendering, anchors, rail, SVG export |
| `selftest.js` | loaded only with `?selftest=1` |
| `../src/warp.js` | the engine, shared with the table |

## What it is

**A way of looking, not an edit.** The warp sits between the plane and the
screen, the way the 45° frame does. The marks stay exactly as drawn; every
point is carried through the warp on its way out and back through it on its way
in from the pointer. Snapping, hit tests and the fill tracer work on the marks,
so none of them has to know.

**A flow, not a formula.** Each anchor is a velocity field that is zero outside
its disc — a push out from its centre (*bulge*; negative is a pinch) and a push
round it (*twirl*), both fading as `(1 − u²)²` so the rim meets the flat plane
without a kink. A point is carried along the sum of every field for one unit
of time (Runge–Kutta). A flow cannot fold, however strong the anchors are or
however they overlap, so every point on screen has exactly one point of the
drawing under it, and running the flow backwards finds it. Checked: the way
back retraces the way out to within 0.002 units, and the local area never goes
to zero, even with two full-strength anchors overlapping.

**Compact.** Outside every disc nothing moves, and a copy of a mark no disc
reaches is painted from its ordinary `Path2D`, exactly as before.

## Ideas tried

| Chip | Anchors | What it shows |
|---|---|---|
| Lens | one bulge, on the plane | Everything under it bends, rules and grid too. Inside the lens the pattern stops repeating exactly |
| Pinch | one negative bulge | The same squeezed in; the rules bow towards the middle |
| Twirl | one twirl | A whirlpool whose rim stays put |
| Two lenses | bulge + pinch-twirl, overlapping | Anchors add; nothing tears or folds where they meet |
| Straight seams | one bulge **in every square**, disc inside the square | Each square swells, the seams stay dead straight, and it is still a tiling |
| Curved tiles | one twirl **in every square**, sitting on a seam | The tile edges become S-curves — and the curved tiles still fit each other |
| Field | bulge and pinch in every square | A texture laid over the whole tiling |

### Should the tiles curve?

They should bend with everything else, because the rules are lines on the
same paper. `?idea=seams&rules=0` shows the alternative: straight rules over
bent marks, which no longer tell you where a seam is.

If what's wanted is **straight seams**, that is a choice of anchor, not a
switch: an anchor that repeats in every square with its disc inside the square
leaves the edges untouched (*Straight seams*). Put the anchor on a seam and you
get **curved tiles** instead. Both still tessellate.

### Plane or tile

- **Plane** — each anchor once, where it was put. A lens over the pattern.
  The table's default.
- **Tile** — each anchor in every square, carried round by that square's
  quarter-turn. The warp repeats exactly as the drawing does. A warped copy
  then depends only on the copy's position within the block, so there are at
  most `n²` versions of each mark to build and keep, and the SVG gets one
  definition per block square with every square on the sheet pointing at its
  own.

### Bends or swells

- **Bends** warps each stroke's centreline and strokes it at the width it was
  given.
- **Swells** outlines the stroke while it is still flat — one piece per
  segment, join and round end, all wound the same way — and warps that as an
  area, filled nonzero so overlaps are painted once (translucent ink stays
  even). A bulge thickens the ink along with the paper under it.

A fill is tucked 0.6 under the edge of its border. With Bends, wherever the
warp magnifies by more than about 1.14×, the fill's edge moves out past a border
that stayed the same width, and a ring of bare paper opens between them
(4.4 × 1.14 > 5 for the default nine-unit stroke).
`?idea=inside&ink=bend&tiles=1.1&grid=0` shows it round the triangles. Swells
keeps them together at any strength, at three to four times the cost of Bends.
The table offers both.

### Aiming anchors

An anchor never moves its own centre, but the anchors around it do, and then
its own flow carries the difference on. Taken back through the warp, an anchor
dropped inside another disc would land off the pointer. So it is aimed:
Newton's method on the whole warp, with the anchor's own field moving with it.

## Cost

A full rebuild of the lab's opening view (about 4.6 × 3.5 squares), which is
what one frame of an anchor drag costs, in node on this machine:

| Drawing | Lens | Twirl | Curved tiles | Field |
|---|---|---|---|---|
| demo (10 marks), bends / swells | 3 / 8 ms | 5 / 20 ms | 17 / 59 ms | 28 / 96 ms |
| + a 600-point pencil stroke kept as drawn | 6 / 15 ms | 12 / 43 ms | 24 / 100 ms | 41 / 181 ms |

Repeating anchors cost the most: every square has its discs, and where they
pile up the flow takes more steps. The pencil stroke is cheap only because the
flat centreline is pared (Douglas–Peucker) before it is outlined and warped;
unpared, the same row took up to two seconds.

Panning and zooming within a zoom step cost nothing, since the copies are
cached per mark, per square (or block square), per zoom step.
