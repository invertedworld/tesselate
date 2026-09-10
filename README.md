# Tessera

A drawing table for tessellated patterns. You draw on one square tile; the plane
around it repeats that tile forever, each copy given a quarter-turn by a symmetry
pattern you control. Every mark appears in every tile as you make it.

Everything is vector: the drawing is a list of paths, curves, circles and filled
regions in tile coordinates, redrawn from those primitives at whatever zoom you
are at. Nothing is stored as pixels, and `Save SVG` writes real geometry.

## Running it

Open `index.html` — no build step, no dependencies. For a local server:

    python3 -m http.server 8000     # then visit localhost:8000

## Drawing

Shapes are placed click by click: **click to set the first point, move,
then click again to set it.** Releasing the first click does not finish the
mark — it stays live and follows the cursor until the second click, and
`Esc` drops it. Dragging in one motion still works if you prefer it.

| Instrument | |
|---|---|
| **Select** `Space` | Click a mark to pick it up, drag to move it. Outlined shapes can be grabbed by their middle. A mark dragged into a neighbouring tile comes home — the plane repeats, so it is the same mark one period over |
| **Pencil** `P` | Freehand, tidied when you let go: the points that carry no shape are dropped and the rest eased, with the ends pinned where your hand started and finished. Held drag only, and it ignores the grid entirely |
| **Line** `L` | Click each end. It then carries on from where it stopped, so a run of clicks draws a connected chain — `Esc`, or clicking the same point twice, finishes it. Hold `Shift` to hold it horizontal, vertical or to 45°; with a lattice up the length is quantised along that direction too |
| **Arc** `A` | Two clicks for the ends, then move to bend it and click to set. The bend may sit outside the tile and the click that sets it can land anywhere |
| **Circle** `C` | Click the centre, then click to set the radius; `Shift` quantises it |
| **Rect** `R` | Click a corner, then the opposite one; `Shift` for a square |
| **Fill** `F` | Click an enclosed area — the boundary is traced and stored as a polygon, so it stays sharp at any zoom. Click a mark instead and it takes the current ink. Filling an area again recolours it in place, and an already-filled area can still be cut up by new lines and its parts filled separately |
| **Erase** `E` | Click or drag across a mark to remove it |

Straight geometry is stroked with **flat ends**, so a line stops exactly on
the point it was placed on and runs flush to the tile edge to meet its own
reflection; rectangle corners mitre. Freehand keeps round ends.

Where two ends **meet**, though, the corner is rounded off — flat caps meeting
at an angle leave a notch on the outside of the join. Ends that stop in space
stay flat, so precision is kept where it matters and corners still look like
corners.

### Fills and groups

Filling an area does one of two things:

- If the area is exactly the inside of one closed mark, it becomes that mark's
  own interior — one object, with the border and the fill separately
  recolourable by clicking either with the fill tool.
- If it was bounded by several marks — a triangle drawn as three lines, say —
  the fill is **grouped** with them. Picking up any member moves the whole
  group, and `Delete` removes it.

With *Wrap at edges* on the tile is a torus, and the fill wraps with it: a
shape straddling the seam is one area and fills in a single click, on both
sides.

### With something selected

The palette recolours it, arrow keys nudge it (`Shift` for a bigger step,
one lattice cell at a time when snapping is on), `Delete` removes it and
`Esc` lets it go — all of which act on the whole group if it is in one. Moving
a mark moves every copy of it, since there is only ever one shape — the plane
just repeats it. Whatever you move comes to the top, so it sits above what you
moved it onto.

**Any square is the drawing surface.** Whichever one the pointer is over
becomes live — its wash, crop marks and lattice follow the mouse — and it holds
still while you place a mark. There is still only one set of marks: a point is
mapped back through that square's own placement and quarter-turn, so drawing in
a turned tile puts the mark exactly where you drew it and the pattern follows.

Marks may start on the tile edge and run past it — that is how a motif is made
to carry across the seam.

*Solid shapes* fills circles and rectangles instead of outlining them.

Ink `1`–`9`,`0` · weight `[` `]` · undo/redo `⌘Z` / `⇧⌘Z` · recentre `H` ·
tile rules `G` · clip `K` · wrap `W` · snap `S` · subdivide `D`

Pan by two-finger scrolling, middle/right-dragging, or dragging empty space
with the select tool.

## The alignment grid

*Grid* lays an *n × n* lattice over the square you are working in — 2, 3, 4, 6,
8, 12 or 16, cycled with `D`. It is a drafting aid and is independent of
snapping: you can have the lattice without it pulling on anything.

What you set is what you see at the fitted zoom. **Every doubling of the zoom
halves the cells again**, drawn fainter than the lattice you asked for, so
closing in gives you finer places to put things — up to five levels, and never
finer than the screen can show. Each level contains the one above it, so a mark
placed close in still lines up with one placed far out.

### Turn 45°

Three ways to sit the work on the diagonal:

- **Off** — everything square.
- **Grid** — only the drafting frame turns. The lattice becomes diamonds, marks
  snap to it, and the rectangle tool draws diamonds, on a plane that stays
  square. The diamond lattice is the square lattice plus its cell centres, so
  it still repeats exactly every tile and marks placed on it meet across the
  seam.
- **Plane** — the whole plane turns instead: tiles, rules, lattice and every
  mark together, so a tile-aligned square reads as a diamond on screen. Drawing
  works unchanged; the pointer is mapped back through the angle.

*Snap to grid* (`S`) pulls new geometry onto the lattice **and onto the marks
already on the tile** — the ends and middles of lines and arcs, the centres and
rims of circles, the corners of rectangles. A mark within reach of the cursor
wins over the lattice, and snapping keeps working with the grid switched off.

A red cross marks the point that has been caught. What it pulls:

- line and curve endpoints, and the point an arc is bent through
- both corners of a rectangle
- circle centres, with the radius stepping half a cell at a time
- a mark being dragged with the select tool, by its own anchor — so a snapped
  mark stays snapped and a stray one is pulled into line

Freehand is deliberately exempt: the pencil never touches the lattice.

Snapping the ends to the tile edge is what makes a motif meet its own
reflection cleanly across the seam, and it closes shapes reliably enough for
the fill tool to find them. Hold `Alt` to ignore the lattice for one mark.
`Shift` takes precedence over snapping: asking for a direction is the more
specific request, and the length is then quantised along it so the far end
still lands on the lattice.

The two switches are independent: setting *Grid* to `Off` leaves snapping on
and working — it just falls back to the marks themselves.

## Symmetry

Rotation is defined by an *n × n* block of quarter-turns tiled across the plane.
Pick a preset, choose a block size of 1–4, then click any cell to turn it a
quarter at a time. The cell with the upright arrow is your drawing surface and stays upright, so
presets are stored relative to it.

- **Translate** — no rotation, plain repetition
- **Pinwheel** — the 2×2 four-fold rotation
- **Rows** / **Columns** / **Checker** — half-turns in one direction or alternating
- **Triple**, **Cascade**, **Windmill**, **Spin** — diagonal and 4×4 rotations

## Plane

- **Tile rules** — the tile grid drawn across the plane, with the symmetry
  block's boundaries heavier. Display only
- **Clip to tile** — off lets marks bleed over their neighbours and overlap
- **Wrap at edges** — a mark leaving one edge re-enters at the opposite one,
  for motifs that must run continuously
- **Grid** / **Snap to grid** — the alignment lattice, above

Pinch the trackpad to zoom; two-finger scroll or middle-drag to pan.
Work is kept in `localStorage`, so the table is as you left it.

*Save SVG* and *Save PNG* write the marks and nothing else — no grid, no crop
marks, no paper — on a clear ground. The SVG is a single `<g>` of vector paths
instanced once per tile with a rotation, over a block-aligned sheet of at least
4×4 tiles.

## Layout

    index.html        markup and the control rail
    styles.css        all styling
    src/geometry.js   path building, SVG path data, simplification,
                      flood fill to vector contour tracing
    src/patterns.js   symmetry presets and the rotation lookup
    src/app.js        state, renderer, input, UI, export

### How fill stays vector

The fill tool rasterises only the current tile's strokes into an offscreen
scratch grid, floods the area under the cursor, grows the mask a little so it
tucks under the surrounding strokes, then walks the mask boundary into closed
loops and simplifies them (Douglas–Peucker). What gets stored is the resulting
polygon — outer contour plus any holes, drawn with the even-odd rule — never the
bitmap.
