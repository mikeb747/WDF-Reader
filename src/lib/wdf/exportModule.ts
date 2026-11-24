/**
 * Assembles a standalone, zero-dependency single-file `wdfReader.ts` module
 * directly from the verified TypeScript source files for drop-in use in Digital-Traveller.
 */

import typesSource from './types.ts?raw';
import psetSource from './pset.ts?raw';
import parserSource from './parser.ts?raw';

function stripLocalImports(source: string): string {
  return source
    .replace(/^\/\*\*[\s\S]*?\*\/\s*/m, '')
    .replace(/^import[\s\S]*?from\s+['"]\.\/[^'"]+['"];\s*$/gm, '')
    .trim();
}

export function buildStandaloneWdfReaderTs(): string {
  const header = `/**
 * wdfReader.ts — Standalone Zero-Dependency Renishaw WiRE (.wdf) Parser
 * Built for Digital-Traveller (compatible with Node.js Buffer and Browser ArrayBuffer/File).
 *
 * Supported blocks:
 *   WDF1 (Header), DATA (Float32 Spectra), XLST / YLST / BKXL (Calibration Axes),
 *   ORGN (Origins / Timestamps / Stage XYZ), TEXT (Comments), WMAP (Map Geometry),
 *   WHTL (White-Light Optical Image), and all Renishaw PSET metadata blocks
 *   (WXDA, WXDM, WXCS, WXIS, WXDB, ZLDC, MAP ) including inherited key tables
 *   and COM PropertyBags.
 */`;

  return [
    header,
    '// ---------------------------------------------------------------------------',
    '// 1. Types & Renishaw WDF Enumerations',
    '// ---------------------------------------------------------------------------',
    stripLocalImports(typesSource),
    '',
    '// ---------------------------------------------------------------------------',
    '// 2. Renishaw PSET Binary Metadata Decoder',
    '// ---------------------------------------------------------------------------',
    stripLocalImports(psetSource),
    '',
    '// ---------------------------------------------------------------------------',
    '// 3. WDF Binary Reader, Unit Converter, Peak Detector & CSV Exporter',
    '// ---------------------------------------------------------------------------',
    stripLocalImports(parserSource),
    '',
  ].join('\n');
}

export const DIGITAL_TRAVELLER_NODE_SNIPPET = `import fs from 'node:fs';
import { parseWdf, getSpectrum, convertXAxis, detectPeaks } from './wdfReader';

// Read any Renishaw .wdf binary file in Node.js
const buffer = fs.readFileSync('./samples/532nm_1800_520scan.wdf');
const wdf = parseWdf(buffer, { sortXAscending: true });

// 1. Access normalized instrument metadata (ready for Digital-Traveller records)
console.log({
  title: wdf.summary.title,
  operator: wdf.summary.operator,
  laser: wdf.summary.laserName,
  grating: wdf.summary.grating,
  objective: wdf.summary.objective,
  exposureMs: wdf.summary.exposureTimeMs,
  ndPercent: wdf.summary.ndTransmissionPercent,
  slits: {
    opening: wdf.summary.slitOpening,
    centre: wdf.summary.slitBeamCentre,
  },
  stage: wdf.summary.stagePosition,
  peak: { x: wdf.summary.peakX, intensity: wdf.summary.peakIntensity },
});

// 2. Extract spectrum #0 and convert X-axis to Raman Shift (even if stored in abs cm^-1)
if (wdf.xAxis) {
  const ramanX = convertXAxis(wdf.xAxis, wdf.header.laserWavenumber, 'ramanShift');
  const intensity = getSpectrum(wdf, 0);
  const peaks = detectPeaks(ramanX.values, intensity);
  console.log('Top Raman peaks (cm^-1):', peaks);
}

// 3. Access full recursive PSET dictionaries (WXIS, WXDM, WXDA, WXCS, ZLDC)
console.log('Full hardware snapshot:', wdf.propertySets.WXIS);`;

export const DIGITAL_TRAVELLER_BROWSER_SNIPPET = `import { parseWdfFile, getSpectrum, wdfToCsv } from './wdfReader';

// Parse a user-selected File from <input type="file" accept=".wdf" />
export async function handleWdfUpload(file: File) {
  const wdf = await parseWdfFile(file, { sortXAscending: true });

  const spectrum0 = getSpectrum(wdf, 0);
  const csvText = wdfToCsv(wdf, {
    spectrumIndex: 0,
    sortAscending: true,
    targetUnit: 'ramanShift',
  });

  return {
    summary: wdf.summary,
    points: wdf.xAxis ? Array.from(wdf.xAxis.values, (x, i) => ({ x, y: spectrum0[i] })) : [],
    csvText,
    rawPropertySets: wdf.propertySets,
  };
}`;
