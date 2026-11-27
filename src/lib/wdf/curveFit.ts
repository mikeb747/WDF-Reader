/**
 * Zero-dependency adaptive sub-pixel peak curve fitting algorithms for Raman spectroscopy.
 *
 * Supports automatic peak-width estimation, dynamic flanking baseline calculation,
 * and four mathematical models (3-pt Gaussian, 5-pt Gaussian, Lorentzian, and Parabolic),
 * plus dynamic baseline-tapering curve sampling at 0.05-pixel intervals.
 */

export type CurveFitMethod = 'auto' | 'gaussian3' | 'gaussian5' | 'lorentzian' | 'parabolic';
export type ResolvedCurveFitModel = 'gaussian3' | 'gaussian5' | 'lorentzian' | 'parabolic';

export interface CurveFitResult {
  /** Requested method ('auto' or explicit model). */
  requestedMethod: CurveFitMethod;
  /** Resolved mathematical model used for fitting. */
  model: ResolvedCurveFitModel;
  /** Human-readable model label (e.g. "Auto: 3-pt Gaussian" or "Lorentzian"). */
  modelLabel: string;
  /** Integer index of the detected local maximum passed into fitPeakCurve. */
  peakIndex: number;
  /** Half-width in pixels of the fitting window [-halfWindow .. +halfWindow]. */
  halfWindow: number;
  /** Rough first-pass peak width in pixels, clamped to [2, 40]. */
  rawFwhm: number;
  /** Fitted sub-pixel peak center in pixel index coordinates (or raw peakIndex on fallback). */
  xPeak: number;
  /** Fitted peak intensity including local baseline B_base (or raw peak intensity on fallback). */
  yPeak: number;
  /** Full Width at Half Maximum in pixels, or null on fallback. */
  fwhm: number | null;
  /** Estimated local dark/background baseline B_base from dynamic flanking windows. */
  baseline: number;
  /** Dynamic render half-span in pixels: max(10, ceil(3.5 * fwhm)). */
  renderHalfSpan: number;
  /** Fitted quadratic coefficients (log-parabola for Gaussian, 1/y for Lorentzian, raw for Parabolic). */
  a: number;
  b: number;
  c: number;
  /** True when the fit failed validity checks and safely fell back to raw integer peak values. */
  isFallback: boolean;
  /** Evaluates the fitted peak curve at pixel coordinate x. */
  evaluate: (x: number) => number;
}

/** Backwards-compatible alias for Gaussian peak fit results. */
export type GaussianPeakFit = CurveFitResult;

export interface SampledCurvePoint {
  /** Fractional pixel coordinate. */
  pixel: number;
  /** Evaluated intensity at this fractional pixel. */
  intensity: number;
}

export interface PeakWidthBaselineEstimate {
  rawFwhm: number;
  baseline: number;
  localMin: number;
}

export const CURVE_FIT_MODEL_NAMES: Record<ResolvedCurveFitModel, string> = {
  gaussian3: '3-pt Gaussian',
  gaussian5: '5-pt Gaussian',
  lorentzian: 'Lorentzian',
  parabolic: 'Parabolic',
};

function formatModelLabel(
  requestedMethod: CurveFitMethod,
  model: ResolvedCurveFitModel,
  isFallback: boolean,
): string {
  const baseName = CURVE_FIT_MODEL_NAMES[model];
  if (isFallback) {
    return requestedMethod === 'auto' ? `Auto: ${baseName} (Fallback)` : `${baseName} (Fallback)`;
  }
  return requestedMethod === 'auto' ? `Auto: ${baseName}` : baseName;
}

/**
 * Two-pass adaptive peak-width and dynamic baseline estimator:
 * 1. Walks left/right from `peakIndex` to half-height above the minimum in a ±25 px window
 *    to obtain `rawFWHM` clamped to [2, 40] pixels.
 * 2. Averages outer flanking windows at ±[round(2.5 * rawFWHM), round(2.5 * rawFWHM) + 4]
 *    (clamped to array bounds) to compute refined local baseline `B_base`.
 */
export function estimatePeakWidthAndBaseline(
  intensities: ArrayLike<number>,
  peakIndex: number,
): PeakWidthBaselineEstimate {
  const n = intensities.length;
  if (n === 0 || peakIndex < 0 || peakIndex >= n) {
    return { rawFwhm: 2, baseline: 0, localMin: 0 };
  }

  const peakVal = Number.isFinite(intensities[peakIndex]) ? intensities[peakIndex] : 0;
  const searchLeft = Math.max(0, peakIndex - 25);
  const searchRight = Math.min(n - 1, peakIndex + 25);

  let localMin = peakVal;
  for (let i = searchLeft; i <= searchRight; i++) {
    const v = intensities[i];
    if (Number.isFinite(v) && v < localMin) {
      localMin = v;
    }
  }

  const halfTarget = localMin + 0.5 * (peakVal - localMin);

  // Walk left to half-maximum with linear sub-pixel crossing interpolation
  let xLeft = searchLeft;
  for (let i = peakIndex - 1; i >= searchLeft; i--) {
    const v = intensities[i];
    if (!Number.isFinite(v)) continue;
    if (v <= halfTarget) {
      const vNext = intensities[i + 1];
      const denom = vNext - v;
      xLeft = Math.abs(denom) > 1e-12 ? i + (halfTarget - v) / denom : i;
      break;
    }
  }

  // Walk right to half-maximum with linear sub-pixel crossing interpolation
  let xRight = searchRight;
  for (let i = peakIndex + 1; i <= searchRight; i++) {
    const v = intensities[i];
    if (!Number.isFinite(v)) continue;
    if (v <= halfTarget) {
      const vPrev = intensities[i - 1];
      const denom = vPrev - v;
      xRight = Math.abs(denom) > 1e-12 ? i - (halfTarget - v) / denom : i;
      break;
    }
  }

  const measuredWidth = xRight - xLeft;
  const rawFwhm = Math.max(2, Math.min(40, Number.isFinite(measuredWidth) ? measuredWidth : 2));

  // Second pass: refined baseline from dynamic flanking windows
  const flankOffset = Math.round(2.5 * rawFwhm);
  let flankSum = 0;
  let flankCount = 0;

  const leftRawStart = peakIndex - flankOffset - 4;
  const leftRawEnd = peakIndex - flankOffset;
  if (leftRawEnd >= 0) {
    const ls = Math.max(0, leftRawStart);
    const le = Math.min(n - 1, leftRawEnd);
    for (let i = ls; i <= le; i++) {
      const v = intensities[i];
      if (Number.isFinite(v)) {
        flankSum += v;
        flankCount++;
      }
    }
  }

  const rightRawStart = peakIndex + flankOffset;
  const rightRawEnd = peakIndex + flankOffset + 4;
  if (rightRawStart <= n - 1) {
    const rs = Math.max(0, rightRawStart);
    const re = Math.min(n - 1, rightRawEnd);
    for (let i = rs; i <= re; i++) {
      const v = intensities[i];
      if (Number.isFinite(v)) {
        flankSum += v;
        flankCount++;
      }
    }
  }

  const baseline = flankCount > 0 ? flankSum / flankCount : localMin;
  return { rawFwhm, baseline, localMin };
}

/**
 * Solves weighted least-squares quadratic `z(dx) = a*dx^2 + b*dx + c`
 * over a symmetric integer grid `dx = -M .. +M` (`values.length === 2*M + 1`).
 */
function fitWeightedQuadratic(
  values: number[],
  weights: number[],
  halfWindow: number,
): { a: number; b: number; c: number } | null {
  const m = halfWindow;
  const len = 2 * m + 1;

  let w0 = 0;
  let w1 = 0;
  let w2 = 0;
  let w3 = 0;
  let w4 = 0;
  let r0 = 0;
  let r1 = 0;
  let r2 = 0;

  for (let k = 0; k < len; k++) {
    const x = k - m;
    const x2 = x * x;
    const w = weights[k];
    const v = values[k];
    w0 += w;
    w1 += w * x;
    w2 += w * x2;
    w3 += w * x2 * x;
    w4 += w * x2 * x2;
    r0 += w * v;
    r1 += w * x * v;
    r2 += w * x2 * v;
  }

  // Solve symmetric 3x3 normal equations:
  // [ w4 w3 w2 ] [ a ]   [ r2 ]
  // [ w3 w2 w1 ] [ b ] = [ r1 ]
  // [ w2 w1 w0 ] [ c ]   [ r0 ]
  const m00 = w4;
  const m01 = w3;
  const m02 = w2;
  const m10 = w3;
  const m11 = w2;
  const m12 = w1;
  const m20 = w2;
  const m21 = w1;
  const m22 = w0;

  const det =
    m00 * (m11 * m22 - m12 * m21) -
    m01 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * m21 - m11 * m20);

  if (!Number.isFinite(det) || Math.abs(det) < 1e-18) {
    return null;
  }

  const detA =
    r2 * (m11 * m22 - m12 * m21) -
    m01 * (r1 * m22 - m12 * r0) +
    m02 * (r1 * m21 - m11 * r0);
  const detB =
    m00 * (r1 * m22 - m12 * r0) -
    r2 * (m10 * m22 - m12 * m20) +
    m02 * (m10 * r0 - r1 * m20);
  const detC =
    m00 * (m11 * r0 - r1 * m21) -
    m01 * (m10 * r0 - r1 * m20) +
    r2 * (m10 * m21 - m11 * m20);

  return {
    a: detA / det,
    b: detB / det,
    c: detC / det,
  };
}

function buildFallbackFit(
  intensities: ArrayLike<number>,
  peakIndex: number,
  requestedMethod: CurveFitMethod,
  model: ResolvedCurveFitModel,
  halfWindow: number,
  rawFwhm: number,
  baseline: number,
): CurveFitResult {
  const n = intensities.length;
  const clampedIdx = n > 0 ? Math.max(0, Math.min(n - 1, Math.round(peakIndex))) : 0;
  const rawPeak = n > 0 && Number.isFinite(intensities[clampedIdx]) ? intensities[clampedIdx] : 0;
  const renderHalfSpan = Math.max(10, Math.ceil(3.5 * rawFwhm));

  return {
    requestedMethod,
    model,
    modelLabel: formatModelLabel(requestedMethod, model, true),
    peakIndex: clampedIdx,
    halfWindow,
    rawFwhm,
    xPeak: clampedIdx,
    yPeak: rawPeak,
    fwhm: null,
    baseline,
    renderHalfSpan,
    a: 0,
    b: 0,
    c: 0,
    isFallback: true,
    evaluate: (x: number) => {
      if (n === 0) return 0;
      if (x <= 0) return intensities[0];
      if (x >= n - 1) return intensities[n - 1];
      const lo = Math.floor(x);
      const hi = Math.min(n - 1, lo + 1);
      const frac = x - lo;
      return intensities[lo] + (intensities[hi] - intensities[lo]) * frac;
    },
  };
}

/**
 * Fits a sub-pixel spectral peak curve around `peakIndex` using either adaptive model
 * selection (`'auto'`) or an explicit mathematical model (`'gaussian3'`, `'gaussian5'`,
 * `'lorentzian'`, `'parabolic'`).
 */
export function fitPeakCurve(
  intensities: ArrayLike<number>,
  peakIndex: number,
  method: CurveFitMethod = 'auto',
): CurveFitResult {
  const n = intensities.length;
  if (n === 0 || !Number.isInteger(peakIndex) || peakIndex < 0 || peakIndex >= n) {
    const defaultModel: ResolvedCurveFitModel = method === 'auto' ? 'gaussian5' : method;
    return buildFallbackFit(intensities, Number.isFinite(peakIndex) ? peakIndex : 0, method, defaultModel, 2, 2, 0);
  }

  const { rawFwhm, baseline: bBase } = estimatePeakWidthAndBaseline(intensities, peakIndex);

  let model: ResolvedCurveFitModel;
  let halfWindow: number;

  if (method === 'auto') {
    if (rawFwhm < 4) {
      model = 'gaussian3';
      halfWindow = 1;
    } else if (rawFwhm <= 9) {
      model = 'gaussian5';
      halfWindow = 2;
    } else {
      model = 'lorentzian';
      halfWindow = Math.min(15, Math.max(3, Math.round(0.6 * rawFwhm)));
    }
  } else {
    model = method;
    if (method === 'gaussian3' || method === 'parabolic') {
      halfWindow = 1;
    } else if (method === 'gaussian5') {
      halfWindow = 2;
    } else {
      halfWindow = Math.min(15, Math.max(3, Math.round(0.6 * rawFwhm)));
    }
  }

  // Shrink Lorentzian halfWindow only if peak sits near array edge, while keeping >= 2 if possible
  const maxAvailableHalf = Math.min(peakIndex, n - 1 - peakIndex);
  if (model === 'lorentzian' && halfWindow > maxAvailableHalf) {
    halfWindow = maxAvailableHalf;
  }

  if (halfWindow < 1 || peakIndex - halfWindow < 0 || peakIndex + halfWindow >= n) {
    return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
  }

  // Extract window intensities & validate finiteness
  const windowLen = 2 * halfWindow + 1;
  const rawWindow = new Array<number>(windowLen);
  for (let k = 0; k < windowLen; k++) {
    const v = intensities[peakIndex - halfWindow + k];
    if (!Number.isFinite(v)) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }
    rawWindow[k] = v;
  }

  if (model === 'gaussian3' || model === 'gaussian5') {
    const logVals = rawWindow.map((v) => Math.log(Math.max(1e-6, v - bBase)));
    let a: number;
    let b: number;
    let c: number;

    if (model === 'gaussian3') {
      // Exact 3-point log-parabola on dx = -1, 0, +1
      const [lM1, l0, lP1] = logVals;
      a = (lM1 - 2 * l0 + lP1) / 2;
      b = (lP1 - lM1) / 2;
      c = l0;
    } else {
      // Exact 5-point least-squares log-parabola on dx = -2, -1, 0, +1, +2
      const [lM2, lM1, l0, lP1, lP2] = logVals;
      a = (2 * lM2 - lM1 - 2 * l0 - lP1 + 2 * lP2) / 14;
      b = (-2 * lM2 - lM1 + lP1 + 2 * lP2) / 10;
      c = (-3 * lM2 + 12 * lM1 + 17 * l0 + 12 * lP1 - 3 * lP2) / 35;
    }

    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a >= -1e-6) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }

    const dxPeak = -b / (2 * a);
    if (!Number.isFinite(dxPeak) || Math.abs(dxPeak) > 1.5) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }

    const xPeak = peakIndex + dxPeak;
    const yPeak = Math.exp(c - (b * b) / (4 * a)) + bBase;
    const fwhm = 2 * Math.sqrt(-Math.log(2) / a);

    if (!Number.isFinite(xPeak) || !Number.isFinite(yPeak) || !Number.isFinite(fwhm) || fwhm <= 0) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }

    const renderHalfSpan = Math.max(10, Math.ceil(3.5 * fwhm));
    return {
      requestedMethod: method,
      model,
      modelLabel: formatModelLabel(method, model, false),
      peakIndex,
      halfWindow,
      rawFwhm,
      xPeak,
      yPeak,
      fwhm,
      baseline: bBase,
      renderHalfSpan,
      a,
      b,
      c,
      isFallback: false,
      evaluate: (x: number) => {
        const dx = x - peakIndex;
        return Math.exp(a * dx * dx + b * dx + c) + bBase;
      },
    };
  }

  if (model === 'lorentzian') {
    const yVals = rawWindow.map((v) => Math.max(1e-6, v - bBase));
    const maxY = Math.max(...yVals, 1e-6);
    const zVals = yVals.map((y) => 1 / y);
    // Gauss-Markov variance weights for Z = 1/y under intensity-space error: w_i ∝ y_i^4
    const weights = yVals.map((y) => {
      const r = y / maxY;
      return Math.max(1e-12, r * r * r * r);
    });
    const quad = fitWeightedQuadratic(zVals, weights, halfWindow);
    if (!quad) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }
    const { a, b, c } = quad;

    if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a <= 1e-12) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }

    const dxPeak = -b / (2 * a);
    const maxAllowedShift = Math.max(1.5, halfWindow * 0.6);
    if (!Number.isFinite(dxPeak) || Math.abs(dxPeak) > maxAllowedShift) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }

    const zMin = c - (b * b) / (4 * a);
    if (!Number.isFinite(zMin) || zMin <= 1e-12) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }

    const xPeak = peakIndex + dxPeak;
    const yPeak = 1 / Math.max(1e-6, zMin) + bBase;
    const fwhm = 2 * Math.sqrt(Math.max(0, zMin / a));

    if (!Number.isFinite(xPeak) || !Number.isFinite(yPeak) || !Number.isFinite(fwhm) || fwhm <= 0) {
      return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
    }

    const renderHalfSpan = Math.max(10, Math.ceil(3.5 * fwhm));
    return {
      requestedMethod: method,
      model,
      modelLabel: formatModelLabel(method, model, false),
      peakIndex,
      halfWindow,
      rawFwhm,
      xPeak,
      yPeak,
      fwhm,
      baseline: bBase,
      renderHalfSpan,
      a,
      b,
      c,
      isFallback: false,
      evaluate: (x: number) => {
        const dx = x - peakIndex;
        const denom = a * dx * dx + b * dx + c;
        return 1 / Math.max(1e-12, denom) + bBase;
      },
    };
  }

  // Parabolic model: 3-point quadratic fit directly to raw_i across dx = -1, 0, +1
  const [rawM1, raw0, rawP1] = rawWindow;
  const a = (rawM1 - 2 * raw0 + rawP1) / 2;
  const b = (rawP1 - rawM1) / 2;
  const c = raw0;

  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a >= -1e-6) {
    return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
  }

  const dxPeak = -b / (2 * a);
  if (!Number.isFinite(dxPeak) || Math.abs(dxPeak) > 1.5) {
    return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
  }

  const xPeak = peakIndex + dxPeak;
  const yPeak = c - (b * b) / (4 * a);
  const amplitude = Math.max(1e-6, yPeak - bBase);
  const fwhm = 2 * Math.sqrt(Math.max(0, (-0.5 * amplitude) / a));

  if (!Number.isFinite(xPeak) || !Number.isFinite(yPeak) || !Number.isFinite(fwhm) || fwhm <= 0) {
    return buildFallbackFit(intensities, peakIndex, method, model, halfWindow, rawFwhm, bBase);
  }

  const renderHalfSpan = Math.max(10, Math.ceil(3.5 * fwhm));
  return {
    requestedMethod: method,
    model,
    modelLabel: formatModelLabel(method, model, false),
    peakIndex,
    halfWindow,
    rawFwhm,
    xPeak,
    yPeak,
    fwhm,
    baseline: bBase,
    renderHalfSpan,
    a,
    b,
    c,
    isFallback: false,
    evaluate: (x: number) => {
      const dx = x - peakIndex;
      const val = a * dx * dx + b * dx + c;
      // Clamp cleanly at the local baseline so the rendered parabolic dome tapers into B_base
      return Math.max(bBase, val);
    },
  };
}

/**
 * Convenience wrapper for 5-point Gaussian log-parabola peak fitting.
 */
export function fitGaussianPeak(
  intensities: ArrayLike<number>,
  peakIndex: number,
): GaussianPeakFit {
  return fitPeakCurve(intensities, peakIndex, 'gaussian5');
}

/**
 * Samples a fitted peak curve across [peakIndex - renderHalfSpan, peakIndex + renderHalfSpan]
 * (clamped to [0, totalPoints - 1]) at fixed pixel intervals (default 0.05 px).
 */
export function samplePeakCurve(
  fit: CurveFitResult,
  totalPoints: number,
  halfSpan?: number,
  step = 0.05,
): SampledCurvePoint[] {
  if (totalPoints <= 0 || step <= 0) return [];
  const effectiveHalfSpan = halfSpan ?? fit.renderHalfSpan;
  const startPx = Math.max(0, fit.peakIndex - effectiveHalfSpan);
  const endPx = Math.min(totalPoints - 1, fit.peakIndex + effectiveHalfSpan);
  if (endPx < startPx) return [];

  const steps = Math.round((endPx - startPx) / step);
  const points: SampledCurvePoint[] = [];
  for (let i = 0; i <= steps; i++) {
    const pixel = i === steps ? endPx : startPx + i * step;
    const intensity = fit.evaluate(pixel);
    if (Number.isFinite(intensity)) {
      points.push({ pixel, intensity });
    }
  }
  return points;
}

/** Backwards-compatible alias for sampling fitted curves. */
export const sampleGaussianPeakCurve = samplePeakCurve;

/**
 * Linearly interpolates a calibrated spectral X-axis array at a fractional pixel coordinate.
 */
export function interpolateAxisAtPixel(xValues: ArrayLike<number>, pixel: number): number {
  const n = xValues.length;
  if (n === 0) return 0;
  if (n === 1) return xValues[0];
  if (pixel <= 0) {
    return xValues[0] + (xValues[1] - xValues[0]) * pixel;
  }
  if (pixel >= n - 1) {
    return xValues[n - 1] + (xValues[n - 1] - xValues[n - 2]) * (pixel - (n - 1));
  }
  const lo = Math.floor(pixel);
  const hi = Math.min(n - 1, lo + 1);
  const frac = pixel - lo;
  return xValues[lo] + (xValues[hi] - xValues[lo]) * frac;
}
