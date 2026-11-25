import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileCode2,
  FileSpreadsheet,
  FolderOpen,
  Upload,
} from 'lucide-react';
import type { WdfFile } from '../lib/wdf';
import { PWAInstallButton } from './PWAInstallButton';
import { TRACE_COLOR_PALETTE, TraceColorPicker } from './TraceColorPicker';

export { TRACE_COLOR_PALETTE };

export interface LoadedSample {
  id: string;
  fileName: string;
  sourceLabel: string;
  bytes: Uint8Array;
  wdf: WdfFile;
  visible: boolean;
  color: string;
}

interface SidebarProps {
  samples: LoadedSample[];
  selectedId: string | null;
  onSelectSample: (id: string) => void;
  onToggleSampleVisible: (id: string) => void;
  onSetAllVisible: (visible: boolean) => void;
  onChangeSampleColor: (id: string, color: string) => void;
  onOpenFileClick: () => void;
  onOpenFolderClick: () => void;
  onDownloadCsv: () => void;
  onDownloadJson: () => void;
  onDownloadTsModule: () => void;
  isDraggingFile: boolean;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

export function Sidebar({
  samples,
  selectedId,
  onSelectSample,
  onToggleSampleVisible,
  onSetAllVisible,
  onChangeSampleColor,
  onOpenFileClick,
  onOpenFolderClick,
  onDownloadCsv,
  onDownloadJson,
  onDownloadTsModule,
  isDraggingFile,
}: SidebarProps) {
  const [laserExpanded, setLaserExpanded] = useState(false);
  const active = samples.find((s) => s.id === selectedId) ?? null;
  const summary = active?.wdf.summary ?? null;
  const visibleCount = samples.filter((s) => s.visible).length;
  const allVisible = samples.length > 0 && visibleCount === samples.length;

  const summaryRows: Array<{ label: string; value: string; mono?: boolean }> = summary
    ? [
        { label: 'Instrument', value: summary.instrumentType ?? 'Renishaw Raman' },
        { label: 'Software', value: summary.application, mono: true },
        { label: 'Operator', value: summary.operator || '—' },
        { label: 'Scan Mode', value: `${summary.measurementType} · ${summary.scanType}` },
        {
          label: 'Laser',
          value: summary.laserName
            ? `${summary.laserName}${summary.laserWavelengthNm ? ` (${summary.laserWavelengthNm.toFixed(2)} nm)` : ''}`
            : summary.laserWavelengthNm
              ? `${summary.laserWavelengthNm.toFixed(2)} nm`
              : '—',
          mono: true,
        },
        { label: 'Grating', value: summary.grating ?? '—' },
        {
          label: 'Objective',
          value: summary.objective ?? (summary.objectiveMagnification ? `${summary.objectiveMagnification}x` : '—'),
        },
        {
          label: 'Exposure',
          value:
            summary.exposureTimeMs !== null
              ? `${summary.exposureTimeMs.toLocaleString()} ms × ${summary.accumulations}`
              : `${summary.accumulations} accum`,
          mono: true,
        },
        {
          label: 'ND Filter',
          value: summary.ndTransmissionPercent !== null ? `${summary.ndTransmissionPercent}%` : '—',
          mono: true,
        },
        {
          label: 'Slit Opening',
          value:
            summary.slitOpening || summary.slitBeamCentre
              ? `${summary.slitOpening ?? '—'} (centre ${summary.slitBeamCentre ?? '—'})`
              : '—',
          mono: true,
        },
        {
          label: 'Stage XYZ',
          value: summary.stagePosition
            ? `${summary.stagePosition.x}, ${summary.stagePosition.y}, ${summary.stagePosition.z} µm`
            : '—',
          mono: true,
        },
        {
          label: 'Binning',
          value:
            summary.xBinning !== null && summary.yBinning !== null
              ? `X=${summary.xBinning}, Y=${summary.yBinning}`
              : '—',
          mono: true,
        },
        {
          label: 'Duration',
          value: summary.scanDurationMs !== null ? `${summary.scanDurationMs.toLocaleString()} ms` : '—',
          mono: true,
        },
        { label: 'Captured', value: formatTimestamp(summary.acquisitionStart), mono: true },
        {
          label: 'Hardware IDs',
          value: [
            summary.spectrometerSerialNumber ? `Spec ${summary.spectrometerSerialNumber}` : null,
            summary.ccdSerialNumber ? `CCD ${summary.ccdSerialNumber}` : null,
          ]
            .filter(Boolean)
            .join(' · ') || '—',
          mono: true,
        },
      ]
    : [];

  return (
    <aside className="w-full lg:w-80 xl:w-84 bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col shrink-0 lg:overflow-y-auto">
      {/* Sample Files Selector */}
      <section className="p-4 border-b border-slate-200">
        <div className="flex items-center justify-between gap-2 mb-2.5">
          <div className="flex items-baseline gap-2">
            <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
              Loaded WDF Files
            </h2>
            <span className="text-[11px] font-mono tabular-nums text-slate-500">
              {visibleCount}/{samples.length} shown
            </span>
          </div>

          {samples.length > 1 && (
            <button
              type="button"
              onClick={() => onSetAllVisible(!allVisible)}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-700 cursor-pointer whitespace-nowrap"
            >
              {allVisible ? 'Isolate Active' : 'Show All'}
            </button>
          )}
        </div>

        <div
          className="space-y-1.5 max-h-64 overflow-y-auto pr-0.5"
          role="listbox"
          aria-label="Loaded WDF files"
        >
          {samples.map((sample) => {
            const isSelected = sample.id === selectedId;
            return (
              <div
                key={sample.id}
                role="option"
                aria-selected={isSelected}
                onClick={() => onSelectSample(sample.id)}
                className={`w-full text-left px-2.5 py-2 rounded border transition-colors cursor-pointer ${
                  isSelected
                    ? 'bg-blue-50/70 border-blue-600 text-slate-900'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0 flex-1">
                    <input
                      type="checkbox"
                      checked={sample.visible}
                      aria-label={`Plot ${sample.fileName} on spectrum viewer`}
                      title="Tick to view this file on the spectrum chart"
                      onClick={(e) => e.stopPropagation()}
                      onChange={() => onToggleSampleVisible(sample.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
                    />

                    <TraceColorPicker
                      color={sample.color}
                      fileName={sample.fileName}
                      onChange={(newColor) => onChangeSampleColor(sample.id, newColor)}
                    />

                    <span
                      className={`text-xs truncate ${
                        isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
                      }`}
                      title={sample.fileName}
                    >
                      {sample.fileName}
                    </span>
                  </div>
                </div>

                <div className="mt-1 pl-9 flex items-center justify-between gap-2 text-[11px] font-mono tabular-nums text-slate-500">
                  <span className="truncate">
                    {sample.wdf.summary.xAxisUnits === 'Absolute Wavenumber'
                      ? 'Abs. cm⁻¹'
                      : sample.wdf.summary.xAxisUnits}
                  </span>
                  <span className="whitespace-nowrap shrink-0">
                    {sample.wdf.header.pointsPerSpectrum} pts · {formatBytes(sample.wdf.byteLength)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>

        {/* File & Directory Loader Controls */}
        <div className="mt-3 grid grid-cols-2 gap-1.5">
          <button
            type="button"
            onClick={onOpenFileClick}
            className={`px-2.5 py-2 rounded border border-dashed text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
              isDraggingFile
                ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                : 'border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 hover:text-slate-900'
            }`}
          >
            <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Open Files</span>
          </button>

          <button
            type="button"
            onClick={onOpenFolderClick}
            className={`px-2.5 py-2 rounded border border-dashed text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
              isDraggingFile
                ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                : 'border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 hover:text-slate-900'
            }`}
            title="Select a folder and load all Renishaw .wdf files inside it"
          >
            <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
            <span>Open Folder</span>
          </button>
        </div>
      </section>

      {/* Acquisition Summary Table */}
      <section className="p-4 border-b border-slate-200 flex-1">
        <div className="flex items-center justify-between mb-2.5">
          <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
            Acquisition Summary
          </h2>
          {active && (
            <span className="text-[11px] font-mono tabular-nums text-slate-500">
              {active.wdf.blocks.length} blocks
            </span>
          )}
        </div>

        {summary ? (
          <dl className="divide-y divide-slate-100 text-xs">
            {summaryRows.map((row) => {
              if (row.label === 'Laser') {
                const hasLaserMetrics =
                  summary.laserWavelengthNm !== null || summary.laserWavenumberCm1 !== null;
                return (
                  <div key={row.label} className="py-1">
                    <button
                      type="button"
                      onClick={() => setLaserExpanded((prev) => !prev)}
                      aria-expanded={laserExpanded}
                      className="w-full py-0.5 flex items-baseline justify-between gap-2 text-left group cursor-pointer rounded hover:bg-slate-50 -mx-1 px-1 transition-colors"
                      title="Click to show exact laser wavelength (nm) and absolute wavenumber (cm⁻¹)"
                    >
                      <dt className="text-slate-500 group-hover:text-blue-600 shrink-0 inline-flex items-center gap-1 transition-colors">
                        {laserExpanded ? (
                          <ChevronDown className="w-3 h-3 text-blue-600 shrink-0" aria-hidden="true" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-slate-400 group-hover:text-blue-600 shrink-0" aria-hidden="true" />
                        )}
                        <span>{row.label}</span>
                      </dt>
                      <dd
                        className="text-blue-600 group-hover:text-blue-700 text-right truncate font-mono tabular-nums text-[11px] font-medium"
                        title={row.value}
                      >
                        {row.value}
                      </dd>
                    </button>
                    {laserExpanded && (
                      <div className="mt-1.5 mb-1 ml-3.5 pl-2.5 pr-2 py-2 rounded border border-slate-200 bg-slate-50 space-y-1 text-[11px]">
                        {hasLaserMetrics ? (
                          <>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-slate-500">Wavelength</span>
                              <span className="font-mono tabular-nums font-semibold text-slate-900">
                                {summary.laserWavelengthNm !== null
                                  ? `${summary.laserWavelengthNm.toFixed(4)} nm`
                                  : '—'}
                              </span>
                            </div>
                            <div className="flex items-baseline justify-between gap-2">
                              <span className="text-slate-500">Absolute cm⁻¹</span>
                              <span className="font-mono tabular-nums font-semibold text-slate-900">
                                {summary.laserWavenumberCm1 !== null
                                  ? `${summary.laserWavenumberCm1.toLocaleString(undefined, {
                                      minimumFractionDigits: 2,
                                      maximumFractionDigits: 2,
                                    })} cm⁻¹`
                                  : '—'}
                              </span>
                            </div>
                          </>
                        ) : (
                          <div className="text-slate-500">Laser calibration value not recorded.</div>
                        )}
                      </div>
                    )}
                  </div>
                );
              }
              return (
                <div key={row.label} className="py-1.5 flex items-baseline justify-between gap-3">
                  <dt className="text-slate-500 shrink-0">{row.label}</dt>
                  <dd
                    className={`text-slate-900 text-right truncate ${
                      row.mono ? 'font-mono tabular-nums text-[11px]' : 'font-medium'
                    }`}
                    title={row.value}
                  >
                    {row.value}
                  </dd>
                </div>
              );
            })}
          </dl>
        ) : (
          <p className="text-xs text-slate-500">Select or upload a .wdf file to inspect parameters.</p>
        )}
      </section>

      {/* Quick Exports */}
      <section className="p-4 bg-slate-50/70">
        <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-2.5">
          Export Artifacts
        </h2>
        <div className="grid grid-cols-1 gap-1.5">
          <button
            type="button"
            disabled={!active}
            onClick={onDownloadTsModule}
            className="w-full px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 text-xs font-medium text-slate-800 flex items-center justify-between transition-colors cursor-pointer"
          >
            <span className="flex items-center gap-2">
              <FileCode2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
              <span>wdfReader.ts (Digital-Traveller)</span>
            </span>
            <Download className="w-3.5 h-3.5 text-slate-400" aria-hidden="true" />
          </button>

          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              disabled={!active}
              onClick={onDownloadCsv}
              className="px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 text-xs font-medium text-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <FileSpreadsheet className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>CSV</span>
            </button>
            <button
              type="button"
              disabled={!active}
              onClick={onDownloadJson}
              className="px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 disabled:opacity-40 text-xs font-medium text-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer whitespace-nowrap"
            >
              <Download className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>JSON</span>
            </button>
          </div>

          <PWAInstallButton />
        </div>
      </section>
    </aside>
  );
}
