/**
 * Freehand Stroke Engine
 *
 * A standalone freehand drawing engine reverse-engineered from tldraw's
 * drawing algorithm. Converts raw pointer input (x, y, pressure) into
 * smooth, pressure-sensitive SVG path strings.
 *
 * Usage:
 *   import { svgInk } from './freehand.js'
 *
 *   const points = [{ x: 10, y: 20, z: 0.5 }, ...]
 *   const pathData = svgInk(points, { size: 16, thinning: 0.5 })
 *   // pathData is a string suitable for <path d="...">
 */

// ─── Vec helper ──────────────────────────────────────────────

class Vec {
  constructor(x = 0, y = 0, z = 0.5) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  clone() { return new Vec(this.x, this.y, this.z); }

  static Sub(a, b) { return new Vec(a.x - b.x, a.y - b.y); }
  static Add(a, b) { return new Vec(a.x + b.x, a.y + b.y); }
  static Mul(v, s) { return new Vec(v.x * s, v.y * s); }

  static Dist(a, b) { return Math.hypot(a.x - b.x, a.y - b.y); }

  static Dist2(a, b) {
    const dx = a.x - b.x, dy = a.y - b.y;
    return dx * dx + dy * dy;
  }

  static Lrp(a, b, t) {
    return new Vec(
      a.x + (b.x - a.x) * t,
      a.y + (b.y - a.y) * t,
      a.z + (b.z - a.z) * t,
    );
  }

  static Dpr(a, b) { return a.x * b.x + a.y * b.y; }

  len() { return Math.hypot(this.x, this.y); }

  uni() {
    const l = this.len();
    if (l === 0) return new Vec(0, 0);
    return new Vec(this.x / l, this.y / l);
  }

  per() { return new Vec(this.y, -this.x); }
  neg() { return new Vec(-this.x, -this.y); }
  mul(s) { return new Vec(this.x * s, this.y * s, this.z); }
  lrp(other, t) { return Vec.Lrp(this, other, t); }
}

// ─── Easing functions ────────────────────────────────────────

function easeOutSine(t) { return Math.sin((t * Math.PI) / 2); }
function linear(t) { return t; }

// ─── Pipeline Stage 1: Streamline & build stroke points ─────

/**
 * Convert raw input points to processed stroke points.
 * Applies streamline smoothing and computes per-point metadata.
 *
 * @param {Array<{x:number, y:number, z?:number}>} rawPoints
 * @param {StrokeOptions} options
 * @returns {StrokePoint[]}
 */
function getStrokePoints(rawPoints, options = {}) {
  const { streamline = 0.5, size = 16, last = false } = options;
  if (rawPoints.length === 0) return [];

  const t = 0.15 + (1 - streamline) * 0.85;
  const pts = rawPoints.map(p => new Vec(p.x, p.y, p.z ?? 0.5));

  if (pts.length === 1) {
    return [{
      point: pts[0], pressure: pts[0].z, vector: new Vec(1, 1),
      distance: 0, runningLength: 0, radius: 1,
    }];
  }

  const strokePoints = [{
    point: pts[0].clone(), pressure: pts[0].z, vector: new Vec(1, 1),
    distance: 0, runningLength: 0, radius: 1,
  }];

  let totalLength = 0;
  let prev = strokePoints[0];

  for (let i = 1; i < pts.length; i++) {
    const isLast = last && i === pts.length - 1;
    const point = isLast
      ? pts[i].clone()
      : pts[i].clone().lrp(prev.point, 1 - t);

    const distance = Vec.Dist(point, prev.point);
    if (distance < 1 && i < pts.length - 1) continue;

    totalLength += distance;
    const sp = {
      point, pressure: pts[i].z,
      vector: Vec.Sub(prev.point, point).uni(),
      distance, runningLength: totalLength, radius: 1,
    };
    strokePoints.push(sp);
    prev = sp;
  }

  return strokePoints;
}

// ─── Pipeline Stage 2: Pressure → radius ────────────────────

/**
 * Set the radius at each stroke point based on pressure and thinning.
 * Modifies stroke points in place.
 */
function setStrokePointRadii(strokePoints, options = {}) {
  const {
    size = 16, thinning = 0.5, simulatePressure = true,
    easing = easeOutSine, start = {}, end = {},
  } = options;

  const RATE = 0.275;
  let prevPressure = strokePoints[0]?.pressure ?? 0.5;
  const totalLength = strokePoints[strokePoints.length - 1]?.runningLength ?? 0;

  const taperStart = start.taper === true ? totalLength : (start.taper ?? 0);
  const taperEnd = end.taper === true ? totalLength : (end.taper ?? 0);
  const taperStartEase = start.easing ?? linear;
  const taperEndEase = end.easing ?? linear;

  for (const sp of strokePoints) {
    if (thinning !== 0) {
      let { pressure } = sp;
      const vel = Math.min(1, sp.distance / size);

      if (simulatePressure) {
        const rp = Math.min(1, 1 - vel);
        pressure = Math.min(1, prevPressure + (rp - prevPressure) * (vel * RATE));
      } else {
        pressure = Math.min(1, prevPressure + (pressure - prevPressure) * (vel * RATE));
      }

      sp.radius = size * easing(0.5 - thinning * (0.5 - pressure));
      prevPressure = pressure;
    } else {
      sp.radius = size / 2;
    }
  }

  if (taperStart > 0 || taperEnd > 0) {
    for (const sp of strokePoints) {
      const ts = taperStart > 0 && sp.runningLength < taperStart
        ? taperStartEase(sp.runningLength / taperStart) : 1;
      const te = taperEnd > 0 && (totalLength - sp.runningLength) < taperEnd
        ? taperEndEase((totalLength - sp.runningLength) / taperEnd) : 1;
      sp.radius = Math.max(0.01, sp.radius * Math.min(ts, te));
    }
  }
}

// ─── Pipeline Stage 3: Generate outline tracks ──────────────

/**
 * Compute left and right outline tracks by offsetting perpendicular
 * to the stroke direction at each point.
 */
function getStrokeOutlineTracks(strokePoints, options = {}) {
  const { size = 16, smoothing = 0.5 } = options;

  if (strokePoints.length < 2) {
    if (strokePoints.length === 1) {
      const p = strokePoints[0].point;
      return { left: [p.clone()], right: [p.clone()] };
    }
    return { left: [], right: [] };
  }

  const minDist2 = Math.pow(size * smoothing, 2);
  const leftPts = [];
  const rightPts = [];
  let pl = null, pr = null;

  for (let i = 0; i < strokePoints.length; i++) {
    const { point, vector, radius } = strokePoints[i];
    let offset;

    if (i === 0 || i === strokePoints.length - 1) {
      offset = strokePoints[i].vector.per().mul(radius);
    } else {
      const next = strokePoints[i + 1];
      const nextV = Vec.Sub(point, next.point).uni();
      const dpr = Vec.Dpr(nextV, vector);
      offset = Vec.Lrp(nextV, vector, Math.abs(dpr)).uni().per().mul(radius);
    }

    const tl = Vec.Sub(point, offset);
    const tr = Vec.Add(point, offset);

    if (i <= 1 || !pl || Vec.Dist2(pl, tl) > minDist2) { leftPts.push(tl); pl = tl; }
    if (i <= 1 || !pr || Vec.Dist2(pr, tr) > minDist2) { rightPts.push(tr); pr = tr; }
  }

  return { left: leftPts, right: rightPts };
}

// ─── SVG helpers ─────────────────────────────────────────────

function precise(v) { return `${v.x.toFixed(2)},${v.y.toFixed(2)}`; }
function average(a, b) { return `${((a.x + b.x) / 2).toFixed(2)},${((a.y + b.y) / 2).toFixed(2)}`; }

// ─── Pipeline Stage 4: Partition at elbows ──────────────────

function partitionAtElbows(strokePoints) {
  if (strokePoints.length < 3) return [strokePoints];
  const partitions = [];
  let current = [strokePoints[0]];

  for (let i = 1; i < strokePoints.length - 1; i++) {
    current.push(strokePoints[i]);
    const prevV = Vec.Sub(strokePoints[i].point, strokePoints[i - 1].point).uni();
    const nextV = Vec.Sub(strokePoints[i + 1].point, strokePoints[i].point).uni();
    if (Vec.Dpr(prevV, nextV) < -0.8) {
      partitions.push(current);
      current = [strokePoints[i]];
    }
  }
  current.push(strokePoints[strokePoints.length - 1]);
  partitions.push(current);
  return partitions;
}

// ─── Pipeline Stage 5: Render SVG path ──────────────────────

function renderPartition(strokePoints, options) {
  if (strokePoints.length < 2) {
    if (strokePoints.length === 1) {
      const p = strokePoints[0];
      const r = p.radius;
      return `M${(p.point.x - r).toFixed(2)},${p.point.y.toFixed(2)}` +
             `a${r},${r} 0 1 0 ${(r * 2).toFixed(2)},0` +
             `a${r},${r} 0 1 0 ${(-r * 2).toFixed(2)},0Z`;
    }
    return '';
  }

  const { left, right } = getStrokeOutlineTracks(strokePoints, options);
  if (left.length < 2 || right.length < 2) return '';
  right.reverse();

  // Left track: smooth quadratic Beziers through midpoints
  let d = `M${precise(left[0])}T`;
  for (let i = 1; i < left.length; i++) d += ` ${average(left[i - 1], left[i])}`;
  d += ` ${precise(left[left.length - 1])}`;

  // End cap
  const lastR = strokePoints[strokePoints.length - 1].radius;
  d += lastR > 0.1
    ? `A${lastR.toFixed(2)},${lastR.toFixed(2)} 0 0 1 ${precise(right[0])}`
    : `L${precise(right[0])}`;

  // Right track
  d += 'T';
  for (let i = 1; i < right.length; i++) d += ` ${average(right[i - 1], right[i])}`;
  d += ` ${precise(right[right.length - 1])}`;

  // Start cap
  const firstR = strokePoints[0].radius;
  d += firstR > 0.1
    ? `A${firstR.toFixed(2)},${firstR.toFixed(2)} 0 0 1 ${precise(left[0])}`
    : `L${precise(left[0])}`;

  return d + 'Z';
}

// ─── Public API ──────────────────────────────────────────────

/**
 * Convert raw pointer input to an SVG path data string.
 *
 * @param {Array<{x:number, y:number, z?:number}>} rawPoints
 *   Array of input points. `z` is pressure (0-1), defaults to 0.5.
 *
 * @param {Object} [options]
 * @param {number} [options.size=16]             Stroke diameter in px.
 * @param {number} [options.thinning=0.5]        Pressure effect on width (0-1).
 * @param {number} [options.smoothing=0.5]       Min outline point spacing (0-1).
 * @param {number} [options.streamline=0.5]      Input point smoothing (0-1).
 * @param {boolean} [options.simulatePressure=true]  Simulate pressure from speed.
 * @param {Function} [options.easing=easeOutSine]  Easing for thinning curve.
 * @param {boolean} [options.last=false]           Is stroke complete?
 * @param {Object}  [options.start]                Start taper config.
 * @param {number|boolean} [options.start.taper=0]   Taper distance or true for full.
 * @param {Function} [options.start.easing]          Easing for start taper.
 * @param {Object}  [options.end]                  End taper config.
 * @param {number|boolean} [options.end.taper=0]     Taper distance or true for full.
 * @param {Function} [options.end.easing]            Easing for end taper.
 *
 * @returns {string} SVG path data string (fill, no stroke).
 */
export function svgInk(rawPoints, options = {}) {
  if (rawPoints.length < 2) {
    if (rawPoints.length === 1) {
      const r = (options.size ?? 16) / 2;
      return `M${(rawPoints[0].x - r).toFixed(2)},${rawPoints[0].y.toFixed(2)}` +
             `a${r},${r} 0 1 0 ${(r * 2).toFixed(2)},0` +
             `a${r},${r} 0 1 0 ${(-r * 2).toFixed(2)},0Z`;
    }
    return '';
  }

  const points = getStrokePoints(rawPoints, options);
  setStrokePointRadii(points, options);

  const partitions = partitionAtElbows(points);
  let svg = '';
  for (const partition of partitions) {
    svg += renderPartition(partition, options);
  }
  return svg;
}

// Also export building blocks for advanced usage
export { Vec, getStrokePoints, setStrokePointRadii, getStrokeOutlineTracks, easeOutSine, linear };
