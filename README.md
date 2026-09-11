# Tessera

A drawing table for tessellated patterns. You draw on one square tile; the plane
around it repeats that tile forever, each copy given a quarter-turn by a symmetry
pattern you control. Every mark appears in every tile as you make it.

Everything is vector: the drawing is a list of paths, curves, circles and filled
regions in tile coordinates, redrawn from those primitives at whatever zoom you
are at. Nothing is stored as pixels, and `Save SVG` writes real geometry.

**[Open the drawing table →](https://invertedworld.github.io/tessera/)**

![The table, with a filled triangle and an arc repeating under a pinwheel block](docs/screenshot.jpg)

## Running it

It runs entirely in the browser: nothing is uploaded, and a drawing in progress
is kept in that browser's own storage until you save it to a file.

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
| **Select** `Space` | Click a mark to pick it up, drag to move it. **Shift-click** adds another to what you are holding, or puts it back down; a **two-finger sweep** takes everything in an area (see below). Outlined shapes can be grabbed by their middle. A mark dragged into a neighbouring tile comes home — the plane repeats, so it is the same mark one period over |
| **Pencil** `P` | Freehand, tidied when you let go: the points that carry no shape are dropped and the rest eased, with the ends pinned where your hand started and finished. Held drag only, and it ignores the grid entirely |
| **Line** `L` | Click each end. It then carries on from where it stopped, so a run of clicks draws a connected chain — `Esc`, or clicking the same point twice, finishes it. Hold `Shift` to hold it horizontal, vertical or to 45° — to one of the six isometric ways out on the Iso frame; with a lattice up the length is quantised along that direction too |
| **Arc** `A` | Two clicks for the ends, then move to bend it and click to set. Hold `Shift` while bending to keep it symmetrical — the apex is held square above the middle of the chord. The bend may sit outside the tile and the click that sets it can land anywhere |
| **Circle** `C` | Click the centre, then click to set the radius; `Shift` quantises it |
| **Rect** `R` | Click a corner, then the opposite one; `Shift` for a square. On the **Iso** frame it draws a rhombus instead — a face of a cube |
| **Fill** `F` | Click an enclosed area — the boundary is traced and stored as a polygon, so it stays sharp at any zoom. Click a mark instead and it takes the current ink. Filling an area again recolours it in place, and an already-filled area can still be cut up by new lines and its parts filled separately |
| **Erase** `E` | Click or drag across a mark to remove it. A border answers before the interior of the mark holding it, and before a fill, so a line drawn across a filled shape can still be got at — and a mark can be rubbed out by any of its ink, including the part that has run over a neighbouring square |

Straight geometry is stroked with **flat ends**, so a line stops exactly on
the point it was placed on and runs flush to the tile edge to meet its own
reflection; rectangle corners mitre. Freehand keeps round ends.

Where two ends **meet**, though, the corner is rounded off — flat caps meeting
at an angle leave a notch on the outside of the join. Ends that stop in space
stay flat, so precision is kept where it matters and corners still look like
corners.

Ends meet **across the seam** as well as within a square: a mark running past
its own edge can join another square's copy end to end, and that corner is
rounded too. Which ends meet there depends only on where a square sits in the
block, so it is worked out once per block position and kept until the marks
change. (`Save SVG` writes one definition reused for every square, so it can
only carry the joins that happen within one — the ones made by the tiling are
not in it.)

### Fills and groups

Filling an area does one of two things:

- If the area is exactly the inside of one closed mark, it becomes that mark's
  own interior — one object, with the border and the fill separately
  recolourable by clicking either with the fill tool. It is still a fill, and
  is painted at fill depth: an area filled *inside* that mark goes on top of
  it, not under.
- If it was bounded by several marks — a triangle drawn as three lines, say —
  the fill is **grouped** with them. Picking up any member moves the whole
  group, and `Delete` removes it.

With *Wrap at edges* on the tile is a torus, and the fill wraps with it: a
shape straddling the seam is one area and fills in a single click, on both
sides.

### Picking things up

Click a mark to hold it; **Shift-click** to add another, or to put one back
down. Holding any member of a group holds the whole group — what is outlined is
what will move.

**Sweeping an area.** Press on empty paper and drag: a box follows the
pointer, the count of what is inside follows with it, and everything **wholly
inside** is held on release. Wholly, not merely touched, so sweeping over a
figure does not drag in the ground it sits on. Shift-drag keeps what you were
already holding and adds to it; `Esc` part-way through drops the sweep and puts
back what was in hand.

Because a drag now sweeps, the plane is panned with the select tool up by
two-finger scrolling or a middle/right-drag rather than by dragging the paper.
Pinch still zooms.

**Turn 45°**, either way, turns what you are holding about the centre of what
it makes together — so a figure of several marks keeps its shape instead of
each mark spinning on its own spot. An upright box cannot hold a turn, so it
becomes the four-cornered polygon the turn has just made of it, and carries on
behaving like one.

**Cut** `⌘X`, **Copy** `⌘C` and **Paste** `⌘V` work on what you are holding.
The marks go on the **real clipboard**, written as the same JSON a drawing is
saved as, so a figure can be carried to another tile, another tab, another day —
or pasted into a text editor and read. Everything comes back with fresh ids: a
pasted group stays a group without joining a group already on the tile, and a
pasted fill goes on naming the borders it arrived with. Each paste steps a
little further from the last so they do not stack, and lands held by the select
tool, ready to be dragged into place.

**Group** `G` binds what you are holding into one thing that moves, recolours
and goes as a unit; **Ungroup** `U` lets it loose. A fill made against
several marks is grouped with them already — this is the same binding, by hand.
The two buttons under the tools say when they apply: Group wants two separate
things in hand, Ungroup wants something bound.

### With something in hand

What is in hand is haloed in vermilion and put back over the halo, each mark at
the depth the plane paints it — a group holds a fill and the borders around it,
and putting them back in list order buried the borders under the fill.

The palette recolours it, arrow keys nudge it (`Shift` for a bigger step,
one lattice cell at a time when snapping is on), `Delete` removes it and
`Esc` lets it go — all of which act on the whole group if it is in one. Moving
a mark moves every copy of it, since there is only ever one shape — the plane
just repeats it. Whatever you move comes to the top, so it sits above what you
moved it onto.

**Any square is the drawing surface.** Whichever one the pointer is over is
the one you are drawing in, and it holds still while you place a mark. Nothing
is lit up to say so: the lattice is ruled across the whole plane instead, every
square the same, so there is no highlight following the mouse to watch. There
is still only one set of marks — a point is mapped back through that square's
own placement and quarter-turn, so drawing in a turned tile puts the mark
exactly where you drew it and the pattern follows.

Marks may start on the tile edge and run past it — that is how a motif is made
to carry across the seam.

*Solid shapes* fills circles and rectangles instead of outlining them.

Ink `1`–`9`,`0` (the first ten of the palette in hand) · weight `[` `]` ·
undo/redo `⌘Z` / `⇧⌘Z` · cut/copy/paste `⌘X` `⌘C` `⌘V` ·
group `G` / ungroup `U` (or `⌘G` / `⇧⌘G`) · eyedropper `I` · recentre `H` ·
tile rules `T` · clip `K` · wrap `W` · snap `S` · subdivide `D`

### Off the table

| | |
|---|---|
| **New** | A clean tile: it lets go of whatever file the drawing came from and drops the undo history with it. With marks on the table it asks *Do you want to save your changes?* first — in the rail, not in a browser box. **Yes** saves and then starts over, and backing out of the file picker leaves everything as it was; **No** starts over anyway; **Cancel** or `Esc` goes back |
| **Load** `⌘O` / **Save** `⌘S` / **Save as** `⇧⌘S` | The drawing as a `.json` file — see below |
| **Save SVG** | The pattern as vector paths, several whole blocks of it, with the rules and the lattice left off |
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

Where the browser has the File System Access API (**Chrome and Edge only** —
Safari and Firefox have none), the file you opened or saved is **kept**: *Save* writes straight back to it without asking
again, and the handle is stashed in IndexedDB so it survives a reload — the
first save after coming back may ask once for permission, then goes quiet.
*Save as* always asks for a new place.

**Elsewhere there is no picker at all**, so nothing can be written back over
and the buttons stop pretending otherwise: they read **Download** and **Download
as** on those browsers, and the exports beside them read Download SVG and
Download PNG, because that is where all four end up. Download keeps offering
the name it last used, which is as near as a download gets to writing back over
something; Download as takes a fresh one. *Load* opens the ordinary file
chooser. The file in play is named under the buttons, with a
vermilion dot while the drawing has moved on since it was written.

Opening a drawing, or starting one, is a new session rather than an edit, so
the **undo history goes** with it: the steps behind it belong to a picture that
is no longer on the table. Save before you load if the marks matter.

Pan by two-finger scrolling or middle/right-dragging. With every tool but
select, dragging empty space pans too — under the select tool that drag sweeps
out an area instead.

## Palette

Three palettes come with the table — **Riso**, **Bauhaus** and **Graphite**,
fifteen colours each — and you can keep as many of your own as you like.

Under the swatches is the mixer: a **hex field** that takes any of `#rrggbb`,
`#rgb`, `#rrggbbaa` or `#rgba`, with or without the `#`; a half-filled circle
that opens the system colour picker; and an **eyedropper** `I` — arm it and the
next click anywhere on the plane takes the colour under the pointer, `Esc` to
put it down.

It asks the **mark**, and the canvas only where there is no mark. A stroke two
units wide is half soft edge, and a pixel read off that edge is the mark's
colour mixed with whatever is behind it, never the colour the mark is drawn in.
Click a border and you get the border's colour, the inside of a closed mark and
you get its interior's, a filled area and you get the fill's; click bare paper
and it reads the canvas — which is not the screen, because the paper grain lies
over the window on a multiply blend and anything sampled through it would come
back tinted and grainy. **Alpha** sets how far through the ink
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

### Frame

Three frames to draft in:

- **Square** — the plain lattice, everything upright.
- **Iso** — a triangular lattice: upright lines, and two families thirty
  degrees either side of level. Every step out of a lattice point is the
  **same length whichever of the six ways it goes**, which is the thing a
  square lattice cannot do — a step along its diagonal is √2 of a step along
  its side, turned or not. So a box drawn on it has edges that are actually
  equal, and reads as a solid rather than as a drawing of one.

  On this frame the rectangle tool draws a rhombus instead: the drag falls in
  one of the six wedges and the two directions around it become its sides, so
  every box you pull out is a face of a cube — three drags make one. `Shift`
  makes the sides equal. `Shift` on a line or an arc holds it to one of the six
  ways out, a whole number of steps along.

  The lattice is ruled over every square, and **turned with each of them**: a
  quarter-turn carries a square lattice onto itself but not a triangular one,
  and what is drawn has to be what a mark placed there would line up with. It
  is dropped when the squares get too small or too many for it to help.

  The upright lines are the tile's own columns, so they land on its edges; the
  rows they carry cannot also divide the tile, because a triangular lattice and
  a square have no common measure. This frame is a drafting aid within the
  square rather than something that repeats across the seam — and it could not
  be otherwise, since a quarter-turn does not carry a triangular lattice onto
  itself.
- **45°** — the whole plane turns instead: tiles, rules, lattice and every mark
  together, so a tile-aligned square reads as a diamond on screen. Drawing
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
  block's boundaries heavier again. They read darker and thicker than the
  alignment lattice inside them, so the structure sits over the drafting aid
  rather than under it; where the squares are packed too close to carry a
  wider line they drop back to a hairline. Display only
- **Clip to tile** — on cuts every mark at the tile's edge. Off by default, so
  a mark that runs past the seam bleeds over its neighbours and overlaps them,
  which is usually what you want while drawing. With it off the plane is
  painted mark by mark across every square rather than square by square, so
  depth means the same thing everywhere: finishing one square before starting
  the next would put everything the next square draws over everything this one
  drew, and a fill two squares along would land on a border already laid down
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

The fill rasterises the marks into a scratch grid only to work out *which*
enclosed area was clicked. It floods from the cursor (eight-connected, since
the gap where two marks converge is a diagonal channel), bridges the cell or
two the grid loses where that gap pinches shut, walks the boundary into closed
loops and simplifies them.

What goes into the grid is **everything the eye can see holding that area in**,
not just the square's own marks. With clipping off a mark runs over its
neighbours, so the squares around this one lay ink on it as well; each is drawn
through its own quarter-turn and mapped back into this square's frame. Without
that, an area enclosed by a neighbour's ink flooded straight out, because the
flood had never been told about it.

**How wide the grid is laid** answers the other half of that. An area held in
partly by a neighbour's ink runs past the square's edge, and a fill that
stopped there left a bite out of the shape — so when the flood reaches the edge
of its grid, the grid is laid again over the square and the ring around it and
the flood run afresh. Most fills never touch the edge and pay nothing for it.
Two cases are not areas that continue, and stay on the square: one meeting
**all four** edges is the ground the marks sit on, and one still running at the
wider grid was never enclosed at all — a mark the size of the square tiles,
where one the size of three does not.

How far it may bridge is set by the **thinnest mark in play**. The bridge eats
into a wall from the inside, and a wall it eats through is no wall: an outline
five units across used to let the fill straight out into the rest of the tile.
A mark only two cells across on the scratch grid can spare none, so a hairline
outline gets no bridging at all — a fill that stops a hair short of a pinch
being a great deal better than one that escapes the shape.

A grid can only place an edge to the nearest cell, which leaves a fill either
short of the mark bounding it or spilling past it — and no amount of tuning the
grid fixes both at once. So the traced ring is used for its **topology** only.
Each of its points is then moved onto the **true** edge of whichever mark it is
closest to: half that mark's width out from its centreline, less a hair so it
tucks under rather than meeting exactly. The marks are exact, so the fill's
edge becomes exact too.

Points are not enough on a **round** wall, though. Two of them are joined by a
straight chord, and a chord across a circle cuts inside it — by the sagitta,
which grows as the square of the gap between them. The points were tucked under
the ink; the chord between them was not, and came out from under it, leaving a
bare crescent between fill and border. So the wall is followed: halve the
chord, put the middle back on the wall, and keep halving until what is left is
under a sixth of a unit. A straight wall passes that test first time and gains
nothing.

What gets stored is the resulting polygon — outer contour plus any holes, drawn
with the even-odd rule — never the bitmap.

## Licence

MIT — see [LICENSE](LICENSE). The typefaces are Google Fonts (Fraunces and IBM
Plex Mono), loaded from Google's CDN under their own open licences. The
eyedropper glyph is `eyedropper` from
[Bootstrap Icons](https://icons.getbootstrap.com/icons/eyedropper/), MIT; every
other icon is drawn here.
