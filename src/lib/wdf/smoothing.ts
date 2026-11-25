/**
 * Zero-dependency Savitzky-Golay spectral noise removal (smoothing) with
 * exact polynomial boundary evaluation and adaptive noise-level auto-tuning.
 *
 * Matches Renishaw WiRE's standard Savitzky-Golay smoothing methodology (SMO0)
 * while preserving sharp Raman peak centers, FWHM, and steep optical filter edges.
 */

export interface SmoothOptions {
  /** Odd window length (>= 5). Default: 15. */
  windowSize?: number;
  /** Polynomial order (2 <= polyOrder < windowSize). Default: 3. */
  polyOrder?: number;
}

export interface AutoSmoothResult {
  smoothed: Float64Array;
  windowSize: number;
  polyOrder: number;
  noiseRatio: number;
  profile: 'Light' | 'Moderate' | 'Strong' | 'Heavy';
}

function solveSmallLinearSystem(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const a = matrix.map((row, idx) => [...row, rhs[idx]]);

  for (let col = 0; col < n; col++) {
    let pivotRow = col;
    let pivotAbs = Math.abs(a[col][col]);
    for (let r = col + 1; r < n; r++) {
      const candidate = Math.abs(a[r][col]);
      if (candidate > pivotAbs) {
        pivotAbs = candidate;
        pivotRow = r;
      }
    }
    if (pivotRow !== col) {
      const tmp = a[col];
      a[col] = a[pivotRow];
      a[pivotRow] = tmp;
    }

    const pivot = a[col][col];
    if (Math.abs(pivot) < 1e-18) {
      continue;
    }

    for (let c = col; c <= n; c++) {
      a[col][c] /= pivot;
    }

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = a[r][col];
      if (factor === 0) continue;
      for (let c = col; c <= n; c++) {
        a[r][c] -= factor * a[col][c];
      }
    }
  }

  return a.map((row) => row[n]);
}

function computeMatrixInverse(matrix: number[][]): number[][] {
  const n = matrix.length;
  const inv: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (let col = 0; col < n; col++) {
    const e = new Array<number>(n).fill(0);
    e[col] = 1;
    const x = solveSmallLinearSystem(matrix, e);
    for (let row = 0; row < n; row++) {
      inv[row][col] = x[row];
    }
  }
  return inv;
}

function buildVandermondeNormalInverse(xs: number[], polyOrder: number): {
  v: number[][];
  pinv: number[][];
} {
  const w = xs.length;
  const p = polyOrder + 1;
  const v: number[][] = Array.from({ length: w }, (_, i) => {
    const row = new Array<number>(p);
    let pow = 1;
    for (let d = 0; d < p; d++) {
      row[d] = pow;
      pow *= xs[i];
    }
    return row;
  });

  // Normal matrix G = V^T V (p x p)
  const g: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
  for (let r = 0; r < p; r++) {
    for (let c = 0; c < p; c++) {
      let sum = 0;
      for (let i = 0; i < w; i++) {
        sum += v[i][r] * v[i][c];
      }
      g[r][c] = sum;
    }
  }

  const gInv = computeMatrixInverse(g);

  // Pseudoinverse P = (V^T V)^-1 V^T (p x w)
  const pinv: number[][] = Array.from({ length: p }, () => new Array<number>(w).fill(0));
  for (let r = 0; r < p; r++) {
    for (let i = 0; i < w; i++) {
      let sum = 0;
      for (let c = 0; c < p; c++) {
        sum += gInv[r][c] * v[i][c];
      }
      pinv[r][i] = sum;
    }
  }

  return { v, pinv };
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

/**
 * Apply exact Savitzky-Golay polynomial smoothing to a 1D spectral intensity array.
 */
export function smoothSpectrumSavitzkyGolay(
  yValues: ArrayLike<number>,
  options: SmoothOptions = {},
): Float64Array {
  const n = yValues.length;
  const out = new Float64Array(n);
  if (n === 0) return out;
  if (n < 5) {
    for (let i = 0; i < n; i++) out[i] = yValues[i];
    return out;
  }

  const maxOdd = n % 2 === 1 ? n : n - 1;
  let windowSize = Math.floor(options.windowSize ?? 15);
  if (windowSize % 2 === 0) windowSize += 1;
  windowSize = Math.max(5, Math.min(maxOdd, windowSize));

  const polyOrder = Math.max(2, Math.min(4, Math.min(windowSize - 1, Math.floor(options.polyOrder ?? 3))));
  const half = (windowSize - 1) >> 1;

  // Normalize offsets to [-1, 1] for optimal numerical conditioning even for wide windows (e.g. 41 pts)
  const xs = Array.from({ length: windowSize }, (_, k) => (k - half) / half);
  const { v, pinv } = buildVandermondeNormalInverse(xs, polyOrder);

  // Center point (x = 0) depends only on polynomial coefficient d = 0 -> row 0 of pinv
  const centerWeights = pinv[0];

  // Interior convolution
  for (let i = half; i < n - half; i++) {
    let acc = 0;
    const base = i - half;
    for (let k = 0; k < windowSize; k++) {
      acc += centerWeights[k] * yValues[base + k];
    }
    out[i] = acc;
  }

  // Exact left boundary fit using the first windowSize samples
  const p = polyOrder + 1;
  const leftCoeffs = new Array<number>(p).fill(0);
  for (let d = 0; d < p; d++) {
    let sum = 0;
    for (let k = 0; k < windowSize; k++) {
      sum += pinv[d][k] * yValues[k];
    }
    leftCoeffs[d] = sum;
  }
  for (let i = 0; i < half; i++) {
    let val = 0;
    for (let d = 0; d < p; d++) {
      val += leftCoeffs[d] * v[i][d];
    }
    out[i] = val;
  }

  // Exact right boundary fit using the last windowSize samples
  const rightStart = n - windowSize;
  const rightCoeffs = new Array<number>(p).fill(0);
  for (let d = 0; d < p; d++) {
    let sum = 0;
    for (let k = 0; k < windowSize; k++) {
      sum += pinv[d][k] * yValues[rightStart + k];
    }
    rightCoeffs[d] = sum;
  }
  for (let i = n - half; i < n; i++) {
    const localIdx = i - rightStart;
    let val = 0;
    for (let d = 0; d < p; d++) {
      val += rightCoeffs[d] * v[localIdx][d];
    }
    out[i] = val;
  }

  return out;
}

/**
 * Automatically estimate high-frequency spectral noise via 2nd-order finite-difference MAD
 * and choose an appropriate Savitzky-Golay window size and polynomial order.
 */
export function autoSmoothSpectrum(yValues: ArrayLike<number>): AutoSmoothResult {
  const n = yValues.length;
  if (n < 7) {
    const smoothed = smoothSpectrumSavitzkyGolay(yValues, { windowSize: 5, polyOrder: 2 });
    return { smoothed, windowSize: Math.min(5, n), polyOrder: 2, noiseRatio: 0, profile: 'Light' };
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = yValues[i];
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }
  const span = Math.max(maxY - minY, 1e-9);

  // High-frequency noise estimate via 2nd difference MAD (immune to broad slopes and sharp edges)
  const sqrt6 = Math.sqrt(6);
  const d2: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    d2.push((yValues[i + 1] - 2 * yValues[i] + yValues[i - 1]) / sqrt6);
  }
  const medD2 = computeMedian(d2);
  const absDev = d2.map((val) => Math.abs(val - medD2));
  const noiseSigma = 1.4826 * computeMedian(absDev);
  const noiseRatio = noiseSigma / span;

  // Scale gently for denser spectra (e.g., 2,800+ points vs 1,000 points)
  const densityScale = n >= 2000 ? 1.3 : 1.0;

  let baseWindow: number;
  let polyOrder: number;
  let profile: AutoSmoothResult['profile'];

  if (noiseRatio < 0.0025) {
    baseWindow = 7;
    polyOrder = 3;
    profile = 'Light';
  } else if (noiseRatio < 0.009) {
    baseWindow = 13;
    polyOrder = 3;
    profile = 'Moderate';
  } else if (noiseRatio < 0.025) {
    baseWindow = 21;
    polyOrder = 3;
    profile = 'Strong';
  } else {
    baseWindow = 31;
    polyOrder = 2;
    profile = 'Heavy';
  }

  let windowSize = Math.round(baseWindow * densityScale);
  if (windowSize % 2 === 0) windowSize += 1;
  const maxAllowed = Math.max(5, Math.min(45, n % 2 === 1 ? n : n - 1));
  windowSize = Math.max(5, Math.min(maxAllowed, windowSize));

  const smoothed = smoothSpectrumSavitzkyGolay(yValues, { windowSize, polyOrder });
  return { smoothed, windowSize, polyOrder, noiseRatio, profile };
}
