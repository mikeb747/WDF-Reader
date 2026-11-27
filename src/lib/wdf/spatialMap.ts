/**
 * 2D Raman spatial map geometry, Renishaw WHTL white-light EXIF calibration parser,
 * and perceptually uniform colormap utilities.
 * Zero external dependencies — works in both Node.js and browser environments.
 */

import { WdfDataType, WdfDataUnits, WdfMapAreaFlag, type WdfFile } from './types';

export interface WhiteLightSpatialMeta {
  /** Native optical image pixel width, if decoded from JPEG/PNG/BMP header. */
  pixelWidth: number | null;
  /** Native optical image pixel height, if decoded from JPEG/PNG/BMP header. */
  pixelHeight: number | null;
  /** Top-left stage X coordinate of the optical image in micrometres (EXIF tag 0xFEA0[0]). */
  originXUm: number | null;
  /** Top-left stage Y coordinate of the optical image in micrometres (EXIF tag 0xFEA0[1]). */
  originYUm: number | null;
  /** Physical width of the optical field of view on the sample in micrometres. */
  widthUm: number | null;
  /** Physical height of the optical field of view on the sample in micrometres. */
  heightUm: number | null;
  /** Objective magnification recorded in EXIF tag 0xFEA2, if present. */
  magnification: number | null;
  /** True when originXUm, originYUm, widthUm, and heightUm are all valid finite values. */
  hasCalibration: boolean;
}

export interface SpatialCell2D {
  spectrumIndex: number;
  col: number;
  row: number;
  /** Stage X center coordinate in micrometres (or native spatial unit). */
  x: number;
  /** Stage Y center coordinate in micrometres (or native spatial unit). */
  y: number;
  value: number;
}

export interface SpatialGrid2D {
  cols: number;
  rows: number;
  /** Physical width of each spatial pixel in micrometres. */
  cellWidth: number;
  /** Physical height of each spatial pixel in micrometres. */
  cellHeight: number;
  /** Outer bounding box of all map cells (including half-cell margins on all four sides). */
  bounds: {
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    width: number;
    height: number;
  };
  /** Sorted unique X column centers (ascending, left → right). */
  xCoords: number[];
  /** Sorted unique Y row centers (ascending, matching Renishaw image-top → image-bottom Y). */
  yCoords: number[];
  /** Flat array of length `rows * cols` indexed by `row * cols + col` (null for empty/uncollected cells). */
  grid: Array<SpatialCell2D | null>;
  /** All valid cells in spectrum order. */
  cells: SpatialCell2D[];
  /** Lookup from spectrumIndex to cell. */
  bySpectrumIndex: Map<number, SpatialCell2D>;
  minVal: number;
  maxVal: number;
  minSpectrumIndex: number;
  maxSpectrumIndex: number;
  meanVal: number;
  unitSymbol: string;
  coordinateSource: 'ORGN' | 'WMAP';
}

export type MapColormapId = 'inferno' | 'viridis' | 'turbo' | 'thermal' | 'grayscale';

export interface MapColormapDef {
  id: MapColormapId;
  label: string;
  stops: ReadonlyArray<readonly [number, number, number]>;
}

export const MAP_COLORMAPS: ReadonlyArray<MapColormapDef> = [
  {
    id: 'inferno',
    label: 'Inferno',
    stops: [
      [0, 0, 4],
      [40, 11, 84],
      [101, 21, 110],
      [159, 42, 99],
      [212, 72, 66],
      [245, 125, 21],
      [250, 193, 39],
      [252, 255, 164],
    ],
  },
  {
    id: 'viridis',
    label: 'Viridis',
    stops: [
      [68, 1, 84],
      [71, 44, 122],
      [59, 81, 139],
      [44, 113, 142],
      [33, 144, 141],
      [39, 173, 129],
      [92, 200, 99],
      [170, 220, 50],
      [253, 231, 37],
    ],
  },
  {
    id: 'turbo',
    label: 'Rainbow (Turbo)',
    stops: [
      [48, 18, 59],
      [67, 90, 205],
      [38, 166, 226],
      [49, 224, 152],
      [149, 248, 71],
      [234, 215, 45],
      [251, 134, 34],
      [212, 52, 22],
      [122, 4, 3],
    ],
  },
  {
    id: 'thermal',
    label: 'Thermal (Red-Yellow)',
    stops: [
      [12, 8, 22],
      [96, 12, 34],
      [182, 28, 24],
      [235, 96, 16],
      [252, 184, 34],
      [255, 250, 210],
    ],
  },
  {
    id: 'grayscale',
    label: 'Grayscale',
    stops: [
      [10, 10, 14],
      [128, 128, 132],
      [250, 250, 252],
    ],
  },
];

const COLORMAP_LOOKUP = new Map<MapColormapId, MapColormapDef>(
  MAP_COLORMAPS.map((c) => [c.id, c]),
);

export function sampleColormapRgb(
  colormapId: MapColormapId,
  t: number,
): [number, number, number] {
  const def = COLORMAP_LOOKUP.get(colormapId) ?? MAP_COLORMAPS[0];
  const clamped = Number.isFinite(t) ? Math.max(0, Math.min(1, t)) : 0;
  const stops = def.stops;
  const scaled = clamped * (stops.length - 1);
  const idx = Math.min(stops.length - 2, Math.floor(scaled));
  const frac = scaled - idx;
  const c0 = stops[idx];
  const c1 = stops[idx + 1];
  return [
    Math.round(c0[0] + (c1[0] - c0[0]) * frac),
    Math.round(c0[1] + (c1[1] - c0[1]) * frac),
    Math.round(c0[2] + (c1[2] - c0[2]) * frac),
  ];
}

export function getColormapCssGradient(
  colormapId: MapColormapId,
  direction: 'to right' | 'to top' = 'to right',
): string {
  const def = COLORMAP_LOOKUP.get(colormapId) ?? MAP_COLORMAPS[0];
  const stops = def.stops
    .map((rgb, i) => {
      const pct = ((i / (def.stops.length - 1)) * 100).toFixed(1);
      return `rgb(${rgb[0]}, ${rgb[1]}, ${rgb[2]}) ${pct}%`;
    })
    .join(', ');
  return `linear-gradient(${direction}, ${stops})`;
}

/**
 * Convert Renishaw FocalPlaneResolutionUnit (WdfDataUnits) multiplier into micrometres.
 */
function resolutionUnitToMicronFactor(unit: number | null): number {
  switch (unit) {
    case WdfDataUnits.Micron:
      return 1;
    case WdfDataUnits.Millimetres:
      return 1000;
    case WdfDataUnits.Metres:
      return 1_000_000;
    default:
      // Renishaw WDF EXIF defaults to micrometres
      return 1;
  }
}

function readShortFromIfdEntry(
  dv: DataView,
  entryOffset: number,
  littleEndian: boolean,
): number {
  return dv.getUint16(entryOffset + 8, littleEndian);
}

function readRationalsFromIfdEntry(
  dv: DataView,
  tiffStart: number,
  tiffLimit: number,
  entryOffset: number,
  type: number,
  count: number,
  littleEndian: boolean,
): number[] {
  const valOff = dv.getUint32(entryOffset + 8, littleEndian);
  const out: number[] = [];
  for (let i = 0; i < count; i++) {
    const pos = tiffStart + valOff + i * 8;
    if (pos + 8 > tiffLimit) break;
    const num = type === 10 ? dv.getInt32(pos, littleEndian) : dv.getUint32(pos, littleEndian);
    const den = type === 10 ? dv.getInt32(pos + 4, littleEndian) : dv.getUint32(pos + 4, littleEndian);
    if (den !== 0) {
      out.push(num / den);
    }
  }
  return out;
}

/**
 * Parse embedded Renishaw WHTL image dimensions and EXIF spatial calibration tags.
 *
 * Renishaw WiRE encodes white-light microscope stage registration inside JPEG APP1 EXIF:
 * - IFD0 `0xFEA0` (SRATIONAL[2]): top-left stage origin `(originX, originY)` in µm
 * - IFD0 `0xFEA1` (SRATIONAL[2]): camera focal plane sensor size `(sensorW, sensorH)` in µm
 * - IFD0 `0xFEA2` (SRATIONAL[1]): objective magnification
 * - ExifIFD `0xA20E` / `0xA20F` (RATIONAL): sample field-of-view width & height (`sensorSize / mag`)
 * - ExifIFD `0xA210` (SHORT): Renishaw unit enum (`5` = µm, `8` = mm, `9` = m)
 */
export function parseWhiteLightExif(bytes: Uint8Array): WhiteLightSpatialMeta | null {
  if (!bytes || bytes.byteLength < 12) return null;
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  // PNG fallback (dimensions only)
  if (
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes.byteLength >= 24
  ) {
    return {
      pixelWidth: dv.getUint32(16, false),
      pixelHeight: dv.getUint32(20, false),
      originXUm: null,
      originYUm: null,
      widthUm: null,
      heightUm: null,
      magnification: null,
      hasCalibration: false,
    };
  }

  // BMP fallback (dimensions only)
  if (bytes[0] === 0x42 && bytes[1] === 0x4d && bytes.byteLength >= 26) {
    return {
      pixelWidth: Math.abs(dv.getInt32(18, true)),
      pixelHeight: Math.abs(dv.getInt32(22, true)),
      originXUm: null,
      originYUm: null,
      widthUm: null,
      heightUm: null,
      magnification: null,
      hasCalibration: false,
    };
  }

  // JPEG SOI check
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    return null;
  }

  let pixelWidth: number | null = null;
  let pixelHeight: number | null = null;
  let originXRaw: number | null = null;
  let originYRaw: number | null = null;
  let focalPlaneWidthRaw: number | null = null;
  let focalPlaneHeightRaw: number | null = null;
  let sensorWidthRaw: number | null = null;
  let sensorHeightRaw: number | null = null;
  let magnification: number | null = null;
  let resolutionUnit: number | null = null;

  let pos = 2;
  while (pos + 4 <= bytes.byteLength) {
    if (bytes[pos] !== 0xff) break;
    // Skip fill 0xFF bytes
    while (pos < bytes.byteLength && bytes[pos] === 0xff) pos++;
    if (pos >= bytes.byteLength) break;

    const marker = bytes[pos];
    pos++;

    // EOI / SOS end header scanning
    if (marker === 0xd9 || marker === 0xda) break;
    // Standalone markers without length
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) continue;

    if (pos + 2 > bytes.byteLength) break;
    const segLen = dv.getUint16(pos, false);
    if (segLen < 2 || pos + segLen > bytes.byteLength) break;
    const segDataStart = pos + 2;
    const segEnd = pos + segLen;

    // SOF0..SOF3, SOF5..SOF7, SOF9..SOF11, SOF13..SOF15 -> image dimensions
    const isSof =
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf);
    if (isSof && segDataStart + 5 <= segEnd && pixelWidth === null) {
      pixelHeight = dv.getUint16(segDataStart + 1, false);
      pixelWidth = dv.getUint16(segDataStart + 3, false);
    }

    // APP1 EXIF segment
    if (
      marker === 0xe1 &&
      segDataStart + 14 <= segEnd &&
      bytes[segDataStart] === 0x45 && // 'E'
      bytes[segDataStart + 1] === 0x78 && // 'x'
      bytes[segDataStart + 2] === 0x69 && // 'i'
      bytes[segDataStart + 3] === 0x66 && // 'f'
      bytes[segDataStart + 4] === 0x00 &&
      bytes[segDataStart + 5] === 0x00
    ) {
      const tiffStart = segDataStart + 6;
      const byteOrder0 = bytes[tiffStart];
      const byteOrder1 = bytes[tiffStart + 1];
      const littleEndian = byteOrder0 === 0x49 && byteOrder1 === 0x49;
      const bigEndian = byteOrder0 === 0x4d && byteOrder1 === 0x4d;

      if (littleEndian || bigEndian) {
        const magic = dv.getUint16(tiffStart + 2, littleEndian);
        if (magic === 42) {
          const ifd0Offset = dv.getUint32(tiffStart + 4, littleEndian);
          const ifd0Start = tiffStart + ifd0Offset;

          if (ifd0Start + 2 <= segEnd) {
            const ifd0Count = dv.getUint16(ifd0Start, littleEndian);
            let exifIfdOffset: number | null = null;

            for (let i = 0; i < ifd0Count; i++) {
              const entryOffset = ifd0Start + 2 + i * 12;
              if (entryOffset + 12 > segEnd) break;
              const tag = dv.getUint16(entryOffset, littleEndian);
              const type = dv.getUint16(entryOffset + 2, littleEndian);
              const count = dv.getUint32(entryOffset + 4, littleEndian);

              if (tag === 0x8769) {
                exifIfdOffset = dv.getUint32(entryOffset + 8, littleEndian);
              } else if (tag === 0xfea0 && (type === 10 || type === 5) && count >= 2) {
                const vals = readRationalsFromIfdEntry(
                  dv,
                  tiffStart,
                  segEnd,
                  entryOffset,
                  type,
                  2,
                  littleEndian,
                );
                if (vals.length === 2) {
                  originXRaw = vals[0];
                  originYRaw = vals[1];
                }
              } else if (tag === 0xfea1 && (type === 10 || type === 5) && count >= 2) {
                const vals = readRationalsFromIfdEntry(
                  dv,
                  tiffStart,
                  segEnd,
                  entryOffset,
                  type,
                  2,
                  littleEndian,
                );
                if (vals.length === 2) {
                  sensorWidthRaw = vals[0];
                  sensorHeightRaw = vals[1];
                }
              } else if (tag === 0xfea2 && (type === 10 || type === 5) && count >= 1) {
                const vals = readRationalsFromIfdEntry(
                  dv,
                  tiffStart,
                  segEnd,
                  entryOffset,
                  type,
                  1,
                  littleEndian,
                );
                if (vals.length >= 1 && vals[0] > 0) {
                  magnification = vals[0];
                }
              }
            }

            if (exifIfdOffset !== null) {
              const exifStart = tiffStart + exifIfdOffset;
              if (exifStart + 2 <= segEnd) {
                const exifCount = dv.getUint16(exifStart, littleEndian);
                for (let k = 0; k < exifCount; k++) {
                  const entryOffset = exifStart + 2 + k * 12;
                  if (entryOffset + 12 > segEnd) break;
                  const tag = dv.getUint16(entryOffset, littleEndian);
                  const type = dv.getUint16(entryOffset + 2, littleEndian);
                  const count = dv.getUint32(entryOffset + 4, littleEndian);

                  if (tag === 0xa20e && (type === 5 || type === 10) && count >= 1) {
                    const vals = readRationalsFromIfdEntry(
                      dv,
                      tiffStart,
                      segEnd,
                      entryOffset,
                      type,
                      1,
                      littleEndian,
                    );
                    if (vals.length >= 1) focalPlaneWidthRaw = vals[0];
                  } else if (tag === 0xa20f && (type === 5 || type === 10) && count >= 1) {
                    const vals = readRationalsFromIfdEntry(
                      dv,
                      tiffStart,
                      segEnd,
                      entryOffset,
                      type,
                      1,
                      littleEndian,
                    );
                    if (vals.length >= 1) focalPlaneHeightRaw = vals[0];
                  } else if (tag === 0xa210 && type === 3) {
                    resolutionUnit = readShortFromIfdEntry(dv, entryOffset, littleEndian);
                  }
                }
              }
            }
          }
        }
      }
    }

    pos = segEnd;
  }

  const factor = resolutionUnitToMicronFactor(resolutionUnit);
  let widthUm: number | null =
    focalPlaneWidthRaw !== null && Number.isFinite(focalPlaneWidthRaw) && focalPlaneWidthRaw !== 0
      ? Math.abs(focalPlaneWidthRaw) * factor
      : null;
  let heightUm: number | null =
    focalPlaneHeightRaw !== null && Number.isFinite(focalPlaneHeightRaw) && focalPlaneHeightRaw !== 0
      ? Math.abs(focalPlaneHeightRaw) * factor
      : null;

  // Fallback: derive sample FOV from sensor focal-plane size / magnification
  if (
    (widthUm === null || heightUm === null) &&
    sensorWidthRaw !== null &&
    sensorHeightRaw !== null &&
    magnification !== null &&
    magnification > 0
  ) {
    widthUm = Math.abs(sensorWidthRaw / magnification) * factor;
    heightUm = Math.abs(sensorHeightRaw / magnification) * factor;
  }

  const originXUm = originXRaw !== null && Number.isFinite(originXRaw) ? originXRaw * factor : null;
  const originYUm = originYRaw !== null && Number.isFinite(originYRaw) ? originYRaw * factor : null;

  const hasCalibration =
    originXUm !== null &&
    originYUm !== null &&
    widthUm !== null &&
    heightUm !== null &&
    widthUm > 0 &&
    heightUm > 0;

  return {
    pixelWidth,
    pixelHeight,
    originXUm,
    originYUm,
    widthUm,
    heightUm,
    magnification,
    hasCalibration,
  };
}

/**
 * Cluster nearly-identical floating-point stage coordinates into sorted canonical unique values.
 */
function extractUniqueCoords(values: number[], tol = 1e-3): number[] {
  const finite = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (finite.length === 0) return [];
  const groups: number[] = [];
  let sum = finite[0];
  let cnt = 1;
  let anchor = finite[0];
  for (let i = 1; i < finite.length; i++) {
    if (Math.abs(finite[i] - anchor) <= tol) {
      sum += finite[i];
      cnt++;
    } else {
      groups.push(sum / cnt);
      anchor = finite[i];
      sum = finite[i];
      cnt = 1;
    }
  }
  groups.push(sum / cnt);
  return groups;
}

function medianPositiveStep(sortedCoords: number[], fallback: number): number {
  if (sortedCoords.length < 2) return fallback;
  const diffs: number[] = [];
  for (let i = 1; i < sortedCoords.length; i++) {
    const d = sortedCoords[i] - sortedCoords[i - 1];
    if (d > 1e-6) diffs.push(d);
  }
  if (diffs.length === 0) return fallback;
  diffs.sort((a, b) => a - b);
  return diffs[Math.floor(diffs.length / 2)];
}

function findNearestCoordIndex(sortedCoords: number[], target: number): number {
  let lo = 0;
  let hi = sortedCoords.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sortedCoords[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sortedCoords[lo - 1] - target) < Math.abs(sortedCoords[lo] - target)) {
    return lo - 1;
  }
  return lo;
}

/**
 * Determine whether a parsed WDF file represents a 2D spatial Raman map
 * (either via WMAP X/Y dimensions > 1 or via ORGN SpatialX + SpatialY origins).
 */
export function isSpatialMap2D(wdf: WdfFile): boolean {
  const totalSpectra = Math.max(
    wdf.header.spectraCollected,
    wdf.header.pointsPerSpectrum > 0
      ? Math.floor(wdf.spectra.length / wdf.header.pointsPerSpectrum)
      : 0,
  );
  if (totalSpectra <= 1) return false;

  if (wdf.mapArea && wdf.mapArea.count.x > 1 && wdf.mapArea.count.y > 1) {
    return true;
  }

  const ox = wdf.origins.find((o) => o.dataType === WdfDataType.SpatialX);
  const oy = wdf.origins.find((o) => o.dataType === WdfDataType.SpatialY);
  if (ox && oy && ox.values.length > 1 && oy.values.length > 1) {
    const ux = extractUniqueCoords(ox.values.map(Number));
    const uy = extractUniqueCoords(oy.values.map(Number));
    return ux.length > 1 && uy.length > 1;
  }
  return false;
}

/**
 * Map a 1D array of per-spectrum scalar values (from an embedded WiRE `MAP ` block or
 * live spectral integration) onto a calibrated 2D stage-coordinate grid.
 */
export function buildSpatialGrid2D(
  wdf: WdfFile,
  values: Float32Array | number[],
): SpatialGrid2D | null {
  const count = values.length;
  if (count <= 1) return null;

  const originX = wdf.origins.find((o) => o.dataType === WdfDataType.SpatialX);
  const originY = wdf.origins.find((o) => o.dataType === WdfDataType.SpatialY);

  const hasOrgnCoords =
    Boolean(originX && originY) &&
    originX!.values.length >= count &&
    originY!.values.length >= count;

  let xs: number[] = [];
  let ys: number[] = [];
  let coordinateSource: 'ORGN' | 'WMAP' = 'ORGN';
  let unitSymbol = originX?.unitsSymbol || originY?.unitsSymbol || 'µm';

  if (hasOrgnCoords) {
    xs = new Array<number>(count);
    ys = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      xs[i] = Number(originX!.values[i]);
      ys[i] = Number(originY!.values[i]);
    }
    coordinateSource = 'ORGN';
  } else if (wdf.mapArea && wdf.mapArea.count.x > 1 && wdf.mapArea.count.y > 1) {
    const { startPosition, stepSize, count: dims, flags } = wdf.mapArea;
    const colMajor = (flags & WdfMapAreaFlag.ColumnMajor) !== 0;
    const alternating = (flags & WdfMapAreaFlag.Alternating) !== 0;
    const nx = dims.x;
    const ny = dims.y;

    xs = new Array<number>(count);
    ys = new Array<number>(count);
    for (let i = 0; i < count; i++) {
      let ix: number;
      let iy: number;
      if (colMajor) {
        ix = Math.floor(i / ny);
        iy = i % ny;
        if (alternating && ix % 2 === 1) {
          iy = ny - 1 - iy;
        }
      } else {
        iy = Math.floor(i / nx);
        ix = i % nx;
        if (alternating && iy % 2 === 1) {
          ix = nx - 1 - ix;
        }
      }
      xs[i] = startPosition.x + ix * stepSize.x;
      ys[i] = startPosition.y + iy * stepSize.y;
    }
    coordinateSource = 'WMAP';
    unitSymbol = 'µm';
  } else {
    return null;
  }

  const xCoords = extractUniqueCoords(xs);
  const yCoords = extractUniqueCoords(ys);
  if (xCoords.length < 2 || yCoords.length < 2) return null;

  const cols = xCoords.length;
  const rows = yCoords.length;

  const wmapStepX =
    wdf.mapArea && Number.isFinite(wdf.mapArea.stepSize.x) && Math.abs(wdf.mapArea.stepSize.x) > 1e-6
      ? Math.abs(wdf.mapArea.stepSize.x)
      : 1;
  const wmapStepY =
    wdf.mapArea && Number.isFinite(wdf.mapArea.stepSize.y) && Math.abs(wdf.mapArea.stepSize.y) > 1e-6
      ? Math.abs(wdf.mapArea.stepSize.y)
      : 1;

  const cellWidth = medianPositiveStep(xCoords, wmapStepX);
  const cellHeight = medianPositiveStep(yCoords, wmapStepY);

  const grid = new Array<SpatialCell2D | null>(rows * cols).fill(null);
  const cells: SpatialCell2D[] = [];
  const bySpectrumIndex = new Map<number, SpatialCell2D>();

  let minVal = Infinity;
  let maxVal = -Infinity;
  let minSpectrumIndex = 0;
  let maxSpectrumIndex = 0;
  let sum = 0;
  let finiteCount = 0;

  for (let i = 0; i < count; i++) {
    const val = values[i];
    const x = xs[i];
    const y = ys[i];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(val)) continue;

    const col = findNearestCoordIndex(xCoords, x);
    const row = findNearestCoordIndex(yCoords, y);
    const cell: SpatialCell2D = {
      spectrumIndex: i,
      col,
      row,
      x,
      y,
      value: val,
    };
    grid[row * cols + col] = cell;
    cells.push(cell);
    bySpectrumIndex.set(i, cell);

    if (val < minVal) {
      minVal = val;
      minSpectrumIndex = i;
    }
    if (val > maxVal) {
      maxVal = val;
      maxSpectrumIndex = i;
    }
    sum += val;
    finiteCount++;
  }

  if (finiteCount === 0) return null;

  const xMin = xCoords[0] - cellWidth / 2;
  const xMax = xCoords[cols - 1] + cellWidth / 2;
  const yMin = yCoords[0] - cellHeight / 2;
  const yMax = yCoords[rows - 1] + cellHeight / 2;

  return {
    cols,
    rows,
    cellWidth,
    cellHeight,
    bounds: {
      xMin,
      xMax,
      yMin,
      yMax,
      width: Math.max(1e-6, xMax - xMin),
      height: Math.max(1e-6, yMax - yMin),
    },
    xCoords,
    yCoords,
    grid,
    cells,
    bySpectrumIndex,
    minVal,
    maxVal,
    minSpectrumIndex,
    maxSpectrumIndex,
    meanVal: sum / finiteCount,
    unitSymbol,
    coordinateSource,
  };
}
