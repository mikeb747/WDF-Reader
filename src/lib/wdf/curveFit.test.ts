import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  estimatePeakWidthAndBaseline,
  fitGaussianPeak,
  fitPeakCurve,
  getSpectrum,
  interpolateAxisAtPixel,
  parseWdf,
  samplePeakCurve,
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

function generateLorentzianSpectrum(
  length: number,
  center: number,
  amplitude: number,
  gamma: number,
  baseline: number,
): number[] {
  const arr = new Array<number>(length);
  for (let i = 0; i < length; i++) {
    const dx = i - center;
    arr[i] = baseline + amplitude / (1 + Math.pow(dx / gamma, 2));
  }
  return arr;
}

test('estimatePeakWidthAndBaseline & Auto mode select 3-pt Gaussian (sharp), 5-pt Gaussian (medium), and Lorentzian (broad)', () => {
  // 1. Sharp crystalline line: true FWHM = 2.4 px (< 4) -> Auto selects 3-pt Gaussian
  const sharpSigma = 2.4 / (2 * Math.sqrt(2 * Math.LN2));
  const sharp = generateGaussianSpectrum(120, 60.27, 15000, sharpSigma, 200);
  const sharpEst = estimatePeakWidthAndBaseline(sharp, 60);
  assert.ok(sharpEst.rawFwhm < 4, `Expected sharp rawFwhm < 4, got ${sharpEst.rawFwhm}`);
  assert.ok(Math.abs(sharpEst.baseline - 200) < 1, `Expected baseline ~200, got ${sharpEst.baseline}`);

  const sharpFit = fitPeakCurve(sharp, 60, 'auto');
  assert.equal(sharpFit.isFallback, false);
  assert.equal(sharpFit.model, 'gaussian3');
  assert.equal(sharpFit.modelLabel, 'Auto: 3-pt Gaussian');
  assert.equal(sharpFit.halfWindow, 1);
  assert.ok(Math.abs(sharpFit.xPeak - 60.27) < 1e-3, `Expected xPeak ~60.27, got ${sharpFit.xPeak}`);
  assert.ok(Math.abs(sharpFit.yPeak - 15200) < 2, `Expected yPeak ~15200, got ${sharpFit.yPeak}`);
  assert.ok(sharpFit.fwhm !== null && Math.abs(sharpFit.fwhm - 2.4) < 1e-2);

  // 2. Medium band: true FWHM = 6.2 px (4..9) -> Auto selects 5-pt Gaussian
  const medSigma = 6.2 / (2 * Math.sqrt(2 * Math.LN2));
  const medium = generateGaussianSpectrum(200, 100.35, 9000, medSigma, 350);
  const medEst = estimatePeakWidthAndBaseline(medium, 100);
  assert.ok(medEst.rawFwhm >= 4 && medEst.rawFwhm <= 9, `Expected 4..9, got ${medEst.rawFwhm}`);
  assert.ok(Math.abs(medEst.baseline - 350) < 2, `Expected baseline ~350, got ${medEst.baseline}`);

  const medFit = fitPeakCurve(medium, 100, 'auto');
  assert.equal(medFit.isFallback, false);
  assert.equal(medFit.model, 'gaussian5');
  assert.equal(medFit.modelLabel, 'Auto: 5-pt Gaussian');
  assert.equal(medFit.halfWindow, 2);
  assert.ok(Math.abs(medFit.xPeak - 100.35) < 1e-2, `Expected xPeak ~100.35, got ${medFit.xPeak}`);
  assert.ok(medFit.fwhm !== null && Math.abs(medFit.fwhm - 6.2) < 0.05);

  // 3. Broad amorphous Lorentzian band: gamma = 7 => true FWHM = 14 px (> 9) -> Auto selects Lorentzian
  const broad = generateLorentzianSpectrum(300, 150.42, 8000, 7.0, 500);
  const broadFit = fitPeakCurve(broad, 150, 'auto');
  assert.equal(broadFit.isFallback, false);
  assert.equal(broadFit.model, 'lorentzian');
  assert.equal(broadFit.modelLabel, 'Auto: Lorentzian');
  assert.ok(broadFit.halfWindow >= 3 && broadFit.halfWindow <= 15);
  assert.ok(Math.abs(broadFit.xPeak - 150.42) < 0.05, `Expected xPeak ~150.42, got ${broadFit.xPeak}`);
  assert.ok(broadFit.fwhm !== null && Math.abs(broadFit.fwhm - 14.0) < 1.2, `Expected FWHM ~14, got ${broadFit.fwhm}`);
  // Dynamic renderHalfSpan = max(10, ceil(3.5 * fwhm))
  assert.equal(broadFit.renderHalfSpan, Math.max(10, Math.ceil(3.5 * broadFit.fwhm!)));
});

test('All explicit models (gaussian3, gaussian5, lorentzian, parabolic) produce accurate fits and evaluate() tapers cleanly', () => {
  // Synthetic Lorentzian (gamma = 3.5 -> FWHM = 7.0)
  const lorData = generateLorentzianSpectrum(200, 80.28, 10000, 3.5, 100);
  const lorFit = fitPeakCurve(lorData, 80, 'lorentzian');
  assert.equal(lorFit.isFallback, false);
  assert.equal(lorFit.modelLabel, 'Lorentzian');
  assert.ok(Math.abs(lorFit.xPeak - 80.28) < 0.05);
  assert.ok(Math.abs(lorFit.evaluate(lorFit.xPeak) - lorFit.yPeak) < 1e-6);
  // Far wing approaches baseline cleanly
  assert.ok(lorFit.evaluate(lorFit.peakIndex + lorFit.renderHalfSpan) < lorFit.baseline + 500);

  // Synthetic 3-point Parabolic peak: y(x) = 5000 - 400*(x - 40.3)^2
  const paraData = Array.from({ length: 100 }, (_, i) => Math.max(100, 5000 - 400 * Math.pow(i - 40.3, 2)));
  const paraFit = fitPeakCurve(paraData, 40, 'parabolic');
  assert.equal(paraFit.isFallback, false);
  assert.equal(paraFit.modelLabel, 'Parabolic');
  assert.ok(Math.abs(paraFit.xPeak - 40.3) < 1e-6);
  assert.ok(Math.abs(paraFit.yPeak - 5000) < 1e-6);
  assert.ok(paraFit.fwhm !== null && paraFit.fwhm > 0);
  // Clamps cleanly at baseline on far wings instead of diving deeply negative
  assert.equal(paraFit.evaluate(paraFit.peakIndex + paraFit.renderHalfSpan), paraFit.baseline);

  // Backwards-compatible fitGaussianPeak wrapper
  const g5Data = generateGaussianSpectrum(120, 50.34, 12000, 1.8, 250);
  const g5Fit = fitGaussianPeak(g5Data, 50);
  assert.equal(g5Fit.isFallback, false);
  assert.equal(g5Fit.model, 'gaussian5');
  assert.ok(Math.abs(g5Fit.xPeak - 50.34) < 0.01);
});

test('fitPeakCurve guards against flat, concave-up, excessive shift, and edge boundary cases', () => {
  const flat = new Array<number>(30).fill(500);
  const flatFit = fitPeakCurve(flat, 15, 'auto');
  assert.equal(flatFit.isFallback, true);
  assert.equal(flatFit.xPeak, 15);
  assert.equal(flatFit.yPeak, 500);
  assert.equal(flatFit.fwhm, null);

  const valley = Array.from({ length: 30 }, (_, i) => 100 + Math.pow(i - 15, 2) * 50);
  const valleyFit = fitPeakCurve(valley, 15, 'lorentzian');
  assert.equal(valleyFit.isFallback, true);
  assert.equal(valleyFit.xPeak, 15);
  assert.equal(valleyFit.yPeak, 100);

  const edge = generateGaussianSpectrum(20, 0, 1000, 1.0, 50);
  const edgeFit = fitPeakCurve(edge, 0, 'gaussian3');
  assert.equal(edgeFit.isFallback, true);
  assert.equal(edgeFit.xPeak, 0);
});

test('samplePeakCurve uses dynamic renderHalfSpan at 0.05-pixel intervals and tapers into baseline', () => {
  const data = generateGaussianSpectrum(200, 90.4, 8000, 1.6, 120);
  const fit = fitPeakCurve(data, 90, 'auto');
  assert.equal(fit.isFallback, false);
  assert.ok(fit.renderHalfSpan >= 10);

  const sampled = samplePeakCurve(fit, data.length);
  const expectedCount = Math.round((2 * fit.renderHalfSpan) / 0.05) + 1;
  assert.equal(sampled.length, expectedCount);
  assert.ok(Math.abs(sampled[1].pixel - sampled[0].pixel - 0.05) < 1e-9);
  // Both ends should taper cleanly down to near baseline
  assert.ok(Math.abs(sampled[0].intensity - fit.baseline) < 1);
  assert.ok(Math.abs(sampled[sampled.length - 1].intensity - fit.baseline) < 1);
});

test('fitPeakCurve produces valid fits across all 5 methods on real Renishaw Silicon 520 cm-1 and PCL spectra', () => {
  const siWdf = parseWdf(fs.readFileSync(SAMPLE_520_PATH), { sortXAscending: true });
  assert.ok(siWdf.xAxis);
  const siY = getSpectrum(siWdf, 0);
  let siPeakIdx = 0;
  for (let i = 1; i < siY.length; i++) {
    if (siY[i] > siY[siPeakIdx]) siPeakIdx = i;
  }

  const siRawPeak = siY[siPeakIdx];
  for (const method of ['auto', 'gaussian3', 'gaussian5', 'lorentzian', 'parabolic'] as const) {
    const fit = fitPeakCurve(siY, siPeakIdx, method);
    assert.equal(fit.isFallback, false, `Silicon 520 peak should fit cleanly with method=${method}`);
    assert.ok(fit.fwhm !== null && fit.fwhm > 0.5 && fit.fwhm < 15);
    assert.ok(
      fit.yPeak >= siRawPeak * 0.85 && fit.yPeak <= siRawPeak * 1.15,
      `Method ${method} yPeak=${fit.yPeak} should stay close to raw peak ${siRawPeak}`,
    );
    const calX = interpolateAxisAtPixel(siWdf.xAxis.values, fit.xPeak);
    assert.ok(Math.abs(calX - 520.0) < 0.8, `Method ${method} calibrated peak=${calX}`);
  }

  const pclWdf = parseWdf(fs.readFileSync(SAMPLE_PCL_PATH), { sortXAscending: true });
  assert.ok(pclWdf.xAxis);
  const pclY = getSpectrum(pclWdf, 0);
  let pclPeakIdx = 0;
  for (let i = 1; i < pclY.length; i++) {
    if (pclY[i] > pclY[pclPeakIdx]) pclPeakIdx = i;
  }
  const pclAuto = fitPeakCurve(pclY, pclPeakIdx, 'auto');
  assert.equal(pclAuto.isFallback, false);
  assert.equal(pclAuto.model, 'gaussian3', 'Sharp PCL lamp line (< 4 px) should auto-select 3-pt Gaussian');
});
