import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import {
  parseWdf,
  WDF_BLOCK_DESCRIPTIONS,
  type PsetObject,
  type PsetValue,
  type WdfFile,
} from '../lib/wdf';

interface InstrumentViewProps {
  wdf: WdfFile;
  rawBytes: Uint8Array;
}

function isPsetObject(val: PsetValue): val is PsetObject {
  return typeof val === 'object' && val !== null && !Array.isArray(val) && !(val instanceof Uint8Array);
}

function formatLeafValue(val: PsetValue): string {
  if (val === null) return 'null';
  if (typeof val === 'boolean') return val ? 'true' : 'false';
  if (typeof val === 'number') return Number.isInteger(val) ? String(val) : Number(val.toPrecision(8)).toString();
  if (typeof val === 'string') return val;
  if (val instanceof Uint8Array) return `<Binary ${val.byteLength} bytes>`;
  if (Array.isArray(val)) {
    if (val.length === 0) return '[]';
    if (val.length <= 6 && val.every((v) => typeof v !== 'object' || v === null)) {
      return `[${val.map((v) => formatLeafValue(v)).join(', ')}]`;
    }
    return `[Array(${val.length})]`;
  }
  return '';
}

function matchesSearch(key: string, value: PsetValue, query: string): boolean {
  if (!query) return true;
  const q = query.toLowerCase();
  if (key.toLowerCase().includes(q)) return true;
  if (isPsetObject(value)) {
    return Object.entries(value).some(([k, v]) => matchesSearch(k, v, q));
  }
  if (Array.isArray(value)) {
    return value.some((v, idx) => matchesSearch(String(idx), v, q));
  }
  return formatLeafValue(value).toLowerCase().includes(q);
}

interface TreeNodeProps {
  nodeKey: string;
  value: PsetValue;
  depth: number;
  searchQuery: string;
  forceExpand: boolean | null;
}

function PropertyTreeNode({ nodeKey, value, depth, searchQuery, forceExpand }: TreeNodeProps) {
  const [localExpanded, setLocalExpanded] = useState(depth < 2);

  if (!matchesSearch(nodeKey, value, searchQuery)) {
    return null;
  }

  const isObj = isPsetObject(value);
  const isComplexArr =
    Array.isArray(value) && value.length > 0 && (value.length > 6 || value.some((v) => isPsetObject(v)));
  const expandable = isObj || isComplexArr;

  const isExpanded = searchQuery
    ? true
    : forceExpand !== null
      ? forceExpand
      : localExpanded;

  const entries: Array<[string, PsetValue]> = isObj
    ? Object.entries(value)
    : isComplexArr
      ? (value as PsetValue[]).map((v, idx) => [`[${idx}]`, v])
      : [];

  return (
    <div>
      <div
        className="flex items-baseline justify-between gap-4 py-1.5 px-3 hover:bg-slate-50 border-b border-slate-100 text-xs"
        style={{ paddingLeft: `${12 + depth * 18}px` }}
      >
        <div className="flex items-center gap-1.5 min-w-0">
          {expandable ? (
            <button
              type="button"
              onClick={() => setLocalExpanded((prev) => !prev)}
              className="text-slate-400 hover:text-slate-700 shrink-0 cursor-pointer"
              aria-label={isExpanded ? `Collapse ${nodeKey}` : `Expand ${nodeKey}`}
            >
              {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            </button>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}
          <span className={`truncate ${expandable ? 'font-semibold text-slate-800' : 'text-slate-600'}`}>
            {nodeKey}
          </span>
          {expandable && (
            <span className="text-[11px] font-mono text-slate-400 shrink-0">
              ({entries.length})
            </span>
          )}
        </div>

        {!expandable && (
          <span className="font-mono tabular-nums text-slate-900 text-right break-all max-w-[60%]">
            {formatLeafValue(value)}
          </span>
        )}
      </div>

      {expandable && isExpanded && (
        <div>
          {entries.map(([childKey, childVal]) => (
            <PropertyTreeNode
              key={`${nodeKey}.${childKey}`}
              nodeKey={childKey}
              value={childVal}
              depth={depth + 1}
              searchQuery={searchQuery}
              forceExpand={forceExpand}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function InstrumentView({ wdf, rawBytes }: InstrumentViewProps) {
  const psetBlocks = useMemo(() => Object.keys(wdf.propertySets), [wdf.propertySets]);
  const [selectedBlock, setSelectedBlock] = useState<string>('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [forceExpand, setForceExpand] = useState<boolean | null>(null);
  const [showScript, setShowScript] = useState(false);

  const measurementScript = useMemo(() => {
    if (!showScript) return null;
    try {
      return parseWdf(rawBytes, { includeScript: true }).measurementScript;
    } catch {
      return null;
    }
  }, [rawBytes, showScript]);

  const activeBlocks =
    selectedBlock === 'ALL'
      ? psetBlocks
      : psetBlocks.filter((id) => id === selectedBlock);

  return (
    <div className="p-5 lg:p-6 space-y-5 max-w-[1400px]">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-4 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
            Instrument &amp; PSET Metadata
          </h1>
          <p className="mt-0.5 text-xs text-slate-500">
            Decoded recursive Renishaw PSET property dictionaries, data origins (ORGN), and acquisition notes.
          </p>
        </div>

        {/* Search & Expand Controls */}
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search
              className="w-3.5 h-3.5 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Filter keys or values..."
              aria-label="Filter instrument metadata"
              className="pl-8 pr-3 py-1.5 w-56 rounded border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-blue-600"
            />
          </div>
          <button
            type="button"
            onClick={() => setForceExpand(true)}
            className="px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={() => setForceExpand(false)}
            className="px-2.5 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap"
          >
            Collapse All
          </button>
        </div>
      </div>

      {/* Block Filter Tabs */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="PSET block filter">
        <button
          type="button"
          onClick={() => setSelectedBlock('ALL')}
          className={`px-3 py-1.5 rounded border text-xs font-medium cursor-pointer transition-colors ${
            selectedBlock === 'ALL'
              ? 'bg-blue-600 border-blue-600 text-white'
              : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
          }`}
        >
          All PSET Blocks ({psetBlocks.length})
        </button>
        {psetBlocks.map((blockId) => (
          <button
            key={blockId}
            type="button"
            onClick={() => setSelectedBlock(blockId)}
            className={`px-3 py-1.5 rounded border text-xs font-mono font-medium cursor-pointer transition-colors ${
              selectedBlock === blockId
                ? 'bg-blue-600 border-blue-600 text-white'
                : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50'
            }`}
          >
            {blockId}
          </button>
        ))}
      </div>

      {/* PSET Trees */}
      <div className="space-y-4">
        {activeBlocks.map((blockId) => {
          const data = wdf.propertySets[blockId];
          const topEntries = Object.entries(data).filter(([k, v]) => matchesSearch(k, v, searchQuery));
          if (searchQuery && topEntries.length === 0) return null;

          return (
            <section key={blockId} className="bg-white border border-slate-200 rounded overflow-hidden">
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-baseline gap-2.5">
                  <h2 className="text-xs font-mono font-semibold text-slate-900">{blockId}</h2>
                  <span className="text-xs text-slate-500">
                    {WDF_BLOCK_DESCRIPTIONS[blockId] ?? 'PSET Metadata Block'}
                  </span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">
                  {topEntries.length} root keys
                </span>
              </div>
              <div>
                {topEntries.map(([k, v]) => (
                  <PropertyTreeNode
                    key={`${blockId}.${k}`}
                    nodeKey={k}
                    value={v}
                    depth={0}
                    searchQuery={searchQuery}
                    forceExpand={forceExpand}
                  />
                ))}
              </div>
            </section>
          );
        })}
      </div>

      {/* Data Origin Lists (ORGN) & Comments (TEXT) */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        <section className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Data Origin Lists (ORGN)
            </h2>
            <span className="text-[11px] font-mono tabular-nums text-slate-500">
              {wdf.origins.length} channels
            </span>
          </div>
          {wdf.origins.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500">
                    <th className="py-2 px-3 font-medium">Label</th>
                    <th className="py-2 px-3 font-medium">Data Type</th>
                    <th className="py-2 px-3 font-medium">Units</th>
                    <th className="py-2 px-3 font-medium">Sample Values</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {wdf.origins.map((orig, i) => (
                    <tr key={`${orig.label}-${i}`}>
                      <td className="py-2 px-3 font-medium text-slate-900">
                        {orig.label || '—'}
                        {orig.isPrimary && <span className="ml-1.5 text-[10px] font-mono text-blue-600">PRIMARY</span>}
                      </td>
                      <td className="py-2 px-3 font-mono text-slate-700">{orig.dataTypeName}</td>
                      <td className="py-2 px-3 text-slate-600">{orig.unitsName}</td>
                      <td className="py-2 px-3 font-mono tabular-nums text-slate-800">
                        {orig.values
                          .slice(0, 3)
                          .map((v) => (typeof v === 'number' ? Number(v.toPrecision(7)) : v))
                          .join(', ')}
                        {orig.values.length > 3 ? ` … (${orig.values.length} total)` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-xs text-slate-500">No ORGN lists present.</p>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded overflow-hidden flex flex-col">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
              Acquisition Comment (TEXT) &amp; Script
            </h2>
            <button
              type="button"
              onClick={() => setShowScript((prev) => !prev)}
              className="text-xs font-medium text-blue-600 hover:text-blue-700 cursor-pointer"
            >
              {showScript ? 'Hide WXDM VBScript' : 'Inspect WXDM VBScript'}
            </button>
          </div>
          <div className="p-4 space-y-3 text-xs flex-1">
            {wdf.comment ? (
              <pre className="whitespace-pre-wrap font-mono text-[11px] text-slate-800 bg-slate-50 border border-slate-200 rounded p-3">
                {wdf.comment}
              </pre>
            ) : (
              <p className="text-slate-500">No user comment recorded in TEXT block.</p>
            )}

            {showScript && (
              <div>
                <div className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 mb-1.5">
                  Embedded WXDM MeasurementScript (first 4,000 chars)
                </div>
                {measurementScript ? (
                  <pre className="max-h-60 overflow-auto font-mono text-[11px] text-slate-800 bg-slate-50 border border-slate-200 rounded p-3">
                    {measurementScript.slice(0, 4000)}
                    {measurementScript.length > 4000
                      ? `\n\n... (${(measurementScript.length - 4000).toLocaleString()} additional characters)`
                      : ''}
                  </pre>
                ) : (
                  <p className="text-slate-500">No embedded MeasurementScript found in WXDM.</p>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
