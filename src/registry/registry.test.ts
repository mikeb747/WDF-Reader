import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ComVariantTypeCode,
  decodeRegistryInput,
  defineRule,
  detectWireSystemRoots,
  evaluateVirsaRules,
  extractDetectors,
  extractGratings,
  extractLasers,
  extractSystemMetadata,
  getEntry,
  getSection,
  getWireNumber,
  getWireString,
  oleDateToIsoString,
  parseRegistry,
  SAMPLE_INVIA_REG,
  SAMPLE_MALFORMED_EDGE_CASES_REG,
  SAMPLE_VIRSA_FAILING_RULES_REG,
  SAMPLE_VIRSA_PASSING_REG,
  SAMPLE_WIRE_LEGACY_WOW64_REG,
  summarizeRegistry,
} from './index';

// ---------------------------------------------------------------------------
// 1. Decoder Tests (UTF-16LE, UTF-16BE, UTF-8 BOM, Plain UTF-8, String)
// ---------------------------------------------------------------------------

test('decodeRegistryInput decodes UTF-16LE BOM, UTF-16BE BOM, and UTF-8 BOM', () => {
  const sample = 'Windows Registry Editor Version 5.00\r\n[HKEY_LOCAL_MACHINE\\Test]';

  // UTF-16LE with BOM
  const le = new Uint8Array(2 + sample.length * 2);
  le[0] = 0xff;
  le[1] = 0xfe;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    le[2 + i * 2] = code & 0xff;
    le[2 + i * 2 + 1] = code >> 8;
  }
  const decodedLe = decodeRegistryInput(le);
  assert.equal(decodedLe.encoding, 'utf-16le-bom');
  assert.equal(decodedLe.text, sample);

  // UTF-16BE with BOM
  const be = new Uint8Array(2 + sample.length * 2);
  be[0] = 0xfe;
  be[1] = 0xff;
  for (let i = 0; i < sample.length; i += 1) {
    const code = sample.charCodeAt(i);
    be[2 + i * 2] = code >> 8;
    be[2 + i * 2 + 1] = code & 0xff;
  }
  const decodedBe = decodeRegistryInput(be);
  assert.equal(decodedBe.encoding, 'utf-16be-bom');
  assert.equal(decodedBe.text, sample);

  // UTF-8 with BOM
  const utf8Bytes = new Uint8Array([0xef, 0xbb, 0xbf, ...Array.from(sample, (c) => c.charCodeAt(0))]);
  const decodedUtf8Bom = decodeRegistryInput(utf8Bytes);
  assert.equal(decodedUtf8Bom.encoding, 'utf-8-bom');
  assert.equal(decodedUtf8Bom.text, sample);

  // UTF-16LE without BOM (inferred)
  const leNoBom = le.slice(2);
  const decodedInferred = decodeRegistryInput(leNoBom);
  assert.equal(decodedInferred.encoding, 'utf-16le-inferred');
  assert.equal(decodedInferred.text, sample);

  // String with leading BOM character
  const decodedStrBom = decodeRegistryInput(`\uFEFF${sample}`);
  assert.equal(decodedStrBom.encoding, 'utf-8-bom');
  assert.equal(decodedStrBom.text, sample);
});

// ---------------------------------------------------------------------------
// 2. Standard Registry Parsing & Value Types
// ---------------------------------------------------------------------------

test('parses REGEDIT5 standard entries, COM variants, and hierarchical tree', () => {
  const doc = parseRegistry(SAMPLE_VIRSA_PASSING_REG, { sourceName: 'VR9K42_20250813_sys.rrg' });

  assert.equal(doc.formatVersion, 'regedit5');
  assert.equal(doc.stats.errorCount, 0);
  assert.equal(doc.stats.warningCount, 0);
  assert.ok(doc.sections.length > 20);
  assert.equal(doc.tree.length, 1);
  assert.equal(doc.tree[0].name, 'HKEY_LOCAL_MACHINE');

  // Case-insensitive & slash-normalized lookup
  const serialSec = getSection(
    doc,
    'hkey_local_machine/software/renishaw/wire2/systems/system0/generalproperties/instrument serial number',
  );
  assert.ok(serialSec);
  assert.equal(serialSec.variant?.kind, 'string');
  assert.equal(serialSec.variant?.typeName, 'VT_BSTR');
  assert.equal(serialSec.variant?.value, 'VR9K42');

  // Signed 32-bit VT_INT negative number (CCD Operating Temperature = -70 °C)
  const tempSec = getSection(
    doc,
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\CCD\\Operating Temperature',
  );
  assert.ok(tempSec);
  assert.equal(tempSec.variant?.kind, 'number');
  if (tempSec.variant?.kind === 'number') {
    assert.equal(tempSec.variant.typeCode, ComVariantTypeCode.VT_INT);
    assert.equal(tempSec.variant.value, -70);
    assert.equal(tempSec.variant.numericFormat, 'signed-int');
  }
  const rawTempEntry = tempSec.entryMap['__value__'];
  assert.equal(rawTempEntry.value.kind, 'REG_DWORD');
  if (rawTempEntry.value.kind === 'REG_DWORD') {
    assert.equal(rawTempEntry.value.hex, 'ffffffba');
    assert.equal(rawTempEntry.value.signedValue, -70);
    assert.equal(rawTempEntry.value.value, 0xffffffba);
  }

  // OLE Automation VT_DATE decoding (45882.5 -> 2025-08-13T12:00:00.000Z)
  const dateSec = getSection(
    doc,
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\akdm\\zeroLevel_darkCurrent\\props\\0\\LastCollectionTime',
  );
  assert.ok(dateSec);
  assert.equal(dateSec.variant?.kind, 'date');
  if (dateSec.variant?.kind === 'date') {
    assert.equal(dateSec.variant.oleDate, 45882.5);
    assert.equal(dateSec.variant.isoString, '2025-08-13T12:00:00.000Z');
  }
  assert.equal(oleDateToIsoString(Number.NaN), null);

  // COM object CLSID via default @ entry
  const laser0 = getSection(
    doc,
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0',
  );
  assert.ok(laser0);
  assert.equal(laser0.variant?.kind, 'com-object');
  if (laser0.variant?.kind === 'com-object') {
    assert.equal(laser0.variant.clsid, '{9142E587-BA52-498E-8DFF-18CDF12B3771}');
  }
});

test('parses REGEDIT4, WOW6432Node, hex continuations, REG_EXPAND_SZ, REG_MULTI_SZ, REG_QWORD, and deletions', () => {
  const doc = parseRegistry(SAMPLE_WIRE_LEGACY_WOW64_REG, { sourceName: 'LG4012_legacy_sys.reg' });

  assert.equal(doc.formatVersion, 'regedit4');
  assert.equal(doc.stats.errorCount, 0);
  assert.equal(doc.stats.deletionSectionCount, 1);

  const roots = detectWireSystemRoots(doc);
  assert.equal(roots.length, 1);
  assert.equal(roots[0].isWow64, true);
  assert.equal(roots[0].systemId, 'System1');

  const binPath = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\CustomBinary';

  const blob = getEntry(doc, binPath, 'Blob');
  assert.ok(blob && blob.value.kind === 'REG_BINARY');
  assert.deepEqual(blob.value.bytes, [0x01, 0x02, 0x0a, 0xff, 0x10, 0x20, 0x30, 0x40]);
  assert.ok(blob.endLine > blob.line);

  const expand = getEntry(doc, binPath, 'InstallDir');
  assert.ok(expand && expand.value.kind === 'REG_EXPAND_SZ');
  assert.equal(expand.value.value, '%ProgramData%');

  const multi = getEntry(doc, binPath, 'SearchPaths');
  assert.ok(multi && multi.value.kind === 'REG_MULTI_SZ');
  assert.deepEqual(multi.value.values, ['Alpha', 'Beta']);

  const qword = getEntry(doc, binPath, 'LargeCounter');
  assert.ok(qword && qword.value.kind === 'REG_QWORD');
  assert.equal(qword.value.value, (2n << 32n) + 1n);

  const delVal = getEntry(doc, binPath, 'ObsoleteValue');
  assert.ok(delVal && delVal.value.kind === 'DELETE');

  const delSec = getSection(
    doc,
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\DeprecatedKey',
  );
  assert.ok(delSec && delSec.isDeletion);
});

test('parses REGEDIT5 UTF-16LE REG_EXPAND_SZ and REG_MULTI_SZ plus REG_NONE', () => {
  const reg5Binary = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Test]
"Expand"=hex(2):43,00,3a,00,5c,00,57,00,69,00,52,00,45,00,00,00
"Multi"=hex(7):4f,00,6e,00,65,00,00,00,54,00,77,00,6f,00,00,00,00,00
"NoneVal"=hex(0):de,ad
`;
  const doc = parseRegistry(reg5Binary);
  assert.equal(doc.stats.errorCount, 0);

  const expand = getEntry(doc, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Test', 'Expand');
  assert.ok(expand && expand.value.kind === 'REG_EXPAND_SZ');
  assert.equal(expand.value.value, 'C:\\WiRE');

  const multi = getEntry(doc, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Test', 'Multi');
  assert.ok(multi && multi.value.kind === 'REG_MULTI_SZ');
  assert.deepEqual(multi.value.values, ['One', 'Two']);

  const none = getEntry(doc, 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Test', 'NoneVal');
  assert.ok(none && none.value.kind === 'REG_NONE');
  assert.deepEqual(none.value.bytes, [0xde, 0xad]);
});

// ---------------------------------------------------------------------------
// 3. Malformed Lines & Edge Cases
// ---------------------------------------------------------------------------

test('recovers cleanly from malformed lines and reports accurate diagnostics', () => {
  const doc = parseRegistry(SAMPLE_MALFORMED_EDGE_CASES_REG);
  const codes = new Set(doc.diagnostics.map((d) => d.code));

  assert.ok(codes.has('ORPHAN_VALUE_ENTRY'));
  assert.ok(codes.has('INVALID_DWORD'));
  assert.ok(codes.has('UNTERMINATED_STRING'));
  assert.ok(codes.has('INVALID_HEX_BYTES'));
  assert.ok(codes.has('INVALID_QWORD'));
  assert.ok(codes.has('UNKNOWN_VALUE_TYPE'));
  assert.ok(codes.has('MALFORMED_VALUE_LINE'));
  assert.ok(codes.has('MALFORMED_SECTION_HEADER'));
  assert.ok(codes.has('DUPLICATE_VALUE'));
  assert.ok(codes.has('DUPLICATE_SECTION'));

  // Valid entries & escaped quotes/backslashes still parsed accurately
  const demoPath = 'HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\EscapedDemo';
  const escaped = getEntry(doc, demoPath, 'Quoted"Key');
  assert.ok(escaped && escaped.value.kind === 'REG_SZ');
  assert.equal(escaped.value.value, 'Value with "quotes" and C:\\Renishaw\\WiRE2\\');

  // Duplicate value uses last-write-wins in entryMap while preserving history in entries
  const dupVal = getEntry(doc, demoPath, 'DuplicateKey');
  assert.ok(dupVal && dupVal.value.kind === 'REG_SZ');
  assert.equal(dupVal.value.value, 'second');

  // Duplicate section merged entries into original section
  const merged = getEntry(doc, demoPath, 'MergedAfterDuplicateSection');
  assert.ok(merged && merged.value.kind === 'REG_DWORD');
  assert.equal(merged.value.value, 42);
});

test('handles empty input and missing header gracefully', () => {
  const emptyDoc = parseRegistry('   \n; only comments\n');
  assert.equal(emptyDoc.sections.length, 0);
  assert.ok(emptyDoc.diagnostics.some((d) => d.code === 'EMPTY_INPUT'));

  const noHeaderDoc = parseRegistry('[HKEY_CURRENT_USER\\Demo]\n"A"="1"\n');
  assert.equal(noHeaderDoc.sections.length, 1);
  assert.ok(noHeaderDoc.diagnostics.some((d) => d.code === 'MISSING_HEADER'));
  assert.equal(getEntry(noHeaderDoc, 'HKEY_CURRENT_USER\\Demo', 'A')?.value.kind, 'REG_SZ');
});

// ---------------------------------------------------------------------------
// 4. Analysis Helpers & Extensible Virsa Rules Engine
// ---------------------------------------------------------------------------

test('analysis extracts lasers, gratings, detectors, metadata and passing Virsa rules succeed', () => {
  const doc = parseRegistry(SAMPLE_VIRSA_PASSING_REG, { sourceName: 'VR9K42_20250813_sys.rrg' });
  const meta = extractSystemMetadata(doc);
  assert.equal(meta.instrumentSerialNumber, 'VR9K42');
  assert.equal(meta.wireVersion, 'WiRE 5.6, original release');

  const lasers = extractLasers(doc);
  assert.equal(lasers.length, 4);
  assert.equal(lasers[0].wavelengthNm, '785');
  assert.equal(lasers[0].modeHint, 'HiRes');
  assert.equal(lasers[0].wavenumber, 12742.4);
  assert.equal(lasers[0].staticDynamicOffset, 0.12);
  assert.equal(lasers[1].staticDynamicOffset, 0.05);

  const gratings = extractGratings(doc);
  assert.equal(gratings.length, 1);
  assert.equal(gratings[0].gratingName, '1500 l/mm (vis)');

  const detectors = extractDetectors(doc);
  assert.equal(detectors.length, 1);
  assert.equal(detectors[0].operatingTemperatureC, -70);

  const report = evaluateVirsaRules(doc, { sourceFolderName: 'VR9K42_LabA' });
  assert.equal(report.overallStatus, 'pass');
  assert.equal(report.passedCount, 5);
  assert.equal(report.failedCount, 0);
});

test('failing Virsa fixture triggers all 5 built-in Virsa rules with actionable findings', () => {
  const doc = parseRegistry(SAMPLE_VIRSA_FAILING_RULES_REG);
  const report = evaluateVirsaRules(doc, { sourceFolderName: 'C14R96_FZJ' });

  assert.equal(report.overallStatus, 'fail');
  assert.equal(report.failedCount, 5);
  assert.equal(report.passedCount, 0);

  const byId = Object.fromEntries(report.results.map((r) => [r.ruleId, r]));
  assert.equal(byId['virsa-default-wavenumber'].status, 'fail');
  assert.equal(byId['virsa-hires-hisens-pair'].status, 'fail');
  assert.equal(byId['virsa-wavenumber-tolerance'].status, 'fail');
  assert.equal(byId['virsa-laser-min-power'].status, 'fail');
  assert.equal(byId['virsa-serial-folder-match'].status, 'fail');
});

test('supports unknown wavelength warnings, skipped Test 5 without folder, and custom extraRules', () => {
  const doc = parseRegistry(SAMPLE_WIRE_LEGACY_WOW64_REG);
  const summary = summarizeRegistry(doc);

  assert.equal(summary.lasers.length, 1);
  assert.equal(summary.lasers[0].wavelengthNm, '633');
  assert.equal(
    getWireString(
      doc,
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\GeneralProperties\\Instrument Serial Number',
    ),
    'LG4012',
  );
  assert.equal(
    getWireNumber(
      doc,
      'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\Laser Collection\\laser0\\MaxPower',
    ),
    17,
  );

  // Add a custom user rule to verify extensibility
  const customWireVersionRule = defineRule({
    id: 'custom-wire-version-present',
    name: 'WiRE Version Present',
    category: 'Custom',
    description: 'Ensures WiRE version string is non-empty.',
    evaluate: ({ summary: s }) => ({
      status: s.metadata.wireVersion ? 'pass' : 'fail',
      summary: s.metadata.wireVersion
        ? `Detected ${s.metadata.wireVersion}`
        : 'Missing WiRE version.',
      findings: [],
    }),
  });

  const report = evaluateVirsaRules(doc, {
    summary,
    sourceFolderName: null,
    sourceFileName: null,
    extraRules: [customWireVersionRule],
  });

  const byId = Object.fromEntries(report.results.map((r) => [r.ruleId, r]));
  // 633nm is not in default lookup tables -> warn on Test 1 & Test 3
  assert.equal(byId['virsa-default-wavenumber'].status, 'warn');
  assert.equal(byId['virsa-wavenumber-tolerance'].status, 'warn');
  // Only 1 laser for 633nm -> fail on Test 2
  assert.equal(byId['virsa-hires-hisens-pair'].status, 'fail');
  // Power = 17 > 12 -> pass on Test 4
  assert.equal(byId['virsa-laser-min-power'].status, 'pass');
  // No folder/filename provided -> skipped on Test 5
  assert.equal(byId['virsa-serial-folder-match'].status, 'skipped');
  // Custom rule executed and passed
  assert.equal(byId['custom-wire-version-present'].status, 'pass');
});

// ---------------------------------------------------------------------------
// 5. inVia VT_VARIANT COM SafeArrays, Family Detection & Structural Comparison
// ---------------------------------------------------------------------------

test('decodes inVia VT_VARIANT COM SafeArrays, detects inVia family, and maps grating without VirsaHelper', () => {
  const doc = parseRegistry(SAMPLE_INVIA_REG, { sourceName: 'IV5140_inVia_sys.reg' });
  assert.equal(doc.stats.errorCount, 0);
  assert.equal(doc.stats.warningCount, 0);

  const arraySec = getSection(
    doc,
    'HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\LaserAlign\\NDForLaser\\laser1',
  );
  assert.ok(arraySec);
  assert.equal(arraySec.variant?.kind, 'com-array');
  if (arraySec.variant?.kind === 'com-array') {
    assert.equal(arraySec.variant.typeCode, ComVariantTypeCode.VT_VARIANT);
    assert.equal(arraySec.variant.elementCount, 3);
    assert.equal(arraySec.variant.dimensions, 1);
    assert.deepEqual(arraySec.variant.dimensionBounds, ['0 3']);
  }

  const summary = summarizeRegistry(doc);
  assert.equal(summary.variantKindCounts['com-array'], 1);
  assert.equal(summary.variantKindCounts.unknown, 0);
  assert.equal(summary.metadata.instrumentFamily, 'inVia');
  assert.equal(summary.metadata.instrumentSerialNumber, 'IV5140');
  assert.equal(summary.metadata.wireVersion, 'WiRE 5.7, original release');

  assert.equal(summary.lasers.length, 1);
  assert.equal(summary.lasers[0].key, 'laser1');
  assert.equal(summary.lasers[0].wavelengthNm, '514');
  assert.equal(summary.lasers[0].mappedGratingKey, 'grating0');
  assert.equal(summary.lasers[0].staticDynamicOffset, -4.2);
});

test('extractCalibrationState distinguishes calibrated, uncalibrated, partial, and unknown exports', () => {
  const uncalibratedReg = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\Instrument type]
"__type__"=dword:00000016
"__value__"=dword:00000000

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\1\\Calibration Status]
"__type__"=dword:00000016
"__value__"=dword:00000002

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\1\\0\\Focal Length 0]
"__type__"=dword:00000005
"__value__"="250"
`;
  const uncalSummary = summarizeRegistry(parseRegistry(uncalibratedReg));
  assert.equal(uncalSummary.calibration.state, 'uncalibrated');
  assert.equal(uncalSummary.calibration.calibratedTrackCount, 0);
  assert.equal(uncalSummary.calibration.uncalibratedTrackCount, 1);
  assert.equal(uncalSummary.calibration.hasDarkCurrentCalibration, false);
  assert.equal(uncalSummary.calibration.hasAlignmentData, false);

  const partialReg = `${uncalibratedReg}
[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\2\\Calibration Status]
"__type__"=dword:00000016
"__value__"=dword:00000001

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\2\\0\\Focal Length 0]
"__type__"=dword:00000005
"__value__"="251.4"
`;
  const partialSummary = summarizeRegistry(parseRegistry(partialReg));
  assert.equal(partialSummary.calibration.state, 'partial');
  assert.equal(partialSummary.calibration.calibratedTrackCount, 1);
  assert.equal(partialSummary.calibration.uncalibratedTrackCount, 1);
  assert.equal(partialSummary.calibration.totalTrackCount, 2);

  const calibratedSummary = summarizeRegistry(parseRegistry(SAMPLE_VIRSA_PASSING_REG));
  assert.equal(calibratedSummary.calibration.state, 'calibrated');
  assert.equal(calibratedSummary.calibration.hasDarkCurrentCalibration, true);

  const emptySummary = summarizeRegistry(parseRegistry('Windows Registry Editor Version 5.00\n[HKEY_LOCAL_MACHINE\\Demo]\n'));
  assert.equal(emptySummary.calibration.state, 'unknown');
  assert.equal(emptySummary.calibration.totalTrackCount, 0);
});

