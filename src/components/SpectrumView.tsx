import { useEffect, useMemo, useRef, useState } from 'react';
import { Layers, Maximize2, Minimize2, RotateCcw, SlidersHorizontal } from 'lucide-react';
import {
  autoSubtractBaseline,
  convertXAxis,
  detectPeaks,
  getSpectrum,
  subtractBaseline,
  type AutoBaselineResult,
  type SpectralTargetUnit,
  type WdfFile,
  type WdfPeak,
} from '../lib/wdf';
import { stripWdfExtension } from '../lib/format';
import type { LoadedSample } from './Sidebar';
import { TraceColorPicker } from './TraceColorPicker';

export type BaselineStrength = 'auto' | 'gentle' | 'standard' | 'aggressive';

const MANUAL_BASELINE_LAMBDA: Record<Exclude<BaselineStrength, 'auto'>, number> = {
  gentle: 1e6,
  standard: 1e5,
  aggressive: 1e4,
};

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
  onToggleSampleVisible: (id: string) => void;
  onSetAllVisible: (visible: boolean) => void;
  onChangeSampleColor: (id: string, color: string) => void;
  isFullscreen?: boolean;
  onToggleFullscreen?: () => void;
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
  autoBaselineProfile?: AutoBaselineResult['profile'];
  autoBaselineLambda?: number;
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
  baselineStrength: BaselineStrength,
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
  let autoBaselineProfile: AutoBaselineResult['profile'] | undefined;
  let autoBaselineLambda: number | undefined;

  if (baselineEnabled) {
    if (baselineStrength === 'auto') {
      const res = autoSubtractBaseline(orderedRawY);
      baselineArr = res.baseline;
      workingY = res.corrected;
      autoBaselineProfile = res.profile;
      autoBaselineLambda = res.lambda;
    } else {
      const lambda = MANUAL_BASELINE_LAMBDA[baselineStrength];
      const res = subtractBaseline(orderedRawY, { lambda, p: 0.005, iterations: 10 });
      baselineArr = res.baseline;
      workingY = res.corrected;
    }
  } else {
    baselineArr = new Float64Array(order.length);
    workingY = orderedRawY;
  }

  // Optional 0-100% normalization for multi-file overlay comparison
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

  const cleanName = stripWdfExtension(fileName);
  const cleanTitle = stripWdfExtension(wdf.header.title || cleanName);

  return {
    id: sampleId,
    fileName: cleanName,
    title: cleanTitle,
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
    autoBaselineProfile,
    autoBaselineLambda,
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
  onToggleSampleVisible,
  onSetAllVisible,
  onChangeSampleColor,
  isFullscreen = false,
  onToggleFullscreen,
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

  const visibleSamples = useMemo(() => {
    return samples.filter((s) => s.visible);
  }, [samples]);

  const isMultiOverlay = visibleSamples.length > 1;
  const allVisible = samples.length > 1 && visibleSamples.length === samples.length;

  useEffect(() => {
    setZoomRange(null);
    setHoverDataX(null);
    setSpectrumIndex(0);
  }, [wdf]);

  useEffect(() => {
    setZoomRange(null);
    setHoverDataX(null);
  }, [targetUnit, sortAscending, visibleSamples.length, baselineEnabled, normalizeOverlay]);

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
        baselineEnabled,
        baselineStrength,
        isMultiOverlay && normalizeOverlay,
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
    baselineEnabled,
    baselineStrength,
    isMultiOverlay,
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
          if (!isMultiOverlay && baselineEnabled && showFittedBaseline) {
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
  }, [traces, zoomRange, isMultiOverlay, baselineEnabled, showFittedBaseline]);

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
      const rawD = !isMultiOverlay && baselineEnabled && showFittedBaseline ? buildPath(tr.points, (p) => p.rawY) : '';
      const baseD =
        !isMultiOverlay && baselineEnabled && showFittedBaseline ? buildPath(tr.points, (p) => p.baselineY) : '';

      let areaD = '';
      if (!isMultiOverlay && mainD) {
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
  }, [traces, viewDomain, isMultiOverlay, baselineEnabled, showFittedBaseline]);

  const xTicks = useMemo(() => niceTicks(viewDomain.xMin, viewDomain.xMax, 7), [viewDomain.xMin, viewDomain.xMax]);
  const yTicks = useMemo(() => niceTicks(viewDomain.yMin, viewDomain.yMax, 6), [viewDomain.yMin, viewDomain.yMax]);
  const xStep = xTicks.length >= 2 ? Math.abs(xTicks[1] - xTicks[0]) : 1;
  const yStep = yTicks.length >= 2 ? Math.abs(yTicks[1] - yTicks[0]) : 1;

  const getSvgCoords = (clientX: number, clientY: number): number | null => {
    const svg = svgRef.current;
    if (!svg) return null;
    const ctm = svg.getScreenCTM();
    if (ctm) {
      const pt = svg.createSVGPoint();
      pt.x = clientX;
      pt.y = clientY;
      const transformed = pt.matrixTransform(ctm.inverse());
      if (Number.isFinite(transformed.x)) return transformed.x;
    }
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    return ((clientX - rect.left) / rect.width) * CHART_WIDTH;
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (traces.length === 0) return;
    const svgX = getSvgCoords(e.clientX, e.clientY);
    if (svgX === null) return;

    const clampedX = Math.max(MARGIN.left, Math.min(MARGIN.left + PLOT_W, svgX));
    if (dragSelection) {
      setDragSelection((prev) => (prev ? { ...prev, currentX: clampedX } : null));
    }

    setHoverDataX(unmapX(clampedX));
  };

  const handlePointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const svgX = getSvgCoords(e.clientX, e.clientY);
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

  const yAxisTitle =
    isMultiOverlay && normalizeOverlay
      ? 'Normalized Intensity (%)'
      : baselineEnabled
        ? `Baseline-Corrected Intensity (${wdf.header.spectralUnitsName})`
        : `Intensity (${wdf.header.spectralUnitsName})`;

  return (
    <div
      className={
        isFullscreen
          ? 'h-full flex flex-col p-3 lg:p-4 space-y-3 max-w-none'
          : 'p-5 lg:p-6 space-y-5 max-w-[1400px]'
      }
    >
      {/* Header & Controls Bar */}
      <div className={`space-y-3 border-b border-slate-200 ${isFullscreen ? 'pb-3 shrink-0' : 'pb-4'}`}>
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
                  {baselineEnabled ? ` · AsLS Baseline (${baselineStrength})` : ''}
                </>
              ) : (
                <>
                  {primaryTrace.fileName} · {primaryTrace.points.length.toLocaleString()} points ·{' '}
                  {wdf.summary.laserWavenumberCm1
                    ? `Laser ${wdf.summary.laserWavenumberCm1.toFixed(2)} cm⁻¹ (${wdf.summary.laserWavelengthNm?.toFixed(2)} nm)`
                    : 'Laser wavenumber not specified'}
                  {baselineEnabled ? ` · AsLS Baseline (${baselineStrength})` : ''}
                </>
              )}
            </p>
          </div>
        )}

        {/* Unit Selector, Baseline Correction, Overlay Mode, Plot Toggles & Fullscreen */}
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
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {baselineEnabled && !isMultiOverlay && (
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
            {baselineEnabled && !isMultiOverlay && showFittedBaseline && (
              <div className="flex items-center gap-3 text-slate-600">
                <span className="inline-flex items-center gap-1">
                  <span className="w-3 h-0.5 inline-block" style={{ backgroundColor: primaryTrace.color }} />
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
        <div
          className={
            isFullscreen
              ? 'flex-1 min-h-0 p-2 sm:p-3 flex items-center justify-center'
              : 'p-2 sm:p-3'
          }
        >
          <svg
            ref={svgRef}
            viewBox={`0 0 ${CHART_WIDTH} ${CHART_HEIGHT}`}
            preserveAspectRatio="xMidYMid meet"
            className={
              isFullscreen
                ? 'w-full h-full select-none cursor-crosshair block'
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
              setDragSelection(null);
            }}
          >
            <defs>
              <linearGradient id="spectrumFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={primaryTrace.color} stopOpacity="0.14" />
                <stop offset="100%" stopColor={primaryTrace.color} stopOpacity="0.01" />
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
                      strokeWidth={isMultiOverlay ? '1.6' : '1.5'}
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

              {/* Crosshair Lines & Snap Dots */}
              {hoverDataX !== null && hoveredMatches.length > 0 && (
                <g>
                  <line
                    x1={mapX(isMultiOverlay ? hoverDataX : hoveredMatches[0].point.x)}
                    y1={MARGIN.top}
                    x2={mapX(isMultiOverlay ? hoverDataX : hoveredMatches[0].point.x)}
                    y2={MARGIN.top + PLOT_H}
                    stroke="#64748B"
                    strokeWidth="1"
                    strokeDasharray="3 3"
                  />
                  {!isMultiOverlay && (
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
                    {isMultiOverlay && normalizeOverlay
                      ? `${activeStats.peakY.toFixed(1)}%`
                      : activeStats.peakY.toLocaleString(undefined, { maximumFractionDigits: 1 })}
                  </div>
                  <div className="mt-0.5 text-[11px] font-mono tabular-nums text-slate-500">
                    Range:{' '}
                    {isMultiOverlay && normalizeOverlay
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
                        const s = v.toFixed(isMultiOverlay && normalizeOverlay ? 1 : 1);
                        return s === '-0.0' ? '0.0' : s;
                      };
                      const suffix = isMultiOverlay && normalizeOverlay ? '%' : '';
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
                      {isMultiOverlay && normalizeOverlay
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
                        {isMultiOverlay && normalizeOverlay
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
    </div>
  );
}
