import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import {
  buildSpatialGrid2D,
  isSpatialMap2D,
  parseWdf,
  parseWhiteLightExif,
  sampleColormapRgb,
  WdfMapAreaFlag,
  type WdfFile,
} from './index';

const STREAMLINE_PATH = path.resolve(
  'public/assets/aistudio/532nm_1800_StreamLine_image_acquisition_fba7f15f.txt',
);
const SINGLE_SCAN_PATH = path.resolve(
  'public/assets/aistudio/532nm_1800_520scan_62354700.txt',
);

test('parseWhiteLightExif extracts Renishaw EXIF spatial bounds from real StreamLine WHTL JPEG', () => {
  const bytes = new Uint8Array(fs.readFileSync(STREAMLINE_PATH));
  const wdf = parseWdf(bytes);
  assert.ok(wdf.whiteLightImage, 'Expected embedded WHTL image');

  const meta = parseWhiteLightExif(wdf.whiteLightImage.bytes);
  assert.ok(meta, 'Expected decoded white-light metadata');
  assert.equal(meta.pixelWidth, 2352);
  assert.equal(meta.pixelHeight, 1328);
  assert.equal(meta.hasCalibration, true);
  assert.ok(Math.abs((meta.originXUm ?? 0) - -95.819) < 1e-3);
  assert.ok(Math.abs((meta.originYUm ?? 0) - -54.389) < 1e-3);
  assert.ok(Math.abs((meta.widthUm ?? 0) - 187.88) < 1e-3);
  assert.ok(Math.abs((meta.heightUm ?? 0) - 107.36) < 1e-3);
  assert.equal(meta.magnification, 50);
});

test('isSpatialMap2D distinguishes 2D StreamLine map from single-point spectrum', () => {
  const mapWdf = parseWdf(new Uint8Array(fs.readFileSync(STREAMLINE_PATH)));
  const singleWdf = parseWdf(new Uint8Array(fs.readFileSync(SINGLE_SCAN_PATH)));

  assert.equal(isSpatialMap2D(mapWdf), true);
  assert.equal(isSpatialMap2D(singleWdf), false);
});

test('buildSpatialGrid2D maps 304 StreamLine spectra onto calibrated 8x38 grid inside optical FOV', () => {
  const wdf = parseWdf(new Uint8Array(fs.readFileSync(STREAMLINE_PATH)));
  assert.ok(wdf.maps.length > 0, 'Expected embedded MAP block');

  const grid = buildSpatialGrid2D(wdf, wdf.maps[0].values);
  assert.ok(grid, 'Expected 2D spatial grid');
  assert.equal(grid.cols, 8);
  assert.equal(grid.rows, 38);
  assert.equal(grid.cells.length, 304);
  assert.equal(grid.coordinateSource, 'ORGN');
  assert.ok(Math.abs(grid.cellWidth - 1.25) < 1e-3);
  assert.ok(Math.abs(grid.cellHeight - 1.25) < 1e-3);
  assert.ok(Math.abs(grid.bounds.width - 10.0) < 1e-2);
  assert.ok(Math.abs(grid.bounds.height - 47.5) < 1e-2);

  // Verify map sits completely inside the calibrated white-light optical FOV
  const meta = parseWhiteLightExif(wdf.whiteLightImage!.bytes)!;
  assert.ok(grid.bounds.xMin >= meta.originXUm!);
  assert.ok(grid.bounds.xMax <= meta.originXUm! + meta.widthUm!);
  assert.ok(grid.bounds.yMin >= meta.originYUm!);
  assert.ok(grid.bounds.yMax <= meta.originYUm! + meta.heightUm!);

  // Verify peak intensity cell maps back cleanly to spectrumIndex
  const peakCell = grid.bySpectrumIndex.get(grid.maxSpectrumIndex);
  assert.ok(peakCell);
  assert.equal(peakCell.value, grid.maxVal);
  assert.ok(grid.maxVal > 70000);
});

test('buildSpatialGrid2D falls back to WMAP geometry with Alternating/Snake flags when ORGN absent', () => {
  const mockWdf = {
    origins: [],
    mapArea: {
      flags: WdfMapAreaFlag.Alternating,
      flagNames: ['Alternating'],
      startPosition: { x: 0, y: 0, z: 0 },
      stepSize: { x: 2, y: 3, z: 1 },
      count: { x: 3, y: 2, z: 1 },
      lineFocusSize: 0,
    },
  } as unknown as WdfFile;

  // Row 0 (left->right): (0,0)=10, (2,0)=20, (4,0)=30
  // Row 1 (right->left because Alternating): (4,3)=40, (2,3)=50, (0,3)=60
  const grid = buildSpatialGrid2D(mockWdf, [10, 20, 30, 40, 50, 60]);
  assert.ok(grid);
  assert.equal(grid.coordinateSource, 'WMAP');
  assert.equal(grid.cols, 3);
  assert.equal(grid.rows, 2);
  assert.equal(grid.grid[0 * 3 + 0]?.value, 10);
  assert.equal(grid.grid[0 * 3 + 2]?.value, 30);
  assert.equal(grid.grid[1 * 3 + 2]?.value, 40);
  assert.equal(grid.grid[1 * 3 + 0]?.value, 60);
});

test('sampleColormapRgb clamps endpoints and returns valid 8-bit RGB triples', () => {
  for (const id of ['inferno', 'viridis', 'turbo', 'thermal', 'grayscale'] as const) {
    for (const t of [-0.5, 0, 0.25, 0.5, 0.75, 1, 1.5]) {
      const [r, g, b] = sampleColormapRgb(id, t);
      assert.ok(r >= 0 && r <= 255);
      assert.ok(g >= 0 && g <= 255);
      assert.ok(b >= 0 && b <= 255);
    }
  }
});
