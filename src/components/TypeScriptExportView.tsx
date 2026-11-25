import { useMemo, useState } from 'react';
import { Check, Copy, Download, FileCode2, Workflow } from 'lucide-react';
import {
  buildStandaloneWdfReaderTs,
  DIGITAL_TRAVELLER_BROWSER_SNIPPET,
  DIGITAL_TRAVELLER_NODE_SNIPPET,
} from '../lib/wdf/exportModule';

import githubWorkflowRaw from '../../.github/workflows/deploy-pwa.yml?raw';
import viteConfigRaw from '../../vite.config.ts?raw';
import packageJsonRaw from '../../package.json?raw';
import appTsxRaw from '../App.tsx?raw';
import spectrumViewRaw from './SpectrumView.tsx?raw';
import sidebarRaw from './Sidebar.tsx?raw';
import traceColorPickerRaw from './TraceColorPicker.tsx?raw';
import instrumentViewRaw from './InstrumentView.tsx?raw';
import blockMapViewRaw from './BlockMapView.tsx?raw';
import parserRaw from '../lib/wdf/parser.ts?raw';
import psetRaw from '../lib/wdf/pset.ts?raw';
import typesRaw from '../lib/wdf/types.ts?raw';

interface TypeScriptExportViewProps {
  onDownloadTsModule: () => void;
}

type CodeTab = 'usage' | 'module' | 'github-pwa';

interface ProjectSourceFile {
  path: string;
  downloadName: string;
  category: 'GitHub & PWA Config' | 'WDF Parser Library (src/lib/wdf)' | 'Workbench UI (src/components)';
  content: string;
}

const PROJECT_SOURCE_FILES: ProjectSourceFile[] = [
  {
    path: '.github/workflows/deploy-pwa.yml',
    downloadName: 'deploy-pwa.yml',
    category: 'GitHub & PWA Config',
    content: githubWorkflowRaw,
  },
  {
    path: 'vite.config.ts',
    downloadName: 'vite.config.ts',
    category: 'GitHub & PWA Config',
    content: viteConfigRaw,
  },
  {
    path: 'package.json',
    downloadName: 'package.json',
    category: 'GitHub & PWA Config',
    content: packageJsonRaw,
  },
  {
    path: 'src/lib/wdf/parser.ts',
    downloadName: 'parser.ts',
    category: 'WDF Parser Library (src/lib/wdf)',
    content: parserRaw,
  },
  {
    path: 'src/lib/wdf/pset.ts',
    downloadName: 'pset.ts',
    category: 'WDF Parser Library (src/lib/wdf)',
    content: psetRaw,
  },
  {
    path: 'src/lib/wdf/types.ts',
    downloadName: 'types.ts',
    category: 'WDF Parser Library (src/lib/wdf)',
    content: typesRaw,
  },
  {
    path: 'src/App.tsx',
    downloadName: 'App.tsx',
    category: 'Workbench UI (src/components)',
    content: appTsxRaw,
  },
  {
    path: 'src/components/SpectrumView.tsx',
    downloadName: 'SpectrumView.tsx',
    category: 'Workbench UI (src/components)',
    content: spectrumViewRaw,
  },
  {
    path: 'src/components/Sidebar.tsx',
    downloadName: 'Sidebar.tsx',
    category: 'Workbench UI (src/components)',
    content: sidebarRaw,
  },
  {
    path: 'src/components/TraceColorPicker.tsx',
    downloadName: 'TraceColorPicker.tsx',
    category: 'Workbench UI (src/components)',
    content: traceColorPickerRaw,
  },
  {
    path: 'src/components/InstrumentView.tsx',
    downloadName: 'InstrumentView.tsx',
    category: 'Workbench UI (src/components)',
    content: instrumentViewRaw,
  },
  {
    path: 'src/components/BlockMapView.tsx',
    downloadName: 'BlockMapView.tsx',
    category: 'Workbench UI (src/components)',
    content: blockMapViewRaw,
  },
];

function downloadTextFile(content: string, fileName: string) {
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function TypeScriptExportView({
  onDownloadTsModule,
}: TypeScriptExportViewProps) {
  const [activeCodeTab, setActiveCodeTab] = useState<CodeTab>('usage');
  const [runtimeMode, setRuntimeMode] = useState<'node' | 'browser'>('node');
  const [selectedSourcePath, setSelectedSourcePath] = useState<string>(PROJECT_SOURCE_FILES[0].path);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const standaloneModule = useMemo(() => buildStandaloneWdfReaderTs(), []);
  const moduleLines = useMemo(() => standaloneModule.split('\n').length, [standaloneModule]);

  const activeSourceFile =
    PROJECT_SOURCE_FILES.find((f) => f.path === selectedSourcePath) ?? PROJECT_SOURCE_FILES[0];

  const handleCopy = async (text: string, key: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      window.setTimeout(() => setCopiedKey((curr) => (curr === key ? null : curr)), 2000);
    } catch {
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
      : activeCodeTab === 'github-pwa'
        ? activeSourceFile.content
        : runtimeMode === 'node'
          ? DIGITAL_TRAVELLER_NODE_SNIPPET
          : DIGITAL_TRAVELLER_BROWSER_SNIPPET;

  return (
    <div className="p-5 lg:p-6 space-y-5 max-w-[1400px]">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
            TypeScript Module, GitHub Actions PWA &amp; Source
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Zero-dependency <span className="font-mono text-slate-700">wdfReader.ts</span> ({moduleLines.toLocaleString()} lines), GitHub Actions PWA builder workflow, and full <span className="font-mono text-slate-700">src/</span> codebase.
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
          <div className="font-mono font-semibold text-slate-900">subtractBaseline / detectPeaks</div>
          <p className="mt-1 text-slate-500">AsLS fluorescence baseline removal and FWHM local peak detection.</p>
        </div>
      </div>

      {/* Tabbed Code Panel */}
      <section className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap items-center gap-1" role="tablist" aria-label="Export views">
            {(
              [
                { id: 'usage', label: 'Digital-Traveller Usage' },
                { id: 'module', label: 'Full wdfReader.ts Module' },
                { id: 'github-pwa', label: 'GitHub Actions PWA & src/ Files' },
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

            {activeCodeTab === 'github-pwa' && (
              <button
                type="button"
                onClick={() => downloadTextFile(activeSourceFile.content, activeSourceFile.downloadName)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer"
              >
                <Download className="w-3 h-3" aria-hidden="true" />
                <span>Download {activeSourceFile.downloadName}</span>
              </button>
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

        {/* GitHub Actions PWA & Source File Browser Sub-Header */}
        {activeCodeTab === 'github-pwa' && (
          <div className="p-4 bg-white border-b border-slate-200 space-y-3">
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-3 text-xs">
              <div className="p-3 rounded border border-slate-200 bg-slate-50/70">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <Workflow className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                  <span>1. Sync or Push to GitHub</span>
                </div>
                <p className="mt-1 text-slate-600">
                  The workflow <span className="font-mono text-slate-800">.github/workflows/deploy-pwa.yml</span> is already included in this project root.
                </p>
              </div>
              <div className="p-3 rounded border border-slate-200 bg-slate-50/70">
                <div className="font-semibold text-slate-900 flex items-center gap-1.5">
                  <FileCode2 className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
                  <span>2. Enable GitHub Pages (Actions)</span>
                </div>
                <p className="mt-1 text-slate-600">
                  In your GitHub repo, open <strong>Settings → Pages</strong> and set <strong>Build and deployment → Source</strong> to <strong>GitHub Actions</strong>.
                </p>
              </div>
              <div className="p-3 rounded border border-slate-200 bg-slate-50/70">
                <div className="font-semibold text-slate-900">
                  3. Automatic PWA Build &amp; Offline Artifact
                </div>
                <p className="mt-1 text-slate-600">
                  Every push runs unit tests, builds the offline Service Worker + Web App Manifest with automatic <span className="font-mono">GITHUB_PAGES_BASE</span> pathing, and publishes the installable PWA.
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-1.5 pt-1">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mr-1.5">
                Inspect Source File:
              </span>
              {PROJECT_SOURCE_FILES.map((file) => {
                const isSelected = file.path === activeSourceFile.path;
                return (
                  <button
                    key={file.path}
                    type="button"
                    onClick={() => setSelectedSourcePath(file.path)}
                    className={`px-2.5 py-1 rounded border text-xs font-mono cursor-pointer transition-colors ${
                      isSelected
                        ? 'bg-blue-600 border-blue-600 text-white'
                        : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                    }`}
                  >
                    {file.path}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <pre className="p-4 bg-slate-950 text-slate-100 font-mono text-xs leading-5 overflow-auto max-h-[540px]">
          <code>{activeCopyText}</code>
        </pre>
      </section>
    </div>
  );
}
