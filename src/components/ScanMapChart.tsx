import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, Download, Eye, EyeOff } from 'lucide-react';
import {
  computeSignalToBaselineMap,
  WdfDataType,
  WdfDataUnits,
  type IntegrationMode,
  type SpectralTargetUnit,
  type WdfFile,
} from '../lib/wdf';
import { stripWdfExtension } from '../lib/format';

export interface ActiveIntegrationWindow {
  fromX: number;
  toX: number;
  label: string;
  xListUnit: WdfDataUnits | null;
  targetUnit: SpectralTargetUnit | null;
}

interface ScanMapChartProps {
  wdf: WdfFile;
  fileName: string;
  traceColor: string;
  spectrumIndex: number;
  totalSpectra: number;
  targetUnit: SpectralTargetUnit;
  onSelectSpectrum: (index: number) => void;
  onIntegrationWindowChange?: (win: ActiveIntegrationWindow | null) => void;
}

const DEFAULT_WIDTH = 960;
const CHART_HEIGHT = 240;
const MARGIN_TOP = 14;
const MARGIN_RIGHT = 14;
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

function formatAreaValue(val: number): string {
  if (!Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  if (abs >= 1000) {
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (abs >= 10) {
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return val.toLocaleString(undefined, { maximumFractionDigits: 4 });
}

export function ScanMapChart({
  wdf,
  fileName,
  traceColor,
  spectrumIndex,
  totalSpectra,
  targetUnit,
  onSelectSpectrum,
  onIntegrationWindowChange,
}: ScanMapChartProps) {
  const hasEmbeddedMaps = wdf.maps.length > 0;
  // 'map:0', 'map:1', ... or 'custom'
  const [sourceId, setSourceId] = useState<string>(hasEmbeddedMaps ? 'map:0' : 'custom');
  const [xAxisMode, setXAxisMode] = useState<'scan' | 'time'>('scan');
  const [showWindowOnSpectrum, setShowWindowOnSpectrum] = useState<boolean>(true);
  const [customMode, setCustomMode] = useState<IntegrationMode>('signalToBaseline');

  // Default custom integration bounds from first embedded MAP or dominant peak ± 40
  const defaultBounds = useMemo(() => {
    const firstMap = wdf.maps[0];
    if (firstMap && firstMap.firstLimit !== null && firstMap.secondLimit !== null) {
      return {
        from: Math.min(firstMap.firstLimit, firstMap.secondLimit),
        to: Math.max(firstMap.firstLimit, firstMap.secondLimit),
      };
    }
    const minX = wdf.summary.xAxisMin ?? 0;
    const maxX = wdf.summary.xAxisMax ?? 1000;
    const peakX = wdf.summary.peakX;
    if (peakX !== null && Number.isFinite(peakX)) {
      const halfSpan = Math.max(10, Math.min(40, (maxX - minX) * 0.08));
      return {
        from: Number(Math.max(minX, peakX - halfSpan).toFixed(2)),
        to: Number(Math.min(maxX, peakX + halfSpan).toFixed(2)),
      };
    }
    const span = maxX - minX;
    return {
      from: Number((minX + span * 0.25).toFixed(2)),
      to: Number((minX + span * 0.75).toFixed(2)),
    };
  }, [wdf]);

  const [customFromStr, setCustomFromStr] = useState<string>(String(defaultBounds.from));
  const [customToStr, setCustomToStr] = useState<string>(String(defaultBounds.to));
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const [chartWidth, setChartWidth] = useState<number>(DEFAULT_WIDTH);

  const svgRef = useRef<SVGSVGElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Reset selections when switching to a different WDF file
  useEffect(() => {
    setSourceId(wdf.maps.length > 0 ? 'map:0' : 'custom');
    setCustomFromStr(String(defaultBounds.from));
    setCustomToStr(String(defaultBounds.to));
    setXAxisMode('scan');
    setHoverIdx(null);
  }, [wdf, defaultBounds.from, defaultBounds.to]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = Math.round(el.clientWidth);
      if (w > 200) setChartWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Optional elapsed time axis from ORGN Time origin
  const elapsedSeconds = useMemo<number[] | null>(() => {
    const timeOrigin = wdf.origins.find(
      (o) =>
        o.dataType === WdfDataType.Time ||
        o.dataType === WdfDataType.ElapsedTime ||
        o.units === WdfDataUnits.FileTime,
    );
    if (!timeOrigin || timeOrigin.values.length < 2) return null;

    if (timeOrigin.units === WdfDataUnits.FileTime || timeOrigin.dataType === WdfDataType.Time) {
      const timestamps = timeOrigin.values.map((v) =>
        typeof v === 'string' ? Date.parse(v) : Number(v),
      );
      if (!Number.isFinite(timestamps[0])) return null;
      const t0 = timestamps[0];
      const out = timestamps.map((t) => (Number.isFinite(t) ? (t - t0) / 1000 : NaN));
      const finiteCount = out.filter((v) => Number.isFinite(v)).length;
      return finiteCount >= 2 && out[out.length - 1] > 0 ? out : null;
    }

    const nums = timeOrigin.values.map((v) => Number(v));
    if (!Number.isFinite(nums[0])) return null;
    const t0 = nums[0];
    return nums.map((t) => (Number.isFinite(t) ? t - t0 : NaN));
  }, [wdf.origins]);

  const effectiveXAxisMode = xAxisMode === 'time' && elapsedSeconds ? 'time' : 'scan';

  // Resolve active map values (embedded Renishaw MAP block or live custom calculation)
  const activeSeries = useMemo(() => {
    if (sourceId.startsWith('map:')) {
      const mapIdx = Number(sourceId.slice(4));
      const embedded = wdf.maps[mapIdx];
      if (embedded && embedded.values.length > 0) {
        return {
          kind: 'embedded' as const,
          label: embedded.label,
          subtitle:
            embedded.firstLimit !== null && embedded.secondLimit !== null
              ? `${embedded.firstLimit.toFixed(2)} – ${embedded.secondLimit.toFixed(2)}${embedded.xListUnitSymbol ? ` ${embedded.xListUnitSymbol}` : ''} · Embedded WiRE MAP`
              : 'Embedded WiRE MAP',
          values: embedded.values,
          firstLimit: embedded.firstLimit,
          secondLimit: embedded.secondLimit,
          xListUnit: embedded.xListUnit,
          targetUnit: null as SpectralTargetUnit | null,
          unitSymbol: embedded.xListUnitSymbol,
          yAxisLabel: 'Area Under Curve (Signal to Baseline)',
        };
      }
    }

    const fromVal = Number(customFromStr);
    const toVal = Number(customToStr);
    const validRange = Number.isFinite(fromVal) && Number.isFinite(toVal) && fromVal !== toVal;
    const computed = validRange
      ? computeSignalToBaselineMap(wdf, fromVal, toVal, {
          targetUnit,
          mode: customMode,
        })
      : {
          values: new Float32Array(totalSpectra),
          fromX: defaultBounds.from,
          toX: defaultBounds.to,
          mode: customMode,
          unitLabel: wdf.xAxis?.unitsName ?? 'X',
          unitSymbol: wdf.xAxis?.unitsSymbol ?? '',
        };

    const lo = Math.min(fromVal, toVal);
    const hi = Math.max(fromVal, toVal);
    const modeLabel = customMode === 'signalToBaseline' ? 'Signal to Baseline' : 'Total Area';
    return {
      kind: 'custom' as const,
      label: validRange
        ? `${modeLabel} (${lo.toFixed(2)} – ${hi.toFixed(2)}${computed.unitSymbol ? ` ${computed.unitSymbol}` : ''})`
        : 'Custom Area Under Curve',
      subtitle: `${modeLabel} · Live integration`,
      values: computed.values,
      firstLimit: validRange ? lo : null,
      secondLimit: validRange ? hi : null,
      xListUnit: null as WdfDataUnits | null,
      targetUnit,
      unitSymbol: computed.unitSymbol,
      yAxisLabel:
        customMode === 'signalToBaseline'
          ? 'Area Under Curve (Signal to Baseline)'
          : 'Total Integrated Area',
    };
  }, [sourceId, wdf, customFromStr, customToStr, targetUnit, customMode, totalSpectra, defaultBounds]);

  // Notify SpectrumView of active integration window for shading on the main Raman spectrum
  useEffect(() => {
    if (!onIntegrationWindowChange) return;
    if (
      showWindowOnSpectrum &&
      activeSeries.firstLimit !== null &&
      activeSeries.secondLimit !== null &&
      activeSeries.firstLimit !== activeSeries.secondLimit
    ) {
      onIntegrationWindowChange({
        fromX: Math.min(activeSeries.firstLimit, activeSeries.secondLimit),
        toX: Math.max(activeSeries.firstLimit, activeSeries.secondLimit),
        label: `${Math.min(activeSeries.firstLimit, activeSeries.secondLimit).toFixed(0)}–${Math.max(activeSeries.firstLimit, activeSeries.secondLimit).toFixed(0)}${activeSeries.unitSymbol ? ` ${activeSeries.unitSymbol}` : ''}`,
        xListUnit: activeSeries.xListUnit,
        targetUnit: activeSeries.targetUnit,
      });
    } else {
      onIntegrationWindowChange(null);
    }
  }, [
    onIntegrationWindowChange,
    showWindowOnSpectrum,
    activeSeries.firstLimit,
    activeSeries.secondLimit,
    activeSeries.unitSymbol,
    activeSeries.xListUnit,
    activeSeries.targetUnit,
  ]);

  // Clear highlight on unmount
  useEffect(() => {
    return () => {
      onIntegrationWindowChange?.(null);
    };
  }, [onIntegrationWindowChange]);

  const points = useMemo(() => {
    const arr: Array<{ scanIndex: number; scanNumber: number; x: number; y: number; elapsedS: number | null }> = [];
    for (let i = 0; i < activeSeries.values.length; i++) {
      const y = activeSeries.values[i];
      if (!Number.isFinite(y)) continue;
      const elapsedS = elapsedSeconds && i < elapsedSeconds.length && Number.isFinite(elapsedSeconds[i])
        ? elapsedSeconds[i]
        : null;
      const x = effectiveXAxisMode === 'time' && elapsedS !== null ? elapsedS : i + 1;
      arr.push({
        scanIndex: i,
        scanNumber: i + 1,
        x,
        y,
        elapsedS,
      });
    }
    return arr;
  }, [activeSeries.values, elapsedSeconds, effectiveXAxisMode]);

  const stats = useMemo(() => {
    if (points.length === 0) return null;
    let minY = Infinity;
    let maxY = -Infinity;
    let minScan = 1;
    let maxScan = 1;
    let sum = 0;
    for (const pt of points) {
      if (pt.y < minY) {
        minY = pt.y;
        minScan = pt.scanNumber;
      }
      if (pt.y > maxY) {
        maxY = pt.y;
        maxScan = pt.scanNumber;
      }
      sum += pt.y;
    }
    const mean = sum / points.length;
    let varSum = 0;
    for (const pt of points) {
      const d = pt.y - mean;
      varSum += d * d;
    }
    const std = points.length > 1 ? Math.sqrt(varSum / (points.length - 1)) : 0;
    const cvPercent = Math.abs(mean) > 1e-9 ? (std / Math.abs(mean)) * 100 : null;
    const activePt = points.find((p) => p.scanIndex === spectrumIndex) ?? points[0];
    return { minY, maxY, minScan, maxScan, mean, std, cvPercent, activePt };
  }, [points, spectrumIndex]);

  const domain = useMemo(() => {
    if (points.length === 0) {
      return { xMin: 1, xMax: Math.max(2, totalSpectra), yMin: 0, yMax: 1 };
    }
    let xMin = points[0].x;
    let xMax = points[points.length - 1].x;
    if (xMax <= xMin) {
      xMin -= 1;
      xMax += 1;
    }
    let yMin = Infinity;
    let yMax = -Infinity;
    for (const pt of points) {
      if (pt.y < yMin) yMin = pt.y;
      if (pt.y > yMax) yMax = pt.y;
    }
    const ySpan = yMax - yMin;
    const yPad = ySpan > 0 ? ySpan * 0.1 : Math.max(Math.abs(yMax) * 0.1, 1);
    return {
      xMin,
      xMax,
      yMin: yMin - yPad,
      yMax: yMax + yPad,
    };
  }, [points, totalSpectra]);

  const yTicks = useMemo(() => niceTicks(domain.yMin, domain.yMax, 5), [domain.yMin, domain.yMax]);
  const yStep = yTicks.length >= 2 ? yTicks[1] - yTicks[0] : 1;

  const xTicks = useMemo(() => {
    if (effectiveXAxisMode === 'scan') {
      const raw = niceTicks(domain.xMin, domain.xMax, Math.min(10, Math.max(4, points.length)));
      const ints = Array.from(new Set(raw.map((v) => Math.round(v)))).filter(
        (v) => v >= Math.floor(domain.xMin) && v <= Math.ceil(domain.xMax),
      );
      if (ints.length > 0 && ints[0] !== 1 && domain.xMin <= 1) {
        ints.unshift(1);
      }
      return ints;
    }
    return niceTicks(domain.xMin, domain.xMax, 8);
  }, [domain.xMin, domain.xMax, effectiveXAxisMode, points.length]);
  const xStep = xTicks.length >= 2 ? xTicks[1] - xTicks[0] : 1;

  const marginLeft = useMemo(() => {
    const maxChars = yTicks.reduce((max, t) => Math.max(max, formatTick(t, yStep).length), 3);
    return Math.max(60, Math.min(92, maxChars * 6.8 + 26));
  }, [yTicks, yStep]);

  const plotW = Math.max(120, chartWidth - marginLeft - MARGIN_RIGHT);
  const plotH = CHART_HEIGHT - MARGIN_TOP - MARGIN_BOTTOM;

  const mapX = (x: number) =>
    marginLeft + ((x - domain.xMin) / Math.max(1e-9, domain.xMax - domain.xMin)) * plotW;
  const mapY = (y: number) =>
    MARGIN_TOP + plotH - ((y - domain.yMin) / Math.max(1e-9, domain.yMax - domain.yMin)) * plotH;

  const linePath = useMemo(() => {
    if (points.length === 0) return '';
    return points
      .map((pt, i) => `${i === 0 ? 'M' : 'L'}${mapX(pt.x).toFixed(2)},${mapY(pt.y).toFixed(2)}`)
      .join(' ');
  }, [points, domain, plotW, plotH, marginLeft]);

  const areaPath = useMemo(() => {
    if (points.length < 2) return '';
    const baseY = MARGIN_TOP + plotH;
    const firstX = mapX(points[0].x).toFixed(2);
    const lastX = mapX(points[points.length - 1].x).toFixed(2);
    return `${linePath} L${lastX},${baseY.toFixed(2)} L${firstX},${baseY.toFixed(2)} Z`;
  }, [linePath, points, domain, plotW, plotH, marginLeft]);

  const findNearestScanFromClientX = (clientX: number): number | null => {
    const svg = svgRef.current;
    if (!svg || points.length === 0) return null;
    const rect = svg.getBoundingClientRect();
    if (rect.width <= 0) return null;
    const svgX = ((clientX - rect.left) / rect.width) * chartWidth;
    const clampedX = Math.max(marginLeft, Math.min(marginLeft + plotW, svgX));
    const dataX = domain.xMin + ((clampedX - marginLeft) / plotW) * (domain.xMax - domain.xMin);

    let bestIdx = points[0].scanIndex;
    let bestDist = Infinity;
    for (const pt of points) {
      const dist = Math.abs(pt.x - dataX);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = pt.scanIndex;
      }
    }
    return bestIdx;
  };

  const handlePointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const idx = findNearestScanFromClientX(e.clientX);
    setHoverIdx(idx);
  };

  const handleClick = (e: React.MouseEvent<SVGSVGElement>) => {
    const idx = findNearestScanFromClientX(e.clientX);
    if (idx !== null) {
      onSelectSpectrum(idx);
    }
  };

  const handleExportCsv = () => {
    const hasTime = elapsedSeconds !== null;
    const header = hasTime
      ? `"Scan","Elapsed Time (s)","${activeSeries.label.replace(/"/g, '""')}"`
      : `"Scan","${activeSeries.label.replace(/"/g, '""')}"`;
    const rows = [header];
    for (const pt of points) {
      if (hasTime) {
        rows.push(`${pt.scanNumber},${pt.elapsedS !== null ? pt.elapsedS.toFixed(3) : ''},${pt.y.toFixed(6)}`);
      } else {
        rows.push(`${pt.scanNumber},${pt.y.toFixed(6)}`);
      }
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stripWdfExtension(fileName)}_scan_map.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const activePoint = points.find((p) => p.scanIndex === spectrumIndex) ?? null;
  const hoveredPoint = hoverIdx !== null ? points.find((p) => p.scanIndex === hoverIdx) ?? null : null;
  const showMarkers = points.length <= 120;

  return (
    <section
      aria-label="Scan Integration Map"
      data-testid="scan-map-chart"
      className="bg-white border border-slate-200 rounded overflow-hidden"
    >
      {/* Header Bar */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Activity className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider shrink-0">
            Scan Integration Map
          </h2>
          <span className="text-xs font-mono text-slate-600 truncate" title={activeSeries.label}>
            {activeSeries.label}
          </span>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Source Switcher: Embedded WiRE MAP(s) + Live Custom Range */}
          <div className="inline-flex border border-slate-200 rounded bg-white p-0.5 text-[11px]">
            {wdf.maps.map((m, idx) => {
              const id = `map:${idx}`;
              const active = sourceId === id;
              const shortLabel =
                m.firstLimit !== null && m.secondLimit !== null
                  ? `WiRE Map (${m.firstLimit.toFixed(0)}–${m.secondLimit.toFixed(0)})`
                  : `WiRE Map #${idx + 1}`;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => setSourceId(id)}
                  className={`px-2 py-0.5 rounded-xs font-medium cursor-pointer transition-colors ${
                    active
                      ? 'bg-blue-600 text-white'
                      : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
                  }`}
                >
                  {shortLabel}
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setSourceId('custom')}
              className={`px-2 py-0.5 rounded-xs font-medium cursor-pointer transition-colors ${
                sourceId === 'custom'
                  ? 'bg-blue-600 text-white'
                  : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
              }`}
            >
              Custom Range
            </button>
          </div>

          {/* X-axis mode toggle (Scan # vs Elapsed Time when available) */}
          {elapsedSeconds && (
            <div className="inline-flex border border-slate-200 rounded bg-white p-0.5 text-[11px]">
              <button
                type="button"
                onClick={() => setXAxisMode('scan')}
                className={`px-2 py-0.5 rounded-xs font-medium cursor-pointer transition-colors ${
                  effectiveXAxisMode === 'scan'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Scan #
              </button>
              <button
                type="button"
                onClick={() => setXAxisMode('time')}
                className={`px-2 py-0.5 rounded-xs font-medium cursor-pointer transition-colors ${
                  effectiveXAxisMode === 'time'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
              >
                Time (s)
              </button>
            </div>
          )}

          {/* Toggle shaded integration band on main spectrum plot */}
          {activeSeries.firstLimit !== null && activeSeries.secondLimit !== null && (
            <button
              type="button"
              onClick={() => setShowWindowOnSpectrum((v) => !v)}
              title="Highlight the integration X range on the spectrum chart above"
              className={`inline-flex items-center gap-1 px-2 py-1 rounded border text-[11px] font-medium cursor-pointer transition-colors ${
                showWindowOnSpectrum
                  ? 'border-blue-300 bg-blue-50 text-blue-700'
                  : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
              }`}
            >
              {showWindowOnSpectrum ? (
                <Eye className="w-3 h-3" aria-hidden="true" />
              ) : (
                <EyeOff className="w-3 h-3" aria-hidden="true" />
              )}
              <span>Highlight Window</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-700 cursor-pointer transition-colors"
            title="Export Scan vs. Area Under Curve values as CSV"
          >
            <Download className="w-3 h-3" aria-hidden="true" />
            <span>CSV</span>
          </button>
        </div>
      </div>

      {/* Custom Integration Range Controls */}
      {sourceId === 'custom' && (
        <div className="px-4 py-2 bg-blue-50/40 border-b border-slate-200 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex items-center gap-1.5">
            <label htmlFor="map-from-x" className="text-[11px] font-medium text-slate-600">
              From X
            </label>
            <input
              id="map-from-x"
              type="number"
              step="any"
              value={customFromStr}
              onChange={(e) => setCustomFromStr(e.target.value)}
              className="w-24 px-2 py-1 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="map-to-x" className="text-[11px] font-medium text-slate-600">
              To X
            </label>
            <input
              id="map-to-x"
              type="number"
              step="any"
              value={customToStr}
              onChange={(e) => setCustomToStr(e.target.value)}
              className="w-24 px-2 py-1 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            />
            {activeSeries.unitSymbol && (
              <span className="text-[11px] font-mono text-slate-500">{activeSeries.unitSymbol}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="map-integration-mode" className="text-[11px] font-medium text-slate-600">
              Method
            </label>
            <select
              id="map-integration-mode"
              value={customMode}
              onChange={(e) => setCustomMode(e.target.value as IntegrationMode)}
              className="px-2 py-1 text-xs bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            >
              <option value="signalToBaseline">Signal to Baseline</option>
              <option value="totalArea">Total Area (above 0)</option>
            </select>
          </div>
        </div>
      )}

      {/* Readout Status Strip */}
      <div className="px-3 py-1.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
        {hoveredPoint ? (
          <div className="flex flex-wrap items-center gap-3 text-slate-800">
            <span>
              <span className="text-slate-500">Scan:</span>{' '}
              <span className="font-semibold">
                {hoveredPoint.scanNumber} / {totalSpectra}
              </span>
            </span>
            {hoveredPoint.elapsedS !== null && (
              <span>
                <span className="text-slate-500">t =</span> {hoveredPoint.elapsedS.toFixed(1)} s
              </span>
            )}
            <span>
              <span className="text-slate-500">Area:</span>{' '}
              <span className="font-semibold" style={{ color: traceColor }}>
                {formatAreaValue(hoveredPoint.y)}
              </span>
            </span>
          </div>
        ) : activePoint ? (
          <div className="flex flex-wrap items-center gap-3 text-slate-700">
            <span>
              <span className="text-slate-500">Active Scan:</span>{' '}
              <span className="font-semibold text-slate-900">
                #{activePoint.scanNumber} / {totalSpectra}
              </span>
            </span>
            {activePoint.elapsedS !== null && (
              <span>
                <span className="text-slate-500">t =</span> {activePoint.elapsedS.toFixed(1)} s
              </span>
            )}
            <span>
              <span className="text-slate-500">Area:</span>{' '}
              <span className="font-semibold" style={{ color: traceColor }}>
                {formatAreaValue(activePoint.y)}
              </span>
            </span>
            <span className="text-slate-400">· Click any scan point to inspect its spectrum above</span>
          </div>
        ) : (
          <span className="text-slate-500">No map data points available</span>
        )}

        <span className="text-[11px] text-slate-500">{activeSeries.subtitle}</span>
      </div>

      {/* Responsive SVG Plot */}
      <div ref={containerRef} className="w-full px-1.5 pt-1 pb-1">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${chartWidth} ${CHART_HEIGHT}`}
          className="w-full h-auto block select-none cursor-pointer"
          role="img"
          aria-label={`${activeSeries.label} plot of area under curve versus ${effectiveXAxisMode === 'time' ? 'elapsed time' : 'scan number'}`}
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverIdx(null)}
          onClick={handleClick}
        >
          <defs>
            <linearGradient id="scanMapAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={traceColor} stopOpacity="0.16" />
              <stop offset="100%" stopColor={traceColor} stopOpacity="0.01" />
            </linearGradient>
          </defs>

          {/* Plot Area Box */}
          <rect
            x={marginLeft}
            y={MARGIN_TOP}
            width={plotW}
            height={plotH}
            fill="#FFFFFF"
            stroke="#E2E8F0"
            strokeWidth="1"
          />

          {/* Horizontal Gridlines & Y Ticks */}
          {yTicks.map((tick) => {
            const py = mapY(tick);
            if (py < MARGIN_TOP - 1 || py > MARGIN_TOP + plotH + 1) return null;
            return (
              <g key={`my-${tick}`}>
                <line
                  x1={marginLeft}
                  y1={py}
                  x2={marginLeft + plotW}
                  y2={py}
                  stroke="#F1F5F9"
                  strokeWidth="1"
                />
                <line
                  x1={marginLeft - 4}
                  y1={py}
                  x2={marginLeft}
                  y2={py}
                  stroke="#94A3B8"
                  strokeWidth="1"
                />
                <text
                  x={marginLeft - 7}
                  y={py + 3.5}
                  textAnchor="end"
                  fontSize="10.5"
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
            if (px < marginLeft - 1 || px > marginLeft + plotW + 1) return null;
            const nearRight = px > marginLeft + plotW - 18;
            const nearLeft = px < marginLeft + 18;
            const anchor = nearRight ? 'end' : nearLeft ? 'start' : 'middle';
            const textX = nearRight
              ? Math.min(px, marginLeft + plotW)
              : nearLeft
                ? Math.max(px, marginLeft)
                : px;
            return (
              <g key={`mx-${tick}`}>
                <line
                  x1={px}
                  y1={MARGIN_TOP}
                  x2={px}
                  y2={MARGIN_TOP + plotH}
                  stroke="#F1F5F9"
                  strokeWidth="1"
                />
                <line
                  x1={px}
                  y1={MARGIN_TOP + plotH}
                  x2={px}
                  y2={MARGIN_TOP + plotH + 4}
                  stroke="#94A3B8"
                  strokeWidth="1"
                />
                <text
                  x={textX}
                  y={MARGIN_TOP + plotH + 15}
                  textAnchor={anchor}
                  fontSize="10.5"
                  fontFamily="IBM Plex Mono, monospace"
                  fill="#475569"
                >
                  {formatTick(tick, xStep)}
                </text>
              </g>
            );
          })}

          {/* Area Fill & Line */}
          {areaPath && <path d={areaPath} fill="url(#scanMapAreaFill)" />}
          {linePath && (
            <path
              d={linePath}
              fill="none"
              stroke={traceColor}
              strokeWidth="1.75"
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}

          {/* Individual Scan Point Markers */}
          {showMarkers &&
            points.map((pt) => {
              const cx = mapX(pt.x);
              const cy = mapY(pt.y);
              const isSelected = pt.scanIndex === spectrumIndex;
              const isHovered = pt.scanIndex === hoverIdx;
              return (
                <circle
                  key={pt.scanIndex}
                  data-scan-point={pt.scanNumber}
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5 : isHovered ? 4.5 : 2.8}
                  fill={isSelected ? traceColor : '#FFFFFF'}
                  stroke={traceColor}
                  strokeWidth={isSelected ? 2 : 1.5}
                />
              );
            })}

          {/* Active Scan Vertical Indicator */}
          {activePoint && (
            <g pointerEvents="none">
              <line
                x1={mapX(activePoint.x)}
                y1={MARGIN_TOP}
                x2={mapX(activePoint.x)}
                y2={MARGIN_TOP + plotH}
                stroke={traceColor}
                strokeWidth="1"
                strokeOpacity="0.45"
                strokeDasharray="3 3"
              />
              <circle
                cx={mapX(activePoint.x)}
                cy={mapY(activePoint.y)}
                r="5.5"
                fill={traceColor}
                stroke="#FFFFFF"
                strokeWidth="2"
              />
            </g>
          )}

          {/* Hover Crosshair */}
          {hoveredPoint && hoveredPoint.scanIndex !== spectrumIndex && (
            <g pointerEvents="none">
              <line
                x1={mapX(hoveredPoint.x)}
                y1={MARGIN_TOP}
                x2={mapX(hoveredPoint.x)}
                y2={MARGIN_TOP + plotH}
                stroke="#64748B"
                strokeWidth="1"
                strokeDasharray="2 2"
              />
              <circle
                cx={mapX(hoveredPoint.x)}
                cy={mapY(hoveredPoint.y)}
                r="4.5"
                fill="#FFFFFF"
                stroke="#0F172A"
                strokeWidth="1.75"
              />
            </g>
          )}

          {/* Axis Titles */}
          <text
            x={marginLeft + plotW / 2}
            y={CHART_HEIGHT - 5}
            textAnchor="middle"
            fontSize="11.5"
            fontWeight="500"
            fill="#334155"
          >
            {effectiveXAxisMode === 'time' ? 'Elapsed Time (s)' : `Scan Number (1 – ${totalSpectra})`}
          </text>
          <text
            x={13}
            y={MARGIN_TOP + plotH / 2}
            textAnchor="middle"
            fontSize="11"
            fontWeight="500"
            fill="#334155"
            transform={`rotate(-90, 13, ${MARGIN_TOP + plotH / 2})`}
          >
            Area Under Curve
          </text>
        </svg>
      </div>

      {/* Compact Series Statistics Footer */}
      {stats && (
        <div className="grid grid-cols-2 sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-slate-200 border-t border-slate-200 bg-slate-50/40 text-xs">
          <div className="px-3.5 py-2">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Mean ± SD
            </div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
              {formatAreaValue(stats.mean)} ± {formatAreaValue(stats.std)}
            </div>
          </div>
          <div className="px-3.5 py-2">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Minimum
            </div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
              {formatAreaValue(stats.minY)}{' '}
              <button
                type="button"
                onClick={() => onSelectSpectrum(stats.minScan - 1)}
                className="text-[11px] font-normal text-blue-600 hover:underline cursor-pointer"
                title={`Jump to minimum scan #${stats.minScan}`}
              >
                (Scan #{stats.minScan})
              </button>
            </div>
          </div>
          <div className="px-3.5 py-2">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Maximum
            </div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
              {formatAreaValue(stats.maxY)}{' '}
              <button
                type="button"
                onClick={() => onSelectSpectrum(stats.maxScan - 1)}
                className="text-[11px] font-normal text-blue-600 hover:underline cursor-pointer"
                title={`Jump to maximum scan #${stats.maxScan}`}
              >
                (Scan #{stats.maxScan})
              </button>
            </div>
          </div>
          <div className="px-3.5 py-2">
            <div className="text-[10px] font-medium text-slate-500 uppercase tracking-wider">
              Stability (RSD / CV)
            </div>
            <div className="mt-0.5 font-mono font-semibold tabular-nums text-slate-900">
              {stats.cvPercent !== null ? `${stats.cvPercent.toFixed(2)}%` : '—'}
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
