import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { BlockMapView } from './components/BlockMapView';
import { InstrumentView } from './components/InstrumentView';
import { OfflineIndicator } from './components/PWAInstallButton';
import { Sidebar, TRACE_COLOR_PALETTE, type LoadedSample } from './components/Sidebar';
import { SpectrumView, type BaselineStrength } from './components/SpectrumView';
import { TopBar, type ActiveTab } from './components/TopBar';
import { serializeWdfForJson, TypeScriptExportView } from './components/TypeScriptExportView';
import { parseWdf, wdfToCsv, type SpectralTargetUnit } from './lib/wdf';
import { buildStandaloneWdfReaderTs } from './lib/wdf/exportModule';

const BASE_URL = import.meta.env.BASE_URL || '/';

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

/**
 * Recursively collect File objects from DataTransferItemList when a directory is dropped.
 */
async function extractFilesFromDataTransfer(dataTransfer: DataTransfer): Promise<{
  files: File[];
  fromDirectory: boolean;
}> {
  const items = dataTransfer.items;
  if (!items || items.length === 0) {
    return { files: Array.from(dataTransfer.files), fromDirectory: false };
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
    return { files: Array.from(dataTransfer.files), fromDirectory: false };
  }

  const collected: File[] = [];

  async function walkEntry(entry: FileSystemEntry): Promise<void> {
    if (entry.isFile) {
      const fileEntry = entry as FileSystemFileEntry;
      const file = await new Promise<File | null>((resolve) => {
        fileEntry.file(
          (f) => resolve(f),
          () => resolve(null),
        );
      });
      if (file) collected.push(file);
    } else if (entry.isDirectory) {
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
        await walkEntry(child);
      }
    }
  }

  for (const entry of entries) {
    await walkEntry(entry);
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

export default function App() {
  const [samples, setSamples] = useState<LoadedSample[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('spectrum');
  const [targetUnit, setTargetUnit] = useState<SpectralTargetUnit>('native');
  const [baselineEnabled, setBaselineEnabled] = useState(false);
  const [baselineStrength, setBaselineStrength] = useState<BaselineStrength>('standard');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingSamples, setIsLoadingSamples] = useState(true);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const folderInputRef = useRef<HTMLInputElement | null>(null);
  const nextColorIndexRef = useRef<number>(0);

  const allocateColor = useCallback(() => {
    const color = TRACE_COLOR_PALETTE[nextColorIndexRef.current % TRACE_COLOR_PALETTE.length];
    nextColorIndexRef.current += 1;
    return color;
  }, []);

  // Load both bundled Renishaw sample files on startup
  useEffect(() => {
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
            sourceLabel: 'Bundled sample',
            bytes,
            wdf,
            visible: i === 0,
            color: TRACE_COLOR_PALETTE[i % TRACE_COLOR_PALETTE.length],
          });
        } catch (err) {
          console.error(`Failed to parse bundled sample ${spec.fileName}:`, err);
        }
      }
      if (!cancelled) {
        nextColorIndexRef.current = loaded.length;
        setSamples(loaded);
        if (loaded.length > 0) {
          setSelectedId(loaded[0].id);
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
    async (files: File[], isDirectoryBatch = false) => {
      if (files.length === 0) return;
      setErrorMessage(null);
      const newlyLoaded: LoadedSample[] = [];
      const errors: string[] = [];

      // Sort directory files alphabetically for predictable ordering
      const orderedFiles = [...files].sort((a, b) => a.name.localeCompare(b.name));

      for (const file of orderedFiles) {
        if (file.name.startsWith('.')) continue;
        try {
          const buf = await file.arrayBuffer();
          const bytes = new Uint8Array(buf);

          // In directory mode, quietly skip non-WDF auxiliary files (images, hidden OS files, etc.)
          if (isDirectoryBatch && !hasWdf1Magic(bytes)) {
            if (file.name.toLowerCase().endsWith('.wdf')) {
              errors.push(`${file.name}: Invalid WDF1 header signature`);
            }
            continue;
          }

          const wdf = parseWdf(bytes);
          newlyLoaded.push({
            id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
            fileName: file.name,
            sourceLabel: isDirectoryBatch ? 'Folder import' : 'Uploaded',
            bytes,
            wdf,
            visible: true,
            color: allocateColor(),
          });
        } catch (err) {
          errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unable to parse file'}`);
        }
      }

      if (newlyLoaded.length > 0) {
        setSamples((prev) => {
          // If only 1 file was previously visible and user uploaded a single file, show the newly uploaded file;
          // if user loaded multiple files / a folder, tick all newly loaded files so they appear on the chart.
          if (newlyLoaded.length === 1 && prev.filter((s) => s.visible).length <= 1) {
            return [
              ...newlyLoaded,
              ...prev.map((s) => ({ ...s, visible: false })),
            ];
          }
          return [...newlyLoaded, ...prev];
        });
        setSelectedId(newlyLoaded[0].id);
      } else if (isDirectoryBatch && errors.length === 0) {
        setErrorMessage('No valid Renishaw .wdf files (WDF1 signature) were found in the selected folder.');
      }

      if (errors.length > 0) {
        setErrorMessage(errors.slice(0, 4).join(' · '));
      }
    },
    [allocateColor],
  );

  const activeSample = samples.find((s) => s.id === selectedId) ?? null;

  const handleSelectSample = (id: string) => {
    setSelectedId(id);
    setSamples((prev) => {
      const visibleList = prev.filter((s) => s.visible);
      // If we are in single-trace view, clicking another file switches the plotted trace to the clicked file.
      if (visibleList.length <= 1) {
        return prev.map((s) => ({ ...s, visible: s.id === id }));
      }
      // If multiple files are already ticked, keep them ticked and ensure the clicked file is also visible.
      return prev.map((s) => (s.id === id ? { ...s, visible: true } : s));
    });
    setErrorMessage(null);
  };

  const handleToggleSampleVisible = (id: string) => {
    setSamples((prev) => {
      const target = prev.find((s) => s.id === id);
      if (!target) return prev;
      const visibleCount = prev.filter((s) => s.visible).length;
      // Keep at least 1 spectrum visible on the chart
      if (target.visible && visibleCount <= 1) {
        return prev;
      }
      return prev.map((s) => (s.id === id ? { ...s, visible: !s.visible } : s));
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

  const handleDownloadCsv = () => {
    if (!activeSample) return;
    const base = activeSample.fileName.replace(/\.[^.]+$/, '');
    const csv = wdfToCsv(activeSample.wdf, {
      spectrumIndex: 0,
      sortAscending: true,
      targetUnit,
    });
    triggerDownload(csv, `${base}.csv`, 'text/csv;charset=utf-8');
  };

  const handleDownloadJson = () => {
    if (!activeSample) return;
    const base = activeSample.fileName.replace(/\.[^.]+$/, '');
    const json = serializeWdfForJson(activeSample.wdf);
    triggerDownload(json, `${base}.json`, 'application/json;charset=utf-8');
  };

  const handleDownloadTsModule = () => {
    const code = buildStandaloneWdfReaderTs();
    triggerDownload(code, 'wdfReader.ts', 'text/typescript;charset=utf-8');
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
      {/* Standard Multi-File Picker */}
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".wdf,.txt,*/*"
        className="hidden"
        aria-label="Upload Renishaw WDF file"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          void ingestFiles(files, false);
          e.target.value = '';
        }}
      />

      {/* Directory Picker (loads all .wdf files in the chosen folder) */}
      <input
        ref={folderInputRef}
        type="file"
        multiple
        // @ts-expect-error non-standard webkitdirectory attribute supported by Chromium, Firefox, Safari
        webkitdirectory=""
        directory=""
        className="hidden"
        aria-label="Upload Renishaw WDF folder"
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          void ingestFiles(files, true);
          e.target.value = '';
        }}
      />

      <TopBar
        activeTab={activeTab}
        onSelectTab={setActiveTab}
        onOpenFileClick={() => fileInputRef.current?.click()}
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
        <Sidebar
          samples={samples}
          selectedId={selectedId}
          onSelectSample={handleSelectSample}
          onToggleSampleVisible={handleToggleSampleVisible}
          onSetAllVisible={handleSetAllVisible}
          onChangeSampleColor={handleChangeSampleColor}
          onOpenFileClick={() => fileInputRef.current?.click()}
          onOpenFolderClick={() => folderInputRef.current?.click()}
          onDownloadCsv={handleDownloadCsv}
          onDownloadJson={handleDownloadJson}
          onDownloadTsModule={handleDownloadTsModule}
          isDraggingFile={isDraggingFile}
        />

        <main className="flex-1 min-w-0 lg:overflow-y-auto bg-slate-50">
          {isLoadingSamples ? (
            <div className="p-8 text-sm text-slate-500 font-mono">
              Loading bundled Renishaw .wdf spectra…
            </div>
          ) : !activeSample ? (
            <div className="p-8 text-sm text-slate-600">
              Open or drop a Renishaw <span className="font-mono">.wdf</span> file or folder to inspect its spectral data, PSET instrument metadata, and block map.
            </div>
          ) : activeTab === 'spectrum' ? (
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
              onToggleSampleVisible={handleToggleSampleVisible}
              onSetAllVisible={handleSetAllVisible}
              onChangeSampleColor={handleChangeSampleColor}
            />
          ) : activeTab === 'instrument' ? (
            <InstrumentView wdf={activeSample.wdf} rawBytes={activeSample.bytes} />
          ) : activeTab === 'blocks' ? (
            <BlockMapView wdf={activeSample.wdf} rawBytes={activeSample.bytes} />
          ) : (
            <TypeScriptExportView
              wdf={activeSample.wdf}
              fileName={activeSample.fileName}
              onDownloadTsModule={handleDownloadTsModule}
              onDownloadJson={handleDownloadJson}
            />
          )}
        </main>
      </div>
      <OfflineIndicator />
    </div>
  );
}
