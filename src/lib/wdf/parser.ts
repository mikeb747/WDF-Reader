/**
 * Complete zero-dependency TypeScript parser for Renishaw WiRE Data Files (.wdf).
 * Designed for drop-in use in Digital-Traveller (both Node.js and Browser).
 */

import { decodeUtf8Trimmed, filetimeToIso, parsePsetBlock, parsePsetBlockWithEnd } from './pset';
import {
  getDataTypeName,
  getMeasurementTypeName,
  getScanTypeName,
  getUnitInfo,
  WDF_BLOCK_DESCRIPTIONS,
  WdfBlockId,
  WdfDataType,
  WdfDataUnits,
  WdfHeaderFlag,
  WdfMapAreaFlag,
  WdfMeasurementType,
  WdfScanType,
  type AutoBaselineResult,
  type BaselineOptions,
  type BaselineResult,
  type PsetObject,
  type WdfAxisList,
  type WdfBlockSummary,
  type WdfFile,
  type WdfHeader,
  type WdfInstrumentSummary,
  type WdfMapArea,
  type WdfMapResult,
  type WdfOriginList,
  type WdfParseOptions,
  type WdfPeak,
  type WdfWhiteLightImage,
} from './types';

const WDF1_MAGIC = 'WDF1';
const HC_EV_CM = 1.239841984e-4; // eV per cm^-1

function toUint8Array(input: ArrayBuffer | ArrayBufferView): Uint8Array {
  if (input instanceof Uint8Array) {
    return input;
  }
  if (ArrayBuffer.isView(input)) {
    return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  return new Uint8Array(input);
}

function formatUuid(bytes: Uint8Array, offset: number): string {
  const hex = (i: number) => bytes[offset + i].toString(16).padStart(2, '0');
  // Windows GUID little-endian first 3 groups, big-endian last 2 groups
  const g1 = `${hex(3)}${hex(2)}${hex(1)}${hex(0)}`;
  const g2 = `${hex(5)}${hex(4)}`;
  const g3 = `${hex(7)}${hex(6)}`;
  const g4 = `${hex(8)}${hex(9)}`;
  const g5 = `${hex(10)}${hex(11)}${hex(12)}${hex(13)}${hex(14)}${hex(15)}`;
  return `${g1}-${g2}-${g3}-${g4}-${g5}`.toLowerCase();
}

function decodeBitFlags(mask: number, enumObj: Record<string, string | number>): string[] {
  const names: string[] = [];
  for (const [key, val] of Object.entries(enumObj)) {
    if (typeof val === 'number' && val > 0 && (mask & val) === val) {
      names.push(key);
    }
  }
  return names;
}

function readWdf1Header(view: DataView, bytes: Uint8Array, offset: number, size: number): WdfHeader {
  if (offset + 400 > bytes.length || size < 400) {
    throw new Error(`WDF1 header truncated (need at least 400 bytes, got ${size}).`);
  }

  const signature = decodeUtf8Trimmed(bytes, offset, 4);
  if (signature !== WDF1_MAGIC) {
    throw new Error(`Invalid WDF file signature: expected "WDF1", got "${signature}".`);
  }

  const version = view.getUint32(offset + 4, true);
  const headerSize = Number(view.getBigUint64(offset + 8, true));
  const flags = Number(view.getBigUint64(offset + 16, true));
  const uuid = formatUuid(bytes, offset + 24);
  const ntracks = view.getUint32(offset + 52, true);
  const status = view.getUint32(offset + 56, true);
  const pointsPerSpectrum = view.getUint32(offset + 60, true);
  const capacity = Number(view.getBigUint64(offset + 64, true));
  const spectraCollected = Number(view.getBigUint64(offset + 72, true));
  const accumulations = view.getUint32(offset + 80, true);
  const yListCount = view.getUint32(offset + 84, true);
  const xListCount = view.getUint32(offset + 88, true);
  const originCount = view.getUint32(offset + 92, true);
  const applicationName = decodeUtf8Trimmed(bytes, offset + 96, 24);
  const appVer: [number, number, number, number] = [
    view.getUint16(offset + 120, true),
    view.getUint16(offset + 122, true),
    view.getUint16(offset + 124, true),
    view.getUint16(offset + 126, true),
  ];
  const scanType = view.getUint32(offset + 128, true) as WdfScanType;
  const measurementType = view.getUint32(offset + 132, true) as WdfMeasurementType;
  const timeStart = filetimeToIso(view.getBigUint64(offset + 136, true));
  const timeEnd = filetimeToIso(view.getBigUint64(offset + 144, true));
  const spectralUnits = view.getUint32(offset + 152, true) as WdfDataUnits;
  const laserWavenumber = view.getFloat32(offset + 156, true);
  const laserWavelengthNm =
    Number.isFinite(laserWavenumber) && laserWavenumber > 0
      ? Number((1e7 / laserWavenumber).toFixed(4))
      : null;
  const operator = decodeUtf8Trimmed(bytes, offset + 208, 32);
  const title = decodeUtf8Trimmed(bytes, offset + 240, 160);

  return {
    signature,
    version,
    headerSize,
    flags,
    flagNames: decodeBitFlags(flags, WdfHeaderFlag),
    uuid,
    ntracks,
    status,
    pointsPerSpectrum,
    capacity,
    spectraCollected,
    accumulations,
    yListCount,
    xListCount,
    originCount,
    applicationName,
    applicationVersion: appVer.join('.'),
    applicationVersionParts: appVer,
    scanType,
    scanTypeName: getScanTypeName(scanType),
    measurementType,
    measurementTypeName: getMeasurementTypeName(measurementType),
    timeStart,
    timeEnd,
    spectralUnits,
    spectralUnitsName: getUnitInfo(spectralUnits).name,
    laserWavenumber,
    laserWavelengthNm,
    operator,
    title,
  };
}

function readAxisBlock(
  view: DataView,
  offset: number,
  size: number,
  expectedCount?: number,
): WdfAxisList | null {
  if (size < 24) return null;
  const dataType = view.getUint32(offset + 16, true) as WdfDataType;
  const units = view.getUint32(offset + 20, true) as WdfDataUnits;
  const availableFloats = Math.floor((size - 24) / 4);
  const count =
    expectedCount && expectedCount > 0 && expectedCount <= availableFloats
      ? expectedCount
      : availableFloats;

  const values = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    values[i] = view.getFloat32(offset + 24 + i * 4, true);
  }

  const unitInfo = getUnitInfo(units);
  return {
    dataType,
    dataTypeName: getDataTypeName(dataType),
    units,
    unitsName: unitInfo.name,
    unitsSymbol: unitInfo.symbol,
    values,
  };
}

function readOriginBlock(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  size: number,
  capacity: number,
  collected: number,
): WdfOriginList[] {
  if (size < 20) return [];
  const count = view.getUint32(offset + 16, true);
  const blockEnd = offset + size;
  const origins: WdfOriginList[] = [];
  let cursor = offset + 20;

  const totalSlots = Math.max(capacity, collected, 1);
  const validCount = Math.max(collected, 0);

  for (let i = 0; i < count; i++) {
    if (cursor + 24 > blockEnd) break;
    const rawType = view.getUint32(cursor, true);
    const isPrimary = (rawType & 0x80000000) !== 0;
    const dataType = (rawType & 0x7fffffff) as WdfDataType;
    const units = view.getUint32(cursor + 4, true) as WdfDataUnits;
    const label = decodeUtf8Trimmed(bytes, cursor + 8, 16);
    cursor += 24;

    const remainingSlots = Math.floor((blockEnd - cursor) / 8);
    const slotsToAdvance = Math.min(totalSlots, remainingSlots);
    const slotsToRead = Math.min(validCount || slotsToAdvance, slotsToAdvance);

    const isFileTime = dataType === WdfDataType.Time || units === WdfDataUnits.FileTime;
    const isInt64 =
      dataType === WdfDataType.Checksum ||
      dataType === WdfDataType.Flags ||
      dataType === WdfDataType.MicroplateLocationIndex;

    const values: Array<number | string> = [];
    for (let s = 0; s < slotsToRead; s++) {
      const pos = cursor + s * 8;
      if (isFileTime) {
        const ft = view.getBigUint64(pos, true);
        values.push(filetimeToIso(ft) ?? ft.toString());
      } else if (isInt64) {
        const raw = view.getBigUint64(pos, true);
        values.push(raw <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(raw) : raw.toString());
      } else {
        values.push(view.getFloat64(pos, true));
      }
    }

    cursor += slotsToAdvance * 8;
    const unitInfo = getUnitInfo(units);

    origins.push({
      dataType,
      dataTypeName: getDataTypeName(dataType),
      isPrimary,
      units,
      unitsName: unitInfo.name,
      unitsSymbol: unitInfo.symbol,
      label,
      values,
    });
  }

  return origins;
}

function readMapAreaBlock(view: DataView, offset: number, size: number): WdfMapArea | null {
  if (size < 64) return null;
  const flags = view.getUint32(offset + 16, true);
  return {
    flags,
    flagNames: decodeBitFlags(flags, WdfMapAreaFlag),
    startPosition: {
      x: view.getFloat32(offset + 24, true),
      y: view.getFloat32(offset + 28, true),
      z: view.getFloat32(offset + 32, true),
    },
    stepSize: {
      x: view.getFloat32(offset + 36, true),
      y: view.getFloat32(offset + 40, true),
      z: view.getFloat32(offset + 44, true),
    },
    count: {
      x: view.getUint32(offset + 48, true),
      y: view.getUint32(offset + 52, true),
      z: view.getUint32(offset + 56, true),
    },
    lineFocusSize: view.getUint32(offset + 60, true),
  };
}

function readMapResultBlock(
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  blockEnd: number,
  uid: number,
  spectraCollected: number,
): { pset: PsetObject; mapResult: WdfMapResult } | null {
  const parsedPset = parsePsetBlockWithEnd(view, bytes, offset + 16, blockEnd);
  if (!parsedPset) return null;

  const { pset, nextOffset } = parsedPset;
  const remaining = blockEnd - nextOffset;
  let values = new Float32Array(0);

  if (remaining >= 8) {
    // Support both legacy PSET float-array trailer ('r', 0x80, key, uint32 count) and
    // standard WiRE MAP trailer (uint64 count followed by Float32 values).
    let floatStart = nextOffset + 8;
    let rawCount = 0;

    if (bytes[nextOffset] === 0x72 && (bytes[nextOffset + 1] & 0x80) !== 0) {
      rawCount = view.getUint32(nextOffset + 4, true);
      floatStart = nextOffset + 8;
    } else {
      const count64 = view.getBigUint64(nextOffset, true);
      rawCount = count64 <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(count64) : 0;
      floatStart = nextOffset + 8;
    }

    const availableFloats = Math.max(0, Math.floor((blockEnd - floatStart) / 4));
    // Clamp to header.spectraCollected when available so uncollected/aborted capacity slots
    // (trailing 0 or NaN padding) never pollute the map plot.
    let targetCount = availableFloats;
    if (rawCount > 0) {
      targetCount = Math.min(targetCount, rawCount);
    }
    if (spectraCollected > 0) {
      targetCount = Math.min(targetCount, spectraCollected);
    }

    const rawValues: number[] = [];
    for (let i = 0; i < targetCount; i++) {
      const v = view.getFloat32(floatStart + i * 4, true);
      if (Number.isFinite(v)) {
        rawValues.push(v);
      } else {
        // Stop at trailing NaN padding in partially collected series
        if (spectraCollected <= 0) break;
        rawValues.push(NaN);
      }
    }
    values = Float32Array.from(rawValues);
  }

  const props = asObject(pset['Properties']);
  const firstLimit = asNumber(props?.['FirstLimit']);
  const secondLimit = asNumber(props?.['SecondLimit']);
  const xListUnitNum = asNumber(props?.['XlistUnit']);
  const xListUnit = xListUnitNum !== null ? (xListUnitNum as WdfDataUnits) : null;
  const xListUnitSymbol = xListUnit !== null ? getUnitInfo(xListUnit).symbol : '';
  const xListTypeNum = asNumber(props?.['XlistType']);
  const xListType = xListTypeNum !== null ? (xListTypeNum as WdfDataType) : null;

  let dataRange: [number, number] | null = null;
  const rawRange = pset['dataRange'];
  if (Array.isArray(rawRange) && rawRange.length >= 2) {
    const r0 = asNumber(rawRange[0]);
    const r1 = asNumber(rawRange[1]);
    if (r0 !== null && r1 !== null) {
      dataRange = [r0, r1];
    }
  }

  const label =
    asString(pset['OperationName']) ??
    asString(pset['Title']) ??
    (firstLimit !== null && secondLimit !== null
      ? `Map Integration (${firstLimit.toFixed(2)} – ${secondLimit.toFixed(2)})`
      : `Map Result #${uid}`);

  return {
    pset,
    mapResult: {
      uid,
      label,
      mapType: asNumber(pset['MapType']),
      analysisType: asNumber(pset['AnalysisType']),
      firstLimit,
      secondLimit,
      xListUnit,
      xListUnitSymbol,
      xListType,
      dataRange,
      values,
      operator: asString(pset['Operator']),
      timestamp: asString(pset['Timestamp']),
      softwareVersion: asString(pset['SoftwareVersion']),
      properties: pset,
    },
  };
}

function readWhiteLightImage(bytes: Uint8Array, offset: number, size: number): WdfWhiteLightImage | null {
  if (size <= 16) return null;
  const payload = bytes.slice(offset + 16, offset + size);
  let mimeType = 'application/octet-stream';
  if (payload.length >= 2 && payload[0] === 0xff && payload[1] === 0xd8) {
    mimeType = 'image/jpeg';
  } else if (payload.length >= 4 && payload[0] === 0x89 && payload[1] === 0x50 && payload[2] === 0x4e && payload[3] === 0x47) {
    mimeType = 'image/png';
  } else if (payload.length >= 2 && payload[0] === 0x42 && payload[1] === 0x4d) {
    mimeType = 'image/bmp';
  }
  return {
    mimeType,
    byteLength: payload.byteLength,
    bytes: payload,
  };
}

function asObject(val: unknown): PsetObject | null {
  if (typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Uint8Array)) {
    return val as PsetObject;
  }
  return null;
}

function asNumber(val: unknown): number | null {
  if (typeof val === 'number' && Number.isFinite(val)) return Object.is(val, -0) ? 0 : val;
  if (typeof val === 'string' && val.trim() !== '') {
    const trimmed = val.trim();
    const direct = Number(trimmed);
    if (Number.isFinite(direct)) return Object.is(direct, -0) ? 0 : direct;
    const match = trimmed.match(/^[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/);
    if (match) {
      const parsed = Number(match[0]);
      if (Number.isFinite(parsed)) return Object.is(parsed, -0) ? 0 : parsed;
    }
  }
  return null;
}

function asString(val: unknown): string | null {
  return typeof val === 'string' && val.trim().length > 0 ? val.trim() : null;
}

/**
 * Recursively find a numeric property by case-insensitive key name in a PSET object.
 */
function findNumericProperty(obj: PsetObject | null, targetKeyLower: string): number | null {
  if (!obj) return null;
  // Prefer direct match on current object first
  for (const [k, v] of Object.entries(obj)) {
    if (k.trim().toLowerCase() === targetKeyLower) {
      const n = asNumber(v);
      if (n !== null) return n;
    }
  }
  // Fall back to searching nested PSET sub-objects
  for (const v of Object.values(obj)) {
    const child = asObject(v);
    if (child) {
      const found = findNumericProperty(child, targetKeyLower);
      if (found !== null) return found;
    }
  }
  return null;
}

function buildInstrumentSummary(
  header: WdfHeader,
  xAxis: WdfAxisList | null,
  spectra: Float32Array,
  comment: string | null,
  propertySets: Record<string, PsetObject>,
): WdfInstrumentSummary {
  const wxda = propertySets[WdfBlockId.WXDA] ?? null;
  const wxis = propertySets[WdfBlockId.WXIS] ?? null;
  const wxdm = propertySets[WdfBlockId.WXDM] ?? null;

  const sysConfig = asObject(wxis?.['System Configuration']);
  const microscope = asObject(wxis?.['Microscope']);
  const slits = asObject(wxis?.['Slits']);
  const stage = asObject(wxis?.['Stage']);
  const podule = asObject(wxis?.['Podule']);
  const serials = asObject(wxis?.['Serial Numbers']);

  const namedItems = asObject(wxdm?.['NamedItems']);
  const scanConfig = asObject(namedItems?.['Scan']);

  let xAxisMin: number | null = null;
  let xAxisMax: number | null = null;
  let peakX: number | null = null;
  let peakIntensity: number | null = null;

  if (xAxis && xAxis.values.length > 0) {
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < xAxis.values.length; i++) {
      const v = xAxis.values[i];
      if (v < minV) minV = v;
      if (v > maxV) maxV = v;
    }
    xAxisMin = minV;
    xAxisMax = maxV;

    const firstLen = Math.min(header.pointsPerSpectrum, spectra.length, xAxis.values.length);
    if (firstLen > 0) {
      let bestIdx = 0;
      let bestVal = spectra[0];
      for (let i = 1; i < firstLen; i++) {
        if (spectra[i] > bestVal) {
          bestVal = spectra[i];
          bestIdx = i;
        }
      }
      peakX = xAxis.values[bestIdx];
      peakIntensity = bestVal;
    }
  }

  const stageX = asNumber(stage?.['X']);
  const stageY = asNumber(stage?.['Y']);
  const stageZ = asNumber(stage?.['Z']);
  const stagePosition =
    stageX !== null && stageY !== null && stageZ !== null
      ? { x: stageX, y: stageY, z: stageZ }
      : null;

  const crrRaw = scanConfig?.['Use Cosmic Ray Remove'];
  const cosmicRayRemoval =
    typeof crrRaw === 'boolean'
      ? crrRaw
      : typeof crrRaw === 'number'
        ? crrRaw !== 0
        : header.flagNames.includes('CosmicRayRemoval')
          ? true
          : null;

  const unitInfo = xAxis
    ? { name: xAxis.unitsName, symbol: xAxis.unitsSymbol }
    : { name: 'Unknown', symbol: '' };

  const instrumentType = asString(wxis?.['Instrument type']);
  const ndTransmissionPercent = asNumber(wxis?.['ND Transmission %']);
  const isVirsa = instrumentType !== null && instrumentType.toLowerCase().includes('virsa');
  const laserPowerMw = isVirsa ? findNumericProperty(wxis, 'laser power mw') : null;
  const effectiveLaserPowerMw =
    isVirsa && laserPowerMw !== null && ndTransmissionPercent !== null
      ? Math.round(laserPowerMw * (ndTransmissionPercent / 100) * 100) / 100
      : null;

  return {
    title: header.title,
    operator: header.operator,
    instrumentType,
    application: `${header.applicationName} ${header.applicationVersion}`.trim(),
    measurementType: header.measurementTypeName,
    scanType: header.scanTypeName,
    completionStatus: asString(wxda?.['ScanCompletionStatus']),
    acquisitionStart: header.timeStart,
    acquisitionEnd: header.timeEnd,
    scanDurationMs: asNumber(wxda?.['ScanDuration(ms)']),
    laserName: asString(sysConfig?.['LaserName']),
    laserWavenumberCm1:
      Number.isFinite(header.laserWavenumber) && header.laserWavenumber > 0
        ? header.laserWavenumber
        : null,
    laserWavelengthNm: header.laserWavelengthNm,
    grating: asString(sysConfig?.['Grating']),
    objective: asString(microscope?.['ObjectiveName']),
    objectiveMagnification: asNumber(microscope?.['ObjectiveMagnification']),
    ndTransmissionPercent,
    laserPowerMw,
    effectiveLaserPowerMw,
    exposureTimeMs: asNumber(scanConfig?.['Exposure Time']),
    accumulations: asNumber(scanConfig?.['Accumulations']) ?? header.accumulations,
    slitOpening: asString(slits?.['Opening']),
    slitBeamCentre: asString(slits?.['SlitBeamCentre']),
    xBinning: asNumber(scanConfig?.['X Binning']),
    yBinning: asNumber(scanConfig?.['y Binning']),
    cosmicRayRemoval,
    centreWavenumber: asNumber(scanConfig?.['Centre Wavenumber']),
    xAxisMin,
    xAxisMax,
    xAxisUnits: unitInfo.name,
    xAxisSymbol: unitInfo.symbol,
    intensityUnits: header.spectralUnitsName,
    pointsPerSpectrum: header.pointsPerSpectrum,
    spectraCollected: header.spectraCollected,
    peakX,
    peakIntensity,
    stagePosition,
    poduleTemperature: asString(podule?.['Podule Temperature']),
    ccdSerialNumber:
      asString(wxda?.['CCD serial number']) ?? asString(serials?.['DetectorSerialNumber']),
    ccdFirmwareVersion: asString(wxda?.['CCD firmware version']),
    spectrometerSerialNumber: asString(serials?.['SpectrometerSerialNumber']),
    originalFilePath: asString(wxdm?.['DataSaveFile']),
    comment,
  };
}

/**
 * Parse a Renishaw WiRE `.wdf` binary buffer into a structured, typed `WdfFile` object.
 *
 * Works identically with Node.js `Buffer` (`fs.readFileSync('sample.wdf')`) and
 * browser `ArrayBuffer` / `Uint8Array` (`await file.arrayBuffer()`).
 */
export function parseWdf(
  input: ArrayBuffer | ArrayBufferView,
  options: WdfParseOptions = {},
): WdfFile {
  const bytes = toUint8Array(input);
  if (bytes.byteLength < 16) {
    throw new Error(`Input too small to be a valid WDF file (${bytes.byteLength} bytes).`);
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const firstMagic = decodeUtf8Trimmed(bytes, 0, 4);
  if (firstMagic !== WDF1_MAGIC) {
    throw new Error(`Not a Renishaw WDF file: expected magic "WDF1" at offset 0, got "${firstMagic}".`);
  }

  let header: WdfHeader | null = null;
  let spectra = new Float32Array(0);
  let xAxis: WdfAxisList | null = null;
  let yAxis: WdfAxisList | null = null;
  let backgroundXAxis: WdfAxisList | null = null;
  let origins: WdfOriginList[] = [];
  let comment: string | null = null;
  let mapArea: WdfMapArea | null = null;
  const maps: WdfMapResult[] = [];
  let whiteLightImage: WdfWhiteLightImage | null = null;
  let measurementScript: string | null = null;

  const propertySets: Record<string, PsetObject> = {};
  const blocks: WdfBlockSummary[] = [];
  const warnings: string[] = [];

  let offset = 0;
  while (offset + 16 <= bytes.byteLength) {
    const id = decodeUtf8Trimmed(bytes, offset, 4);
    const idInt = view.getUint32(offset, true);
    const uid = view.getUint32(offset + 4, true);
    const rawSize = view.getBigUint64(offset + 8, true);
    const size = Number(rawSize);

    if (!Number.isSafeInteger(size) || size < 16) {
      warnings.push(`Stopped parsing at offset ${offset}: invalid block size (${rawSize}).`);
      break;
    }

    const blockEnd = Math.min(offset + size, bytes.byteLength);
    if (offset + size > bytes.byteLength) {
      warnings.push(`Block "${id}" at offset ${offset} extends past EOF (${offset + size} > ${bytes.byteLength}); truncated.`);
    }

    let parsed = false;

    switch (id) {
      case WdfBlockId.WDF1:
        header = readWdf1Header(view, bytes, offset, blockEnd - offset);
        parsed = true;
        break;

      case WdfBlockId.DATA: {
        const dataBytes = blockEnd - (offset + 16);
        const count = Math.floor(dataBytes / 4);
        const expected =
          header && header.spectraCollected > 0 && header.pointsPerSpectrum > 0
            ? Math.min(count, header.spectraCollected * header.pointsPerSpectrum)
            : count;
        spectra = new Float32Array(expected);
        for (let i = 0; i < expected; i++) {
          spectra[i] = view.getFloat32(offset + 16 + i * 4, true);
        }
        parsed = true;
        break;
      }

      case WdfBlockId.XLST:
        xAxis = readAxisBlock(view, offset, blockEnd - offset, header?.xListCount);
        parsed = xAxis !== null;
        break;

      case WdfBlockId.YLST:
        yAxis = readAxisBlock(view, offset, blockEnd - offset, header?.yListCount);
        parsed = yAxis !== null;
        break;

      case WdfBlockId.BKXL:
        backgroundXAxis = readAxisBlock(view, offset, blockEnd - offset);
        parsed = backgroundXAxis !== null;
        break;

      case WdfBlockId.ORGN:
        origins = readOriginBlock(
          view,
          bytes,
          offset,
          blockEnd - offset,
          header?.capacity ?? 1,
          header?.spectraCollected ?? 1,
        );
        parsed = true;
        break;

      case WdfBlockId.TEXT:
        comment = decodeUtf8Trimmed(bytes, offset + 16, blockEnd - (offset + 16));
        parsed = true;
        break;

      case WdfBlockId.WMAP:
        mapArea = readMapAreaBlock(view, offset, blockEnd - offset);
        parsed = mapArea !== null;
        break;

      case WdfBlockId.WHTL:
        whiteLightImage = readWhiteLightImage(bytes, offset, blockEnd - offset);
        parsed = whiteLightImage !== null;
        break;

      case WdfBlockId.MAP: {
        const res = readMapResultBlock(
          view,
          bytes,
          offset,
          blockEnd,
          uid,
          header?.spectraCollected ?? 0,
        );
        if (res !== null) {
          maps.push(res.mapResult);
          const psetKey = id in propertySets ? `${id}#${uid}` : id;
          propertySets[psetKey] = res.pset;
          parsed = true;
        }
        break;
      }

      default: {
        // Attempt PSET decoding for WXDA, WXDM, WXCS, WXIS, ZLDC, WXDB, and custom PSET blocks
        const pset = parsePsetBlock(view, bytes, offset + 16, blockEnd);
        if (pset !== null) {
          if (id === WdfBlockId.WXDM && typeof pset['MeasurementScript'] === 'string') {
            if (options.includeScript) {
              measurementScript = pset['MeasurementScript'];
            }
            const charCount = pset['MeasurementScript'].length;
            pset['MeasurementScript'] = `<VBScript ${charCount.toLocaleString()} chars — omitted from property tree>`;
          }
          const psetKey = id in propertySets ? `${id}#${uid}` : id;
          propertySets[psetKey] = pset;
          parsed = true;
        }
        break;
      }
    }

    blocks.push({
      id,
      idHex: `0x${idInt.toString(16).toUpperCase().padStart(8, '0')}`,
      uid,
      offset,
      size: blockEnd - offset,
      description: WDF_BLOCK_DESCRIPTIONS[id] ?? `Custom / Unrecognized Block (${id})`,
      parsed,
    });

    offset += size;
  }

  if (!header) {
    throw new Error('WDF1 header block was not found.');
  }

  // Optionally normalize descending X axis (e.g. standard WiRE Raman shift lists) to ascending order
  if (options.sortXAscending && xAxis && xAxis.values.length > 1 && xAxis.values[0] > xAxis.values[xAxis.values.length - 1]) {
    xAxis.values.reverse();
    const pts = header.pointsPerSpectrum;
    if (pts > 0 && spectra.length >= pts) {
      const count = Math.floor(spectra.length / pts);
      for (let s = 0; s < count; s++) {
        spectra.subarray(s * pts, (s + 1) * pts).reverse();
      }
    }
  }

  const summary = buildInstrumentSummary(header, xAxis, spectra, comment, propertySets);

  return {
    byteLength: bytes.byteLength,
    header,
    summary,
    xAxis,
    yAxis,
    backgroundXAxis,
    spectra,
    origins,
    comment,
    mapArea,
    maps,
    whiteLightImage,
    propertySets,
    measurementScript,
    blocks,
    warnings,
  };
}

/**
 * Convenience browser helper to parse a `File` or `Blob` directly.
 */
export async function parseWdfFile(file: Blob, options?: WdfParseOptions): Promise<WdfFile> {
  const buffer = await file.arrayBuffer();
  return parseWdf(buffer, options);
}

/**
 * Extract a single spectrum (by 0-based index) from a parsed `WdfFile`.
 */
export function getSpectrum(wdf: WdfFile, index = 0): Float32Array {
  const pts = wdf.header.pointsPerSpectrum;
  if (pts <= 0 || wdf.spectra.length === 0) {
    return new Float32Array(0);
  }
  const maxIndex = Math.max(0, Math.floor(wdf.spectra.length / pts) - 1);
  const safeIndex = Math.max(0, Math.min(index, maxIndex));
  return wdf.spectra.subarray(safeIndex * pts, (safeIndex + 1) * pts);
}

export type SpectralTargetUnit =
  | 'native'
  | 'ramanShift'
  | 'wavenumber'
  | 'nanometre'
  | 'electronVolt';

/**
 * Convert a spectrum's X-axis values between Raman Shift (cm⁻¹), Absolute Wavenumber (cm⁻¹),
 * Wavelength (nm), and Photon Energy (eV) using the file's recorded laser wavenumber.
 */
export function convertXAxis(
  xAxis: WdfAxisList,
  laserWavenumber: number,
  target: SpectralTargetUnit,
): { values: Float64Array; label: string; symbol: string } {
  const src = xAxis.values;
  const out = new Float64Array(src.length);

  if (target === 'native') {
    for (let i = 0; i < src.length; i++) out[i] = src[i];
    return { values: out, label: xAxis.unitsName, symbol: xAxis.unitsSymbol };
  }

  const canConvert =
    Number.isFinite(laserWavenumber) &&
    laserWavenumber > 0 &&
    (xAxis.units === WdfDataUnits.RamanShift ||
      xAxis.units === WdfDataUnits.Wavenumber ||
      xAxis.units === WdfDataUnits.Nanometre ||
      xAxis.units === WdfDataUnits.ElectronVolt);

  if (!canConvert) {
    for (let i = 0; i < src.length; i++) out[i] = src[i];
    return { values: out, label: xAxis.unitsName, symbol: xAxis.unitsSymbol };
  }

  for (let i = 0; i < src.length; i++) {
    const v = src[i];
    // Step 1: convert source value to absolute wavenumber (cm^-1)
    let absWn: number;
    switch (xAxis.units) {
      case WdfDataUnits.RamanShift:
        absWn = laserWavenumber - v;
        break;
      case WdfDataUnits.Wavenumber:
        absWn = v;
        break;
      case WdfDataUnits.Nanometre:
        absWn = v !== 0 ? 1e7 / v : 0;
        break;
      case WdfDataUnits.ElectronVolt:
        absWn = v / HC_EV_CM;
        break;
      default:
        absWn = v;
    }

    // Step 2: convert absolute wavenumber to requested target unit
    switch (target) {
      case 'ramanShift':
        out[i] = laserWavenumber - absWn;
        break;
      case 'wavenumber':
        out[i] = absWn;
        break;
      case 'nanometre':
        out[i] = absWn !== 0 ? 1e7 / absWn : 0;
        break;
      case 'electronVolt':
        out[i] = absWn * HC_EV_CM;
        break;
    }
  }

  const labels: Record<Exclude<SpectralTargetUnit, 'native'>, { label: string; symbol: string }> = {
    ramanShift: { label: 'Raman Shift', symbol: 'cm⁻¹' },
    wavenumber: { label: 'Absolute Wavenumber', symbol: 'cm⁻¹' },
    nanometre: { label: 'Wavelength', symbol: 'nm' },
    electronVolt: { label: 'Photon Energy', symbol: 'eV' },
  };

  return { values: out, ...labels[target] };
}

export type IntegrationMode = 'signalToBaseline' | 'totalArea';

export interface ComputedIntegrationMap {
  values: Float32Array;
  fromX: number;
  toX: number;
  mode: IntegrationMode;
  unitLabel: string;
  unitSymbol: string;
}

/**
 * Compute integrated area under the curve across all collected spectra in a WDF file
 * between `fromX` and `toX`.
 *
 * - `'signalToBaseline'` (default): matches Renishaw WiRE's "Signal To Baseline" algorithm —
 *   trapezoidal integration of `(y(x) - linearBaseline(x))` over the clipped interval `[lo, hi]`
 *   with linearly interpolated endpoints `y(lo)` and `y(hi)`.
 * - `'totalArea'`: trapezoidal area under `y(x)` above `y = 0` over `[lo, hi]`.
 */
export function computeSignalToBaselineMap(
  wdf: WdfFile,
  fromX: number,
  toX: number,
  options: { targetUnit?: SpectralTargetUnit; mode?: IntegrationMode } = {},
): ComputedIntegrationMap {
  const mode: IntegrationMode = options.mode ?? 'signalToBaseline';
  const pts = wdf.header.pointsPerSpectrum;
  const totalSpectra = pts > 0 ? Math.floor(wdf.spectra.length / pts) : 0;

  if (!wdf.xAxis || pts <= 1 || totalSpectra <= 0) {
    return {
      values: new Float32Array(0),
      fromX: Math.min(fromX, toX),
      toX: Math.max(fromX, toX),
      mode,
      unitLabel: wdf.xAxis?.unitsName ?? 'X',
      unitSymbol: wdf.xAxis?.unitsSymbol ?? '',
    };
  }

  const converted = convertXAxis(
    wdf.xAxis,
    wdf.header.laserWavenumber,
    options.targetUnit ?? 'native',
  );
  const n = Math.min(converted.values.length, pts);

  // Build ascending X ordering once and reuse across every collected scan
  const order = new Int32Array(n);
  for (let i = 0; i < n; i++) order[i] = i;
  order.sort((a, b) => converted.values[a] - converted.values[b]);

  const sortedX = new Float64Array(n);
  for (let i = 0; i < n; i++) sortedX[i] = converted.values[order[i]];

  const lo = Math.min(fromX, toX);
  const hi = Math.max(fromX, toX);
  const out = new Float32Array(totalSpectra);

  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo || hi <= sortedX[0] || lo >= sortedX[n - 1]) {
    return {
      values: out,
      fromX: lo,
      toX: hi,
      mode,
      unitLabel: converted.label,
      unitSymbol: converted.symbol,
    };
  }

  // Clamp requested integration limits to available X domain
  const effLo = Math.max(lo, sortedX[0]);
  const effHi = Math.min(hi, sortedX[n - 1]);
  const span = effHi - effLo;
  if (span <= 0) {
    return {
      values: out,
      fromX: effLo,
      toX: effHi,
      mode,
      unitLabel: converted.label,
      unitSymbol: converted.symbol,
    };
  }

  // Locate interpolation bracket for effLo and effHi once
  const findBracket = (target: number): { i0: number; i1: number; t: number } => {
    if (target <= sortedX[0]) return { i0: 0, i1: 0, t: 0 };
    if (target >= sortedX[n - 1]) return { i0: n - 1, i1: n - 1, t: 0 };
    let left = 0;
    let right = n - 1;
    while (right - left > 1) {
      const mid = (left + right) >> 1;
      if (sortedX[mid] <= target) left = mid;
      else right = mid;
    }
    const dx = sortedX[right] - sortedX[left];
    const t = dx > 0 ? (target - sortedX[left]) / dx : 0;
    return { i0: left, i1: right, t };
  };

  const bLo = findBracket(effLo);
  const bHi = findBracket(effHi);

  // Interior sorted indices strictly inside (effLo, effHi)
  let firstInner = bLo.i0;
  while (firstInner < n && sortedX[firstInner] <= effLo) firstInner++;
  let lastInner = bHi.i1;
  while (lastInner >= 0 && sortedX[lastInner] >= effHi) lastInner--;

  for (let s = 0; s < totalSpectra; s++) {
    const baseOffset = s * pts;
    const yAtSorted = (si: number) => wdf.spectra[baseOffset + order[si]];

    const yLo = yAtSorted(bLo.i0) + bLo.t * (yAtSorted(bLo.i1) - yAtSorted(bLo.i0));
    const yHi = yAtSorted(bHi.i0) + bHi.t * (yAtSorted(bHi.i1) - yAtSorted(bHi.i0));

    let totalTrap = 0;
    let prevX = effLo;
    let prevY = yLo;

    for (let si = firstInner; si <= lastInner; si++) {
      const curX = sortedX[si];
      const curY = yAtSorted(si);
      totalTrap += 0.5 * (prevY + curY) * (curX - prevX);
      prevX = curX;
      prevY = curY;
    }
    totalTrap += 0.5 * (prevY + yHi) * (effHi - prevX);

    if (mode === 'signalToBaseline') {
      // Exact integral of straight-line baseline between (effLo, yLo) and (effHi, yHi)
      const baselineArea = 0.5 * (yLo + yHi) * span;
      out[s] = totalTrap - baselineArea;
    } else {
      out[s] = totalTrap;
    }
  }

  return {
    values: out,
    fromX: effLo,
    toX: effHi,
    mode,
    unitLabel: converted.label,
    unitSymbol: converted.symbol,
  };
}

function computePeakFwhm(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  peakIndex: number,
  n: number,
): number | null {
  const peakY = yValues[peakIndex];
  if (!Number.isFinite(peakY) || peakY <= 0) return null;

  const halfMax = peakY / 2;

  // Walk left to find half-maximum crossing and linearly interpolate X
  let leftX: number | null = null;
  for (let i = peakIndex - 1; i >= 0; i--) {
    const yCurr = yValues[i];
    if (yCurr <= halfMax) {
      const yNext = yValues[i + 1];
      const denom = yNext - yCurr;
      const frac = denom !== 0 ? (halfMax - yCurr) / denom : 0;
      leftX = xValues[i] + frac * (xValues[i + 1] - xValues[i]);
      break;
    }
  }

  // Walk right to find half-maximum crossing and linearly interpolate X
  let rightX: number | null = null;
  for (let i = peakIndex + 1; i < n; i++) {
    const yCurr = yValues[i];
    if (yCurr <= halfMax) {
      const yPrev = yValues[i - 1];
      const denom = yPrev - yCurr;
      const frac = denom !== 0 ? (halfMax - yCurr) / denom : 0;
      rightX = xValues[i] + frac * (xValues[i - 1] - xValues[i]);
      break;
    }
  }

  if (leftX === null || rightX === null) return null;
  const width = Math.abs(rightX - leftX);
  return Number.isFinite(width) ? width : null;
}

/**
 * Simple local-maxima peak finder with prominence, minimum spacing filter,
 * and linearly interpolated Full Width at Half Maximum (FWHM).
 */
export function detectPeaks(
  xValues: ArrayLike<number>,
  yValues: ArrayLike<number>,
  maxPeaks = 6,
  minSpacingIndices = 12,
): WdfPeak[] {
  const n = Math.min(xValues.length, yValues.length);
  if (n < 5) return [];

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    if (yValues[i] < minY) minY = yValues[i];
    if (yValues[i] > maxY) maxY = yValues[i];
  }
  const range = maxY - minY;
  if (range <= 0) return [];
  const threshold = minY + range * 0.08;

  const candidates: WdfPeak[] = [];
  for (let i = 2; i < n - 2; i++) {
    const y = yValues[i];
    if (
      y >= threshold &&
      y >= yValues[i - 1] &&
      y > yValues[i + 1] &&
      y >= yValues[i - 2] &&
      y >= yValues[i + 2]
    ) {
      candidates.push({
        index: i,
        x: xValues[i],
        intensity: y,
        fwhm: computePeakFwhm(xValues, yValues, i, n),
      });
    }
  }

  candidates.sort((a, b) => b.intensity - a.intensity);

  const selected: WdfPeak[] = [];
  for (const c of candidates) {
    if (selected.length >= maxPeaks) break;
    if (selected.every((p) => Math.abs(p.index - c.index) >= minSpacingIndices)) {
      selected.push(c);
    }
  }

  return selected.sort((a, b) => a.x - b.x);
}

/**
 * Export a single spectrum (or all collected spectra) to RFC-4180 CSV text.
 */
export function wdfToCsv(
  wdf: WdfFile,
  options: { spectrumIndex?: number; sortAscending?: boolean; targetUnit?: SpectralTargetUnit } = {},
): string {
  if (!wdf.xAxis) {
    throw new Error('WDF file has no X-axis (XLST) block.');
  }

  const spectrumIndex = options.spectrumIndex ?? 0;
  const converted = convertXAxis(
    wdf.xAxis,
    wdf.header.laserWavenumber,
    options.targetUnit ?? 'native',
  );
  const y = getSpectrum(wdf, spectrumIndex);
  const n = Math.min(converted.values.length, y.length);

  const pairs: Array<{ x: number; y: number }> = [];
  for (let i = 0; i < n; i++) {
    pairs.push({ x: converted.values[i], y: y[i] });
  }
  if (options.sortAscending) {
    pairs.sort((a, b) => a.x - b.x);
  }

  const xHeader = converted.symbol
    ? `${converted.label} (${converted.symbol})`
    : converted.label;
  const yHeader = `Intensity (${wdf.header.spectralUnitsName})`;
  const lines = [`"${xHeader}","${yHeader}"`];

  for (const pt of pairs) {
    lines.push(`${pt.x.toFixed(6)},${pt.y.toFixed(6)}`);
  }
  return lines.join('\n');
}

/**
 * Solve symmetric positive-definite pentadiagonal system `A z = b` in O(n) time
 * using exact banded LDL^T factorization.
 */
function solvePentadiagonalSpd(
  a0: Float64Array,
  a1: Float64Array,
  a2: Float64Array,
  b: Float64Array,
): Float64Array {
  const n = a0.length;
  const diag = new Float64Array(n);
  const l1 = new Float64Array(n);
  const l2 = new Float64Array(n);
  const u = new Float64Array(n);
  const z = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    let v = a0[i];
    if (i >= 1) v -= l1[i - 1] * l1[i - 1] * diag[i - 1];
    if (i >= 2) v -= l2[i - 2] * l2[i - 2] * diag[i - 2];
    diag[i] = v > 1e-18 ? v : 1e-18;

    if (i + 1 < n) {
      let s1 = a1[i];
      if (i >= 1) s1 -= l1[i - 1] * l2[i - 1] * diag[i - 1];
      l1[i] = s1 / diag[i];
    }
    if (i + 2 < n) {
      l2[i] = a2[i] / diag[i];
    }
  }

  // Forward substitution L u = b
  for (let i = 0; i < n; i++) {
    let s = b[i];
    if (i >= 1) s -= l1[i - 1] * u[i - 1];
    if (i >= 2) s -= l2[i - 2] * u[i - 2];
    u[i] = s;
  }

  // Diagonal scaling + backward substitution L^T z = D^-1 u
  for (let i = n - 1; i >= 0; i--) {
    let s = u[i] / diag[i];
    if (i + 1 < n) s -= l1[i] * z[i + 1];
    if (i + 2 < n) s -= l2[i] * z[i + 2];
    z[i] = s;
  }

  return z;
}

/**
 * Automatic Raman baseline correction using Asymmetric Least Squares (AsLS, Eilers & Boelens 2005).
 * Removes broad fluorescence backgrounds and sloping drift while preserving sharp Raman peaks.
 */
export function subtractBaseline(
  yValues: ArrayLike<number>,
  options: BaselineOptions = {},
): BaselineResult {
  const n = yValues.length;
  const baseline = new Float64Array(n);
  const corrected = new Float64Array(n);

  if (n === 0) {
    return { baseline, corrected };
  }

  if (n < 5) {
    let minVal = Infinity;
    for (let i = 0; i < n; i++) {
      if (yValues[i] < minVal) minVal = yValues[i];
    }
    for (let i = 0; i < n; i++) {
      baseline[i] = minVal;
      corrected[i] = yValues[i] - minVal;
    }
    return { baseline, corrected };
  }

  const lambda = options.lambda ?? 1e5;
  const p = options.p ?? 0.005;
  const iterations = Math.max(1, Math.min(30, options.iterations ?? 10));

  // Precompute 2nd-difference penalty matrix λ * D^T D diagonals
  const d0 = new Float64Array(n);
  const d1 = new Float64Array(n);
  const d2 = new Float64Array(n);

  for (let i = 0; i < n; i++) {
    if (i === 0 || i === n - 1) d0[i] = 1 * lambda;
    else if (i === 1 || i === n - 2) d0[i] = 5 * lambda;
    else d0[i] = 6 * lambda;
  }
  for (let i = 0; i < n - 1; i++) {
    d1[i] = (i === 0 || i === n - 2 ? -2 : -4) * lambda;
  }
  for (let i = 0; i < n - 2; i++) {
    d2[i] = 1 * lambda;
  }

  const weights = new Float64Array(n).fill(1);
  const a0 = new Float64Array(n);
  const rhs = new Float64Array(n);
  let z: Float64Array = new Float64Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    for (let i = 0; i < n; i++) {
      const w = weights[i];
      a0[i] = w + d0[i];
      rhs[i] = w * yValues[i];
    }

    z = solvePentadiagonalSpd(a0, d1, d2, rhs);

    for (let i = 0; i < n; i++) {
      weights[i] = yValues[i] > z[i] ? p : 1 - p;
    }
  }

  for (let i = 0; i < n; i++) {
    baseline[i] = z[i];
    corrected[i] = yValues[i] - z[i];
  }

  return { baseline, corrected };
}

/**
 * Fully automatic Raman baseline correction that analyzes the spectrum's lower-envelope
 * fluorescence curvature and high-frequency noise level, then adaptively tunes AsLS (λ, p)
 * to flatten background drift and reveal subtle Raman peaks without manual tweaking.
 */
export function autoSubtractBaseline(yValues: ArrayLike<number>): AutoBaselineResult {
  const n = yValues.length;
  if (n < 16) {
    const res = subtractBaseline(yValues, { lambda: 1e5, p: 0.005, iterations: 10 });
    return { ...res, lambda: 1e5, p: 0.005, profile: 'Flat' };
  }

  let minY = Infinity;
  let maxY = -Infinity;
  for (let i = 0; i < n; i++) {
    const v = yValues[i];
    if (v < minY) minY = v;
    if (v > maxY) maxY = v;
  }
  const totalSpan = Math.max(maxY - minY, 1e-6);

  // Sample coarse lower envelope across 12 segments using 15th percentile to ignore sharp peaks
  const segCount = Math.min(12, Math.max(6, Math.floor(n / 40)));
  const segSize = Math.floor(n / segCount);
  const env: number[] = [];
  for (let s = 0; s < segCount; s++) {
    const start = s * segSize;
    const end = s === segCount - 1 ? n : start + segSize;
    const slice: number[] = [];
    for (let i = start; i < end; i++) slice.push(yValues[i]);
    slice.sort((a, b) => a - b);
    const idx = Math.floor(slice.length * 0.15);
    env.push(slice[idx]);
  }

  let envMin = Infinity;
  let envMax = -Infinity;
  for (const v of env) {
    if (v < envMin) envMin = v;
    if (v > envMax) envMax = v;
  }
  const bgSpan = envMax - envMin;
  let maxEnvCurv = 0;
  for (let i = 1; i < env.length - 1; i++) {
    const c = Math.abs(env[i + 1] - 2 * env[i] + env[i - 1]);
    if (c > maxEnvCurv) maxEnvCurv = c;
  }

  // Estimate high-frequency noise via 2nd-difference MAD
  const sqrt6 = Math.sqrt(6);
  const d2: number[] = [];
  for (let i = 1; i < n - 1; i++) {
    d2.push((yValues[i + 1] - 2 * yValues[i] + yValues[i - 1]) / sqrt6);
  }
  d2.sort((a, b) => a - b);
  const medD2 = d2[Math.floor(d2.length / 2)] ?? 0;
  const absDev = d2.map((v) => Math.abs(v - medD2)).sort((a, b) => a - b);
  const noiseSigma = 1.4826 * (absDev[Math.floor(absDev.length / 2)] ?? 0);

  const fluorescenceRatio = bgSpan / totalSpan;
  const curvatureRatio = bgSpan > 1e-6 ? maxEnvCurv / bgSpan : 0;
  const noiseRatio = noiseSigma / totalSpan;

  // Scale smoothness lambda with spectrum length so bandwidth is consistent across CCD sizes
  const lenScale = Math.pow(n / 1000, 4);
  let baseLambda: number;
  let p: number;
  let profile: AutoBaselineResult['profile'];

  if (fluorescenceRatio > 0.25 || (fluorescenceRatio > 0.12 && curvatureRatio > 0.22)) {
    // Strong or curved fluorescence background: tighter smoothing to track hump closely
    profile = 'Fluorescent';
    baseLambda = fluorescenceRatio > 0.5 ? 2e4 : 4e4;
    p = noiseRatio > 0.025 ? 0.006 : 0.003;
  } else if (fluorescenceRatio > 0.07) {
    // Moderate sloping or broad drift
    profile = 'Moderate';
    baseLambda = 1.2e5;
    p = noiseRatio > 0.025 ? 0.008 : 0.004;
  } else {
    // Flat / low-background spectrum: keep baseline very stiff so weak peaks stay intact
    profile = 'Flat';
    baseLambda = 6e5;
    p = noiseRatio > 0.02 ? 0.01 : 0.006;
  }

  const lambda = Math.max(5e3, Math.min(5e6, Math.round(baseLambda * lenScale)));
  const res = subtractBaseline(yValues, { lambda, p, iterations: 12 });
  return { ...res, lambda, p, profile };
}
