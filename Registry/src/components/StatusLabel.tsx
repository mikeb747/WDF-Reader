import type { DiagnosticSeverity, RuleStatus } from '../registry';

interface RuleStatusLabelProps {
  readonly status: RuleStatus;
}

const RULE_STATUS_META: Record<RuleStatus, { glyph: string; text: string; className: string }> = {
  pass: { glyph: '●', text: 'Pass', className: 'text-emerald-700' },
  warn: { glyph: '▲', text: 'Warn', className: 'text-amber-700' },
  fail: { glyph: '✕', text: 'Fail', className: 'text-red-700' },
  skipped: { glyph: '○', text: 'Skipped', className: 'text-slate-500' },
};

export function RuleStatusLabel({ status }: RuleStatusLabelProps) {
  const meta = RULE_STATUS_META[status];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-medium whitespace-nowrap ${meta.className}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.text}</span>
    </span>
  );
}

interface DiagnosticSeverityLabelProps {
  readonly severity: DiagnosticSeverity;
}

const DIAG_META: Record<DiagnosticSeverity, { glyph: string; text: string; className: string }> = {
  error: { glyph: '✕', text: 'Error', className: 'text-red-700' },
  warning: { glyph: '▲', text: 'Warning', className: 'text-amber-700' },
  info: { glyph: '○', text: 'Info', className: 'text-slate-600' },
};

export function DiagnosticSeverityLabel({ severity }: DiagnosticSeverityLabelProps) {
  const meta = DIAG_META[severity];
  return (
    <span className={`inline-flex items-center gap-1.5 font-mono text-xs font-medium whitespace-nowrap ${meta.className}`}>
      <span aria-hidden="true">{meta.glyph}</span>
      <span>{meta.text}</span>
    </span>
  );
}
