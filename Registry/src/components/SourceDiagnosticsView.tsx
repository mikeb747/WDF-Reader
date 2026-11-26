import { useMemo, useState } from 'react';
import type { DiagnosticSeverity, ParsedRegistry } from '../registry';
import { DiagnosticSeverityLabel } from './StatusLabel';

interface SourceDiagnosticsViewProps {
  readonly sourceText: string;
  readonly onSourceTextChange: (text: string) => void;
  readonly registry: ParsedRegistry;
  readonly isLargeFile: boolean;
}

type SeverityFilter = 'all' | DiagnosticSeverity;

export function SourceDiagnosticsView({
  sourceText,
  onSourceTextChange,
  registry,
  isLargeFile,
}: SourceDiagnosticsViewProps) {
  const [severityFilter, setSeverityFilter] = useState<SeverityFilter>('all');

  const filteredDiagnostics = useMemo(() => {
    if (severityFilter === 'all') {
      return registry.diagnostics;
    }
    return registry.diagnostics.filter((d) => d.severity === severityFilter);
  }, [registry.diagnostics, severityFilter]);

  return (
    <div className="space-y-6">
      {/* Diagnostics Section */}
      <section aria-labelledby="diagnostics-heading">
        <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
          <div>
            <h2 id="diagnostics-heading" className="text-base font-semibold text-slate-900">
              Parser Diagnostics ({registry.diagnostics.length})
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Syntax errors, malformed values, missing headers, and duplicate declarations detected during parsing
            </p>
          </div>

          <div
            role="group"
            aria-label="Filter diagnostics by severity"
            className="inline-flex items-center gap-1 p-1 bg-slate-100 rounded-md"
          >
            {(['all', 'error', 'warning', 'info'] as const).map((level) => (
              <button
                key={level}
                type="button"
                onClick={() => setSeverityFilter(level)}
                className={`px-2.5 py-1 text-xs font-medium rounded-sm transition-colors whitespace-nowrap shrink-0 ${
                  severityFilter === level
                    ? 'bg-white text-slate-900 shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                {level === 'all'
                  ? `All (${registry.diagnostics.length})`
                  : level === 'error'
                    ? `Errors (${registry.stats.errorCount})`
                    : level === 'warning'
                      ? `Warnings (${registry.stats.warningCount})`
                      : 'Info'}
              </button>
            ))}
          </div>
        </div>

        {filteredDiagnostics.length === 0 ? (
          <div className="border border-slate-200 rounded-md px-5 py-6 text-sm text-slate-600">
            No diagnostics in this view. Try switching to the &ldquo;Malformed &amp; Edge Cases&rdquo; fixture or editing the raw source below to test parser recovery.
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-3">Line</th>
                  <th className="py-2.5 px-3">Severity</th>
                  <th className="py-2.5 px-3">Code</th>
                  <th className="py-2.5 px-3">Message</th>
                  <th className="py-2.5 px-3">Raw Snippet</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {filteredDiagnostics.map((diag, idx) => (
                  <tr key={`${diag.code}-${diag.line}-${idx}`} className="hover:bg-slate-50/70">
                    <td className="py-2.5 px-3 font-mono tabular-nums text-slate-600 whitespace-nowrap">
                      {diag.endLine && diag.endLine !== diag.line
                        ? `${diag.line}-${diag.endLine}`
                        : diag.line}
                    </td>
                    <td className="py-2.5 px-3">
                      <DiagnosticSeverityLabel severity={diag.severity} />
                    </td>
                    <td className="py-2.5 px-3 font-mono font-medium text-slate-800 whitespace-nowrap">
                      {diag.code}
                    </td>
                    <td className="py-2.5 px-3 text-slate-700">{diag.message}</td>
                    <td className="py-2.5 px-3 font-mono text-slate-500 max-w-[260px] truncate">
                      {diag.rawLine ?? '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Live Editable Raw Registry Source */}
      <section aria-labelledby="raw-source-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-2">
          <label htmlFor="registry-source-editor" id="raw-source-heading" className="text-base font-semibold text-slate-900">
            Live Registry Source Buffer
          </label>
          <span className="font-mono text-xs text-slate-500 tabular-nums">
            {registry.stats.totalLines.toLocaleString()} lines · Encoding: {registry.encoding} · Format: {registry.formatVersion}
          </span>
        </div>

        {isLargeFile && (
          <p className="mb-2 text-xs text-amber-800 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
            Displaying a large decoded registry file ({registry.stats.totalLines.toLocaleString()} lines). Edits re-parse immediately using the pure TypeScript parser.
          </p>
        )}

        <textarea
          id="registry-source-editor"
          value={sourceText}
          onChange={(e) => onSourceTextChange(e.target.value)}
          spellCheck={false}
          rows={18}
          className="w-full rounded-md border border-slate-300 bg-slate-50/40 p-3.5 font-mono text-xs leading-relaxed text-slate-900 focus:border-blue-600 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-600/20"
        />
      </section>
    </div>
  );
}
