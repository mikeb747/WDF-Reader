/**
 * Pure query, normalization, and domain extraction helpers over ParsedRegistry.
 *
 * Designed to tolerate variations across Renishaw WiRE versions, WOW6432Node
 * paths, System0/System1 indices, and alternative collection layouts.
 */

import { normalizeEntryName, normalizeRegistryPath } from './parser';
import type {
  CalibrationStateSummary,
  DetectorReadoutMode,
  DetectorRecord,
  GratingCalibrationTrack,
  GratingRecord,
  InstrumentFamily,
  LaserCalibrationRecord,
  MotorRecord,
  ParsedRegistry,
  RegistryAnalysisSummary,
  RegistryEntry,
  RegistrySection,
  RegistryValue,
  SystemCalibrationState,
  SystemMetadataSummary,
  SystemQueryOptions,
  WireSystemRoot,
  WireVariantValue,
} from './types';

// ---------------------------------------------------------------------------
// Generic Query Helpers
// ---------------------------------------------------------------------------

/** Looks up a registry section by path (case-insensitive, slash-normalized). */
export function getSection(doc: ParsedRegistry, path: string): RegistrySection | null {
  return doc.sectionsByPath[normalizeRegistryPath(path)] ?? null;
}

/** Looks up a specific entry inside a section (use `""` or `"@"` for default value). */
export function getEntry(
  doc: ParsedRegistry,
  sectionPath: string,
  entryName: string,
): RegistryEntry | null {
  const section = getSection(doc, sectionPath);
  if (!section) {
    return null;
  }
  return section.entryMap[normalizeEntryName(entryName)] ?? null;
}

/**
 * Returns the decoded Renishaw WiRE COM variant value at a section path, or
 * falls back to reading `"__value__"` directly if `__type__` is omitted.
 */
export function getWireString(doc: ParsedRegistry, sectionPath: string): string | null {
  const section = getSection(doc, sectionPath);
  if (!section) {
    return null;
  }
  if (section.variant) {
    if (section.variant.kind === 'string') {
      return section.variant.value;
    }
    if (section.variant.kind === 'number') {
      return String(section.variant.value);
    }
    if (section.variant.kind === 'date') {
      return section.variant.isoString ?? String(section.variant.oleDate);
    }
    if (section.variant.kind === 'com-object') {
      return section.variant.clsid;
    }
    if (section.variant.kind === 'com-array') {
      return `Array[${section.variant.elementCount ?? '?'}]`;
    }
  }
  const valEntry = section.entryMap['__value__'];
  if (!valEntry) {
    return null;
  }
  if (valEntry.value.kind === 'REG_SZ' || valEntry.value.kind === 'REG_EXPAND_SZ') {
    return valEntry.value.value;
  }
  if (valEntry.value.kind === 'REG_DWORD') {
    return String(valEntry.value.value);
  }
  return null;
}

/**
 * Extracts a numeric value from a WiRE section (supports VT_R4/VT_R8 string
 * floats, signed/unsigned DWORD variants, or fallback numeric strings).
 */
export function getWireNumber(doc: ParsedRegistry, sectionPath: string): number | null {
  const section = getSection(doc, sectionPath);
  if (!section) {
    return null;
  }
  if (section.variant) {
    if (section.variant.kind === 'number') {
      return section.variant.value;
    }
    if (section.variant.kind === 'string') {
      const trimmed = section.variant.value.trim();
      if (trimmed === '') {
        return null;
      }
      const parsed = Number(trimmed);
      return Number.isFinite(parsed) ? parsed : null;
    }
  }
  const valEntry = section.entryMap['__value__'];
  if (!valEntry) {
    return null;
  }
  if (valEntry.value.kind === 'REG_DWORD') {
    return valEntry.value.signedValue;
  }
  if (valEntry.value.kind === 'REG_SZ') {
    const trimmed = valEntry.value.value.trim();
    if (trimmed === '') {
      return null;
    }
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/** Extracts a boolean flag from a WiRE section (`VT_BOOL` or 0/non-zero integer). */
export function getWireBoolean(doc: ParsedRegistry, sectionPath: string): boolean | null {
  const section = getSection(doc, sectionPath);
  if (!section) {
    return null;
  }
  if (section.variant) {
    if (section.variant.kind === 'boolean') {
      return section.variant.value;
    }
    if (section.variant.kind === 'number') {
      return section.variant.value !== 0;
    }
  }
  const valEntry = section.entryMap['__value__'];
  if (valEntry?.value.kind === 'REG_DWORD') {
    return valEntry.value.value !== 0;
  }
  return null;
}

/** Returns all direct child sections that were explicitly declared under a parent path. */
export function listDirectChildSections(
  doc: ParsedRegistry,
  parentPath: string,
): readonly RegistrySection[] {
  const normParent = normalizeRegistryPath(parentPath);
  return doc.sections.filter((s) => s.parentPath === normParent);
}

/**
 * Returns all immediate child segment names beneath `parentPath`, including
 * implicit intermediate folders inferred from deeper descendant sections
 * (important for partial registry exports that omit intermediate headers).
 */
export function listDirectChildNames(
  doc: ParsedRegistry,
  parentPath: string,
): readonly string[] {
  const normParent = normalizeRegistryPath(parentPath);
  const parentDepth = normParent === '' ? 0 : normParent.split('\\').length;
  const prefix = normParent === '' ? '' : `${normParent}\\`;
  const names: string[] = [];
  const seen = new Set<string>();

  for (const section of doc.sections) {
    if (prefix !== '' && !section.normalizedPath.startsWith(prefix)) {
      continue;
    }
    if (section.segments.length <= parentDepth) {
      continue;
    }
    const childName = section.segments[parentDepth];
    const key = childName.toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      names.push(childName);
    }
  }

  return names;
}

/** Finds all sections whose path matches a case-insensitive substring or regex. */
export function findSections(
  doc: ParsedRegistry,
  matcher: string | RegExp,
): readonly RegistrySection[] {
  if (typeof matcher === 'string') {
    const needle = matcher.toLowerCase();
    return doc.sections.filter((s) => s.normalizedPath.includes(needle));
  }
  return doc.sections.filter((s) => matcher.test(s.path));
}

/**
 * Reads ordered collection keys from a Renishaw WiRE collection section that
 * uses `_nitems` + `_key0`, `_key1`, ... entries, falling back to direct child
 * segments (both explicit and implicit) when `_key*` metadata is absent.
 */
export function readWireCollectionKeys(
  doc: ParsedRegistry,
  collectionPath: string,
  childFilter?: (name: string) => boolean,
): readonly string[] {
  const keys: string[] = [];
  const seen = new Set<string>();

  const nItems = getWireNumber(doc, `${collectionPath}\\_nitems`);
  if (nItems !== null && nItems > 0 && nItems < 10_000) {
    for (let i = 0; i < nItems; i += 1) {
      const keyName = getWireString(doc, `${collectionPath}\\_key${i}`);
      if (keyName && !seen.has(keyName.toLowerCase())) {
        if (!childFilter || childFilter(keyName)) {
          seen.add(keyName.toLowerCase());
          keys.push(keyName);
        }
      }
    }
  }

  // Also include any direct children (explicit or implicit) matching the filter
  // not listed in _keyN (e.g. partial exports or legacy WiRE formats without _nitems).
  const directNames = listDirectChildNames(doc, collectionPath);
  for (const childName of directNames) {
    if (
      childName.startsWith('_') ||
      childName.toLowerCase() === 'nextkeyindex' ||
      childName.toLowerCase() === 'readonlyflag'
    ) {
      continue;
    }
    if (childFilter && !childFilter(childName)) {
      continue;
    }
    if (!seen.has(childName.toLowerCase())) {
      seen.add(childName.toLowerCase());
      keys.push(childName);
    }
  }

  return keys;
}

// ---------------------------------------------------------------------------
// WiRE System Root Detection (Version & WOW64 Agnostic)
// ---------------------------------------------------------------------------

/**
 * Auto-detects Renishaw WiRE system roots across WiRE versions and registry
 * layouts (e.g. `SOFTWARE\Renishaw\WiRE2\Systems\System0`,
 * `SOFTWARE\WOW6432Node\Renishaw\WiRE2\Systems\System1`, `WiRE\Systems\System0`).
 */
export function detectWireSystemRoots(doc: ParsedRegistry): readonly WireSystemRoot[] {
  const roots = new Map<string, WireSystemRoot>();
  const systemRootRegex =
    /^([^\\]+\\SOFTWARE\\(?:WOW6432Node\\)?Renishaw\\([^\\]+)\\Systems\\(System\d+))(?:\\|$)/i;

  for (const section of doc.sections) {
    const match = systemRootRegex.exec(section.path);
    if (!match) {
      continue;
    }
    const rootPath = match[1];
    const norm = normalizeRegistryPath(rootPath);
    if (!roots.has(norm)) {
      roots.set(norm, {
        path: rootPath,
        normalizedPath: norm,
        wireKey: match[2],
        systemId: match[3],
        isWow64: /\\wow6432node\\/i.test(rootPath),
      });
    }
  }

  // Fallback: detect any section containing GeneralProperties or Laser Collection
  if (roots.size === 0) {
    const fallbackRegex =
      /^(.+?)\\(?:GeneralProperties|Laser Collection|Grating Collection)(?:\\|$)/i;
    for (const section of doc.sections) {
      const match = fallbackRegex.exec(section.path);
      if (!match) {
        continue;
      }
      const rootPath = match[1];
      const norm = normalizeRegistryPath(rootPath);
      if (!roots.has(norm)) {
        const segs = rootPath.split('\\');
        roots.set(norm, {
          path: rootPath,
          normalizedPath: norm,
          wireKey: segs.length >= 3 ? segs[segs.length - 3] : 'WiRE',
          systemId: segs[segs.length - 1] ?? 'System0',
          isWow64: /\\wow6432node\\/i.test(rootPath),
        });
      }
    }
  }

  return [...roots.values()].sort((a, b) =>
    a.path.localeCompare(b.path, undefined, { numeric: true, sensitivity: 'base' }),
  );
}

function resolveSystemRoot(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
): WireSystemRoot | null {
  const detected = detectWireSystemRoots(doc);
  if (options?.systemRootPath) {
    const targetNorm = normalizeRegistryPath(options.systemRootPath);
    const matched = detected.find((r) => r.normalizedPath === targetNorm);
    if (matched) {
      return matched;
    }
    const segs = options.systemRootPath.split('\\').filter(Boolean);
    return {
      path: options.systemRootPath,
      normalizedPath: targetNorm,
      wireKey: segs.length >= 3 ? segs[segs.length - 3] : 'WiRE',
      systemId: segs[segs.length - 1] ?? 'System0',
      isWow64: /\\wow6432node\\/i.test(options.systemRootPath),
    };
  }
  return detected[0] ?? null;
}

// ---------------------------------------------------------------------------
// Domain Extractors
// ---------------------------------------------------------------------------

function detectInstrumentFamily(
  doc: ParsedRegistry,
  systemRoot: WireSystemRoot,
  instrumentType: number | null,
): InstrumentFamily {
  const topSubsystems = listDirectChildNames(doc, systemRoot.path);
  const hasVirsaHelper = topSubsystems.some((name) => name.toLowerCase() === 'virsahelper');
  if (instrumentType === 2 || hasVirsaHelper) {
    return 'Virsa';
  }

  const hasInViaFriendlyName = doc.sections.some(
    (s) =>
      s.normalizedPath.startsWith(systemRoot.normalizedPath) &&
      s.normalizedPath.includes('\\wiremovexyz\\') &&
      s.name.toLowerCase() === 'friendlyname' &&
      getWireString(doc, s.path)?.trim().toLowerCase() === 'invia',
  );
  if (instrumentType === 0 || hasInViaFriendlyName) {
    return 'inVia';
  }

  return 'unknown';
}

export function extractSystemMetadata(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
): SystemMetadataSummary {
  const systemRoot = resolveSystemRoot(doc, options);
  if (!systemRoot) {
    return {
      systemRoot: null,
      instrumentFamily: 'unknown',
      instrumentSerialNumber: null,
      instrumentSerialPrefix: null,
      wireVersion: null,
      instrumentType: null,
      systemTypeCode: null,
      microscopeImagingFactor: null,
      lastCollectionTimestamp: null,
    };
  }

  const base = systemRoot.path;
  const serial = getWireString(doc, `${base}\\GeneralProperties\\Instrument Serial Number`);
  const wireVersion =
    getWireString(doc, `${base}\\GeneralProperties\\WiRE2 Version`) ??
    getWireString(doc, `${base}\\GeneralProperties\\WiRE Version`);
  const instrumentType = getWireNumber(doc, `${base}\\GeneralProperties\\Instrument type`);
  const systemTypeCode = getWireNumber(doc, `${base}\\System Type`);
  const mif = getWireNumber(doc, `${base}\\MicroscopeImagingFactor`);
  const instrumentFamily = detectInstrumentFamily(doc, systemRoot, instrumentType);

  // Look for the latest VT_DATE timestamp (e.g. dark current / zero level LastCollectionTime)
  let latestTimestamp: string | null = null;
  for (const section of doc.sections) {
    if (
      section.normalizedPath.startsWith(systemRoot.normalizedPath) &&
      section.variant?.kind === 'date' &&
      section.variant.isoString
    ) {
      if (!latestTimestamp || section.variant.isoString > latestTimestamp) {
        latestTimestamp = section.variant.isoString;
      }
    }
  }

  const cleanSerial = serial?.trim() || null;

  return {
    systemRoot,
    instrumentFamily,
    instrumentSerialNumber: cleanSerial,
    instrumentSerialPrefix:
      cleanSerial && cleanSerial.length >= 6 ? cleanSerial.slice(0, 6) : cleanSerial,
    wireVersion,
    instrumentType,
    systemTypeCode,
    microscopeImagingFactor: mif,
    lastCollectionTimestamp: latestTimestamp,
  };
}

export function extractGratings(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
): readonly GratingRecord[] {
  const systemRoot = resolveSystemRoot(doc, options);
  if (!systemRoot) {
    return [];
  }

  const collectionPath = `${systemRoot.path}\\Grating Collection`;
  const gratingKeys = readWireCollectionKeys(doc, collectionPath, (name) =>
    /^grating\d+$/i.test(name),
  );

  return gratingKeys.map((gratingKey) => {
    const gPath = `${collectionPath}\\${gratingKey}`;
    const calKeys = readWireCollectionKeys(doc, gPath, (name) => /^\d+$/.test(name));
    const calibrations: GratingCalibrationTrack[] = [];

    for (const calIdx of calKeys) {
      const calPath = `${gPath}\\${calIdx}`;
      const trackKeys = readWireCollectionKeys(doc, calPath, (name) => /^\d+$/.test(name));
      const areaKeyId =
        getWireNumber(doc, `${calPath}\\akID`) ?? getWireNumber(doc, `${calPath}\\Area Key\\id`);
      const laserKey = getWireString(doc, `${calPath}\\Area Key\\Laser Name`);
      const focusMode = getWireNumber(doc, `${calPath}\\Area Key\\Focus Mode`);
      const calibrationStatus = getWireNumber(doc, `${calPath}\\Calibration Status`);

      for (const trackIdx of trackKeys) {
        const trackPath = `${calPath}\\${trackIdx}`;
        calibrations.push({
          calibrationIndex: calIdx,
          trackIndex: trackIdx,
          areaKeyId,
          laserKey,
          focusMode,
          grooveDensity: getWireNumber(doc, `${trackPath}\\Grating Groove Density`),
          gratingOrder: getWireNumber(doc, `${trackPath}\\Grating Order`),
          focalLength0: getWireNumber(doc, `${trackPath}\\Focal Length 0`),
          includeAngle: getWireNumber(doc, `${trackPath}\\Grating Include Angle`),
          zeroOffset: getWireNumber(doc, `${trackPath}\\Grating ZeroOffset`),
          staticDynamicOffset: getWireNumber(doc, `${trackPath}\\Static Dynamic Offset`),
          calibrationStatus,
          sectionPath: trackPath,
        });
      }
    }

    return {
      key: gratingKey,
      sectionPath: gPath,
      gratingName: getWireString(doc, `${gPath}\\Grating Name`),
      motorKeyName: getWireString(doc, `${gPath}\\Motor Key Name`),
      stepSize: getWireNumber(doc, `${gPath}\\Grating Step Size`),
      referencePosition: getWireNumber(doc, `${gPath}\\Grating Reference Position`),
      maxAngleDegs: getWireNumber(doc, `${gPath}\\MaxAngleDegs`),
      calibrations,
    };
  });
}

function inferLaserModeHint(laserName: string): 'HiRes' | 'HiSens' | null {
  if (/hires/i.test(laserName)) {
    return 'HiRes';
  }
  if (/hisens/i.test(laserName)) {
    return 'HiSens';
  }
  return null;
}

export function extractLasers(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
): readonly LaserCalibrationRecord[] {
  const systemRoot = resolveSystemRoot(doc, options);
  if (!systemRoot) {
    return [];
  }

  const base = systemRoot.path;
  const collectionPath = `${base}\\Laser Collection`;
  const laserKeys = readWireCollectionKeys(doc, collectionPath, (name) => /^laser\d+$/i.test(name));
  const gratings = extractGratings(doc, options);

  // Build mapping from laserKey -> gratingKey using VirsaHelper if available
  const mappingBase = `${base}\\VirsaHelper\\VirsaHelper_LaserGratingMapping`;

  return laserKeys.map((laserKey) => {
    const lPath = `${collectionPath}\\${laserKey}`;
    const laserName = getWireString(doc, `${lPath}\\LaserName`) ?? '';
    const wavelengthMatch = /(\d{3})/.exec(laserName);
    const wavelengthNm = wavelengthMatch ? wavelengthMatch[1] : null;

    const rawWavenumber = getWireString(doc, `${lPath}\\LaserWavenumber`);
    const wavenumber = getWireNumber(doc, `${lPath}\\LaserWavenumber`);
    const rawMaxPower = getWireString(doc, `${lPath}\\MaxPower`);
    const maxPower = getWireNumber(doc, `${lPath}\\MaxPower`);
    const ndPercent = getWireNumber(doc, `${lPath}\\NDPercent`);
    const mif = getWireNumber(doc, `${lPath}\\MIF`);
    const pathId = getWireNumber(doc, `${lPath}\\Path`);
    const laserType = getWireNumber(doc, `${lPath}\\Type`);
    const diverted = getWireBoolean(doc, `${lPath}\\Diverted`);

    let mappedGratingKey = getWireString(doc, `${mappingBase}\\${laserKey}`);

    // Fallback for inVia and other WiRE systems without VirsaHelper:
    // infer mapped grating from Grating Collection calibration Area Key Laser Name
    if (!mappedGratingKey) {
      const matchedGrating = gratings.find((g) =>
        g.calibrations.some((c) => c.laserKey?.toLowerCase() === laserKey.toLowerCase()),
      );
      if (matchedGrating) {
        mappedGratingKey = matchedGrating.key;
      }
    }

    // Resolve Static Dynamic Offset:
    // 1. Prefer the grating calibration track whose Area Key Laser Name matches this laserKey.
    // 2. Fallback to the legacy fixed path Grating Collection\grating0\1\0\Static Dynamic Offset.
    let sdoValue: number | null = null;
    let rawSdo: string | null = null;
    let sdoSourcePath: string | null = null;

    const preferredGratings = mappedGratingKey
      ? [
          ...gratings.filter((g) => g.key.toLowerCase() === mappedGratingKey.toLowerCase()),
          ...gratings.filter((g) => g.key.toLowerCase() !== mappedGratingKey.toLowerCase()),
        ]
      : gratings;

    for (const grating of preferredGratings) {
      const matchedTrack = grating.calibrations.find(
        (c) => c.laserKey?.toLowerCase() === laserKey.toLowerCase(),
      );
      if (matchedTrack && matchedTrack.staticDynamicOffset !== null) {
        sdoValue = matchedTrack.staticDynamicOffset;
        sdoSourcePath = `${matchedTrack.sectionPath}\\Static Dynamic Offset`;
        rawSdo = getWireString(doc, sdoSourcePath);
        break;
      }
    }

    if (sdoSourcePath === null) {
      const fallbackPath = `${base}\\Grating Collection\\grating0\\1\\0\\Static Dynamic Offset`;
      const fallbackRaw = getWireString(doc, fallbackPath);
      if (fallbackRaw !== null) {
        rawSdo = fallbackRaw;
        sdoValue = getWireNumber(doc, fallbackPath);
        sdoSourcePath = fallbackPath;
      }
    }

    return {
      key: laserKey,
      sectionPath: lPath,
      laserName,
      wavelengthNm,
      modeHint: inferLaserModeHint(laserName),
      wavenumber,
      rawWavenumber,
      maxPower,
      rawMaxPower,
      ndPercent,
      mif,
      pathId,
      laserType,
      diverted,
      mappedGratingKey,
      staticDynamicOffset: sdoValue,
      rawStaticDynamicOffset: rawSdo,
      staticDynamicOffsetSourcePath: sdoSourcePath,
    };
  });
}

export function extractDetectors(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
): readonly DetectorRecord[] {
  const systemRoot = resolveSystemRoot(doc, options);
  if (!systemRoot) {
    return [];
  }

  const base = systemRoot.path;
  const detectorsPath = `${base}\\detectors`;
  const ccdPath = `${base}\\CCD`;
  const ccdParamPath = `${ccdPath}\\Params\\0`;

  // Extract readout modes from CCD\Params\0\detMaps
  const detMapsPath = `${ccdParamPath}\\detMaps`;
  const mapKeys = readWireCollectionKeys(doc, detMapsPath, (name) => /^\d+$/.test(name));
  const readoutModes: DetectorReadoutMode[] = mapKeys.map((k) => {
    const mPath = `${detMapsPath}\\${k}`;
    return {
      index: getWireNumber(doc, `${mPath}\\index`) ?? Number.parseInt(k, 10),
      name: (getWireString(doc, `${mPath}\\name`) ?? `Mode ${k}`).trim(),
      description: getWireString(doc, `${mPath}\\desc`),
      gain: getWireNumber(doc, `${mPath}\\gain`),
      gainName: getWireString(doc, `${mPath}\\gainName`),
      speed: getWireNumber(doc, `${mPath}\\speed`),
      speedName: getWireString(doc, `${mPath}\\speedName`),
      fNumber: getWireString(doc, `${mPath}\\FNum`),
    };
  });

  const directDetectorNodes = listDirectChildSections(doc, detectorsPath).filter((s) =>
    /^_i\d+$/i.test(s.name),
  );

  if (directDetectorNodes.length === 0) {
    const ccdName = getWireString(doc, `${ccdPath}\\Name`);
    if (!ccdName) {
      return [];
    }
    return [
      {
        key: 'CCD',
        sectionPath: ccdPath,
        displayName: ccdName,
        identifier: null,
        enabled: true,
        operatingTemperatureC: getWireNumber(doc, `${ccdPath}\\Operating Temperature`),
        widthPixels: getWireNumber(doc, `${ccdPath}\\Width in Pixels`),
        heightPixels: getWireNumber(doc, `${ccdPath}\\Height In Pixels`),
        pixelWidthMm: getWireNumber(doc, `${ccdPath}\\Pixel Width in mm`),
        pixelHeightMm: getWireNumber(doc, `${ccdPath}\\Pixel Height in mm`),
        readoutModes,
      },
    ];
  }

  return directDetectorNodes.map((detSection, idx) => {
    const paramPath = `${ccdPath}\\Params\\${idx}`;
    return {
      key: detSection.name,
      sectionPath: detSection.path,
      displayName:
        getWireString(doc, `${detSection.path}\\DisplayName`) ??
        getWireString(doc, `${paramPath}\\Name`) ??
        getWireString(doc, `${ccdPath}\\Name`),
      identifier: getWireString(doc, `${detSection.path}\\Identifier`),
      enabled: getWireBoolean(doc, `${detSection.path}\\Enabled`),
      operatingTemperatureC:
        getWireNumber(doc, `${paramPath}\\OpTemp`) ??
        getWireNumber(doc, `${ccdPath}\\Operating Temperature`),
      widthPixels:
        getWireNumber(doc, `${paramPath}\\wPix`) ??
        getWireNumber(doc, `${ccdPath}\\Width in Pixels`),
      heightPixels:
        getWireNumber(doc, `${paramPath}\\hPix`) ??
        getWireNumber(doc, `${ccdPath}\\Height In Pixels`),
      pixelWidthMm:
        getWireNumber(doc, `${paramPath}\\pixWmm`) ??
        getWireNumber(doc, `${ccdPath}\\Pixel Width in mm`),
      pixelHeightMm:
        getWireNumber(doc, `${paramPath}\\pixHmm`) ??
        getWireNumber(doc, `${ccdPath}\\Pixel Height in mm`),
      readoutModes: idx === 0 ? readoutModes : [],
    };
  });
}

export function extractMotors(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
): readonly MotorRecord[] {
  const systemRoot = resolveSystemRoot(doc, options);
  if (!systemRoot) {
    return [];
  }

  const motorsPath = `${systemRoot.path}\\Motors`;
  const motorKeys = readWireCollectionKeys(doc, motorsPath, (name) => {
    const lower = name.toLowerCase();
    return lower !== 'trackingmotors' && lower !== 'sp7upgraderun';
  });

  const motors: MotorRecord[] = [];
  for (const key of motorKeys) {
    const mPath = `${motorsPath}\\${key}`;
    const motorName = getWireString(doc, `${mPath}\\Motor Name`);
    // Only include sections that look like actual motor definitions
    if (!motorName && !getSection(doc, `${mPath}\\Motor ID`)) {
      continue;
    }

    const indexPath = `${mPath}\\Motor Indexes`;
    const indexKeys = readWireCollectionKeys(doc, indexPath);
    const namedIndexes: Record<string, number> = {};
    for (const idxKey of indexKeys) {
      const idxVal = getWireNumber(doc, `${indexPath}\\${idxKey}`);
      if (idxVal !== null) {
        namedIndexes[idxKey] = idxVal;
      }
    }

    const notMotorised = getWireBoolean(doc, `${mPath}\\Motor Not Motorised`);

    motors.push({
      key,
      sectionPath: mPath,
      motorName: motorName ?? key,
      motorId: getWireNumber(doc, `${mPath}\\Motor ID`),
      present: getWireBoolean(doc, `${mPath}\\Motor Present`),
      motorised: notMotorised === null ? null : !notMotorised,
      units: getWireString(doc, `${mPath}\\Motor Units`),
      positionSteps: getWireNumber(doc, `${mPath}\\Motor Position in steps`),
      positionLogical: getWireNumber(doc, `${mPath}\\Position in Logical Units`),
      minLimit: getWireNumber(doc, `${mPath}\\Minimum limit`),
      maxLimit: getWireNumber(doc, `${mPath}\\Maximum limit`),
      namedIndexes,
    });
  }

  return motors;
}

/**
 * Derives system calibration / commissioning readiness from grating calibration
 * tracks (`Calibration Status = 1` vs factory default `2`), dark-current
 * collection timestamps, and saved GeneralProperties alignment blocks.
 */
export function extractCalibrationState(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
  precomputed?: {
    readonly metadata?: SystemMetadataSummary;
    readonly gratings?: readonly GratingRecord[];
  },
): CalibrationStateSummary {
  const systemRoot = resolveSystemRoot(doc, options);
  const metadata = precomputed?.metadata ?? extractSystemMetadata(doc, options);
  const gratings = precomputed?.gratings ?? extractGratings(doc, options);

  let calibratedTrackCount = 0;
  let uncalibratedTrackCount = 0;
  let totalTrackCount = 0;

  for (const grating of gratings) {
    for (const track of grating.calibrations) {
      totalTrackCount += 1;
      if (track.calibrationStatus === 1) {
        calibratedTrackCount += 1;
      } else if (track.calibrationStatus !== null) {
        uncalibratedTrackCount += 1;
      }
    }
  }

  const hasDarkCurrentCalibration = metadata.lastCollectionTimestamp !== null;
  const hasAlignmentData = systemRoot
    ? getSection(doc, `${systemRoot.path}\\GeneralProperties\\LaserAlign`) !== null ||
      getSection(doc, `${systemRoot.path}\\GeneralProperties\\SpectrometerAlign`) !== null
    : false;

  let state: SystemCalibrationState = 'unknown';
  if (calibratedTrackCount > 0 && uncalibratedTrackCount === 0) {
    state = 'calibrated';
  } else if (calibratedTrackCount > 0 && uncalibratedTrackCount > 0) {
    state = 'partial';
  } else if (uncalibratedTrackCount > 0) {
    state = 'uncalibrated';
  } else if (hasDarkCurrentCalibration) {
    state = 'calibrated';
  }

  return {
    state,
    calibratedTrackCount,
    uncalibratedTrackCount,
    totalTrackCount,
    hasDarkCurrentCalibration,
    hasAlignmentData,
  };
}

/**
 * Produces a complete structured summary over a parsed registry document.
 */
export function summarizeRegistry(
  doc: ParsedRegistry,
  options?: SystemQueryOptions,
): RegistryAnalysisSummary {
  const systemRoots = detectWireSystemRoots(doc);
  const activeSystemRoot = resolveSystemRoot(doc, options);
  const resolvedOpts: SystemQueryOptions = activeSystemRoot
    ? { systemRootPath: activeSystemRoot.path }
    : {};

  const valueKindCounts: Record<RegistryValue['kind'], number> = {
    REG_SZ: 0,
    REG_DWORD: 0,
    REG_QWORD: 0,
    REG_BINARY: 0,
    REG_EXPAND_SZ: 0,
    REG_MULTI_SZ: 0,
    REG_NONE: 0,
    DELETE: 0,
    UNKNOWN: 0,
  };

  const variantKindCounts: Record<WireVariantValue['kind'], number> = {
    empty: 0,
    string: 0,
    number: 0,
    boolean: 0,
    date: 0,
    'com-object': 0,
    'com-array': 0,
    unknown: 0,
  };

  for (const section of doc.sections) {
    if (section.variant) {
      variantKindCounts[section.variant.kind] += 1;
    }
    for (const entry of section.entries) {
      valueKindCounts[entry.value.kind] += 1;
    }
  }

  const metadata = extractSystemMetadata(doc, resolvedOpts);
  const gratings = extractGratings(doc, resolvedOpts);
  const calibration = extractCalibrationState(doc, resolvedOpts, { metadata, gratings });

  return {
    systemRoots,
    activeSystemRoot,
    metadata,
    calibration,
    lasers: extractLasers(doc, resolvedOpts),
    gratings,
    detectors: extractDetectors(doc, resolvedOpts),
    motors: extractMotors(doc, resolvedOpts),
    valueKindCounts,
    variantKindCounts,
  };
}
