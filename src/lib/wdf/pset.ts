/**
 * Binary decoder for Renishaw WiRE PSET (Property Set) structures.
 *
 * Renishaw PSET binary encoding:
 *   [4 bytes]  "PSET" magic (0x54455350)
 *   [4 bytes]  psetPayloadSize (uint32 LE)
 *   [entries]  Repeated until psetPayloadSize consumed:
 *     [1 byte]  type char: '?' bool, 'c' int8, 's' int16, 'i' int32, 'w' int64,
 *                          'r' float32, 'q' float64, 't' FILETIME, 'u' UTF-8 string,
 *                          'b' binary blob, 'k' custom key name, 'p' nested PSET
 *     [1 byte]  flags (0x80 = array, 0x40 = compressed)
 *     [2 bytes] key ID (uint16 LE; < 0x8000 built-in, >= 0x8000 custom via 'k')
 *     [payload] Type-dependent little-endian value
 *
 * Key dictionaries ('k' entries) in a parent PSET are inherited by nested child PSETs
 * (crucial for WXDM where keys are defined at the root PSET and used inside Scan/InstrumentState).
 */

import type { PsetObject, PsetValue } from './types';

const PSET_MAGIC = 0x54455350; // "PSET"
const FILETIME_EPOCH_DIFF = 116444736000000000n;
const textDecoder = new TextDecoder('utf-8');

/** Well-known built-in Renishaw PSET key IDs (< 0x8000). */
export const KNOWN_PSET_KEYS: Record<number, string> = {
  0x0002: 'ErrorCode',
  0x0003: 'CreationTime',
  0x0006: 'ETA',
  0x0007: 'WizardCLSID',
  0x0009: 'AcquisitionCount',
  0x000d: 'MeasurementType',
  0x000e: 'ResponseCalibration',
  0x000f: 'RestoreInstrumentState',
  0x0010: 'CloseLaserShutter',
  0x00ca: 'DepthSeriesStartPos',
  0x012d: 'ScanCompletionStatus',
  0x012e: 'ScanCompletionCode',
  0x0193: 'Properties',
  0x019b: 'OperationName',
  0x01ae: 'Operator',
  0x01af: 'Timestamp',
  0x01b0: 'SoftwareVersion',
  0x03e9: 'Title',
  0x03ea: 'Description',
  0x03eb: 'ScriptLanguage',
  0x03ec: 'MeasurementScript',
  0x03ed: 'DataSaveMode',
  0x03ee: 'SaveFolder',
  0x03ef: 'DataFileFormat',
  0x03f0: 'AutoSave',
  0x03f1: 'DataSaveFile',
  0x03f3: 'NamedItems',
  0x03f5: 'AreaKey',
  0x03f6: 'InstrumentState',
  0x03f7: 'LaserKey',
  0x03f8: 'BeamPath',
  0x03f9: 'FocusModeKey',
  0x03fa: 'GratingKey',
  0x03fb: 'LaserName',
  0x03fc: 'DetectorSerialNumber',
  0x03fd: 'SpectrometerSerialNumber',
  0x03fe: 'ObjectiveMagnification',
  0x03ff: 'ObjectiveName',
};

export function filetimeToIso(filetime: bigint): string | null {
  if (filetime <= FILETIME_EPOCH_DIFF) {
    return null;
  }
  const ms = Number((filetime - FILETIME_EPOCH_DIFF) / 10000n);
  if (!Number.isFinite(ms) || ms < 0 || ms > 8.64e15) {
    return null;
  }
  const d = new Date(ms);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

export function decodeUtf8Trimmed(bytes: Uint8Array, start: number, length: number): string {
  const slice = bytes.subarray(start, start + length);
  return textDecoder.decode(slice).replace(/\0+$/, '');
}

interface RawPsetEntry {
  typeChar: string;
  key: number;
  value: RawPsetValue;
}

type RawPsetValue = PsetValue | { readonly __rawPset: RawPsetNode };

interface RawPsetNode {
  entries: RawPsetEntry[];
  keyNames: Map<number, string>;
}

function readSingleValue(
  typeChar: string,
  view: DataView,
  bytes: Uint8Array,
  offset: number,
  end: number,
): { value: RawPsetValue; nextOffset: number } | null {
  switch (typeChar) {
    case '?':
      if (offset + 1 > end) return null;
      return { value: bytes[offset] !== 0, nextOffset: offset + 1 };
    case 'c':
      if (offset + 1 > end) return null;
      return { value: view.getInt8(offset), nextOffset: offset + 1 };
    case 's':
      if (offset + 2 > end) return null;
      return { value: view.getInt16(offset, true), nextOffset: offset + 2 };
    case 'i':
      if (offset + 4 > end) return null;
      return { value: view.getInt32(offset, true), nextOffset: offset + 4 };
    case 'w': {
      if (offset + 8 > end) return null;
      const big = view.getBigInt64(offset, true);
      const asNum =
        big >= BigInt(Number.MIN_SAFE_INTEGER) && big <= BigInt(Number.MAX_SAFE_INTEGER)
          ? Number(big)
          : big.toString();
      return { value: asNum, nextOffset: offset + 8 };
    }
    case 'r':
      if (offset + 4 > end) return null;
      return { value: view.getFloat32(offset, true), nextOffset: offset + 4 };
    case 'q':
      if (offset + 8 > end) return null;
      return { value: view.getFloat64(offset, true), nextOffset: offset + 8 };
    case 't': {
      if (offset + 8 > end) return null;
      const ft = view.getBigUint64(offset, true);
      return { value: filetimeToIso(ft) ?? ft.toString(), nextOffset: offset + 8 };
    }
    case 'u': {
      if (offset + 4 > end) return null;
      const len = view.getUint32(offset, true);
      if (offset + 4 + len > end) return null;
      const str = decodeUtf8Trimmed(bytes, offset + 4, len);
      return { value: str, nextOffset: offset + 4 + len };
    }
    case 'b': {
      if (offset + 4 > end) return null;
      const len = view.getUint32(offset, true);
      if (offset + 4 + len > end) return null;
      const blob = bytes.slice(offset + 4, offset + 4 + len);
      return { value: blob, nextOffset: offset + 4 + len };
    }
    case 'p': {
      if (offset + 4 > end) return null;
      const len = view.getUint32(offset, true);
      if (offset + 4 + len > end) return null;
      const nested = parsePsetRaw(view, bytes, offset + 4, offset + 4 + len);
      return { value: { __rawPset: nested }, nextOffset: offset + 4 + len };
    }
    default:
      return null;
  }
}

function parsePsetRaw(
  view: DataView,
  bytes: Uint8Array,
  start: number,
  end: number,
): RawPsetNode {
  const entries: RawPsetEntry[] = [];
  const keyNames = new Map<number, string>();
  let offset = start;

  while (offset + 4 <= end) {
    const typeChar = String.fromCharCode(bytes[offset]);
    const flags = bytes[offset + 1];
    const key = view.getUint16(offset + 2, true);
    offset += 4;

    if (typeChar === 'k') {
      if (offset + 4 > end) break;
      const len = view.getUint32(offset, true);
      if (offset + 4 + len > end) break;
      const keyName = decodeUtf8Trimmed(bytes, offset + 4, len);
      keyNames.set(key, keyName);
      offset += 4 + len;
      continue;
    }

    // Compressed item flag (0x40): skip safely by reading compressed length header
    if ((flags & 0x40) !== 0) {
      if (offset + 4 > end) break;
      const compLen = view.getUint32(offset, true);
      if (offset + 4 + compLen > end) break;
      entries.push({
        typeChar,
        key,
        value: `<compressed ${compLen} bytes>`,
      });
      offset += 4 + compLen;
      continue;
    }

    // Array item flag (0x80)
    if ((flags & 0x80) !== 0) {
      if (offset + 4 > end) break;
      const count = view.getUint32(offset, true);
      offset += 4;
      const items: RawPsetValue[] = [];
      let failed = false;
      for (let i = 0; i < count; i++) {
        const res = readSingleValue(typeChar, view, bytes, offset, end);
        if (!res) {
          failed = true;
          break;
        }
        items.push(res.value);
        offset = res.nextOffset;
      }
      entries.push({ typeChar, key, value: items as PsetValue });
      if (failed) break;
      continue;
    }

    const res = readSingleValue(typeChar, view, bytes, offset, end);
    if (!res) break;
    entries.push({ typeChar, key, value: res.value });
    offset = res.nextOffset;
  }

  return { entries, keyNames };
}

function isRawPsetWrapper(val: unknown): val is { readonly __rawPset: RawPsetNode } {
  return typeof val === 'object' && val !== null && '__rawPset' in val;
}

function resolveKeyName(key: number, keyNames: Map<number, string>): string {
  const custom = keyNames.get(key);
  if (custom) {
    // Renishaw occasionally writes Cyrillic 'с' (U+0441) in "сlsid" — normalize to ASCII "clsid"
    return custom.replace(/^\u0441lsid$/i, 'clsid');
  }
  const known = KNOWN_PSET_KEYS[key];
  if (known) return known;
  return `0x${key.toString(16).padStart(4, '0')}`;
}

function resolveRawValue(val: RawPsetValue, mergedKeys: Map<number, string>): PsetValue {
  if (isRawPsetWrapper(val)) {
    return resolvePsetNode(val.__rawPset, mergedKeys);
  }
  if (Array.isArray(val)) {
    return val.map((item) => resolveRawValue(item as RawPsetValue, mergedKeys));
  }
  return val;
}

/**
 * Unpacks COM PropertyBag patterns (`_nitems` + `_key0` / value pairs) while preserving all fields.
 */
function resolvePsetNode(node: RawPsetNode, inheritedKeys: Map<number, string>): PsetObject {
  const mergedKeys = new Map<number, string>(inheritedKeys);
  for (const [k, v] of node.keyNames.entries()) {
    mergedKeys.set(k, v);
  }

  const resolvedList = node.entries.map((entry) => ({
    name: resolveKeyName(entry.key, mergedKeys),
    value: resolveRawValue(entry.value, mergedKeys),
  }));

  // Detect COM PropertyBag dictionary pattern: has `_nitems` and `_key0`
  const hasPropertyBag =
    resolvedList.some((e) => e.name === '_nitems') &&
    resolvedList.some((e) => e.name === '_key0');

  const out: PsetObject = {};

  if (hasPropertyBag) {
    for (let i = 0; i < resolvedList.length; i++) {
      const current = resolvedList[i];
      if (/^_key\d+$/.test(current.name) && typeof current.value === 'string' && i + 1 < resolvedList.length) {
        const next = resolvedList[i + 1];
        out[current.value] = next.value;
        i += 1; // consume paired value entry
      } else if (current.name !== '_nitems' && current.name !== 'clsid') {
        out[current.name] = current.value;
      }
    }
    return out;
  }

  for (const item of resolvedList) {
    if (item.name in out) {
      const existing = out[item.name];
      if (Array.isArray(existing)) {
        existing.push(item.value);
      } else {
        out[item.name] = [existing, item.value];
      }
    } else {
      out[item.name] = item.value;
    }
  }

  return out;
}

/**
 * Parse a PSET block payload starting at `payloadOffset` (where "PSET" magic begins).
 * Returns null if the "PSET" magic header is not present.
 */
export function parsePsetBlock(
  view: DataView,
  bytes: Uint8Array,
  payloadOffset: number,
  blockEnd: number,
): PsetObject | null {
  if (payloadOffset + 8 > blockEnd) return null;
  const magic = view.getUint32(payloadOffset, true);
  if (magic !== PSET_MAGIC) return null;

  const psetSize = view.getUint32(payloadOffset + 4, true);
  const psetStart = payloadOffset + 8;
  const psetEnd = Math.min(psetStart + psetSize, blockEnd);

  const rawTree = parsePsetRaw(view, bytes, psetStart, psetEnd);
  return resolvePsetNode(rawTree, new Map());
}
