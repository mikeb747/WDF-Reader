import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  convertXAxis,
  detectPeaks,
  getSpectrum,
  parseWdf,
  subtractBaseline,
  autoSubtractBaseline,
  parseArithmeticExpression,
  computeSpectrumArithmetic,
  smoothSpectrumSavitzkyGolay,
  autoSmoothSpectrum,
  WdfBlockId,
  WdfDataType,
  WdfDataUnits,
  WdfMeasurementType,
  WdfScanType,
  wdfToCsv,
} from './index';

const SAMPLE_520_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/532nm_1800_520scan_62354700.txt',
);
const SAMPLE_PCL_PATH = path.resolve(
  process.cwd(),
  'public/assets/aistudio/532nm_1800_17087_abs_cm-1_PCL_e8762f36.txt',
);

function buildBlock(id: string, uid: number, payload: Uint8Array): Uint8Array {
  const totalSize = 16 + payload.byteLength;
  const out = new Uint8Array(totalSize);
  const view = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) {
    out[i] = id.charCodeAt(i);
  }
  view.setUint32(4, uid, true);
  view.setBigUint64(8, BigInt(totalSize), true);
  out.set(payload, 16);
  return out;
}

function concatBytes(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((acc, c) => acc + c.byteLength, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

function createSyntheticMapWdf(): Uint8Array {
  const headerPayload = new Uint8Array(512 - 16);
  const hv = new DataView(headerPayload.buffer);
  // Offsets inside payload are (fileOffset - 16)
  hv.setBigUint64(0, 0n, true); // flags
  hv.setUint32(52 - 16, 1, true); // ntracks
  hv.setUint32(56 - 16, 0, true); // status
  hv.setUint32(60 - 16, 5, true); // npoints = 5
  hv.setBigUint64(64 - 16, 4n, true); // capacity = 4
  hv.setBigUint64(72 - 16, 4n, true); // ncollected = 4
  hv.setUint32(80 - 16, 2, true); // accumulations = 2
  hv.setUint32(84 - 16, 1, true); // ylistCount
  hv.setUint32(88 - 16, 5, true); // xlistCount
  hv.setUint32(92 - 16, 2, true); // originCount
  new TextEncoder().encodeInto('WiRE', headerPayload.subarray(96 - 16, 120 - 16));
  hv.setUint16(120 - 16, 5, true);
  hv.setUint16(122 - 16, 5, true);
  hv.setUint16(124 - 16, 0, true);
  hv.setUint16(126 - 16, 1234, true);
  hv.setUint32(128 - 16, WdfScanType.StreamLine, true);
  hv.setUint32(132 - 16, WdfMeasurementType.Mapping, true);
  hv.setUint32(152 - 16, WdfDataUnits.Counts, true);
  hv.setFloat32(156 - 16, 18797.0, true); // 532 nm
  new TextEncoder().encodeInto('LabTech', headerPayload.subarray(208 - 16, 240 - 16));
  new TextEncoder().encodeInto('Synthetic 2x2 Map', headerPayload.subarray(240 - 16, 400 - 16));
  const wdf1 = buildBlock('WDF1', 1, headerPayload);

  // DATA: 4 spectra x 5 points
  const dataPayload = new Uint8Array(4 * 5 * 4);
  const dv = new DataView(dataPayload.buffer);
  for (let s = 0; s < 4; s++) {
    for (let p = 0; p < 5; p++) {
      const intensity = (s + 1) * 100 + (p === 2 ? 500 : p * 10);
      dv.setFloat32((s * 5 + p) * 4, intensity, true);
    }
  }
  const dataBlock = buildBlock('DATA', 0, dataPayload);

  // XLST: 5 points Raman shift
  const xPayload = new Uint8Array(8 + 5 * 4);
  const xv = new DataView(xPayload.buffer);
  xv.setUint32(0, WdfDataType.Spectral, true);
  xv.setUint32(4, WdfDataUnits.RamanShift, true);
  [100, 300, 520, 700, 900].forEach((val, idx) => xv.setFloat32(8 + idx * 4, val, true));
  const xBlock = buildBlock('XLST', 0, xPayload);

  // WMAP: 2x2 grid starting at (10, 20, 0), step (5, 5, 0)
  const mapPayload = new Uint8Array(48);
  const mv = new DataView(mapPayload.buffer);
  mv.setUint32(0, 0, true); // flags
  mv.setFloat32(8, 10, true); // start x
  mv.setFloat32(12, 20, true); // start y
  mv.setFloat32(16, 0, true); // start z
  mv.setFloat32(20, 5, true); // step x
  mv.setFloat32(24, 5, true); // step y
  mv.setFloat32(28, 0, true); // step z
  mv.setUint32(32, 2, true); // count x
  mv.setUint32(36, 2, true); // count y
  mv.setUint32(40, 1, true); // count z
  mv.setUint32(44, 1, true); // line focus
  const wmapBlock = buildBlock('WMAP', 0, mapPayload);

  // ORGN: SpatialX and SpatialY for 4 points
  const orgPayload = new Uint8Array(4 + 2 * (24 + 4 * 8));
  const ov = new DataView(orgPayload.buffer);
  ov.setUint32(0, 2, true);
  let cur = 4;
  const writeOrigin = (type: number, label: string, vals: number[]) => {
    ov.setUint32(cur, type | 0x80000000, true);
    ov.setUint32(cur + 4, WdfDataUnits.Micron, true);
    new TextEncoder().encodeInto(label, orgPayload.subarray(cur + 8, cur + 24));
    cur += 24;
    for (const v of vals) {
      ov.setFloat64(cur, v, true);
      cur += 8;
    }
  };
  writeOrigin(WdfDataType.SpatialX, 'X', [10, 15, 10, 15]);
  writeOrigin(WdfDataType.SpatialY, 'Y', [20, 20, 25, 25]);
  const orgnBlock = buildBlock('ORGN', 0, orgPayload);

  // WHTL: synthetic JPEG magic bytes
  const jpegBytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9]);
  const whtlBlock = buildBlock('WHTL', 0, jpegBytes);

  return concatBytes([wdf1, dataBlock, xBlock, wmapBlock, orgnBlock, whtlBlock]);
}

test('parses real Renishaw sample #1 (532nm_1800_520scan) accurately', () => {
  const buf = fs.readFileSync(SAMPLE_520_PATH);
  const wdf = parseWdf(buf);

  assert.equal(wdf.warnings.length, 0, `Unexpected warnings: ${wdf.warnings.join('; ')}`);
  assert.equal(wdf.blocks.length, 12);
  assert.deepEqual(
    wdf.blocks.map((b) => b.id),
    ['WDF1', 'DATA', 'YLST', 'XLST', 'WXDA', 'ORGN', 'TEXT', 'WXDM', 'BKXL', 'WXCS', 'WXIS', 'ZLDC'],
  );
  assert.ok(wdf.blocks.every((b) => b.parsed), 'Every block in sample #1 should be parsed');

  assert.equal(wdf.header.title, '532nm_1800_5 pos of si_520 cm-1');
  assert.equal(wdf.header.operator, 'Raman');
  assert.equal(wdf.header.applicationName, 'WiRE');
  assert.equal(wdf.header.applicationVersion, '5.7.0.44973');
  assert.equal(wdf.header.pointsPerSpectrum, 1015);
  assert.equal(wdf.header.spectraCollected, 1);
  assert.equal(wdf.header.scanType, WdfScanType.Static);
  assert.equal(wdf.header.measurementType, WdfMeasurementType.Single);
  assert.equal(wdf.header.timeStart, '2026-02-11T10:46:47.708Z');
  assert.equal(wdf.header.timeEnd, '2026-02-11T10:46:49.030Z');
  assert.ok(Math.abs(wdf.header.laserWavenumber - 18790.810546875) < 1e-3);

  assert.ok(wdf.xAxis);
  assert.equal(wdf.xAxis.units, WdfDataUnits.RamanShift);
  assert.equal(wdf.xAxis.values.length, 1015);
  assert.ok(wdf.xAxis.values[0] > wdf.xAxis.values[wdf.xAxis.values.length - 1], 'Native XLST is descending');

  // Silicon 520 cm-1 peak check
  assert.ok(wdf.summary.peakX !== null && Math.abs(wdf.summary.peakX - 519.94) < 0.2);
  assert.ok(wdf.summary.peakIntensity !== null && Math.abs(wdf.summary.peakIntensity - 29885.64) < 1);

  // Decoded PSET instrument metadata checks
  assert.equal(wdf.summary.laserName, '532 nm edge');
  assert.equal(wdf.summary.grating, '1800 l/mm (vis)');
  assert.equal(wdf.summary.objective, '100x');
  assert.equal(wdf.summary.objectiveMagnification, 100);
  assert.equal(wdf.summary.ndTransmissionPercent, 10);
  assert.equal(wdf.summary.exposureTimeMs, 1000);
  assert.equal(wdf.summary.accumulations, 1);
  assert.equal(wdf.summary.centreWavenumber, 520);
  assert.equal(wdf.summary.xBinning, 1);
  assert.equal(wdf.summary.yBinning, 14);
  assert.equal(wdf.summary.slitOpening, '65µm');
  assert.equal(wdf.summary.slitBeamCentre, '2061µm');
  assert.deepEqual(wdf.summary.stagePosition, { x: 0, y: 0, z: 0 });
  assert.equal(wdf.summary.ccdSerialNumber, 'AM1J97');
  assert.equal(wdf.summary.ccdFirmwareVersion, '4.105');
  assert.equal(wdf.summary.spectrometerSerialNumber, 'C5YJ29');

  // VBScript omitted by default, available via includeScript: true
  assert.equal(wdf.measurementScript, null);
  const wdfWithScript = parseWdf(buf, { includeScript: true });
  assert.ok(wdfWithScript.measurementScript && wdfWithScript.measurementScript.length > 10000);
});

test('parses real Renishaw sample #2 (532nm_1800_17087 abs cm-1_PCL) and converts units', () => {
  const buf = fs.readFileSync(SAMPLE_PCL_PATH);
  const wdf = parseWdf(buf);

  assert.equal(wdf.warnings.length, 0);
  assert.equal(wdf.blocks.length, 12);
  assert.equal(wdf.header.title, '532nm_1800_17087 abs cm-1_PCL');
  assert.equal(wdf.header.timeStart, '2026-02-10T09:35:59.735Z');
  assert.equal(wdf.header.timeEnd, '2026-02-10T09:36:00.090Z');
  assert.equal(wdf.summary.scanDurationMs, 325);
  assert.equal(wdf.summary.objective, '50x L');
  assert.equal(wdf.summary.objectiveMagnification, 50);
  assert.equal(wdf.summary.ndTransmissionPercent, 100);
  assert.equal(wdf.summary.exposureTimeMs, 20);
  assert.equal(wdf.summary.centreWavenumber, 17087);
  assert.equal(wdf.summary.yBinning, 11);
  assert.equal(wdf.summary.slitOpening, '11µm');
  assert.equal(wdf.summary.slitBeamCentre, '2040µm');
  assert.ok(wdf.summary.stagePosition);
  assert.ok(Math.abs(wdf.summary.stagePosition.x - -447.8) < 1e-3);
  assert.ok(Math.abs(wdf.summary.stagePosition.y - 222.95) < 1e-3);
  assert.ok(Math.abs(wdf.summary.stagePosition.z - -64) < 1e-3);

  assert.ok(wdf.xAxis);
  assert.equal(wdf.xAxis.units, WdfDataUnits.Wavenumber);
  assert.ok(wdf.summary.peakX !== null && Math.abs(wdf.summary.peakX - 17086.95) < 0.2);

  // Convert Absolute Wavenumber -> Raman Shift (cm^-1): 18797 - 17086.95 ~= 1710.05 cm^-1
  const asRaman = convertXAxis(wdf.xAxis, wdf.header.laserWavenumber, 'ramanShift');
  const peakIdx = 499;
  assert.ok(Math.abs(asRaman.values[peakIdx] - 1710.05) < 0.3, `Expected ~1710.05, got ${asRaman.values[peakIdx]}`);

  // Convert to Wavelength (nm): 1e7 / 17086.95 ~= 585.24 nm
  const asNm = convertXAxis(wdf.xAxis, wdf.header.laserWavenumber, 'nanometre');
  assert.ok(Math.abs(asNm.values[peakIdx] - 585.24) < 0.2);

  // Convert to Photon Energy (eV): 17086.95 * 1.23984e-4 ~= 2.1185 eV
  const asEv = convertXAxis(wdf.xAxis, wdf.header.laserWavenumber, 'electronVolt');
  assert.ok(Math.abs(asEv.values[peakIdx] - 2.1185) < 0.01);
});

test('sortXAscending normalizes descending spectra and keeps peak position identical', () => {
  const buf = fs.readFileSync(SAMPLE_520_PATH);
  const sorted = parseWdf(buf, { sortXAscending: true });
  assert.ok(sorted.xAxis);
  for (let i = 1; i < sorted.xAxis.values.length; i++) {
    assert.ok(sorted.xAxis.values[i] >= sorted.xAxis.values[i - 1], 'X axis should be ascending');
  }
  assert.ok(sorted.summary.peakX !== null && Math.abs(sorted.summary.peakX - 519.94) < 0.2);

  const peaks = detectPeaks(sorted.xAxis.values, getSpectrum(sorted, 0));
  assert.ok(peaks.some((p) => Math.abs(p.x - 519.94) < 0.2));

  const csv = wdfToCsv(sorted, { sortAscending: true });
  const lines = csv.split('\n');
  assert.equal(lines.length, 1016);
  assert.equal(lines[0], '"Raman Shift (cm⁻¹)","Intensity (Counts)"');
});

test('parses synthetic 2x2 WMAP multi-spectrum file with ORGN and WHTL JPEG image', () => {
  const bytes = createSyntheticMapWdf();
  const wdf = parseWdf(bytes);

  assert.equal(wdf.header.title, 'Synthetic 2x2 Map');
  assert.equal(wdf.header.spectraCollected, 4);
  assert.equal(wdf.header.pointsPerSpectrum, 5);
  assert.equal(wdf.spectra.length, 20);
  assert.ok(wdf.mapArea);
  assert.deepEqual(wdf.mapArea.count, { x: 2, y: 2, z: 1 });
  assert.deepEqual(wdf.mapArea.startPosition, { x: 10, y: 20, z: 0 });
  assert.deepEqual(wdf.mapArea.stepSize, { x: 5, y: 5, z: 0 });

  assert.equal(wdf.origins.length, 2);
  assert.equal(wdf.origins[0].dataType, WdfDataType.SpatialX);
  assert.deepEqual(wdf.origins[0].values, [10, 15, 10, 15]);
  assert.deepEqual(wdf.origins[1].values, [20, 20, 25, 25]);

  assert.ok(wdf.whiteLightImage);
  assert.equal(wdf.whiteLightImage.mimeType, 'image/jpeg');
  assert.equal(wdf.whiteLightImage.byteLength, 12);

  // Verify per-spectrum slicing
  const spec3 = getSpectrum(wdf, 3);
  assert.equal(spec3.length, 5);
  assert.equal(spec3[2], 900); // (3+1)*100 + 500
  assert.ok(wdf.blocks.some((b) => b.id === WdfBlockId.WMAP));
});

test('computes accurate linearly interpolated FWHM for ascending, descending, and real sample peaks', () => {
  // Analytical triangle peak: x = 0..20, peak at x=10 with y=100, drops linearly to 0 at x=5 and x=15 -> half-max at x=7.5 and x=12.5 => FWHM = 5.0
  const xsAsc = Array.from({ length: 21 }, (_, i) => i);
  const ysAsc = xsAsc.map((x) => Math.max(0, 100 - Math.abs(x - 10) * 20));
  const ascPeaks = detectPeaks(xsAsc, ysAsc);
  assert.equal(ascPeaks.length, 1);
  assert.ok(ascPeaks[0].fwhm !== null && Math.abs(ascPeaks[0].fwhm - 5.0) < 1e-6);

  // Reversed (descending X, like native Renishaw XLST) must produce identical FWHM
  const xsDesc = [...xsAsc].reverse();
  const ysDesc = [...ysAsc].reverse();
  const descPeaks = detectPeaks(xsDesc, ysDesc);
  assert.equal(descPeaks.length, 1);
  assert.ok(descPeaks[0].fwhm !== null && Math.abs(descPeaks[0].fwhm - 5.0) < 1e-6);

  // Real Silicon 520 cm-1 peak FWHM check
  const siWdf = parseWdf(fs.readFileSync(SAMPLE_520_PATH), { sortXAscending: true });
  assert.ok(siWdf.xAxis);
  const siPeaks = detectPeaks(siWdf.xAxis.values, getSpectrum(siWdf, 0));
  assert.ok(siPeaks.length >= 1);
  const siMain = siPeaks.find((p) => Math.abs(p.x - 519.94) < 0.2);
  assert.ok(siMain && siMain.fwhm !== null && siMain.fwhm > 1 && siMain.fwhm < 15, `Unexpected Si FWHM: ${siMain?.fwhm}`);

  // Real PCL sample peaks FWHM check
  const pclWdf = parseWdf(fs.readFileSync(SAMPLE_PCL_PATH), { sortXAscending: true });
  assert.ok(pclWdf.xAxis);
  const pclPeaks = detectPeaks(pclWdf.xAxis.values, getSpectrum(pclWdf, 0), 5, 16);
  assert.ok(pclPeaks.length >= 1);
  assert.ok(pclPeaks.every((p) => p.fwhm !== null && p.fwhm > 0 && p.fwhm < 25));
});

test('subtractBaseline (AsLS) removes broad fluorescence background while preserving sharp Raman peaks', () => {
  const n = 1000;
  const trueBg = new Float64Array(n);
  const raw = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const bg = 800 + 1800 * Math.exp(-Math.pow((i - 420) / 280, 2));
    const peak = 5000 * Math.exp(-Math.pow((i - 520) / 6, 2));
    trueBg[i] = bg;
    raw[i] = bg + peak;
  }

  const { baseline, corrected } = subtractBaseline(raw, { lambda: 1e5, p: 0.005, iterations: 10 });
  assert.equal(baseline.length, n);
  assert.equal(corrected.length, n);

  // Away from the sharp peak, corrected intensity should be close to 0 (out of 2,600 fluorescence background)
  assert.ok(Math.abs(corrected[100]) < 20, `Expected near-zero baseline at idx 100, got ${corrected[100]}`);
  assert.ok(Math.abs(corrected[850]) < 20, `Expected near-zero baseline at idx 850, got ${corrected[850]}`);

  // At the sharp peak apex (idx 520), peak intensity should remain close to 5000
  assert.ok(corrected[520] > 4850 && corrected[520] < 5100, `Expected ~5000 peak height, got ${corrected[520]}`);

  // Real Renishaw Silicon spectrum runs cleanly without NaN and preserves Si 520 cm-1 peak
  const siWdf = parseWdf(fs.readFileSync(SAMPLE_520_PATH), { sortXAscending: true });
  const siY = getSpectrum(siWdf, 0);
  const siRes = subtractBaseline(siY);
  let maxCorrected = -Infinity;
  for (let i = 0; i < siRes.corrected.length; i++) {
    assert.ok(Number.isFinite(siRes.corrected[i]));
    if (siRes.corrected[i] > maxCorrected) maxCorrected = siRes.corrected[i];
  }
  assert.ok(maxCorrected > 29000, `Expected Si peak preserved > 29000, got ${maxCorrected}`);
});

test('computes Virsa effective laser power from WXIS Laser power mW and ND Transmission %', () => {
  const enc = new TextEncoder();
  const makeStrEntry = (typeChar: string, keyId: number, text: string): Uint8Array => {
    const strBytes = enc.encode(text);
    const out = new Uint8Array(8 + strBytes.byteLength);
    const v = new DataView(out.buffer);
    out[0] = typeChar.charCodeAt(0);
    out[1] = 0;
    v.setUint16(2, keyId, true);
    v.setUint32(4, strBytes.byteLength, true);
    out.set(strBytes, 8);
    return out;
  };
  const makeFloat64Entry = (keyId: number, val: number): Uint8Array => {
    const out = new Uint8Array(12);
    const v = new DataView(out.buffer);
    out[0] = 'q'.charCodeAt(0);
    out[1] = 0;
    v.setUint16(2, keyId, true);
    v.setFloat64(4, val, true);
    return out;
  };

  const psetBody = concatBytes([
    makeStrEntry('k', 0x8001, 'Instrument type'),
    makeStrEntry('k', 0x8002, 'Laser power mW'),
    makeStrEntry('k', 0x8003, 'ND Transmission %'),
    makeStrEntry('u', 0x8001, ' Virsa'),
    makeFloat64Entry(0x8002, 40.5),
    makeFloat64Entry(0x8003, 10),
  ]);
  const psetHeader = new Uint8Array(8);
  const pv = new DataView(psetHeader.buffer);
  enc.encodeInto('PSET', psetHeader.subarray(0, 4));
  pv.setUint32(4, psetBody.byteLength, true);
  const wxisBlock = buildBlock('WXIS', 0, concatBytes([psetHeader, psetBody]));

  const baseWdf = createSyntheticMapWdf();
  const virsaWdf = parseWdf(concatBytes([baseWdf, wxisBlock]));
  assert.equal(virsaWdf.summary.instrumentType, 'Virsa');
  assert.equal(virsaWdf.summary.laserPowerMw, 40.5);
  assert.equal(virsaWdf.summary.ndTransmissionPercent, 10);
  assert.equal(virsaWdf.summary.effectiveLaserPowerMw, 4.05);
});

test('autoSubtractBaseline adapts to fluorescent vs flat backgrounds and reveals subtle peaks', () => {
  const n = 1000;
  const fluorRaw = new Float64Array(n);
  const flatRaw = new Float64Array(n);

  // Deterministic pseudo-noise + steep fluorescence + subtle Raman peak (height 120 on 2500 bg)
  for (let i = 0; i < n; i++) {
    const noise = Math.sin(i * 12.9898) * 4;
    const bg = 600 + 2500 * Math.exp(-Math.pow((i - 450) / 180, 2));
    const subtlePeak = 120 * Math.exp(-Math.pow((i - 620) / 5, 2));
    const mainPeak = 900 * Math.exp(-Math.pow((i - 320) / 6, 2));
    fluorRaw[i] = bg + mainPeak + subtlePeak + noise;
    flatRaw[i] = 100 + 5000 * Math.exp(-Math.pow((i - 500) / 5, 2)) + noise;
  }

  const fluorRes = autoSubtractBaseline(fluorRaw);
  assert.equal(fluorRes.profile, 'Fluorescent');
  // Subtle peak at idx 620 should remain clearly positive (~100-125) while background around idx 760 is ~0
  assert.ok(fluorRes.corrected[620] > 80, `Expected subtle peak revealed > 80, got ${fluorRes.corrected[620]}`);
  assert.ok(Math.abs(fluorRes.corrected[760]) < 25, `Expected flat background near 0, got ${fluorRes.corrected[760]}`);

  const flatRes = autoSubtractBaseline(flatRaw);
  assert.equal(flatRes.profile, 'Flat');
  assert.ok(flatRes.lambda > fluorRes.lambda, 'Flat spectrum should use smoother lambda than fluorescent spectrum');
});

test('computeSpectrumArithmetic evaluates 1-dataset and 2-dataset formulas accurately', () => {
  const siWdf = parseWdf(fs.readFileSync(SAMPLE_520_PATH));
  const pclWdf = parseWdf(fs.readFileSync(SAMPLE_PCL_PATH));

  // Example 1: "data 1" / 150
  const divRes = computeSpectrumArithmetic({
    expression: '"data 1" / 150',
    primary: { wdf: siWdf, fileName: '532nm_1800_520scan' },
    outputName: 'Si / 150',
  });
  assert.equal(divRes.pointCount, siWdf.header.pointsPerSpectrum);
  assert.equal(divRes.interpolated, false);
  const siOrig = getSpectrum(siWdf, 0);
  const siDiv = getSpectrum(divRes.wdf, 0);
  assert.ok(Math.abs(siDiv[0] - siOrig[0] / 150) < 1e-2);
  assert.ok(divRes.wdf.summary.peakIntensity !== null);
  assert.ok(
    Math.abs(divRes.wdf.summary.peakIntensity - (siWdf.summary.peakIntensity ?? 0) / 150) < 0.05,
  );

  // Example 2: ("data 1" * 100) / (1 * "data 2") on identical grid (D1 vs D1 -> constant 100 everywhere non-zero)
  const selfRatio = computeSpectrumArithmetic({
    expression: '("data 1" * 100) / (1 * "data 2")',
    primary: { wdf: siWdf, fileName: 'Si' },
    secondary: { wdf: siWdf, fileName: 'Si' },
    outputName: 'Self ratio',
  });
  const peakPointIdx = siOrig.indexOf(Math.max(...Array.from(siOrig)));
  assert.ok(Math.abs(selfRatio.wdf.spectra[peakPointIdx] - 100) < 1e-2);

  // Example 3: Unparenthesized "data 1" * 100 / 1 * "data 2" parses with standard left-to-right precedence
  const parsed = parseArithmeticExpression('"data 1" * 100 / 1 * "data 2"');
  assert.equal(parsed.usesD1, true);
  assert.equal(parsed.usesD2, true);

  // Example 4: Cross-unit 2-dataset arithmetic (Raman Shift vs Absolute Wavenumber) interpolates over overlap
  const crossUnit = computeSpectrumArithmetic({
    expression: '(D1 * 100) / (1 * D2)',
    primary: { wdf: siWdf, fileName: 'Si' },
    secondary: { wdf: pclWdf, fileName: 'PCL' },
    outputName: 'Cross unit ratio',
  });
  assert.equal(crossUnit.interpolated, true);
  assert.equal(crossUnit.overlapUsed, true);
  assert.ok(crossUnit.pointCount > 100, 'Expected substantial Raman shift overlap (~825..1392 cm-1)');
  assert.equal(crossUnit.wdf.xAxis?.units, WdfDataUnits.RamanShift);

  // Rejects division by zero constant and invalid syntax
  assert.throws(() => parseArithmeticExpression('D1 / 0'), /zero/i);
  assert.throws(() => parseArithmeticExpression('D1 + * 5'), /unexpected/i);
});

test('smoothSpectrumSavitzkyGolay and autoSmoothSpectrum reduce high-frequency noise while preserving polynomials and peaks', () => {
  // 1. Exact cubic polynomial reproduction including boundaries
  const poly = new Float64Array(80);
  for (let i = 0; i < poly.length; i++) {
    const t = (i - 40) / 20;
    poly[i] = 10 + 3 * t - 1.5 * t * t + 0.4 * t * t * t;
  }
  const polySmooth = smoothSpectrumSavitzkyGolay(poly, { windowSize: 15, polyOrder: 3 });
  for (let i = 0; i < poly.length; i++) {
    assert.ok(
      Math.abs(polySmooth[i] - poly[i]) < 1e-8,
      `Polynomial mismatch at idx ${i}: ${polySmooth[i]} vs ${poly[i]}`,
    );
  }

  // 2. Noisy filter transmission plateau (0 -> 96% step with ±3% jitter like real edge-filter ratios)
  const n = 2400;
  const noisyFilter = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const step = 96 / (1 + Math.exp(-(i - 200) / 4));
    const jitter = i > 220 ? Math.sin(i * 1.7) * 2.1 + Math.cos(i * 2.9) * 1.4 : Math.sin(i * 1.9) * 0.15;
    noisyFilter[i] = step + jitter;
  }
  const autoRes = autoSmoothSpectrum(noisyFilter);
  assert.ok(autoRes.windowSize >= 15, `Expected strong auto window >= 15, got ${autoRes.windowSize}`);

  // Compute plateau standard deviation before vs after smoothing (indices 400..2200)
  const plateauSlice = (arr: Float64Array) => {
    let sum = 0;
    let count = 0;
    for (let i = 400; i < 2200; i++) {
      sum += arr[i];
      count++;
    }
    const mean = sum / count;
    let varSum = 0;
    for (let i = 400; i < 2200; i++) {
      varSum += (arr[i] - mean) * (arr[i] - mean);
    }
    return { mean, std: Math.sqrt(varSum / count) };
  };
  const before = plateauSlice(noisyFilter);
  const after = plateauSlice(autoRes.smoothed);
  assert.ok(Math.abs(after.mean - 96) < 0.2, `Plateau mean drifted: ${after.mean}`);
  assert.ok(after.std < before.std * 0.25, `Expected >75% noise reduction: ${before.std} -> ${after.std}`);

  // 3. Preserves real Silicon 520 cm-1 peak center cleanly
  const siWdf = parseWdf(fs.readFileSync(SAMPLE_520_PATH), { sortXAscending: true });
  assert.ok(siWdf.xAxis);
  const siY = getSpectrum(siWdf, 0);
  const siAuto = autoSmoothSpectrum(siY);
  let maxIdx = 0;
  for (let i = 1; i < siAuto.smoothed.length; i++) {
    if (siAuto.smoothed[i] > siAuto.smoothed[maxIdx]) maxIdx = i;
  }
  assert.ok(Math.abs(siWdf.xAxis.values[maxIdx] - 519.94) < 0.5);
});

test('rejects invalid or truncated inputs cleanly', () => {
  assert.throws(() => parseWdf(new Uint8Array(4)), /too small/i);
  assert.throws(() => parseWdf(new TextEncoder().encode('NOT_A_WDF_FILE_PAYLOAD')), /WDF1/);
});
