import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  convertXAxis,
  detectPeaks,
  getSpectrum,
  subtractBaseline,
  type SpectralTargetUnit,
  type WdfFile,
  type WdfPeak,
} from '../lib/wdf';
import type { LoadedSample } from './Sidebar';

export type BaselineStrength = 'gentle' | 'standard' | 'aggressive';

const BASELINE_LAMBDA: Record<BaselineStrength, number> = {
  gentle: 1e6,
  standard: 1e5,
  aggressive: 1e4,
};

const OVERLAY_PALETTE = ['#2563EB', '#0D9488', '#D97706', '#7C3AED', '#DC2626', '#0284C7'];

interface SpectrumViewProps {
  samples: LoadedSample[];
  activeSampleId: string;
  wdf: WdfFile;
  fileName: string;
  targetUnit: SpectralTargetUnit;
  onChangeTargetUnit: (unit: SpectralTargetUnit) => void;
  baselineEnabled: boolean;
  onToggleBaseline: () => void;
  baselineStrength: BaselineStrength;
  onChangeBaselineStrength: (strength: BaselineStrength) => void;
  overlayEnabled: boolean;
  onToggleOverlay: () => void;
  overlayIds: string[];
  onToggleOverlaySample: (id: string) => void;
}

const UNIT_OPTIONS: Array<{ id: SpectralTargetUnit; label: string }> = [
  { id: 'native', label: 'Native' },
  { id: 'ramanShift', label: 'Raman Shift' },
  { id: 'wavenumber', label: 'Abs. cm⁻¹' },
  { id: 'nanometre', label: 'Wavelength nm' },
  { id: 'electronVolt', label: 'Energy eV' },
];

const CHART_WIDTH = 960;
const CHART_HEIGHT = 400;
const MARGIN = { top: 24, right: 24, bottom: 48, left: 72 };
const PLOT_W = CHART_WIDTH - MARGIN.left - MARGIN.right;
const PLOT_H = CHART_HEIGHT - MARGIN.top - MARGIN.bottom;

function niceTicks(min: number, max: number, count: number): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max <= min) return [min];
  const rawStep = (max - min) / Math.max(count - 1, 1);
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const norm = rawStep / mag;
  const niceStep = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const start = Math.ceil(min / niceStep) * niceStep;
  const ticks: number[] = [];
  for (let v = start; v <= max + niceStep * 1e-6; v += niceStep) {
    ticks.push(Object.is(v, -0) ? 0 : Number(v.toPrecision(10)));
  }
  return ticks;
}

function formatTick(val: number, step: number): string {
  if (Math.abs(val) < 1e-9) return '0';
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
  if (decimals === 0) {
    return Math.round(val).toLocaleString();
  }
  return val.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

interface ComputedTrace {
  id: string;
  fileName: string;
  title: string;
  color: string;
  points: Array<{ x: number; y: number; rawY: number; baselineY: number; origIdx: number }>;
  label: string;
  symbol: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  meanY: number;
  peak: { x: number; y: number; origIdx: number } | null;
  peaks: WdfPeak[];
}

function buildTrace(
  sampleId: string,
  fileName: string,
  wdf: WdfFile,
  color: string,
  spectrumIndex: number,
  targetUnit: SpectralTargetUnit,
  sortAscending: boolean,
  baselineEnabled: boolean,
  baselineLambda: number,
  normalize: boolean,
): ComputedTrace | null {
  if (!wdf.xAxis) return null;
  const converted = convertXAxis(wdf.xAxis, wdf.header.laserWavenumber, targetUnit);
  const yRaw = getSpectrum(wdf, spectrumIndex);
  const n = Math.min(converted.values.length, yRaw.length);
  if (n === 0) return null;

  // Build ordered index array so AsLS runs sequentially along the plotted X direction
  const order: Array<{ x: number; rawY: number; origIdx: number }> = [];
  for (let i = 0; i < n; i++) {
    order.push({ x: converted.values[i], rawY: yRaw[i], origIdx: i });
  }
  if (sortAscending) {
    order.sort((a, b) => a.x - b.x);
  }

  const orderedRawY = new Float64Array(order.length);
  for (let i = 0; i < order.length; i++) orderedRawY[i] = order[i].rawY;

  let baselineArr: Float64Array;
  let workingY: Float64Array;
  if (baselineEnabled) {
    const res = subtractBaseline(orderedRawY, { lambda: baselineLambda, p: 0.005, iterations: 10 });
    baselineArr = res.baseline;
    workingY = res.corrected;
  } else {
    baselineArr = new Float64Array(order.length);
    workingY = orderedRawY;
  }

  // Optional 0-100% normalization for overlay comparison
  let scaleMin = 0;
  let scaleSpan = 1;
  if (normalize) {
    let minV = Infinity;
    let maxV = -Infinity;
    for (let i = 0; i < workingY.length; i++) {
      if (workingY[i] < minV) minV = workingY[i];
      if (workingY[i] > maxV) maxV = workingY[i];
    }
    scaleMin = baselineEnabled ? 0 : minV;
    scaleSpan = maxV - scaleMin;
    if (scaleSpan <= 0) scaleSpan = 1;
  }

  const points: ComputedTrace['points'] = [];
  const xs = new Float64Array(order.length);
  const ys = new Float64Array(order.length);
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let sumY = 0;
  let peakIdx = 0;

  for (let i = 0; i < order.length; i++) {
    const x = order[i].x;
    const rawVal = order[i].rawY;
    const baseVal = baselineArr[i];
    const y = normalize ? ((workingY[i] - scaleMin) / scaleSpan) * 100 : workingY[i];
    const dispRawY = normalize ? ((rawVal - scaleMin) / scaleSpan) * 100 : rawVal;
    const dispBaseY = normalize ? ((baseVal - scaleMin) / scaleSpan) * 100 : baseVal;

    points.push({ x, y, rawY: dispRawY, baselineY: dispBaseY, origIdx: order[i].origIdx });
    xs[i] = x;
    ys[i] = y;
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) {
      maxY = y;
      peakIdx = i;
    }
    sumY += y;
  }

  const peaks = detectPeaks(xs, ys, 5, 16);

  return {
    id: sampleId,
    fileName,
    title: wdf.header.title || fileName,
    color,
    points,
    label: converted.label,
    symbol: converted.symbol,
    minX,
    maxX,
    minY,
    maxY,
    meanY: points.length > 0 ? sumY / points.length : 0,
    peak: points[peakIdx] ? { x: points[peakIdx].x, y: points[peakIdx].y, origIdx: points[peakIdx].origIdx } : null,
    peaks,
  };
}

function findNearestPoint(
  points: ComputedTrace['points'],
  dataX: number,
): ComputedTrace['points'][number] | null {
  if (points.length === 0) return null;
  let best = points[0];
  let bestDist = Math.abs(points[0].x - dataX);
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].x - dataX);
    if (d < bestDist) {
      bestDist = d;
      best = points[i];
    }
  }
  return best;
}

export function SpectrumView({
  samples,
  activeSampleId,
  wdf,
  fileName,
  targetUnit,
  onChangeTargetUnit,
  baselineEnabled,
  onToggleBaseline,
  baselineStrength,
  onChangeBaselineStrength,
  overlayEnabled,
  onToggleOverlay,
  overlayIds,
  onToggleOverlaySample,
}: SpectrumViewProps) {
  const [spectrumIndex, setSpectrumIndex] = useState(0);
  const [showPeaks, setShowPeaks] = useState(true);
  const [sortAscending, setSortAscending] = useState(true);
  const [showFittedBaseline, setShowFittedBaseline] = useState(false);
  const [normalizeOverlay, setNormalizeOverlay] = useState(false);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [dragSelection, setDragSelection] = useState<{ startX: number; currentX: number } | null>(null);
  const [hoverDataX, setHoverDataX] = useState<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  useEffect(() => {
    setZoomRange(null);
    setHoverDataX(null);
    setSpectrumIndex(0);
  }, [wdf]);

  useEffect(() => {
    setZoomRange(null);
    setHoverDataX(null);
  }, [targetUnit, sortAscending, overlayEnabled, overlayIds, baselineEnabled, normalizeOverlay]);

  // White-light optical image URL (if embedded in WHTL block)
  const whiteLightUrl = useMemo(() => {
    if (!wdf.whiteLightImage) return null;
    const copy = new Uint8Array(wdf.whiteLightImage.bytes.byteLength);
    copy.set(wdf.whiteLightImage.bytes);
    const blob = new Blob([copy], { type: wdf.whiteLightImage.mimeType });
    return URL.createObjectURL(blob);
  }, [wdf.whiteLightImage]);

  useEffect(() => {
    return () => {
      if (whiteLightUrl) URL.revokeObjectURL(whiteLightUrl);
    };
  }, [whiteLightUrl]);

  const colorBySampleId = useMemo(() => {
    const map = new Map<string, string>();
    samples.forEach((s, idx) => {
      map.set(s.id, OVERLAY_PALETTE[idx % OVERLAY_PALETTE.length]);
    });
    return map;
  }, [samples]);

  const effectiveUnit: SpectralTargetUnit = useMemo(() => {
    if (!overlayEnabled || targetUnit !== 'native') return targetUnit;
    const selected = samples.filter((s) => overlayIds.includes(s.id));
    const distinctUnits = new Set(selected.map((s) => s.wdf.xAxis?.units));
    return distinctUnits.size > 1 ? 'ramanShift' : 'native';
  }, [overlayEnabled, targetUnit, samples, overlayIds]);

  const traces = useMemo<ComputedTrace[]>(() => {
    const lambda = BASELINE_LAMBDA[baselineStrength];
    if (overlayEnabled) {
      const selected = samples.filter((s) => overlayIds.includes(s.id));
      const toRender =
        selected.length > 0
          ? selected
          : samples.filter((s) => s.id === activeSampleId);

      const list: ComputedTrace[] = [];
      for (const sample of toRender) {
        const trace = buildTrace(
          sample.id,
          sample.fileName,
          sample.wdf,
          colorBySampleId.get(sample.id) ?? OVERLAY_PALETTE[0],
          sample.id === activeSampleId ? spectrumIndex : 0,
          effectiveUnit,
          sortAscending,
          baselineEnabled,
          lambda,
          normalizeOverlay,
        );
        if (trace) list.push(trace);
      }
      return list;
    }

    const single = buildTrace(
      activeSampleId,
      fileName,
      wdf,
      '#2563EB',
      spectrumIndex,
      targetUnit,
      sortAscending,
      baselineEnabled,
      lambda,
      false,
    );
    return single ? [single] : [];
  }, [
    overlayEnabled,
    samples,
    overlayIds,
    activeSampleId,
    fileName,
    wdf,
    colorBySampleId,
    spectrumIndex,
    effectiveUnit,
    targetUnit,
    sortAscending,
    baselineEnabled,
    baselineStrength,
    normalizeOverlay,
  ]);

  const primaryTrace = traces.find((t) => t.id === activeSampleId) ?? traces[0] ?? null;

  const viewDomain = useMemo(() => {
    if (traces.length === 0) {
      return { xMin: 0, xMax: 1, yMin: 0, yMax: 1 };
    }
    let globalMinX = Infinity;
    let globalMaxX = -Infinity;
    for (const tr of traces) {
      if (tr.minX < globalMinX) globalMinX = tr.minX;
      if (tr.maxX > globalMaxX) globalMaxX = tr.maxX;
    }
    const xMin = zoomRange ? Math.min(zoomRange[0], zoomRange[1]) : globalMinX;
    const xMax = zoomRange ? Math.max(zoomRange[0], zoomRange[1]) : globalMaxX;

    let yMin = Infinity;
    let yMax = -Infinity;
    let found = false;
    for (const tr of traces) {
      for (let i = 0; i < tr.points.length; i++) {
        const p = tr.points[i];
        if (p.x >= xMin && p.x <= xMax) {
          found = true;
          if (p.y < yMin) yMin = p.y;
          if (p.y > yMax) yMax = p.y;
          if (!overlayEnabled && baselineEnabled && showFittedBaseline) {
            if (p.rawY < yMin) yMin = p.rawY;
            if (p.rawY > yMax) yMax = p.rawY;
            if (p.baselineY < yMin) yMin = p.baselineY;
            if (p.baselineY > yMax) yMax = p.baselineY;
          }
        }
      }
    }
    if (!found) {
      yMin = traces[0].minY;
      yMax = traces[0].maxY;
    }
    const yPad = (yMax - yMin) * 0.08 || 1;
    return {
      xMin,
      xMax: xMax === xMin ? xMin + 1 : xMax,
      yMin: yMin - yPad * 0.35,
      yMax: yMax + yPad,
    };
  }, [traces, zoomRange, overlayEnabled, baselineEnabled, showFittedBaseline]);

  const mapX = (x: number) =>
    MARGIN.left + ((x - viewDomain.xMin) / (viewDomain.xMax - viewDomain.xMin)) * PLOT_W;
  const mapY = (y: number) =>
    MARGIN.top + (1 - (y - viewDomain.yMin) / (viewDomain.yMax - viewDomain.yMin)) * PLOT_H;
  const unmapX = (px: number) =>
    viewDomain.xMin + ((px - MARGIN.left) / PLOT_W) * (viewDomain.xMax - viewDomain.xMin);

  const tracePaths = useMemo(() => {
    const buildPath = (
      pts: ComputedTrace['points'],
      getY: (p: ComputedTrace['points'][number]) => number,
    ) => {
      const cmds: string[] = [];
      let started = false;
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i];
        if (p.x < viewDomain.xMin || p.x > viewDomain.xMax) continue;
        const sx = mapX(p.x).toFixed(2);
        const sy = mapY(getY(p)).toFixed(2);
        cmds.push(started ? `L${sx},${sy}` : `M${sx},${sy}`);
        started = true;
      }
      return cmds.join(' ');
    };

    return traces.map((tr) => {
      const mainD = buildPath(tr.points, (p) => p.y);
      const rawD = !overlayEnabled && baselineEnabled && showFittedBaseline ? buildPath(tr.points, (p) => p.rawY) : '';
      const baseD =
        !overlayEnabled && baselineEnabled && showFittedBaseline ? buildPath(tr.points, (p) => p.baselineY) : '';

      let areaD = '';
      if (!overlayEnabled && mainD) {
        const visible = tr.points.filter((p) => p.x >= viewDomain.xMin && p.x <= viewDomain.xMax);
        if (visible.length >= 2) {
          const firstX = mapX(visible[0].x).toFixed(2);
          const lastX = mapX(visible[visible.length - 1].x).toFixed(2);
          const baseY = (MARGIN.top + PLOT_H).toFixed(2);
          areaD = `${mainD} L${lastX},${baseY} L${firstX},${baseY} Z`;
        }
      }

      return { trace: tr, mainD, rawD, baseD, areaD };
    });
  }, [traces, viewDomain, overlayEnabled, baselineEnabled, showFittedBaseline]);

  const xTicks = useMemo(() => niceTicks(viewDomain.xMin, viewDomain.xMax, 7), [viewDomain.xMin, viewDomain.xMax]);
  const yTicks = useMemo(() => niceTicks(viewDomain.yMin, viewDomain.yMax, 6), [viewDomain.yMin, viewDomain.yMax]);
  const xStep = xTicks.length >= 2 ? Math.abs(xTicks[1] - xTicks[0]) : 1;
  const yStep = yTicks.length >= 2 ? Math.abs(yTicks[1] - yTicks[0]) : 1;

  const getSvgCoords = (clientX: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return ((clientX - rect.left) / rect.width) * CHART_WIDTH;
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (traces.length === 0) return;
    const svgX = getSvgCoords(e.clientX);
    if (svgX === null) return;

    const clampedX = Math.max(MARGIN.left, Math.min(MARGIN.left + PLOT_W, svgX));
    if (dragSelection) {
      setDragSelection((prev) => (prev ? { ...prev, currentX: clampedX } : null));
    }

    setHoverDataX(unmapX(clampedX));
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svgX = getSvgCoords(e.clientX);
    if (svgX === null) return;
    if (svgX < MARGIN.left || svgX > MARGIN.left + PLOT_W) return;
    setDragSelection({ startX: svgX, currentX: svgX });
  };

  const handlePointerUp = () => {
    if (dragSelection) {
      const dist = Math.abs(dragSelection.currentX - dragSelection.startX);
      if (dist >= 12) {
        const x1 = unmapX(Math.min(dragSelection.startX, dragSelection.currentX));
        const x2 = unmapX(Math.max(dragSelection.startX, dragSelection.currentX));
        if (x2 > x1) {
          setZoomRange([x1, x2]);
        }
      }
      setDragSelection(null);
    }
  };

  const hoveredMatches = useMemo(() => {
    if (hoverDataX === null) return [];
    return traces
      .map((tr) => {
        const pt = findNearestPoint(tr.points, hoverDataX);
        if (!pt) return null;
        return { trace: tr, point: pt };
      })
      .filter((m): m is { trace: ComputedTrace; point: ComputedTrace['points'][number] } => m !== null);
  }, [traces, hoverDataX]);

  const totalSpectra = Math.max(1, Math.floor(wdf.spectra.length / Math.max(1, wdf.header.pointsPerSpectrum)));

  const mapGrid = useMemo(() => {
    if (!wdf.mapArea || totalSpectra <= 1) return null;
    const cols = Math.max(1, wdf.mapArea.count.x);
    const rows = Math.max(1, wdf.mapArea.count.y);
    const cells: number[] = [];
    let minVal = Infinity;
    let maxVal = -Infinity;
    for (let i = 0; i < Math.min(totalSpectra, cols * rows); i++) {
      const spec = getSpectrum(wdf, i);
      let peak = 0;
      for (let j = 0; j < spec.length; j++) {
        if (spec[j] > peak) peak = spec[j];
      }
      cells.push(peak);
      if (peak < minVal) minVal = peak;
      if (peak > maxVal) maxVal = peak;
    }
    return { cols, rows, cells, minVal, maxVal };
  }, [wdf, totalSpectra]);

  if (!primaryTrace) {
    return (
      <div className="p-6 text-sm text-slate-600">
        No spectral X-axis (XLST) block found in this file.
      </div>
    );
  }

  const yAxisTitle =
    overlayEnabled && normalizeOverlay
      ? 'Normalized Intensity (%)'
      : baselineEnabled
        ? `Baseline-Corrected Intensity (${wdf.header.spectralUnitsName})`
        : `Intensity (${wdf.header.spectralUnitsName})`;

  const combinedPeaks = useMemo(() => {
    const rows: Array<{ trace: ComputedTrace; peak: WdfPeak }> = [];
    for (const tr of traces) {
      for (const pk of tr.peaks) {
        rows.push({ trace: tr, peak: pk });
      }
    }
    rows.sort((a, b) => b.peak.intensity - a.peak.intensity);
    return rows;
  }, [traces]);

  return (
    <div className="p-5 lg:p-6 space-y-5 max-w-[1400px]">
      {/* Header & Controls Bar */}
      <div className="space-y-3 border-b border-slate-200 pb-4">
        <div className="min-w-0">
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight truncate">
            {overlayEnabled
              ? `Overlay Comparison (${traces.length} ${traces.length === 1 ? 'spectrum' : 'spectra'})`
              : wdf.header.title || fileName}
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
            {overlayEnabled ? (
              <>
                Comparing {traces.map((t) => t.fileName).join(' · ')} · Axis: {primaryTrace.label}
                {baselineEnabled ? ` · AsLS Baseline (${baselineStrength})` : ''}
              </>
            ) : (
              <>
                {fileName} · {wdf.header.pointsPerSpectrum.toLocaleString()} points ·{' '}
                {wdf.summary.laserWavenumberCm1
                  ? `Laser ${wdf.summary.laserWavenumberCm1.toFixed(2)} cm⁻¹ (${wdf.summary.laserWavelengthNm?.toFixed(2)} nm)`
                  : 'Laser wavenumber not specified'}
                {baselineEnabled ? ` · AsLS Baseline (${baselineStrength})` : ''}
              </>
            )}
          </p>
        </div>

        {/* Unit Selector, Baseline Correction, Overlay Mode & Plot Toggles */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="X-axis spectral units"
              className="inline-flex flex-wrap rounded border border-slate-200 bg-slate-100/80 p-0.5"
            >
              {UNIT_OPTIONS.map((opt) => {
                const active = effectiveUnit === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangeTargetUnit(opt.id)}
                    aria-pressed={active}
                    className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-blue-600 border border-slate-200'
                        : 'text-slate-600 hover:text-slate-900 border border-transparent'
                    }`}
                  >
                    {opt.label}
                  </button>
                );
              })}
            </div>

            {/* Baseline Correction Toggle + Smoothness */}
            <button
              type="button"
              onClick={onToggleBaseline}
              aria-pressed={baselineEnabled}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                baselineEnabled
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Apply Asymmetric Least Squares (AsLS) baseline correction to remove fluorescence and background drift"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Baseline Correction</span>
            </button>

            {baselineEnabled && (
              <select
                aria-label="Baseline smoothness"
                value={baselineStrength}
                onChange={(e) => onChangeBaselineStrength(e.target.value as BaselineStrength)}
                className="px-2 py-1.5 rounded border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
              >
                <option value="gentle">Gentle (λ=10⁶)</option>
                <option value="standard">Standard (λ=10⁵)</option>
                <option value="aggressive">Aggressive (λ=10⁴)</option>
              </select>
            )}

            {/* Overlay Comparison Toggle */}
            <button
              type="button"
              onClick={onToggleOverlay}
              disabled={samples.length < 2}
              aria-pressed={overlayEnabled}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                overlayEnabled
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Overlay two or more loaded WDF spectra on the same chart"
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{overlayEnabled ? `Overlay (${traces.length})` : 'Overlay Mode'}</span>
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-4">
            {baselineEnabled && !overlayEnabled && (
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showFittedBaseline}
                  onChange={(e) => setShowFittedBaseline(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Show raw &amp; baseline</span>
              </label>
            )}

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={showPeaks}
                onChange={(e) => setShowPeaks(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Peak labels</span>
            </label>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer whitespace-nowrap">
              <input
                type="checkbox"
                checked={sortAscending}
                onChange={(e) => setSortAscending(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Sort X ascending</span>
            </label>

            {zoomRange && (
              <button
                type="button"
                onClick={() => setZoomRange(null)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>Reset Zoom</span>
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Spectrum Plot Card */}
      <div className="bg-white border border-slate-200 rounded">
        {/* Overlay Sample Selector Strip */}
        {overlayEnabled && (
          <div className="px-4 py-2.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Overlaid Spectra
              </span>
              {samples.map((sample) => {
                const checked = overlayIds.includes(sample.id);
                const swatch = colorBySampleId.get(sample.id) ?? OVERLAY_PALETTE[0];
                return (
                  <label
                    key={sample.id}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-800 cursor-pointer select-none"
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => onToggleOverlaySample(sample.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                    />
                    <span
                      className="w-2.5 h-2.5 rounded-xs shrink-0 inline-block"
                      style={{ backgroundColor: swatch }}
                      aria-hidden="true"
                    />
                    <span className="font-mono text-[11px] truncate max-w-[230px]" title={sample.fileName}>
                      {sample.fileName}
                    </span>
                  </label>
                );
              })}
            </div>

            <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 cursor-pointer select-none whitespace-nowrap">
              <input
                type="checkbox"
                checked={normalizeOverlay}
                onChange={(e) => setNormalizeOverlay(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Normalize (0–100%)</span>
            </label>
          </div>
        )}

        {/* Live Crosshair Readout Bar */}
        <div className="px-4 py-2 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="font-mono tabular-nums text-slate-700 flex flex-wrap items-center gap-x-5 gap-y-1">
            {hoveredMatches.length > 0 ? (
              overlayEnabled ? (
                <>
                  <span className="text-slate-500">
                    {primaryTrace.label}:{' '}
                    <strong className="font-semibold text-slate-900">
                      {hoverDataX?.toFixed(2)} {primaryTrace.symbol}
                    </strong>
                  </span>
                  {hoveredMatches.map(({ trace, point }) => (
                    <span key={trace.id} className="inline-flex items-center gap-1.5">
                      <span
                        className="w-2 h-2 rounded-xs shrink-0 inline-block"
                        style={{ backgroundColor: trace.color }}
                      />
                      <span className="text-slate-500 truncate max-w-[140px]">{trace.fileName}:</span>
                      <strong className="font-semibold text-slate-900">
                        {normalizeOverlay
                          ? `${point.y.toFixed(1)}%`
                          : point.y.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                      </strong>
                    </span>
                  ))}
                </>
              ) : (
                <>
                  <span>
                    <span className="text-slate-500 mr-1.5">{primaryTrace.label}:</span>
                    <strong className="font-semibold text-slate-900">
                      {hoveredMatches[0].point.x.toFixed(2)} {primaryTrace.symbol}
                    </strong>
                  </span>
                  <span>
                    <span className="text-slate-500 mr-1.5">
                      {baselineEnabled ? 'Corrected:' : 'Intensity:'}
                    </span>
                    <strong className="font-semibold text-slate-900">
                      {hoveredMatches[0].point.y.toLocaleString(undefined, { maximumFractionDigits: 2 })}{' '}
                      {wdf.header.spectralUnitsName.toLowerCase()}
                    </strong>
                  </span>
                  {baselineEnabled && (
                    <span className="text-slate-500">
                      Baseline:{' '}
                      <span className="text-amber-700 font-medium">
                        {hoveredMatches[0].point.baselineY.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </span>
                  )}
                  <span className="text-slate-500">Pixel #{hoveredMatches[0].point.origIdx}</span>
                </>
              )
            ) : (
              <span className="text-slate-500">
                Hover plot to inspect exact coordinates · Drag horizontally across plot to zoom X range
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono">
            {baselineEnabled && !overlayEnabled && showFittedBaseline && (
              <div className="flex items-center gap-3 text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-blue-600 inline-block" />
                  <span>Corrected</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-slate-400 inline-block" />
                  <span>Raw</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-0.5 border-t border-dashed border-amber-600 inline-block" />
                  <span>AsLS Baseline</span>
                </span>
              </div>
            )}
            {zoomRange && (
              <span className="tabular-nums text-blue-600">
                Zoom: {viewDomain.xMin.toFixed(1)} – {viewDomain.xMax.toFixed(1)} {primaryTrace.symbol}
              </span>
            )}
          </div>
        </div>

        {/* SVG Raman Plot */}
        <div className="p-2 sm:p-3">
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            className="w-full h-auto select-none cursor-crosshair block"
            role="img"
            aria-label={
              overlayEnabled
                ? `Overlaid Raman spectra plot comparing ${traces.length} files`
                : `Raman spectrum plot of ${wdf.header.title || fileName}`
            }
            onPointerMove={handlePointerMove}
            onPointerDown={handlePointerDown}
            onPointerUp={handlePointerUp}
            onPointerLeave={() => {
              setHoverDataX(null);
              setDragSelection(null);
            }}
          >
            <defs>
              <linearGradient id="spectrumFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#2563EB" stopOpacity="0.14" />
                <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
              </linearGradient>
              <clipPath id="plotClip">
                <rect x={MARGIN.left} y={MARGIN.top} width={PLOT_W} height={PLOT_H} />
              </clipPath>
            </defs>

            {/* Plot Background */}
            <rect
              x={MARGIN.left}
              y={MARGIN.top}
              width={PLOT_W}
              height={PLOT_H}
              fill="#FFFFFF"
              stroke="#E2E8F0"
              strokeWidth="1"
            />

            {/* Horizontal Gridlines & Y Ticks */}
            {yTicks.map((tick) => {
              const py = mapY(tick);
              if (py < MARGIN.top - 1 || py > MARGIN.top + PLOT_H + 1) return null;
              return (
                <g key={`y-${tick}`}>
                  <line
                    x1={MARGIN.left}
                    y1={py}
                    x2={MARGIN.left + PLOT_W}
                    y2={py}
                    stroke="#F1F5F9"
                    strokeWidth="1"
                  />
                  <line
                    x1={MARGIN.left - 4}
                    y1={py}
                    x2={MARGIN.left}
                    y2={py}
                    stroke="#94A3B8"
                    strokeWidth="1"
                  />
                  <text
                    x={MARGIN.left - 8}
                    y={py + 3.5}
                    textAnchor="end"
                    fontSize="11"
                    fontFamily="IBM Plex Mono, monospace"
                    fill="#475569"
                  >
                    {formatTick(tick, yStep)}
                  </text>
                </g>
              );
            })}

            {/* Vertical Gridlines & X Ticks */}
            {xTicks.map((tick) => {
              const px = mapX(tick);
              if (px < MARGIN.left - 1 || px > MARGIN.left + PLOT_W + 1) return null;
              return (
                <g key={`x-${tick}`}>
                  <line
                    x1={px}
                    y1={MARGIN.top}
                    x2={px}
                    y2={MARGIN.top + PLOT_H}
                    stroke="#F1F5F9"
                    strokeWidth="1"
                  />
                  <line
                    x1={px}
                    y1={MARGIN.top + PLOT_H}
                    x2={px}
                    y2={MARGIN.top + PLOT_H + 4}
                    stroke="#94A3B8"
                    strokeWidth="1"
                  />
                  <text
                    x={px}
                    y={MARGIN.top + PLOT_H + 18}
                    textAnchor="middle"
                    fontSize="11"
                    fontFamily="IBM Plex Mono, monospace"
                    fill="#475569"
                  >
                    {formatTick(tick, xStep)}
                  </text>
                </g>
              );
            })}

            {/* Clipped Data Layer */}
            <g clipPath="url(#plotClip)">
              {/* Zero reference line when baseline correction is active */}
              {baselineEnabled && viewDomain.yMin < 0 && viewDomain.yMax > 0 && (
                <line
                  x1={MARGIN.left}
                  y1={mapY(0)}
                  x2={MARGIN.left + PLOT_W}
                  y2={mapY(0)}
                  stroke="#CBD5E1"
                  strokeWidth="1"
                />
              )}

              {/* Traces */}
              {tracePaths.map(({ trace, mainD, rawD, baseD, areaD }) => (
                <g key={trace.id}>
                  {rawD && (
                    <path
                      d={rawD}
                      fill="none"
                      stroke="#94A3B8"
                      strokeWidth="1.2"
                      strokeOpacity="0.7"
                      strokeLinejoin="round"
                    />
                  )}
                  {baseD && (
                    <path
                      d={baseD}
                      fill="none"
                      stroke="#D97706"
                      strokeWidth="1.5"
                      strokeDasharray="5 3"
                      strokeLinejoin="round"
                    />
                  )}
                  {areaD && <path d={areaD} fill="url(#spectrumFill)" />}
                  {mainD && (
                    <path
                      d={mainD}
                      fill="none"
                      stroke={trace.color}
                      strokeWidth={overlayEnabled ? '1.6' : '1.5'}
                      strokeLinejoin="round"
                      strokeLinecap="round"
                    />
                  )}
                </g>
              ))}

              {/* Drag-to-Zoom Selection Overlay */}
              {dragSelection && Math.abs(dragSelection.currentX - dragSelection.startX) > 4 && (
                <rect
                  x={Math.min(dragSelection.startX, dragSelection.currentX)}
                  y={MARGIN.top}
                  width={Math.abs(dragSelection.currentX - dragSelection.startX)}
                  height={PLOT_H}
                  fill="#2563EB"
                  fillOpacity="0.12"
                  stroke="#2563EB"
                  strokeWidth="1"
                />
              )}

              {/* Peak Callouts */}
              {showPeaks &&
                traces.map((tr) =>
                  tr.peaks
                    .filter((p) => p.x >= viewDomain.xMin && p.x <= viewDomain.xMax)
                    .map((pk) => {
                      const px = mapX(pk.x);
                      const py = mapY(pk.intensity);
                      const labelY = Math.max(MARGIN.top + 14, py - 10);
                      return (
                        <g key={`${tr.id}-pk-${pk.index}`}>
                          <line
                            x1={px}
                            y1={py}
                            x2={px}
                            y2={labelY + 3}
                            stroke="#94A3B8"
                            strokeWidth="1"
                            strokeDasharray="2 2"
                          />
                          <circle cx={px} cy={py} r="3" fill="#FFFFFF" stroke={tr.color} strokeWidth="1.5" />
                          <text
                            x={px}
                            y={labelY}
                            textAnchor="middle"
                            fontSize="10.5"
                            fontFamily="IBM Plex Mono, monospace"
                            fontWeight="500"
                            fill={overlayEnabled ? tr.color : '#0F172A'}
                            stroke="#FFFFFF"
                            strokeWidth="3"
                            paintOrder="stroke"
                          >
                            {pk.x.toFixed(1)}
                          </text>
                        </g>
                      );
                    }),
                )}

              {/* Crosshair Lines & Snap Dots */}
              {hoverDataX !== null && hoveredMatches.length > 0 && (
                <g>
                  <line
                    x1={mapX(overlayEnabled ? hoverDataX : hoveredMatches[0].point.x)}
                    y1={MARGIN.top}
                    x2={mapX(overlayEnabled ? hoverDataX : hoveredMatches[0].point.x)}
                    y2={MARGIN.top + PLOT_H}
                    stroke="#64748B"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {!overlayEnabled && (
                    <line
                      x1={MARGIN.left}
                      y1={mapY(hoveredMatches[0].point.y)}
                      x2={MARGIN.left + PLOT_W}
                      y2={mapY(hoveredMatches[0].point.y)}
                      stroke="#64748B"
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                  )}
                  {hoveredMatches.map(({ trace, point }) => (
                    <circle
                      key={`snap-${trace.id}`}
                      cx={mapX(point.x)}
                      cy={mapY(point.y)}
                      r="4"
                      fill={trace.color}
                      stroke="#FFFFFF"
                      strokeWidth="1.5"
                    />
                  ))}
                </g>
              )}
            </g>

            {/* Axis Titles */}
            <text
              x={MARGIN.left + PLOT_W / 2}
              y={CHART_HEIGHT - 8}
              textAnchor="middle"
              fontSize="12"
              fontWeight="500"
              fill="#334155"
            >
              {primaryTrace.label} {primaryTrace.symbol ? `(${primaryTrace.symbol})` : ''}
            </text>
            <text
              x={16}
              y={MARGIN.top + PLOT_H / 2}
              textAnchor="middle"
              fontSize="12"
              fontWeight="500"
              fill="#334155"
              transform={`rotate(-90, 16, ${MARGIN.top + PLOT_H / 2})`}
            >
              {yAxisTitle}
            </text>
          </svg>
        </div>
      </div>

      {/* Multi-Spectrum Scrubber (single-file series / map) */}
      {!overlayEnabled && totalSpectra > 1 && (
        <div className="bg-white border border-slate-200 rounded p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div className="flex-1">
            <label htmlFor="spectrum-scrubber" className="block text-xs font-medium text-slate-700 mb-1.5">
              Spectrum Index:{' '}
              <span className="font-mono tabular-nums text-slate-900">
                {spectrumIndex + 1} / {totalSpectra.toLocaleString()}
              </span>
            </label>
            <input
              id="spectrum-scrubber"
              type="range"
              min={0}
              max={totalSpectra - 1}
              value={spectrumIndex}
              onChange={(e) => setSpectrumIndex(Number(e.target.value))}
              className="w-full accent-blue-600"
            />
          </div>

          {mapGrid && (
            <div className="shrink-0">
              <div className="text-[11px] font-medium text-slate-500 mb-1">
                2D Map Intensity ({mapGrid.cols} × {mapGrid.rows})
              </div>
              <div
                className="grid gap-0.5 border border-slate-200 p-0.5 bg-slate-100"
                style={{ gridTemplateColumns: `repeat(${mapGrid.cols}, 20px)` }}
              >
                {mapGrid.cells.map((val, idx) => {
                  const norm =
                    mapGrid.maxVal > mapGrid.minVal
                      ? (val - mapGrid.minVal) / (mapGrid.maxVal - mapGrid.minVal)
                      : 0.5;
                  return (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => setSpectrumIndex(idx)}
                      title={`Spectrum #${idx + 1}: peak ${val.toFixed(1)}`}
                      className={`w-5 h-5 cursor-pointer ${idx === spectrumIndex ? 'ring-2 ring-slate-900' : ''}`}
                      style={{
                        backgroundColor: `rgba(37, 99, 235, ${(0.15 + norm * 0.85).toFixed(2)})`,
                      }}
                    />
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Quantitative Metrics Strip */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 border border-slate-200 rounded bg-white divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Data Points</div>
          <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
            {primaryTrace.points.length.toLocaleString()}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">X Range</div>
          <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
            {viewDomain.xMin.toFixed(1)} – {viewDomain.xMax.toFixed(1)}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Peak Position</div>
          <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-blue-600">
            {primaryTrace.peak ? `${primaryTrace.peak.x.toFixed(2)} ${primaryTrace.symbol}` : '—'}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Peak Intensity</div>
          <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
            {primaryTrace.peak
              ? overlayEnabled && normalizeOverlay
                ? `${primaryTrace.peak.y.toFixed(1)}%`
                : primaryTrace.peak.y.toLocaleString(undefined, { maximumFractionDigits: 1 })
              : '—'}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">Min / Mean</div>
          <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
            {(() => {
              const fmt = (v: number) => {
                const s = v.toFixed(overlayEnabled && normalizeOverlay ? 1 : 0);
                return s === '-0' || s === '-0.0' ? s.slice(1) : s;
              };
              const suffix = overlayEnabled && normalizeOverlay ? '%' : '';
              return `${fmt(primaryTrace.minY)}${suffix} / ${fmt(primaryTrace.meanY)}${suffix}`;
            })()}
          </div>
        </div>
        <div className="p-3.5">
          <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
            {baselineEnabled ? 'Baseline' : 'Native Axis'}
          </div>
          <div
            className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900 whitespace-nowrap"
            title={baselineEnabled ? `AsLS (${baselineStrength})` : wdf.summary.xAxisUnits}
          >
            {baselineEnabled
              ? `AsLS · ${baselineStrength}`
              : wdf.summary.xAxisUnits === 'Absolute Wavenumber'
                ? 'Abs. cm⁻¹'
                : wdf.summary.xAxisUnits}
          </div>
        </div>
      </div>

      {/* Detected Peaks Table + Optional White-Light Image */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className={`${whiteLightUrl && !overlayEnabled ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white border border-slate-200 rounded`}>
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
            <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
              Detected Local Maxima ({combinedPeaks.length})
            </h2>
            <span className="text-[11px] font-mono text-slate-500">
              {primaryTrace.label} ({primaryTrace.symbol || 'a.u.'})
              {baselineEnabled ? ' · Baseline corrected' : ''}
            </span>
          </div>
          {combinedPeaks.length > 0 ? (
            <div className="overflow-x-auto">
              <table className="w-full text-xs text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 text-slate-500 bg-white">
                    <th className="py-2 px-4 font-medium">Rank</th>
                    {overlayEnabled && <th className="py-2 px-4 font-medium">Sample</th>}
                    <th className="py-2 px-4 font-medium">Position ({primaryTrace.symbol || 'X'})</th>
                    <th
                      className="py-2 px-4 font-medium text-right"
                      title="Full Width at Half Maximum (line width at 50% of peak intensity)"
                    >
                      FWHM ({primaryTrace.symbol || 'X'})
                    </th>
                    <th className="py-2 px-4 font-medium text-right">
                      {overlayEnabled && normalizeOverlay
                        ? 'Intensity (%)'
                        : `Intensity (${wdf.header.spectralUnitsName})`}
                    </th>
                    <th className="py-2 px-4 font-medium text-right">Rel. Intensity</th>
                    <th className="py-2 px-4 font-medium text-right">Index</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                  {combinedPeaks.map(({ trace, peak: pk }, idx) => (
                    <tr key={`${trace.id}-${pk.index}`} className="hover:bg-slate-50">
                      <td className="py-2 px-4 text-slate-500">#{idx + 1}</td>
                      {overlayEnabled && (
                        <td className="py-2 px-4 font-sans text-slate-800">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-2 h-2 rounded-xs shrink-0 inline-block"
                              style={{ backgroundColor: trace.color }}
                            />
                            <span className="truncate max-w-[190px]">{trace.fileName}</span>
                          </span>
                        </td>
                      )}
                      <td className="py-2 px-4 font-semibold text-slate-900">{pk.x.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right font-medium text-blue-600">
                        {pk.fwhm !== null
                          ? pk.fwhm.toFixed(effectiveUnit === 'electronVolt' ? 5 : 2)
                          : '—'}
                      </td>
                      <td className="py-2 px-4 text-right text-slate-800">
                        {overlayEnabled && normalizeOverlay
                          ? `${pk.intensity.toFixed(1)}%`
                          : pk.intensity.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </td>
                      <td className="py-2 px-4 text-right text-slate-600">
                        {trace.maxY > 0 ? `${((pk.intensity / trace.maxY) * 100).toFixed(1)}%` : '—'}
                      </td>
                      <td className="py-2 px-4 text-right text-slate-500">{pk.index}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="p-4 text-xs text-slate-500">No prominent local peaks detected above baseline.</p>
          )}
        </div>

        {whiteLightUrl && !overlayEnabled && wdf.whiteLightImage && (
          <div className="bg-white border border-slate-200 rounded overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
              <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                White-Light Image (WHTL)
              </h2>
              <span className="text-[11px] font-mono text-slate-500">{wdf.whiteLightImage.mimeType}</span>
            </div>
            <div className="p-3 bg-slate-100 flex items-center justify-center">
              <img
                src={whiteLightUrl}
                alt="Embedded Renishaw white-light optical micrograph"
                className="max-h-56 w-auto rounded border border-slate-200"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
