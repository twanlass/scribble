# scribble

Drop-in freehand drawing annotation overlay for any web page. Zero dependencies, no build step, pure ES modules.

Press a hotkey to enter drawing mode, sketch annotations over page content, and they stay anchored as the page scrolls.

## Install

### With a coding agent (Claude Code, Cursor, etc.)

Paste this prompt into your AI coding agent:

```
Install the @twanlass/scribble package (npm install @twanlass/scribble). Then add it to
my project so freehand annotations are available on every page. Import createScribble
from '@twanlass/scribble' and call createScribble() on page load. Press "P" to toggle
drawing mode. See the docs at https://github.com/twanlass/scribble for options and API.
```

### Manual install

```bash
npm install @twanlass/scribble
```

## Quick Start

```js
import { createScribble } from '@twanlass/scribble'

const scribble = createScribble()
```

That's it. Press **P** to toggle drawing mode on and off.

## Hotkeys

All hotkeys only work when pen mode is active (except the toggle key).

| Key | Action |
|-----|--------|
| `p` | Toggle pen mode on/off |
| `c` | Open color picker / cycle to next color |
| `s` | Cycle through brush sizes |
| `[` / `]` | Cycle brush size down / up |
| `Cmd+Z` / `Ctrl+Z` | Undo last stroke |

Hotkeys are suppressed when focus is in an `<input>`, `<textarea>`, `<select>`, or `contentEditable` element, so typing works normally.

## Color Picker

Press **C** to show a floating color picker at the cursor. Press **C** again to cycle through colors. You can also hover over the picker and click a color directly. The picker fades out after 750ms of inactivity.

**Built-in palette:** black (`#060606`), red (`#eb553e`), lime (`#BDDD2D`), purple (`#be37f3`), blue (`#379bf3`)

## Brush Sizes

Press **S** or use **[** / **]** to toggle between two preset sizes (4px and 7px). A size indicator appears at the cursor showing which is active.

## Options

```js
const scribble = createScribble({
  // Hotkey to toggle pen mode. Set to false to disable.
  hotkey: 'p',

  // Default stroke color (should match a palette color).
  color: '#060606',

  // Stroke diameter in pixels.
  size: 4,

  // How much pressure affects stroke width (0-1).
  thinning: 0.44,

  // Min spacing between outline points (0-1). Higher = smoother.
  smoothing: 0.5,

  // Input point smoothing (0-1). Higher = smoother, less responsive.
  streamline: 0.5,

  // Simulate pen pressure from mouse speed. Auto-disabled for real stylus input.
  simulatePressure: true,

  // Taper at the start of each stroke, in pixels.
  start: { taper: 15 },

  // Taper at the end of each stroke, in pixels.
  end: { taper: 7 },

  // CSS selectors for elements that remain clickable in pen mode.
  passthrough: ['#pause-btn', '.toolbar button'],
})
```

All options are optional. Defaults are tuned and ready to use.

## API

`createScribble(options?)` returns a control object:

```js
scribble.enable()    // Enter drawing mode
scribble.disable()   // Exit drawing mode (cancels in-progress stroke)
scribble.toggle()    // Toggle drawing mode
scribble.isEnabled() // Returns true if pen mode is active
scribble.undo()      // Remove the last stroke
scribble.clear()     // Remove all strokes
scribble.destroy()   // Remove all DOM elements and unbind all event listeners
```

## Passthrough (Clickable Elements in Pen Mode)

By default, pen mode captures all pointer events. Use the `passthrough` option to specify CSS selectors for elements that should remain clickable while drawing is active — useful for UI controls like play/pause buttons or toolbars that need to stay interactive.

```js
const scribble = createScribble({
  passthrough: ['#pause-btn', '.toolbar button'],
})
```

Matching uses `.closest()`, so clicks on child elements (like an icon inside a button) will match the parent selector.

## How It Works

### Architecture

Two DOM layers are appended to `document.body`:

1. **Interaction layer** (`position: fixed`) — Captures pointer events across the viewport. `pointer-events: none` when disabled, `all` when active.
2. **SVG render layer** (`position: absolute`) — Holds stroke paths in document-space coordinates. Scrolls with the page so strokes stay anchored to content.

### Coordinate System

Pointer events are translated from viewport to document space (`clientX + scrollX`, `clientY + scrollY`) so strokes are anchored to page content, not the viewport. Scrolling mid-stroke works correctly.

### Freehand Engine

The stroke rendering pipeline (in `freehand.js`):

1. **Streamline** — Smooths raw pointer input via linear interpolation
2. **Radius** — Calculates stroke width at each point from pressure (real pen) or velocity (mouse)
3. **Outline** — Offsets perpendicular to stroke direction to create left/right contours
4. **Partition** — Splits at sharp direction changes for clean rendering
5. **SVG** — Generates filled SVG paths with quadratic Bezier curves and arc end caps

### Stylus Support

Real pen/stylus input is auto-detected via `pointerType === 'pen'`. When detected, actual pressure data is used instead of velocity-based simulation.

## Using the Freehand Engine Directly

The core algorithm is available as a separate export for custom integrations:

```js
import { svgInk } from '@twanlass/scribble/freehand'

const points = [{ x: 10, y: 20, z: 0.5 }, { x: 15, y: 22, z: 0.6 }, ...]
const pathData = svgInk(points, { size: 8, thinning: 0.5 })

// Use as: <path d={pathData} fill="black" />
```

`z` is pressure (0-1, defaults to 0.5). Returns an SVG path data string meant to be used with `fill` (not `stroke`).

## File Structure

```
scribble/
  index.js       Entry point — re-exports public API
  scribble.js    Overlay, events, hotkeys, scroll-aware canvas
  freehand.js    Core freehand stroke algorithm (no DOM)
  package.json   ES module package, zero dependencies
```
