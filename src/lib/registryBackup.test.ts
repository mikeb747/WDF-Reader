import assert from 'node:assert/strict';
import test from 'node:test';
import { findMostRecentRrgIds, parseRrgBackupMeta } from './registryBackup';

test('parseRrgBackupMeta parses <Serial>_YYYYMMDD_sys.rrg, _usr.rrg, and _use.rrg filenames', () => {
  const sys = parseRrgBackupMeta('AJ4F17_20250813_sys.rrg');
  assert.deepEqual(sys, {
    serialNumber: 'AJ4F17',
    dateStamp: 20250813,
    dateFormatted: '2025-08-13',
    kind: 'sys',
  });

  const usr = parseRrgBackupMeta('G42K00_20261019_usr.rrg');
  assert.deepEqual(usr, {
    serialNumber: 'G42K00',
    dateStamp: 20261019,
    dateFormatted: '2026-10-19',
    kind: 'usr',
  });

  const use = parseRrgBackupMeta('AJ4F17_20260407_use.RRG');
  assert.deepEqual(use, {
    serialNumber: 'AJ4F17',
    dateStamp: 20260407,
    dateFormatted: '2026-04-07',
    kind: 'usr',
  });

  // Plain .reg files and invalid calendar dates are ignored
  assert.equal(parseRrgBackupMeta('ANJ351_AGENZIA_inVia.reg'), null);
  assert.equal(parseRrgBackupMeta('AJ4F17_20251345_sys.rrg'), null);
});

test('findMostRecentRrgIds highlights the newest sys and usr backups per folder independently', () => {
  const files = [
    { id: 'f1', fileName: 'AJ4F17_20240110_sys.rrg', folderName: 'SystemA/Backups' },
    { id: 'f2', fileName: 'AJ4F17_20250813_sys.rrg', folderName: 'SystemA/Backups' },
    { id: 'f3', fileName: 'AJ4F17_20250305_sys.rrg', folderName: 'SystemA/Backups' },
    { id: 'f4', fileName: 'AJ4F17_20240110_usr.rrg', folderName: 'SystemA/Backups' },
    { id: 'f5', fileName: 'AJ4F17_20250813_usr.rrg', folderName: 'SystemA/Backups' },
    // Different folder with older latest backup
    { id: 'f6', fileName: 'AJ4F17_20231101_sys.rrg', folderName: 'SystemA/Archive' },
    { id: 'f7', fileName: 'AJ4F17_20240220_sys.rrg', folderName: 'SystemA/Archive' },
  ];

  const winners = findMostRecentRrgIds(files);
  assert.equal(winners.has('f1'), false);
  assert.equal(winners.has('f2'), true);
  assert.equal(winners.has('f3'), false);
  assert.equal(winners.has('f4'), false);
  assert.equal(winners.has('f5'), true);
  assert.equal(winners.has('f6'), false);
  assert.equal(winners.has('f7'), true);
});
