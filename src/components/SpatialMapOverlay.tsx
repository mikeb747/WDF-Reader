import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Download,
  Eye,
  EyeOff,
  Image as ImageIcon,
  Layers,
  Maximize2,
  Scan,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import {
  buildSpatialGrid2D,
  computeSignalToBaselineMap,
  getColormapCssGradient,
  MAP_COLORMAPS,
  parseWhiteLightExif,
  sampleColormapRgb,
  WdfDataUnits,
  type IntegrationMode,
  type MapColormapId,
  type SpatialCell2D,
  type SpectralTargetUnit,
  type WdfFile,
} from '../lib/wdf';
import { stripWdfExtension } from '../lib/format';
import type { ActiveIntegrationWindow } from './ScanMapChart';

interface SpatialMapOverlayProps {
  wdf: WdfFile;
  fileName: string;
  whiteLightUrl: string | null;
  spectrumIndex: number;
  totalSpectra: number;
  targetUnit: SpectralTargetUnit;
  onSelectSpectrum: (index: number) => void;
  onIntegrationWindowChange?: (win: ActiveIntegrationWindow | null) => void;
}

type FramingMode = 'fit-map' | 'full-optical';

interface ViewportBox {
  xMin: number;
  yMin: number;
  width: number;
  height: number;
}

function formatMapValue(val: number): string {
  if (!Number.isFinite(val)) return '—';
  const abs = Math.abs(val);
  if (abs >= 1000) {
    return val.toLocaleString(undefined, { maximumFractionDigits: 1 });
  }
  if (abs >= 10) {
    return val.toLocaleString(undefined, { maximumFractionDigits: 2 });
  }
  return val.toLocaleString(undefined, { maximumFractionDigits: 3 });
}

function chooseScaleBarUm(viewportWidthUm: number): number {
  const target = viewportWidthUm * 0.2;
  if (!Number.isFinite(target) || target <= 0) return 10;
  const pow = Math.pow(10, Math.floor(Math.log10(target)));
  const norm = target / pow;
  const nice = norm < 1.5 ? 1 : norm < 3.5 ? 2 : norm < 7.5 ? 5 : 10;
  return nice * pow;
}

export function SpatialMapOverlay({
  wdf,
  fileName,
  whiteLightUrl,
  spectrumIndex,
  totalSpectra,
  targetUnit,
  onSelectSpectrum,
  onIntegrationWindowChange,
}: SpatialMapOverlayProps) {
  const hasEmbeddedMaps = wdf.maps.length > 0;
  const hasWhiteLight = Boolean(whiteLightUrl && wdf.whiteLightImage);

  // Decode EXIF spatial calibration for the embedded white-light image
  const whiteLightMeta = useMemo(() => {
    if (!wdf.whiteLightImage) return null;
    return parseWhiteLightExif(wdf.whiteLightImage.bytes);
  }, [wdf.whiteLightImage]);

  // Map data source state ('map:0', 'map:1', ..., or 'custom')
  const [sourceId, setSourceId] = useState<string>(hasEmbeddedMaps ? 'map:0' : 'custom');
  const [customMode, setCustomMode] = useState<IntegrationMode>('signalToBaseline');
  const [showWindowOnSpectrum, setShowWindowOnSpectrum] = useState<boolean>(true);

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

  // Dual-layer visibility & transparency state
  const [opticalVisible, setOpticalVisible] = useState<boolean>(true);
  const [opticalOpacity, setOpticalOpacity] = useState<number>(100);
  const [ramanVisible, setRamanVisible] = useState<boolean>(true);
  const [ramanOpacity, setRamanOpacity] = useState<number>(hasWhiteLight ? 35 : 100);

  // Rendering & framing options
  const [colormap, setColormap] = useState<MapColormapId>('inferno');
  const [smoothPixels, setSmoothPixels] = useState<boolean>(false);
  const [showOutline, setShowOutline] = useState<boolean>(true);
  const [framingMode, setFramingMode] = useState<FramingMode>('fit-map');
  const [zoomFactor, setZoomFactor] = useState<number>(1);
  const [hoverCell, setHoverCell] = useState<SpatialCell2D | null>(null);
  const [viewportPxWidth, setViewportPxWidth] = useState<number>(720);

  const heatmapCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Reset per-file state cleanly when switching WDF files
  useEffect(() => {
    setSourceId(wdf.maps.length > 0 ? 'map:0' : 'custom');
    setCustomFromStr(String(defaultBounds.from));
    setCustomToStr(String(defaultBounds.to));
    setOpticalVisible(true);
    setOpticalOpacity(100);
    setRamanVisible(true);
    setRamanOpacity(Boolean(whiteLightUrl && wdf.whiteLightImage) ? 35 : 100);
    setFramingMode('fit-map');
    setZoomFactor(1);
    setHoverCell(null);
  }, [wdf, whiteLightUrl, defaultBounds.from, defaultBounds.to]);

  // Compute active scalar values per spectrum
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
              ? `${embedded.firstLimit.toFixed(1)} – ${embedded.secondLimit.toFixed(1)}${embedded.xListUnitSymbol ? ` ${embedded.xListUnitSymbol}` : ''} · WiRE MAP`
              : 'Embedded WiRE MAP',
          values: embedded.values,
          firstLimit: embedded.firstLimit,
          secondLimit: embedded.secondLimit,
          xListUnit: embedded.xListUnit,
          targetUnit: null as SpectralTargetUnit | null,
          unitSymbol: embedded.xListUnitSymbol,
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
        ? `${modeLabel} (${lo.toFixed(1)} – ${hi.toFixed(1)}${computed.unitSymbol ? ` ${computed.unitSymbol}` : ''})`
        : 'Custom Integration Map',
      subtitle: `${modeLabel} · Live`,
      values: computed.values,
      firstLimit: validRange ? lo : null,
      secondLimit: validRange ? hi : null,
      xListUnit: null as WdfDataUnits | null,
      targetUnit,
      unitSymbol: computed.unitSymbol,
    };
  }, [sourceId, wdf, customFromStr, customToStr, targetUnit, customMode, totalSpectra, defaultBounds]);

  // Sync shaded integration window on the main spectrum plot
  useEffect(() => {
    if (!onIntegrationWindowChange) return;
    if (
      showWindowOnSpectrum &&
      activeSeries.firstLimit !== null &&
      activeSeries.secondLimit !== null &&
      activeSeries.firstLimit !== activeSeries.secondLimit
    ) {
      const lo = Math.min(activeSeries.firstLimit, activeSeries.secondLimit);
      const hi = Math.max(activeSeries.firstLimit, activeSeries.secondLimit);
      onIntegrationWindowChange({
        fromX: lo,
        toX: hi,
        label: `${lo.toFixed(0)}–${hi.toFixed(0)}${activeSeries.unitSymbol ? ` ${activeSeries.unitSymbol}` : ''}`,
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

  useEffect(() => {
    return () => {
      onIntegrationWindowChange?.(null);
    };
  }, [onIntegrationWindowChange]);

  // Build calibrated 2D spatial grid
  const spatialGrid = useMemo(
    () => buildSpatialGrid2D(wdf, activeSeries.values),
    [wdf, activeSeries.values],
  );

  useEffect(() => {
    const el = viewportRef.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const update = () => {
      const w = Math.round(el.clientWidth);
      if (w > 40) setViewportPxWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, [spatialGrid]);

  // Rasterize 2D Raman heatmap onto the offscreen-sized canvas (cols x rows)
  useEffect(() => {
    const canvas = heatmapCanvasRef.current;
    if (!canvas || !spatialGrid) return;
    const { cols, rows, grid, minVal, maxVal } = spatialGrid;
    canvas.width = cols;
    canvas.height = rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const imgData = ctx.createImageData(cols, rows);
    const data = imgData.data;
    const span = maxVal - minVal;

    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const cell = grid[r * cols + c];
        const offset = (r * cols + c) * 4;
        if (!cell) {
          data[offset] = 0;
          data[offset + 1] = 0;
          data[offset + 2] = 0;
          data[offset + 3] = 0;
          continue;
        }
        const t = span > 1e-9 ? (cell.value - minVal) / span : 0.5;
        const [red, green, blue] = sampleColormapRgb(colormap, t);
        data[offset] = red;
        data[offset + 1] = green;
        data[offset + 2] = blue;
        data[offset + 3] = 255;
      }
    }
    ctx.putImageData(imgData, 0, 0);
  }, [spatialGrid, colormap]);

  // Physical bounds of optical image (in µm) when calibrated, or matched to Raman map when uncalibrated
  const opticalBox = useMemo<ViewportBox | null>(() => {
    if (!hasWhiteLight) return null;
    if (
      whiteLightMeta?.hasCalibration &&
      whiteLightMeta.originXUm !== null &&
      whiteLightMeta.originYUm !== null &&
      whiteLightMeta.widthUm !== null &&
      whiteLightMeta.heightUm !== null
    ) {
      return {
        xMin: whiteLightMeta.originXUm,
        yMin: whiteLightMeta.originYUm,
        width: whiteLightMeta.widthUm,
        height: whiteLightMeta.heightUm,
      };
    }
    if (spatialGrid) {
      return {
        xMin: spatialGrid.bounds.xMin,
        yMin: spatialGrid.bounds.yMin,
        width: spatialGrid.bounds.width,
        height: spatialGrid.bounds.height,
      };
    }
    return null;
  }, [hasWhiteLight, whiteLightMeta, spatialGrid]);

  // Compute unified physical coordinate viewport (in µm) for both stacked layers
  const viewportBox = useMemo<ViewportBox | null>(() => {
    if (!spatialGrid) return null;
    const mapB = spatialGrid.bounds;
    const mapCenterX = (mapB.xMin + mapB.xMax) / 2;
    const mapCenterY = (mapB.yMin + mapB.yMax) / 2;

    let base: ViewportBox;
    if (opticalBox && whiteLightMeta?.hasCalibration && framingMode === 'full-optical') {
      // Include union of optical image and map bounds so neither is ever clipped
      const xMin = Math.min(opticalBox.xMin, mapB.xMin);
      const yMin = Math.min(opticalBox.yMin, mapB.yMin);
      const xMax = Math.max(opticalBox.xMin + opticalBox.width, mapB.xMax);
      const yMax = Math.max(opticalBox.yMin + opticalBox.height, mapB.yMax);
      base = { xMin, yMin, width: xMax - xMin, height: yMax - yMin };
    } else if (opticalBox && whiteLightMeta?.hasCalibration) {
      // 'fit-map': frame tightly around the Raman scan with comfortable optical context
      // Keep an ergonomic landscape-friendly aspect ratio (at least 1.35:1) so tall/narrow StreamLine
      // strips show clear surrounding microscope features on both sides for visual alignment checks.
      const padY = Math.max(mapB.height * 0.22, 6);
      const targetH = Math.min(opticalBox.height, mapB.height + padY * 2);
      const minWForAspect = targetH * 1.45;
      const padX = Math.max(mapB.width * 0.6, 12);
      const targetW = Math.min(opticalBox.width, Math.max(mapB.width + padX * 2, minWForAspect));

      let xMin = mapCenterX - targetW / 2;
      let yMin = mapCenterY - targetH / 2;
      // Clamp gently within optical FOV when possible
      if (xMin < opticalBox.xMin) xMin = opticalBox.xMin;
      if (xMin + targetW > opticalBox.xMin + opticalBox.width) {
        xMin = Math.max(opticalBox.xMin, opticalBox.xMin + opticalBox.width - targetW);
      }
      if (yMin < opticalBox.yMin) yMin = opticalBox.yMin;
      if (yMin + targetH > opticalBox.yMin + opticalBox.height) {
        yMin = Math.max(opticalBox.yMin, opticalBox.yMin + opticalBox.height - targetH);
      }
      base = { xMin, yMin, width: targetW, height: targetH };
    } else {
      // No calibrated optical image: frame map cleanly with subtle 8% margin
      const padX = mapB.width * 0.08;
      const padY = mapB.height * 0.08;
      base = {
        xMin: mapB.xMin - padX,
        yMin: mapB.yMin - padY,
        width: mapB.width + padX * 2,
        height: mapB.height + padY * 2,
      };
    }

    if (zoomFactor <= 1.001) return base;
    // Zoom centered on the Raman map center
    const zoomedW = base.width / zoomFactor;
    const zoomedH = base.height / zoomFactor;
    return {
      xMin: mapCenterX - zoomedW / 2,
      yMin: mapCenterY - zoomedH / 2,
      width: zoomedW,
      height: zoomedH,
    };
  }, [spatialGrid, opticalBox, whiteLightMeta, framingMode, zoomFactor]);

  // Convert physical µm rectangle into CSS percentage coordinates inside the viewport
  const toViewportPct = useCallback(
    (box: ViewportBox) => {
      if (!viewportBox) return null;
      return {
        left: `${(((box.xMin - viewportBox.xMin) / viewportBox.width) * 100).toFixed(4)}%`,
        top: `${(((box.yMin - viewportBox.yMin) / viewportBox.height) * 100).toFixed(4)}%`,
        width: `${((box.width / viewportBox.width) * 100).toFixed(4)}%`,
        height: `${((box.height / viewportBox.height) * 100).toFixed(4)}%`,
      };
    },
    [viewportBox],
  );

  // Hit-test pointer position -> nearest cell inside the Raman map
  const hitTestPointer = useCallback(
    (clientX: number, clientY: number): SpatialCell2D | null => {
      if (!viewportRef.current || !viewportBox || !spatialGrid) return null;
      const rect = viewportRef.current.getBoundingClientRect();
      if (rect.width <= 0 || rect.height <= 0) return null;

      const fx = (clientX - rect.left) / rect.width;
      const fy = (clientY - rect.top) / rect.height;
      const stageX = viewportBox.xMin + fx * viewportBox.width;
      const stageY = viewportBox.yMin + fy * viewportBox.height;

      const { bounds, cols, rows, grid } = spatialGrid;
      if (
        stageX < bounds.xMin ||
        stageX > bounds.xMax ||
        stageY < bounds.yMin ||
        stageY > bounds.yMax
      ) {
        return null;
      }

      const col = Math.max(
        0,
        Math.min(cols - 1, Math.floor(((stageX - bounds.xMin) / bounds.width) * cols)),
      );
      const row = Math.max(
        0,
        Math.min(rows - 1, Math.floor(((stageY - bounds.yMin) / bounds.height) * rows)),
      );
      return grid[row * cols + col] ?? null;
    },
    [viewportBox, spatialGrid],
  );

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    setHoverCell(hitTestPointer(e.clientX, e.clientY));
  };

  const handleClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const cell = hitTestPointer(e.clientX, e.clientY);
    if (cell) {
      onSelectSpectrum(cell.spectrumIndex);
    }
  };

  const handleExportCsv = () => {
    if (!spatialGrid) return;
    const header = `"Scan","Col","Row","X (${spatialGrid.unitSymbol})","Y (${spatialGrid.unitSymbol})","${activeSeries.label.replace(/"/g, '""')}"`;
    const rows = [header];
    for (const c of spatialGrid.cells) {
      rows.push(
        `${c.spectrumIndex + 1},${c.col + 1},${c.row + 1},${c.x.toFixed(4)},${c.y.toFixed(4)},${c.value.toFixed(6)}`,
      );
    }
    const blob = new Blob([rows.join('\n')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stripWdfExtension(fileName)}_2d_map.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPng = () => {
    if (!viewportBox || !spatialGrid) return;
    const outW = 1200;
    const aspect = viewportBox.width / viewportBox.height;
    const outH = Math.max(320, Math.round(outW / aspect));
    const canvas = document.createElement('canvas');
    canvas.width = outW;
    canvas.height = outH;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.fillStyle = '#0f172a';
    ctx.fillRect(0, 0, outW, outH);

    const mapToPx = (b: ViewportBox) => ({
      x: ((b.xMin - viewportBox.xMin) / viewportBox.width) * outW,
      y: ((b.yMin - viewportBox.yMin) / viewportBox.height) * outH,
      w: (b.width / viewportBox.width) * outW,
      h: (b.height / viewportBox.height) * outH,
    });

    if (opticalVisible && opticalOpacity > 0 && opticalBox && imgRef.current?.complete) {
      const r = mapToPx(opticalBox);
      ctx.save();
      ctx.globalAlpha = opticalOpacity / 100;
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(imgRef.current, r.x, r.y, r.w, r.h);
      ctx.restore();
    }

    if (ramanVisible && ramanOpacity > 0 && heatmapCanvasRef.current) {
      const r = mapToPx({
        xMin: spatialGrid.bounds.xMin,
        yMin: spatialGrid.bounds.yMin,
        width: spatialGrid.bounds.width,
        height: spatialGrid.bounds.height,
      });
      ctx.save();
      ctx.globalAlpha = ramanOpacity / 100;
      ctx.imageSmoothingEnabled = smoothPixels;
      ctx.drawImage(heatmapCanvasRef.current, r.x, r.y, r.w, r.h);
      ctx.restore();
    }

    if (showOutline) {
      const r = mapToPx({
        xMin: spatialGrid.bounds.xMin,
        yMin: spatialGrid.bounds.yMin,
        width: spatialGrid.bounds.width,
        height: spatialGrid.bounds.height,
      });
      ctx.save();
      ctx.strokeStyle = 'rgba(56, 189, 248, 0.9)';
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(r.x, r.y, r.w, r.h);
      ctx.restore();
    }

    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = `${stripWdfExtension(fileName)}_overlay.png`;
    a.click();
  };

  if (!spatialGrid || !viewportBox) return null;

  const activeCell = spatialGrid.bySpectrumIndex.get(spectrumIndex) ?? null;
  const inspectedCell = hoverCell ?? activeCell;

  const opticalStyle = opticalBox ? toViewportPct(opticalBox) : null;
  const ramanStyle = toViewportPct({
    xMin: spatialGrid.bounds.xMin,
    yMin: spatialGrid.bounds.yMin,
    width: spatialGrid.bounds.width,
    height: spatialGrid.bounds.height,
  });

  const selectedCellStyle = activeCell
    ? toViewportPct({
        xMin: activeCell.x - spatialGrid.cellWidth / 2,
        yMin: activeCell.y - spatialGrid.cellHeight / 2,
        width: spatialGrid.cellWidth,
        height: spatialGrid.cellHeight,
      })
    : null;

  const hoverCellStyle =
    hoverCell && hoverCell.spectrumIndex !== spectrumIndex
      ? toViewportPct({
          xMin: hoverCell.x - spatialGrid.cellWidth / 2,
          yMin: hoverCell.y - spatialGrid.cellHeight / 2,
          width: spatialGrid.cellWidth,
          height: spatialGrid.cellHeight,
        })
      : null;

  const scaleBarUm = chooseScaleBarUm(viewportBox.width);
  const scaleBarPx = Math.max(
    24,
    Math.min(
      Math.round(viewportPxWidth * 0.45),
      Math.round((scaleBarUm / viewportBox.width) * viewportPxWidth),
    ),
  );
  const viewportAspect = viewportBox.width / viewportBox.height;
  const colorbarGradient = getColormapCssGradient(colormap, 'to right');

  return (
    <section
      aria-label="2D Raman Map and White-Light Optical Overlay"
      data-testid="spatial-map-overlay"
      className="bg-white border border-slate-200 rounded overflow-hidden"
    >
      {/* Header Bar */}
      <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <Layers className="w-3.5 h-3.5 text-blue-600 shrink-0" aria-hidden="true" />
          <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wider shrink-0">
            2D Raman Map Overlay
          </h2>
          <span className="text-[11px] font-mono tabular-nums text-slate-600">
            {spatialGrid.cols} × {spatialGrid.rows} ({spatialGrid.bounds.width.toFixed(1)} ×{' '}
            {spatialGrid.bounds.height.toFixed(1)} {spatialGrid.unitSymbol})
          </span>
          {whiteLightMeta?.magnification && (
            <span className="hidden sm:inline text-[11px] font-mono text-slate-500">
              · {whiteLightMeta.magnification}× Optical FOV
            </span>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Map Data Source Switcher */}
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

          {/* Framing Toggle (when calibrated white-light image is present) */}
          {hasWhiteLight && whiteLightMeta?.hasCalibration && (
            <div
              className="inline-flex border border-slate-200 rounded bg-white p-0.5 text-[11px]"
              role="group"
              aria-label="Map viewport framing"
            >
              <button
                type="button"
                onClick={() => {
                  setFramingMode('fit-map');
                  setZoomFactor(1);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs font-medium cursor-pointer transition-colors ${
                  framingMode === 'fit-map'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
                title="Frame tightly around the 2D Raman scan with surrounding optical context"
              >
                <Scan className="w-3 h-3" aria-hidden="true" />
                <span>Fit Map</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setFramingMode('full-optical');
                  setZoomFactor(1);
                }}
                className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-xs font-medium cursor-pointer transition-colors ${
                  framingMode === 'full-optical'
                    ? 'bg-slate-800 text-white'
                    : 'text-slate-600 hover:bg-slate-100'
                }`}
                title="Show the entire calibrated white-light optical micrograph"
              >
                <Maximize2 className="w-3 h-3" aria-hidden="true" />
                <span>Full Optical</span>
              </button>
            </div>
          )}

          {/* Highlight integration window on spectrum plot */}
          {activeSeries.firstLimit !== null && activeSeries.secondLimit !== null && (
            <button
              type="button"
              onClick={() => setShowWindowOnSpectrum((v) => !v)}
              title="Highlight the integration X range on the spectrum plot above"
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
              <span>Window</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleExportPng}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-700 cursor-pointer transition-colors"
            title="Download composited overlay image as PNG"
          >
            <ImageIcon className="w-3 h-3" aria-hidden="true" />
            <span>PNG</span>
          </button>

          <button
            type="button"
            onClick={handleExportCsv}
            className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-100 text-[11px] font-medium text-slate-700 cursor-pointer transition-colors"
            title="Export 2D spatial coordinates and map values as CSV"
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
            <label htmlFor="spatial-map-from-x" className="text-[11px] font-medium text-slate-600">
              From X
            </label>
            <input
              id="spatial-map-from-x"
              type="number"
              step="any"
              value={customFromStr}
              onChange={(e) => setCustomFromStr(e.target.value)}
              className="w-24 px-2 py-1 text-xs font-mono tabular-nums bg-white border border-slate-300 rounded focus:outline-none focus:border-blue-500"
            />
          </div>
          <div className="flex items-center gap-1.5">
            <label htmlFor="spatial-map-to-x" className="text-[11px] font-medium text-slate-600">
              To X
            </label>
            <input
              id="spatial-map-to-x"
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
            <label htmlFor="spatial-map-mode" className="text-[11px] font-medium text-slate-600">
              Method
            </label>
            <select
              id="spatial-map-mode"
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

      {/* Dual-Layer Visibility & Transparency Control Bar */}
      <div className="px-4 py-2.5 bg-white border-b border-slate-200 flex flex-wrap items-center justify-between gap-x-5 gap-y-2.5">
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          {/* Layer 1: White-Light Optical Layer */}
          {hasWhiteLight && (
            <div className="flex items-center gap-2.5" data-testid="layer-control-optical">
              <button
                type="button"
                onClick={() => setOpticalVisible((v) => !v)}
                aria-pressed={opticalVisible}
                data-testid="toggle-optical-layer"
                title={opticalVisible ? 'Hide White-Light Optical Layer' : 'Show White-Light Optical Layer'}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors ${
                  opticalVisible
                    ? 'border-slate-300 bg-slate-800 text-white hover:bg-slate-700'
                    : 'border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
                }`}
              >
                {opticalVisible ? (
                  <Eye className="w-3.5 h-3.5" aria-hidden="true" />
                ) : (
                  <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                <span>White-Light</span>
              </button>

              <div className="flex items-center gap-2">
                <label
                  htmlFor="optical-opacity-slider"
                  className="text-[11px] font-medium text-slate-500 sr-only"
                >
                  White-Light Opacity
                </label>
                <input
                  id="optical-opacity-slider"
                  data-testid="optical-opacity-slider"
                  type="range"
                  min={0}
                  max={100}
                  step={1}
                  value={opticalOpacity}
                  disabled={!opticalVisible}
                  onChange={(e) => setOpticalOpacity(Number(e.target.value))}
                  className="w-24 sm:w-28 accent-slate-700 disabled:opacity-40 cursor-pointer"
                  title="White-light optical image opacity"
                />
                <span
                  className={`text-[11px] font-mono tabular-nums w-9 text-right ${
                    opticalVisible ? 'text-slate-700 font-medium' : 'text-slate-400'
                  }`}
                >
                  {opticalVisible ? `${opticalOpacity}%` : 'Off'}
                </span>
              </div>
            </div>
          )}

          {hasWhiteLight && <div className="hidden sm:block h-5 w-px bg-slate-200" aria-hidden="true" />}

          {/* Layer 2: 2D Raman Map Layer */}
          <div className="flex items-center gap-2.5" data-testid="layer-control-raman">
            <button
              type="button"
              onClick={() => setRamanVisible((v) => !v)}
              aria-pressed={ramanVisible}
              data-testid="toggle-raman-layer"
              title={ramanVisible ? 'Hide 2D Raman Map Layer' : 'Show 2D Raman Map Layer'}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded border text-xs font-medium cursor-pointer transition-colors ${
                ramanVisible
                  ? 'border-blue-600 bg-blue-600 text-white hover:bg-blue-700'
                  : 'border-slate-200 bg-slate-50 text-slate-400 hover:text-slate-700 hover:bg-slate-100'
              }`}
            >
              {ramanVisible ? (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              )}
              <span>Raman Map</span>
            </button>

            <div className="flex items-center gap-2">
              <label
                htmlFor="raman-opacity-slider"
                className="text-[11px] font-medium text-slate-500 sr-only"
              >
                Raman Map Opacity
              </label>
              <input
                id="raman-opacity-slider"
                data-testid="raman-opacity-slider"
                type="range"
                min={0}
                max={100}
                step={1}
                value={ramanOpacity}
                disabled={!ramanVisible}
                onChange={(e) => setRamanOpacity(Number(e.target.value))}
                className="w-24 sm:w-28 accent-blue-600 disabled:opacity-40 cursor-pointer"
                title="2D Raman map overlay opacity"
              />
              <span
                className={`text-[11px] font-mono tabular-nums w-9 text-right ${
                  ramanVisible ? 'text-blue-700 font-medium' : 'text-slate-400'
                }`}
              >
                {ramanVisible ? `${ramanOpacity}%` : 'Off'}
              </span>
            </div>
          </div>
        </div>

        {/* Display Styling Controls */}
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          <label className="inline-flex items-center gap-1.5 text-slate-600">
            <span className="font-medium">Palette</span>
            <select
              aria-label="Raman map colormap"
              value={colormap}
              onChange={(e) => setColormap(e.target.value as MapColormapId)}
              className="px-2 py-1 text-[11px] bg-white border border-slate-200 rounded text-slate-700 focus:outline-none focus:border-blue-500 cursor-pointer"
            >
              {MAP_COLORMAPS.map((cm) => (
                <option key={cm.id} value={cm.id}>
                  {cm.label}
                </option>
              ))}
            </select>
          </label>

          <button
            type="button"
            onClick={() => setSmoothPixels((v) => !v)}
            className={`px-2 py-1 rounded border font-medium cursor-pointer transition-colors ${
              smoothPixels
                ? 'border-blue-300 bg-blue-50 text-blue-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
            }`}
            title="Toggle between crisp discrete pixels and smooth bilinear interpolation"
          >
            {smoothPixels ? 'Smooth' : 'Crisp Pixels'}
          </button>

          <button
            type="button"
            onClick={() => setShowOutline((v) => !v)}
            className={`px-2 py-1 rounded border font-medium cursor-pointer transition-colors ${
              showOutline
                ? 'border-sky-300 bg-sky-50 text-sky-700'
                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-100'
            }`}
            title="Show dashed scan footprint outline on the optical image"
          >
            Outline
          </button>

          <div className="inline-flex border border-slate-200 rounded bg-white p-0.5">
            <button
              type="button"
              onClick={() => setZoomFactor((z) => Math.max(1, Number((z / 1.4).toFixed(2))))}
              disabled={zoomFactor <= 1}
              aria-label="Zoom out 2D map"
              title="Zoom out"
              className="p-1 rounded-xs text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
            >
              <ZoomOut className="w-3 h-3" aria-hidden="true" />
            </button>
            <span className="px-1.5 py-0.5 font-mono tabular-nums text-slate-600">
              {zoomFactor.toFixed(1)}×
            </span>
            <button
              type="button"
              onClick={() => setZoomFactor((z) => Math.min(6, Number((z * 1.4).toFixed(2))))}
              disabled={zoomFactor >= 6}
              aria-label="Zoom in 2D map"
              title="Zoom in"
              className="p-1 rounded-xs text-slate-600 hover:bg-slate-100 disabled:opacity-35 cursor-pointer"
            >
              <ZoomIn className="w-3 h-3" aria-hidden="true" />
            </button>
          </div>
        </div>
      </div>

      {/* Live Coordinate & Pixel Readout Bar */}
      <div className="px-4 py-1.5 border-b border-slate-100 bg-slate-50/70 flex flex-wrap items-center justify-between gap-2 text-xs font-mono tabular-nums">
        {inspectedCell ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-slate-800">
            <span>
              <span className="text-slate-500">{hoverCell ? 'Cursor:' : 'Selected:'}</span>{' '}
              <span className="font-semibold text-slate-900">
                Scan #{inspectedCell.spectrumIndex + 1} / {totalSpectra}
              </span>
            </span>
            <span>
              <span className="text-slate-500">XY:</span>{' '}
              <span className="font-medium">
                ({inspectedCell.x.toFixed(2)}, {inspectedCell.y.toFixed(2)}) {spatialGrid.unitSymbol}
              </span>
            </span>
            <span>
              <span className="text-slate-500">Grid:</span>{' '}
              <span>
                [{inspectedCell.col + 1}, {inspectedCell.row + 1}]
              </span>
            </span>
            <span>
              <span className="text-slate-500">Value:</span>{' '}
              <span className="font-semibold text-blue-700">
                {formatMapValue(inspectedCell.value)}
              </span>
            </span>
          </div>
        ) : (
          <span className="text-slate-500">
            Hover or click any pixel inside the 2D Raman map to inspect its spectrum above
          </span>
        )}
        <span className="text-[11px] text-slate-500">
          {activeSeries.subtitle}
          {hasWhiteLight && !whiteLightMeta?.hasCalibration ? ' · Uncalibrated FOV' : ''}
        </span>
      </div>

      {/* Calibrated Dual-Layer Spatial Viewport */}
      <div className="p-4 bg-slate-100/80 flex flex-col items-center gap-3">
        <div
          ref={viewportRef}
          data-testid="spatial-map-viewport"
          onPointerMove={handlePointerMove}
          onPointerLeave={() => setHoverCell(null)}
          onClick={handleClick}
          className="relative w-full max-w-[880px] max-h-[460px] overflow-hidden rounded border border-slate-300 bg-slate-900 shadow-xs select-none cursor-crosshair"
          style={{
            aspectRatio: `${viewportAspect.toFixed(5)}`,
          }}
        >
          {/* Checkerboard subtle dark backing visible if both layers are turned down */}
          <div
            className="absolute inset-0 pointer-events-none opacity-20"
            style={{
              backgroundImage:
                'linear-gradient(45deg, #334155 25%, transparent 25%), linear-gradient(-45deg, #334155 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #334155 75%), linear-gradient(-45deg, transparent 75%, #334155 75%)',
              backgroundSize: '16px 16px',
              backgroundPosition: '0 0, 0 8px, 8px -8px, -8px 0px',
            }}
          />

          {/* LAYER 1: Embedded White-Light Optical Micrograph */}
          {hasWhiteLight && whiteLightUrl && opticalStyle && (
            <img
              ref={imgRef}
              src={whiteLightUrl}
              alt="Calibrated Renishaw white-light optical micrograph"
              data-testid="optical-image-layer"
              draggable={false}
              className="absolute max-w-none pointer-events-none transition-opacity duration-75"
              style={{
                left: opticalStyle.left,
                top: opticalStyle.top,
                width: opticalStyle.width,
                height: opticalStyle.height,
                opacity: opticalVisible ? opticalOpacity / 100 : 0,
              }}
            />
          )}

          {/* LAYER 2: 2D Raman Intensity Heatmap Canvas */}
          {ramanStyle && (
            <canvas
              ref={heatmapCanvasRef}
              data-testid="raman-heatmap-layer"
              className="absolute pointer-events-none transition-opacity duration-75"
              style={{
                left: ramanStyle.left,
                top: ramanStyle.top,
                width: ramanStyle.width,
                height: ramanStyle.height,
                opacity: ramanVisible ? ramanOpacity / 100 : 0,
                imageRendering: smoothPixels ? 'auto' : 'pixelated',
              }}
            />
          )}

          {/* Dashed Scan Footprint Outline (stays helpful even when Raman opacity = 0%) */}
          {showOutline && ramanStyle && (
            <div
              className="absolute pointer-events-none border border-dashed border-sky-400/90 shadow-[0_0_0_1px_rgba(15,23,42,0.55)]"
              style={{
                left: ramanStyle.left,
                top: ramanStyle.top,
                width: ramanStyle.width,
                height: ramanStyle.height,
              }}
            />
          )}

          {/* Hovered Cell Highlight */}
          {hoverCellStyle && (
            <div
              className="absolute pointer-events-none border border-white/95 shadow-[0_0_0_1px_rgba(15,23,42,0.8)]"
              style={{
                left: hoverCellStyle.left,
                top: hoverCellStyle.top,
                width: hoverCellStyle.width,
                height: hoverCellStyle.height,
              }}
            />
          )}

          {/* Active Selected Spectrum Reticle */}
          {selectedCellStyle && (
            <div
              data-testid="selected-pixel-reticle"
              className="absolute pointer-events-none border-2 border-cyan-300 shadow-[0_0_0_1.5px_rgba(15,23,42,0.9)]"
              style={{
                left: selectedCellStyle.left,
                top: selectedCellStyle.top,
                width: selectedCellStyle.width,
                height: selectedCellStyle.height,
              }}
            />
          )}

          {/* Subtle Top-Left FOV & Layer Badge */}
          <div className="absolute top-2.5 left-2.5 pointer-events-none px-2 py-1 rounded bg-slate-950/70 text-[10px] font-mono text-slate-100 backdrop-blur-[2px]">
            FOV {viewportBox.width.toFixed(1)} × {viewportBox.height.toFixed(1)} {spatialGrid.unitSymbol}
          </div>

          {/* Calibrated Physical Scale Bar (Bottom-Right) */}
          <div className="absolute bottom-2.5 right-2.5 pointer-events-none flex flex-col items-end gap-1 px-2 py-1 rounded bg-slate-950/70 backdrop-blur-[2px]">
            <span className="text-[10px] font-mono font-medium text-white tabular-nums leading-none">
              {scaleBarUm} {spatialGrid.unitSymbol}
            </span>
            <div
              className="h-1 bg-white rounded-xs shadow-xs"
              style={{
                width: `${scaleBarPx}px`,
              }}
            />
          </div>
        </div>

        {/* Calibrated Intensity Colorbar & Quick Min/Max Jump Strip */}
        <div className="w-full max-w-[880px] flex flex-col sm:flex-row sm:items-center justify-between gap-3 px-1">
          <div className="flex-1 flex items-center gap-2.5 min-w-0">
            <span className="text-[11px] font-mono tabular-nums text-slate-600 shrink-0">
              {formatMapValue(spatialGrid.minVal)}
            </span>
            <div
              className="flex-1 h-2.5 rounded-xs border border-slate-300"
              style={{ backgroundImage: colorbarGradient }}
              aria-label={`Intensity scale from ${formatMapValue(spatialGrid.minVal)} to ${formatMapValue(spatialGrid.maxVal)}`}
            />
            <span className="text-[11px] font-mono tabular-nums text-slate-900 font-semibold shrink-0">
              {formatMapValue(spatialGrid.maxVal)}
            </span>
          </div>

          <div className="flex items-center gap-3 text-[11px] font-mono tabular-nums text-slate-600 shrink-0">
            <button
              type="button"
              onClick={() => onSelectSpectrum(spatialGrid.minSpectrumIndex)}
              className="hover:text-blue-600 hover:underline cursor-pointer"
              title={`Jump to minimum map pixel (Scan #${spatialGrid.minSpectrumIndex + 1})`}
            >
              Min: #{spatialGrid.minSpectrumIndex + 1}
            </button>
            <span className="text-slate-300">|</span>
            <button
              type="button"
              onClick={() => onSelectSpectrum(spatialGrid.maxSpectrumIndex)}
              className="hover:text-blue-600 hover:underline cursor-pointer font-semibold text-slate-800"
              title={`Jump to maximum map pixel (Scan #${spatialGrid.maxSpectrumIndex + 1})`}
            >
              Peak: #{spatialGrid.maxSpectrumIndex + 1}
            </button>
            <span className="text-slate-300">|</span>
            <span>Mean: {formatMapValue(spatialGrid.meanVal)}</span>
          </div>
        </div>
      </div>
    </section>
  );
}
