/**
 * Pure Windows Registry (.reg / .rrg) & Renishaw WiRE COM Variant parser.
 *
 * Framework-agnostic, zero external dependencies, strict TypeScript.
 * Preserves both raw source representations and normalized typed values.
 */

import { decodeRegistryInput, decodeUtf16LeRawBytes } from './decoder';
import {
  ComVariantTypeCode,
  type ComVariantTypeName,
  type ParsedRegistry,
  type ParseRegistryOptions,
  type RegistryDiagnostic,
  type RegistryEntry,
  type RegistryFormatVersion,
  type RegistryInput,
  type RegistrySection,
  type RegistryTreeNode,
  type RegistryValue,
  type WireVariantValue,
} from './types';

const OLE_EPOCH_UTC_MS = Date.UTC(1899, 11, 30, 0, 0, 0, 0);
const MS_PER_DAY = 86_400_000;

const VARIANT_NAME_LOOKUP: Readonly<Record<number, ComVariantTypeName>> = {
  [ComVariantTypeCode.VT_EMPTY]: 'VT_EMPTY',
  [ComVariantTypeCode.VT_NULL]: 'VT_NULL',
  [ComVariantTypeCode.VT_I2]: 'VT_I2',
  [ComVariantTypeCode.VT_I4]: 'VT_I4',
  [ComVariantTypeCode.VT_R4]: 'VT_R4',
  [ComVariantTypeCode.VT_R8]: 'VT_R8',
  [ComVariantTypeCode.VT_CY]: 'VT_CY',
  [ComVariantTypeCode.VT_DATE]: 'VT_DATE',
  [ComVariantTypeCode.VT_BSTR]: 'VT_BSTR',
  [ComVariantTypeCode.VT_DISPATCH]: 'VT_DISPATCH',
  [ComVariantTypeCode.VT_ERROR]: 'VT_ERROR',
  [ComVariantTypeCode.VT_BOOL]: 'VT_BOOL',
  [ComVariantTypeCode.VT_VARIANT]: 'VT_VARIANT',
  [ComVariantTypeCode.VT_UNKNOWN]: 'VT_UNKNOWN',
  [ComVariantTypeCode.VT_I1]: 'VT_I1',
  [ComVariantTypeCode.VT_UI1]: 'VT_UI1',
  [ComVariantTypeCode.VT_UI2]: 'VT_UI2',
  [ComVariantTypeCode.VT_UI4]: 'VT_UI4',
  [ComVariantTypeCode.VT_INT]: 'VT_INT',
  [ComVariantTypeCode.VT_UINT]: 'VT_UINT',
};

/**
 * Normalizes a registry path into a canonical lowercase lookup key with
 * collapsed single backslashes and no leading/trailing slashes.
 */
export function normalizeRegistryPath(path: string): string {
  return path
    .trim()
    .replace(/\//g, '\\')
    .replace(/\\+/g, '\\')
    .replace(/^\\+|\\+$/g, '')
    .toLowerCase();
}

/**
 * Normalizes a registry value name for case-insensitive lookup.
 * Empty string or `"@"` both resolve to `"@"`.
 */
export function normalizeEntryName(name: string): string {
  if (name === '' || name === '@') {
    return '@';
  }
  return name.toLowerCase();
}

/**
 * Returns the canonical COM `VT_*` name for a numeric type code.
 */
export function getComVariantTypeName(code: number): ComVariantTypeName {
  const known = VARIANT_NAME_LOOKUP[code];
  if (known) {
    return known;
  }
  return `VT_0x${(code >>> 0).toString(16)}`;
}

/**
 * Converts an OLE Automation DATE serial number (days since 1899-12-30 UTC)
 * to an ISO-8601 UTC timestamp string, or `null` if non-finite.
 */
export function oleDateToIsoString(oleDate: number): string | null {
  if (!Number.isFinite(oleDate)) {
    return null;
  }
  const wholeDays = Math.trunc(oleDate);
  const fractionalDay = Math.abs(oleDate - wholeDays);
  const ms = OLE_EPOCH_UTC_MS + wholeDays * MS_PER_DAY + Math.round(fractionalDay * MS_PER_DAY);
  const date = new Date(ms);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

interface ParsedQuotedResult {
  readonly value: string;
  readonly endIndex: number;
  readonly terminated: boolean;
}

function parseQuotedString(input: string, startIndex: number): ParsedQuotedResult {
  let i = startIndex + 1; // skip opening quote
  let out = '';

  while (i < input.length) {
    const ch = input[i];
    if (ch === '\\' && i + 1 < input.length) {
      const next = input[i + 1];
      if (next === '\\' || next === '"') {
        out += next;
        i += 2;
        continue;
      }
      // Preserve unrecognized escape sequences verbatim (e.g. legacy unescaped paths)
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '"') {
      return { value: out, endIndex: i + 1, terminated: true };
    }
    out += ch;
    i += 1;
  }

  return { value: out, endIndex: i, terminated: false };
}

function parseHexByteList(
  payload: string,
  line: number,
  endLine: number,
  rawLine: string,
  sectionPath: string,
  diagnostics: RegistryDiagnostic[],
): number[] {
  const trimmed = payload.trim();
  if (trimmed === '') {
    return [];
  }

  const tokens = trimmed.split(',');
  const bytes: number[] = [];
  let hasInvalid = false;

  for (const token of tokens) {
    const clean = token.trim();
    if (clean === '') {
      continue;
    }
    if (!/^[0-9a-fA-F]{1,2}$/.test(clean)) {
      hasInvalid = true;
      continue;
    }
    bytes.push(Number.parseInt(clean, 16));
  }

  if (hasInvalid) {
    diagnostics.push({
      severity: 'error',
      code: 'INVALID_HEX_BYTES',
      message: `Malformed hex byte sequence in value payload.`,
      line,
      endLine,
      rawLine,
      sectionPath,
    });
  }

  return bytes;
}

function decodeAnsiBytes(bytes: readonly number[]): string {
  const chars: string[] = [];
  for (let i = 0; i < bytes.length; i += 1) {
    chars.push(String.fromCharCode(bytes[i] & 0xff));
  }
  return chars.join('');
}

function decodeExpandStringBytes(
  bytes: readonly number[],
  formatVersion: RegistryFormatVersion,
): string {
  const decoded =
    formatVersion === 'regedit4' ? decodeAnsiBytes(bytes) : decodeUtf16LeRawBytes(bytes);
  const firstNul = decoded.indexOf('\0');
  return firstNul === -1 ? decoded : decoded.slice(0, firstNul);
}

function decodeMultiStringBytes(
  bytes: readonly number[],
  formatVersion: RegistryFormatVersion,
): string[] {
  const decoded =
    formatVersion === 'regedit4' ? decodeAnsiBytes(bytes) : decodeUtf16LeRawBytes(bytes);
  const stripped = decoded.replace(/\0+$/, '');
  if (stripped === '') {
    return [];
  }
  return stripped.split('\0');
}

function parseRegistryValue(
  rawRhs: string,
  formatVersion: RegistryFormatVersion,
  line: number,
  endLine: number,
  rawLine: string,
  sectionPath: string,
  diagnostics: RegistryDiagnostic[],
): RegistryValue {
  const rhs = rawRhs.trim();

  if (rhs === '-') {
    return { kind: 'DELETE', raw: rhs };
  }

  if (rhs.startsWith('"')) {
    const parsed = parseQuotedString(rhs, 0);
    if (!parsed.terminated) {
      diagnostics.push({
        severity: 'error',
        code: 'UNTERMINATED_STRING',
        message: 'Unterminated quoted string value.',
        line,
        endLine,
        rawLine,
        sectionPath,
      });
    } else if (rhs.slice(parsed.endIndex).trim() !== '') {
      diagnostics.push({
        severity: 'warning',
        code: 'MALFORMED_VALUE_LINE',
        message: `Unexpected trailing characters after quoted string value: ${rhs.slice(parsed.endIndex).trim()}`,
        line,
        endLine,
        rawLine,
        sectionPath,
      });
    }
    return { kind: 'REG_SZ', raw: rhs, value: parsed.value };
  }

  const lower = rhs.toLowerCase();

  if (lower.startsWith('dword:')) {
    const hexPart = rhs.slice(6).trim();
    if (!/^[0-9a-fA-F]{1,8}$/.test(hexPart)) {
      diagnostics.push({
        severity: 'error',
        code: 'INVALID_DWORD',
        message: `Invalid DWORD hexadecimal value "${hexPart}". Expected 1 to 8 hex digits.`,
        line,
        endLine,
        rawLine,
        sectionPath,
      });
      return { kind: 'UNKNOWN', raw: rhs, prefix: 'dword' };
    }
    const unsigned = Number.parseInt(hexPart, 16) >>> 0;
    const signed = unsigned | 0;
    return {
      kind: 'REG_DWORD',
      raw: rhs,
      value: unsigned,
      signedValue: signed,
      hex: hexPart.toLowerCase().padStart(8, '0'),
    };
  }

  if (lower.startsWith('hex:')) {
    const bytes = parseHexByteList(rhs.slice(4), line, endLine, rawLine, sectionPath, diagnostics);
    return { kind: 'REG_BINARY', raw: rhs, bytes };
  }

  const hexTypedMatch = /^hex\(([0-9a-fA-F]+)\):([\s\S]*)$/i.exec(rhs);
  if (hexTypedMatch) {
    const typeCode = Number.parseInt(hexTypedMatch[1], 16);
    const bytes = parseHexByteList(
      hexTypedMatch[2],
      line,
      endLine,
      rawLine,
      sectionPath,
      diagnostics,
    );

    if (typeCode === 0x0) {
      return { kind: 'REG_NONE', raw: rhs, bytes };
    }
    if (typeCode === 0x2) {
      return {
        kind: 'REG_EXPAND_SZ',
        raw: rhs,
        value: decodeExpandStringBytes(bytes, formatVersion),
        bytes,
      };
    }
    if (typeCode === 0x7) {
      return {
        kind: 'REG_MULTI_SZ',
        raw: rhs,
        values: decodeMultiStringBytes(bytes, formatVersion),
        bytes,
      };
    }
    if (typeCode === 0xb) {
      if (bytes.length !== 8) {
        diagnostics.push({
          severity: 'error',
          code: 'INVALID_QWORD',
          message: `Expected 8 bytes for REG_QWORD (hex(b)), found ${bytes.length}.`,
          line,
          endLine,
          rawLine,
          sectionPath,
        });
        return { kind: 'REG_BINARY', raw: rhs, typeCode, bytes };
      }
      let qword = 0n;
      for (let i = 7; i >= 0; i -= 1) {
        qword = (qword << 8n) | BigInt(bytes[i]);
      }
      return { kind: 'REG_QWORD', raw: rhs, value: qword, bytes };
    }

    return { kind: 'REG_BINARY', raw: rhs, typeCode, bytes };
  }

  const colonIdx = rhs.indexOf(':');
  const prefix = colonIdx > 0 ? rhs.slice(0, colonIdx) : undefined;
  diagnostics.push({
    severity: 'error',
    code: 'UNKNOWN_VALUE_TYPE',
    message: `Unrecognized registry value syntax: "${rhs.slice(0, 48)}".`,
    line,
    endLine,
    rawLine,
    sectionPath,
  });
  return { kind: 'UNKNOWN', raw: rhs, prefix };
}

function decodeWireVariant(
  entryMap: Readonly<Record<string, RegistryEntry>>,
  sectionPath: string,
  sectionLine: number,
  diagnostics: RegistryDiagnostic[],
): WireVariantValue | null {
  const typeEntry = entryMap['__type__'];
  if (!typeEntry || typeEntry.value.kind !== 'REG_DWORD') {
    return null;
  }

  const typeCode = typeEntry.value.value;
  const typeName = getComVariantTypeName(typeCode);
  const valueEntry = entryMap['__value__'];
  const defaultEntry = entryMap['@'];
  const rawVal = valueEntry ? valueEntry.value : null;

  switch (typeCode) {
    case ComVariantTypeCode.VT_EMPTY:
    case ComVariantTypeCode.VT_NULL:
      return {
        kind: 'empty',
        typeCode,
        typeName,
        raw: rawVal,
        value: null,
      };

    case ComVariantTypeCode.VT_DISPATCH:
    case ComVariantTypeCode.VT_UNKNOWN: {
      const clsid =
        defaultEntry && defaultEntry.value.kind === 'REG_SZ' ? defaultEntry.value.value : null;
      return {
        kind: 'com-object',
        typeCode,
        typeName,
        raw: defaultEntry ? defaultEntry.value : rawVal,
        clsid,
      };
    }

    case ComVariantTypeCode.VT_VARIANT: {
      const isArrayMarker =
        defaultEntry?.value.kind === 'REG_SZ' &&
        defaultEntry.value.value.trim().toLowerCase() === 'array';
      const nElementsEntry = entryMap['nelements'];
      const cDimsEntry = entryMap['cdims'];

      if (isArrayMarker || nElementsEntry || cDimsEntry) {
        const elementCount =
          nElementsEntry?.value.kind === 'REG_DWORD' ? nElementsEntry.value.value : null;
        const dimensions = cDimsEntry?.value.kind === 'REG_DWORD' ? cDimsEntry.value.value : null;

        const dimPairs: Array<{ idx: number; bound: string }> = [];
        for (const [key, entry] of Object.entries(entryMap)) {
          const dimMatch = /^d(\d+)$/.exec(key);
          if (dimMatch && entry.value.kind === 'REG_SZ') {
            dimPairs.push({ idx: Number.parseInt(dimMatch[1], 10), bound: entry.value.value });
          }
        }
        dimPairs.sort((a, b) => a.idx - b.idx);

        return {
          kind: 'com-array',
          typeCode,
          typeName,
          raw: defaultEntry ? defaultEntry.value : rawVal,
          elementCount,
          dimensions,
          dimensionBounds: dimPairs.map((d) => d.bound),
        };
      }
      return {
        kind: 'unknown',
        typeCode,
        typeName,
        raw: rawVal,
        value: defaultEntry?.value.kind === 'REG_SZ' ? defaultEntry.value.value : null,
      };
    }

    case ComVariantTypeCode.VT_BSTR: {
      if (rawVal && rawVal.kind === 'REG_SZ') {
        return {
          kind: 'string',
          typeCode,
          typeName,
          raw: rawVal,
          value: rawVal.value,
        };
      }
      if (rawVal && rawVal.kind === 'REG_DWORD') {
        return {
          kind: 'string',
          typeCode,
          typeName,
          raw: rawVal,
          value: String(rawVal.value),
        };
      }
      return {
        kind: 'unknown',
        typeCode,
        typeName,
        raw: rawVal,
        value: null,
      };
    }

    case ComVariantTypeCode.VT_BOOL: {
      if (rawVal && rawVal.kind === 'REG_DWORD') {
        return {
          kind: 'boolean',
          typeCode,
          typeName,
          raw: rawVal,
          value: rawVal.value !== 0,
          rawFlag: rawVal.value,
        };
      }
      if (rawVal && rawVal.kind === 'REG_SZ') {
        const lower = rawVal.value.trim().toLowerCase();
        const isTrue = lower === 'true' || lower === '-1' || lower === '1';
        return {
          kind: 'boolean',
          typeCode,
          typeName,
          raw: rawVal,
          value: isTrue,
          rawFlag: isTrue ? 1 : 0,
        };
      }
      return { kind: 'unknown', typeCode, typeName, raw: rawVal, value: null };
    }

    case ComVariantTypeCode.VT_I1:
    case ComVariantTypeCode.VT_I2:
    case ComVariantTypeCode.VT_I4:
    case ComVariantTypeCode.VT_INT: {
      if (rawVal && rawVal.kind === 'REG_DWORD') {
        let signed = rawVal.signedValue;
        if (typeCode === ComVariantTypeCode.VT_I1) {
          signed = (rawVal.value << 24) >> 24;
        } else if (typeCode === ComVariantTypeCode.VT_I2) {
          signed = (rawVal.value << 16) >> 16;
        }
        return {
          kind: 'number',
          typeCode,
          typeName,
          raw: rawVal,
          value: signed,
          numericFormat: 'signed-int',
        };
      }
      if (rawVal && rawVal.kind === 'REG_SZ') {
        const parsed = Number.parseInt(rawVal.value.trim(), 10);
        if (Number.isFinite(parsed)) {
          return {
            kind: 'number',
            typeCode,
            typeName,
            raw: rawVal,
            value: parsed,
            numericFormat: 'signed-int',
          };
        }
      }
      return { kind: 'unknown', typeCode, typeName, raw: rawVal, value: null };
    }

    case ComVariantTypeCode.VT_UI1:
    case ComVariantTypeCode.VT_UI2:
    case ComVariantTypeCode.VT_UI4:
    case ComVariantTypeCode.VT_UINT: {
      if (rawVal && rawVal.kind === 'REG_DWORD') {
        let unsigned = rawVal.value >>> 0;
        if (typeCode === ComVariantTypeCode.VT_UI1) {
          unsigned = rawVal.value & 0xff;
        } else if (typeCode === ComVariantTypeCode.VT_UI2) {
          unsigned = rawVal.value & 0xffff;
        }
        return {
          kind: 'number',
          typeCode,
          typeName,
          raw: rawVal,
          value: unsigned,
          numericFormat: 'unsigned-int',
        };
      }
      if (rawVal && rawVal.kind === 'REG_SZ') {
        const parsed = Number.parseInt(rawVal.value.trim(), 10);
        if (Number.isFinite(parsed) && parsed >= 0) {
          return {
            kind: 'number',
            typeCode,
            typeName,
            raw: rawVal,
            value: parsed,
            numericFormat: 'unsigned-int',
          };
        }
      }
      return { kind: 'unknown', typeCode, typeName, raw: rawVal, value: null };
    }

    case ComVariantTypeCode.VT_R4:
    case ComVariantTypeCode.VT_R8: {
      if (rawVal && rawVal.kind === 'REG_SZ') {
        const trimmed = rawVal.value.trim();
        const parsed = Number(trimmed);
        if (trimmed !== '' && Number.isFinite(parsed)) {
          return {
            kind: 'number',
            typeCode,
            typeName,
            raw: rawVal,
            value: parsed,
            numericFormat: 'float',
          };
        }
        diagnostics.push({
          severity: 'warning',
          code: 'VARIANT_DECODE_WARNING',
          message: `Unable to decode ${typeName} float from "${rawVal.value}".`,
          line: valueEntry ? valueEntry.line : sectionLine,
          sectionPath,
        });
      } else if (rawVal && rawVal.kind === 'REG_DWORD') {
        return {
          kind: 'number',
          typeCode,
          typeName,
          raw: rawVal,
          value: rawVal.value,
          numericFormat: 'float',
        };
      }
      return {
        kind: 'unknown',
        typeCode,
        typeName,
        raw: rawVal,
        value: rawVal && rawVal.kind === 'REG_SZ' ? rawVal.value : null,
      };
    }

    case ComVariantTypeCode.VT_DATE: {
      if (rawVal && rawVal.kind === 'REG_SZ') {
        const trimmed = rawVal.value.trim();
        const oleDate = Number(trimmed);
        if (trimmed !== '' && Number.isFinite(oleDate)) {
          return {
            kind: 'date',
            typeCode,
            typeName,
            raw: rawVal,
            oleDate,
            isoString: oleDateToIsoString(oleDate),
          };
        }
        diagnostics.push({
          severity: 'warning',
          code: 'VARIANT_DECODE_WARNING',
          message: `Unable to decode OLE VT_DATE from "${rawVal.value}".`,
          line: valueEntry ? valueEntry.line : sectionLine,
          sectionPath,
        });
      }
      return {
        kind: 'unknown',
        typeCode,
        typeName,
        raw: rawVal,
        value: rawVal && rawVal.kind === 'REG_SZ' ? rawVal.value : null,
      };
    }

    default: {
      const fallback =
        rawVal?.kind === 'REG_SZ'
          ? rawVal.value
          : rawVal?.kind === 'REG_DWORD'
            ? rawVal.value
            : null;
      return {
        kind: 'unknown',
        typeCode,
        typeName,
        raw: rawVal,
        value: fallback,
      };
    }
  }
}

interface MutableSection {
  readonly path: string;
  readonly normalizedPath: string;
  readonly segments: readonly string[];
  readonly hive: string;
  readonly name: string;
  readonly parentPath: string | null;
  readonly isDeletion: boolean;
  readonly line: number;
  readonly entries: RegistryEntry[];
  readonly entryMap: Record<string, RegistryEntry>;
}

interface MutableTreeNode {
  name: string;
  path: string;
  normalizedPath: string;
  section: RegistrySection | null;
  children: Map<string, MutableTreeNode>;
}

function finalizeTreeNode(node: MutableTreeNode): RegistryTreeNode {
  const sortedChildren = [...node.children.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map(finalizeTreeNode);

  let descendantSectionCount = 0;
  for (const child of sortedChildren) {
    descendantSectionCount += (child.section ? 1 : 0) + child.descendantSectionCount;
  }

  return {
    name: node.name,
    path: node.path,
    normalizedPath: node.normalizedPath,
    section: node.section,
    children: sortedChildren,
    descendantSectionCount,
  };
}

function buildRegistryTree(sections: readonly RegistrySection[]): readonly RegistryTreeNode[] {
  const roots = new Map<string, MutableTreeNode>();

  for (const section of sections) {
    let currentMap = roots;
    let accumulatedPath = '';

    for (let i = 0; i < section.segments.length; i += 1) {
      const seg = section.segments[i];
      accumulatedPath = i === 0 ? seg : `${accumulatedPath}\\${seg}`;
      const norm = accumulatedPath.toLowerCase();

      let node = currentMap.get(norm);
      if (!node) {
        node = {
          name: seg,
          path: accumulatedPath,
          normalizedPath: norm,
          section: null,
          children: new Map(),
        };
        currentMap.set(norm, node);
      }

      if (i === section.segments.length - 1) {
        node.section = section;
      }

      currentMap = node.children;
    }
  }

  return [...roots.values()]
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
    .map(finalizeTreeNode);
}

function isContinuationLineCandidate(line: string): boolean {
  const trimmed = line.trimEnd();
  if (!trimmed.endsWith('\\')) {
    return false;
  }
  // Do not treat quoted strings that happen to end in `\"` as line continuations
  const eqIndex = trimmed.indexOf('=');
  if (eqIndex === -1) {
    return false;
  }
  const rhs = trimmed.slice(eqIndex + 1).trimStart();
  if (rhs.startsWith('"')) {
    return false;
  }
  return true;
}

/**
 * Parses a Windows Registry (.reg / .rrg) file from string or raw binary bytes
 * into a structured, strongly-typed `ParsedRegistry` document with diagnostics.
 */
export function parseRegistry(
  input: RegistryInput,
  options: ParseRegistryOptions = {},
): ParsedRegistry {
  const decoded = decodeRegistryInput(input);
  const buildTree = options.buildTree ?? true;
  const decodeVariants = options.decodeWireVariants ?? true;

  const diagnostics: RegistryDiagnostic[] = [];
  const rawLines = decoded.text.split(/\r\n|\n|\r/);

  let nonEmptyLines = 0;
  let commentLines = 0;
  let headerLine: string | null = null;
  let formatVersion: RegistryFormatVersion = 'unknown';
  let sawAnyContent = false;
  let headerChecked = false;

  const mutableSections: MutableSection[] = [];
  const mutableByPath: Record<string, MutableSection> = Object.create(null);
  let currentSection: MutableSection | null = null;

  for (let i = 0; i < rawLines.length; i += 1) {
    const lineNum = i + 1;
    const rawLine = rawLines[i];
    const trimmed = rawLine.trim();

    if (trimmed === '') {
      continue;
    }

    nonEmptyLines += 1;

    if (trimmed.startsWith(';')) {
      commentLines += 1;
      continue;
    }

    sawAnyContent = true;

    // Detect registry header on first non-comment, non-blank line
    if (!headerChecked) {
      headerChecked = true;
      if (/^Windows Registry Editor Version 5\.00$/i.test(trimmed)) {
        headerLine = trimmed;
        formatVersion = 'regedit5';
        continue;
      }
      if (/^REGEDIT4$/i.test(trimmed)) {
        headerLine = trimmed;
        formatVersion = 'regedit4';
        continue;
      }
      if (trimmed.startsWith('[')) {
        diagnostics.push({
          severity: 'warning',
          code: 'MISSING_HEADER',
          message:
            'Registry file is missing a standard header (expected "Windows Registry Editor Version 5.00" or "REGEDIT4").',
          line: lineNum,
          rawLine,
        });
        // Fall through to parse this line as a section header
      } else if (!trimmed.includes('=')) {
        headerLine = trimmed;
        diagnostics.push({
          severity: 'warning',
          code: 'UNRECOGNIZED_HEADER',
          message: `Unrecognized registry header "${trimmed}". Expected "Windows Registry Editor Version 5.00" or "REGEDIT4".`,
          line: lineNum,
          rawLine,
        });
        continue;
      } else {
        diagnostics.push({
          severity: 'warning',
          code: 'MISSING_HEADER',
          message: 'Registry file is missing a standard header before value entries.',
          line: lineNum,
          rawLine,
        });
      }
    }

    // Section header: [HKEY_...] or [-HKEY_...]
    if (trimmed.startsWith('[')) {
      if (!trimmed.endsWith(']')) {
        diagnostics.push({
          severity: 'error',
          code: 'MALFORMED_SECTION_HEADER',
          message: 'Section header is missing a closing "]" bracket.',
          line: lineNum,
          rawLine,
        });
        currentSection = null;
        continue;
      }

      const inner = trimmed.slice(1, -1).trim();
      const isDeletion = inner.startsWith('-');
      const rawPath = (isDeletion ? inner.slice(1) : inner).trim();
      const cleanedPath = rawPath.replace(/\\+/g, '\\').replace(/^\\+|\\+$/g, '');

      if (cleanedPath === '') {
        diagnostics.push({
          severity: 'error',
          code: 'EMPTY_SECTION_PATH',
          message: 'Section header contains an empty registry key path.',
          line: lineNum,
          rawLine,
        });
        currentSection = null;
        continue;
      }

      const segments = cleanedPath.split('\\');
      const normalizedPath = normalizeRegistryPath(cleanedPath);
      const existing = mutableByPath[normalizedPath];

      if (existing) {
        diagnostics.push({
          severity: 'warning',
          code: 'DUPLICATE_SECTION',
          message: `Duplicate section header "[${cleanedPath}]" (previously declared at line ${existing.line}); merging entries.`,
          line: lineNum,
          rawLine,
          sectionPath: cleanedPath,
        });
        currentSection = existing;
      } else {
        const parentPath =
          segments.length > 1
            ? normalizeRegistryPath(segments.slice(0, -1).join('\\'))
            : null;
        const created: MutableSection = {
          path: cleanedPath,
          normalizedPath,
          segments,
          hive: segments[0],
          name: segments[segments.length - 1],
          parentPath,
          isDeletion,
          line: lineNum,
          entries: [],
          entryMap: Object.create(null),
        };
        mutableSections.push(created);
        mutableByPath[normalizedPath] = created;
        currentSection = created;
      }
      continue;
    }

    // Value entry line (possibly multi-line via trailing `\`)
    let combinedLine = trimmed;
    let endLineNum = lineNum;
    const rawSlice: string[] = [rawLine];

    if (isContinuationLineCandidate(combinedLine)) {
      combinedLine = combinedLine.slice(0, -1);
      while (i + 1 < rawLines.length) {
        i += 1;
        endLineNum = i + 1;
        const contRaw = rawLines[i];
        rawSlice.push(contRaw);
        const contTrimmed = contRaw.trim();
        if (contTrimmed !== '') {
          nonEmptyLines += 1;
        }
        if (contTrimmed.endsWith('\\')) {
          combinedLine += contTrimmed.slice(0, -1);
        } else {
          combinedLine += contTrimmed;
          break;
        }
      }
    }

    const joinedRawText = rawSlice.join('\n');

    if (!currentSection) {
      diagnostics.push({
        severity: 'error',
        code: 'ORPHAN_VALUE_ENTRY',
        message: 'Value entry appeared outside of any valid section header.',
        line: lineNum,
        endLine: endLineNum,
        rawLine: joinedRawText,
      });
      continue;
    }

    // Parse LHS name and '=' separator
    let entryName: string;
    let isDefault: boolean;
    let rhsStartIndex: number;

    if (combinedLine.startsWith('@')) {
      const rest = combinedLine.slice(1).trimStart();
      if (!rest.startsWith('=')) {
        diagnostics.push({
          severity: 'error',
          code: 'MALFORMED_VALUE_LINE',
          message: 'Expected "=" after default value marker "@".',
          line: lineNum,
          endLine: endLineNum,
          rawLine: joinedRawText,
          sectionPath: currentSection.path,
        });
        continue;
      }
      entryName = '';
      isDefault = true;
      rhsStartIndex = combinedLine.indexOf('=') + 1;
    } else if (combinedLine.startsWith('"')) {
      const parsedName = parseQuotedString(combinedLine, 0);
      if (!parsedName.terminated) {
        diagnostics.push({
          severity: 'error',
          code: 'UNTERMINATED_STRING',
          message: 'Unterminated quoted value name.',
          line: lineNum,
          endLine: endLineNum,
          rawLine: joinedRawText,
          sectionPath: currentSection.path,
        });
        continue;
      }
      const afterName = combinedLine.slice(parsedName.endIndex);
      const eqOffset = afterName.search(/=/);
      if (eqOffset === -1 || afterName.slice(0, eqOffset).trim() !== '') {
        diagnostics.push({
          severity: 'error',
          code: 'MALFORMED_VALUE_LINE',
          message: `Expected "=" immediately after value name "${parsedName.value}".`,
          line: lineNum,
          endLine: endLineNum,
          rawLine: joinedRawText,
          sectionPath: currentSection.path,
        });
        continue;
      }
      entryName = parsedName.value;
      isDefault = false;
      rhsStartIndex = parsedName.endIndex + eqOffset + 1;
    } else {
      diagnostics.push({
        severity: 'error',
        code: 'MALFORMED_VALUE_LINE',
        message: `Unrecognized line inside section "[${currentSection.path}]": expected "@=..." or "\\"Name\\"=...".`,
        line: lineNum,
        endLine: endLineNum,
        rawLine: joinedRawText,
        sectionPath: currentSection.path,
      });
      continue;
    }

    const rhsRaw = combinedLine.slice(rhsStartIndex);
    const parsedValue = parseRegistryValue(
      rhsRaw,
      formatVersion,
      lineNum,
      endLineNum,
      joinedRawText,
      currentSection.path,
      diagnostics,
    );

    const normalizedName = isDefault ? '@' : normalizeEntryName(entryName);
    const entry: RegistryEntry = {
      name: entryName,
      isDefault,
      normalizedName,
      value: parsedValue,
      line: lineNum,
      endLine: endLineNum,
      rawText: joinedRawText,
    };

    if (currentSection.entryMap[normalizedName]) {
      const prev = currentSection.entryMap[normalizedName];
      diagnostics.push({
        severity: 'warning',
        code: 'DUPLICATE_VALUE',
        message: `Duplicate value "${isDefault ? '@' : entryName}" in section "[${currentSection.path}]" (overrides line ${prev.line}).`,
        line: lineNum,
        endLine: endLineNum,
        rawLine: joinedRawText,
        sectionPath: currentSection.path,
      });
    }

    currentSection.entries.push(entry);
    currentSection.entryMap[normalizedName] = entry;
  }

  if (!sawAnyContent) {
    diagnostics.push({
      severity: 'warning',
      code: 'EMPTY_INPUT',
      message: 'Registry input is empty or contains only comments and whitespace.',
      line: 1,
    });
  }

  // Finalize sections & optionally decode Renishaw WiRE COM variants
  const sections: RegistrySection[] = [];
  const sectionsByPath: Record<string, RegistrySection> = Object.create(null);
  let deletionSectionCount = 0;
  let entryCount = 0;
  let variantSectionCount = 0;

  for (const ms of mutableSections) {
    const variant = decodeVariants
      ? decodeWireVariant(ms.entryMap, ms.path, ms.line, diagnostics)
      : null;
    if (variant) {
      variantSectionCount += 1;
    }
    if (ms.isDeletion) {
      deletionSectionCount += 1;
    }
    entryCount += ms.entries.length;

    const section: RegistrySection = {
      path: ms.path,
      normalizedPath: ms.normalizedPath,
      segments: ms.segments,
      hive: ms.hive,
      name: ms.name,
      parentPath: ms.parentPath,
      isDeletion: ms.isDeletion,
      line: ms.line,
      entries: ms.entries,
      entryMap: ms.entryMap,
      variant,
    };

    sections.push(section);
    sectionsByPath[section.normalizedPath] = section;
  }

  const tree = buildTree ? buildRegistryTree(sections) : [];

  let errorCount = 0;
  let warningCount = 0;
  for (const diag of diagnostics) {
    if (diag.severity === 'error') {
      errorCount += 1;
    } else if (diag.severity === 'warning') {
      warningCount += 1;
    }
  }

  return {
    sourceName: options.sourceName ?? null,
    encoding: decoded.encoding,
    formatVersion,
    headerLine,
    sections,
    sectionsByPath,
    tree,
    diagnostics,
    stats: {
      totalLines: rawLines.length,
      nonEmptyLines,
      commentLines,
      sectionCount: sections.length,
      deletionSectionCount,
      entryCount,
      variantSectionCount,
      errorCount,
      warningCount,
    },
  };
}
