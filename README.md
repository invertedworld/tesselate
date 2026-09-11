# Tessera

A drawing table for tessellated patterns. You draw on one square tile; the plane
around it repeats that tile forever, each copy given a quarter-turn by a symmetry
pattern you control. Every mark appears in every tile as you make it.

Everything is vector: the drawing is a list of paths, curves, circles and filled
regions in tile coordinates, redrawn from those primitives at whatever zoom you
are at. Nothing is stored as pixels, and `Save SVG` writes real geometry.

## Running it

Open `index.html` — no build step, no dependencies. To work on it, serve it
with `serve.py`, which sends `Cache-Control: no-store`:

    ./serve.py 8000                 # then visit localhost:8000

That matters: `python3 -m http.server` sends no cache headers at all, so a
browser may go on serving an old `src/app.js` long after you have changed it,
and an edit appears to do nothing.

## Drawing

Shapes are placed click by click: **click to set the first point, move,
then click again to set it.** Releasing the first click does not finish the
mark — it stays live and follows the cursor until the second click, and
`Esc` drops it. Dragging in one motion still works if you prefer it.

| Tool | |
|---|---|
| **Select** `Space` | Click a mark to pick it up, drag to move it. Outlined shapes can be grabbed by their middle. A mark dragged into a neighbouring tile comes home — the plane repeats, so it is the same mark one period over |
| **Pencil** `P` | Freehand, tidied when you let go: the points that carry no shape are dropped and the rest eased, with the ends pinned where your hand started and finished. Held drag only, and it ignores the grid entirely |
| **Line** `L` | Click each end. It then carries on from where it stopped, so a run of clicks draws a connected chain — `Esc`, or clicking the same point twice, finishes it. Hold `Shift` to hold it horizontal, vertical or to 45°; with a lattice up the length is quantised along that direction too |
| **Arc** `A` | Two clicks for the ends, then move to bend it and click to set. Hold `Shift` while bending to keep it symmetrical — the apex is held square above the middle of the chord. The bend may sit outside the tile and the click that sets it can land anywhere |
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

Ink `1`–`9`,`0` (the first ten of the palette in hand) · weight `[` `]` ·
undo/redo `⌘Z` / `⇧⌘Z` · recentre `H` · tile rules `G` · clip `K` ·
wrap `W` · snap `S` · subdivide `D`

### Off the table

| | |
|---|---|
| **New** | A clean tile: it lets go of whatever file the drawing came from and drops the undo history with it. With marks on the table it asks *Do you want to save your changes?* first — in the rail, not in a browser box. **Yes** saves and then starts over, and backing out of the file picker leaves everything as it was; **No** starts over anyway; **Cancel** or `Esc` goes back |
| **Load** `⌘O` / **Save** `⌘S` / **Save as** `⇧⌘S` | The drawing as a `.json` file — see below |
| **Save SVG** | The pattern as vector paths, several whole blocks of it, with the alignment grid and crop marks left off |
| **Save PNG** | The same frame you are looking at, marks only, on a clear ground |
| **Copy PNG** | That same image straight onto the clipboard, to paste anywhere |

## The drawing as a file

A saved `.json` holds the artwork and nothing else: the marks, the symmetry
block they repeat under, and the three plane settings that change what the
pattern looks like — clip, wrap and the 45° turn. Which tool is in hand, the
lattice, the palette: none of that belongs to the drawing, so none of it is
written.

It is meant to be read. One mark per line, so a drawing diffs like source:

    {
     "format": "tessera",
     "version": 1,
     "saved": "2026-09-11T07:01:13.385Z",
     "tile": 1000,
     "pattern": {"n":2,"cells":[0,1,3,2]},
     "plane": {"clip":true,"wrap":false,"diag":"off"},
     "shapes": [
      {"id":1,"layer":"stroke","kind":"line","color":"#cf4326","width":9,"pts":[…]},
      {"id":2,"layer":"fill","color":"#2b4a9c40","loops":[[…]]}
     ]
    }

Coordinates are in tile units — the tile is `tile` across, 1000 — so a drawing
is resolution-free and stays exact at any zoom.

Where the browser has the File System Access API (Chrome, Edge), the file you
opened or saved is **kept**: *Save* writes straight back to it without asking
again, and the handle is stashed in IndexedDB so it survives a reload — the
first save after coming back may ask once for permission, then goes quiet.
*Save as* always asks for a new place. Elsewhere *Save* downloads and *Load*
opens a file chooser. The file in play is named under the buttons, with a
vermilion dot while the drawing has moved on since it was written.

Opening a drawing, or starting one, is a new session rather than an edit, so
the **undo history goes** with it: the steps behind it belong to a picture that
is no longer on the table. Save before you load if the marks matter.

Pan by two-finger scrolling, middle/right-dragging, or dragging empty space
with the select tool.

## Palette

Three palettes come with the table — **Riso**, **Bauhaus** and **Graphite**,
fifteen colours each — and you can keep as many of your own as you like.

Under the swatches is the mixer: a **hex field** that takes any of `#rrggbb`,
`#rgb`, `#rrggbbaa` or `#rgba`, with or without the `#`, and an eyedropper
button for the system colour picker. **Alpha** sets how far through the ink
you can see; a colour keeps its short form while it is solid and gains the
extra two digits the moment it is not, so the swatch and the field always
agree. Translucent ink is real ink: it fills, strokes, exports and layers like
any other, and every well is drawn over a check so you can see what is left of
the paper.

**+** puts the colour in hand into the palette. The three built-ins are as
printed, so adding to one takes a copy first — *My Riso*, say — and adds it
there. **New** names a palette of your own starting from whatever is on screen;
a swatch in one of yours has a **×** on hover; **Del** asks once, then removes
the palette. Your palettes are kept with the drawing.

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

A red cross marks the point that has been caught. Targets are ranked rather
than just measured: where several marks meet, their midpoints and rims crowd
the junction and would win on distance alone, so a point a mark *ends* at beats
one it merely passes through. What it pulls:

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

The fill rasterises the tile's marks into a scratch grid only to work out
*which* enclosed area was clicked. It floods from the cursor (eight-connected,
since the gap where two marks converge is a diagonal channel), bridges the cell
or two the grid loses where that gap pinches shut, walks the boundary into
closed loops and simplifies them.

A grid can only place an edge to the nearest cell, which leaves a fill either
short of the mark bounding it or spilling past it — and no amount of tuning the
grid fixes both at once. So the traced ring is used for its **topology** only.
Each of its points is then moved onto the **true** edge of whichever mark it is
closest to: half that mark's width out from its centreline, less a hair so it
tucks under rather than meeting exactly. The marks are exact, so the fill's
edge becomes exact too.

What gets stored is the resulting polygon — outer contour plus any holes, drawn
with the even-odd rule — never the bitmap.
