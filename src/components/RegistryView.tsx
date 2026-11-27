import { useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  ArrowUpRight,
  Check,
  Copy,
  Download,
  FileCode2,
  Search,
  Upload,
} from 'lucide-react';
import { stripWdfExtension } from '../lib/format';
import {
  convertXAxis,
  fitPeakCurve,
  getSpectrum,
  interpolateAxisAtPixel,
  KNOWN_PSET_KEYS,
  type PsetObject,
  type PsetValue,
} from '../lib/wdf';
import type { LoadedRegistryFile, LoadedSample } from './Sidebar';

interface RegistryViewProps {
  samples: LoadedSample[];
  activeSampleId: string | null;
  registryFiles: LoadedRegistryFile[];
  activeRegistryId: string | null;
  onSelectRegistryFile: (id: string) => void;
  onOpenRegistryFileClick: () => void;
  onSelectSampleInSpectrum: (id: string) => void;
}

type RegistrySubTab = 'system-registry' | 'wdf-catalog';

interface SpectrumRegistryRow {
  id: string;
  fileName: string;
  title: string;
  color: string;
  folderName: string | null;
  instrumentType: string;
  spectrometerSerial: string;
  laser: string;
  grating: string;
  objective: string;
  powerLabel: string;
  acquiredAt: string;
  pointsPerSpectrum: number;
  spectraCollected: number;
  peakPosLabel: string;
  peakFwhmLabel: string;
  fitModelLabel: string;
  rawPeakX: number | null;
  rawFwhmCal: number | null;
  unitSymbol: string;
}

interface FlattenedPropertyEntry {
  keyIdHex: string;
  propertyName: string;
  blockId: string;
  valueText: string;
  isPopulated: boolean;
}

function isPsetObject(val: PsetValue): val is PsetObject {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Uint8Array);
}

function formatPsetLeaf(val: PsetValue): string {
  if (val === null) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return Number.isInteger(val) ? String(val) : Number(val.toPrecision(7)).toString();
  if (typeof val === 'string') return val.trim() || '—';
  if (val instanceof Uint8Array) return `<Binary ${val.byteLength} B>`;
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    if (val.length <= 5 && val.every((v) => typeof v !== 'object' || v === null)) {
      return `[${val.map((v) => formatPsetLeaf(v)).join(', ')}]`;
    }
    return `[Array(${val.length})]`;
  }
  return '{…}';
}

function collectPsetLeafMap(
  obj: PsetObject,
  blockId: string,
  out: Map<string, { blockId: string; valueText: string }>,
) {
  for (const [k, v] of Object.entries(obj)) {
    if (isPsetObject(v)) {
      collectPsetLeafMap(v, blockId, out);
    } else if (!out.has(k)) {
      out.set(k, { blockId, valueText: formatPsetLeaf(v) });
    }
  }
}

function escapeCsvCell(val: string | number | null): string {
  const str = val === null ? '' : String(val);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function triggerCsvDownload(csv: string, fileName: string) {
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function formatTimestampUtc(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function formatCalibrationState(state: LoadedRegistryFile['summary']['calibration']['state']): {
  label: string;
  className: string;
} {
  switch (state) {
    case 'calibrated':
      return { label: 'Calibrated', className: 'text-emerald-700' };
    case 'partial':
      return { label: 'Partial', className: 'text-amber-700' };
    case 'uncalibrated':
      return { label: 'Uncalibrated', className: 'text-amber-700' };
    default:
      return { label: 'Unknown', className: 'text-slate-600' };
  }
}

function formatInstrumentTypeCode(code: number | null): string {
  if (code === null) return '—';
  if (code === 2) return '2 (Virsa)';
  if (code === 0) return '0 (inVia)';
  return String(code);
}

async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }
}

export function RegistryView({
  samples,
  activeSampleId,
  registryFiles,
  activeRegistryId,
  onSelectRegistryFile,
  onOpenRegistryFileClick,
  onSelectSampleInSpectrum,
}: RegistryViewProps) {
  const [subTab, setSubTab] = useState<RegistrySubTab>('system-registry');
  const [sampleQuery, setSampleQuery] = useState('');
  const [keyQuery, setKeyQuery] = useState('');
  const [populatedOnly, setPopulatedOnly] = useState(true);
  const [motorQuery, setMotorQuery] = useState('');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const activeSample = samples.find((s) => s.id === activeSampleId) ?? samples[0] ?? null;
  const activeRegistry =
    registryFiles.find((r) => r.id === activeRegistryId) ?? registryFiles[0] ?? null;

  // Whenever the user selects a registry file from Explorer, ensure the System Summary view is active
  useEffect(() => {
    if (activeRegistryId) {
      setSubTab('system-registry');
    }
  }, [activeRegistryId]);

  const effectiveSubTab: RegistrySubTab =
    samples.length === 0 ? 'system-registry' : subTab;

  const spectrumRows = useMemo<SpectrumRegistryRow[]>(() => {
    return samples.map((sample) => {
      const { wdf } = sample;
      const summary = wdf.summary;
      const cleanName = stripWdfExtension(sample.fileName);
      const cleanTitle = stripWdfExtension(wdf.header.title || cleanName);

      let peakPosLabel = '—';
      let peakFwhmLabel = '—';
      let fitModelLabel = '—';
      let rawPeakX: number | null = null;
      let rawFwhmCal: number | null = null;
      let unitSymbol = wdf.xAxis?.unitsSymbol ?? '';

      if (wdf.xAxis && wdf.spectra.length > 0) {
        const converted = convertXAxis(wdf.xAxis, wdf.header.laserWavenumber, 'native');
        unitSymbol = converted.symbol;
        const yRaw = getSpectrum(wdf, 0);
        const n = Math.min(converted.values.length, yRaw.length);

        if (n > 0) {
          const pairs: Array<{ x: number; y: number }> = [];
          for (let i = 0; i < n; i++) {
            pairs.push({ x: converted.values[i], y: yRaw[i] });
          }
          pairs.sort((a, b) => a.x - b.x);
          const xs = new Float64Array(n);
          const ys = new Float64Array(n);
          let peakIdx = 0;
          for (let i = 0; i < n; i++) {
            xs[i] = pairs[i].x;
            ys[i] = pairs[i].y;
            if (ys[i] > ys[peakIdx]) peakIdx = i;
          }

          const fit = fitPeakCurve(ys, peakIdx, 'auto');
          const peakX = interpolateAxisAtPixel(xs, fit.xPeak);
          rawPeakX = peakX;
          fitModelLabel = fit.isFallback ? `${fit.modelLabel} (Fallback)` : fit.modelLabel;
          peakPosLabel = `${peakX.toFixed(2)}${unitSymbol ? ` ${unitSymbol}` : ''}`;

          if (fit.fwhm !== null && n >= 2) {
            const lo = Math.max(0, peakIdx - 1);
            const hi = Math.min(n - 1, peakIdx + 1);
            const stepX = Math.abs(xs[hi] - xs[lo]) / Math.max(1, hi - lo);
            rawFwhmCal = Number.isFinite(stepX) && stepX > 0 ? fit.fwhm * stepX : null;
            peakFwhmLabel =
              rawFwhmCal !== null
                ? `${fit.fwhm.toFixed(2)} px (${rawFwhmCal.toFixed(2)}${unitSymbol ? ` ${unitSymbol}` : ''})`
                : `${fit.fwhm.toFixed(2)} px`;
          }
        }
      }

      const laserParts: string[] = [];
      if (summary.laserName) laserParts.push(summary.laserName);
      else if (summary.laserWavelengthNm !== null) laserParts.push(`${summary.laserWavelengthNm.toFixed(2)} nm`);

      const powerParts: string[] = [];
      if (summary.effectiveLaserPowerMw !== null) {
        powerParts.push(`${Number(summary.effectiveLaserPowerMw.toFixed(2))} mW`);
      }
      if (summary.ndTransmissionPercent !== null) {
        powerParts.push(`${summary.ndTransmissionPercent}% ND`);
      }

      return {
        id: sample.id,
        fileName: cleanName,
        title: cleanTitle,
        color: sample.color,
        folderName: sample.folderName,
        instrumentType: summary.instrumentType ?? 'Renishaw Raman',
        spectrometerSerial: summary.spectrometerSerialNumber ?? '—',
        laser: laserParts.join(' · ') || '—',
        grating: summary.grating ?? '—',
        objective: summary.objective ?? (summary.objectiveMagnification ? `${summary.objectiveMagnification}x` : '—'),
        powerLabel: powerParts.join(' · ') || '—',
        acquiredAt: summary.acquisitionStart
          ? summary.acquisitionStart.replace('T', ' ').replace(/\.\d+Z$/, ' UTC')
          : '—',
        pointsPerSpectrum: wdf.header.pointsPerSpectrum,
        spectraCollected: wdf.header.spectraCollected,
        peakPosLabel,
        peakFwhmLabel,
        fitModelLabel,
        rawPeakX,
        rawFwhmCal,
        unitSymbol,
      };
    });
  }, [samples]);

  const filteredSpectrumRows = useMemo(() => {
    const q = sampleQuery.trim().toLowerCase();
    if (!q) return spectrumRows;
    return spectrumRows.filter((row) =>
      [
        row.fileName,
        row.title,
        row.folderName ?? '',
        row.instrumentType,
        row.spectrometerSerial,
        row.laser,
        row.grating,
        row.objective,
        row.fitModelLabel,
      ]
        .join(' ')
        .toLowerCase()
        .includes(q),
    );
  }, [spectrumRows, sampleQuery]);

  const psetKeyRows = useMemo<FlattenedPropertyEntry[]>(() => {
    const activeValues = new Map<string, { blockId: string; valueText: string }>();
    if (activeSample) {
      for (const [blockId, pset] of Object.entries(activeSample.wdf.propertySets)) {
        if (pset) {
          collectPsetLeafMap(pset, blockId, activeValues);
        }
      }
    }

    const rows: FlattenedPropertyEntry[] = [];
    const seenNames = new Set<string>();

    for (const [keyNumStr, name] of Object.entries(KNOWN_PSET_KEYS)) {
      const keyNum = Number(keyNumStr);
      const match = activeValues.get(name);
      seenNames.add(name);
      rows.push({
        keyIdHex: `0x${keyNum.toString(16).padStart(4, '0')}`,
        propertyName: name,
        blockId: match?.blockId ?? '—',
        valueText: match?.valueText ?? '—',
        isPopulated: Boolean(match),
      });
    }

    for (const [name, info] of activeValues.entries()) {
      if (seenNames.has(name)) continue;
      rows.push({
        keyIdHex: 'Custom',
        propertyName: name,
        blockId: info.blockId,
        valueText: info.valueText,
        isPopulated: true,
      });
    }

    rows.sort((a, b) => a.propertyName.localeCompare(b.propertyName));
    return rows;
  }, [activeSample]);

  const filteredKeyRows = useMemo(() => {
    const q = keyQuery.trim().toLowerCase();
    return psetKeyRows.filter((row) => {
      if (populatedOnly && !row.isPopulated) return false;
      if (!q) return true;
      return (
        row.propertyName.toLowerCase().includes(q) ||
        row.keyIdHex.toLowerCase().includes(q) ||
        row.blockId.toLowerCase().includes(q) ||
        row.valueText.toLowerCase().includes(q)
      );
    });
  }, [psetKeyRows, keyQuery, populatedOnly]);

  const filteredMotors = useMemo(() => {
    if (!activeRegistry) return [];
    const q = motorQuery.trim().toLowerCase();
    if (!q) return activeRegistry.summary.motors;
    return activeRegistry.summary.motors.filter((m) =>
      [m.motorName, m.key, m.units ?? ''].join(' ').toLowerCase().includes(q),
    );
  }, [activeRegistry, motorQuery]);

  const populatedCount = useMemo(() => psetKeyRows.filter((r) => r.isPopulated).length, [psetKeyRows]);

  const triggerCopied = (key: string) => {
    setCopiedKey(key);
    window.setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 1800);
  };

  const handleCopySystemSummaryJson = async () => {
    if (!activeRegistry) return;
    const { parsed, summary } = activeRegistry;
    const payload = JSON.stringify(
      {
        fileName: activeRegistry.fileName,
        parseHealth: {
          encoding: parsed.encoding,
          formatVersion: parsed.formatVersion,
          stats: parsed.stats,
          diagnostics: parsed.diagnostics,
        },
        activeSystemRoot: summary.activeSystemRoot,
        metadata: summary.metadata,
        calibration: summary.calibration,
        lasers: summary.lasers,
        gratings: summary.gratings,
        detectors: summary.detectors,
        motors: summary.motors,
      },
      null,
      2,
    );
    await copyTextToClipboard(payload);
    triggerCopied('system-json');
  };

  const handleExportWdfCsv = () => {
    const headers = [
      'File',
      'Title',
      'Instrument',
      'Spectrometer Serial',
      'Laser',
      'Grating',
      'Objective',
      'Power / ND',
      'Acquired (UTC)',
      'Points',
      'Scans',
      'Peak Position',
      'Curve Fit FWHM',
      'Fit Model',
    ];
    const lines = [
      headers.join(','),
      ...filteredSpectrumRows.map((r) =>
        [
          r.fileName,
          r.title,
          r.instrumentType,
          r.spectrometerSerial,
          r.laser,
          r.grating,
          r.objective,
          r.powerLabel,
          r.acquiredAt,
          r.pointsPerSpectrum,
          r.spectraCollected,
          r.peakPosLabel,
          r.peakFwhmLabel,
          r.fitModelLabel,
        ]
          .map(escapeCsvCell)
          .join(','),
      ),
    ];
    triggerCsvDownload(lines.join('\n'), 'wire-reader-registry.csv');
  };

  const handleCopyWdfJson = async () => {
    const payload = JSON.stringify(
      filteredSpectrumRows.map((r) => ({
        fileName: r.fileName,
        title: r.title,
        instrument: r.instrumentType,
        spectrometerSerial: r.spectrometerSerial,
        laser: r.laser,
        grating: r.grating,
        objective: r.objective,
        power: r.powerLabel,
        acquiredAt: r.acquiredAt,
        pointsPerSpectrum: r.pointsPerSpectrum,
        spectraCollected: r.spectraCollected,
        peakPosition: r.rawPeakX,
        fwhmCalibrated: r.rawFwhmCal,
        unit: r.unitSymbol,
        fitModel: r.fitModelLabel,
      })),
      null,
      2,
    );
    await copyTextToClipboard(payload);
    triggerCopied('wdf-json');
  };

  return (
    <div data-testid="registry-view" className="p-5 lg:p-6 space-y-5 max-w-[1400px]">
      {/* Page Header & Sub-View Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2.5">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight truncate">
              {effectiveSubTab === 'system-registry' && activeRegistry
                ? activeRegistry.summary.metadata.instrumentSerialNumber
                  ? `Instrument ${activeRegistry.summary.metadata.instrumentSerialNumber}`
                  : activeRegistry.fileName
                : effectiveSubTab === 'system-registry'
                  ? 'Renishaw WiRE System Registry'
                  : 'Loaded Spectra & WDF PSET Catalog'}
            </h1>
            {effectiveSubTab === 'system-registry' &&
              activeRegistry &&
              activeRegistry.summary.metadata.instrumentFamily !== 'unknown' && (
                <span className="text-sm font-medium text-slate-500">
                  {activeRegistry.summary.metadata.instrumentFamily}
                </span>
              )}
          </div>
          <p className="mt-0.5 text-xs text-slate-500 font-mono truncate">
            {effectiveSubTab === 'system-registry' && activeRegistry ? (
              <>
                {activeRegistry.fileName}
                <span className="mx-1.5 text-slate-300">·</span>
                {activeRegistry.summary.metadata.wireVersion ?? 'WiRE version not present'}
                <span className="mx-1.5 text-slate-300">·</span>
                {activeRegistry.summary.activeSystemRoot?.path ??
                  'No Renishaw WiRE system root detected'}
              </>
            ) : effectiveSubTab === 'system-registry' ? (
              'Open or drop a Renishaw WiRE Windows registry export (.reg or .rrg) to inspect system configuration and calibration readiness.'
            ) : (
              'Consolidated WDF dataset inventory with adaptive curve-fit metrics and decoded Renishaw WiRE PSET key catalog.'
            )}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          {samples.length > 0 && (
            <div
              role="group"
              aria-label="Registry sections"
              className="inline-flex rounded border border-slate-200 bg-slate-100/80 p-0.5"
            >
              <button
                type="button"
                onClick={() => setSubTab('system-registry')}
                aria-pressed={effectiveSubTab === 'system-registry'}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap transition-colors cursor-pointer ${
                  effectiveSubTab === 'system-registry'
                    ? 'bg-white text-blue-600 border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                System Registry ({registryFiles.length})
              </button>
              <button
                type="button"
                onClick={() => setSubTab('wdf-catalog')}
                aria-pressed={effectiveSubTab === 'wdf-catalog'}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap transition-colors cursor-pointer ${
                  effectiveSubTab === 'wdf-catalog'
                    ? 'bg-white text-blue-600 border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                WDF PSET Catalog ({samples.length})
              </button>
            </div>
          )}

          {effectiveSubTab === 'system-registry' ? (
            <>
              {registryFiles.length > 1 && activeRegistry && (
                <select
                  aria-label="Select loaded registry file"
                  data-testid="registry-file-select"
                  value={activeRegistry.id}
                  onChange={(e) => onSelectRegistryFile(e.target.value)}
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-600 cursor-pointer max-w-[230px]"
                >
                  {registryFiles.map((reg) => (
                    <option key={reg.id} value={reg.id}>
                      {reg.fileName}
                    </option>
                  ))}
                </select>
              )}

              {activeRegistry && (
                <button
                  type="button"
                  onClick={() => void handleCopySystemSummaryJson()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
                >
                  {copiedKey === 'system-json' ? (
                    <>
                      <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                      <span>Copied JSON</span>
                    </>
                  ) : (
                    <>
                      <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                      <span>Copy Summary JSON</span>
                    </>
                  )}
                </button>
              )}

              <button
                type="button"
                onClick={onOpenRegistryFileClick}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Open .reg / .rrg</span>
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={() => void handleCopyWdfJson()}
                disabled={filteredSpectrumRows.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap disabled:opacity-40"
              >
                {copiedKey === 'wdf-json' ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                    <span>Copied JSON</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                    <span>Copy JSON</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportWdfCsv}
                disabled={filteredSpectrumRows.length === 0}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer whitespace-nowrap disabled:opacity-40"
              >
                <Download className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Export CSV</span>
              </button>
            </>
          )}
        </div>
      </div>

      {/* Sub-Tab 1: Windows / Renishaw WiRE System Registry (.reg / .rrg) */}
      {effectiveSubTab === 'system-registry' ? (
        !activeRegistry ? (
          <div className="bg-white border border-slate-200 rounded p-8 text-center space-y-4">
            <div className="mx-auto w-10 h-10 rounded border border-slate-200 bg-slate-50 flex items-center justify-center text-slate-500">
              <FileCode2 className="w-5 h-5" aria-hidden="true" />
            </div>
            <div className="space-y-1.5 max-w-md mx-auto">
              <h2 className="text-sm font-semibold text-slate-900">
                No Registry Export Selected
              </h2>
              <p className="text-xs text-slate-500">
                Load a Windows / Renishaw WiRE <span className="font-mono">.reg</span> or{' '}
                <span className="font-mono">.rrg</span> registry export (UTF-16LE/BE or UTF-8) via the file picker, Open Folder, or drag and drop to inspect system identity, calibration readiness, lasers, gratings, detectors, and motors.
              </p>
            </div>
            <div>
              <button
                type="button"
                onClick={onOpenRegistryFileClick}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer transition-colors"
              >
                <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Open .reg / .rrg File</span>
              </button>
            </div>
          </div>
        ) : (
          (() => {
            const { parsed, summary } = activeRegistry;
            const { metadata, calibration, lasers, gratings, detectors, motors } = summary;
            const calDisplay = formatCalibrationState(calibration.state);
            const isFreshInstall =
              calibration.state === 'uncalibrated' && metadata.lastCollectionTimestamp === null;

            return (
              <div data-testid="system-registry-summary" className="space-y-5">
                {/* 1. System Identity & Calibration Readiness */}
                <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                  {/* System Identity */}
                  <section
                    aria-labelledby="reg-identity-heading"
                    className="lg:col-span-2 bg-white border border-slate-200 rounded overflow-hidden"
                  >
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <h2
                        id="reg-identity-heading"
                        className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                      >
                        System Identity
                      </h2>
                      {summary.activeSystemRoot && (
                        <span className="text-[11px] font-mono text-slate-500">
                          {summary.activeSystemRoot.wireKey} · {summary.activeSystemRoot.systemId}
                          {summary.activeSystemRoot.isWow64 ? ' · WOW6432Node' : ''}
                          {summary.systemRoots.length > 1
                            ? ` (${summary.systemRoots.length} roots detected)`
                            : ''}
                        </span>
                      )}
                    </div>

                    <div className="p-4 space-y-4">
                      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3.5 text-xs">
                        <div>
                          <dt className="text-slate-500">Serial Number</dt>
                          <dd
                            data-testid="reg-serial"
                            className="mt-0.5 font-mono text-sm font-semibold tabular-nums text-slate-900"
                          >
                            {metadata.instrumentSerialNumber ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Instrument Family</dt>
                          <dd
                            data-testid="reg-family"
                            className="mt-0.5 text-sm font-semibold text-slate-900"
                          >
                            {metadata.instrumentFamily === 'unknown'
                              ? 'Unknown'
                              : metadata.instrumentFamily}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">WiRE Version</dt>
                          <dd className="mt-0.5 font-mono text-xs font-medium text-slate-900">
                            {metadata.wireVersion ?? '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Instrument Type</dt>
                          <dd className="mt-0.5 font-mono tabular-nums text-slate-900">
                            {formatInstrumentTypeCode(metadata.instrumentType)}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">System Type Code</dt>
                          <dd className="mt-0.5 font-mono tabular-nums text-slate-900">
                            {metadata.systemTypeCode !== null ? metadata.systemTypeCode : '—'}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-slate-500">Microscope Imaging Factor</dt>
                          <dd className="mt-0.5 font-mono tabular-nums text-slate-900">
                            {metadata.microscopeImagingFactor !== null
                              ? metadata.microscopeImagingFactor
                              : '—'}
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-3">
                          <dt className="text-slate-500">Last Collection Timestamp</dt>
                          <dd className="mt-0.5 font-mono tabular-nums text-slate-900">
                            {metadata.lastCollectionTimestamp
                              ? formatTimestampUtc(metadata.lastCollectionTimestamp)
                              : isFreshInstall
                                ? 'Unset (fresh install — no collections recorded)'
                                : '—'}
                          </dd>
                        </div>
                        <div className="col-span-2 sm:col-span-3 pt-2 border-t border-slate-100">
                          <dt className="text-slate-500">Active System Root Path</dt>
                          <dd
                            data-testid="reg-system-root"
                            className="mt-0.5 font-mono text-[11px] text-slate-700 break-all"
                          >
                            {summary.activeSystemRoot?.path ??
                              'No Renishaw WiRE system root detected'}
                          </dd>
                        </div>
                      </dl>
                    </div>
                  </section>

                  {/* Calibration Readiness */}
                  <section
                    aria-labelledby="reg-calibration-heading"
                    className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col"
                  >
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                      <h2
                        id="reg-calibration-heading"
                        className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                      >
                        Calibration Readiness
                      </h2>
                      <span
                        data-testid="reg-calibration-state"
                        className={`text-xs font-semibold ${calDisplay.className}`}
                      >
                        {calDisplay.label}
                      </span>
                    </div>

                    <div className="p-4 flex-1 flex flex-col justify-between gap-4">
                      <dl className="divide-y divide-slate-100 text-xs">
                        <div className="py-2 first:pt-0 flex items-baseline justify-between gap-3">
                          <dt className="text-slate-500">Calibrated Tracks</dt>
                          <dd className="font-mono tabular-nums font-semibold text-slate-900 text-right">
                            <span data-testid="reg-calibrated-tracks">
                              {calibration.calibratedTrackCount} / {calibration.totalTrackCount}
                            </span>
                            {calibration.uncalibratedTrackCount > 0 && (
                              <span className="block text-[10px] font-sans font-normal text-slate-500">
                                {calibration.uncalibratedTrackCount} factory default (status ≠ 1)
                              </span>
                            )}
                          </dd>
                        </div>

                        <div className="py-2 flex items-baseline justify-between gap-3">
                          <dt className="text-slate-500">Dark Current Calibration</dt>
                          <dd
                            className={`font-medium ${
                              calibration.hasDarkCurrentCalibration
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {calibration.hasDarkCurrentCalibration ? 'Recorded' : 'Not recorded'}
                          </dd>
                        </div>

                        <div className="py-2 flex items-baseline justify-between gap-3">
                          <dt className="text-slate-500">Alignment Data</dt>
                          <dd
                            className={`font-medium ${
                              calibration.hasAlignmentData
                                ? 'text-emerald-700'
                                : 'text-slate-500'
                            }`}
                          >
                            {calibration.hasAlignmentData ? 'Present' : 'Not present'}
                          </dd>
                        </div>
                      </dl>

                      {/* Hardware Count Summary Strip */}
                      <div className="grid grid-cols-4 border border-slate-200 rounded bg-slate-50/70 divide-x divide-slate-200 text-center">
                        <div className="py-2 px-1">
                          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                            {lasers.length}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">
                            Lasers
                          </div>
                        </div>
                        <div className="py-2 px-1">
                          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                            {gratings.length}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">
                            Gratings
                          </div>
                        </div>
                        <div className="py-2 px-1">
                          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                            {detectors.length}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">
                            Detectors
                          </div>
                        </div>
                        <div className="py-2 px-1">
                          <div className="font-mono text-sm font-semibold tabular-nums text-slate-900">
                            {motors.length}
                          </div>
                          <div className="text-[10px] uppercase tracking-wider text-slate-500">
                            Motors
                          </div>
                        </div>
                      </div>
                    </div>
                  </section>
                </div>

                {/* 2. Lasers Table */}
                <section
                  aria-labelledby="reg-lasers-heading"
                  className="bg-white border border-slate-200 rounded overflow-hidden"
                >
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-baseline justify-between gap-2">
                    <h2
                      id="reg-lasers-heading"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                    >
                      Lasers ({lasers.length})
                    </h2>
                    <span className="text-[11px] text-slate-500">
                      Laser Collection calibration parameters and mapped grating offsets
                    </span>
                  </div>

                  {lasers.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">
                      No laser entries present in this registry export.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table
                        data-testid="reg-lasers-table"
                        className="w-full text-xs text-left border-collapse"
                      >
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 bg-white">
                            <th className="py-2 px-3.5 font-medium">Key</th>
                            <th className="py-2 px-3 font-medium">Laser Name</th>
                            <th className="py-2 px-3 font-medium text-right">Wavelength</th>
                            <th className="py-2 px-3 font-medium text-right">Wavenumber</th>
                            <th className="py-2 px-3 font-medium text-right">Max Power</th>
                            <th className="py-2 px-3 font-medium text-right">ND %</th>
                            <th className="py-2 px-3 font-medium">Mapped Grating</th>
                            <th className="py-2 px-3.5 font-medium text-right">Static/Dynamic Offset</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {lasers.map((laser) => (
                            <tr key={laser.key} className="hover:bg-slate-50">
                              <td className="py-2 px-3.5 font-mono text-slate-600 whitespace-nowrap">
                                {laser.key}
                              </td>
                              <td className="py-2 px-3 font-medium text-slate-900">
                                <span>{laser.laserName || '—'}</span>
                                {laser.modeHint && (
                                  <span className="ml-2 font-mono text-[10px] font-medium text-blue-700 bg-blue-50 border border-blue-200 px-1.5 py-0.5 rounded-xs">
                                    {laser.modeHint}
                                  </span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                {laser.wavelengthNm ? `${laser.wavelengthNm} nm` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-900 whitespace-nowrap">
                                {laser.wavenumber !== null ? `${laser.wavenumber} cm⁻¹` : '—'}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums whitespace-nowrap">
                                {laser.maxPower === null ? (
                                  <span className="text-slate-400">—</span>
                                ) : laser.maxPower === 0 ? (
                                  <span className="text-slate-500">0 mW (unset)</span>
                                ) : (
                                  <span className="text-slate-900">{laser.maxPower} mW</span>
                                )}
                              </td>
                              <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                {laser.ndPercent !== null ? `${laser.ndPercent}%` : '—'}
                              </td>
                              <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                                {laser.mappedGratingKey ?? '—'}
                              </td>
                              <td className="py-2 px-3.5 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                {laser.staticDynamicOffset !== null
                                  ? laser.staticDynamicOffset
                                  : '—'}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* 3. Gratings Table */}
                <section
                  aria-labelledby="reg-gratings-heading"
                  className="bg-white border border-slate-200 rounded overflow-hidden"
                >
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-baseline justify-between gap-2">
                    <h2
                      id="reg-gratings-heading"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                    >
                      Gratings ({gratings.length})
                    </h2>
                    <span className="text-[11px] text-slate-500">
                      Grating Collection motor assignments and track calibration status
                    </span>
                  </div>

                  {gratings.length === 0 ? (
                    <p className="p-4 text-xs text-slate-500">
                      No grating entries present in this registry export.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table
                        data-testid="reg-gratings-table"
                        className="w-full text-xs text-left border-collapse"
                      >
                        <thead>
                          <tr className="border-b border-slate-200 text-slate-500 bg-white">
                            <th className="py-2 px-3.5 font-medium">Key</th>
                            <th className="py-2 px-3 font-medium">Grating Name</th>
                            <th className="py-2 px-3 font-medium">Motor Key</th>
                            <th className="py-2 px-3 font-medium text-right">Step Size</th>
                            <th className="py-2 px-3.5 font-medium text-right">Calibration Tracks</th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                          {gratings.map((g) => {
                            const calibratedCount = g.calibrations.filter(
                              (c) => c.calibrationStatus === 1,
                            ).length;
                            const totalTracks = g.calibrations.length;
                            const factoryDefaultCount = g.calibrations.filter(
                              (c) => c.calibrationStatus === 2,
                            ).length;

                            return (
                              <tr key={g.key} className="hover:bg-slate-50">
                                <td className="py-2 px-3.5 font-mono text-slate-600 whitespace-nowrap">
                                  {g.key}
                                </td>
                                <td className="py-2 px-3 font-medium text-slate-900">
                                  {g.gratingName ?? '—'}
                                </td>
                                <td className="py-2 px-3 font-mono text-slate-700 whitespace-nowrap">
                                  {g.motorKeyName ?? '—'}
                                </td>
                                <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                  {g.stepSize !== null ? g.stepSize.toFixed(2) : '—'}
                                </td>
                                <td className="py-2 px-3.5 text-right font-mono tabular-nums whitespace-nowrap">
                                  {totalTracks === 0 ? (
                                    <span className="text-slate-400">0 tracks</span>
                                  ) : (
                                    <span>
                                      <span
                                        className={
                                          calibratedCount === totalTracks
                                            ? 'font-semibold text-emerald-700'
                                            : calibratedCount > 0
                                              ? 'font-semibold text-amber-700'
                                              : 'font-semibold text-amber-700'
                                        }
                                      >
                                        {calibratedCount}/{totalTracks} calibrated
                                      </span>
                                      {factoryDefaultCount > 0 && calibratedCount < totalTracks && (
                                        <span className="ml-1.5 font-sans text-[11px] text-slate-500">
                                          ({factoryDefaultCount} factory default)
                                        </span>
                                      )}
                                    </span>
                                  )}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </section>

                {/* 4. Detectors & Motors Grid */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {/* Detectors */}
                  <section
                    aria-labelledby="reg-detectors-heading"
                    className="bg-white border border-slate-200 rounded overflow-hidden"
                  >
                    <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200">
                      <h2
                        id="reg-detectors-heading"
                        className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                      >
                        Detectors ({detectors.length})
                      </h2>
                    </div>

                    {detectors.length === 0 ? (
                      <p className="p-4 text-xs text-slate-500">
                        No detector entries present in this registry export.
                      </p>
                    ) : (
                      <div className="divide-y divide-slate-100">
                        {detectors.map((det) => (
                          <div key={det.key} className="p-4 space-y-2.5 text-xs">
                            <div className="flex flex-wrap items-baseline justify-between gap-2">
                              <div className="font-semibold text-slate-900 text-sm">
                                {det.displayName ?? det.key}
                              </div>
                              <span className="font-mono text-[11px] text-slate-500">
                                {det.key}
                              </span>
                            </div>

                            <dl className="grid grid-cols-2 gap-x-4 gap-y-2">
                              <div>
                                <dt className="text-slate-500">Identifier</dt>
                                <dd className="font-mono text-slate-900 mt-0.5 break-all">
                                  {det.identifier ?? '—'}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500">Operating Temperature</dt>
                                <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                                  {det.operatingTemperatureC !== null
                                    ? `${det.operatingTemperatureC} °C`
                                    : '—'}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500">Array Size</dt>
                                <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                                  {det.widthPixels !== null && det.heightPixels !== null
                                    ? `${det.widthPixels} × ${det.heightPixels} px`
                                    : '—'}
                                </dd>
                              </div>
                              <div>
                                <dt className="text-slate-500">Readout Modes</dt>
                                <dd className="font-mono tabular-nums text-slate-900 mt-0.5">
                                  {det.readoutModes.length}
                                </dd>
                              </div>
                            </dl>
                          </div>
                        ))}
                      </div>
                    )}
                  </section>

                  {/* Motors */}
                  <section
                    aria-labelledby="reg-motors-heading"
                    className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col"
                  >
                    <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                      <h2
                        id="reg-motors-heading"
                        className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                      >
                        Motors ({motors.length})
                      </h2>

                      {motors.length > 6 && (
                        <div className="relative">
                          <Search
                            className="w-3 h-3 text-slate-400 absolute left-2 top-1/2 -translate-y-1/2 pointer-events-none"
                            aria-hidden="true"
                          />
                          <input
                            type="search"
                            value={motorQuery}
                            onChange={(e) => setMotorQuery(e.target.value)}
                            placeholder="Filter motors..."
                            aria-label="Filter motors"
                            className="pl-7 pr-2.5 py-0.5 w-40 rounded border border-slate-300 bg-white text-[11px] text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                          />
                        </div>
                      )}
                    </div>

                    {motors.length === 0 ? (
                      <p className="p-4 text-xs text-slate-500">
                        No motor entries present in this registry export.
                      </p>
                    ) : filteredMotors.length === 0 ? (
                      <p className="p-4 text-xs text-slate-500">
                        No motors match &ldquo;{motorQuery}&rdquo;.
                      </p>
                    ) : (
                      <div className="overflow-x-auto max-h-[340px] overflow-y-auto">
                        <table
                          data-testid="reg-motors-table"
                          className="w-full text-xs text-left border-collapse"
                        >
                          <thead className="sticky top-0 bg-white border-b border-slate-200">
                            <tr className="text-slate-500">
                              <th className="py-2 px-3.5 font-medium">Motor</th>
                              <th className="py-2 px-3 font-medium text-right">Position</th>
                              <th className="py-2 px-3.5 font-medium text-right">Status</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {filteredMotors.map((m) => {
                              const posLabel =
                                m.positionLogical !== null
                                  ? `${Number(m.positionLogical.toFixed(2))}${m.units ? ` ${m.units}` : ''}`
                                  : '—';
                              const statusBits: string[] = [];
                              if (m.present !== null) {
                                statusBits.push(m.present ? 'Present' : 'Not present');
                              }
                              if (m.motorised !== null) {
                                statusBits.push(m.motorised ? 'Motorised' : 'Manual');
                              }

                              return (
                                <tr key={m.key} className="hover:bg-slate-50">
                                  <td className="py-1.5 px-3.5 font-medium text-slate-800">
                                    {m.motorName}
                                  </td>
                                  <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-700 whitespace-nowrap">
                                    {posLabel}
                                  </td>
                                  <td className="py-1.5 px-3.5 text-right text-[11px] text-slate-600 whitespace-nowrap">
                                    {statusBits.length > 0 ? statusBits.join(' · ') : '—'}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                </div>

                {/* 5. Parse Health & Diagnostics */}
                <section
                  aria-labelledby="reg-parse-health-heading"
                  className="bg-white border border-slate-200 rounded overflow-hidden"
                >
                  <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                    <h2
                      id="reg-parse-health-heading"
                      className="text-xs font-semibold uppercase tracking-wider text-slate-700"
                    >
                      Parse Health
                    </h2>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono text-[11px] tabular-nums text-slate-600">
                      <span>
                        Encoding: <strong className="text-slate-900">{parsed.encoding}</strong>
                      </span>
                      <span>
                        Format: <strong className="text-slate-900">{parsed.formatVersion}</strong>
                      </span>
                      <span>
                        Sections:{' '}
                        <strong className="text-slate-900">
                          {parsed.stats.sectionCount.toLocaleString()}
                        </strong>
                      </span>
                      <span>
                        Entries:{' '}
                        <strong className="text-slate-900">
                          {parsed.stats.entryCount.toLocaleString()}
                        </strong>
                      </span>
                      <span>
                        Variants:{' '}
                        <strong className="text-slate-900">
                          {parsed.stats.variantSectionCount.toLocaleString()}
                        </strong>
                      </span>
                    </div>
                  </div>

                  {parsed.diagnostics.length === 0 ? (
                    <div
                      data-testid="reg-parse-clean"
                      className="px-4 py-3 text-xs text-emerald-700 font-medium"
                    >
                      Parsed cleanly · 0 errors · 0 warnings across{' '}
                      <span className="font-mono tabular-nums">
                        {parsed.stats.totalLines.toLocaleString()}
                      </span>{' '}
                      lines.
                    </div>
                  ) : (
                    <div className="space-y-0">
                      <div className="px-4 py-2.5 bg-amber-50/70 border-b border-amber-200/80 flex items-center gap-2 text-xs text-amber-900">
                        <AlertTriangle className="w-3.5 h-3.5 text-amber-600 shrink-0" aria-hidden="true" />
                        <span>
                          Recovered with{' '}
                          <strong className="font-mono tabular-nums">
                            {parsed.stats.errorCount}
                          </strong>{' '}
                          error{parsed.stats.errorCount === 1 ? '' : 's'} and{' '}
                          <strong className="font-mono tabular-nums">
                            {parsed.stats.warningCount}
                          </strong>{' '}
                          warning{parsed.stats.warningCount === 1 ? '' : 's'} (
                          {parsed.diagnostics.length} diagnostic
                          {parsed.diagnostics.length === 1 ? '' : 's'}).
                        </span>
                      </div>

                      <div className="overflow-x-auto max-h-[260px] overflow-y-auto">
                        <table
                          data-testid="reg-diagnostics-table"
                          className="w-full text-xs text-left border-collapse"
                        >
                          <thead className="sticky top-0 bg-white border-b border-slate-200">
                            <tr className="text-slate-500">
                              <th className="py-2 px-3.5 font-medium">Severity</th>
                              <th className="py-2 px-3 font-medium text-right">Line</th>
                              <th className="py-2 px-3 font-medium">Code</th>
                              <th className="py-2 px-3.5 font-medium">Message</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-100">
                            {parsed.diagnostics.map((diag, idx) => (
                              <tr key={`${diag.code}-${diag.line}-${idx}`} className="hover:bg-slate-50">
                                <td className="py-1.5 px-3.5 whitespace-nowrap">
                                  <span
                                    className={`font-mono text-[11px] font-semibold uppercase ${
                                      diag.severity === 'error'
                                        ? 'text-red-700'
                                        : diag.severity === 'warning'
                                          ? 'text-amber-700'
                                          : 'text-slate-500'
                                    }`}
                                  >
                                    {diag.severity}
                                  </span>
                                </td>
                                <td className="py-1.5 px-3 text-right font-mono tabular-nums text-slate-600 whitespace-nowrap">
                                  {diag.line}
                                </td>
                                <td className="py-1.5 px-3 font-mono text-[11px] text-slate-700 whitespace-nowrap">
                                  {diag.code}
                                </td>
                                <td className="py-1.5 px-3.5 text-slate-800">
                                  <div>{diag.message}</div>
                                  {diag.sectionPath && (
                                    <div className="font-mono text-[10px] text-slate-500 truncate max-w-[560px]">
                                      {diag.sectionPath}
                                    </div>
                                  )}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </section>
              </div>
            );
          })()
        )
      ) : (
        /* Sub-Tab 2: Existing Loaded Spectra & WDF PSET Property Key Catalog */
        <div className="space-y-6">
          <section className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  Loaded Spectra Registry ({filteredSpectrumRows.length})
                </h2>
                <span className="text-[11px] font-mono text-slate-500">
                  {samples.length} total in session
                </span>
              </div>

              <div className="relative">
                <Search
                  className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={sampleQuery}
                  onChange={(e) => setSampleQuery(e.target.value)}
                  placeholder="Filter spectra, laser, serial..."
                  aria-label="Filter loaded spectra registry"
                  className="pl-8 pr-3 py-1 w-60 rounded border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                />
              </div>
            </div>

            {filteredSpectrumRows.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-white">
                      <th className="py-2 px-3.5 font-medium">Dataset</th>
                      <th className="py-2 px-3 font-medium">Instrument / Serial</th>
                      <th className="py-2 px-3 font-medium">Laser &amp; Grating</th>
                      <th className="py-2 px-3 font-medium">Objective / Power</th>
                      <th className="py-2 px-3 font-medium text-right">Peak Position</th>
                      <th className="py-2 px-3 font-medium text-right">Adaptive FWHM</th>
                      <th className="py-2 px-3 font-medium">Acquired</th>
                      <th className="py-2 px-3 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredSpectrumRows.map((row) => {
                      const isActive = row.id === activeSample?.id;
                      return (
                        <tr
                          key={row.id}
                          className={isActive ? 'bg-blue-50/50 hover:bg-blue-50/80' : 'hover:bg-slate-50'}
                        >
                          <td className="py-2.5 px-3.5">
                            <div className="flex items-center gap-2 min-w-0">
                              <span
                                className="w-2.5 h-2.5 rounded-xs shrink-0 inline-block"
                                style={{ backgroundColor: row.color }}
                              />
                              <div className="min-w-0">
                                <div className="font-mono font-medium text-slate-900 truncate max-w-[230px]">
                                  {row.fileName}
                                </div>
                                <div className="text-[11px] text-slate-500 truncate max-w-[230px]">
                                  {row.pointsPerSpectrum.toLocaleString()} pts · {row.spectraCollected}{' '}
                                  {row.spectraCollected === 1 ? 'scan' : 'scans'}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            <div className="font-medium text-slate-800">{row.instrumentType}</div>
                            <div className="font-mono text-[11px] text-slate-500">{row.spectrometerSerial}</div>
                          </td>
                          <td className="py-2.5 px-3 text-slate-700">
                            <div>{row.laser}</div>
                            <div className="text-[11px] text-slate-500">{row.grating}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-slate-700">
                            <div>{row.objective}</div>
                            <div className="text-[11px] text-slate-500">{row.powerLabel}</div>
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums font-semibold text-slate-900 whitespace-nowrap">
                            {row.peakPosLabel}
                          </td>
                          <td className="py-2.5 px-3 text-right font-mono tabular-nums text-slate-800 whitespace-nowrap">
                            <div>{row.peakFwhmLabel}</div>
                            <div className="text-[10px] font-sans text-orange-800">{row.fitModelLabel}</div>
                          </td>
                          <td className="py-2.5 px-3 font-mono tabular-nums text-[11px] text-slate-600 whitespace-nowrap">
                            {row.acquiredAt}
                          </td>
                          <td className="py-2.5 px-3 text-right whitespace-nowrap">
                            <button
                              type="button"
                              onClick={() => onSelectSampleInSpectrum(row.id)}
                              className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-medium text-blue-700 cursor-pointer transition-colors"
                            >
                              <span>Plot</span>
                              <ArrowUpRight className="w-3 h-3" aria-hidden="true" />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-xs text-slate-500">No loaded spectra match &ldquo;{sampleQuery}&rdquo;.</p>
            )}
          </section>

          <section className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
                  WiRE PSET Property Key Registry ({filteredKeyRows.length})
                </h2>
                {activeSample && (
                  <span className="text-[11px] font-mono text-slate-500">
                    Active: {stripWdfExtension(activeSample.fileName)} · {populatedCount} populated keys
                  </span>
                )}
              </div>

              <div className="flex flex-wrap items-center gap-3">
                <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none whitespace-nowrap">
                  <input
                    type="checkbox"
                    checked={populatedOnly}
                    onChange={(e) => setPopulatedOnly(e.target.checked)}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Populated in active file only</span>
                </label>

                <div className="relative">
                  <Search
                    className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
                    aria-hidden="true"
                  />
                  <input
                    type="search"
                    value={keyQuery}
                    onChange={(e) => setKeyQuery(e.target.value)}
                    placeholder="Search key ID, name, or value..."
                    aria-label="Filter WiRE property key registry"
                    className="pl-8 pr-3 py-1 w-60 rounded border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            </div>

            {filteredKeyRows.length > 0 ? (
              <div className="overflow-x-auto max-h-[420px] overflow-y-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead className="sticky top-0 bg-white border-b border-slate-200">
                    <tr className="text-slate-500">
                      <th className="py-2 px-3.5 font-medium">Key ID</th>
                      <th className="py-2 px-3 font-medium">Property Name</th>
                      <th className="py-2 px-3 font-medium">Block</th>
                      <th className="py-2 px-3.5 font-medium text-right">Active File Value</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {filteredKeyRows.map((entry) => (
                      <tr key={`${entry.keyIdHex}-${entry.propertyName}`} className="hover:bg-slate-50">
                        <td className="py-1.5 px-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                          {entry.keyIdHex}
                        </td>
                        <td className="py-1.5 px-3 font-medium text-slate-800">{entry.propertyName}</td>
                        <td className="py-1.5 px-3 font-mono text-[11px] text-slate-600 whitespace-nowrap">
                          {entry.blockId}
                        </td>
                        <td className="py-1.5 px-3.5 text-right font-mono tabular-nums text-slate-900 break-all max-w-[360px]">
                          {entry.valueText}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="p-4 text-xs text-slate-500">No WiRE property keys match the current filter.</p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
