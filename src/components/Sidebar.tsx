import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FileCode2,
  Folder,
  FolderOpen,
  GripHorizontal,
  GripVertical,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { stripWdfExtension } from '../lib/format';
import type { WdfFile } from '../lib/wdf';
import type { ParsedRegistry, RegistryAnalysisSummary } from '../registry';
import { TRACE_COLOR_PALETTE, TraceColorPicker } from './TraceColorPicker';

export { TRACE_COLOR_PALETTE };

export interface LoadedSample {
  id: string;
  fileName: string;
  folderName: string | null;
  sourceLabel: string;
  bytes: Uint8Array;
  wdf: WdfFile;
  visible: boolean;
  color: string;
}

export interface LoadedRegistryFile {
  id: string;
  fileName: string;
  folderName: string | null;
  sourceLabel: string;
  bytes: Uint8Array;
  parsed: ParsedRegistry;
  summary: RegistryAnalysisSummary;
}

export type ExplorerSelectionKind = 'wdf' | 'registry';

interface SidebarProps {
  samples: LoadedSample[];
  registryFiles: LoadedRegistryFile[];
  selectedId: string | null;
  selectedRegistryId: string | null;
  activeSelectionKind: ExplorerSelectionKind;
  onSelectSample: (id: string) => void;
  onSelectRegistryFile: (id: string) => void;
  onToggleSampleVisible: (id: string) => void;
  onToggleFolderVisible: (folderName: string) => void;
  onSetSamplesVisible: (ids: string[], visible: boolean) => void;
  onUnloadSample: (id: string) => void;
  onUnloadSamples: (ids: string[]) => void;
  onUnloadRegistryFile: (id: string) => void;
  onUnloadFolder: (folderName: string) => void;
  onSetAllVisible: (visible: boolean) => void;
  onChangeSampleColor: (id: string, color: string) => void;
  onOpenFileClick: () => void;
  onOpenFolderClick: () => void;
  isDraggingFile: boolean;
}

type PendingUnload =
  | { type: 'file'; id: string; label: string }
  | { type: 'registry'; id: string; label: string }
  | { type: 'folder'; folderName: string; fileCount: number }
  | { type: 'batch'; ids: string[] };

const DEFAULT_SIDEBAR_WIDTH = 320;
const MIN_SIDEBAR_WIDTH = 256;
const MAX_SIDEBAR_WIDTH = 680;
/** Default max height accommodates ~8 compact single-line file items before scrolling */
const DEFAULT_MAX_FILES_LIST_HEIGHT = 276;
const MIN_FILES_LIST_HEIGHT = 72;

function formatTimestamp(iso: string | null): string {
  if (!iso) return '—';
  return iso.replace('T', ' ').replace(/\.\d+Z$/, ' UTC');
}

function formatPowerMw(mw: number): string {
  return `${Number(mw.toFixed(2))} mW`;
}

function formatCalibrationStateLabel(state: RegistryAnalysisSummary['calibration']['state']): string {
  switch (state) {
    case 'calibrated':
      return 'Calibrated';
    case 'partial':
      return 'Partial';
    case 'uncalibrated':
      return 'Uncalibrated';
    default:
      return 'Unknown';
  }
}

interface FolderCheckboxProps {
  checked: boolean;
  indeterminate: boolean;
  folderName: string;
  onChange: () => void;
}

function FolderCheckbox({ checked, indeterminate, folderName, onChange }: FolderCheckboxProps) {
  const ref = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (ref.current) {
      ref.current.indeterminate = indeterminate;
    }
  }, [indeterminate]);

  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      aria-label={`Show all files in folder ${folderName}`}
      title={`Tick to show or hide all spectra in ${folderName}`}
      onClick={(e) => e.stopPropagation()}
      onChange={onChange}
      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
    />
  );
}

export function Sidebar({
  samples,
  registryFiles,
  selectedId,
  selectedRegistryId,
  activeSelectionKind,
  onSelectSample,
  onSelectRegistryFile,
  onToggleSampleVisible,
  onToggleFolderVisible,
  onSetSamplesVisible,
  onUnloadSample,
  onUnloadSamples,
  onUnloadRegistryFile,
  onUnloadFolder,
  onSetAllVisible,
  onChangeSampleColor,
  onOpenFileClick,
  onOpenFolderClick,
  isDraggingFile,
}: SidebarProps) {
  const [summaryExpanded, setSummaryExpanded] = useState(false);
  const [laserExpanded, setLaserExpanded] = useState(false);
  const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
  const [multiSelectedIds, setMultiSelectedIds] = useState<string[]>([]);
  const [selectionAnchorId, setSelectionAnchorId] = useState<string | null>(null);
  const [pendingUnload, setPendingUnload] = useState<PendingUnload | null>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(DEFAULT_SIDEBAR_WIDTH);
  const [customListHeight, setCustomListHeight] = useState<number | null>(null);
  const [isResizingWidth, setIsResizingWidth] = useState(false);
  const [isResizingList, setIsResizingList] = useState(false);
  const listContainerRef = useRef<HTMLDivElement | null>(null);

  const active = samples.find((s) => s.id === selectedId) ?? null;
  const activeRegistry = registryFiles.find((r) => r.id === selectedRegistryId) ?? null;
  const showRegistrySummary = activeSelectionKind === 'registry' && activeRegistry !== null;
  const summary = active?.wdf.summary ?? null;
  const visibleCount = samples.filter((s) => s.visible).length;
  const allVisible = samples.length > 0 && visibleCount === samples.length;
  const totalLoadedCount = samples.length + registryFiles.length;

  // Prune any unloaded sample IDs from multi-selection automatically
  const activeMultiSelectedIds = useMemo(() => {
    const validIds = new Set(samples.map((s) => s.id));
    return multiSelectedIds.filter((id) => validIds.has(id));
  }, [multiSelectedIds, samples]);

  const multiSelectedSet = useMemo(() => new Set(activeMultiSelectedIds), [activeMultiSelectedIds]);
  const isMultiSelectActive = activeMultiSelectedIds.length > 1;

  useEffect(() => {
    if (!pendingUnload && !isMultiSelectActive) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (pendingUnload) {
          setPendingUnload(null);
        } else if (isMultiSelectActive) {
          setMultiSelectedIds([]);
        }
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [pendingUnload, isMultiSelectActive]);

  // Separate ungrouped files from folder-grouped files while preserving order (supports both .wdf and .reg/.rrg)
  const { ungroupedSamples, ungroupedRegistries, folderGroups } = useMemo(() => {
    const ungroupedWdf: LoadedSample[] = [];
    const ungroupedReg: LoadedRegistryFile[] = [];
    const map = new Map<
      string,
      { samples: LoadedSample[]; registries: LoadedRegistryFile[] }
    >();

    for (const sample of samples) {
      if (!sample.folderName) {
        ungroupedWdf.push(sample);
      } else {
        const entry = map.get(sample.folderName);
        if (entry) {
          entry.samples.push(sample);
        } else {
          map.set(sample.folderName, { samples: [sample], registries: [] });
        }
      }
    }

    for (const reg of registryFiles) {
      if (!reg.folderName) {
        ungroupedReg.push(reg);
      } else {
        const entry = map.get(reg.folderName);
        if (entry) {
          entry.registries.push(reg);
        } else {
          map.set(reg.folderName, { samples: [], registries: [reg] });
        }
      }
    }

    return {
      ungroupedSamples: ungroupedWdf,
      ungroupedRegistries: ungroupedReg,
      folderGroups: Array.from(map.entries()).map(([folderName, group]) => ({
        folderName,
        items: group.samples,
        registries: group.registries,
      })),
    };
  }, [samples, registryFiles]);

  // Visual top-to-bottom order of currently displayed WDF rows for Shift+Click range selection
  const orderedVisibleFileIds = useMemo(() => {
    const ids: string[] = ungroupedSamples.map((s) => s.id);
    for (const group of folderGroups) {
      if (expandedFolders[group.folderName]) {
        for (const item of group.items) {
          ids.push(item.id);
        }
      }
    }
    return ids;
  }, [ungroupedSamples, folderGroups, expandedFolders]);

  const selectedBatchSamples = useMemo(
    () => samples.filter((s) => multiSelectedSet.has(s.id)),
    [samples, multiSelectedSet],
  );
  const anySelectedHidden = selectedBatchSamples.some((s) => !s.visible);
  const anySelectedVisible = selectedBatchSamples.some((s) => s.visible);

  const toggleFolderExpanded = (folderName: string) => {
    setExpandedFolders((prev) => ({
      ...prev,
      [folderName]: !prev[folderName],
    }));
  };

  const handleRowClick = (sampleId: string, e: React.MouseEvent) => {
    if (e.shiftKey) {
      e.preventDefault();
      const anchor = selectionAnchorId ?? selectedId ?? orderedVisibleFileIds[0] ?? sampleId;
      const anchorIdx = orderedVisibleFileIds.indexOf(anchor);
      const targetIdx = orderedVisibleFileIds.indexOf(sampleId);
      if (anchorIdx !== -1 && targetIdx !== -1) {
        const start = Math.min(anchorIdx, targetIdx);
        const end = Math.max(anchorIdx, targetIdx);
        const range = orderedVisibleFileIds.slice(start, end + 1);
        if (e.ctrlKey || e.metaKey) {
          setMultiSelectedIds((prev) => Array.from(new Set([...prev, ...range])));
        } else {
          setMultiSelectedIds(range);
        }
      } else {
        setMultiSelectedIds([sampleId]);
      }
      if (!selectionAnchorId) {
        setSelectionAnchorId(anchor);
      }
      return;
    }

    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      setMultiSelectedIds((prev) => {
        const base = prev.length > 0 ? prev : selectedId ? [selectedId] : [];
        const exists = base.includes(sampleId);
        const next = exists ? base.filter((id) => id !== sampleId) : [...base, sampleId];
        return next;
      });
      setSelectionAnchorId(sampleId);
      return;
    }

    // Standard single click clears multi-selection and activates the clicked file
    setMultiSelectedIds([sampleId]);
    setSelectionAnchorId(sampleId);
    onSelectSample(sampleId);
  };

  const handleConfirmUnload = () => {
    if (!pendingUnload) return;
    if (pendingUnload.type === 'file') {
      onUnloadSample(pendingUnload.id);
      setMultiSelectedIds((prev) => prev.filter((id) => id !== pendingUnload.id));
    } else if (pendingUnload.type === 'registry') {
      onUnloadRegistryFile(pendingUnload.id);
    } else if (pendingUnload.type === 'batch') {
      onUnloadSamples(pendingUnload.ids);
      setMultiSelectedIds([]);
      setSelectionAnchorId(null);
    } else {
      onUnloadFolder(pendingUnload.folderName);
      setExpandedFolders((prev) => {
        const next = { ...prev };
        delete next[pendingUnload.folderName];
        return next;
      });
    }
    setPendingUnload(null);
  };

  // Drag handle: expand/shrink left panel horizontally
  const handleStartWidthResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startX = e.clientX;
    const startWidth = sidebarWidth;
    setIsResizingWidth(true);

    const onMove = (ev: PointerEvent) => {
      const next = Math.max(
        MIN_SIDEBAR_WIDTH,
        Math.min(MAX_SIDEBAR_WIDTH, startWidth + (ev.clientX - startX)),
      );
      setSidebarWidth(next);
    };

    const onUp = () => {
      setIsResizingWidth(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

  // Drag handle: expand/shrink Explorer list vertically
  const handleStartListResize = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const startY = e.clientY;
    const currentHeight =
      customListHeight ?? listContainerRef.current?.getBoundingClientRect().height ?? 160;
    setIsResizingList(true);

    const onMove = (ev: PointerEvent) => {
      const maxH = Math.max(260, window.innerHeight - 210);
      const next = Math.max(MIN_FILES_LIST_HEIGHT, Math.min(maxH, currentHeight + (ev.clientY - startY)));
      setCustomListHeight(next);
    };

    const onUp = () => {
      setIsResizingList(false);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
  };

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
          label: 'Power',
          value:
            summary.effectiveLaserPowerMw !== null
              ? formatPowerMw(summary.effectiveLaserPowerMw)
              : '—',
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
          value:
            [
              summary.spectrometerSerialNumber ? `Spec ${summary.spectrometerSerialNumber}` : null,
              summary.ccdSerialNumber ? `CCD ${summary.ccdSerialNumber}` : null,
            ]
              .filter(Boolean)
              .join(' · ') || '—',
          mono: true,
        },
      ]
    : [];

  const registrySummaryRows: Array<{ label: string; value: string; mono?: boolean }> = activeRegistry
    ? [
        { label: 'File', value: activeRegistry.fileName, mono: true },
        {
          label: 'Family',
          value:
            activeRegistry.summary.metadata.instrumentFamily === 'unknown'
              ? 'Unknown'
              : activeRegistry.summary.metadata.instrumentFamily,
        },
        {
          label: 'Serial',
          value: activeRegistry.summary.metadata.instrumentSerialNumber ?? '—',
          mono: true,
        },
        {
          label: 'WiRE',
          value: activeRegistry.summary.metadata.wireVersion ?? '—',
          mono: true,
        },
        {
          label: 'Calibration',
          value: formatCalibrationStateLabel(activeRegistry.summary.calibration.state),
        },
        {
          label: 'Tracks',
          value: `${activeRegistry.summary.calibration.calibratedTrackCount}/${activeRegistry.summary.calibration.totalTrackCount} calibrated`,
          mono: true,
        },
        {
          label: 'Hardware',
          value: `${activeRegistry.summary.lasers.length}L · ${activeRegistry.summary.gratings.length}G · ${activeRegistry.summary.detectors.length}D · ${activeRegistry.summary.motors.length}M`,
          mono: true,
        },
        {
          label: 'Encoding',
          value: `${activeRegistry.parsed.encoding} (${activeRegistry.parsed.formatVersion})`,
          mono: true,
        },
        {
          label: 'Diagnostics',
          value: `${activeRegistry.parsed.stats.errorCount} err · ${activeRegistry.parsed.stats.warningCount} warn`,
          mono: true,
        },
      ]
    : [];

  const renderSampleRow = (sample: LoadedSample) => {
    const isSelected = activeSelectionKind === 'wdf' && sample.id === selectedId;
    const isInMultiSelection = isMultiSelectActive && multiSelectedSet.has(sample.id);
    const displayName = stripWdfExtension(sample.fileName);
    return (
      <div
        key={sample.id}
        role="option"
        aria-selected={isInMultiSelection || isSelected}
        onClick={(e) => handleRowClick(sample.id, e)}
        className={`w-full text-left px-2 py-1 rounded border transition-colors cursor-pointer select-none group/row ${
          isInMultiSelection
            ? 'bg-blue-50 border-blue-500 ring-1 ring-blue-500/30 text-slate-900'
            : isSelected
              ? 'bg-blue-50/70 border-blue-600 text-slate-900'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <input
              type="checkbox"
              checked={sample.visible}
              aria-label={`Plot ${displayName} on spectrum viewer`}
              title="Tick to view this file on the spectrum chart"
              onClick={(e) => e.stopPropagation()}
              onChange={() => onToggleSampleVisible(sample.id)}
              className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer shrink-0"
            />

            <TraceColorPicker
              color={sample.color}
              fileName={displayName}
              onChange={(newColor) => onChangeSampleColor(sample.id, newColor)}
            />

            <span
              className={`text-xs leading-5 truncate ${
                isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
              }`}
              title={displayName}
            >
              {displayName}
            </span>
          </div>

          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setPendingUnload({ type: 'file', id: sample.id, label: displayName });
            }}
            aria-label={`Unload ${displayName}`}
            title={`Unload ${displayName}`}
            className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
          >
            <X className="w-3.5 h-3.5" aria-hidden="true" />
          </button>
        </div>
      </div>
    );
  };

  const renderRegistryRow = (reg: LoadedRegistryFile) => {
    const isSelected = activeSelectionKind === 'registry' && reg.id === selectedRegistryId;
    const extMatch = reg.fileName.match(/\.(reg|rrg)$/i);
    const extLabel = extMatch ? extMatch[1].toUpperCase() : 'REG';
    return (
      <div
        key={reg.id}
        role="option"
        data-explorer-registry-id={reg.id}
        aria-selected={isSelected}
        onClick={() => {
          setMultiSelectedIds([]);
          onSelectRegistryFile(reg.id);
        }}
        className={`w-full text-left px-2 py-1 rounded border transition-colors cursor-pointer select-none group/row ${
          isSelected
            ? 'bg-blue-50/70 border-blue-600 text-slate-900'
            : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
        }`}
      >
        <div className="flex items-center justify-between gap-1.5">
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <FileCode2
              className={`w-3.5 h-3.5 shrink-0 ${
                isSelected ? 'text-blue-600' : 'text-slate-500'
              }`}
              aria-hidden="true"
            />
            <span
              className={`text-xs leading-5 truncate ${
                isSelected ? 'font-semibold text-slate-900' : 'font-medium text-slate-800'
              }`}
              title={reg.fileName}
            >
              {reg.fileName}
            </span>
          </div>

          <div className="flex items-center gap-1 shrink-0">
            <span className="font-mono text-[10px] font-medium text-slate-500 border border-slate-200 bg-slate-50 px-1 rounded-xs">
              {extLabel}
            </span>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPendingUnload({ type: 'registry', id: reg.id, label: reg.fileName });
              }}
              aria-label={`Unload ${reg.fileName}`}
              title={`Unload ${reg.fileName}`}
              className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer shrink-0"
            >
              <X className="w-3.5 h-3.5" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  return (
    <div
      className={`relative flex shrink-0 w-full lg:w-[var(--sidebar-w)] ${
        isResizingWidth || isResizingList ? 'select-none' : ''
      }`}
      style={{ '--sidebar-w': `${sidebarWidth}px` } as CSSProperties}
    >
      <aside className="w-full bg-white border-b lg:border-b-0 lg:border-r border-slate-200 flex flex-col min-w-0 lg:overflow-y-auto">
        {/* Explorer Section */}
        <section className="pt-3 px-3 pb-0 border-b border-slate-200">
          <div className="flex items-center justify-between gap-2 mb-2">
            <div className="flex items-baseline gap-2 min-w-0">
              <h2 className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 whitespace-nowrap">
                Explorer
              </h2>
              <span className="text-[11px] font-mono tabular-nums text-slate-500 whitespace-nowrap">
                {samples.length > 0 ? `${visibleCount}/${samples.length} shown` : '0 spectra'}
                {registryFiles.length > 0 ? ` · ${registryFiles.length} reg` : ''}
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

          {/* Batch Action Bar when multiple files are selected via Shift+Click or Ctrl/Cmd+Click */}
          {isMultiSelectActive && (
            <div
              role="toolbar"
              aria-label="Batch selection actions"
              className="mb-2 px-2 py-1.5 rounded border border-blue-200 bg-blue-50/80 flex items-center justify-between gap-1.5"
            >
              <span className="text-[11px] font-mono font-semibold tabular-nums text-blue-800 whitespace-nowrap">
                {activeMultiSelectedIds.length} selected
              </span>
              <div className="flex items-center gap-1">
                {anySelectedHidden && (
                  <button
                    type="button"
                    onClick={() => onSetSamplesVisible(activeMultiSelectedIds, true)}
                    title="Show all selected files on the spectrum chart"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-700 cursor-pointer whitespace-nowrap"
                  >
                    <Eye className="w-3 h-3 text-blue-600" aria-hidden="true" />
                    <span>Show</span>
                  </button>
                )}
                {anySelectedVisible && (
                  <button
                    type="button"
                    onClick={() => onSetSamplesVisible(activeMultiSelectedIds, false)}
                    title="Hide all selected files from the spectrum chart"
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-700 cursor-pointer whitespace-nowrap"
                  >
                    <EyeOff className="w-3 h-3 text-slate-500" aria-hidden="true" />
                    <span>Hide</span>
                  </button>
                )}
                <button
                  type="button"
                  onClick={() =>
                    setPendingUnload({ type: 'batch', ids: activeMultiSelectedIds })
                  }
                  title="Unload all selected files"
                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded border border-red-200 bg-white hover:bg-red-50 text-[11px] font-medium text-red-700 cursor-pointer whitespace-nowrap"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  <span>Unload</span>
                </button>
                <button
                  type="button"
                  onClick={() => setMultiSelectedIds([])}
                  aria-label="Clear multi-selection"
                  title="Clear selection (Esc)"
                  className="p-0.5 rounded text-blue-600 hover:bg-blue-100 cursor-pointer"
                >
                  <X className="w-3 h-3" aria-hidden="true" />
                </button>
              </div>
            </div>
          )}

          {/* Scrollable File & Folder Tree (auto-grows up to ~8 items, or user-dragged height) */}
          <div
            ref={listContainerRef}
            className="space-y-1 overflow-y-auto pr-0.5"
            style={
              customListHeight !== null
                ? { height: `${customListHeight}px` }
                : { maxHeight: `${DEFAULT_MAX_FILES_LIST_HEIGHT}px` }
            }
            role="listbox"
            aria-multiselectable="true"
            aria-label="Explorer"
          >
            {totalLoadedCount === 0 ? (
              <div className="py-4 px-3 rounded border border-dashed border-slate-200 bg-slate-50/70 text-center text-xs text-slate-500">
                No files loaded yet. Open .wdf, .reg, or .rrg files below.
              </div>
            ) : (
              <>
                {/* Standalone / Demo WDF Spectra */}
                {ungroupedSamples.map((sample) => renderSampleRow(sample))}

                {/* Standalone / Demo Registry Files (.reg / .rrg) */}
                {ungroupedRegistries.map((reg) => renderRegistryRow(reg))}

                {/* Folder-Grouped Files (collapsed by default) */}
                {folderGroups.map(({ folderName, items, registries }) => {
                  const isExpanded = Boolean(expandedFolders[folderName]);
                  const visibleInFolder = items.filter((item) => item.visible).length;
                  const allInFolderVisible = items.length > 0 && visibleInFolder === items.length;
                  const someInFolderVisible = visibleInFolder > 0 && !allInFolderVisible;
                  const totalInFolder = items.length + registries.length;

                  return (
                    <div
                      key={folderName}
                      className="rounded border border-slate-200 bg-slate-50/60 overflow-hidden"
                    >
                      <div
                        onClick={() => toggleFolderExpanded(folderName)}
                        role="button"
                        tabIndex={0}
                        aria-expanded={isExpanded}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            toggleFolderExpanded(folderName);
                          }
                        }}
                        className="px-2 py-1 flex items-center justify-between gap-1.5 hover:bg-slate-100/80 transition-colors cursor-pointer select-none"
                      >
                        <div className="flex items-center gap-1.5 min-w-0 flex-1">
                          <span className="text-slate-400 shrink-0">
                            {isExpanded ? (
                              <ChevronDown className="w-3.5 h-3.5" aria-hidden="true" />
                            ) : (
                              <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
                            )}
                          </span>

                          {items.length > 0 && (
                            <FolderCheckbox
                              checked={allInFolderVisible}
                              indeterminate={someInFolderVisible}
                              folderName={folderName}
                              onChange={() => onToggleFolderVisible(folderName)}
                            />
                          )}

                          {isExpanded ? (
                            <FolderOpen className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
                          ) : (
                            <Folder className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
                          )}

                          <span
                            className="text-xs leading-5 font-semibold text-slate-800 truncate"
                            title={folderName}
                          >
                            {folderName}
                          </span>
                        </div>

                        <div className="flex items-center gap-1 shrink-0">
                          <span className="text-[11px] font-mono tabular-nums text-slate-500 whitespace-nowrap">
                            {items.length > 0 && registries.length > 0
                              ? `${visibleInFolder}/${items.length} · ${registries.length} reg`
                              : items.length > 0
                                ? `${visibleInFolder}/${items.length}`
                                : `${registries.length} reg`}
                          </span>
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingUnload({
                                type: 'folder',
                                folderName,
                                fileCount: totalInFolder,
                              });
                            }}
                            aria-label={`Unload folder ${folderName}`}
                            title={`Unload folder ${folderName} and all its files`}
                            className="p-0.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors cursor-pointer"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </div>
                      </div>

                      {isExpanded && (
                        <div className="px-1.5 py-1 space-y-1 bg-white border-t border-slate-200/80">
                          {items.map((sample) => renderSampleRow(sample))}
                          {registries.map((reg) => renderRegistryRow(reg))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>

          {/* File & Directory Loader Controls */}
          <div className="mt-2.5 mb-1.5 grid grid-cols-2 gap-1.5">
            <button
              type="button"
              onClick={onOpenFileClick}
              className={`px-2 py-1.5 rounded border border-dashed text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                isDraggingFile
                  ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 hover:text-slate-900'
              }`}
              title="Open Renishaw .wdf spectra or .reg / .rrg registry files"
            >
              <Upload className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Open Files</span>
            </button>

            <button
              type="button"
              onClick={onOpenFolderClick}
              className={`px-2 py-1.5 rounded border border-dashed text-xs transition-colors flex items-center justify-center gap-1.5 cursor-pointer whitespace-nowrap ${
                isDraggingFile
                  ? 'border-blue-600 bg-blue-50 text-blue-700 font-medium'
                  : 'border-slate-300 bg-slate-50 text-slate-700 hover:border-slate-400 hover:text-slate-900'
              }`}
              title="Select a folder and load all Renishaw .wdf spectra and .reg / .rrg registry files inside it"
            >
              <FolderOpen className="w-3.5 h-3.5 shrink-0" aria-hidden="true" />
              <span>Open Folder</span>
            </button>
          </div>

          {/* Vertical Drag Handle to expand Explorer down */}
          <div
            role="separator"
            aria-orientation="horizontal"
            aria-label="Drag to resize Explorer height"
            title="Drag down to expand Explorer list (double-click to reset)"
            onPointerDown={handleStartListResize}
            onDoubleClick={() => setCustomListHeight(null)}
            className={`-mx-3 h-3 flex items-center justify-center cursor-row-resize transition-colors group ${
              isResizingList ? 'bg-blue-100/80' : 'hover:bg-slate-100/90'
            }`}
          >
            <GripHorizontal
              className={`w-4 h-3 transition-colors ${
                isResizingList ? 'text-blue-600' : 'text-slate-300 group-hover:text-blue-600'
              }`}
              aria-hidden="true"
            />
          </div>
        </section>

        {/* Collapsible Summary (Collapsed by default) */}
        <section className="border-b border-slate-200">
          <button
            type="button"
            onClick={() => setSummaryExpanded((prev) => !prev)}
            aria-expanded={summaryExpanded}
            className="w-full px-3 py-2.5 flex items-center justify-between gap-2 text-left hover:bg-slate-50 transition-colors cursor-pointer"
          >
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-600">
              {summaryExpanded ? (
                <ChevronDown className="w-3.5 h-3.5 text-slate-500 shrink-0" aria-hidden="true" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5 text-slate-400 shrink-0" aria-hidden="true" />
              )}
              <span>Summary</span>
            </span>
            {showRegistrySummary && activeRegistry ? (
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {activeRegistry.parsed.stats.sectionCount.toLocaleString()} keys
              </span>
            ) : active ? (
              <span className="text-[11px] font-mono tabular-nums text-slate-500">
                {active.wdf.blocks.length} blocks
              </span>
            ) : null}
          </button>

          {summaryExpanded && (
            <div className="px-3 pb-3">
              {showRegistrySummary && activeRegistry ? (
                <dl className="divide-y divide-slate-100 text-xs">
                  {registrySummaryRows.map((row) => (
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
                  ))}
                </dl>
              ) : summary ? (
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
                <p className="text-xs text-slate-500">Select or open a file to inspect parameters.</p>
              )}
            </div>
          )}
        </section>
      </aside>

      {/* Right-Edge Horizontal Drag Handle to expand left panel right (Desktop) */}
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Drag to resize left panel width"
        title="Drag right to expand the left panel (double-click to reset)"
        onPointerDown={handleStartWidthResize}
        onDoubleClick={() => setSidebarWidth(DEFAULT_SIDEBAR_WIDTH)}
        className={`hidden lg:flex absolute top-0 bottom-0 -right-1.5 w-3 z-20 cursor-col-resize items-center justify-center group ${
          isResizingWidth ? 'bg-blue-500/15' : 'hover:bg-blue-500/10'
        }`}
      >
        <div
          className={`w-3.5 h-10 rounded flex items-center justify-center transition-colors ${
            isResizingWidth
              ? 'bg-blue-600 text-white shadow-xs'
              : 'bg-white border border-slate-200 text-slate-400 group-hover:border-blue-500 group-hover:text-blue-600 shadow-2xs'
          }`}
        >
          <GripVertical className="w-3 h-3" aria-hidden="true" />
        </div>
      </div>

      {/* Unload Confirmation Modal */}
      {pendingUnload && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="unload-confirm-title"
          aria-describedby="unload-confirm-desc"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-sm rounded border border-slate-200 bg-white p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2">
              <h3 id="unload-confirm-title" className="text-sm font-semibold text-slate-900">
                {pendingUnload.type === 'folder'
                  ? 'Unload Folder'
                  : pendingUnload.type === 'batch'
                    ? 'Unload Selected Files'
                    : pendingUnload.type === 'registry'
                      ? 'Unload Registry File'
                      : 'Unload File'}
              </h3>
              <button
                type="button"
                onClick={() => setPendingUnload(null)}
                aria-label="Close confirmation dialog"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div id="unload-confirm-desc" className="space-y-1.5 text-xs text-slate-700">
              {pendingUnload.type === 'folder' ? (
                <>
                  <p>Are you sure you want to unload the folder including all its files?</p>
                  <p className="font-mono text-[11px] text-slate-500 truncate" title={pendingUnload.folderName}>
                    {pendingUnload.folderName} ({pendingUnload.fileCount}{' '}
                    {pendingUnload.fileCount === 1 ? 'file' : 'files'})
                  </p>
                </>
              ) : pendingUnload.type === 'batch' ? (
                <p>
                  Are you sure you want to unload{' '}
                  <span className="font-mono font-semibold text-slate-900">
                    {pendingUnload.ids.length} selected files
                  </span>
                  ?
                </p>
              ) : (
                <p>
                  Are you sure you want to unload{' '}
                  <span className="font-mono font-semibold text-slate-900">{pendingUnload.label}</span>?
                </p>
              )}
            </div>

            <div className="pt-2 flex items-center justify-end gap-2">
              <button
                type="button"
                onClick={() => setPendingUnload(null)}
                className="px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 text-xs font-medium cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleConfirmUnload}
                className="px-3 py-1.5 rounded bg-red-600 hover:bg-red-700 text-white text-xs font-medium cursor-pointer"
              >
                Unload
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
