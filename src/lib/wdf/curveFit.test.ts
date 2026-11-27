import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  fitGaussianPeak,
  sampleGaussianPeakCurve,
  interpolateAxisAtPixel,
  parseWdf,
  getSpectrum,
} from './index';

const SAMPLE_520_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/532nm_1800_520scan_62354700.txt',
);
const SAMPLE_PCL_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/532nm_1800_17087_abs_cm-1_PCL_e8762f36.txt',
);

function generateGaussianSpectrum(
  length: number,
  center: number,
  amplitude: number,
  sigma: number,
  baseline: number,
): number[] {
  const arr = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const dx = i - center;
    arr[i] = baseline + amplitude * Math.exp(-(dx * dx) / (2 * sigma * sigma));
  }
  return arr;
}

test('fitGaussianPeak accurately recovers sub-pixel center, intensity, FWHM, and evaluate() on synthetic Gaussians', () => {
  const trueCenter = 50.34;
  const trueAmplitude = 12000;
  const trueBaseline = 250;
  const trueSigma = 0.85; // narrow Gaussian so flanking pixels at +/-4..6 px sit cleanly on trueBaseline
  const trueFwhm = 2 * Math.sqrt(2 * Math.LN2) * trueSigma;

  const intensities = generateGaussianSpectrum(100, trueCenter, trueAmplitude, trueSigma, trueBaseline);
  const peakIndex = 50;
  const fit = fitGaussianPeak(intensities, peakIndex);

  assert.equal(fit.isFallback, false);
  assert.equal(fit.peakIndex, peakIndex);
  assert.ok(Math.abs(fit.baseline - trueBaseline) < 0.2, `Expected baseline ~${trueBaseline}, got ${fit.baseline}`);
  assert.ok(Math.abs(fit.xPeak - trueCenter) < 1e-3, `Expected xPeak ~${trueCenter}, got ${fit.xPeak}`);
  assert.ok(
    Math.abs(fit.yPeak - (trueBaseline + trueAmplitude)) < 1.5,
    `Expected yPeak ~${trueBaseline + trueAmplitude}, got ${fit.yPeak}`,
  );
  assert.ok(
    fit.fwhm !== null && Math.abs(fit.fwhm - trueFwhm) < 1e-3,
    `Expected FWHM ~${trueFwhm}, got ${fit.fwhm}`,
  );

  // evaluate(xPeak) must equal yPeak exactly (up to floating point epsilon)
  assert.ok(Math.abs(fit.evaluate(fit.xPeak) - fit.yPeak) < 1e-6);

  // evaluate(xPeak +/- fwhm/2) must sit halfway between baseline and yPeak
  const expectedHalfHeight = fit.baseline + 0.5 * (fit.yPeak - fit.baseline);
  assert.ok(Math.abs(fit.evaluate(fit.xPeak - fit.fwhm! / 2) - expectedHalfHeight) < 1e-6);
  assert.ok(Math.abs(fit.evaluate(fit.xPeak + fit.fwhm! / 2) - expectedHalfHeight) < 1e-6);

  // Negative sub-pixel shift (-0.28 px)
  const negCenter = 49.72;
  const negData = generateGaussianSpectrum(100, negCenter, 8500, 1.1, 120);
  const negFit = fitGaussianPeak(negData, 50);
  assert.equal(negFit.isFallback, false);
  assert.ok(Math.abs(negFit.xPeak - negCenter) < 1e-3, `Expected xPeak ~${negCenter}, got ${negFit.xPeak}`);
});

test('fitGaussianPeak guards against flat, concave-up, excessive shift, and edge boundary cases', () => {
  // 1. Flat data (A === 0 >= -1e-6)
  const flat = new Array<number>(20).fill(500);
  const flatFit = fitGaussianPeak(flat, 10);
  assert.equal(flatFit.isFallback, true);
  assert.equal(flatFit.xPeak, 10);
  assert.equal(flatFit.yPeak, 500);
  assert.equal(flatFit.fwhm, null);

  // 2. Concave-up valley (A > 0)
  const valley = Array.from({ length: 20 }, (_, i) => 100 + Math.pow(i - 10, 2) * 50);
  const valleyFit = fitGaussianPeak(valley, 10);
  assert.equal(valleyFit.isFallback, true);
  assert.equal(valleyFit.xPeak, 10);
  assert.equal(valleyFit.yPeak, 100);

  // 3. Monotonic ramp / shifted peak beyond |dx| > 1.5
  const ramp = Array.from({ length: 25 }, (_, i) => 50 + Math.exp((i - 10) * 0.6) * 200);
  const rampFit = fitGaussianPeak(ramp, 10);
  assert.equal(rampFit.isFallback, true);
  assert.equal(rampFit.xPeak, 10);
  assert.equal(rampFit.yPeak, ramp[10]);

  // 4. Peak too close to array boundary (< 2 or > n - 3)
  const nearLeft = generateGaussianSpectrum(20, 1, 1000, 1.0, 50);
  const leftFit = fitGaussianPeak(nearLeft, 1);
  assert.equal(leftFit.isFallback, true);
  assert.equal(leftFit.xPeak, 1);
  assert.equal(leftFit.yPeak, nearLeft[1]);

  // 5. Flanking pixel bounds clamping when peakIndex = 3 (left flank missing, right flank valid)
  const nearEdgeValid = generateGaussianSpectrum(20, 3.15, 2000, 0.9, 100);
  const edgeFit = fitGaussianPeak(nearEdgeValid, 3);
  assert.equal(edgeFit.isFallback, false);
  assert.ok(Math.abs(edgeFit.baseline - 100) < 1);
  assert.ok(Math.abs(edgeFit.xPeak - 3.15) < 0.02);
});

test('sampleGaussianPeakCurve samples [peakIndex - 3 .. peakIndex + 3] at 0.05-pixel intervals and normalizes crest to 100%', () => {
  const intensities = generateGaussianSpectrum(100, 40.42, 5000, 1.2, 100);
  const fit = fitGaussianPeak(intensities, 40);
  assert.equal(fit.isFallback, false);

  const sampled = sampleGaussianPeakCurve(fit, intensities.length, 3, 0.05);
  assert.equal(sampled.length, 121); // 6 / 0.05 + 1
  assert.ok(Math.abs(sampled[0].pixel - 37) < 1e-9);
  assert.ok(Math.abs(sampled[sampled.length - 1].pixel - 43) < 1e-9);
  assert.ok(Math.abs(sampled[1].pixel - 37.05) < 1e-9);

  // Normalized mode relative to yPeak: crest equals 100% and discrete points scale consistently
  const minVal = Math.min(...intensities);
  const span = fit.yPeak - minVal;
  const normCrest = ((fit.evaluate(fit.xPeak) - minVal) / span) * 100;
  assert.ok(Math.abs(normCrest - 100) < 1e-9);

  const maxDiscreteNorm = ((intensities[40] - minVal) / span) * 100;
  assert.ok(
    maxDiscreteNorm < 100 && maxDiscreteNorm > 90,
    `Discrete off-center pixel should sit below 100% fitted crest, got ${maxDiscreteNorm}`,
  );
});

test('fitGaussianPeak produces valid sub-pixel fits on real Renishaw Silicon 520 cm-1 and PCL spectra', () => {
  // Real Silicon 520 cm-1 sample
  const siWdf = parseWdf(fs.readFileSync(SAMPLE_520_PATH), { sortXAscending: true });
  assert.ok(siWdf.xAxis);
  const siY = getSpectrum(siWdf, 0);
  let siPeakIdx = 0;
  for (let i = 1; i < siY.length; i++) {
    if (siY[i] > siY[siPeakIdx]) siPeakIdx = i;
  }
  const siFit = fitGaussianPeak(siY, siPeakIdx);
  assert.equal(siFit.isFallback, false, 'Silicon 520 peak should produce a valid 5-point Gaussian fit');
  assert.ok(Math.abs(siFit.xPeak - siPeakIdx) < 1.0);
  assert.ok(siFit.yPeak > siY[siPeakIdx] * 0.85 && siFit.yPeak < siY[siPeakIdx] * 1.15);
  assert.ok(siFit.fwhm !== null && siFit.fwhm > 0.5 && siFit.fwhm < 15);

  const calibratedPeakX = interpolateAxisAtPixel(siWdf.xAxis.values, siFit.xPeak);
  assert.ok(
    Math.abs(calibratedPeakX - 520.0) < 0.8,
    `Calibrated Si peak should be ~520 cm-1, got ${calibratedPeakX}`,
  );

  // Real PCL sample
  const pclWdf = parseWdf(fs.readFileSync(SAMPLE_PCL_PATH), { sortXAscending: true });
  assert.ok(pclWdf.xAxis);
  const pclY = getSpectrum(pclWdf, 0);
  let pclPeakIdx = 0;
  for (let i = 1; i < pclY.length; i++) {
    if (pclY[i] > pclY[pclPeakIdx]) pclPeakIdx = i;
  }
  const pclFit = fitGaussianPeak(pclY, pclPeakIdx);
  assert.equal(pclFit.isFallback, false, 'PCL dominant peak should produce a valid 5-point Gaussian fit');
  assert.ok(pclFit.fwhm !== null && pclFit.fwhm > 0.5 && pclFit.fwhm < 25);
});
