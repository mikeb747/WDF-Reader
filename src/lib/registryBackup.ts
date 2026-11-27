/**
 * Utilities for identifying Renishaw WiRE dated registry backup files
 * (`<Serial Number>_YYYYMMDD_sys.rrg` and `<Serial Number>_YYYYMMDD_usr.rrg` / `_use.rrg`)
 * and determining the most recent backup per folder/serial/type.
 */

export interface RrgBackupInfo {
  serialNumber: string;
  /** Numeric YYYYMMDD stamp for chronological comparison (e.g. 20250813). */
  dateStamp: number;
  /** ISO-like YYYY-MM-DD display date for tooltips. */
  dateFormatted: string;
  /** Backup type: 'sys' (system/HKLM), 'usr' (user/HKCU, matches _usr and _use), or 'other'. */
  kind: 'sys' | 'usr' | 'other';
}

const TYPED_RRG_PATTERN = /^(.+?)_(\d{4})(\d{2})(\d{2})_(sys|usr|use)\.rrg$/i;
const GENERIC_DATED_RRG_PATTERN = /^(.+?)_(\d{4})(\d{2})(\d{2})(?:_[^.]+)?\.rrg$/i;

function isValidCalendarDate(year: number, month: number, day: number): boolean {
  if (year < 1990 || year > 2100) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;
  const dt = new Date(Date.UTC(year, month - 1, day));
  return (
    dt.getUTCFullYear() === year &&
    dt.getUTCMonth() === month - 1 &&
    dt.getUTCDate() === day
  );
}

/**
 * Parse `<Serial Number>_YYYYMMDD_sys.rrg`, `<Serial Number>_YYYYMMDD_usr.rrg`,
 * or `_use.rrg` (plus generic `<Serial Number>_YYYYMMDD*.rrg` backups) into structured date metadata.
 */
export function parseRrgBackupMeta(fileName: string): RrgBackupInfo | null {
  const trimmed = fileName.trim();
  const typedMatch = trimmed.match(TYPED_RRG_PATTERN);
  if (typedMatch) {
    const [, serial, yStr, mStr, dStr, kindRaw] = typedMatch;
    const year = Number(yStr);
    const month = Number(mStr);
    const day = Number(dStr);
    if (!isValidCalendarDate(year, month, day)) return null;
    const lowerKind = kindRaw.toLowerCase();
    return {
      serialNumber: serial.trim(),
      dateStamp: year * 10000 + month * 100 + day,
      dateFormatted: `${yStr}-${mStr}-${dStr}`,
      kind: lowerKind === 'sys' ? 'sys' : 'usr',
    };
  }

  const genericMatch = trimmed.match(GENERIC_DATED_RRG_PATTERN);
  if (genericMatch) {
    const [, serial, yStr, mStr, dStr] = genericMatch;
    const year = Number(yStr);
    const month = Number(mStr);
    const day = Number(dStr);
    if (!isValidCalendarDate(year, month, day)) return null;
    return {
      serialNumber: serial.trim(),
      dateStamp: year * 10000 + month * 100 + day,
      dateFormatted: `${yStr}-${mStr}-${dStr}`,
      kind: 'other',
    };
  }

  return null;
}

/**
 * Return a Map of `file.id -> RrgBackupInfo` for the most recent dated `.rrg`
 * backup file(s) within each `(folderName, serialNumber, kind)` group.
 */
export function findMostRecentRrgIds(
  files: ReadonlyArray<{ id: string; fileName: string; folderName: string | null }>,
): Map<string, RrgBackupInfo> {
  const maxDateByGroup = new Map<string, number>();
  const parsedEntries: Array<{ id: string; groupKey: string; info: RrgBackupInfo }> = [];

  for (const file of files) {
    const info = parseRrgBackupMeta(file.fileName);
    if (!info) continue;
    const groupKey = `${file.folderName ?? '__root__'}::${info.serialNumber.toUpperCase()}::${info.kind}`;
    parsedEntries.push({ id: file.id, groupKey, info });
    const prevMax = maxDateByGroup.get(groupKey);
    if (prevMax === undefined || info.dateStamp > prevMax) {
      maxDateByGroup.set(groupKey, info.dateStamp);
    }
  }

  const winners = new Map<string, RrgBackupInfo>();
  for (const entry of parsedEntries) {
    if (entry.info.dateStamp === maxDateByGroup.get(entry.groupKey)) {
      winners.set(entry.id, entry.info);
    }
  }
  return winners;
}
