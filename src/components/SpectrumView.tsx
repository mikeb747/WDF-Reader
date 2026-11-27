import { useEffect, useMemo, useRef, useState } from 'react';
import { Calculator, Crosshair, Layers, Maximize2, Minimize2, RotateCcw, Rows3, SlidersHorizontal, Trash2, Waves, X, ZoomIn } from 'lucide-react';
import {
  autoSmoothSpectrum,
  autoSubtractBaseline,
  convertXAxis,
  detectPeaks,
  fitPeakCurve,
  getSpectrum,
  interpolateAxisAtPixel,
  samplePeakCurve,
  smoothSpectrumSavitzkyGolay,
  subtractBaseline,
  WdfDataUnits,
  type AutoBaselineResult,
  type AutoSmoothResult,
  type CurveFitMethod,
  type CurveFitResult,
  type SpectralTargetUnit,
  type WdfFile,
  type WdfPeak,
} from '../lib/wdf';
import { stripWdfExtension } from '../lib/format';
import { DataArithmeticModal } from './DataArithmeticModal';
import { ScanMapChart, type ActiveIntegrationWindow } from './ScanMapChart';
import type { LoadedSample } from './Sidebar';
import { TraceColorPicker } from './TraceColorPicker';

export type BaselineStrength = 'auto' | 'gentle' | 'standard' | 'aggressive';
export type SmoothStrength = 'auto' | 'light' | 'medium' | 'strong' | 'veryStrong';

const MANUAL_BASELINE_LAMBDA: Record<Exclude<BaselineStrength, 'auto'>, number> = {
  gentle: 1e6,
  standard: 1e5,
  aggressive: 1e4,
};

const MANUAL_SMOOTH_CONFIG: Record<
  Exclude<SmoothStrength, 'auto'>,
  { windowSize: number; polyOrder: number; label: string }
> = {
  light: { windowSize: 7, polyOrder: 3, label: 'Light (7 pts)' },
  medium: { windowSize: 15, polyOrder: 3, label: 'Medium (15 pts)' },
  strong: { windowSize: 25, polyOrder: 3, label: 'Strong (25 pts)' },
  veryStrong: { windowSize: 41, polyOrder: 2, label: 'Very Strong (41 pts)' },
};

const CURVE_FIT_METHOD_OPTIONS: Array<{ value: CurveFitMethod; label: string }> = [
  { value: 'auto', label: 'Auto (Adaptive)' },
  { value: 'gaussian3', label: '3-pt Gaussian (Sharp)' },
  { value: 'gaussian5', label: '5-pt Gaussian (Medium)' },
  { value: 'lorentzian', label: 'Lorentzian (Broad/Raman)' },
  { value: 'parabolic', label: 'Parabolic (Fast)' },
];

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
  smoothEnabled: boolean;
  onToggleSmooth: () => void;
  smoothStrength: SmoothStrength;
  onChangeSmoothStrength: (strength: SmoothStrength) => void;
  onToggleSampleVisible: (id: string) => void;
  onSetAllVisible: (visible: boolean) => void;
  onChangeSampleColor: (id: string, color: string) => void;
  onCreateDerivedSample?: (result: { fileName: string; wdf: WdfFile; formulaLabel: string }) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
}

const STANDARD_UNIT_OPTIONS: Array<{ id: Exclude<SpectralTargetUnit, 'native'>; label: string }> = [
  { id: 'ramanShift', label: 'Raman Shift' },
  { id: 'wavenumber', label: 'Abs. cm⁻¹' },
  { id: 'nanometre', label: 'Wavelength nm' },
  { id: 'electronVolt', label: 'Energy eV' },
];

function wdfUnitToTargetUnit(unit: WdfDataUnits | undefined): Exclude<SpectralTargetUnit, 'native'> | null {
  switch (unit) {
    case WdfDataUnits.RamanShift:
      return 'ramanShift';
    case WdfDataUnits.Wavenumber:
      return 'wavenumber';
    case WdfDataUnits.Nanometre:
      return 'nanometre';
    case WdfDataUnits.ElectronVolt:
      return 'electronVolt';
    default:
      return null;
  }
}

const DEFAULT_CHART_WIDTH = 960;
const DEFAULT_CHART_HEIGHT = 400;
const MARGIN_TOP = 8;
const MARGIN_RIGHT = 8;
const MARGIN_BOTTOM = 38;

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

interface ComputedCurveFit {
  fit: CurveFitResult;
  xPeakCalibrated: number;
  yPeakDisplay: number;
  fwhmCalibrated: number | null;
  samples: Array<{ pixel: number; x: number; y: number }>;
  windowPoints: Array<{ pixel: number; x: number; y: number }>;
  zoomMinX: number;
  zoomMaxX: number;
}

interface ComputedTrace {
  id: string;
  fileName: string;
  title: string;
  color: string;
  points: Array<{ x: number; y: number; rawY: number; baselineY: number; origIdx: number }>;
  workingY: Float64Array;
  xs: Float64Array;
  scaleMin: number;
  scaleSpan: number;
  isNormalized: boolean;
  label: string;
  symbol: string;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  meanY: number;
  peak: { x: number; y: number; origIdx: number } | null;
  peaks: WdfPeak[];
  peakFit: ComputedCurveFit | null;
  autoBaselineProfile?: AutoBaselineResult['profile'];
  autoBaselineLambda?: number;
  smoothWindowSize?: number;
  autoSmoothProfile?: AutoSmoothResult['profile'];
}

const WARM_TRACE_COLORS = new Set(['#ea580c', '#dc2626', '#e11d48', '#d97706', '#9a3412', '#f97316']);

function getCurveFitStrokeColor(traceColor: string): string {
  return WARM_TRACE_COLORS.has(traceColor.toLowerCase()) ? '#0D9488' : '#EA580C';
}

function buildComputedCurveFit(
  workingY: Float64Array,
  xs: Float64Array,
  peakIdx: number,
  normalize: boolean,
  scaleMin: number,
  scaleSpan: number,
  method: CurveFitMethod,
  precomputedFit?: CurveFitResult,
): ComputedCurveFit | null {
  const n = workingY.length;
  if (n === 0 || peakIdx < 0 || peakIdx >= n) return null;

  const fit = precomputedFit ?? fitPeakCurve(workingY, peakIdx, method);
  const toDisplayY = (v: number) => (normalize ? ((v - scaleMin) / scaleSpan) * 100 : v);
  const xPeakCalibrated = interpolateAxisAtPixel(xs, fit.xPeak);
  const yPeakDisplay = toDisplayY(fit.yPeak);

  let fwhmCalibrated: number | null = null;
  if (fit.fwhm !== null && n >= 2) {
    const lo = Math.max(0, peakIdx - 1);
    const hi = Math.min(n - 1, peakIdx + 1);
    const stepX = Math.abs(xs[hi] - xs[lo]) / Math.max(1, hi - lo);
    if (Number.isFinite(stepX) && stepX > 0) {
      fwhmCalibrated = fit.fwhm * stepX;
    }
  }

  const samples = fit.isFallback
    ? []
    : samplePeakCurve(fit, n, fit.renderHalfSpan, 0.05).map((pt) => ({
        pixel: pt.pixel,
        x: interpolateAxisAtPixel(xs, pt.pixel),
        y: toDisplayY(pt.intensity),
      }));

  const windowPoints: Array<{ pixel: number; x: number; y: number }> = [];
  const winStart = Math.max(0, peakIdx - fit.halfWindow);
  const winEnd = Math.min(n - 1, peakIdx + fit.halfWindow);
  for (let i = winStart; i <= winEnd; i++) {
    windowPoints.push({
      pixel: i,
      x: xs[i],
      y: toDisplayY(workingY[i]),
    });
  }

  const zoomHalfPx = Math.min(60, Math.max(10, Math.ceil(3.5 * (fit.fwhm ?? fit.rawFwhm))));
  const zoomLoIdx = Math.max(0, peakIdx - zoomHalfPx);
  const zoomHiIdx = Math.min(n - 1, peakIdx + zoomHalfPx);
  const zoomMinX = Math.min(xs[zoomLoIdx], xs[zoomHiIdx]);
  const zoomMaxX = Math.max(xs[zoomLoIdx], xs[zoomHiIdx]);

  return {
    fit,
    xPeakCalibrated,
    yPeakDisplay,
    fwhmCalibrated,
    samples,
    windowPoints,
    zoomMinX,
    zoomMaxX,
  };
}

interface PickedPeakEntry {
  id: string;
  sampleId: string;
  spectrumIndex: number;
  origIdx: number;
}

interface ResolvedPickedPeak {
  entry: PickedPeakEntry;
  trace: ComputedTrace;
  point: ComputedTrace['points'][number];
}

function buildTrace(
  sampleId: string,
  fileName: string,
  wdf: WdfFile,
  color: string,
  spectrumIndex: number,
  targetUnit: SpectralTargetUnit,
  sortAscending: boolean,
  smoothEnabled: boolean,
  smoothStrength: SmoothStrength,
  baselineEnabled: boolean,
  baselineStrength: BaselineStrength,
  normalize: boolean,
  curveFitEnabled: boolean,
  curveFitMethod: CurveFitMethod,
): ComputedTrace | null {
  if (!wdf.xAxis) return null;
  const converted = convertXAxis(wdf.xAxis, wdf.header.laserWavenumber, targetUnit);
  const yRaw = getSpectrum(wdf, spectrumIndex);
  const n = Math.min(converted.values.length, yRaw.length);
  if (n === 0) return null;

  // Build ordered index array so smoothing and AsLS run sequentially along the plotted X direction
  const order: Array<{ x: number; rawY: number; origIdx: number }> = [];
  for (let i = 0; i < n; i++) {
    order.push({ x: converted.values[i], rawY: yRaw[i], origIdx: i });
  }
  if (sortAscending) {
    order.sort((a, b) => a.x - b.x);
  }

  const orderedRawY = new Float64Array(order.length);
  for (let i = 0; i < order.length; i++) orderedRawY[i] = order[i].rawY;

  let denoisedY: Float64Array = orderedRawY;
  let smoothWindowSize: number | undefined;
  let autoSmoothProfile: AutoSmoothResult['profile'] | undefined;

  if (smoothEnabled) {
    if (smoothStrength === 'auto') {
      const res = autoSmoothSpectrum(orderedRawY);
      denoisedY = res.smoothed;
      smoothWindowSize = res.windowSize;
      autoSmoothProfile = res.profile;
    } else {
      const cfg = MANUAL_SMOOTH_CONFIG[smoothStrength];
      denoisedY = smoothSpectrumSavitzkyGolay(orderedRawY, {
        windowSize: cfg.windowSize,
        polyOrder: cfg.polyOrder,
      });
      smoothWindowSize = cfg.windowSize;
    }
  }

  let baselineArr: Float64Array;
  let workingY: Float64Array;
  let autoBaselineProfile: AutoBaselineResult['profile'] | undefined;
  let autoBaselineLambda: number | undefined;

  if (baselineEnabled) {
    if (baselineStrength === 'auto') {
      const res = autoSubtractBaseline(denoisedY);
      baselineArr = res.baseline;
      workingY = res.corrected;
      autoBaselineProfile = res.profile;
      autoBaselineLambda = res.lambda;
    } else {
      const lambda = MANUAL_BASELINE_LAMBDA[baselineStrength];
      const res = subtractBaseline(denoisedY, { lambda, p: 0.005, iterations: 10 });
      baselineArr = res.baseline;
      workingY = res.corrected;
    }
  } else {
    baselineArr = new Float64Array(order.length);
    workingY = denoisedY;
  }

  // Locate primary discrete maximum on workingY before normalization so Curve Fit runs on true intensities
  let minV = Infinity;
  let maxV = -Infinity;
  let rawPeakIdx = 0;
  for (let i = 0; i < workingY.length; i++) {
    const v = workingY[i];
    if (v < minV) minV = v;
    if (v > maxV) {
      maxV = v;
      rawPeakIdx = i;
    }
  }

  const primaryFitRaw = fitPeakCurve(workingY, rawPeakIdx, curveFitMethod);

  // Optional 0-100% normalization: when Curve Fit is ON, normalize both discrete data and fitted curve
  // relative to fitted yPeak so the fitted peak crest equals 100%.
  let scaleMin = 0;
  let scaleSpan = 1;
  if (normalize) {
    scaleMin = baselineEnabled ? 0 : minV;
    const referencePeak = curveFitEnabled ? primaryFitRaw.yPeak : maxV;
    const candidateSpan = referencePeak - scaleMin;
    scaleSpan = candidateSpan > 1e-9 ? candidateSpan : Math.max(maxV - scaleMin, 1);
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

  const peakFit = buildComputedCurveFit(
    workingY,
    xs,
    rawPeakIdx,
    normalize,
    scaleMin,
    scaleSpan,
    curveFitMethod,
    primaryFitRaw,
  );
  const peaks = detectPeaks(xs, ys, 5, 16);

  const cleanName = stripWdfExtension(fileName);
  const cleanTitle = stripWdfExtension(wdf.header.title || cleanName);

  return {
    id: sampleId,
    fileName: cleanName,
    title: cleanTitle,
    color,
    points,
    workingY,
    xs,
    scaleMin,
    scaleSpan,
    isNormalized: normalize,
    label: converted.label,
    symbol: converted.symbol,
    minX,
    maxX,
    minY,
    maxY,
    meanY: points.length > 0 ? sumY / points.length : 0,
    peak: points[peakIdx] ? { x: points[peakIdx].x, y: points[peakIdx].y, origIdx: points[peakIdx].origIdx } : null,
    peaks,
    peakFit,
    autoBaselineProfile,
    autoBaselineLambda,
    smoothWindowSize,
    autoSmoothProfile,
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

function findLocalPeakPoint(
  points: ComputedTrace['points'],
  dataX: number,
  windowHalfWidthX: number,
): ComputedTrace['points'][number] | null {
  if (points.length === 0) return null;
  let nearestIdx = 0;
  let nearestDist = Math.abs(points[0].x - dataX);
  for (let i = 1; i < points.length; i++) {
    const d = Math.abs(points[i].x - dataX);
    if (d < nearestDist) {
      nearestDist = d;
      nearestIdx = i;
    }
  }

  // Gather candidate indices within ±windowHalfWidthX (at least ±3 samples around click)
  let startIdx = nearestIdx;
  while (startIdx > 0 && (Math.abs(points[startIdx - 1].x - dataX) <= windowHalfWidthX || nearestIdx - startIdx < 3)) {
    startIdx--;
  }
  let endIdx = nearestIdx;
  while (
    endIdx < points.length - 1 &&
    (Math.abs(points[endIdx + 1].x - dataX) <= windowHalfWidthX || endIdx - nearestIdx < 3)
  ) {
    endIdx++;
  }

  let bestIdx = nearestIdx;
  let bestY = points[nearestIdx].y;
  for (let i = startIdx; i <= endIdx; i++) {
    if (points[i].y > bestY) {
      bestY = points[i].y;
      bestIdx = i;
    }
  }
  return points[bestIdx];
}

function computeMedian(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid];
}

function formatCompactArea(area: number): string {
  const abs = Math.abs(area);
  if (abs >= 1e6 || (abs > 0 && abs < 1e-2)) {
    return area.toExponential(2);
  }
  return area.toLocaleString(undefined, { maximumFractionDigits: 1 });
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
  smoothEnabled,
  onToggleSmooth,
  smoothStrength,
  onChangeSmoothStrength,
  onToggleSampleVisible,
  onSetAllVisible,
  onChangeSampleColor,
  onCreateDerivedSample,
  isFullscreen = false,
  onToggleFullscreen,
}: SpectrumViewProps) {
  const [spectrumIndex, setSpectrumIndex] = useState(0);
  const [showPeaks, setShowPeaks] = useState(true);
  const [curveFitEnabled, setCurveFitEnabled] = useState(true);
  const [curveFitMethod, setCurveFitMethod] = useState<CurveFitMethod>('auto');
  const [sortAscending, setSortAscending] = useState(true);
  const [showFittedBaseline, setShowFittedBaseline] = useState(false);
  const [normalizeOverlay, setNormalizeOverlay] = useState(false);
  const [autoOffset, setAutoOffset] = useState(false);
  const [arithmeticModalOpen, setArithmeticModalOpen] = useState(false);
  const [zoomRange, setZoomRange] = useState<[number, number] | null>(null);
  const [dragSelection, setDragSelection] = useState<{ startX: number; currentX: number; startY: number } | null>(null);
  const [hoverDataX, setHoverDataX] = useState<number | null>(null);
  const [hoverSvgY, setHoverSvgY] = useState<number | null>(null);
  const [peakPickingMode, setPeakPickingMode] = useState(false);
  const [snapToLocalPeak, setSnapToLocalPeak] = useState(true);
  const [pickedPeaks, setPickedPeaks] = useState<PickedPeakEntry[]>([]);
  const [integrationWindow, setIntegrationWindow] = useState<ActiveIntegrationWindow | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const plotAreaRef = useRef<HTMLDivElement | null>(null);
  const [containerSize, setContainerSize] = useState<{ width: number; height: number }>({
    width: DEFAULT_CHART_WIDTH,
    height: DEFAULT_CHART_HEIGHT,
  });

  const visibleSamples = useMemo(() => {
    return samples.filter((s) => s.visible);
  }, [samples]);

  const isMultiOverlay = visibleSamples.length > 1;
  const allVisible = samples.length > 1 && visibleSamples.length === samples.length;

  useEffect(() => {
    const el = plotAreaRef.current;
    if (!el) return;

    const updateSize = () => {
      const rect = el.getBoundingClientRect();
      const nextW = Math.max(360, Math.floor(rect.width));
      const nextH = isFullscreen
        ? Math.max(240, Math.floor(rect.height))
        : Math.round(Math.min(460, Math.max(340, nextW * 0.40)));
      setContainerSize((prev) =>
        prev.width === nextW && prev.height === nextH ? prev : { width: nextW, height: nextH },
      );
    };

    updateSize();
    const raf = window.requestAnimationFrame(updateSize);
    if (typeof ResizeObserver === 'undefined') {
      return () => window.cancelAnimationFrame(raf);
    }
    const ro = new ResizeObserver(() => updateSize());
    ro.observe(el);
    return () => {
      window.cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [isFullscreen, visibleSamples.length]);

  useEffect(() => {
    setZoomRange(null);
    setHoverDataX(null);
    setSpectrumIndex(0);
  }, [wdf]);

  useEffect(() => {
    setZoomRange(null);
    setHoverDataX(null);
  }, [targetUnit, sortAscending, visibleSamples.length, baselineEnabled]);

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

  const effectiveUnit: SpectralTargetUnit = useMemo(() => {
    if (!isMultiOverlay || targetUnit !== 'native') return targetUnit;
    const distinctUnits = new Set(visibleSamples.map((s) => s.wdf.xAxis?.units));
    return distinctUnits.size > 1 ? 'ramanShift' : 'native';
  }, [isMultiOverlay, targetUnit, visibleSamples]);

  const sharedNativeUnit = useMemo(() => {
    if (visibleSamples.length === 0) return null;
    const distinctUnits = new Set(visibleSamples.map((s) => s.wdf.xAxis?.units));
    if (distinctUnits.size !== 1) return null;
    const [onlyUnit] = Array.from(distinctUnits);
    return wdfUnitToTargetUnit(onlyUnit);
  }, [visibleSamples]);

  const traces = useMemo<ComputedTrace[]>(() => {
    const list: ComputedTrace[] = [];
    for (const sample of visibleSamples) {
      const trace = buildTrace(
        sample.id,
        sample.fileName,
        sample.wdf,
        sample.color,
        sample.id === activeSampleId ? spectrumIndex : 0,
        effectiveUnit,
        sortAscending,
        smoothEnabled,
        smoothStrength,
        baselineEnabled,
        baselineStrength,
        normalizeOverlay,
        curveFitEnabled,
        curveFitMethod,
      );
      if (trace) list.push(trace);
    }
    return list;
  }, [
    visibleSamples,
    activeSampleId,
    spectrumIndex,
    effectiveUnit,
    sortAscending,
    smoothEnabled,
    smoothStrength,
    baselineEnabled,
    baselineStrength,
    normalizeOverlay,
    curveFitEnabled,
    curveFitMethod,
  ]);

  const primaryTrace = traces.find((t) => t.id === activeSampleId) ?? traces[0] ?? null;
  const isAutoOffsetActive = isMultiOverlay && autoOffset;

  // Resolve the active Gaussian curve fit for each trace (uses primary global peak fit, or fits
  // the highest visible peak when the user zooms into a region that excludes the global peak).
  const activeTraceFits = useMemo(() => {
    const map = new Map<string, ComputedCurveFit>();
    if (!curveFitEnabled) return map;
    const zMin = zoomRange ? Math.min(zoomRange[0], zoomRange[1]) : null;
    const zMax = zoomRange ? Math.max(zoomRange[0], zoomRange[1]) : null;

    for (const tr of traces) {
      if (!tr.peakFit) continue;
      if (
        zMin === null ||
        zMax === null ||
        (tr.peakFit.xPeakCalibrated >= zMin && tr.peakFit.xPeakCalibrated <= zMax)
      ) {
        map.set(tr.id, tr.peakFit);
        continue;
      }
      // Global peak is outside zoom range: fit the highest local maximum within the zoomed window
      let bestIdx = -1;
      let bestVal = -Infinity;
      for (let i = 0; i < tr.xs.length; i++) {
        const x = tr.xs[i];
        if (x >= zMin && x <= zMax && tr.workingY[i] > bestVal) {
          bestVal = tr.workingY[i];
          bestIdx = i;
        }
      }
      if (bestIdx >= 0) {
        const localFit = buildComputedCurveFit(
          tr.workingY,
          tr.xs,
          bestIdx,
          tr.isNormalized,
          tr.scaleMin,
          tr.scaleSpan,
          curveFitMethod,
        );
        if (localFit) map.set(tr.id, localFit);
      } else {
        map.set(tr.id, tr.peakFit);
      }
    }
    return map;
  }, [traces, curveFitEnabled, curveFitMethod, zoomRange]);

  const primaryCurveFit = primaryTrace ? (activeTraceFits.get(primaryTrace.id) ?? null) : null;

  const handleToggleAutoOffset = () => {
    if (!isMultiOverlay && samples.length >= 2) {
      onSetAllVisible(true);
      setAutoOffset(true);
    } else {
      setAutoOffset((prev) => !prev);
    }
  };

  // Compute adaptive non-overlapping Y-axis offsets so stacked traces match Explorer order (top to bottom)
  const { traceYOffsets, traceBaselineGuides, viewDomain } = useMemo(() => {
    const offsets = new Map<string, number>();
    const baselineGuides = new Map<string, number>();

    if (traces.length === 0) {
      return {
        traceYOffsets: offsets,
        traceBaselineGuides: baselineGuides,
        viewDomain: { xMin: 0, xMax: 1, yMin: 0, yMax: 1 },
      };
    }

    let globalMinX = Infinity;
    let globalMaxX = -Infinity;
    for (const tr of traces) {
      if (tr.minX < globalMinX) globalMinX = tr.minX;
      if (tr.maxX > globalMaxX) globalMaxX = tr.maxX;
    }
    const xMin = zoomRange ? Math.min(zoomRange[0], zoomRange[1]) : globalMinX;
    const xMax = zoomRange ? Math.max(zoomRange[0], zoomRange[1]) : globalMaxX;

    if (isAutoOffsetActive) {
      const localRanges = traces.map((tr) => {
        let minV = Infinity;
        let maxV = -Infinity;
        for (let i = 0; i < tr.points.length; i++) {
          const p = tr.points[i];
          if (p.x >= xMin && p.x <= xMax) {
            if (p.y < minV) minV = p.y;
            if (p.y > maxV) maxV = p.y;
          }
        }
        if (!Number.isFinite(minV) || !Number.isFinite(maxV)) {
          minV = tr.minY;
          maxV = tr.maxY;
        }
        return { id: tr.id, minV, maxV, span: Math.max(0, maxV - minV) };
      });

      const positiveSpans = localRanges.map((r) => r.span).filter((s) => s > 0);
      const maxSpan = positiveSpans.length > 0 ? Math.max(...positiveSpans) : 1;
      const medSpan = positiveSpans.length > 0 ? computeMedian(positiveSpans) : 1;
      const laneGap = Math.max(medSpan * 0.16, maxSpan * 0.06, 1);

      let runningTopY = 0;
      for (let i = localRanges.length - 1; i >= 0; i--) {
        const r = localRanges[i];
        if (i === localRanges.length - 1) {
          offsets.set(r.id, 0);
          baselineGuides.set(r.id, r.minV);
          runningTopY = r.maxV;
        } else {
          const targetBase = runningTopY + laneGap;
          const offset = targetBase - r.minV;
          offsets.set(r.id, offset);
          baselineGuides.set(r.id, targetBase);
          runningTopY = r.maxV + offset;
        }
      }
    }

    let yMin = Infinity;
    let yMax = -Infinity;
    let found = false;
    for (const tr of traces) {
      const yOffset = isAutoOffsetActive ? (offsets.get(tr.id) ?? 0) : 0;
      for (let i = 0; i < tr.points.length; i++) {
        const p = tr.points[i];
        if (p.x >= xMin && p.x <= xMax) {
          found = true;
          const shiftedY = p.y + yOffset;
          if (shiftedY < yMin) yMin = shiftedY;
          if (shiftedY > yMax) yMax = shiftedY;
          if (!isMultiOverlay && (baselineEnabled || smoothEnabled) && showFittedBaseline) {
            if (p.rawY < yMin) yMin = p.rawY;
            if (p.rawY > yMax) yMax = p.rawY;
            if (baselineEnabled) {
              if (p.baselineY < yMin) yMin = p.baselineY;
              if (p.baselineY > yMax) yMax = p.baselineY;
            }
          }
        }
      }
      if (curveFitEnabled) {
        const fit = activeTraceFits.get(tr.id);
        if (fit && fit.xPeakCalibrated >= xMin && fit.xPeakCalibrated <= xMax) {
          const crestY = fit.yPeakDisplay + yOffset;
          if (Number.isFinite(crestY)) {
            if (crestY > yMax) yMax = crestY;
            if (crestY < yMin) yMin = crestY;
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
      traceYOffsets: offsets,
      traceBaselineGuides: baselineGuides,
      viewDomain: {
        xMin,
        xMax: xMax === xMin ? xMin + 1 : xMax,
        yMin: yMin - yPad * 0.35,
        yMax: yMax + yPad,
      },
    };
  }, [
    traces,
    zoomRange,
    isMultiOverlay,
    isAutoOffsetActive,
    baselineEnabled,
    smoothEnabled,
    showFittedBaseline,
    curveFitEnabled,
    activeTraceFits,
  ]);

  const getTraceYOffset = (traceId: string) =>
    isAutoOffsetActive ? (traceYOffsets.get(traceId) ?? 0) : 0;

  const xTicks = useMemo(() => niceTicks(viewDomain.xMin, viewDomain.xMax, 7), [viewDomain.xMin, viewDomain.xMax]);
  const yTicks = useMemo(() => niceTicks(viewDomain.yMin, viewDomain.yMax, 6), [viewDomain.yMin, viewDomain.yMax]);
  const xStep = xTicks.length >= 2 ? Math.abs(xTicks[1] - xTicks[0]) : 1;
  const yStep = yTicks.length >= 2 ? Math.abs(yTicks[1] - yTicks[0]) : 1;

  const maxYTickChars = useMemo(() => {
    let maxLen = 2;
    for (const tick of yTicks) {
      const len = formatTick(tick, yStep).length;
      if (len > maxLen) maxLen = len;
    }
    return maxLen;
  }, [yTicks, yStep]);

  const chartWidth = containerSize.width;
  const chartHeight = containerSize.height;
  const margin = {
    top: MARGIN_TOP,
    right: MARGIN_RIGHT,
    bottom: MARGIN_BOTTOM,
    left: Math.max(46, Math.ceil(22 + maxYTickChars * 6.8 + 8)),
  };
  const plotW = Math.max(180, chartWidth - margin.left - margin.right);
  const plotH = Math.max(140, chartHeight - margin.top - margin.bottom);

  const mapX = (x: number) =>
    margin.left + ((x - viewDomain.xMin) / (viewDomain.xMax - viewDomain.xMin)) * plotW;
  const mapY = (y: number) =>
    margin.top + (1 - (y - viewDomain.yMin) / (viewDomain.yMax - viewDomain.yMin)) * plotH;
  const unmapX = (px: number) =>
    viewDomain.xMin + ((px - margin.left) / plotW) * (viewDomain.xMax - viewDomain.xMin);

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
      const yOffset = isAutoOffsetActive ? (traceYOffsets.get(tr.id) ?? 0) : 0;
      const mainD = buildPath(tr.points, (p) => p.y + yOffset);
      const rawD =
        !isMultiOverlay && (baselineEnabled || smoothEnabled) && showFittedBaseline
          ? buildPath(tr.points, (p) => p.rawY)
          : '';
      const baseD =
        !isMultiOverlay && baselineEnabled && showFittedBaseline ? buildPath(tr.points, (p) => p.baselineY) : '';

      let areaD = '';
      if (!isMultiOverlay && mainD) {
        const visible = tr.points.filter((p) => p.x >= viewDomain.xMin && p.x <= viewDomain.xMax);
        if (visible.length >= 2) {
          const firstX = mapX(visible[0].x).toFixed(2);
          const lastX = mapX(visible[visible.length - 1].x).toFixed(2);
          const baseY = (margin.top + plotH).toFixed(2);
          areaD = `${mainD} L${lastX},${baseY} L${firstX},${baseY} Z`;
        }
      }

      let fitD = '';
      let fitColor = getCurveFitStrokeColor(tr.color);
      let fitOverlay: {
        fit: ComputedCurveFit;
        markerX: number;
        apexY: number;
        color: string;
        showWindowDots: boolean;
      } | null = null;

      if (curveFitEnabled) {
        const computedFit = activeTraceFits.get(tr.id);
        if (computedFit) {
          fitColor = getCurveFitStrokeColor(tr.color);
          if (!computedFit.fit.isFallback && computedFit.samples.length >= 2) {
            const fitCmds: string[] = [];
            let started = false;
            for (let i = 0; i < computedFit.samples.length; i++) {
              const sp = computedFit.samples[i];
              if (sp.x < viewDomain.xMin || sp.x > viewDomain.xMax) continue;
              const sx = mapX(sp.x).toFixed(2);
              const sy = mapY(sp.y + yOffset).toFixed(2);
              fitCmds.push(started ? `L${sx},${sy}` : `M${sx},${sy}`);
              started = true;
            }
            fitD = fitCmds.join(' ');
          }

          if (
            computedFit.xPeakCalibrated >= viewDomain.xMin &&
            computedFit.xPeakCalibrated <= viewDomain.xMax
          ) {
            const firstWin = computedFit.windowPoints[0];
            const lastWin = computedFit.windowPoints[computedFit.windowPoints.length - 1];
            const windowScreenSpan =
              firstWin && lastWin ? Math.abs(mapX(lastWin.x) - mapX(firstWin.x)) : 0;
            fitOverlay = {
              fit: computedFit,
              markerX: mapX(computedFit.xPeakCalibrated),
              apexY: mapY(computedFit.yPeakDisplay + yOffset),
              color: fitColor,
              showWindowDots: windowScreenSpan >= 24,
            };
          }
        }
      }

      return { trace: tr, mainD, rawD, baseD, areaD, fitD, fitOverlay, yOffset };
    });
  }, [
    traces,
    viewDomain,
    isMultiOverlay,
    isAutoOffsetActive,
    traceYOffsets,
    baselineEnabled,
    smoothEnabled,
    showFittedBaseline,
    curveFitEnabled,
    activeTraceFits,
    margin.left,
    margin.top,
    plotW,
    plotH,
  ]);

  const getSvgCoords = (clientX: number, clientY: number): { x: number; y: number } | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const transformed = pt.matrixTransform(ctm.inverse());
      if (Number.isFinite(transformed.x) && Number.isFinite(transformed.y)) {
        return { x: transformed.x, y: transformed.y };
      }
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) return null;
    return {
      x: ((clientX - rect.left) / rect.width) * chartWidth,
      y: ((clientY - rect.top) / rect.height) * chartHeight,
    };
  };

  // Pick candidate trace & point for a given plot coordinate in Peak Picking mode
  const findPickCandidate = (
    dataX: number,
    svgY: number | null,
  ): { trace: ComputedTrace; point: ComputedTrace['points'][number] } | null => {
    if (traces.length === 0) return null;
    const windowHalfX = Math.abs(viewDomain.xMax - viewDomain.xMin) * 0.025;
    let best: { trace: ComputedTrace; point: ComputedTrace['points'][number]; dy: number } | null = null;

    for (const tr of traces) {
      const pt = snapToLocalPeak
        ? findLocalPeakPoint(tr.points, dataX, windowHalfX)
        : findNearestPoint(tr.points, dataX);
      if (!pt) continue;
      const dy = svgY !== null ? Math.abs(mapY(pt.y + getTraceYOffset(tr.id)) - svgY) : 0;
      if (!best || dy < best.dy) {
        best = { trace: tr, point: pt, dy };
      }
    }
    return best ? { trace: best.trace, point: best.point } : null;
  };

  const togglePickedPeakAt = (trace: ComputedTrace, origIdx: number) => {
    const specIdx = trace.id === activeSampleId ? spectrumIndex : 0;
    setPickedPeaks((prev) => {
      const existing = prev.find(
        (p) => p.sampleId === trace.id && p.spectrumIndex === specIdx && p.origIdx === origIdx,
      );
      if (existing) {
        return prev.filter((p) => p.id !== existing.id);
      }
      return [
        ...prev,
        {
          id: `${trace.id}-${specIdx}-${origIdx}`,
          sampleId: trace.id,
          spectrumIndex: specIdx,
          origIdx,
        },
      ];
    });
  };

  const removePickedPeak = (id: string) => {
    setPickedPeaks((prev) => prev.filter((p) => p.id !== id));
  };

  const clearVisiblePickedPeaks = () => {
    const visibleIds = new Set(traces.map((t) => t.id));
    setPickedPeaks((prev) => prev.filter((p) => !visibleIds.has(p.sampleId)));
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (traces.length === 0) return;
    const coords = getSvgCoords(e.clientX, e.clientY);
    if (!coords) return;

    const clampedX = Math.max(margin.left, Math.min(margin.left + plotW, coords.x));
    const clampedY = Math.max(margin.top, Math.min(margin.top + plotH, coords.y));
    if (dragSelection) {
      setDragSelection((prev) => (prev ? { ...prev, currentX: clampedX } : null));
    }

    setHoverDataX(unmapX(clampedX));
    setHoverSvgY(clampedY);
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    const coords = getSvgCoords(e.clientX, e.clientY);
    if (!coords) return;
    if (coords.x < margin.left || coords.x > margin.left + plotW) return;
    if (coords.y < margin.top || coords.y > margin.top + plotH) return;
    setDragSelection({ startX: coords.x, currentX: coords.x, startY: coords.y });
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
      } else if (peakPickingMode && dist < 8) {
        const clickDataX = unmapX(dragSelection.startX);
        const candidate = findPickCandidate(clickDataX, dragSelection.startY);
        if (candidate) {
          togglePickedPeakAt(candidate.trace, candidate.point.origIdx);
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

  const hoverPickCandidate = useMemo(() => {
    if (!peakPickingMode || hoverDataX === null) return null;
    return findPickCandidate(hoverDataX, hoverSvgY);
  }, [peakPickingMode, hoverDataX, hoverSvgY, traces, snapToLocalPeak, viewDomain]);

  // Resolve stored picked peak entries onto currently visible traces so X-unit & baseline changes update automatically
  const resolvedPickedPeaks = useMemo<ResolvedPickedPeak[]>(() => {
    const traceMap = new Map(traces.map((t) => [t.id, t]));
    const list: ResolvedPickedPeak[] = [];
    for (const entry of pickedPeaks) {
      const tr = traceMap.get(entry.sampleId);
      if (!tr) continue;
      const expectedSpecIdx = tr.id === activeSampleId ? spectrumIndex : 0;
      if (entry.spectrumIndex !== expectedSpecIdx) continue;
      const pt = tr.points.find((p) => p.origIdx === entry.origIdx);
      if (!pt) continue;
      list.push({ entry, trace: tr, point: pt });
    }
    list.sort((a, b) => a.point.x - b.point.x);
    return list;
  }, [pickedPeaks, traces, activeSampleId, spectrumIndex]);

  // Compute non-overlapping SVG label coordinates for visible picked peak annotations
  const pickedAnnotationsLayout = useMemo(() => {
    const visible = resolvedPickedPeaks.filter(
      (item) => item.point.x >= viewDomain.xMin && item.point.x <= viewDomain.xMax,
    );
    const xDecimals = effectiveUnit === 'electronVolt' ? 4 : 2;
    const placedBoxes: Array<{ left: number; right: number; top: number; bottom: number }> = [];

    return visible.map((item) => {
      const px = mapX(item.point.x);
      const py = mapY(item.point.y + getTraceYOffset(item.trace.id));
      const xLabel = item.trace.symbol
        ? `${item.point.x.toFixed(xDecimals)} ${item.trace.symbol}`
        : item.point.x.toFixed(xDecimals);
      const yLabel = normalizeOverlay
        ? `${item.point.y.toFixed(1)}%`
        : `${item.point.y.toLocaleString(undefined, { maximumFractionDigits: 1 })} cts`;
      const maxChars = Math.max(xLabel.length, yLabel.length);
      const boxW = Math.max(76, maxChars * 6.4 + 14);
      const boxH = 30;

      const minCenterX = margin.left + boxW / 2 + 4;
      const maxCenterX = margin.left + plotW - boxW / 2 - 4;
      let boxCenterX = Math.max(minCenterX, Math.min(maxCenterX, px));
      let boxTop = py - boxH - 14;
      let sideAnchor: 'bottom' | 'left' | 'right' | 'top' = 'bottom';

      // When a tall peak apex is near the top edge, place the annotation cleanly to the side so the apex stays unobstructed
      if (boxTop < margin.top + 4) {
        boxTop = Math.max(margin.top + 6, Math.min(margin.top + plotH - boxH - 4, py - boxH / 2 + 6));
        const rightCenter = px + boxW / 2 + 16;
        const leftCenter = px - boxW / 2 - 16;
        if (rightCenter <= maxCenterX) {
          boxCenterX = rightCenter;
          sideAnchor = 'left';
        } else {
          boxCenterX = Math.max(minCenterX, leftCenter);
          sideAnchor = 'right';
        }
      }

      const boxLeft = boxCenterX - boxW / 2;
      const boxRight = boxCenterX + boxW / 2;

      for (let attempt = 0; attempt < 6; attempt++) {
        const collides = placedBoxes.some(
          (b) => !(boxRight + 3 < b.left || boxLeft - 3 > b.right || boxTop + boxH + 3 < b.top || boxTop - 3 > b.bottom),
        );
        if (!collides) break;
        const shiftedUp = boxTop - (boxH + 5);
        if (shiftedUp >= margin.top + 4) {
          boxTop = shiftedUp;
        } else {
          const shiftedDown = boxTop + (boxH + 5);
          if (shiftedDown + boxH <= margin.top + plotH - 4) {
            boxTop = shiftedDown;
          } else {
            break;
          }
        }
      }

      placedBoxes.push({ left: boxLeft, right: boxRight, top: boxTop, bottom: boxTop + boxH });

      let leaderEndX = boxCenterX;
      let leaderEndY = boxTop + boxH;
      if (sideAnchor === 'left') {
        leaderEndX = boxLeft;
        leaderEndY = boxTop + boxH / 2;
      } else if (sideAnchor === 'right') {
        leaderEndX = boxRight;
        leaderEndY = boxTop + boxH / 2;
      } else if (boxTop > py) {
        leaderEndY = boxTop;
      }

      return {
        ...item,
        px,
        py,
        xLabel,
        yLabel,
        boxW,
        boxH,
        boxLeft,
        boxTop,
        boxCenterX,
        leaderEndX,
        leaderEndY,
      };
    });
  }, [
    resolvedPickedPeaks,
    viewDomain,
    effectiveUnit,
    isMultiOverlay,
    normalizeOverlay,
    isAutoOffsetActive,
    traceYOffsets,
    margin.left,
    margin.top,
    plotW,
    plotH,
  ]);

  const totalSpectra = Math.max(1, Math.floor(wdf.spectra.length / Math.max(1, wdf.header.pointsPerSpectrum)));

  // Project active integration window bounds into the currently displayed X-axis unit
  const shadedIntegrationRange = useMemo(() => {
    if (!integrationWindow || isMultiOverlay || !wdf.xAxis) return null;
    let x1 = integrationWindow.fromX;
    let x2 = integrationWindow.toX;

    if (integrationWindow.xListUnit !== null && effectiveUnit !== 'native') {
      const dummyAxis = {
        dataType: wdf.xAxis.dataType,
        dataTypeName: wdf.xAxis.dataTypeName,
        units: integrationWindow.xListUnit,
        unitsName: '',
        unitsSymbol: '',
        values: new Float32Array([x1, x2]),
      };
      const converted = convertXAxis(dummyAxis, wdf.header.laserWavenumber, effectiveUnit);
      x1 = converted.values[0];
      x2 = converted.values[1];
    } else if (
      integrationWindow.xListUnit !== null &&
      effectiveUnit === 'native' &&
      integrationWindow.xListUnit !== wdf.xAxis.units
    ) {
      const nativeTarget = wdfUnitToTargetUnit(wdf.xAxis.units);
      if (nativeTarget) {
        const dummyAxis = {
          dataType: wdf.xAxis.dataType,
          dataTypeName: wdf.xAxis.dataTypeName,
          units: integrationWindow.xListUnit,
          unitsName: '',
          unitsSymbol: '',
          values: new Float32Array([x1, x2]),
        };
        const converted = convertXAxis(dummyAxis, wdf.header.laserWavenumber, nativeTarget);
        x1 = converted.values[0];
        x2 = converted.values[1];
      }
    }

    const lo = Math.min(x1, x2);
    const hi = Math.max(x1, x2);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi <= lo) return null;
    if (hi < viewDomain.xMin || lo > viewDomain.xMax) return null;

    return {
      lo,
      hi,
      label: integrationWindow.label,
    };
  }, [integrationWindow, isMultiOverlay, wdf, effectiveUnit, viewDomain.xMin, viewDomain.xMax]);

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

  // Quantitative Statistics for the active spectrum over the current view domain
  const activeStats = useMemo(() => {
    if (!primaryTrace) return null;
    const primarySample = samples.find((s) => s.id === primaryTrace.id) ?? null;
    const activeWdf = primarySample?.wdf ?? wdf;

    const inView = primaryTrace.points.filter(
      (p) => p.x >= viewDomain.xMin && p.x <= viewDomain.xMax,
    );
    const pts = inView.length >= 3 ? inView : primaryTrace.points;
    if (pts.length === 0) return null;

    let minY = Infinity;
    let maxY = -Infinity;
    let sumY = 0;
    let peakPt = pts[0];

    for (let i = 0; i < pts.length; i++) {
      const p = pts[i];
      if (p.y < minY) minY = p.y;
      if (p.y > maxY) {
        maxY = p.y;
        peakPt = p;
      }
      sumY += p.y;
    }

    const meanY = sumY / pts.length;
    const yValues = pts.map((p) => p.y);
    const sortedY = [...yValues].sort((a, b) => a - b);
    const medianY = computeMedian(sortedY);

    // Lower quartile median approximates the baseline floor away from Raman bands
    const lowerQuartileCount = Math.max(1, Math.floor(sortedY.length * 0.25));
    const baselineFloor = baselineEnabled
      ? 0
      : computeMedian(sortedY.slice(0, lowerQuartileCount));

    // Robust high-frequency noise sigma via 2nd-order finite difference MAD:
    // d2[i] = (y[i+1] - 2*y[i] + y[i-1]) / sqrt(6) cancels constant & linear baseline drift
    const sqrt6 = Math.sqrt(6);
    const d2: number[] = [];
    for (let i = 1; i < pts.length - 1; i++) {
      d2.push((pts[i + 1].y - 2 * pts[i].y + pts[i - 1].y) / sqrt6);
    }
    let noiseSigma: number | null = null;
    if (d2.length >= 3) {
      const medD2 = computeMedian(d2);
      const absDev = d2.map((v) => Math.abs(v - medD2));
      const mad = computeMedian(absDev);
      const sigma = 1.4826 * mad;
      if (sigma > 0) {
        noiseSigma = sigma;
      }
    }
    if (noiseSigma === null && lowerQuartileCount >= 2) {
      const lowSlice = sortedY.slice(0, lowerQuartileCount);
      const lowMean = lowSlice.reduce((a, b) => a + b, 0) / lowSlice.length;
      const variance =
        lowSlice.reduce((acc, v) => acc + (v - lowMean) * (v - lowMean), 0) /
        Math.max(1, lowSlice.length - 1);
      const sd = Math.sqrt(variance);
      if (sd > 0) noiseSigma = sd;
    }

    const signalAmplitude = Math.max(0, maxY - baselineFloor);
    const snr = noiseSigma && noiseSigma > 0 ? signalAmplitude / noiseSigma : null;
    const snrDb = snr !== null && snr > 0 ? 20 * Math.log10(snr) : null;

    // Max intensity wavelength in nanometres (computed via convertXAxis regardless of displayed unit)
    let peakWavelengthNm: number | null = null;
    if (activeWdf.xAxis && peakPt.origIdx >= 0 && peakPt.origIdx < activeWdf.xAxis.values.length) {
      const nmAxis = convertXAxis(activeWdf.xAxis, activeWdf.header.laserWavenumber, 'nanometre');
      const val = nmAxis.values[peakPt.origIdx];
      if (Number.isFinite(val) && val > 0) {
        peakWavelengthNm = val;
      }
    }

    // Trapezoidal integrated area above baseline floor
    let integratedArea = 0;
    for (let i = 1; i < pts.length; i++) {
      const dx = Math.abs(pts[i].x - pts[i - 1].x);
      const avgHeight = 0.5 * (pts[i - 1].y + pts[i].y) - baselineFloor;
      integratedArea += avgHeight * dx;
    }

    // Dominant peak FWHM from detected local maxima
    const matchedPeak =
      primaryTrace.peaks.find((pk) => Math.abs(pk.x - peakPt.x) < 1e-3) ??
      primaryTrace.peaks[0] ??
      null;

    return {
      pointCount: pts.length,
      peakX: peakPt.x,
      peakY: maxY,
      peakWavelengthNm,
      minY,
      meanY,
      medianY,
      baselineFloor,
      dynamicRange: maxY - minY,
      noiseSigma,
      snr,
      snrDb,
      integratedArea,
      dominantFwhm: matchedPeak?.fwhm ?? null,
    };
  }, [primaryTrace, samples, wdf, viewDomain.xMin, viewDomain.xMax, baselineEnabled]);

  if (visibleSamples.length === 0) {
    return (
      <div className="p-6 max-w-[1400px]">
        <div className="bg-white border border-slate-200 rounded p-8 text-center space-y-3">
          <h1 className="text-base font-semibold text-slate-900">
            No spectra selected for plotting
          </h1>
          <p className="text-xs text-slate-500 max-w-md mx-auto">
            Tick a folder or individual file in <strong>Explorer</strong> on the left to plot one or more spectra.
          </p>
          {samples.length > 0 && (
            <button
              type="button"
              onClick={() => onSetAllVisible(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-xs font-medium cursor-pointer transition-colors"
            >
              Show All ({samples.length})
            </button>
          )}
        </div>
      </div>
    );
  }

  if (!primaryTrace) {
    return (
      <div className="p-6 text-sm text-slate-600">
        No spectral X-axis (XLST) block found in this file.
      </div>
    );
  }

  const displayFileName = stripWdfExtension(fileName);

  const yAxisTitle = normalizeOverlay
    ? isAutoOffsetActive
      ? 'Normalized Intensity (Auto-Offset, %)'
      : 'Normalized Intensity (%)'
    : baselineEnabled
      ? isAutoOffsetActive
        ? `Baseline-Corrected Intensity (Auto-Offset · ${wdf.header.spectralUnitsName})`
        : `Baseline-Corrected Intensity (${wdf.header.spectralUnitsName})`
      : isAutoOffsetActive
        ? `Intensity (Auto-Offset · ${wdf.header.spectralUnitsName})`
        : `Intensity (${wdf.header.spectralUnitsName})`;

  return (
    <div
      className={
        isFullscreen
          ? 'h-full flex flex-col px-1.5 py-1.5 sm:px-2 sm:py-2 space-y-1.5 max-w-none'
          : 'px-2.5 py-2.5 sm:px-3 sm:py-3 space-y-4 max-w-none'
      }
    >
      {/* Header & Controls Bar */}
      <div className={`space-y-2.5 border-b border-slate-200 ${isFullscreen ? 'pb-2 shrink-0' : 'pb-3'}`}>
        {!isFullscreen && (
          <div className="min-w-0">
            <h1 className="text-lg font-semibold text-slate-900 tracking-tight truncate">
              {isMultiOverlay
                ? `Overlay Comparison (${traces.length} spectra)`
                : primaryTrace.title || displayFileName}
            </h1>
            <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
              {isMultiOverlay ? (
                <>
                  Comparing {traces.map((t) => t.fileName).join(' · ')} · Axis: {primaryTrace.label}
                  {smoothEnabled ? ` · Denoised (${primaryTrace.smoothWindowSize ?? 15} pts)` : ''}
                  {baselineEnabled ? ` · AsLS Baseline (${baselineStrength})` : ''}
                  {isAutoOffsetActive ? ' · Auto-Offset (Stacked)' : ''}
                </>
              ) : (
                <>
                  {primaryTrace.fileName} · {primaryTrace.points.length.toLocaleString()} points ·{' '}
                  {wdf.summary.laserWavenumberCm1
                    ? `Laser ${wdf.summary.laserWavenumberCm1.toFixed(2)} cm⁻¹ (${wdf.summary.laserWavelengthNm?.toFixed(2)} nm)`
                    : 'Laser wavenumber not specified'}
                  {smoothEnabled ? ` · Denoised (${primaryTrace.smoothWindowSize ?? 15} pts)` : ''}
                  {baselineEnabled ? ` · AsLS Baseline (${baselineStrength})` : ''}
                </>
              )}
            </p>
          </div>
        )}

        {/* Unit Selector, Remove Noise, Baseline Correction, Overlay Mode, Plot Toggles & Fullscreen */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <div
              role="group"
              aria-label="X-axis spectral units"
              className="inline-flex flex-wrap rounded border border-slate-200 bg-slate-100/80 p-0.5"
            >
              {STANDARD_UNIT_OPTIONS.map((opt) => {
                const isNativeOption = sharedNativeUnit === opt.id;
                const active =
                  effectiveUnit === opt.id || (effectiveUnit === 'native' && isNativeOption);
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => onChangeTargetUnit(isNativeOption ? 'native' : opt.id)}
                    aria-pressed={active}
                    className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap transition-colors cursor-pointer ${
                      active
                        ? 'bg-white text-blue-600 border border-slate-200'
                        : 'text-slate-600 hover:text-slate-900 border border-transparent'
                    }`}
                  >
                    {isNativeOption ? `${opt.label} (Native)` : opt.label}
                  </button>
                );
              })}
              {!isMultiOverlay && sharedNativeUnit === null && (
                <button
                  type="button"
                  onClick={() => onChangeTargetUnit('native')}
                  aria-pressed={effectiveUnit === 'native'}
                  className={`px-2.5 py-1 text-xs font-medium rounded-sm whitespace-nowrap transition-colors cursor-pointer ${
                    effectiveUnit === 'native'
                      ? 'bg-white text-blue-600 border border-slate-200'
                      : 'text-slate-600 hover:text-slate-900 border border-transparent'
                  }`}
                >
                  {primaryTrace.label} (Native)
                </button>
              )}
            </div>

            {/* Remove Noise (Savitzky-Golay Smoothing) Toggle + Strength */}
            <button
              type="button"
              onClick={onToggleSmooth}
              aria-pressed={smoothEnabled}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                smoothEnabled
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Apply Savitzky-Golay smoothing to reduce high-frequency spectral noise while preserving peaks and steep edges"
            >
              <Waves className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Remove Noise</span>
            </button>

            {smoothEnabled && (
              <select
                aria-label="Noise removal strength"
                value={smoothStrength}
                onChange={(e) => onChangeSmoothStrength(e.target.value as SmoothStrength)}
                className="px-2 py-1.5 rounded border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
              >
                <option value="auto">
                  {primaryTrace.smoothWindowSize
                    ? `Auto (${primaryTrace.smoothWindowSize} pts)`
                    : 'Auto (Detected)'}
                </option>
                <option value="light">{MANUAL_SMOOTH_CONFIG.light.label}</option>
                <option value="medium">{MANUAL_SMOOTH_CONFIG.medium.label}</option>
                <option value="strong">{MANUAL_SMOOTH_CONFIG.strong.label}</option>
                <option value="veryStrong">{MANUAL_SMOOTH_CONFIG.veryStrong.label}</option>
              </select>
            )}

            {/* Auto-Baseline Toggle + Adaptive / Manual Mode */}
            <button
              type="button"
              onClick={onToggleBaseline}
              aria-pressed={baselineEnabled}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                baselineEnabled
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Automatically detect spectral background & fluorescence and adjust the baseline to reveal subtle Raman features"
            >
              <SlidersHorizontal className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Auto-Baseline</span>
            </button>

            {baselineEnabled && (
              <select
                aria-label="Baseline mode"
                value={baselineStrength}
                onChange={(e) => onChangeBaselineStrength(e.target.value as BaselineStrength)}
                className="px-2 py-1.5 rounded border border-slate-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-blue-600 cursor-pointer"
              >
                <option value="auto">
                  {primaryTrace.autoBaselineProfile
                    ? `Auto (${primaryTrace.autoBaselineProfile})`
                    : 'Auto (Detected)'}
                </option>
                <option value="gentle">Gentle (λ=10⁶)</option>
                <option value="standard">Standard (λ=10⁵)</option>
                <option value="aggressive">Aggressive (λ=10⁴)</option>
              </select>
            )}

            {/* Overlay Comparison Toggle */}
            <button
              type="button"
              onClick={() => onSetAllVisible(!allVisible && !isMultiOverlay)}
              disabled={samples.length < 2}
              aria-pressed={isMultiOverlay}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isMultiOverlay
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Overlay two or more loaded WDF spectra on the same chart"
            >
              <Layers className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{isMultiOverlay ? `Overlay (${traces.length})` : 'Overlay Mode'}</span>
            </button>

            {/* Auto-Offset Stacked Spectra Toggle */}
            <button
              type="button"
              onClick={handleToggleAutoOffset}
              disabled={samples.length < 2}
              aria-pressed={isAutoOffsetActive}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
                isAutoOffsetActive
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Vertically stack multiple selected spectra along the Y-axis so individual Raman features do not overlap"
            >
              <Rows3 className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Auto-Offset</span>
            </button>

            {/* Interactive Peak Picking Toggle */}
            <button
              type="button"
              onClick={() => setPeakPickingMode((prev) => !prev)}
              aria-pressed={peakPickingMode}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                peakPickingMode
                  ? 'bg-blue-600 border-blue-600 text-white'
                  : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
              }`}
              title="Click on the spectrum to annotate specific Raman peaks with their exact X position and intensity"
            >
              <Crosshair className="w-3.5 h-3.5" aria-hidden="true" />
              <span>
                {resolvedPickedPeaks.length > 0
                  ? `Peak Picking (${resolvedPickedPeaks.length})`
                  : 'Peak Picking'}
              </span>
            </button>

            {/* Data Arithmetic Modal Trigger */}
            {onCreateDerivedSample && (
              <button
                type="button"
                onClick={() => setArithmeticModalOpen(true)}
                disabled={samples.length === 0}
                className="inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border border-slate-200 bg-white text-slate-700 hover:bg-slate-50 hover:border-slate-300 text-xs font-medium whitespace-nowrap transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed"
                title="Apply mathematical expressions (+, −, ×, ÷) to 1 or 2 selected datasets"
              >
                <Calculator className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Data Arithmetic</span>
              </button>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {peakPickingMode && (
              <label
                className="inline-flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer whitespace-nowrap"
                title="Automatically snap clicks to the highest local peak near the cursor"
              >
                <input
                  type="checkbox"
                  checked={snapToLocalPeak}
                  onChange={(e) => setSnapToLocalPeak(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>Snap to peak</span>
              </label>
            )}

            {resolvedPickedPeaks.length > 0 && (
              <button
                type="button"
                onClick={clearVisiblePickedPeaks}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded border border-slate-300 bg-white hover:bg-slate-50 text-xs font-medium text-slate-700 cursor-pointer whitespace-nowrap"
                title="Remove all manually annotated peaks from the current view"
              >
                <Trash2 className="w-3 h-3" aria-hidden="true" />
                <span>Clear Picks ({resolvedPickedPeaks.length})</span>
              </button>
            )}

            {(baselineEnabled || smoothEnabled) && !isMultiOverlay && (
              <label className="inline-flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer whitespace-nowrap">
                <input
                  type="checkbox"
                  checked={showFittedBaseline}
                  onChange={(e) => setShowFittedBaseline(e.target.checked)}
                  className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
                />
                <span>{baselineEnabled ? 'Show raw & baseline' : 'Show raw trace'}</span>
              </label>
            )}

            {/* Adaptive Curve Fit Toggle Switch (default ON) + Fit Method Selector */}
            <div className="inline-flex items-center gap-1.5">
              <button
                type="button"
                role="switch"
                aria-checked={curveFitEnabled}
                onClick={() => setCurveFitEnabled((prev) => !prev)}
                className={`inline-flex items-center gap-2 px-2.5 py-1 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  curveFitEnabled
                    ? 'bg-orange-50 border-orange-300 text-orange-900 hover:bg-orange-100/80'
                    : 'bg-white border-slate-200 text-slate-700 hover:bg-slate-50 hover:border-slate-300'
                }`}
                title="Toggle adaptive sub-pixel peak curve fit overlay"
              >
                <span
                  aria-hidden="true"
                  className={`relative inline-flex h-4 w-7 shrink-0 items-center rounded-full transition-colors ${
                    curveFitEnabled ? 'bg-orange-600' : 'bg-slate-300'
                  }`}
                >
                  <span
                    className={`inline-block h-3 w-3 rounded-full bg-white shadow-xs transition-transform ${
                      curveFitEnabled ? 'translate-x-3.5' : 'translate-x-0.5'
                    }`}
                  />
                </span>
                <span>Curve Fit</span>
              </button>

              {curveFitEnabled && (
                <select
                  aria-label="Curve fit method"
                  data-testid="curve-fit-method-select"
                  value={curveFitMethod}
                  onChange={(e) => setCurveFitMethod(e.target.value as CurveFitMethod)}
                  className="px-2 py-1 rounded border border-orange-200 bg-white text-xs text-slate-700 focus:outline-none focus:border-orange-500 cursor-pointer"
                  title="Select curve fitting model (Auto adapts to peak FWHM)"
                >
                  {CURVE_FIT_METHOD_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label}
                    </option>
                  ))}
                </select>
              )}
            </div>

            <label
              className="inline-flex items-center gap-1.5 text-xs text-slate-700 select-none cursor-pointer whitespace-nowrap"
              title={
                curveFitEnabled
                  ? 'Normalize discrete data and fitted curve relative to fitted peak crest (100%)'
                  : 'Normalize intensity to 0–100%'
              }
            >
              <input
                type="checkbox"
                checked={normalizeOverlay}
                onChange={(e) => setNormalizeOverlay(e.target.checked)}
                className="rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <span>Normalize (%)</span>
            </label>

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

            {onToggleFullscreen && (
              <button
                type="button"
                onClick={onToggleFullscreen}
                aria-pressed={isFullscreen}
                title={isFullscreen ? 'Exit Fullscreen (Esc)' : 'Expand chart to cover the entire application area'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium whitespace-nowrap transition-colors cursor-pointer ${
                  isFullscreen
                    ? 'bg-slate-900 border-slate-900 text-white hover:bg-slate-800'
                    : 'bg-white border-slate-300 text-slate-700 hover:bg-slate-50 hover:border-slate-400'
                }`}
              >
                {isFullscreen ? (
                  <>
                    <Minimize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Exit Fullscreen</span>
                  </>
                ) : (
                  <>
                    <Maximize2 className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>Fullscreen</span>
                  </>
                )}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Main Spectrum Plot Card */}
      <div
        className={`bg-white border border-slate-200 rounded ${
          isFullscreen ? 'flex-1 flex flex-col min-h-0' : ''
        }`}
      >
        {/* Overlay Sample Selector Strip */}
        {isMultiOverlay && (
          <div className="px-4 py-2.5 bg-slate-50/90 border-b border-slate-200 flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
              <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500">
                Overlaid Spectra
              </span>
              {visibleSamples.map((sample) => {
                const cleanSampleName = stripWdfExtension(sample.fileName);
                return (
                  <div
                    key={sample.id}
                    className="inline-flex items-center gap-1.5 text-xs text-slate-800 select-none"
                  >
                    <input
                      type="checkbox"
                      checked={sample.visible}
                      aria-label={`Overlay ${cleanSampleName}`}
                      onChange={() => onToggleSampleVisible(sample.id)}
                      className="rounded border-slate-300 text-blue-600 focus:ring-blue-500 cursor-pointer"
                    />
                    <TraceColorPicker
                      color={sample.color}
                      fileName={cleanSampleName}
                      size="sm"
                      onChange={(newColor) => onChangeSampleColor(sample.id, newColor)}
                    />
                    <span
                      onClick={() => onToggleSampleVisible(sample.id)}
                      className="font-mono text-[11px] truncate max-w-[230px] cursor-pointer"
                      title={cleanSampleName}
                    >
                      {cleanSampleName}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Adaptive Curve Fit Readout Badge */}
        {curveFitEnabled && primaryCurveFit && (
          <div
            data-testid="curve-fit-badge"
            className="px-3 py-1.5 bg-orange-50/70 border-b border-orange-200/80 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5 text-xs"
          >
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 font-mono tabular-nums text-slate-800">
              <span
                data-testid="curve-fit-model-label"
                className="inline-flex items-center gap-1.5 font-sans font-semibold text-orange-900"
              >
                <span
                  className="w-2.5 h-0.5 inline-block rounded-full"
                  style={{ backgroundColor: getCurveFitStrokeColor(primaryTrace.color) }}
                  aria-hidden="true"
                />
                <span>
                  {primaryCurveFit.fit.isFallback
                    ? `${primaryCurveFit.fit.modelLabel} (Fallback)`
                    : primaryCurveFit.fit.modelLabel}
                </span>
              </span>

              <span title="Fitted sub-pixel peak position in pixels and active X-axis unit">
                <span className="text-slate-500 mr-1">x_peak:</span>
                <strong className="font-semibold text-slate-900">
                  {primaryCurveFit.fit.xPeak.toFixed(2)} px
                </strong>
                <span className="text-slate-600 ml-1.5">
                  ({primaryCurveFit.xPeakCalibrated.toFixed(effectiveUnit === 'electronVolt' ? 4 : 2)}
                  {primaryTrace.symbol ? ` ${primaryTrace.symbol}` : ''})
                </span>
              </span>

              <span title="Fitted peak intensity at x_peak (crest equals 100% when normalized)">
                <span className="text-slate-500 mr-1">Peak Intensity:</span>
                <strong className="font-semibold text-slate-900">
                  {normalizeOverlay
                    ? `${primaryCurveFit.yPeakDisplay.toFixed(1)}%`
                    : `${primaryCurveFit.yPeakDisplay.toLocaleString(undefined, { maximumFractionDigits: 1 })} ${wdf.header.spectralUnitsName.toLowerCase()}`}
                </strong>
              </span>

              <span title="Full Width at Half Maximum in detector pixels and calibrated X-axis units">
                <span className="text-slate-500 mr-1">FWHM:</span>
                <strong className="font-semibold text-orange-800">
                  {primaryCurveFit.fit.fwhm !== null
                    ? `${primaryCurveFit.fit.fwhm.toFixed(2)} px`
                    : '—'}
                </strong>
                {primaryCurveFit.fwhmCalibrated !== null && (
                  <span className="text-slate-600 ml-1.5">
                    ({primaryCurveFit.fwhmCalibrated.toFixed(effectiveUnit === 'electronVolt' ? 5 : 2)}
                    {primaryTrace.symbol ? ` ${primaryTrace.symbol}` : ''})
                  </span>
                )}
              </span>
            </div>

            {primaryCurveFit.zoomMaxX > primaryCurveFit.zoomMinX && (
              <button
                type="button"
                onClick={() => setZoomRange([primaryCurveFit.zoomMinX, primaryCurveFit.zoomMaxX])}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded border border-orange-300 bg-white/90 hover:bg-orange-100/70 text-[11px] font-sans font-medium text-orange-900 cursor-pointer whitespace-nowrap transition-colors"
                title="Zoom X-axis onto the fitted peak region to inspect sub-pixel alignment to baseline"
              >
                <ZoomIn className="w-3 h-3" aria-hidden="true" />
                <span>Zoom to Fit</span>
              </button>
            )}
          </div>
        )}

        {/* Live Crosshair Readout Bar */}
        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
          <div className="font-mono tabular-nums text-slate-700 flex flex-wrap items-center gap-x-5 gap-y-1">
            {peakPickingMode && hoverPickCandidate ? (
              <>
                <span className="font-sans font-medium text-blue-700">Click to annotate:</span>
                <span>
                  <span className="text-slate-500 mr-1.5">{primaryTrace.label}:</span>
                  <strong className="font-semibold text-slate-900">
                    {hoverPickCandidate.point.x.toFixed(effectiveUnit === 'electronVolt' ? 4 : 2)}{' '}
                    {primaryTrace.symbol}
                  </strong>
                </span>
                <span>
                  <span className="text-slate-500 mr-1.5">
                    {baselineEnabled ? 'Corrected:' : 'Intensity:'}
                  </span>
                  <strong className="font-semibold text-slate-900">
                    {normalizeOverlay
                      ? `${hoverPickCandidate.point.y.toFixed(1)}%`
                      : `${hoverPickCandidate.point.y.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${wdf.header.spectralUnitsName.toLowerCase()}`}
                  </strong>
                </span>
                {isMultiOverlay && (
                  <span className="inline-flex items-center gap-1.5 text-slate-600">
                    <span
                      className="w-2 h-2 rounded-xs shrink-0 inline-block"
                      style={{ backgroundColor: hoverPickCandidate.trace.color }}
                    />
                    <span className="truncate max-w-[140px]">{hoverPickCandidate.trace.fileName}</span>
                  </span>
                )}
              </>
            ) : hoveredMatches.length > 0 ? (
              isMultiOverlay ? (
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
                      {baselineEnabled ? 'Corrected:' : smoothEnabled ? 'Smoothed:' : 'Intensity:'}
                    </span>
                    <strong className="font-semibold text-slate-900">
                      {normalizeOverlay
                        ? `${hoveredMatches[0].point.y.toFixed(1)}%`
                        : `${hoveredMatches[0].point.y.toLocaleString(undefined, { maximumFractionDigits: 2 })} ${wdf.header.spectralUnitsName.toLowerCase()}`}
                    </strong>
                  </span>
                  {smoothEnabled && !baselineEnabled && (
                    <span className="text-slate-500">
                      Raw:{' '}
                      <span className="text-slate-700 font-medium">
                        {hoveredMatches[0].point.rawY.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                      </span>
                    </span>
                  )}
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
            ) : peakPickingMode ? (
              <span className="text-blue-700 font-sans font-medium">
                Peak Picking active · Click anywhere on the spectrum to annotate a peak · Click a label to remove · Drag to zoom
              </span>
            ) : (
              <span className="text-slate-500">
                Hover plot to inspect exact coordinates · Drag horizontally across plot to zoom X range
              </span>
            )}
          </div>

          <div className="flex items-center gap-4 text-[11px] font-mono">
            {(baselineEnabled || smoothEnabled) && !isMultiOverlay && showFittedBaseline && (
              <div className="flex items-center gap-3 text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: primaryTrace.color }} />
                  <span>{baselineEnabled ? 'Corrected' : 'Smoothed'}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-0.5 bg-slate-400 inline-block" />
                  <span>Raw</span>
                </span>
                {baselineEnabled && (
                  <span className="inline-flex items-center gap-1">
                    <span className="w-3 h-0.5 border-t border-dashed border-amber-600 inline-block" />
                    <span>AsLS Baseline</span>
                  </span>
                )}
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
        <div
          className={
            isFullscreen
              ? 'flex-1 min-h-0 p-1 flex flex-col'
              : 'p-1'
          }
        >
          <div
            ref={plotAreaRef}
            className={
              isFullscreen
                ? 'relative flex-1 min-h-0 w-full overflow-hidden'
                : 'relative w-full'
            }
          >
            {zoomRange && (
              <button
                type="button"
                data-floating-reset-zoom="true"
                onPointerDown={(e) => e.stopPropagation()}
                onPointerUp={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  setZoomRange(null);
                }}
                style={{ top: margin.top + 8, right: margin.right + 10 }}
                className="absolute z-10 inline-flex items-center gap-1.5 px-2.5 py-1 rounded border border-slate-300 bg-white/95 hover:bg-slate-50 text-xs font-medium text-slate-700 shadow-xs cursor-pointer whitespace-nowrap transition-colors"
                title="Reset X-axis zoom to full spectral range"
              >
                <RotateCcw className="w-3 h-3" aria-hidden="true" />
                <span>Reset Zoom</span>
              </button>
            )}

            <svg
              ref={svgRef}
              width={isFullscreen ? undefined : chartWidth}
              height={isFullscreen ? undefined : chartHeight}
              viewBox={`0 0 ${chartWidth} ${chartHeight}`}
              preserveAspectRatio="none"
              className={
                isFullscreen
                  ? 'absolute inset-0 w-full h-full select-none cursor-crosshair block'
                  : 'w-full h-auto select-none cursor-crosshair block'
              }
              role="img"
              aria-label={
                isMultiOverlay
                  ? `Overlaid Raman spectra plot comparing ${traces.length} files`
                  : `Raman spectrum plot of ${primaryTrace.title || displayFileName}`
              }
              onPointerMove={handlePointerMove}
              onPointerDown={handlePointerDown}
              onPointerUp={handlePointerUp}
              onPointerLeave={() => {
                setHoverDataX(null);
                setHoverSvgY(null);
                setDragSelection(null);
              }}
            >
              <defs>
                <linearGradient id="spectrumFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={primaryTrace.color} stopOpacity="0.14" />
                  <stop offset="100%" stopColor={primaryTrace.color} stopOpacity="0.01" />
                </linearGradient>
                <clipPath id="plotClip">
                  <rect x={margin.left} y={margin.top} width={plotW} height={plotH} />
                </clipPath>
              </defs>

              {/* Plot Background */}
              <rect
                x={margin.left}
                y={margin.top}
                width={plotW}
                height={plotH}
                fill="#FFFFFF"
                stroke="#E2E8F0"
                strokeWidth="1"
              />

              {/* Horizontal Gridlines & Y Ticks */}
              {yTicks.map((tick) => {
                const py = mapY(tick);
                if (py < margin.top - 1 || py > margin.top + plotH + 1) return null;
                return (
                  <g key={`y-${tick}`}>
                    <line
                      x1={margin.left}
                      y1={py}
                      x2={margin.left + plotW}
                      y2={py}
                      stroke="#F1F5F9"
                      strokeWidth="1"
                    />
                    <line
                      x1={margin.left - 4}
                      y1={py}
                      x2={margin.left}
                      y2={py}
                      stroke="#94A3B8"
                      strokeWidth="1"
                    />
                    <text
                      x={margin.left - 7}
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
                if (px < margin.left - 1 || px > margin.left + plotW + 1) return null;
                const nearRightEdge = px > margin.left + plotW - 24;
                const nearLeftEdge = px < margin.left + 24;
                const textAnchor = nearRightEdge ? 'end' : nearLeftEdge ? 'start' : 'middle';
                const textX = nearRightEdge
                  ? Math.min(px, margin.left + plotW)
                  : nearLeftEdge
                    ? Math.max(px, margin.left)
                    : px;
                return (
                  <g key={`x-${tick}`}>
                    <line
                      x1={px}
                      y1={margin.top}
                      x2={px}
                      y2={margin.top + plotH}
                      stroke="#F1F5F9"
                      strokeWidth="1"
                    />
                    <line
                      x1={px}
                      y1={margin.top + plotH}
                      x2={px}
                      y2={margin.top + plotH + 4}
                      stroke="#94A3B8"
                      strokeWidth="1"
                    />
                    <text
                      x={textX}
                      y={margin.top + plotH + 16}
                      textAnchor={textAnchor}
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
                {/* Shaded Integration Window (when viewing a multi-scan MAP / Area Under Curve) */}
                {shadedIntegrationRange && (() => {
                  const xLeft = mapX(shadedIntegrationRange.lo);
                  const xRight = mapX(shadedIntegrationRange.hi);
                  const boxX = Math.min(xLeft, xRight);
                  const boxW = Math.max(1, Math.abs(xRight - xLeft));
                  return (
                    <g data-testid="integration-window-band" pointerEvents="none">
                      <rect
                        x={boxX}
                        y={margin.top}
                        width={boxW}
                        height={plotH}
                        fill="#2563EB"
                        fillOpacity="0.07"
                      />
                      <line
                        x1={xLeft}
                        y1={margin.top}
                        x2={xLeft}
                        y2={margin.top + plotH}
                        stroke="#2563EB"
                        strokeOpacity="0.45"
                        strokeWidth="1"
                        strokeDasharray="4 3"
                      />
                      <line
                        x1={xRight}
                        y1={margin.top}
                        x2={xRight}
                        y2={margin.top + plotH}
                        stroke="#2563EB"
                        strokeOpacity="0.45"
                        strokeWidth="1"
                        strokeDasharray="4 3"
                      />
                      {(() => {
                        const labelText = `Map: ${shadedIntegrationRange.label}`;
                        const approxW = labelText.length * 6.2 + 8;
                        const fitsRight = boxX + boxW + 6 + approxW <= margin.left + plotW - 4;
                        const fitsLeft = boxX - 6 - approxW >= margin.left + 4;
                        const labelX = fitsRight
                          ? boxX + boxW + 6
                          : fitsLeft
                            ? boxX - 6
                            : boxX + boxW / 2;
                        const anchor = fitsRight ? 'start' : fitsLeft ? 'end' : 'middle';
                        const labelY = fitsRight || fitsLeft ? margin.top + 14 : margin.top + plotH - 6;
                        return (
                          <text
                            x={labelX}
                            y={labelY}
                            textAnchor={anchor}
                            fontSize="10"
                            fontFamily="IBM Plex Mono, monospace"
                            fontWeight="500"
                            fill="#1D4ED8"
                            stroke="#FFFFFF"
                            strokeWidth="3"
                            paintOrder="stroke"
                          >
                            {labelText}
                          </text>
                        );
                      })()}
                    </g>
                  );
                })()}

                {/* Zero reference line when baseline correction is active */}
                {baselineEnabled && viewDomain.yMin < 0 && viewDomain.yMax > 0 && (
                  <line
                    x1={margin.left}
                    y1={mapY(0)}
                    x2={margin.left + plotW}
                    y2={mapY(0)}
                    stroke="#CBD5E1"
                    strokeWidth="1"
                  />
                )}

                {/* Stacked Lane Baseline Guides & Inline Labels (Auto-Offset mode) */}
                {isAutoOffsetActive &&
                  traces.map((tr) => {
                    const guideY = traceBaselineGuides.get(tr.id);
                    if (guideY === undefined) return null;
                    const py = mapY(guideY);
                    const xSpan = Math.max(1e-9, viewDomain.xMax - viewDomain.xMin);
                    const leftGap = Math.max(0, tr.minX - viewDomain.xMin) / xSpan;
                    const rightGap = Math.max(0, viewDomain.xMax - tr.maxX) / xSpan;
                    let placeOnLeft = leftGap > rightGap + 0.03;
                    if (Math.abs(leftGap - rightGap) <= 0.03) {
                      const leftCut = viewDomain.xMin + xSpan * 0.25;
                      const rightCut = viewDomain.xMax - xSpan * 0.25;
                      let leftPeak = -Infinity;
                      let rightPeak = -Infinity;
                      for (let i = 0; i < tr.points.length; i++) {
                        const pt = tr.points[i];
                        if (pt.x >= viewDomain.xMin && pt.x <= leftCut && pt.y > leftPeak) leftPeak = pt.y;
                        if (pt.x >= rightCut && pt.x <= viewDomain.xMax && pt.y > rightPeak) rightPeak = pt.y;
                      }
                      placeOnLeft = leftPeak < rightPeak;
                    }
                    return (
                      <g key={`offset-lane-${tr.id}`} data-offset-lane={tr.id} pointerEvents="none">
                        <line
                          x1={margin.left}
                          y1={py}
                          x2={margin.left + plotW}
                          y2={py}
                          stroke={tr.color}
                          strokeWidth="1"
                          strokeOpacity="0.22"
                          strokeDasharray="4 4"
                        />
                        <text
                          x={placeOnLeft ? margin.left + 8 : margin.left + plotW - 8}
                          y={Math.max(margin.top + 12, py - 5)}
                          textAnchor={placeOnLeft ? 'start' : 'end'}
                          fontSize="10"
                          fontFamily="IBM Plex Mono, monospace"
                          fontWeight="600"
                          fill={tr.color}
                          stroke="#FFFFFF"
                          strokeWidth="3"
                          paintOrder="stroke"
                        >
                          {tr.fileName}
                        </text>
                      </g>
                    );
                  })}

                {/* Traces */}
                {tracePaths.map(({ trace, mainD, rawD, baseD, areaD, fitD, fitOverlay, yOffset }) => (
                  <g key={trace.id} data-trace-id={trace.id}>
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
                        strokeWidth={isMultiOverlay ? '1.6' : '1.5'}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    )}

                    {/* Adaptive Curve Fit Overlay & Sub-Pixel Peak Marker */}
                    {curveFitEnabled && fitOverlay && (
                      <g data-curve-fit-group={trace.id}>
                        <title>
                          {`${fitOverlay.fit.fit.modelLabel} (${trace.fileName}): x_peak = ${fitOverlay.fit.fit.xPeak.toFixed(2)} px (${fitOverlay.fit.xPeakCalibrated.toFixed(effectiveUnit === 'electronVolt' ? 4 : 2)}${trace.symbol ? ` ${trace.symbol}` : ''}), Intensity = ${
                            normalizeOverlay
                              ? `${fitOverlay.fit.yPeakDisplay.toFixed(1)}%`
                              : fitOverlay.fit.yPeakDisplay.toLocaleString(undefined, { maximumFractionDigits: 1 })
                          }, FWHM = ${
                            fitOverlay.fit.fit.fwhm !== null
                              ? `${fitOverlay.fit.fit.fwhm.toFixed(2)} px${
                                  fitOverlay.fit.fwhmCalibrated !== null
                                    ? ` (${fitOverlay.fit.fwhmCalibrated.toFixed(effectiveUnit === 'electronVolt' ? 5 : 2)}${trace.symbol ? ` ${trace.symbol}` : ''})`
                                    : ''
                                }`
                              : 'fallback'
                          }`}
                        </title>

                        {/* Vertical dashed peak center marker at xPeak */}
                        <line
                          data-curve-fit-marker={trace.id}
                          x1={fitOverlay.markerX}
                          y1={margin.top}
                          x2={fitOverlay.markerX}
                          y2={margin.top + plotH}
                          stroke={fitOverlay.color}
                          strokeWidth="1.25"
                          strokeOpacity="0.78"
                          strokeDasharray="4 3"
                          pointerEvents="none"
                        />

                        {/* Discrete fit-window pixel sample dots when zoomed close enough to distinguish pixels */}
                        {fitOverlay.showWindowDots &&
                          fitOverlay.fit.windowPoints.map((wp) => (
                            <circle
                              key={`fit-px-${wp.pixel}`}
                              cx={mapX(wp.x)}
                              cy={mapY(wp.y + yOffset)}
                              r="3"
                              fill="#FFFFFF"
                              stroke={trace.color}
                              strokeWidth="1.5"
                              pointerEvents="none"
                            />
                          ))}

                        {/* Smooth 0.05-pixel sampled fitted curve spanning down to baseline */}
                        {fitD && (
                          <path
                            data-curve-fit-path={trace.id}
                            d={fitD}
                            fill="none"
                            stroke={fitOverlay.color}
                            strokeWidth="2.2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            pointerEvents="none"
                          />
                        )}

                        {/* Sub-pixel peak crest crosshair marker at (xPeak, yPeak) */}
                        <line
                          x1={fitOverlay.markerX - 6}
                          y1={fitOverlay.apexY}
                          x2={fitOverlay.markerX + 6}
                          y2={fitOverlay.apexY}
                          stroke={fitOverlay.color}
                          strokeWidth="1.5"
                          pointerEvents="none"
                        />
                        <circle
                          cx={fitOverlay.markerX}
                          cy={fitOverlay.apexY}
                          r="3.5"
                          fill={fitOverlay.color}
                          stroke="#FFFFFF"
                          strokeWidth="1.4"
                        />
                      </g>
                    )}
                  </g>
                ))}

                {/* Drag-to-Zoom Selection Overlay */}
                {dragSelection && Math.abs(dragSelection.currentX - dragSelection.startX) > 4 && (
                  <rect
                    x={Math.min(dragSelection.startX, dragSelection.currentX)}
                    y={margin.top}
                    width={Math.abs(dragSelection.currentX - dragSelection.startX)}
                    height={plotH}
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
                        const py = mapY(pk.intensity + getTraceYOffset(tr.id));
                        // Suppress simple auto-label when user has already placed a detailed annotation on this peak
                        const coveredByPicked = pickedAnnotationsLayout.some(
                          (ann) => ann.trace.id === tr.id && Math.abs(ann.px - px) < 22,
                        );
                        if (coveredByPicked) return null;
                        const labelY = Math.max(margin.top + 14, py - 10);
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
                              fill={isMultiOverlay ? tr.color : '#0F172A'}
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

                {/* User-Picked Peak Annotations */}
                {pickedAnnotationsLayout.map((ann) => (
                  <g
                    key={ann.entry.id}
                    data-picked-peak={ann.entry.id}
                    className="cursor-pointer"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      removePickedPeak(ann.entry.id);
                    }}
                  >
                    <title>{`Annotated peak: ${ann.xLabel} (${ann.yLabel}) — Click label to remove`}</title>
                    <line
                      x1={ann.px}
                      y1={ann.py}
                      x2={ann.leaderEndX}
                      y2={ann.leaderEndY}
                      stroke={ann.trace.color}
                      strokeWidth="1.25"
                      strokeDasharray="3 2"
                    />
                    <circle
                      cx={ann.px}
                      cy={ann.py}
                      r="4.2"
                      fill={ann.trace.color}
                      stroke="#FFFFFF"
                      strokeWidth="1.6"
                    />
                    <rect
                      x={ann.boxLeft}
                      y={ann.boxTop}
                      width={ann.boxW}
                      height={ann.boxH}
                      rx="3"
                      fill="#FFFFFF"
                      fillOpacity="0.96"
                      stroke={ann.trace.color}
                      strokeWidth="1.2"
                    />
                    <text
                      x={ann.boxCenterX}
                      y={ann.boxTop + 12}
                      textAnchor="middle"
                      fontSize="10"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="600"
                      fill="#0F172A"
                    >
                      {ann.xLabel}
                    </text>
                    <text
                      x={ann.boxCenterX}
                      y={ann.boxTop + 24}
                      textAnchor="middle"
                      fontSize="9.5"
                      fontFamily="IBM Plex Mono, monospace"
                      fontWeight="500"
                      fill="#475569"
                    >
                      {ann.yLabel}
                    </text>
                  </g>
                ))}

                {/* Crosshair Lines & Snap Dots */}
                {hoverDataX !== null && hoveredMatches.length > 0 && (
                  <g pointerEvents="none">
                    <line
                      x1={mapX(
                        peakPickingMode && hoverPickCandidate
                          ? hoverPickCandidate.point.x
                          : isMultiOverlay
                            ? hoverDataX
                            : hoveredMatches[0].point.x,
                      )}
                      y1={margin.top}
                      x2={mapX(
                        peakPickingMode && hoverPickCandidate
                          ? hoverPickCandidate.point.x
                          : isMultiOverlay
                            ? hoverDataX
                            : hoveredMatches[0].point.x,
                      )}
                      y2={margin.top + plotH}
                      stroke={peakPickingMode ? '#2563EB' : '#64748B'}
                      strokeWidth="1"
                      strokeDasharray="3 3"
                    />
                    {(!isMultiOverlay || (peakPickingMode && hoverPickCandidate)) && (
                      <line
                        x1={margin.left}
                        y1={mapY(
                          peakPickingMode && hoverPickCandidate
                            ? hoverPickCandidate.point.y + getTraceYOffset(hoverPickCandidate.trace.id)
                            : hoveredMatches[0].point.y + getTraceYOffset(hoveredMatches[0].trace.id),
                        )}
                        x2={margin.left + plotW}
                        y2={mapY(
                          peakPickingMode && hoverPickCandidate
                            ? hoverPickCandidate.point.y + getTraceYOffset(hoverPickCandidate.trace.id)
                            : hoveredMatches[0].point.y + getTraceYOffset(hoveredMatches[0].trace.id),
                        )}
                        stroke={peakPickingMode ? '#2563EB' : '#64748B'}
                        strokeWidth="1"
                        strokeDasharray="3 3"
                      />
                    )}
                    {peakPickingMode && hoverPickCandidate ? (
                      <g>
                        <circle
                          cx={mapX(hoverPickCandidate.point.x)}
                          cy={mapY(hoverPickCandidate.point.y + getTraceYOffset(hoverPickCandidate.trace.id))}
                          r="7"
                          fill="none"
                          stroke={hoverPickCandidate.trace.color}
                          strokeWidth="1.5"
                          strokeDasharray="2 2"
                        />
                        <circle
                          cx={mapX(hoverPickCandidate.point.x)}
                          cy={mapY(hoverPickCandidate.point.y + getTraceYOffset(hoverPickCandidate.trace.id))}
                          r="3.5"
                          fill={hoverPickCandidate.trace.color}
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      </g>
                    ) : (
                      hoveredMatches.map(({ trace, point }) => (
                        <circle
                          key={`snap-${trace.id}`}
                          cx={mapX(point.x)}
                          cy={mapY(point.y + getTraceYOffset(trace.id))}
                          r="4"
                          fill={trace.color}
                          stroke="#FFFFFF"
                          strokeWidth="1.5"
                        />
                      ))
                    )}
                  </g>
                )}
              </g>

              {/* Axis Titles */}
              <text
                x={margin.left + plotW / 2}
                y={chartHeight - 5}
                textAnchor="middle"
                fontSize="12"
                fontWeight="500"
                fill="#334155"
              >
                {primaryTrace.label} {primaryTrace.symbol ? `(${primaryTrace.symbol})` : ''}
              </text>
              <text
                x={12}
                y={margin.top + plotH / 2}
                textAnchor="middle"
                fontSize="12"
                fontWeight="500"
                fill="#334155"
                transform={`rotate(-90, 12, ${margin.top + plotH / 2})`}
              >
                {yAxisTitle}
              </text>
            </svg>
          </div>
        </div>
      </div>

      {/* Scan Integration / Map Plot (multi-scan series or embedded Renishaw MAP block) */}
      {!isFullscreen && !isMultiOverlay && (wdf.maps.length > 0 || totalSpectra > 1) && (
        <ScanMapChart
          wdf={wdf}
          fileName={fileName}
          traceColor={primaryTrace.color}
          spectrumIndex={spectrumIndex}
          totalSpectra={totalSpectra}
          targetUnit={effectiveUnit}
          onSelectSpectrum={setSpectrumIndex}
          onIntegrationWindowChange={setIntegrationWindow}
        />
      )}

      {/* Multi-Spectrum Scrubber (single-file series / map) */}
      {!isMultiOverlay && totalSpectra > 1 && (
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

      {/* Statistics Panel & Detected Peaks (hidden during Fullscreen chart mode) */}
      {!isFullscreen && (
        <>
          {activeStats && (
            <section
              aria-label="Statistics"
              className="bg-white border border-slate-200 rounded overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Statistics
                  </h2>
                  <span className="inline-flex items-center gap-1.5 text-[11px] font-mono text-slate-600 truncate">
                    <span
                      className="w-2 h-2 rounded-xs shrink-0 inline-block"
                      style={{ backgroundColor: primaryTrace.color }}
                    />
                    <span className="truncate">{primaryTrace.fileName}</span>
                  </span>
                </div>
                <span className="text-[11px] font-mono tabular-nums text-slate-500">
                  {zoomRange ? 'Zoomed range' : 'Full range'} · {activeStats.pointCount.toLocaleString()} pts
                  {baselineEnabled ? ` · AsLS (${baselineStrength})` : ''}
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-b border-slate-200">
                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Peak Position
                  </div>
                  <div
                    className="mt-1 text-sm font-mono font-semibold tabular-nums"
                    style={{ color: primaryTrace.color }}
                  >
                    {activeStats.peakX.toFixed(2)} {primaryTrace.symbol}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                    Active axis ({primaryTrace.label})
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Peak Wavelength
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
                    {activeStats.peakWavelengthNm !== null
                      ? `${activeStats.peakWavelengthNm.toFixed(2)} nm`
                      : '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                    Max intensity wavelength
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Signal-to-Noise (Est.)
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
                    {activeStats.snr !== null
                      ? `${activeStats.snr >= 100 ? Math.round(activeStats.snr).toLocaleString() : activeStats.snr.toFixed(1)} : 1`
                      : '—'}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                    {activeStats.snrDb !== null && activeStats.noiseSigma !== null
                      ? `${activeStats.snrDb.toFixed(1)} dB · σ = ${activeStats.noiseSigma.toFixed(1)}`
                      : '2nd-diff MAD estimate'}
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Peak Intensity
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
                    {normalizeOverlay
                      ? `${activeStats.peakY.toFixed(1)}%`
                      : activeStats.peakY.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                    Range:{' '}
                    {normalizeOverlay
                      ? `${activeStats.dynamicRange.toFixed(1)}%`
                      : activeStats.dynamicRange.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Dominant FWHM
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
                    {activeStats.dominantFwhm !== null
                      ? `${activeStats.dominantFwhm.toFixed(effectiveUnit === 'electronVolt' ? 5 : 2)} ${primaryTrace.symbol}`
                      : '—'}
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Baseline / Mean
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
                    {(() => {
                      const fmt = (v: number) => {
                        const s = v.toFixed(1);
                        return s === '-0.0' ? '0.0' : s;
                      };
                      const suffix = normalizeOverlay ? '%' : '';
                      return `${fmt(activeStats.baselineFloor)}${suffix} / ${fmt(activeStats.meanY)}${suffix}`;
                    })()}
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    Integrated Area
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
                    {formatCompactArea(activeStats.integratedArea)}
                  </div>
                </div>

                <div className="p-3.5">
                  <div className="text-[11px] font-medium text-slate-500 uppercase tracking-wider">
                    X Range
                  </div>
                  <div className="mt-1 text-sm font-mono font-semibold tabular-nums text-slate-900">
                    {viewDomain.xMin.toFixed(1)} – {viewDomain.xMax.toFixed(1)}
                  </div>
                </div>
              </div>
            </section>
          )}

          {/* User-Annotated Peaks Table (shown whenever peaks are picked) */}
          {resolvedPickedPeaks.length > 0 && (
            <section
              aria-label="Annotated Peaks"
              className="bg-white border border-slate-200 rounded overflow-hidden"
            >
              <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider">
                    Annotated Peaks ({resolvedPickedPeaks.length})
                  </h2>
                  <span className="text-[11px] font-mono text-slate-500">
                    {primaryTrace.label} ({primaryTrace.symbol || 'a.u.'})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={clearVisiblePickedPeaks}
                  className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-600 cursor-pointer transition-colors"
                >
                  <Trash2 className="w-3 h-3" aria-hidden="true" />
                  <span>Clear All</span>
                </button>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-xs text-left border-collapse">
                  <thead>
                    <tr className="border-b border-slate-200 text-slate-500 bg-white">
                      <th className="py-2 px-4 font-medium">#</th>
                      {isMultiOverlay && <th className="py-2 px-4 font-medium">Sample</th>}
                      <th className="py-2 px-4 font-medium">Position ({primaryTrace.symbol || 'X'})</th>
                      <th className="py-2 px-4 font-medium text-right">
                        {normalizeOverlay
                          ? 'Intensity (%)'
                          : `Intensity (${wdf.header.spectralUnitsName})`}
                      </th>
                      <th className="py-2 px-4 font-medium text-right">Pixel Index</th>
                      <th className="py-2 px-4 font-medium text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100 font-mono tabular-nums">
                    {resolvedPickedPeaks.map(({ entry, trace, point }, idx) => (
                      <tr key={entry.id} className="hover:bg-slate-50">
                        <td className="py-2 px-4 text-slate-500">P{idx + 1}</td>
                        {isMultiOverlay && (
                          <td className="py-2 px-4 font-sans text-slate-800">
                            <span className="inline-flex items-center gap-1.5">
                              <span
                                className="w-2.5 h-2.5 rounded-xs shrink-0 inline-block"
                                style={{ backgroundColor: trace.color }}
                              />
                              <span className="truncate max-w-[190px]">{trace.fileName}</span>
                            </span>
                          </td>
                        )}
                        <td className="py-2 px-4 font-semibold" style={{ color: trace.color }}>
                          {point.x.toFixed(effectiveUnit === 'electronVolt' ? 4 : 2)}
                        </td>
                        <td className="py-2 px-4 text-right text-slate-900">
                          {normalizeOverlay
                            ? `${point.y.toFixed(1)}%`
                            : point.y.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                        </td>
                        <td className="py-2 px-4 text-right text-slate-500">{point.origIdx}</td>
                        <td className="py-2 px-4 text-right">
                          <button
                            type="button"
                            onClick={() => removePickedPeak(entry.id)}
                            aria-label={`Remove annotated peak at ${point.x.toFixed(2)}`}
                            className="inline-flex items-center justify-center p-1 rounded text-slate-400 hover:text-rose-600 hover:bg-rose-50 cursor-pointer transition-colors"
                          >
                            <X className="w-3.5 h-3.5" aria-hidden="true" />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Detected Peaks Table + Optional White-Light Image */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        <div className={`${whiteLightUrl && !isMultiOverlay ? 'lg:col-span-2' : 'lg:col-span-3'} bg-white border border-slate-200 rounded`}>
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
                    {isMultiOverlay && <th className="py-2 px-4 font-medium">Sample</th>}
                    <th className="py-2 px-4 font-medium">Position ({primaryTrace.symbol || 'X'})</th>
                    <th
                      className="py-2 px-4 font-medium text-right"
                      title="Full Width at Half Maximum (line width at 50% of peak intensity)"
                    >
                      FWHM ({primaryTrace.symbol || 'X'})
                    </th>
                    <th className="py-2 px-4 font-medium text-right">
                      {normalizeOverlay
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
                      {isMultiOverlay && (
                        <td className="py-2 px-4 font-sans text-slate-800">
                          <span className="inline-flex items-center gap-1.5">
                            <span
                              className="w-2.5 h-2.5 rounded-xs shrink-0 inline-block"
                              style={{ backgroundColor: trace.color }}
                            />
                            <span className="truncate max-w-[190px]">{trace.fileName}</span>
                          </span>
                        </td>
                      )}
                      <td className="py-2 px-4 font-semibold text-slate-900">{pk.x.toFixed(2)}</td>
                      <td className="py-2 px-4 text-right font-medium" style={{ color: trace.color }}>
                        {pk.fwhm !== null
                          ? pk.fwhm.toFixed(effectiveUnit === 'electronVolt' ? 5 : 2)
                          : '—'}
                      </td>
                      <td className="py-2 px-4 text-right text-slate-800">
                        {normalizeOverlay
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

        {whiteLightUrl && !isMultiOverlay && wdf.whiteLightImage && (
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
        </>
      )}

      {arithmeticModalOpen && onCreateDerivedSample && (
        <DataArithmeticModal
          samples={samples}
          activeSampleId={activeSampleId}
          onClose={() => setArithmeticModalOpen(false)}
          onCreateSample={onCreateDerivedSample}
        />
      )}
    </div>
  );
}
