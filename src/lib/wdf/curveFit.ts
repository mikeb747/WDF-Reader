/**
 * Zero-dependency 5-point Gaussian (log-parabola) sub-pixel peak fitting algorithm.
 *
 * Fits a least-squares quadratic to the natural log of background-subtracted
 * intensities in a 5-pixel window around a detected local maximum (peakIndex - 2 .. peakIndex + 2):
 *   L(dx) = A * dx^2 + B * dx + C,  dx = x - peakIndex
 * and analytically recovers the sub-pixel peak center, peak intensity, and FWHM in pixels.
 */

export interface GaussianPeakFit {
  /** Integer index of the detected local maximum passed into fitGaussianPeak. */
  peakIndex: number;
  /** Fitted sub-pixel peak center in pixel index coordinates (or raw peakIndex on fallback). */
  xPeak: number;
  /** Fitted peak intensity including local baseline B_base (or raw peak intensity on fallback). */
  yPeak: number;
  /** Full Width at Half Maximum in pixels: 2 * sqrt(-ln(2) / A), or null on fallback. */
  fwhm: number | null;
  /** Estimated local dark/background baseline B_base from flanking pixels. */
  baseline: number;
  /** Log-parabola quadratic coefficient A (0 on fallback). */
  a: number;
  /** Log-parabola linear coefficient B (0 on fallback). */
  b: number;
  /** Log-parabola constant coefficient C (0 on fallback). */
  c: number;
  /** True when the fit failed validity checks and safely fell back to raw integer peak values. */
  isFallback: boolean;
  /** Evaluates the fitted Gaussian model at pixel coordinate x. */
  evaluate: (x: number) => number;
}

export interface SampledCurvePoint {
  /** Fractional pixel coordinate. */
  pixel: number;
  /** Evaluated intensity at this fractional pixel. */
  intensity: number;
}

function buildFallbackFit(
  intensities: ArrayLike<number>,
  peakIndex: number,
  baseline: number,
): GaussianPeakFit {
  const n = intensities.length;
  const clampedIdx = n > 0 ? Math.max(0, Math.min(n - 1, Math.round(peakIndex))) : 0;
  const rawPeak = n > 0 && Number.isFinite(intensities[clampedIdx]) ? intensities[clampedIdx] : 0;

  return {
    peakIndex: clampedIdx,
    xPeak: clampedIdx,
    yPeak: rawPeak,
    fwhm: null,
    baseline,
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
 * Fits a 5-point Gaussian (log-parabola) around `peakIndex` in `intensities`.
 */
export function fitGaussianPeak(
  intensities: ArrayLike<number>,
  peakIndex: number,
): GaussianPeakFit {
  const n = intensities.length;
  if (n === 0 || !Number.isInteger(peakIndex) || peakIndex < 0 || peakIndex >= n) {
    return buildFallbackFit(intensities, Number.isFinite(peakIndex) ? peakIndex : 0, 0);
  }

  // Estimate local dark/background baseline B_base from outer flanking pixels:
  // [peakIndex - 6 .. peakIndex - 4] and [peakIndex + 4 .. peakIndex + 6], clamped to array bounds.
  let flankSum = 0;
  let flankCount = 0;

  const leftStart = Math.max(0, peakIndex - 6);
  const leftEnd = Math.min(n - 1, peakIndex - 4);
  for (let i = leftStart; i <= leftEnd; i++) {
    if (Number.isFinite(intensities[i])) {
      flankSum += intensities[i];
      flankCount++;
    }
  }

  const rightStart = Math.max(0, peakIndex + 4);
  const rightEnd = Math.min(n - 1, peakIndex + 6);
  for (let i = rightStart; i <= rightEnd; i++) {
    if (Number.isFinite(intensities[i])) {
      flankSum += intensities[i];
      flankCount++;
    }
  }

  const bBase = flankCount > 0 ? flankSum / flankCount : 0;

  // Need a full 5-pixel window [peakIndex - 2 .. peakIndex + 2] inside array bounds
  if (peakIndex < 2 || peakIndex > n - 3) {
    return buildFallbackFit(intensities, peakIndex, bBase);
  }

  const rawM2 = intensities[peakIndex - 2];
  const rawM1 = intensities[peakIndex - 1];
  const raw0 = intensities[peakIndex];
  const rawP1 = intensities[peakIndex + 1];
  const rawP2 = intensities[peakIndex + 2];

  if (
    !Number.isFinite(rawM2) ||
    !Number.isFinite(rawM1) ||
    !Number.isFinite(raw0) ||
    !Number.isFinite(rawP1) ||
    !Number.isFinite(rawP2)
  ) {
    return buildFallbackFit(intensities, peakIndex, bBase);
  }

  // Subtract local baseline and compute natural logarithms
  const lM2 = Math.log(Math.max(1e-6, rawM2 - bBase));
  const lM1 = Math.log(Math.max(1e-6, rawM1 - bBase));
  const l0 = Math.log(Math.max(1e-6, raw0 - bBase));
  const lP1 = Math.log(Math.max(1e-6, rawP1 - bBase));
  const lP2 = Math.log(Math.max(1e-6, rawP2 - bBase));

  // 5-point least-squares quadratic fit L(dx) = A * dx^2 + B * dx + C
  const a = (2 * lM2 - lM1 - 2 * l0 - lP1 + 2 * lP2) / 14;
  const b = (-2 * lM2 - lM1 + lP1 + 2 * lP2) / 10;
  const c = (-3 * lM2 + 12 * lM1 + 17 * l0 + 12 * lP1 - 3 * lP2) / 35;

  // Guard against invalid fits (flat/concave-up or peak shifted > 1.5 px away from integer peak)
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c) || a >= -1e-6) {
    return buildFallbackFit(intensities, peakIndex, bBase);
  }

  const dxPeak = -b / (2 * a);
  if (!Number.isFinite(dxPeak) || Math.abs(dxPeak) > 1.5) {
    return buildFallbackFit(intensities, peakIndex, bBase);
  }

  const xPeak = peakIndex + dxPeak;
  const yPeak = Math.exp(c - (b * b) / (4 * a)) + bBase;
  const fwhm = 2 * Math.sqrt(-Math.log(2) / a);

  if (!Number.isFinite(xPeak) || !Number.isFinite(yPeak) || !Number.isFinite(fwhm)) {
    return buildFallbackFit(intensities, peakIndex, bBase);
  }

  return {
    peakIndex,
    xPeak,
    yPeak,
    fwhm,
    baseline: bBase,
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

/**
 * Samples a fitted Gaussian curve across [peakIndex - halfSpan, peakIndex + halfSpan]
 * (clamped to [0, totalPoints - 1]) at fixed pixel intervals (default 0.05 px).
 */
export function sampleGaussianPeakCurve(
  fit: GaussianPeakFit,
  totalPoints: number,
  halfSpan = 3,
  step = 0.05,
): SampledCurvePoint[] {
  if (totalPoints <= 0 || step <= 0) return [];
  const startPx = Math.max(0, fit.peakIndex - halfSpan);
  const endPx = Math.min(totalPoints - 1, fit.peakIndex + halfSpan);
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
