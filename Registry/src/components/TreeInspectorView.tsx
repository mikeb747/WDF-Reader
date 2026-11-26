import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Search } from 'lucide-react';
import type {
  ParsedRegistry,
  RegistrySection,
  RegistryTreeNode,
  RegistryValue,
  WireVariantValue,
} from '../registry';
import { getSection } from '../registry';

interface TreeInspectorViewProps {
  readonly registry: ParsedRegistry;
  readonly selectedPath: string | null;
  readonly onSelectPath: (path: string) => void;
}

function formatParsedRegistryValue(val: RegistryValue): string {
  switch (val.kind) {
    case 'REG_SZ':
    case 'REG_EXPAND_SZ':
      return JSON.stringify(val.value);
    case 'REG_DWORD':
      return `${val.value} (signed: ${val.signedValue}, 0x${val.hex})`;
    case 'REG_QWORD':
      return `${val.value.toString()}n`;
    case 'REG_MULTI_SZ':
      return JSON.stringify(val.values);
    case 'REG_BINARY':
    case 'REG_NONE':
      return `[${val.bytes.length} bytes] ${val.bytes
        .slice(0, 12)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join(' ')}${val.bytes.length > 12 ? ' …' : ''}`;
    case 'DELETE':
      return '(delete value)';
    case 'UNKNOWN':
      return val.raw;
  }
}

function formatVariantSummary(variant: WireVariantValue): string {
  switch (variant.kind) {
    case 'string':
      return JSON.stringify(variant.value);
    case 'number':
      return `${variant.value} (${variant.numericFormat})`;
    case 'boolean':
      return `${String(variant.value)} (raw flag: 0x${variant.rawFlag.toString(16)})`;
    case 'date':
      return `${variant.isoString ?? 'invalid date'} (OLE serial: ${variant.oleDate})`;
    case 'com-object':
      return variant.clsid ?? '(no CLSID)';
    case 'com-array': {
      const bounds =
        variant.dimensionBounds.length > 0 ? ` [${variant.dimensionBounds.join(', ')}]` : '';
      return `SafeArray (${variant.elementCount ?? '?'} elements, ${variant.dimensions ?? '?'}D${bounds})`;
    }
    case 'empty':
      return 'null (empty)';
    case 'unknown':
      return variant.value === null ? 'null' : String(variant.value);
  }
}

interface TreeBranchProps {
  readonly node: RegistryTreeNode;
  readonly depth: number;
  readonly expanded: ReadonlySet<string>;
  readonly selectedNormalizedPath: string | null;
  readonly onToggle: (normalizedPath: string) => void;
  readonly onSelect: (path: string) => void;
}

function TreeBranch({
  node,
  depth,
  expanded,
  selectedNormalizedPath,
  onToggle,
  onSelect,
}: TreeBranchProps) {
  const hasChildren = node.children.length > 0;
  const isExpanded = expanded.has(node.normalizedPath);
  const isSelected = selectedNormalizedPath === node.normalizedPath;

  return (
    <li>
      <div
        className={`flex items-center gap-1 py-1 pr-2 rounded-sm text-xs transition-colors ${
          isSelected
            ? 'bg-blue-50 text-blue-900 font-medium'
            : 'text-slate-700 hover:bg-slate-100/80'
        }`}
        style={{ paddingLeft: `${depth * 14 + 6}px` }}
      >
        {hasChildren ? (
          <button
            type="button"
            aria-label={isExpanded ? `Collapse ${node.name}` : `Expand ${node.name}`}
            aria-expanded={isExpanded}
            onClick={() => onToggle(node.normalizedPath)}
            className="p-0.5 text-slate-400 hover:text-slate-700 shrink-0"
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        ) : (
          <span className="w-4.5 shrink-0" aria-hidden="true" />
        )}

        <button
          type="button"
          onClick={() => {
            onSelect(node.path);
            if (hasChildren && !isExpanded) {
              onToggle(node.normalizedPath);
            }
          }}
          className="flex-1 min-w-0 text-left truncate font-mono"
        >
          {node.name}
        </button>

        {node.section?.variant && (
          <span className="font-mono text-[11px] text-slate-400 shrink-0 ml-1">
            {node.section.variant.typeName}
          </span>
        )}
      </div>

      {hasChildren && isExpanded && (
        <ul className="space-y-0.5">
          {node.children.map((child) => (
            <TreeBranch
              key={child.normalizedPath}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              selectedNormalizedPath={selectedNormalizedPath}
              onToggle={onToggle}
              onSelect={onSelect}
            />
          ))}
        </ul>
      )}
    </li>
  );
}

export function TreeInspectorView({
  registry,
  selectedPath,
  onSelectPath,
}: TreeInspectorViewProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedNodes, setExpandedNodes] = useState<Set<string>>(() => {
    const initial = new Set<string>();
    const expandToDepth = (nodes: readonly RegistryTreeNode[], depth: number): void => {
      for (const n of nodes) {
        if (depth < 5) {
          initial.add(n.normalizedPath);
          expandToDepth(n.children, depth + 1);
        }
      }
    };
    expandToDepth(registry.tree, 0);
    return initial;
  });

  const normalizedQuery = searchQuery.trim().toLowerCase();

  const matchingSections = useMemo((): readonly RegistrySection[] => {
    if (!normalizedQuery) {
      return [];
    }
    const matches: RegistrySection[] = [];
    for (const section of registry.sections) {
      if (section.normalizedPath.includes(normalizedQuery)) {
        matches.push(section);
        continue;
      }
      const entryMatch = section.entries.some(
        (e) =>
          e.normalizedName.includes(normalizedQuery) ||
          e.rawText.toLowerCase().includes(normalizedQuery),
      );
      if (entryMatch) {
        matches.push(section);
      }
      if (matches.length >= 150) {
        break;
      }
    }
    return matches;
  }, [registry.sections, normalizedQuery]);

  const activeSection: RegistrySection | null = useMemo(() => {
    if (selectedPath) {
      const found = getSection(registry, selectedPath);
      if (found) {
        return found;
      }
    }
    return registry.sections[0] ?? null;
  }, [registry, selectedPath]);

  const selectedNormalizedPath = activeSection?.normalizedPath ?? null;

  const toggleNode = (normPath: string): void => {
    setExpandedNodes((prev) => {
      const next = new Set(prev);
      if (next.has(normPath)) {
        next.delete(normPath);
      } else {
        next.add(normPath);
      }
      return next;
    });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 min-h-[600px]">
      {/* Left: Search & Key Hierarchy */}
      <div className="lg:col-span-5 border border-slate-200 rounded-md flex flex-col max-h-[720px]">
        <div className="p-3 border-b border-slate-200 bg-slate-50/70">
          <label htmlFor="registry-tree-search" className="sr-only">
            Search registry paths or values
          </label>
          <div className="relative">
            <Search
              className="w-4 h-4 text-slate-400 absolute left-2.5 top-1/2 -translate-y-1/2 pointer-events-none"
              aria-hidden="true"
            />
            <input
              id="registry-tree-search"
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search key path or value (e.g. Operating Temperature)"
              className="w-full h-9 pl-8 pr-3 rounded-md border border-slate-300 bg-white text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
            />
          </div>
          <p className="mt-2 text-xs text-slate-500 font-mono tabular-nums">
            {normalizedQuery
              ? `${matchingSections.length}${matchingSections.length === 150 ? '+' : ''} matching ${matchingSections.length === 1 ? 'section' : 'sections'}`
              : `${registry.stats.sectionCount.toLocaleString()} sections indexed`}
          </p>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {normalizedQuery ? (
            matchingSections.length === 0 ? (
              <p className="px-3 py-6 text-xs text-slate-500 text-center">
                No sections match &ldquo;{searchQuery}&rdquo;.
              </p>
            ) : (
              <ul className="space-y-1">
                {matchingSections.map((sec) => {
                  const isSel = sec.normalizedPath === selectedNormalizedPath;
                  return (
                    <li key={sec.normalizedPath}>
                      <button
                        type="button"
                        onClick={() => onSelectPath(sec.path)}
                        className={`w-full text-left px-2.5 py-2 rounded-sm transition-colors ${
                          isSel
                            ? 'bg-blue-50 text-blue-900'
                            : 'hover:bg-slate-100/80 text-slate-800'
                        }`}
                      >
                        <div className="font-mono text-xs font-medium truncate">{sec.name}</div>
                        <div className="font-mono text-[11px] text-slate-500 truncate mt-0.5">
                          {sec.path}
                        </div>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )
          ) : registry.tree.length === 0 ? (
            <p className="px-3 py-6 text-xs text-slate-500 text-center">
              No registry sections parsed.
            </p>
          ) : (
            <ul className="space-y-0.5">
              {registry.tree.map((root) => (
                <TreeBranch
                  key={root.normalizedPath}
                  node={root}
                  depth={0}
                  expanded={expandedNodes}
                  selectedNormalizedPath={selectedNormalizedPath}
                  onToggle={toggleNode}
                  onSelect={onSelectPath}
                />
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Right: Selected Section Raw vs Typed Inspector */}
      <div className="lg:col-span-7 border border-slate-200 rounded-md flex flex-col max-h-[720px] overflow-hidden">
        {!activeSection ? (
          <div className="p-8 text-center text-sm text-slate-500">
            Select a registry section from the tree to inspect its raw and parsed typed values.
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto p-5 space-y-6">
            <div className="border-b border-slate-200 pb-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 className="text-base font-semibold text-slate-900 break-all">
                  {activeSection.name}
                </h2>
                <span className="font-mono text-xs text-slate-500 tabular-nums shrink-0">
                  Line {activeSection.line}
                  {activeSection.isDeletion ? ' · Key Deletion [-]' : ''}
                </span>
              </div>
              <p className="mt-1 font-mono text-xs text-slate-600 break-all">
                {activeSection.path}
              </p>
            </div>

            {/* Decoded COM Variant Band (hairline-separated, no nested card border) */}
            {activeSection.variant && (
              <section
                aria-labelledby="variant-heading"
                className="border-b border-slate-200 pb-5"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2.5">
                  <h3 id="variant-heading" className="text-xs font-semibold text-slate-700">
                    Decoded Renishaw WiRE COM Variant
                  </h3>
                  <span className="font-mono text-xs text-blue-700">
                    {activeSection.variant.typeName} (0x
                    {activeSection.variant.typeCode.toString(16).padStart(2, '0')})
                  </span>
                </div>
                <dl className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
                  <div>
                    <dt className="text-slate-500">Semantic Kind</dt>
                    <dd className="mt-0.5 font-mono font-medium text-slate-900">
                      {activeSection.variant.kind}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-slate-500">Typed Value</dt>
                    <dd className="mt-0.5 font-mono font-semibold text-slate-900 break-words">
                      {formatVariantSummary(activeSection.variant)}
                    </dd>
                  </div>
                </dl>
              </section>
            )}

            {/* Raw vs Parsed Entries Table */}
            <section aria-labelledby="entries-heading">
              <h3 id="entries-heading" className="text-sm font-semibold text-slate-900 mb-3">
                Registry Entries ({activeSection.entries.length})
              </h3>
              {activeSection.entries.length === 0 ? (
                <p className="text-xs text-slate-500">
                  Container key with no direct value entries.
                </p>
              ) : (
                <div className="overflow-x-auto border border-slate-200 rounded-md">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                        <th className="py-2 px-3">Line</th>
                        <th className="py-2 px-3">Name</th>
                        <th className="py-2 px-3">REG Type</th>
                        <th className="py-2 px-3">Raw Value</th>
                        <th className="py-2 px-3">Parsed Value</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 text-xs">
                      {activeSection.entries.map((entry, idx) => (
                        <tr key={`${entry.normalizedName}-${entry.line}-${idx}`}>
                          <td className="py-2 px-3 font-mono tabular-nums text-slate-500">
                            {entry.line === entry.endLine
                              ? entry.line
                              : `${entry.line}-${entry.endLine}`}
                          </td>
                          <td className="py-2 px-3 font-mono font-medium text-slate-900">
                            {entry.isDefault ? '@ (Default)' : entry.name}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600 whitespace-nowrap">
                            {entry.value.kind}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-600 break-words max-w-[200px]">
                            {entry.value.raw}
                          </td>
                          <td className="py-2 px-3 font-mono text-slate-900 break-words max-w-[260px]">
                            {formatParsedRegistryValue(entry.value)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
