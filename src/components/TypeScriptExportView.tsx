import { useMemo, useState } from 'react';
import { Check, Copy, Download } from 'lucide-react';
import type { WdfFile } from '../lib/wdf';
import {
  buildStandaloneWdfReaderTs,
  DIGITAL_TRAVELLER_BROWSER_SNIPPET,
  DIGITAL_TRAVELLER_NODE_SNIPPET,
} from '../lib/wdf/exportModule';

interface TypeScriptExportViewProps {
  wdf: WdfFile;
  fileName: string;
  onDownloadTsModule: () => void;
  onDownloadJson: () => void;
}

type CodeTab = 'usage' | 'module' | 'json';

export function serializeWdfForJson(wdf: WdfFile): string {
  const payload = {
    byteLength: wdf.byteLength,
    header: wdf.header,
    summary: wdf.summary,
    xAxis: wdf.xAxis
      ? {
          dataTypeName: wdf.xAxis.dataTypeName,
          unitsName: wdf.xAxis.unitsName,
          unitsSymbol: wdf.xAxis.unitsSymbol,
          length: wdf.xAxis.values.length,
          first5: Array.from(wdf.xAxis.values.slice(0, 5)),
          last5: Array.from(wdf.xAxis.values.slice(-5)),
        }
      : null,
    spectraSummary: {
      totalPoints: wdf.spectra.length,
      spectraCollected: wdf.header.spectraCollected,
      pointsPerSpectrum: wdf.header.pointsPerSpectrum,
      first10Intensities: Array.from(wdf.spectra.slice(0, 10)),
    },
    origins: wdf.origins,
    mapArea: wdf.mapArea,
    comment: wdf.comment,
    blocks: wdf.blocks,
    propertySets: wdf.propertySets,
    warnings: wdf.warnings,
  };

  return JSON.stringify(
    payload,
    (_key, val) => {
      if (val instanceof Uint8Array) {
        return `<Uint8Array(${val.byteLength} bytes)>`;
      }
      if (val instanceof Float32Array) {
        return Array.from(val);
      }
      return val;
    },
    2,
  );
}

export function TypeScriptExportView({
  wdf,
  fileName,
  onDownloadTsModule,
  onDownloadJson,
}: TypeScriptExportViewProps) {
  const [activeCodeTab, setActiveCodeTab] = useState<CodeTab>('usage');
  const [runtimeMode, setRuntimeMode] = useState<'node' | 'browser'>('node');
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const standaloneModule = useMemo(() => buildStandaloneWdfReaderTs(), []);
  const liveJson = useMemo(() => serializeWdfForJson(wdf), [wdf]);

  const moduleLines = useMemo(() => standaloneModule.split('\n').length, [standaloneModule]);

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 2000);
    } catch {
      // Fallback for restricted clipboard environments
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 2000);
    }
  };

  const activeCopyText =
    activeCodeTab === 'module'
      ? standaloneModule
      : activeCodeTab === 'json'
        ? liveJson
        : runtimeMode === 'node'
          ? DIGITAL_TRAVELLER_NODE_SNIPPET
          : DIGITAL_TRAVELLER_BROWSER_SNIPPET;

  return (
    <div className="p-5 lg:p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
            TypeScript Module for Digital-Traveller
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Zero-dependency single-file <span className="font-mono text-slate-700">wdfReader.ts</span> ({moduleLines.toLocaleString()} lines) — drop directly into Node.js or Browser TypeScript projects.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => handleCopy(standaloneModule, 'standalone')}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-800 cursor-pointer whitespace-nowrap"
          >
            {copiedKey === 'standalone' ? (
              <>
                <Check className="w-3.5 h-3.5 text-emerald-600" aria-hidden="true" />
                <span>Copied wdfReader.ts</span>
              </>
            ) : (
              <>
                <Copy className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                <span>Copy wdfReader.ts</span>
              </>
            )}
          </button>

          <button
            type="button"
            onClick={onDownloadTsModule}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer whitespace-nowrap"
          >
            <Download className="w-3.5 h-3.5" aria-hidden="true" />
            <span>Download wdfReader.ts</span>
          </button>
        </div>
      </div>

      {/* API Reference Summary Strip */}
      <div className="grid grid-cols-1 md:grid-cols-4 border border-slate-200 rounded bg-white divide-y md:divide-y-0 md:divide-x divide-slate-200 text-xs">
        <div className="p-3.5">
          <div className="font-mono font-semibold text-slate-900">parseWdf(buffer, opts?)</div>
          <p className="mt-1 text-slate-500">Accepts Node Buffer, Uint8Array, or ArrayBuffer. Returns typed WdfFile.</p>
        </div>
        <div className="p-3.5">
          <div className="font-mono font-semibold text-slate-900">parseWdfFile(file, opts?)</div>
          <p className="mt-1 text-slate-500">Browser helper that reads File/Blob via arrayBuffer() and parses blocks.</p>
        </div>
        <div className="p-3.5">
          <div className="font-mono font-semibold text-slate-900">convertXAxis(xAxis, laser, unit)</div>
          <p className="mt-1 text-slate-500">Converts between Raman Shift, Abs. cm⁻¹, Wavelength nm, and Energy eV.</p>
        </div>
        <div className="p-3.5">
          <div className="font-mono font-semibold text-slate-900">subtractBaseline / detectPeaks / wdfToCsv</div>
          <p className="mt-1 text-slate-500">AsLS fluorescence baseline removal, FWHM peak detection, and RFC-4180 CSV export.</p>
        </div>
      </div>

      {/* Tabbed Code Panel */}
      <section className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-1" role="tablist" aria-label="Export views">
            {(
              [
                { id: 'usage', label: 'Digital-Traveller Usage' },
                { id: 'module', label: 'Full wdfReader.ts Module' },
                { id: 'json', label: 'Live Parsed JSON' },
              ] as Array<{ id: CodeTab; label: string }>
            ).map((tab) => (
              <button
                key={tab.id}
                type="button"
                role="tab"
                aria-selected={activeCodeTab === tab.id}
                onClick={() => setActiveCodeTab(tab.id)}
                className={`px-3 py-1.5 rounded text-xs font-medium cursor-pointer transition-colors ${
                  activeCodeTab === tab.id
                    ? 'bg-white text-blue-600 border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-2">
            {activeCodeTab === 'usage' && (
              <div className="inline-flex rounded border border-slate-200 bg-white p-0.5 text-xs">
                <button
                  type="button"
                  onClick={() => setRuntimeMode('node')}
                  className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                    runtimeMode === 'node' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Node.js
                </button>
                <button
                  type="button"
                  onClick={() => setRuntimeMode('browser')}
                  className={`px-2 py-0.5 rounded-xs cursor-pointer ${
                    runtimeMode === 'browser' ? 'bg-slate-900 text-white' : 'text-slate-600 hover:text-slate-900'
                  }`}
                >
                  Browser
                </button>
              </div>
            )}

            {activeCodeTab === 'json' && (
              <>
                <span className="hidden sm:inline text-[11px] font-mono text-slate-500">
                  {fileName}
                </span>
                <button
                  type="button"
                  onClick={onDownloadJson}
                  className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
                >
                  <Download className="w-3 h-3" aria-hidden="true" />
                  <span>Save JSON</span>
                </button>
              </>
            )}

            <button
              type="button"
              onClick={() => handleCopy(activeCopyText, activeCodeTab)}
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
            >
              {copiedKey === activeCodeTab ? (
                <>
                  <Check className="w-3 h-3 text-emerald-600" aria-hidden="true" />
                  <span>Copied</span>
                </>
              ) : (
                <>
                  <Copy className="w-3 h-3 text-slate-500" aria-hidden="true" />
                  <span>Copy</span>
                </>
              )}
            </button>
          </div>
        </div>

        <pre className="p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-5 overflow-auto max-h-[540px]">
          <code>{activeCopyText}</code>
        </pre>
      </section>
    </div>
  );
}
