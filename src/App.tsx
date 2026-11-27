import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, FolderOpen, Upload, X } from 'lucide-react';
import { BlockMapView } from './components/BlockMapView';
import { InstrumentView } from './components/InstrumentView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { RegistryView } from './components/RegistryView';
import {
  Sidebar,
  TRACE_COLOR_PALETTE,
  type ExplorerSelectionKind,
  type LoadedRegistryFile,
  type LoadedSample,
} from './components/Sidebar';
import { SpectrumView, type BaselineStrength, type SmoothStrength } from './components/SpectrumView';
import { TopBar, type ActiveTab } from './components/TopBar';
import { TypeScriptExportView } from './components/TypeScriptExportView';
import { stripWdfExtension } from './lib/format';
import { parseWdf, type SpectralTargetUnit, type WdfFile } from './lib/wdf';
import { buildStandaloneWdfReaderTs } from './lib/wdf/exportModule';
import {
  parseRegistry,
  summarizeRegistry,
  type ParsedRegistry,
  type RegistryAnalysisSummary,
} from './registry';

const BASE_URL = import.meta.env.BASE_URL || '/';
const IS_PWA_BUILD = import.meta.env.VITE_PWA_BUILD === 'true';

const BUNDLED_SAMPLES: Array<{ id: string; fileName: string; url: string }> = [
  {
    id: 'sample-si-520',
    fileName: '532nm_1800_520scan.wdf',
    url: `${BASE_URL}assets/aistudio/532nm_1800_520scan_62354700.txt`,
  },
  {
    id: 'sample-pcl-17087',
    fileName: '532nm_1800_17087 abs cm-1_PCL.wdf',
    url: `${BASE_URL}assets/aistudio/532nm_1800_17087_abs_cm-1_PCL_e8762f36.txt`,
  },
];

const BUNDLED_REGISTRIES: Array<{ id: string; fileName: string; url: string }> = [
  {
    id: 'reg-virsa-aj4f17',
    fileName: 'AJ4F17_20250813_sys.rrg',
    url: `${BASE_URL}assets/aistudio/AJ4F17_20250813_sys_47160748.txt`,
  },
  {
    id: 'reg-invia-anj351',
    fileName: 'ANJ351_AGENZIA_inVia.reg',
    url: `${BASE_URL}assets/aistudio/ANJ351_AGENZIA_inVia_7988e490.txt`,
  },
  {
    id: 'reg-invia-f8ue48',
    fileName: 'F8UE48_20260407_sys.reg',
    url: `${BASE_URL}assets/aistudio/F8UE48_20260407_sys_719b89e1.txt`,
  },
];

interface IncomingFile {
  file: File;
  folderName: string | null;
}

function triggerDownload(content: string, fileName: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function extractFolderFromPath(relPath: string | undefined | null): string | null {
  if (!relPath) return null;
  const normalized = relPath.replace(/\\/g, '/').replace(/^\/+/, '');
  const lastSlash = normalized.lastIndexOf('/');
  if (lastSlash <= 0) return null;
  return normalized.slice(0, lastSlash);
}

/**
 * Recursively collect File objects and their relative subfolder paths when a directory is dropped.
 */
async function extractFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<{
  files: IncomingFile[];
  fromDirectory: boolean;
}> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return {
      files: Array.from(dataTransfer.files).map((file) => ({
        file,
        folderName: extractFolderFromPath(file.webkitRelativePath),
      })),
      fromDirectory: false,
    };
  }

  const entries: FileSystemEntry[] = [];
  let hasDirectory = false;
  for (let i = 0; i < items.length; i++) {
    const item = items[i];
    const entry = typeof item.webkitGetAsEntry === 'function' ? item.webkitGetAsEntry() : null;
    if (entry) {
      if (entry.isDirectory) hasDirectory = true;
      entries.push(entry);
    }
  }

  if (entries.length === 0 || !hasDirectory) {
    return {
      files: Array.from(dataTransfer.files).map((file) => ({
        file,
        folderName: extractFolderFromPath(file.webkitRelativePath),
      })),
      fromDirectory: false,
    };
  }

  const collected: IncomingFile[] = [];

  async function walkEntry(entry: FileSystemEntry, parentFolder: string | null): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File | null>((resolve) => {
        fileEntry.file(
          (f) => resolve(f),
          () => resolve(null),
        );
      });
      if (file) {
        const fromFullPath = extractFolderFromPath(entry.fullPath);
        collected.push({
          file,
          folderName: fromFullPath ?? parentFolder,
        });
      }
    } else if (entry.isDirectory) {
      const nextFolder = parentFolder ? `${parentFolder}/${entry.name}` : entry.name;
      const dirReader = (entry as FileSystemDirectoryEntry).createReader();
      const readAllEntries = async (): Promise<FileSystemEntry[]> => {
        const all: FileSystemEntry[] = [];
        while (true) {
          const batch = await new Promise<FileSystemEntry[]>((resolve) => {
            dirReader.readEntries(
              (res) => resolve(res),
              () => resolve([]),
            );
          });
          if (batch.length === 0) break;
          all.push(...batch);
        }
        return all;
      };
      const children = await readAllEntries();
      for (const child of children) {
        await walkEntry(child, nextFolder);
      }
    }
  }

  for (const entry of entries) {
    await walkEntry(entry, null);
  }
  return { files: collected, fromDirectory: true };
}

function hasWdf1Magic(bytes: Uint8Array): boolean {
  return (
    bytes.byteLength >= 16 &&
    bytes[0] === 0x57 && // 'W'
    bytes[1] === 0x44 && // 'D'
    bytes[2] === 0x46 && // 'F'
    bytes[3] === 0x31 // '1'
  );
}

function isRegistryFileName(fileName: string): boolean {
  return /\.(reg|rrg)$/i.test(fileName);
}

/**
 * Lightweight header check so renamed `.txt` Windows Registry exports (UTF-16LE/BE or UTF-8)
 * are recognized as registry files when opened directly, without decoding the full buffer twice.
 */
function hasRegistryHeaderSignature(bytes: Uint8Array): boolean {
  if (bytes.byteLength < 8) return false;
  const sampleLen = Math.min(bytes.byteLength, 128);
  const slice = bytes.subarray(0, sampleLen);

  let prefixText = '';
  if (slice[0] === 0xff && slice[1] === 0xfe) {
    // UTF-16LE with BOM
    const chars: string[] = [];
    for (let i = 2; i + 1 < slice.length; i += 2) {
      chars.push(String.fromCharCode(slice[i] | (slice[i + 1] << 8)));
    }
    prefixText = chars.join('');
  } else if (slice[0] === 0xfe && slice[1] === 0xff) {
    // UTF-16BE with BOM
    const chars: string[] = [];
    for (let i = 2; i + 1 < slice.length; i += 2) {
      chars.push(String.fromCharCode((slice[i] << 8) | slice[i + 1]));
    }
    prefixText = chars.join('');
  } else {
    const start =
      slice.length >= 3 && slice[0] === 0xef && slice[1] === 0xbb && slice[2] === 0xbf ? 3 : 0;
    const chars: string[] = [];
    for (let i = start; i < slice.length; i++) {
      if (slice[i] !== 0) chars.push(String.fromCharCode(slice[i]));
    }
    prefixText = chars.join('');
  }

  const trimmed = prefixText.trimStart();
  return (
    /^Windows Registry Editor Version\s+\d/i.test(trimmed) ||
    /^REGEDIT4\b/i.test(trimmed) ||
    /^\[HKEY_/i.test(trimmed)
  );
}

function parseRegistryBytes(
  bytes: Uint8Array,
  sourceName: string,
): { parsed: ParsedRegistry; summary: RegistryAnalysisSummary } {
  const parsed = parseRegistry(bytes, { sourceName });
  const summary = summarizeRegistry(parsed);
  return { parsed, summary };
}

export default function App() {
  const [samples, setSamples] = useState<LoadedSample[]>([]);
  const [registryFiles, setRegistryFiles] = useState<LoadedRegistryFile[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedRegistryId, setSelectedRegistryId] = useState<string | null>(null);
  const [explorerSelectionKind, setExplorerSelectionKind] = useState<ExplorerSelectionKind>('wdf');
  const [activeTab, setActiveTab] = useState<ActiveTab>('spectrum');
  const [targetUnit, setTargetUnit] = useState<SpectralTargetUnit>('native');
  const [baselineEnabled, setBaselineEnabled] = useState(false);
  const [baselineStrength, setBaselineStrength] = useState<BaselineStrength>('auto');
  const [smoothEnabled, setSmoothEnabled] = useState(false);
  const [smoothStrength, setSmoothStrength] = useState<SmoothStrength>('auto');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingSamples, setIsLoadingSamples] = useState(!IS_PWA_BUILD);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const registryFileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const nextColorIndexRef = useRef<number>(0);

  const allocateColor = useCallback(() => {
    const color = TRACE_COLOR_PALETTE[nextColorIndexRef.current % TRACE_COLOR_PALETTE.length];
    nextColorIndexRef.current += 1;
    return color;
  }, []);

  // Load bundled Renishaw demo files only in AI Studio demo mode (excluded in GitHub PWA builds)
  useEffect(() => {
    if (IS_PWA_BUILD) {
      setIsLoadingSamples(false);
      return;
    }

    let cancelled = false;
    async function loadBundled() {
      const loaded: LoadedSample[] = [];
      for (let i = 0; i < BUNDLED_SAMPLES.length; i++) {
        const spec = BUNDLED_SAMPLES[i];
        try {
          const res = await fetch(spec.url);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const wdf = parseWdf(bytes);
          loaded.push({
            id: spec.id,
            fileName: spec.fileName,
            folderName: null,
            sourceLabel: 'Demo sample',
            bytes,
            wdf,
            visible: i === 0,
            color: TRACE_COLOR_PALETTE[i % TRACE_COLOR_PALETTE.length],
          });
        } catch (err) {
          console.error(`Failed to parse bundled sample ${spec.fileName}:`, err);
        }
      }

      const loadedRegs: LoadedRegistryFile[] = [];
      for (const spec of BUNDLED_REGISTRIES) {
        try {
          const res = await fetch(spec.url);
          if (!res.ok) continue;
          const buf = await res.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const { parsed, summary } = parseRegistryBytes(bytes, spec.fileName);
          loadedRegs.push({
            id: spec.id,
            fileName: spec.fileName,
            folderName: null,
            sourceLabel: 'Demo registry',
            bytes,
            parsed,
            summary,
          });
        } catch (err) {
          console.error(`Failed to parse bundled registry ${spec.fileName}:`, err);
        }
      }

      if (!cancelled) {
        nextColorIndexRef.current = loaded.length;
        setSamples(loaded);
        setRegistryFiles(loadedRegs);
        if (loaded.length > 0) {
          setSelectedId(loaded[0].id);
        }
        if (loadedRegs.length > 0) {
          setSelectedRegistryId(loadedRegs[0].id);
        }
        setIsLoadingSamples(false);
      }
    }
    loadBundled();
    return () => {
      cancelled = true;
    };
  }, []);

  const ingestFiles = useCallback(
    async (incoming: IncomingFile[], isDirectoryBatch = false, forceRegistryMode = false) => {
      if (incoming.length === 0) return;
      setErrorMessage(null);
      const newlyLoaded: LoadedSample[] = [];
      const newlyLoadedRegistries: LoadedRegistryFile[] = [];
      const errors: string[] = [];

      // Sort by folder path, then file name for predictable folder grouping
      const ordered = [...incoming].sort((a, b) => {
        const folderCmp = (a.folderName ?? '').localeCompare(b.folderName ?? '');
        if (folderCmp !== 0) return folderCmp;
        return a.file.name.localeCompare(b.file.name);
      });

      for (const { file, folderName } of ordered) {
        if (file.name.startsWith('.')) continue;
        try {
          // Always read raw binary bytes via file.arrayBuffer() so UTF-16LE/BE BOMs and WDF1 binaries stay intact
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);
          const isWdf = hasWdf1Magic(bytes);
          const isReg =
            forceRegistryMode ||
            isRegistryFileName(file.name) ||
            (!isWdf && hasRegistryHeaderSignature(bytes));

          if (isReg && !isWdf) {
            const { parsed, summary } = parseRegistryBytes(bytes, file.name);
            const resolvedFolder = isDirectoryBatch
              ? folderName || 'Imported Folder'
              : null;
            newlyLoadedRegistries.push({
              id: `reg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
              fileName: file.name,
              folderName: resolvedFolder,
              sourceLabel: isDirectoryBatch ? 'Folder import' : 'Uploaded registry',
              bytes,
              parsed,
              summary,
            });
            continue;
          }

          // In directory mode, quietly skip non-WDF and non-registry auxiliary files
          if (isDirectoryBatch && !isWdf) {
            if (file.name.toLowerCase().endsWith('.wdf')) {
              errors.push(`${stripWdfExtension(file.name)}: Invalid WDF1 header signature`);
            }
            continue;
          }

          const wdf = parseWdf(bytes);
          const resolvedFolder = isDirectoryBatch
            ? folderName || 'Imported Folder'
            : null;

          newlyLoaded.push({
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fileName: file.name,
            folderName: resolvedFolder,
            sourceLabel: isDirectoryBatch ? 'Folder import' : 'Uploaded',
            bytes,
            wdf,
            // Folder-loaded files start unchecked inside collapsed folders; user ticks the folder or files to view
            visible: !isDirectoryBatch,
            color: allocateColor(),
          });
        } catch (err) {
          errors.push(
            `${stripWdfExtension(file.name)}: ${err instanceof Error ? err.message : 'Unable to parse file'}`,
          );
        }
      }

      if (newlyLoaded.length > 0) {
        setSamples((prev) => {
          if (!isDirectoryBatch && newlyLoaded.length === 1 && prev.filter((s) => s.visible).length <= 1) {
            return [
              ...newlyLoaded,
              ...prev.map((s) => ({ ...s, visible: false })),
            ];
          }
          if (isDirectoryBatch) {
            return [...prev, ...newlyLoaded];
          }
          return [...newlyLoaded, ...prev];
        });
        setSelectedId((prevSelected) => prevSelected ?? newlyLoaded[0].id);
        if (!isDirectoryBatch) {
          setSelectedId(newlyLoaded[0].id);
          setExplorerSelectionKind('wdf');
        }
      }

      if (newlyLoadedRegistries.length > 0) {
        setRegistryFiles((prev) =>
          isDirectoryBatch ? [...prev, ...newlyLoadedRegistries] : [...newlyLoadedRegistries, ...prev],
        );
        setSelectedRegistryId((prevSelected) =>
          !isDirectoryBatch || !prevSelected ? newlyLoadedRegistries[0].id : prevSelected,
        );
        if (!isDirectoryBatch && newlyLoaded.length === 0) {
          setSelectedRegistryId(newlyLoadedRegistries[0].id);
          setExplorerSelectionKind('registry');
          setActiveTab('registry');
          setIsFullscreen(false);
        }
      }

      if (newlyLoaded.length === 0 && newlyLoadedRegistries.length === 0 && isDirectoryBatch && errors.length === 0) {
        setErrorMessage(
          'No valid Renishaw .wdf spectra or registry (.reg, .rrg) files were found in the selected folder.',
        );
      }

      if (errors.length > 0) {
        setErrorMessage(errors.slice(0, 4).join(' · '));
      }
    },
    [allocateColor],
  );

  const activeSample = samples.find((s) => s.id === selectedId) ?? samples[0] ?? null;
  const activeRegistryFile =
    registryFiles.find((r) => r.id === selectedRegistryId) ?? registryFiles[0] ?? null;

  const handleSelectSample = (id: string) => {
    setSelectedId(id);
    setExplorerSelectionKind('wdf');
    setSamples((prev) => {
      const visibleList = prev.filter((s) => s.visible);
      if (visibleList.length <= 1) {
        return prev.map((s) => ({ ...s, visible: s.id === id }));
      }
      return prev.map((s) => (s.id === id ? { ...s, visible: true } : s));
    });
    if (activeTab === 'registry') {
      setActiveTab('spectrum');
    }
    setErrorMessage(null);
  };

  const handleSelectRegistryFile = (id: string) => {
    setSelectedRegistryId(id);
    setExplorerSelectionKind('registry');
    setActiveTab('registry');
    setIsFullscreen(false);
    setErrorMessage(null);
  };

  const handleToggleSampleVisible = (id: string) => {
    setSamples((prev) =>
      prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s)),
    );
  };

  const handleToggleFolderVisible = (folderName: string) => {
    let firstInFolderId: string | null = null;
    let turningOn = false;

    setSamples((prev) => {
      const folderItems = prev.filter((s) => s.folderName === folderName);
      if (folderItems.length === 0) return prev;
      firstInFolderId = folderItems[0].id;
      const allVisible = folderItems.every((s) => s.visible);
      turningOn = !allVisible;
      return prev.map((s) =>
        s.folderName === folderName ? { ...s, visible: turningOn } : s,
      );
    });

    if (turningOn && firstInFolderId) {
      setSelectedId(firstInFolderId);
      setExplorerSelectionKind('wdf');
    }
  };

  const handleUnloadSample = (id: string) => {
    setSamples((prev) => {
      const remaining = prev.filter((s) => s.id !== id);
      if (selectedId === id) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
  };

  const handleUnloadSamples = (ids: string[]) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setSamples((prev) => {
      const remaining = prev.filter((s) => !idSet.has(s.id));
      if (selectedId && idSet.has(selectedId)) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
  };

  const handleUnloadRegistryFile = (id: string) => {
    setRegistryFiles((prev) => {
      const remaining = prev.filter((r) => r.id !== id);
      if (selectedRegistryId === id) {
        setSelectedRegistryId(remaining[0]?.id ?? null);
      }
      if (remaining.length === 0 && explorerSelectionKind === 'registry' && samples.length > 0) {
        setExplorerSelectionKind('wdf');
      }
      return remaining;
    });
  };

  const handleSetSamplesVisible = (ids: string[], visible: boolean) => {
    if (ids.length === 0) return;
    const idSet = new Set(ids);
    setSamples((prev) =>
      prev.map((s) => (idSet.has(s.id) ? { ...s, visible } : s)),
    );
    if (visible) {
      setSelectedId((curr) => curr ?? ids[0]);
    }
  };

  const handleUnloadFolder = (folderName: string) => {
    setSamples((prev) => {
      const remaining = prev.filter((s) => s.folderName !== folderName);
      if (selectedId && !remaining.some((s) => s.id === selectedId)) {
        setSelectedId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
    setRegistryFiles((prev) => {
      const remaining = prev.filter((r) => r.folderName !== folderName);
      if (selectedRegistryId && !remaining.some((r) => r.id === selectedRegistryId)) {
        setSelectedRegistryId(remaining[0]?.id ?? null);
      }
      return remaining;
    });
  };

  const handleSetAllVisible = (visible: boolean) => {
    setSamples((prev) => {
      if (visible) {
        return prev.map((s) => ({ ...s, visible: true }));
      }
      const keepId = selectedId ?? prev[0]?.id ?? null;
      return prev.map((s) => ({ ...s, visible: s.id === keepId }));
    });
  };

  const handleChangeSampleColor = (id: string, color: string) => {
    setSamples((prev) => prev.map((s) => (s.id === id ? { ...s, color } : s)));
  };

  const handleCreateDerivedSample = useCallback(
    ({ fileName, wdf, formulaLabel }: { fileName: string; wdf: WdfFile; formulaLabel: string }) => {
      const id = `calc-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
      const newSample: LoadedSample = {
        id,
        fileName,
        folderName: null,
        sourceLabel: formulaLabel,
        bytes: new Uint8Array(0),
        wdf,
        visible: true,
        color: allocateColor(),
      };
      setSamples((prev) => {
        const visibleCount = prev.filter((s) => s.visible).length;
        if (visibleCount <= 1) {
          return [newSample, ...prev.map((s) => ({ ...s, visible: false }))];
        }
        return [newSample, ...prev];
      });
      setSelectedId(id);
      setExplorerSelectionKind('wdf');
      setErrorMessage(null);
    },
    [allocateColor],
  );

  const handleDownloadTsModule = () => {
    const code = buildStandaloneWdfReaderTs();
    triggerDownload(code, 'wdfReader.ts', 'text/typescript;charset=utf-8');
  };

  // Ensure PWA build can never display hidden demo-only tabs
  const effectiveTab: ActiveTab =
    IS_PWA_BUILD && (activeTab === 'blocks' || activeTab === 'export')
      ? 'spectrum'
      : activeTab;

  const showChartFullscreen = isFullscreen && effectiveTab === 'spectrum' && Boolean(activeSample);

  useEffect(() => {
    if (!showChartFullscreen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsFullscreen(false);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showChartFullscreen]);

  const handleSelectTab = (tab: ActiveTab) => {
    setActiveTab(tab);
    if (tab !== 'spectrum') {
      setIsFullscreen(false);
    }
    if (tab === 'registry' && registryFiles.length > 0) {
      setExplorerSelectionKind('registry');
    } else if (tab !== 'registry' && samples.length > 0) {
      setExplorerSelectionKind('wdf');
    }
  };

  return (
    <div
      className="min-h-screen lg:h-screen flex flex-col bg-slate-50 text-slate-900"
      onDragOver={(e) => {
        e.preventDefault();
        setIsDraggingFile(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setIsDraggingFile(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setIsDraggingFile(false);
        void (async () => {
          const { files, fromDirectory } = await extractFilesFromDataTransfer(e.dataTransfer);
          await ingestFiles(files, fromDirectory);
        })();
      }}
    >
      {/* Standard Multi-File Picker (.wdf spectra and .reg / .rrg registry exports) */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".wdf,.reg,.rrg,.txt,*/*"
        className="hidden"
        aria-label="Upload Renishaw WDF or Registry file"
        onChange={(e) => {
          const files = e.target.files
            ? Array.from(e.target.files).map((file) => ({ file, folderName: null }))
            : [];
          void ingestFiles(files, false);
          e.target.value = '';
        }}
      />

      {/* Dedicated Registry File Picker (.reg / .rrg) */}
      <input
        ref={registryFileInputRef}
        type="file"
        multiple
        accept=".reg,.rrg"
        className="hidden"
        aria-label="Upload Windows or Renishaw WiRE Registry file"
        onChange={(e) => {
          const files = e.target.files
            ? Array.from(e.target.files).map((file) => ({ file, folderName: null }))
            : [];
          void ingestFiles(files, false, true);
          e.target.value = '';
        }}
      />

      {/* Directory Picker (loads .wdf spectra and .reg / .rrg registry files in the chosen folder & subfolders) */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error non-standard webkitdirectory attribute supported by Chromium, Firefox, Safari
        webkitdirectory=""
        directory=""
        className="hidden"
        aria-label="Upload Renishaw WDF or Registry folder"
        onChange={(e) => {
          const files = e.target.files
            ? Array.from(e.target.files).map((file) => ({
                file,
                folderName: extractFolderFromPath(file.webkitRelativePath),
              }))
            : [];
          void ingestFiles(files, true);
          e.target.value = '';
        }}
      />

      <TopBar
        activeTab={effectiveTab}
        onSelectTab={handleSelectTab}
        isPwaBuild={IS_PWA_BUILD}
      />

      {errorMessage && (
        <div
          role="alert"
          className="bg-red-50 border-b border-red-200 px-4 lg:px-6 py-2.5 flex items-center justify-between gap-3 text-xs text-red-800"
        >
          <div className="flex items-center gap-2 min-w-0">
            <AlertCircle className="w-4 h-4 text-red-600 shrink-0" aria-hidden="true" />
            <span className="truncate">{errorMessage}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMessage(null)}
            aria-label="Dismiss error"
            className="text-red-600 hover:text-red-900 cursor-pointer shrink-0"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      <div className="flex-1 flex flex-col lg:flex-row min-h-0">
        {!showChartFullscreen && (
          <Sidebar
            samples={samples}
            registryFiles={registryFiles}
            selectedId={activeSample?.id ?? null}
            selectedRegistryId={activeRegistryFile?.id ?? null}
            activeSelectionKind={explorerSelectionKind}
            onSelectSample={handleSelectSample}
            onSelectRegistryFile={handleSelectRegistryFile}
            onToggleSampleVisible={handleToggleSampleVisible}
            onToggleFolderVisible={handleToggleFolderVisible}
            onSetSamplesVisible={handleSetSamplesVisible}
            onUnloadSample={handleUnloadSample}
            onUnloadSamples={handleUnloadSamples}
            onUnloadRegistryFile={handleUnloadRegistryFile}
            onUnloadFolder={handleUnloadFolder}
            onSetAllVisible={handleSetAllVisible}
            onChangeSampleColor={handleChangeSampleColor}
            onOpenFileClick={() => fileInputRef.current?.click()}
            onOpenFolderClick={() => folderInputRef.current?.click()}
            isDraggingFile={isDraggingFile}
          />
        )}

        <main
          className={`flex-1 min-w-0 bg-slate-50 ${
            showChartFullscreen ? 'flex flex-col overflow-hidden' : 'lg:overflow-y-auto'
          }`}
        >
          {isLoadingSamples ? (
            <div className="p-8 text-sm text-slate-500 font-mono">
              Loading bundled Renishaw demo files…
            </div>
          ) : effectiveTab === 'registry' ? (
            <RegistryView
              samples={samples}
              activeSampleId={activeSample?.id ?? null}
              registryFiles={registryFiles}
              activeRegistryId={activeRegistryFile?.id ?? null}
              onSelectRegistryFile={handleSelectRegistryFile}
              onOpenRegistryFileClick={() => registryFileInputRef.current?.click()}
              onSelectSampleInSpectrum={(id) => {
                handleSelectSample(id);
                setActiveTab('spectrum');
              }}
            />
          ) : effectiveTab === 'export' ? (
            <TypeScriptExportView onDownloadTsModule={handleDownloadTsModule} />
          ) : !activeSample ? (
            <div className="p-8 max-w-xl mx-auto mt-8">
              <div className="bg-white border border-slate-200 rounded p-8 text-center space-y-4">
                <div className="space-y-1.5">
                  <h1 className="text-base font-semibold text-slate-900">
                    Open Renishaw Spectra or Registry Exports
                  </h1>
                  <p className="text-xs text-slate-500">
                    Load <span className="font-mono">.wdf</span> Raman spectra,{' '}
                    <span className="font-mono">.reg</span> / <span className="font-mono">.rrg</span>{' '}
                    WiRE registry exports, open a folder with subfolders, or drag and drop files anywhere onto this window.
                  </p>
                </div>
                <div className="flex flex-wrap items-center justify-center gap-2.5">
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer transition-colors"
                  >
                    <Upload className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Open Files</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => folderInputRef.current?.click()}
                    className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded border border-slate-300 bg-white hover:bg-slate-50 text-slate-800 text-xs font-medium cursor-pointer transition-colors"
                  >
                    <FolderOpen className="w-3.5 h-3.5 text-slate-600" aria-hidden="true" />
                    <span>Open Folder</span>
                  </button>
                </div>
              </div>
            </div>
          ) : effectiveTab === 'spectrum' ? (
            <SpectrumView
              samples={samples}
              activeSampleId={activeSample.id}
              wdf={activeSample.wdf}
              fileName={activeSample.fileName}
              targetUnit={targetUnit}
              onChangeTargetUnit={setTargetUnit}
              baselineEnabled={baselineEnabled}
              onToggleBaseline={() => setBaselineEnabled((prev) => !prev)}
              baselineStrength={baselineStrength}
              onChangeBaselineStrength={setBaselineStrength}
              smoothEnabled={smoothEnabled}
              onToggleSmooth={() => setSmoothEnabled((prev) => !prev)}
              smoothStrength={smoothStrength}
              onChangeSmoothStrength={setSmoothStrength}
              onToggleSampleVisible={handleToggleSampleVisible}
              onSetAllVisible={handleSetAllVisible}
              onChangeSampleColor={handleChangeSampleColor}
              onCreateDerivedSample={handleCreateDerivedSample}
              isFullscreen={showChartFullscreen}
              onToggleFullscreen={() => setIsFullscreen((prev) => !prev)}
            />
          ) : effectiveTab === 'instrument' ? (
            <InstrumentView wdf={activeSample.wdf} rawBytes={activeSample.bytes} />
          ) : (
            <BlockMapView wdf={activeSample.wdf} rawBytes={activeSample.bytes} />
          )}
        </main>
      </div>
      <OfflineIndicator />
    </div>
  );
}
