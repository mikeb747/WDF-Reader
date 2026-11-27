import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluateVirsaRules, parseRegistry, summarizeRegistry } from './index';

function readAttachmentBytes(relativePath: string): Uint8Array {
  const filePath = path.resolve(process.cwd(), relativePath);
  const rawBuffer = fs.readFileSync(filePath);
  return new Uint8Array(rawBuffer.buffer, rawBuffer.byteOffset, rawBuffer.byteLength);
}

test('parses and analyses the real attached UTF-16LE Virsa registry file (AJ4F17)', () => {
  const bytes = readAttachmentBytes('public/assets/aistudio/AJ4F17_20250813_sys_47160748.txt');

  const doc = parseRegistry(bytes, { sourceName: 'AJ4F17_20250813_sys.rrg' });

  assert.equal(doc.encoding, 'utf-16le-bom');
  assert.equal(doc.formatVersion, 'regedit5');
  assert.equal(doc.stats.errorCount, 0);
  assert.equal(doc.stats.warningCount, 0);
  assert.equal(doc.stats.sectionCount, 1364);

  const summary = summarizeRegistry(doc);
  assert.equal(summary.systemRoots.length, 1);
  assert.equal(summary.activeSystemRoot?.systemId, 'System0');
  assert.equal(summary.metadata.instrumentFamily, 'Virsa');
  assert.equal(summary.metadata.instrumentSerialNumber, 'AJ4F17');
  assert.equal(summary.metadata.wireVersion, 'WiRE 5.6, original release');
  assert.ok(summary.metadata.lastCollectionTimestamp?.startsWith('2025-08-13T'));
  assert.equal(summary.variantKindCounts.unknown, 0);

  assert.equal(summary.lasers.length, 2);
  assert.equal(summary.lasers[0].laserName, '785 P1 HiRes');
  assert.equal(summary.lasers[0].wavenumber, 12742.7);
  assert.equal(summary.lasers[0].maxPower, 90);
  assert.equal(summary.lasers[0].staticDynamicOffset, 0);

  assert.equal(summary.lasers[1].laserName, '785 P1 HiSens');
  assert.equal(summary.lasers[1].wavenumber, 12742.7);
  assert.equal(summary.lasers[1].maxPower, 90);

  assert.equal(summary.gratings.length, 1);
  assert.equal(summary.gratings[0].gratingName, '1500 l/mm (vis)');
  assert.equal(summary.gratings[0].calibrations.length, 2);

  assert.equal(summary.detectors.length, 1);
  assert.equal(summary.detectors[0].displayName, 'Renishaw Centrus 8G5Y76');
  assert.equal(summary.detectors[0].operatingTemperatureC, -70);
  assert.equal(summary.detectors[0].widthPixels, 1040);
  assert.equal(summary.detectors[0].heightPixels, 256);
  assert.equal(summary.detectors[0].readoutModes.length, 9);

  assert.equal(summary.motors.length, 4);

  // All 5 built-in Virsa rules pass with matching folder prefix
  const passingReport = evaluateVirsaRules(doc, {
    summary,
    sourceFolderName: 'AJ4F17_Customer',
  });
  assert.equal(passingReport.overallStatus, 'pass');
  assert.equal(passingReport.passedCount, 5);
  assert.equal(passingReport.failedCount, 0);

  // Test 5 catches mismatched folder prefix
  const mismatchReport = evaluateVirsaRules(doc, {
    summary,
    sourceFolderName: 'WRONG9_Customer',
  });
  assert.equal(mismatchReport.overallStatus, 'fail');
  assert.equal(mismatchReport.failedCount, 1);
  assert.equal(
    mismatchReport.results.find((r) => r.ruleId === 'virsa-serial-folder-match')?.status,
    'fail',
  );
});

test('parses and analyses the real attached inVia file (ANJ351)', () => {
  const inviaDoc = parseRegistry(
    readAttachmentBytes('public/assets/aistudio/ANJ351_AGENZIA_inVia_7988e490.txt'),
    { sourceName: 'ANJ351_AGENZIA_inVia.reg' },
  );

  assert.equal(inviaDoc.encoding, 'utf-16le-bom');
  assert.equal(inviaDoc.formatVersion, 'regedit5');
  assert.equal(inviaDoc.stats.errorCount, 0);
  assert.equal(inviaDoc.stats.warningCount, 0);
  assert.equal(inviaDoc.stats.sectionCount, 2767);

  const inviaSummary = summarizeRegistry(inviaDoc);
  assert.equal(inviaSummary.metadata.instrumentFamily, 'inVia');
  assert.equal(inviaSummary.metadata.instrumentSerialNumber, 'ANJ351');
  assert.equal(inviaSummary.metadata.wireVersion, 'WiRE 5.7, original release');
  assert.equal(inviaSummary.metadata.instrumentType, 0);
  assert.equal(inviaSummary.variantKindCounts['com-array'], 5);
  assert.equal(inviaSummary.variantKindCounts.unknown, 0);
  assert.equal(inviaSummary.calibration.state, 'calibrated');
  assert.equal(inviaSummary.calibration.calibratedTrackCount, 1);
  assert.equal(inviaSummary.calibration.hasDarkCurrentCalibration, true);
  assert.equal(inviaSummary.calibration.hasAlignmentData, true);

  assert.equal(inviaSummary.lasers.length, 1);
  assert.equal(inviaSummary.lasers[0].key, 'laser1');
  assert.equal(inviaSummary.lasers[0].laserName, '514 nm edge');
  assert.equal(inviaSummary.lasers[0].wavelengthNm, '514');
  assert.equal(inviaSummary.lasers[0].wavenumber, 19437.45);
  assert.equal(inviaSummary.lasers[0].mappedGratingKey, 'grating0');
  assert.equal(inviaSummary.lasers[0].staticDynamicOffset, -4.2);

  assert.equal(inviaSummary.gratings.length, 1);
  assert.equal(inviaSummary.gratings[0].gratingName, '1800 l/mm (vis)');
  assert.equal(inviaSummary.detectors.length, 1);
  assert.equal(inviaSummary.detectors[0].displayName, 'Renishaw Centrus 6RTN26');
  assert.equal(inviaSummary.motors.length, 24);
});

test('parses and analyses the fresh first-install inVia file (F8UE48)', () => {
  const freshDoc = parseRegistry(
    readAttachmentBytes('public/assets/aistudio/F8UE48_20260407_sys_719b89e1.txt'),
    { sourceName: 'F8UE48_20260407_sys.reg' },
  );

  assert.equal(freshDoc.encoding, 'utf-16le-bom');
  assert.equal(freshDoc.formatVersion, 'regedit5');
  assert.equal(freshDoc.stats.errorCount, 0);
  assert.equal(freshDoc.stats.warningCount, 0);
  assert.equal(freshDoc.stats.sectionCount, 3403);

  const freshSummary = summarizeRegistry(freshDoc);
  assert.equal(freshSummary.metadata.instrumentFamily, 'inVia');
  assert.equal(freshSummary.metadata.instrumentSerialNumber, 'F8UE48');
  assert.equal(freshSummary.metadata.wireVersion, 'WiRE 5.7, original release');
  assert.equal(freshSummary.metadata.instrumentType, 0);
  assert.equal(freshSummary.metadata.lastCollectionTimestamp, null);
  assert.equal(freshSummary.variantKindCounts.unknown, 0);
  assert.equal(freshSummary.variantKindCounts['com-array'], 0);
  assert.equal(freshSummary.variantKindCounts.date, 0);

  // Fresh install calibration state
  assert.equal(freshSummary.calibration.state, 'uncalibrated');
  assert.equal(freshSummary.calibration.calibratedTrackCount, 0);
  assert.equal(freshSummary.calibration.uncalibratedTrackCount, 8);
  assert.equal(freshSummary.calibration.totalTrackCount, 8);
  assert.equal(freshSummary.calibration.hasDarkCurrentCalibration, false);
  assert.equal(freshSummary.calibration.hasAlignmentData, false);

  // Factory default lasers (532 nm @ 18797 default, 633 nm @ 15802.8, both MaxPower 0)
  assert.equal(freshSummary.lasers.length, 2);
  assert.equal(freshSummary.lasers[0].laserName, '532 nm edge');
  assert.equal(freshSummary.lasers[0].wavenumber, 18797);
  assert.equal(freshSummary.lasers[0].maxPower, 0);
  assert.equal(freshSummary.lasers[1].laserName, '633 nm edge');
  assert.equal(freshSummary.lasers[1].wavenumber, 15802.8);
  assert.equal(freshSummary.lasers[1].maxPower, 0);

  // 4 gratings with 8 factory-default tracks (status 2, Focal Length 0 = 250)
  assert.equal(freshSummary.gratings.length, 4);
  for (const grating of freshSummary.gratings) {
    assert.equal(grating.calibrations.length, 2);
    for (const track of grating.calibrations) {
      assert.equal(track.calibrationStatus, 2);
      assert.equal(track.focalLength0, 250);
    }
  }

  assert.equal(freshSummary.detectors.length, 1);
  assert.equal(freshSummary.detectors[0].displayName, 'Renishaw Centrus AM1J73');
  assert.equal(freshSummary.motors.length, 21);
});

