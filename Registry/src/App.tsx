import { useMemo, useRef, useState } from 'react';
import {
  decodeRegistryInput,
  DEFAULT_VIRSA_RULE_CONFIG,
  evaluateVirsaRules,
  parseRegistry,
  SAMPLE_FIXTURES,
  summarizeRegistry,
  type ParsedRegistry,
  type RegistryAnalysisSummary,
  type RegistryInput,
} from './registry';
import { AnalysisView } from './components/AnalysisView';
import { TreeInspectorView } from './components/TreeInspectorView';
import { SourceDiagnosticsView } from './components/SourceDiagnosticsView';
import { ModuleApiView } from './components/ModuleApiView';

type ActiveTab = 'analysis' | 'tree' | 'source' | 'api';

export interface AppProps {
  /** Optional registry input (string, Uint8Array, or ArrayBuffer) supplied by a host application. */
  readonly initialInput?: RegistryInput;
  /** Optional source filename supplied by a host application. */
  readonly initialFileName?: string;
  /** Optional external system folder or file prefix for Test 5 serial matching. */
  readonly initialFolderContext?: string;
}

interface ActiveRegistryDocument {
  readonly fileName: string;
  readonly rawInput: RegistryInput;
  readonly decodedText: string;
}

function buildInitialDocument(
  initialInput?: RegistryInput,
  initialFileName?: string,
): ActiveRegistryDocument {
  if (initialInput !== undefined) {
    const decoded = decodeRegistryInput(initialInput);
    return {
      fileName: initialFileName ?? 'system.reg',
      rawInput: initialInput,
      decodedText: decoded.text,
    };
  }

  const defaultFixture = SAMPLE_FIXTURES[0];
  return {
    fileName: initialFileName ?? defaultFixture.suggestedFileName,
    rawInput: defaultFixture.content,
    decodedText: defaultFixture.content,
  };
}

export default function App({
  initialInput,
  initialFileName,
  initialFolderContext,
}: AppProps = {}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const [activeTab, setActiveTab] = useState<ActiveTab>('analysis');
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [folderContext, setFolderContext] = useState<string>(
    initialFolderContext ?? (initialInput === undefined ? (SAMPLE_FIXTURES[0].suggestedFolderName ?? '') : ''),
  );
  const [minLaserPower, setMinLaserPower] = useState<number>(
    DEFAULT_VIRSA_RULE_CONFIG.minLaserPower,
  );
  const [activeDoc, setActiveDoc] = useState<ActiveRegistryDocument>(() =>
    buildInitialDocument(initialInput, initialFileName),
  );

  const parsed: ParsedRegistry = useMemo(
    () => parseRegistry(activeDoc.rawInput, { sourceName: activeDoc.fileName }),
    [activeDoc],
  );

  const summary: RegistryAnalysisSummary = useMemo(() => summarizeRegistry(parsed), [parsed]);

  const ruleReport = useMemo(
    () =>
      evaluateVirsaRules(parsed, {
        summary,
        sourceFolderName: folderContext,
        sourceFileName: activeDoc.fileName,
        configOverrides: { minLaserPower },
      }),
    [parsed, summary, folderContext, activeDoc.fileName, minLaserPower],
  );

  const handleFileUpload = async (file: File): Promise<void> => {
    const buffer = await file.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    const decoded = decodeRegistryInput(bytes);
    setActiveDoc({
      fileName: file.name,
      rawInput: bytes,
      decodedText: decoded.text,
    });
    setSelectedPath(null);
    setFolderContext('');
  };

  const handleEditSourceText = (nextText: string): void => {
    setActiveDoc((prev) => ({
      ...prev,
      rawInput: nextText,
      decodedText: nextText,
    }));
  };

  const handleInspectPath = (path: string): void => {
    setSelectedPath(path);
    setActiveTab('tree');
  };

  const navItems: ReadonlyArray<{ readonly id: ActiveTab; readonly label: string }> = [
    { id: 'analysis', label: 'Analysis' },
    { id: 'tree', label: 'Tree Inspector' },
    { id: 'source', label: 'Source & Diagnostics' },
    { id: 'api', label: 'Module API' },
  ];

  return (
    <div className="min-h-screen flex flex-col bg-white text-slate-900">
      {/* Strict 3-Zone Top Bar Contract */}
      <header className="sticky top-0 z-20 bg-white border-b border-slate-200 px-6 h-14 flex items-center justify-between gap-8">
        <a
          href="#top"
          onClick={(e) => {
            e.preventDefault();
            setActiveTab('analysis');
          }}
          className="text-base font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0"
        >
          WiRE Registry Studio
        </a>

        <nav aria-label="Primary sections" className="hidden md:flex items-center gap-6">
          {navItems.map((item) => {
            const active = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveTab(item.id)}
                className={`py-1 text-sm font-medium transition-colors whitespace-nowrap shrink-0 border-b-2 ${
                  active
                    ? 'border-blue-700 text-slate-900'
                    : 'border-transparent text-slate-600 hover:text-slate-900'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        <div className="shrink-0">
          <input
            ref={fileInputRef}
            type="file"
            accept=".reg,.rrg,.txt"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) {
                void handleFileUpload(file);
                e.target.value = '';
              }
            }}
          />
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Load File
          </button>
        </div>
      </header>

      {/* Mobile Navigation Row */}
      <nav
        aria-label="Mobile sections"
        className="flex md:hidden items-center gap-1 overflow-x-auto border-b border-slate-200 bg-slate-50 px-4 py-2"
      >
        {navItems.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => setActiveTab(item.id)}
            className={`px-3 py-1.5 text-xs font-medium rounded-md whitespace-nowrap shrink-0 ${
              activeTab === item.id
                ? 'bg-white text-slate-900 shadow-xs'
                : 'text-slate-600'
            }`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      {/* Full-Width Single-System Workspace */}
      <main className="flex-1 min-w-0 max-w-[1440px] w-full mx-auto p-6 lg:p-8">
        {activeTab === 'analysis' && (
          <AnalysisView
            registry={parsed}
            summary={summary}
            report={ruleReport}
            folderContext={folderContext}
            onFolderContextChange={setFolderContext}
            minLaserPower={minLaserPower}
            onMinLaserPowerChange={setMinLaserPower}
            onInspectPath={handleInspectPath}
          />
        )}

        {activeTab === 'tree' && (
          <TreeInspectorView
            registry={parsed}
            selectedPath={selectedPath}
            onSelectPath={setSelectedPath}
          />
        )}

        {activeTab === 'source' && (
          <SourceDiagnosticsView
            sourceText={activeDoc.decodedText}
            onSourceTextChange={handleEditSourceText}
            registry={parsed}
            isLargeFile={parsed.stats.totalLines > 500}
          />
        )}

        {activeTab === 'api' && <ModuleApiView />}
      </main>
    </div>
  );
}
