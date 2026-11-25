import { useEffect, useMemo, useState } from 'react';
import { AlertCircle, Calculator, Check, X } from 'lucide-react';
import { stripWdfExtension } from '../lib/format';
import {
  computeSpectrumArithmetic,
  type ArithmeticOperator,
  type WdfFile,
} from '../lib/wdf';
import type { LoadedSample } from './Sidebar';

interface DataArithmeticModalProps {
  samples: LoadedSample[];
  activeSampleId: string;
  onClose: () => void;
  onCreateSample: (result: { fileName: string; wdf: WdfFile; formulaLabel: string }) => void;
}

const OPERATORS: Array<{ value: ArithmeticOperator; label: string }> = [
  { value: '+', label: '+' },
  { value: '-', label: '−' },
  { value: '*', label: '×' },
  { value: '/', label: '÷' },
];

function buildGuidedFormula(
  mode: 'single' | 'dual',
  singleOp: ArithmeticOperator,
  singleConst: string,
  leftOp: ArithmeticOperator,
  leftConst: string,
  combineOp: ArithmeticOperator,
  rightConst: string,
  rightOp: ArithmeticOperator,
  groupTerms: boolean,
): string {
  const cleanNum = (s: string, fallback: string) => {
    const t = s.trim();
    return t.length > 0 ? t : fallback;
  };

  if (mode === 'single') {
    return `D1 ${singleOp} ${cleanNum(singleConst, '1')}`;
  }

  const a = cleanNum(leftConst, '1');
  const b = cleanNum(rightConst, '1');
  if (groupTerms) {
    return `(D1 ${leftOp} ${a}) ${combineOp} (${b} ${rightOp} D2)`;
  }
  return `D1 ${leftOp} ${a} ${combineOp} ${b} ${rightOp} D2`;
}

function buildDefaultResultName(
  formula: string,
  d1Sample: LoadedSample | null,
  d2Sample: LoadedSample | null,
  mode: 'single' | 'dual',
): string {
  const n1 = d1Sample ? stripWdfExtension(d1Sample.fileName) : 'D1';
  const compactFormula = formula.trim().replace(/\s+/g, ' ');
  if (mode === 'single') {
    const shortExpr = compactFormula.replace(/^D1\s*/i, '');
    return shortExpr ? `${n1} ${shortExpr}` : `${n1} (calc)`;
  }
  const n2 = d2Sample ? stripWdfExtension(d2Sample.fileName) : 'D2';
  const short1 = n1.length > 22 ? `${n1.slice(0, 20)}…` : n1;
  const short2 = n2.length > 22 ? `${n2.slice(0, 20)}…` : n2;
  return `${compactFormula} [${short1}, ${short2}]`;
}

export function DataArithmeticModal({
  samples,
  activeSampleId,
  onClose,
  onCreateSample,
}: DataArithmeticModalProps) {
  const initialD1 = samples.find((s) => s.id === activeSampleId)?.id ?? samples[0]?.id ?? '';
  const initialD2 =
    samples.find((s) => s.visible && s.id !== initialD1)?.id ??
    samples.find((s) => s.id !== initialD1)?.id ??
    initialD1;

  const [mode, setMode] = useState<'single' | 'dual'>(
    samples.filter((s) => s.visible).length >= 2 ? 'dual' : 'single',
  );
  const [d1Id, setD1Id] = useState<string>(initialD1);
  const [d2Id, setD2Id] = useState<string>(initialD2);

  // Single-dataset guided controls: D1 [op] [const]
  const [singleOp, setSingleOp] = useState<ArithmeticOperator>('/');
  const [singleConst, setSingleConst] = useState<string>('150');

  // Dual-dataset guided controls: (D1 [leftOp] [leftConst]) [combineOp] ([rightConst] [rightOp] D2)
  const [leftOp, setLeftOp] = useState<ArithmeticOperator>('*');
  const [leftConst, setLeftConst] = useState<string>('100');
  const [combineOp, setCombineOp] = useState<ArithmeticOperator>('/');
  const [rightConst, setRightConst] = useState<string>('1');
  const [rightOp, setRightOp] = useState<ArithmeticOperator>('*');
  const [groupTerms, setGroupTerms] = useState<boolean>(true);

  const [customFormula, setCustomFormula] = useState<string>(() =>
    buildGuidedFormula(
      samples.filter((s) => s.visible).length >= 2 ? 'dual' : 'single',
      '/',
      '150',
      '*',
      '100',
      '/',
      '1',
      '*',
      true,
    ),
  );
  const [isCustomEdited, setIsCustomEdited] = useState<boolean>(false);
  const [outputName, setOutputName] = useState<string>('');
  const [isNameEdited, setIsNameEdited] = useState<boolean>(false);
  const [alignByIndex, setAlignByIndex] = useState<boolean>(false);

  const d1Sample = useMemo(
    () => samples.find((s) => s.id === d1Id) ?? samples[0] ?? null,
    [samples, d1Id],
  );
  const d2Sample = useMemo(
    () => samples.find((s) => s.id === d2Id) ?? samples[1] ?? samples[0] ?? null,
    [samples, d2Id],
  );

  // Sync guided formula whenever structured inputs change (unless the user manually edited the formula box)
  const guidedFormula = useMemo(
    () =>
      buildGuidedFormula(
        mode,
        singleOp,
        singleConst,
        leftOp,
        leftConst,
        combineOp,
        rightConst,
        rightOp,
        groupTerms,
      ),
    [mode, singleOp, singleConst, leftOp, leftConst, combineOp, rightConst, rightOp, groupTerms],
  );

  useEffect(() => {
    if (!isCustomEdited) {
      setCustomFormula(guidedFormula);
    }
  }, [guidedFormula, isCustomEdited]);

  const activeFormula = isCustomEdited ? customFormula : guidedFormula;

  const autoOutputName = useMemo(
    () => buildDefaultResultName(activeFormula, d1Sample, d2Sample, mode),
    [activeFormula, d1Sample, d2Sample, mode],
  );

  const resolvedOutputName = isNameEdited && outputName.trim().length > 0 ? outputName : autoOutputName;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  const preview = useMemo(() => {
    if (!d1Sample) {
      return { ok: false as const, error: 'Load at least one spectrum to run Data Arithmetic.' };
    }
    try {
      const result = computeSpectrumArithmetic({
        expression: activeFormula,
        primary: { wdf: d1Sample.wdf, fileName: stripWdfExtension(d1Sample.fileName) },
        secondary:
          mode === 'dual' && d2Sample
            ? { wdf: d2Sample.wdf, fileName: stripWdfExtension(d2Sample.fileName) }
            : null,
        outputName: resolvedOutputName,
        alignByIndex,
      });
      return { ok: true as const, result };
    } catch (err) {
      return {
        ok: false as const,
        error: err instanceof Error ? err.message : 'Unable to evaluate formula.',
      };
    }
  }, [d1Sample, d2Sample, mode, activeFormula, resolvedOutputName, alignByIndex]);

  const applyPreset = (presetMode: 'single' | 'dual', expr: string) => {
    setMode(presetMode);
    setCustomFormula(expr);
    setIsCustomEdited(true);
    setIsNameEdited(false);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!preview.ok) return;
    onCreateSample({
      fileName: resolvedOutputName.trim(),
      wdf: preview.result.wdf,
      formulaLabel: activeFormula.trim(),
    });
    onClose();
  };

  const formatSampleOption = (sample: LoadedSample) => {
    const clean = stripWdfExtension(sample.fileName);
    return sample.folderName ? `${sample.folderName} / ${clean}` : clean;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/45 p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="data-arithmetic-title"
        className="w-full max-w-xl bg-white border border-slate-200 rounded shadow-lg overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-5 py-3.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <Calculator className="w-4 h-4 text-blue-600 shrink-0" aria-hidden="true" />
            <h2 id="data-arithmetic-title" className="text-sm font-semibold text-slate-900">
              Data Arithmetic
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Data Arithmetic"
            className="p-1 rounded text-slate-400 hover:text-slate-700 hover:bg-slate-200/60 cursor-pointer transition-colors"
          >
            <X className="w-4 h-4" aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-5 space-y-4">
          {/* Dataset Count Segmented Switch */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div
              role="group"
              aria-label="Number of datasets"
              className="inline-flex rounded border border-slate-200 bg-slate-100/80 p-0.5"
            >
              <button
                type="button"
                aria-pressed={mode === 'single'}
                onClick={() => {
                  setMode('single');
                  setIsCustomEdited(false);
                }}
                className={`px-3 py-1 text-xs font-medium rounded-sm whitespace-nowrap transition-colors cursor-pointer ${
                  mode === 'single'
                    ? 'bg-white text-blue-600 border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                1 Dataset (D1)
              </button>
              <button
                type="button"
                aria-pressed={mode === 'dual'}
                onClick={() => {
                  setMode('dual');
                  setIsCustomEdited(false);
                }}
                className={`px-3 py-1 text-xs font-medium rounded-sm whitespace-nowrap transition-colors cursor-pointer ${
                  mode === 'dual'
                    ? 'bg-white text-blue-600 border border-slate-200'
                    : 'text-slate-600 hover:text-slate-900 border border-transparent'
                }`}
              >
                2 Datasets (D1 &amp; D2)
              </button>
            </div>

            <div className="flex items-center gap-2 text-[11px] text-slate-500">
              <span>Examples:</span>
              <button
                type="button"
                onClick={() => applyPreset('single', 'D1 / 150')}
                className="font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                D1 / 150
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => applyPreset('dual', '(D1 * 100) / (1 * D2)')}
                className="font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                (D1 * 100) / (1 * D2)
              </button>
              <span aria-hidden="true">·</span>
              <button
                type="button"
                onClick={() => applyPreset('dual', 'D1 - D2')}
                className="font-mono text-blue-600 hover:text-blue-800 hover:underline cursor-pointer"
              >
                D1 - D2
              </button>
            </div>
          </div>

          {/* Dataset Selectors */}
          <div className={`grid gap-3 ${mode === 'dual' ? 'grid-cols-1 sm:grid-cols-2' : 'grid-cols-1'}`}>
            <div>
              <label htmlFor="arith-d1" className="block text-xs font-medium text-slate-700 mb-1">
                Dataset 1 (<span className="font-mono text-blue-600">D1</span>)
              </label>
              <select
                id="arith-d1"
                value={d1Sample?.id ?? ''}
                onChange={(e) => setD1Id(e.target.value)}
                className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-600"
              >
                {samples.map((s) => (
                  <option key={s.id} value={s.id}>
                    {formatSampleOption(s)}
                  </option>
                ))}
              </select>
            </div>

            {mode === 'dual' && (
              <div>
                <label htmlFor="arith-d2" className="block text-xs font-medium text-slate-700 mb-1">
                  Dataset 2 (<span className="font-mono text-blue-600">D2</span>)
                </label>
                <select
                  id="arith-d2"
                  value={d2Sample?.id ?? ''}
                  onChange={(e) => setD2Id(e.target.value)}
                  className="w-full px-2.5 py-1.5 rounded border border-slate-300 bg-white text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-600"
                >
                  {samples.map((s) => (
                    <option key={s.id} value={s.id}>
                      {formatSampleOption(s)}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>

          {/* Guided Operation Builder */}
          <div className="p-3.5 bg-slate-50 border border-slate-200 rounded space-y-2.5">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Operation Builder
              </span>
              {mode === 'dual' && (
                <label className="inline-flex items-center gap-1.5 text-[11px] text-slate-600 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    checked={groupTerms}
                    onChange={(e) => {
                      setGroupTerms(e.target.checked);
                      setIsCustomEdited(false);
                    }}
                    className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                  />
                  <span>Group terms: (D1 op a) OP (b op D2)</span>
                </label>
              )}
            </div>

            {mode === 'single' ? (
              <div className="flex flex-wrap items-center gap-2 font-mono text-xs">
                <span className="px-2.5 py-1.5 rounded bg-white border border-slate-200 font-semibold text-blue-700">
                  D1
                </span>
                <select
                  aria-label="Operator"
                  value={singleOp}
                  onChange={(e) => {
                    setSingleOp(e.target.value as ArithmeticOperator);
                    setIsCustomEdited(false);
                  }}
                  className="px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-semibold focus:outline-none focus:border-blue-600 cursor-pointer"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="any"
                  aria-label="Constant value"
                  value={singleConst}
                  onChange={(e) => {
                    setSingleConst(e.target.value);
                    setIsCustomEdited(false);
                  }}
                  className="w-28 px-2.5 py-1.5 rounded border border-slate-300 bg-white text-slate-900 tabular-nums focus:outline-none focus:border-blue-600"
                  placeholder="150"
                />
              </div>
            ) : (
              <div className="flex flex-wrap items-center gap-1.5 font-mono text-xs">
                {groupTerms && <span className="text-slate-400 font-semibold">(</span>}
                <span className="px-2 py-1.5 rounded bg-white border border-slate-200 font-semibold text-blue-700">
                  D1
                </span>
                <select
                  aria-label="Left term operator"
                  value={leftOp}
                  onChange={(e) => {
                    setLeftOp(e.target.value as ArithmeticOperator);
                    setIsCustomEdited(false);
                  }}
                  className="px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-semibold focus:outline-none focus:border-blue-600 cursor-pointer"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  step="any"
                  aria-label="Left constant"
                  value={leftConst}
                  onChange={(e) => {
                    setLeftConst(e.target.value);
                    setIsCustomEdited(false);
                  }}
                  className="w-20 px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-900 tabular-nums focus:outline-none focus:border-blue-600"
                />
                {groupTerms && <span className="text-slate-400 font-semibold">)</span>}

                <select
                  aria-label="Combine operator"
                  value={combineOp}
                  onChange={(e) => {
                    setCombineOp(e.target.value as ArithmeticOperator);
                    setIsCustomEdited(false);
                  }}
                  className="mx-1 px-2.5 py-1.5 rounded border border-blue-300 bg-blue-50 text-blue-800 font-semibold focus:outline-none focus:border-blue-600 cursor-pointer"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>

                {groupTerms && <span className="text-slate-400 font-semibold">(</span>}
                <input
                  type="number"
                  step="any"
                  aria-label="Right constant"
                  value={rightConst}
                  onChange={(e) => {
                    setRightConst(e.target.value);
                    setIsCustomEdited(false);
                  }}
                  className="w-20 px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-900 tabular-nums focus:outline-none focus:border-blue-600"
                />
                <select
                  aria-label="Right term operator"
                  value={rightOp}
                  onChange={(e) => {
                    setRightOp(e.target.value as ArithmeticOperator);
                    setIsCustomEdited(false);
                  }}
                  className="px-2 py-1.5 rounded border border-slate-300 bg-white text-slate-900 font-semibold focus:outline-none focus:border-blue-600 cursor-pointer"
                >
                  {OPERATORS.map((op) => (
                    <option key={op.value} value={op.value}>
                      {op.label}
                    </option>
                  ))}
                </select>
                <span className="px-2 py-1.5 rounded bg-white border border-slate-200 font-semibold text-blue-700">
                  D2
                </span>
                {groupTerms && <span className="text-slate-400 font-semibold">)</span>}
              </div>
            )}
          </div>

          {/* Direct Formula Expression Input */}
          <div>
            <div className="flex items-center justify-between mb-1">
              <label htmlFor="arith-formula" className="text-xs font-medium text-slate-700">
                Formula Expression
              </label>
              <span className="text-[11px] text-slate-500">
                Supports <span className="font-mono">D1</span>, <span className="font-mono">D2</span>,{' '}
                <span className="font-mono">&quot;data 1&quot;</span>, <span className="font-mono">&quot;data 2&quot;</span>,{' '}
                <span className="font-mono">+ - * / ( )</span>
              </span>
            </div>
            <input
              id="arith-formula"
              type="text"
              value={activeFormula}
              onChange={(e) => {
                setCustomFormula(e.target.value);
                setIsCustomEdited(true);
              }}
              className="w-full px-3 py-2 rounded border border-slate-300 bg-white text-xs font-mono text-slate-900 focus:outline-none focus:border-blue-600"
              placeholder='e.g. D1 / 150 or (D1 * 100) / (1 * D2)'
            />
          </div>

          {/* Output Name + Alignment Option */}
          <div className="space-y-2">
            <div>
              <label htmlFor="arith-name" className="block text-xs font-medium text-slate-700 mb-1">
                Result Name
              </label>
              <input
                id="arith-name"
                type="text"
                value={isNameEdited ? outputName : autoOutputName}
                onChange={(e) => {
                  setOutputName(e.target.value);
                  setIsNameEdited(true);
                }}
                className="w-full px-3 py-1.5 rounded border border-slate-300 bg-white text-xs font-mono text-slate-800 focus:outline-none focus:border-blue-600"
              />
            </div>

            {mode === 'dual' && (
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer select-none">
                <input
                  type="checkbox"
                  checked={alignByIndex}
                  onChange={(e) => setAlignByIndex(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Align by pixel index instead of X-axis interpolation</span>
              </label>
            )}
          </div>

          {/* Live Preview / Validation Status */}
          {preview.ok ? (
            <div className="px-3.5 py-2.5 bg-slate-50 border border-slate-200 rounded text-xs font-mono tabular-nums text-slate-700 space-y-1">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 font-sans font-medium text-emerald-700">
                  <Check className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>Ready to compute</span>
                </span>
                <span className="text-slate-500">
                  {preview.result.pointCount.toLocaleString()} pts · {preview.result.minX.toFixed(1)} –{' '}
                  {preview.result.maxX.toFixed(1)} {preview.result.xUnitsSymbol}
                </span>
              </div>
              <div className="text-[11px] text-slate-500 flex flex-wrap items-center gap-x-3 gap-y-0.5">
                <span>
                  Y range: {preview.result.minY.toLocaleString(undefined, { maximumFractionDigits: 2 })} to{' '}
                  {preview.result.maxY.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                </span>
                {preview.result.interpolated && (
                  <span>· D2 linearly interpolated over common X range</span>
                )}
                {preview.result.guardedDivisions > 0 && (
                  <span className="text-amber-700">
                    · {preview.result.guardedDivisions} zero-divisor pt(s) clamped to 0
                  </span>
                )}
              </div>
            </div>
          ) : (
            <div
              role="alert"
              className="px-3.5 py-2.5 bg-red-50 border border-red-200 rounded text-xs text-red-700 flex items-start gap-2"
            >
              <AlertCircle className="w-4 h-4 text-red-600 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{preview.error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="pt-2 border-t border-slate-200 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-1.5 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!preview.ok}
              className="inline-flex items-center gap-1.5 px-4 py-1.5 rounded bg-blue-600 hover:bg-blue-700 disabled:opacity-45 disabled:cursor-not-allowed text-white text-xs font-medium cursor-pointer transition-colors"
            >
              <Calculator className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Create Spectrum</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
