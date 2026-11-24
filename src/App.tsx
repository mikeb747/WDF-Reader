import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertCircle, X } from 'lucide-react';
import { BlockMapView } from './components/BlockMapView';
import { InstrumentView } from './components/InstrumentView';
import { Sidebar, type LoadedSample } from './components/Sidebar';
import { SpectrumView, type BaselineStrength } from './components/SpectrumView';
import { TopBar, type ActiveTab } from './components/TopBar';
import { serializeWdfForJson, TypeScriptExportView } from './components/TypeScriptExportView';
import { parseWdf, wdfToCsv, type SpectralTargetUnit } from './lib/wdf';
import { buildStandaloneWdfReaderTs } from './lib/wdf/exportModule';

const BUNDLED_SAMPLES: Array<{ id: string; fileName: string; url: string }> = [
  {
    id: 'sample-si-520',
    fileName: '532nm_1800_520scan.wdf',
    url: '/assets/aistudio/532nm_1800_520scan_62354700.txt',
  },
  {
    id: 'sample-pcl-17087',
    fileName: '532nm_1800_17087 abs cm-1_PCL.wdf',
    url: '/assets/aistudio/532nm_1800_17087_abs_cm-1_PCL_e8762f36.txt',
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

export default function App() {
  const [samples, setSamples] = useState<LoadedSample[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<ActiveTab>('spectrum');
  const [targetUnit, setTargetUnit] = useState<SpectralTargetUnit>('native');
  const [baselineEnabled, setBaselineEnabled] = useState(false);
  const [baselineStrength, setBaselineStrength] = useState<BaselineStrength>('standard');
  const [overlayEnabled, setOverlayEnabled] = useState(false);
  const [overlayIds, setOverlayIds] = useState<string[]>([]);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [isLoadingSamples, setIsLoadingSamples] = useState(true);
  const [isDraggingFile, setIsDraggingFile] = useState(false);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Load both bundled Renishaw sample files on startup
  useEffect(() => {
    let cancelled = false;
    async function loadBundled() {
      const loaded: LoadedSample[] = [];
      for (const spec of BUNDLED_SAMPLES) {
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
          });
        } catch (err) {
          console.error(`Failed to parse bundled sample ${spec.fileName}:`, err);
        }
      }
      if (!cancelled) {
        setSamples(loaded);
        if (loaded.length > 0) {
          setSelectedId(loaded[0].id);
          setOverlayIds(loaded.slice(0, 4).map((s) => s.id));
        }
        setIsLoadingSamples(false);
      }
    }
    loadBundled();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleFiles = useCallback(async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    setErrorMessage(null);
    const newlyLoaded: LoadedSample[] = [];
    const errors: string[] = [];

    for (const file of Array.from(fileList)) {
      try {
        const buf = await file.arrayBuffer();
        const bytes = new Uint8Array(buf);
        const wdf = parseWdf(bytes);
        newlyLoaded.push({
          id: `upload-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          fileName: file.name,
          sourceLabel: 'Uploaded',
          bytes,
          wdf,
        });
      } catch (err) {
        errors.push(`${file.name}: ${err instanceof Error ? err.message : 'Unable to parse file'}`);
      }
    }

    if (newlyLoaded.length > 0) {
      setSamples((prev) => [...newlyLoaded, ...prev]);
      setSelectedId(newlyLoaded[0].id);
      setOverlayIds((prev) => {
        const next = [...newlyLoaded.map((s) => s.id), ...prev];
        return Array.from(new Set(next)).slice(0, 6);
      });
      if (!overlayEnabled) {
        setTargetUnit('native');
      }
    }
    if (errors.length > 0) {
      setErrorMessage(errors.join(' · '));
    }
  }, [overlayEnabled]);

  const activeSample = samples.find((s) => s.id === selectedId) ?? null;

  const handleSelectSample = (id: string) => {
    setSelectedId(id);
    if (!overlayEnabled) {
      setTargetUnit('native');
    } else {
      setOverlayIds((prev) => (prev.includes(id) ? prev : [...prev, id]));
    }
    setErrorMessage(null);
  };

  const handleToggleOverlay = () => {
    setOverlayEnabled((prev) => {
      const next = !prev;
      if (next) {
        const currentIds = overlayIds.filter((id) => samples.some((s) => s.id === id));
        const ensured = currentIds.length >= 2 ? currentIds : samples.slice(0, 4).map((s) => s.id);
        setOverlayIds(ensured);
        // Automatically unify X-axis onto Raman Shift when overlaid files have mixed native units
        const selectedSamples = samples.filter((s) => ensured.includes(s.id));
        const distinctUnits = new Set(selectedSamples.map((s) => s.wdf.xAxis?.units));
        if (targetUnit === 'native' && distinctUnits.size > 1) {
          setTargetUnit('ramanShift');
        }
      }
      return next;
    });
  };

  const handleToggleOverlaySample = (id: string) => {
    setOverlayIds((prev) => {
      if (prev.includes(id)) {
        // Keep at least one spectrum visible in overlay mode
        if (prev.length <= 1) return prev;
        return prev.filter((item) => item !== id);
      }
      return [...prev, id];
    });
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
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <input
        ref={fileInputRef}
        type="file"
        multiple
        accept=".wdf,.txt,*/*"
        className="hidden"
        aria-label="Upload Renishaw WDF file"
        onChange={(e) => {
          void handleFiles(e.target.files);
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
          onOpenFileClick={() => fileInputRef.current?.click()}
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
              Open or drop a Renishaw <span className="font-mono">.wdf</span> file to inspect its spectral data, PSET instrument metadata, and block map.
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
              overlayEnabled={overlayEnabled}
              onToggleOverlay={handleToggleOverlay}
              overlayIds={overlayIds}
              onToggleOverlaySample={handleToggleOverlaySample}
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
    </div>
  );
}
