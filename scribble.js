/**
 * Scribble — Drop-in freehand annotation overlay for any web page.
 *
 * Usage:
 *   import { createScribble } from '@twanlass/scribble'
 *
 *   const scribble = createScribble()
 *   // Press "p" to toggle drawing mode on/off.
 *   // Cmd/Ctrl+Z to undo while in drawing mode.
 *   // scribble.enable() / scribble.disable() / scribble.toggle()
 *   // scribble.undo() / scribble.clear() / scribble.destroy()
 */

import { svgInk, Vec, easeOutSine } from './freehand.js';

const DEFAULT_OPTIONS = {
  hotkey: 'p',
  color: '#060606',
  size: 4,
  thinning: 0.44,
  smoothing: 0.5,
  streamline: 0.5,
  simulatePressure: true,
  easing: easeOutSine,
  start: { taper: 15 },
  end: { taper: 7 },
  clearOnDisable: true,
};

/**
 * Create a pen annotation overlay on the current page.
 *
 * @param {Object} [userOptions]
 * @param {string|false} [userOptions.hotkey='p']  Key to toggle. False to disable.
 * @param {string} [userOptions.color='#000000']   Stroke color.
 * @param {number} [userOptions.size=16]            Stroke diameter (px).
 * @param {number} [userOptions.thinning=0.5]       Pressure → width effect (0-1).
 * @param {number} [userOptions.smoothing=0.5]      Outline point spacing (0-1).
 * @param {number} [userOptions.streamline=0.5]     Input smoothing (0-1).
 * @param {boolean} [userOptions.simulatePressure=true]  Simulate pressure for mouse.
 * @param {Object}  [userOptions.start]              Start taper config.
 * @param {Object}  [userOptions.end]                End taper config.
 * @returns {PenOverlay}
 */
export function createScribble(userOptions = {}) {
  // --- Merge options ---
  const opts = {
    ...DEFAULT_OPTIONS,
    ...userOptions,
    start: { ...DEFAULT_OPTIONS.start, ...userOptions.start },
    end: { ...DEFAULT_OPTIONS.end, ...userOptions.end },
  };
  const { hotkey, color: initialColor, clearOnDisable, ...freehandDefaults } = opts;

  // --- Mutable drawing state ---
  let activeColor = initialColor;
  let activeSize = freehandDefaults.size;

  const PALETTE = ['#060606', '#eb553e', '#BDDD2D', '#be37f3', '#379bf3'];
  const SIZES = [4, 7];
  let sizeIndex = SIZES.indexOf(activeSize);
  if (sizeIndex === -1) sizeIndex = SIZES.findIndex(s => s >= activeSize) || 0;
  activeSize = SIZES[sizeIndex];

  // --- Create DOM ---
  const interactionLayer = document.createElement('div');
  interactionLayer.setAttribute('data-scribble-interaction', '');
  Object.assign(interactionLayer.style, {
    position: 'fixed',
    inset: '0',
    zIndex: '2147483646',
    pointerEvents: 'none',
    touchAction: 'none',
  });

  const svgCanvas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svgCanvas.setAttribute('data-scribble-canvas', '');
  Object.assign(svgCanvas.style, {
    position: 'absolute',
    top: '0',
    left: '0',
    width: '1px',
    height: '1px',
    overflow: 'visible',
    pointerEvents: 'none',
    zIndex: '2147483645',
  });

  document.body.appendChild(svgCanvas);
  document.body.appendChild(interactionLayer);

  // --- State ---
  let state = 'disabled'; // 'disabled' | 'idle' | 'drawing'
  let currentPoints = [];
  let currentPath = null;
  let isPenInput = false;
  const strokes = [];

  // --- Coordinate translation: viewport → document space ---
  function toDocumentCoords(e) {
    return new Vec(
      e.clientX + window.scrollX,
      e.clientY + window.scrollY,
      e.pressure || 0.5,
    );
  }

  // --- Rendering ---
  function renderCurrentStroke(isComplete = false) {
    if (!currentPath || currentPoints.length === 0) return;
    const renderOpts = {
      ...freehandDefaults,
      size: activeSize,
      simulatePressure: freehandDefaults.simulatePressure && !isPenInput,
      last: isComplete,
      end: { taper: isComplete ? freehandDefaults.end.taper : 0 },
    };
    const d = svgInk(currentPoints, renderOpts);
    if (d) currentPath.setAttribute('d', d);
  }

  // --- Pointer events ---
  function onPointerDown(e) {
    if (state !== 'idle' || e.button !== 0) return;
    e.preventDefault();
    hideColorPicker();
    hideSizePreview();
    interactionLayer.setPointerCapture(e.pointerId);

    state = 'drawing';
    isPenInput = e.pointerType === 'pen';
    currentPoints = [toDocumentCoords(e)];

    currentPath = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    currentPath.setAttribute('fill', activeColor);
    currentPath.setAttribute('stroke', 'none');
    svgCanvas.appendChild(currentPath);

    renderCurrentStroke();
  }

  function onPointerMove(e) {
    if (state !== 'drawing') return;
    e.preventDefault();

    const events = e.getCoalescedEvents?.() ?? [e];
    for (const ce of events) {
      const pt = toDocumentCoords(ce);
      const last = currentPoints[currentPoints.length - 1];
      if (Vec.Dist(pt, last) >= 1) {
        currentPoints.push(pt);
      }
    }

    renderCurrentStroke();
  }

  function onPointerUp(e) {
    if (state !== 'drawing') return;
    e.preventDefault();

    renderCurrentStroke(true);

    if (currentPath) strokes.push(currentPath);
    currentPath = null;
    currentPoints = [];
    state = 'idle';
  }

  // --- Bind pointer events ---
  interactionLayer.addEventListener('pointerdown', onPointerDown);
  interactionLayer.addEventListener('pointermove', onPointerMove);
  interactionLayer.addEventListener('pointerup', onPointerUp);
  interactionLayer.addEventListener('pointerleave', onPointerUp);
  interactionLayer.addEventListener('pointercancel', onPointerUp);
  interactionLayer.addEventListener('contextmenu', e => e.preventDefault());

  // --- Color picker popup ---
  let pickerEl = null;
  let lastPointerX = 0;
  let lastPointerY = 0;

  // Track cursor position so the picker appears near it
  interactionLayer.addEventListener('pointermove', (e) => {
    lastPointerX = e.clientX;
    lastPointerY = e.clientY;
  }, { passive: true });

  // --- Shared popup helpers ---
  const POPUP_STYLE = {
    position: 'fixed',
    zIndex: '2147483647',
    display: 'flex',
    alignItems: 'center',
    background: '#000',
    borderRadius: '12px',
    boxShadow: '0px 1px 1.8px 0px rgba(0,0,0,0.06), 0px 2px 4px 0px rgba(0,0,0,0.03), 0px 2px 2.7px 3px rgba(0,0,0,0.03)',
    overflow: 'clip',
    opacity: '0',
    transform: 'translateX(-50%) translateY(4px) scale(0.9)',
    transition: 'opacity 250ms ease-out, transform 250ms ease-out',
    pointerEvents: 'none',
  };

  function positionPopup(el) {
    // Centered above cursor, 16px gap
    el.style.left = `${lastPointerX}px`;
    el.style.top = `${lastPointerY - 16}px`;
    el.style.transform = 'translateX(-50%) translateY(-100%) translateY(4px) scale(0.9)';
    // Force layout, then animate in
    el.offsetHeight;
    el.style.opacity = '1';
    el.style.transform = 'translateX(-50%) translateY(-100%) translateY(0) scale(1)';
  }

  function fadeOutPopup(el, onDone) {
    el.style.opacity = '0';
    el.style.transform = 'translateX(-50%) translateY(-100%) translateY(4px) scale(0.9)';
    setTimeout(onDone, 250);
  }

  // --- Color picker ---
  let pickerTimer = null;


  let pickerSwatches = [];
  let pickerHovered = false;

  function swatchShadow(color, active) {
    if (active) return 'inset 0 0 0 2px rgba(255,255,255,0.5)';
    if (color === '#060606') return 'inset 0 0 0 1px rgba(255,255,255,0.5)';
    return 'none';
  }

  function updatePickerSwatches() {
    for (let i = 0; i < pickerSwatches.length; i++) {
      const isActive = PALETTE[i] === activeColor;
      pickerSwatches[i].style.width = isActive ? '22px' : '12px';
      pickerSwatches[i].style.height = isActive ? '22px' : '12px';
      pickerSwatches[i].style.borderRadius = isActive ? '6px' : '4px';
      pickerSwatches[i].style.boxShadow = swatchShadow(PALETTE[i], isActive);
    }
  }

  function showColorPicker() {
    // If already open, cycle to next color
    if (pickerEl) {
      cyclePickerColor();
      return;
    }
    hideSizePreview();

    pickerEl = document.createElement('div');
    Object.assign(pickerEl.style, { ...POPUP_STYLE, gap: '8px', padding: '8px 10px', height: '38px', pointerEvents: 'all', cursor: 'pointer' });

    pickerSwatches = [];
    for (const c of PALETTE) {
      const dot = document.createElement('div');
      const isActive = c === activeColor;
      Object.assign(dot.style, {
        width: isActive ? '22px' : '12px',
        height: isActive ? '22px' : '12px',
        borderRadius: isActive ? '6px' : '4px',
        background: c,
        boxShadow: swatchShadow(c, isActive),
        flexShrink: '0',
        transition: 'width 0.15s, height 0.15s, border-radius 0.15s, box-shadow 0.15s',
      });

      dot.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        activeColor = c;
        updatePickerSwatches();
        pickerHovered = false;
        fadeOutPopup(pickerEl, hideColorPicker);
      });

      pickerSwatches.push(dot);
      pickerEl.appendChild(dot);
    }

    // Hover keeps it open, mouse-out starts dismiss
    pickerEl.addEventListener('pointerenter', () => {
      pickerHovered = true;
      clearTimeout(pickerTimer);
    });
    pickerEl.addEventListener('pointerleave', () => {
      pickerHovered = false;
      startPickerDismiss();
    });

    document.body.appendChild(pickerEl);
    positionPopup(pickerEl);
    startPickerDismiss();
  }

  function startPickerDismiss() {
    clearTimeout(pickerTimer);
    pickerTimer = setTimeout(() => {
      if (pickerEl && !pickerHovered) fadeOutPopup(pickerEl, hideColorPicker);
    }, 750);
  }

  function cyclePickerColor() {
    let idx = PALETTE.indexOf(activeColor);
    idx = (idx + 1) % PALETTE.length;
    activeColor = PALETTE[idx];
    updatePickerSwatches();
    startPickerDismiss();
  }

  function hideColorPicker() {
    clearTimeout(pickerTimer);
    pickerHovered = false;
    pickerSwatches = [];
    if (pickerEl) { pickerEl.remove(); pickerEl = null; }
  }

  // --- Brush size preview ---
  let previewEl = null;
  let previewDots = [];
  let previewTimer = null;

  // Fixed dot sizes matching Figma: small=12px, large=22px
  const SIZE_DOT_PX = [12, 22];

  function updateSizeDots() {
    for (let i = 0; i < previewDots.length; i++) {
      previewDots[i].style.background = i === sizeIndex ? '#ffffff' : '#555';
    }
  }

  function showSizePreview() {
    hideColorPicker();
    clearTimeout(previewTimer);

    if (!previewEl) {
      previewEl = document.createElement('div');
      Object.assign(previewEl.style, { ...POPUP_STYLE, gap: '8px', padding: '8px 12px' });

      previewDots = [];
      for (let i = 0; i < SIZES.length; i++) {
        const d = SIZE_DOT_PX[i];
        const dot = document.createElement('div');
        Object.assign(dot.style, {
          width: `${d}px`,
          height: `${d}px`,
          borderRadius: '100px',
          flexShrink: '0',
          transition: 'background 0.15s',
        });
        previewDots.push(dot);
        previewEl.appendChild(dot);
      }

      document.body.appendChild(previewEl);
      positionPopup(previewEl);
    }

    updateSizeDots();

    // Reset fade timer
    previewTimer = setTimeout(() => {
      if (previewEl) fadeOutPopup(previewEl, hideSizePreview);
    }, 750);
  }

  function hideSizePreview() {
    clearTimeout(previewTimer);
    if (previewEl) { previewEl.remove(); previewEl = null; previewDots = []; }
  }

  // --- Hotkey ---
  function isTyping(el) {
    const tag = el.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return true;
    if (el.isContentEditable) return true;
    return false;
  }

  function onKeyDown(e) {
    if (isTyping(e.target)) return;

    // Toggle hotkey (no modifiers)
    if (hotkey && e.key === hotkey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      hideColorPicker();
      toggle();
      return;
    }

    // Keys below only work when pen mode is active
    if (state === 'disabled') return;

    // Undo
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      undo();
      return;
    }

    // Size: s, [, ] cycle through sizes, wrapping around
    if (e.key === 's' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      sizeIndex = (sizeIndex + 1) % SIZES.length;
      activeSize = SIZES[sizeIndex];
      showSizePreview();
      return;
    }
    if (e.key === '[') {
      e.preventDefault();
      sizeIndex = (sizeIndex - 1 + SIZES.length) % SIZES.length;
      activeSize = SIZES[sizeIndex];
      showSizePreview();
      return;
    }
    if (e.key === ']') {
      e.preventDefault();
      sizeIndex = (sizeIndex + 1) % SIZES.length;
      activeSize = SIZES[sizeIndex];
      showSizePreview();
      return;
    }

    // Color picker: c to open, c again to cycle through colors
    if (e.key === 'c' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault();
      showColorPicker();
      return;
    }
  }

  document.addEventListener('keydown', onKeyDown);

  // --- Public API ---
  function enable() {
    if (state === 'drawing') return;
    state = 'idle';
    interactionLayer.style.pointerEvents = 'all';
    interactionLayer.style.cursor = 'crosshair';
  }

  function disable() {
    hideColorPicker();
    hideSizePreview();
    if (state === 'drawing') {
      // Cancel in-progress stroke
      if (currentPath) { currentPath.remove(); currentPath = null; }
      currentPoints = [];
    }
    state = 'disabled';
    interactionLayer.style.pointerEvents = 'none';
    interactionLayer.style.cursor = '';
    if (clearOnDisable) clear();
  }

  function toggle() {
    state === 'disabled' ? enable() : disable();
  }

  function isEnabled() {
    return state !== 'disabled';
  }

  function undo() {
    const last = strokes.pop();
    if (last) last.remove();
  }

  function clear() {
    while (svgCanvas.firstChild) svgCanvas.firstChild.remove();
    strokes.length = 0;
  }

  function destroy() {
    disable();
    document.removeEventListener('keydown', onKeyDown);
    interactionLayer.remove();
    svgCanvas.remove();
    strokes.length = 0;
  }

  return { enable, disable, toggle, isEnabled, undo, clear, destroy };
}
