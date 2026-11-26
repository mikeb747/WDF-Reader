/**
 * TypeScript definitions and Renishaw WiRE Data File (.wdf) enumerations.
 * Zero external dependencies — works in both Node.js and browser environments.
 */

export enum WdfBlockId {
  WDF1 = 'WDF1',
  DATA = 'DATA',
  XLST = 'XLST',
  YLST = 'YLST',
  BKXL = 'BKXL',
  ORGN = 'ORGN',
  TEXT = 'TEXT',
  WXDA = 'WXDA',
  WXDM = 'WXDM',
  WXCS = 'WXCS',
  WXIS = 'WXIS',
  WXDB = 'WXDB',
  WMAP = 'WMAP',
  WHTL = 'WHTL',
  ZLDC = 'ZLDC',
  MAP = 'MAP ',
  WCHK = 'WCHK',
}

export enum WdfDataType {
  Arbitrary = 0,
  Spectral = 1,
  Intensity = 2,
  SpatialX = 3,
  SpatialY = 4,
  SpatialZ = 5,
  SpatialR = 6,
  SpatialTheta = 7,
  SpatialPhi = 8,
  Temperature = 9,
  Pressure = 10,
  Time = 11,
  Derived = 12,
  Polarization = 13,
  FocusTrack = 14,
  RampRate = 15,
  Checksum = 16,
  Flags = 17,
  ElapsedTime = 18,
  Frequency = 19,
  MicroplateWellSpatialX = 20,
  MicroplateWellSpatialY = 21,
  MicroplateLocationIndex = 22,
  MicroplateWellReference = 23,
  EndMarker = 24,
}

export enum WdfDataUnits {
  Arbitrary = 0,
  RamanShift = 1,
  Wavenumber = 2,
  Nanometre = 3,
  ElectronVolt = 4,
  Micron = 5,
  Counts = 6,
  Electrons = 7,
  Millimetres = 8,
  Metres = 9,
  Kelvin = 10,
  Pascal = 11,
  Seconds = 12,
  Milliseconds = 13,
  Hours = 14,
  Days = 15,
  Pixels = 16,
  Intensity = 17,
  RelativeIntensity = 18,
  Degrees = 19,
  Radians = 20,
  Celsius = 21,
  Fahrenheit = 22,
  KelvinPerMinute = 23,
  FileTime = 24,
  EndMarker = 25,
}

export enum WdfScanType {
  Unspecified = 0,
  Static = 1,
  Continuous = 2,
  StepRepeat = 3,
  FilterScan = 4,
  FilterImage = 5,
  StreamLine = 6,
  StreamLineHR = 7,
  Point = 8,
  MultitrackDiscrete = 9,
  LineFocusMapping = 10,
}

export enum WdfMeasurementType {
  Unspecified = 0,
  Single = 1,
  Series = 2,
  Mapping = 3,
}

export enum WdfHeaderFlag {
  XYXY = 1 << 0,
  Checksum = 1 << 1,
  CosmicRayRemoval = 1 << 2,
  Multitrack = 1 << 3,
  Saturation = 1 << 4,
  FileBackup = 1 << 5,
  Temporary = 1 << 6,
  Slice = 1 << 7,
  PQ = 1 << 8,
}

export enum WdfMapAreaFlag {
  RandomPoints = 1 << 0,
  ColumnMajor = 1 << 1,
  Alternating = 1 << 2,
  LineFocusMapping = 1 << 3,
  InvertedRows = 1 << 6,
  InvertedColumns = 1 << 7,
}

export const WDF_BLOCK_DESCRIPTIONS: Record<string, string> = {
  WDF1: 'Primary WDF v1 File Header',
  DATA: 'Spectral Intensity Array (Float32)',
  XLST: 'X-Axis Calibration List (Spectral)',
  YLST: 'Y-Axis List (Track / Spatial)',
  BKXL: 'Background / Absolute X-Axis List',
  ORGN: 'Data Origin Lists (Timestamps, Stage XYZ, Flags)',
  TEXT: 'User & Wizard Acquisition Comments',
  WXDA: 'WiRE Data Metadata (PSET)',
  WXDM: 'Measurement & Scan Configuration (PSET)',
  WXCS: 'Calibration & Detector Settings (PSET)',
  WXIS: 'Instrument Hardware State Snapshot (PSET)',
  WXDB: 'Per-Dataset Property Set (PSET)',
  WMAP: 'Spatial Map Area Geometry',
  WHTL: 'Embedded White-Light Optical Image',
  ZLDC: 'Zero Level & Dark Current Calibration (PSET)',
  'MAP ': 'Map / Scan Analysis Result (PSET + Float32)',
  WCHK: 'File Integrity Checksum (SHA-1)',
  CFAR: 'Curvefit Analysis Results',
  DCLS: 'Component Analysis (DCLS) Results',
  PCAR: 'PCA Analysis Results',
  INTG: 'Spectral Integration Results',
  PEAK: 'Peak Pick Results (Deprecated)',
  DISC: 'Classification Results',
  BKP0: 'Processing History — Backup Data List (.wxbak)',
  BAS0: 'Processing History — Baseline Subtraction',
  DIF0: 'Processing History — Differentiate',
  SMO0: 'Processing History — Smooth',
  TRK0: 'Processing History — Truncate',
  ZAP0: 'Processing History — Cosmic Ray Zap',
  WSP0: 'Processing History — Spectral Arithmetic',
};

export const WDF_UNIT_LABELS: Record<number, { name: string; symbol: string }> = {
  [WdfDataUnits.Arbitrary]: { name: 'Arbitrary', symbol: 'a.u.' },
  [WdfDataUnits.RamanShift]: { name: 'Raman Shift', symbol: 'cm⁻¹' },
  [WdfDataUnits.Wavenumber]: { name: 'Absolute Wavenumber', symbol: 'cm⁻¹' },
  [WdfDataUnits.Nanometre]: { name: 'Wavelength', symbol: 'nm' },
  [WdfDataUnits.ElectronVolt]: { name: 'Photon Energy', symbol: 'eV' },
  [WdfDataUnits.Micron]: { name: 'Micrometres', symbol: 'µm' },
  [WdfDataUnits.Counts]: { name: 'Counts', symbol: 'counts' },
  [WdfDataUnits.Electrons]: { name: 'Electrons', symbol: 'e⁻' },
  [WdfDataUnits.Millimetres]: { name: 'Millimetres', symbol: 'mm' },
  [WdfDataUnits.Metres]: { name: 'Metres', symbol: 'm' },
  [WdfDataUnits.Kelvin]: { name: 'Kelvin', symbol: 'K' },
  [WdfDataUnits.Pascal]: { name: 'Pascal', symbol: 'Pa' },
  [WdfDataUnits.Seconds]: { name: 'Seconds', symbol: 's' },
  [WdfDataUnits.Milliseconds]: { name: 'Milliseconds', symbol: 'ms' },
  [WdfDataUnits.Hours]: { name: 'Hours', symbol: 'h' },
  [WdfDataUnits.Days]: { name: 'Days', symbol: 'd' },
  [WdfDataUnits.Pixels]: { name: 'Pixels', symbol: 'px' },
  [WdfDataUnits.Intensity]: { name: 'Intensity', symbol: 'counts' },
  [WdfDataUnits.RelativeIntensity]: { name: 'Relative Intensity', symbol: '%' },
  [WdfDataUnits.Degrees]: { name: 'Degrees', symbol: '°' },
  [WdfDataUnits.Radians]: { name: 'Radians', symbol: 'rad' },
  [WdfDataUnits.Celsius]: { name: 'Celsius', symbol: '°C' },
  [WdfDataUnits.Fahrenheit]: { name: 'Fahrenheit', symbol: '°F' },
  [WdfDataUnits.KelvinPerMinute]: { name: 'Kelvin / min', symbol: 'K/min' },
  [WdfDataUnits.FileTime]: { name: 'Windows FILETIME', symbol: 'UTC' },
};

export function getUnitInfo(unit: number): { name: string; symbol: string } {
  return WDF_UNIT_LABELS[unit] ?? { name: `Unit(${unit})`, symbol: '' };
}

export function getDataTypeName(dataType: number): string {
  return WdfDataType[dataType] ?? `Unknown(${dataType})`;
}

export function getScanTypeName(scanType: number): string {
  return WdfScanType[scanType] ?? `Unknown(${scanType})`;
}

export function getMeasurementTypeName(measurementType: number): string {
  return WdfMeasurementType[measurementType] ?? `Unknown(${measurementType})`;
}

export type PsetPrimitive = string | number | boolean | null | Uint8Array;
export type PsetValue = PsetPrimitive | PsetValue[] | PsetObject;
export interface PsetObject {
  [key: string]: PsetValue;
}

export interface WdfBlockSummary {
  id: string;
  idHex: string;
  uid: number;
  offset: number;
  size: number;
  description: string;
  parsed: boolean;
}

export interface WdfHeader {
  signature: string;
  version: number;
  headerSize: number;
  flags: number;
  flagNames: string[];
  uuid: string;
  ntracks: number;
  status: number;
  pointsPerSpectrum: number;
  capacity: number;
  spectraCollected: number;
  accumulations: number;
  yListCount: number;
  xListCount: number;
  originCount: number;
  applicationName: string;
  applicationVersion: string;
  applicationVersionParts: [number, number, number, number];
  scanType: WdfScanType;
  scanTypeName: string;
  measurementType: WdfMeasurementType;
  measurementTypeName: string;
  timeStart: string | null;
  timeEnd: string | null;
  spectralUnits: WdfDataUnits;
  spectralUnitsName: string;
  laserWavenumber: number;
  laserWavelengthNm: number | null;
  operator: string;
  title: string;
}

export interface WdfAxisList {
  dataType: WdfDataType;
  dataTypeName: string;
  units: WdfDataUnits;
  unitsName: string;
  unitsSymbol: string;
  values: Float32Array;
}

export interface WdfOriginList {
  dataType: WdfDataType;
  dataTypeName: string;
  isPrimary: boolean;
  units: WdfDataUnits;
  unitsName: string;
  unitsSymbol: string;
  label: string;
  values: Array<number | string>;
}

export interface WdfMapArea {
  flags: number;
  flagNames: string[];
  startPosition: { x: number; y: number; z: number };
  stepSize: { x: number; y: number; z: number };
  count: { x: number; y: number; z: number };
  lineFocusSize: number;
}

export interface WdfMapResult {
  uid: number;
  label: string;
  mapType: number | null;
  analysisType: number | null;
  firstLimit: number | null;
  secondLimit: number | null;
  xListUnit: WdfDataUnits | null;
  xListUnitSymbol: string;
  xListType: WdfDataType | null;
  dataRange: [number, number] | null;
  /** Scalar analysis value per collected spectrum (e.g. integrated area under curve). */
  values: Float32Array;
  operator: string | null;
  timestamp: string | null;
  softwareVersion: string | null;
  properties: PsetObject;
}

export interface WdfWhiteLightImage {
  mimeType: string;
  byteLength: number;
  bytes: Uint8Array;
}

export interface WdfPeak {
  index: number;
  x: number;
  intensity: number;
  /** Full width at half maximum intensity (in the same units as `x`), linearly interpolated; null if half-max crossing is out of bounds. */
  fwhm: number | null;
}

export interface BaselineOptions {
  /** Smoothness penalty λ for Asymmetric Least Squares (typical range 1e3 – 1e7). Default: 1e5. */
  lambda?: number;
  /** Asymmetry weight p (0 < p < 1); smaller values hug lower valleys below peaks. Default: 0.005. */
  p?: number;
  /** Number of reweighted least-squares iterations. Default: 10. */
  iterations?: number;
}

export interface BaselineResult {
  /** Estimated smooth background / fluorescence curve. */
  baseline: Float64Array;
  /** Baseline-subtracted spectrum (`y - baseline`). */
  corrected: Float64Array;
}

export interface AutoBaselineResult extends BaselineResult {
  /** Automatically selected AsLS smoothness parameter λ. */
  lambda: number;
  /** Automatically selected AsLS asymmetry weight p. */
  p: number;
  /** Detected background profile classification. */
  profile: 'Flat' | 'Moderate' | 'Fluorescent';
}

/**
 * High-level normalized summary designed for downstream apps like Digital-Traveller.
 */
export interface WdfInstrumentSummary {
  title: string;
  operator: string;
  instrumentType: string | null;
  application: string;
  measurementType: string;
  scanType: string;
  completionStatus: string | null;
  acquisitionStart: string | null;
  acquisitionEnd: string | null;
  scanDurationMs: number | null;
  laserName: string | null;
  laserWavenumberCm1: number | null;
  laserWavelengthNm: number | null;
  grating: string | null;
  objective: string | null;
  objectiveMagnification: number | null;
  ndTransmissionPercent: number | null;
  /** Calibrated full laser power in mW (recorded in WXIS 'Laser power mW' on Renishaw Virsa instruments). */
  laserPowerMw: number | null;
  /** Effective sample laser power in mW (laserPowerMw * ndTransmissionPercent / 100) for Virsa instruments, rounded to 2 decimal places max. */
  effectiveLaserPowerMw: number | null;
  exposureTimeMs: number | null;
  accumulations: number;
  slitOpening: string | null;
  slitBeamCentre: string | null;
  xBinning: number | null;
  yBinning: number | null;
  cosmicRayRemoval: boolean | null;
  centreWavenumber: number | null;
  xAxisMin: number | null;
  xAxisMax: number | null;
  xAxisUnits: string;
  xAxisSymbol: string;
  intensityUnits: string;
  pointsPerSpectrum: number;
  spectraCollected: number;
  peakX: number | null;
  peakIntensity: number | null;
  stagePosition: { x: number; y: number; z: number } | null;
  poduleTemperature: string | null;
  ccdSerialNumber: string | null;
  ccdFirmwareVersion: string | null;
  spectrometerSerialNumber: string | null;
  originalFilePath: string | null;
  comment: string | null;
}

export interface WdfFile {
  byteLength: number;
  header: WdfHeader;
  summary: WdfInstrumentSummary;
  xAxis: WdfAxisList | null;
  yAxis: WdfAxisList | null;
  backgroundXAxis: WdfAxisList | null;
  /** Flat Float32Array of length `spectraCollected * pointsPerSpectrum` (or available points). */
  spectra: Float32Array;
  origins: WdfOriginList[];
  comment: string | null;
  mapArea: WdfMapArea | null;
  /** Embedded Renishaw MAP analysis results (e.g. Signal-to-Baseline integration per scan). */
  maps: WdfMapResult[];
  whiteLightImage: WdfWhiteLightImage | null;
  /** Decoded Renishaw PSET property sets keyed by 4-char block ID (WXDA, WXIS, WXDM, WXCS, ZLDC, etc.) */
  propertySets: Record<string, PsetObject>;
  /** Measurement VBScript extracted from WXDM (if requested via options.includeScript). */
  measurementScript: string | null;
  /** Ordered list of all binary blocks found in the file. */
  blocks: WdfBlockSummary[];
  /** Non-fatal warnings encountered during parsing. */
  warnings: string[];
}

export interface WdfParseOptions {
  /** Include the embedded VBScript from WXDM (typically ~230 KB). Default: false. */
  includeScript?: boolean;
  /** Sort each spectrum and xAxis into ascending X order. Default: false (preserves native file order). */
  sortXAscending?: boolean;
}
