/**
 * Core public types for the framework-agnostic Windows / Renishaw WiRE
 * Registry parser, typed value model, analysis helpers, and rule engine.
 *
 * Pure TypeScript only: zero DOM, React, or Node runtime imports.
 */

// ---------------------------------------------------------------------------
// 1. Source Decoding & Registry File Header
// ---------------------------------------------------------------------------

export type DetectedTextEncoding =
  | 'string'
  | 'utf-8'
  | 'utf-8-bom'
  | 'utf-16le-bom'
  | 'utf-16be-bom'
  | 'utf-16le-inferred';

export type RegistryFormatVersion = 'regedit5' | 'regedit4' | 'unknown';

export type RegistryInput = string | Uint8Array | ArrayBuffer;

export interface DecodedRegistrySource {
  readonly text: string;
  readonly encoding: DetectedTextEncoding;
  readonly byteLength: number;
}

// ---------------------------------------------------------------------------
// 2. Diagnostics (Parser & Normalization)
// ---------------------------------------------------------------------------

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export type DiagnosticCode =
  | 'EMPTY_INPUT'
  | 'MISSING_HEADER'
  | 'UNRECOGNIZED_HEADER'
  | 'MALFORMED_SECTION_HEADER'
  | 'EMPTY_SECTION_PATH'
  | 'ORPHAN_VALUE_ENTRY'
  | 'MALFORMED_VALUE_LINE'
  | 'UNTERMINATED_STRING'
  | 'INVALID_DWORD'
  | 'INVALID_HEX_BYTES'
  | 'INVALID_QWORD'
  | 'UNKNOWN_VALUE_TYPE'
  | 'DUPLICATE_SECTION'
  | 'DUPLICATE_VALUE'
  | 'UNEXPECTED_CONTINUATION'
  | 'VARIANT_DECODE_WARNING';

export interface RegistryDiagnostic {
  readonly severity: DiagnosticSeverity;
  readonly code: DiagnosticCode;
  readonly message: string;
  /** 1-based line number in the normalized source text. */
  readonly line: number;
  /** Optional 1-based ending line number for multi-line entries. */
  readonly endLine?: number;
  /** Optional raw source text snippet that triggered the diagnostic. */
  readonly rawLine?: string;
  /** Optional section path where the diagnostic occurred. */
  readonly sectionPath?: string;
}

// ---------------------------------------------------------------------------
// 3. Raw Windows Registry Value Representations
// ---------------------------------------------------------------------------

export interface RegStringValue {
  readonly kind: 'REG_SZ';
  readonly raw: string;
  readonly value: string;
}

export interface RegDwordValue {
  readonly kind: 'REG_DWORD';
  readonly raw: string;
  /** Unsigned 32-bit integer (0 .. 4294967295). */
  readonly value: number;
  /** Signed 32-bit two's-complement interpretation (-2147483648 .. 2147483647). */
  readonly signedValue: number;
  /** Canonical 8-char lowercase hex representation (e.g. "00000016"). */
  readonly hex: string;
}

export interface RegQwordValue {
  readonly kind: 'REG_QWORD';
  readonly raw: string;
  /** Exact 64-bit unsigned integer parsed from little-endian bytes. */
  readonly value: bigint;
  /** Little-endian raw bytes. */
  readonly bytes: readonly number[];
}

export interface RegBinaryValue {
  readonly kind: 'REG_BINARY';
  readonly raw: string;
  /** Optional numeric Windows registry type code if written as hex(N): */
  readonly typeCode?: number;
  readonly bytes: readonly number[];
}

export interface RegExpandStringValue {
  readonly kind: 'REG_EXPAND_SZ';
  readonly raw: string;
  readonly value: string;
  readonly bytes: readonly number[];
}

export interface RegMultiStringValue {
  readonly kind: 'REG_MULTI_SZ';
  readonly raw: string;
  readonly values: readonly string[];
  readonly bytes: readonly number[];
}

export interface RegNoneValue {
  readonly kind: 'REG_NONE';
  readonly raw: string;
  readonly bytes: readonly number[];
}

export interface RegDeleteValue {
  readonly kind: 'DELETE';
  readonly raw: string;
}

export interface RegUnknownValue {
  readonly kind: 'UNKNOWN';
  readonly raw: string;
  readonly prefix?: string;
}

export type RegistryValue =
  | RegStringValue
  | RegDwordValue
  | RegQwordValue
  | RegBinaryValue
  | RegExpandStringValue
  | RegMultiStringValue
  | RegNoneValue
  | RegDeleteValue
  | RegUnknownValue;

// ---------------------------------------------------------------------------
// 4. Renishaw WiRE / COM VARIANT (VT_*) Typed Value Representations
// ---------------------------------------------------------------------------

/**
 * Standard Windows COM VARENUM (VT_*) codes observed in Renishaw WiRE
 * registry exports (`"__type__"=dword:XXXXXXXX`).
 */
export enum ComVariantTypeCode {
  VT_EMPTY = 0x00,
  VT_NULL = 0x01,
  VT_I2 = 0x02,
  VT_I4 = 0x03,
  VT_R4 = 0x04,
  VT_R8 = 0x05,
  VT_CY = 0x06,
  VT_DATE = 0x07,
  VT_BSTR = 0x08,
  VT_DISPATCH = 0x09,
  VT_ERROR = 0x0a,
  VT_BOOL = 0x0b,
  VT_VARIANT = 0x0c,
  VT_UNKNOWN = 0x0d,
  VT_I1 = 0x10,
  VT_UI1 = 0x11,
  VT_UI2 = 0x12,
  VT_UI4 = 0x13,
  VT_INT = 0x16,
  VT_UINT = 0x17,
}

export type ComVariantTypeName =
  | 'VT_EMPTY'
  | 'VT_NULL'
  | 'VT_I2'
  | 'VT_I4'
  | 'VT_R4'
  | 'VT_R8'
  | 'VT_CY'
  | 'VT_DATE'
  | 'VT_BSTR'
  | 'VT_DISPATCH'
  | 'VT_ERROR'
  | 'VT_BOOL'
  | 'VT_VARIANT'
  | 'VT_UNKNOWN'
  | 'VT_I1'
  | 'VT_UI1'
  | 'VT_UI2'
  | 'VT_UI4'
  | 'VT_INT'
  | 'VT_UINT'
  | `VT_0x${string}`;

export interface VariantEmptyValue {
  readonly kind: 'empty';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue | null;
  readonly value: null;
}

export interface VariantStringValue {
  readonly kind: 'string';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue;
  readonly value: string;
}

export interface VariantNumberValue {
  readonly kind: 'number';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue;
  /** Decoded JS number (respects signed/unsigned integer width and IEEE floats). */
  readonly value: number;
  readonly numericFormat: 'signed-int' | 'unsigned-int' | 'float';
}

export interface VariantBooleanValue {
  readonly kind: 'boolean';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue;
  readonly value: boolean;
  /** Underlying raw numeric flag (e.g. 0, 0xffffffff, 0x2001). */
  readonly rawFlag: number;
}

export interface VariantDateValue {
  readonly kind: 'date';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue;
  /** OLE Automation date serial number (days since 1899-12-30 UTC). */
  readonly oleDate: number;
  /** ISO-8601 UTC timestamp derived from the OLE Automation date. */
  readonly isoString: string | null;
}

export interface VariantComObjectValue {
  readonly kind: 'com-object';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue | null;
  /** COM CLSID string from the section's default `@` entry, if present. */
  readonly clsid: string | null;
}

export interface VariantComArrayValue {
  readonly kind: 'com-array';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue | null;
  /** Declared total element count from `nElements` DWORD, if present. */
  readonly elementCount: number | null;
  /** Declared dimensionality from `cDims` DWORD, if present. */
  readonly dimensions: number | null;
  /** Dimension bound descriptors (`d0`, `d1`, ... e.g. `"0 8"`). */
  readonly dimensionBounds: readonly string[];
}

export interface VariantUnknownValue {
  readonly kind: 'unknown';
  readonly typeCode: number;
  readonly typeName: ComVariantTypeName;
  readonly raw: RegistryValue | null;
  readonly value: string | number | null;
}

export type WireVariantValue =
  | VariantEmptyValue
  | VariantStringValue
  | VariantNumberValue
  | VariantBooleanValue
  | VariantDateValue
  | VariantComObjectValue
  | VariantComArrayValue
  | VariantUnknownValue;

// ---------------------------------------------------------------------------
// 5. Sections, Entries, Tree & Parsed Document
// ---------------------------------------------------------------------------

export interface RegistryEntry {
  /** Value name; empty string `""` represents the default `@` value. */
  readonly name: string;
  /** True when the entry was declared with `@=...` instead of `"Name"=...`. */
  readonly isDefault: boolean;
  /** Normalized lowercase lookup key (`"@"` for default entry). */
  readonly normalizedName: string;
  /** Strongly typed raw Windows registry value. */
  readonly value: RegistryValue;
  /** 1-based starting line number in source text. */
  readonly line: number;
  /** 1-based ending line number (differs from `line` for `\` continuations). */
  readonly endLine: number;
  /** Original raw line(s) joined as read from source. */
  readonly rawText: string;
}

export interface RegistrySection {
  /** Full canonical path as written (e.g. `HKEY_LOCAL_MACHINE\SOFTWARE\...`). */
  readonly path: string;
  /** Normalized lowercase path with canonical single `\` separators. */
  readonly normalizedPath: string;
  /** Path segments split on `\`. */
  readonly segments: readonly string[];
  /** Root hive name (first segment, e.g. `HKEY_LOCAL_MACHINE`). */
  readonly hive: string;
  /** Leaf key name (last segment). */
  readonly name: string;
  /** Parent section normalized path, or `null` if top-level hive. */
  readonly parentPath: string | null;
  /** True if the section header used deletion syntax `[-HKEY_...]`. */
  readonly isDeletion: boolean;
  /** 1-based line number of the first header declaration. */
  readonly line: number;
  /** Ordered list of all entries parsed under this section. */
  readonly entries: readonly RegistryEntry[];
  /** Case-insensitive entry map keyed by `normalizedName` (`"@"` for default). */
  readonly entryMap: Readonly<Record<string, RegistryEntry>>;
  /**
   * Decoded Renishaw WiRE COM VARIANT representation if this section contains
   * a `"__type__"` DWORD (and optional `"__value__"` or `@` CLSID).
   */
  readonly variant: WireVariantValue | null;
}

export interface RegistryTreeNode {
  /** Segment display name. */
  readonly name: string;
  /** Full path from hive to this node. */
  readonly path: string;
  /** Lowercase normalized path. */
  readonly normalizedPath: string;
  /** Explicit section metadata if this node was declared in the file (null for implicit parent folders). */
  readonly section: RegistrySection | null;
  /** Sorted child nodes. */
  readonly children: readonly RegistryTreeNode[];
  /** Total count of descendant declared sections (excluding self). */
  readonly descendantSectionCount: number;
}

export interface RegistryParseStats {
  readonly totalLines: number;
  readonly nonEmptyLines: number;
  readonly commentLines: number;
  readonly sectionCount: number;
  readonly deletionSectionCount: number;
  readonly entryCount: number;
  readonly variantSectionCount: number;
  readonly errorCount: number;
  readonly warningCount: number;
}

export interface ParseRegistryOptions {
  /** Optional filename or source label attached to the parsed document metadata. */
  readonly sourceName?: string;
  /** When false, skips building the hierarchical `tree` (default: true). */
  readonly buildTree?: boolean;
  /** When false, skips decoding Renishaw WiRE `__type__`/`__value__` variants (default: true). */
  readonly decodeWireVariants?: boolean;
}

export interface ParsedRegistry {
  readonly sourceName: string | null;
  readonly encoding: DetectedTextEncoding;
  readonly formatVersion: RegistryFormatVersion;
  readonly headerLine: string | null;
  /** Ordered list of unique sections (duplicate headers merge into the original section with a diagnostic). */
  readonly sections: readonly RegistrySection[];
  /** Case-insensitive lookup by `normalizedPath`. */
  readonly sectionsByPath: Readonly<Record<string, RegistrySection>>;
  /** Root hives of the hierarchical key tree. */
  readonly tree: readonly RegistryTreeNode[];
  /** All parser/normalization diagnostics in source order. */
  readonly diagnostics: readonly RegistryDiagnostic[];
  readonly stats: RegistryParseStats;
}

// ---------------------------------------------------------------------------
// 6. Domain Analysis Models (Renishaw WiRE / Virsa)
// ---------------------------------------------------------------------------

export interface WireSystemRoot {
  /** Full registry path to the system node (e.g. `HKEY_LOCAL_MACHINE\SOFTWARE\Renishaw\WiRE2\Systems\System0`). */
  readonly path: string;
  readonly normalizedPath: string;
  /** WiRE product segment (e.g. `WiRE2`, `WiRE`). */
  readonly wireKey: string;
  /** System identifier segment (e.g. `System0`, `System1`). */
  readonly systemId: string;
  /** True if located under a `WOW6432Node` branch. */
  readonly isWow64: boolean;
}

export type InstrumentFamily = 'Virsa' | 'inVia' | 'unknown';

export interface SystemMetadataSummary {
  readonly systemRoot: WireSystemRoot | null;
  readonly instrumentFamily: InstrumentFamily;
  readonly instrumentSerialNumber: string | null;
  readonly instrumentSerialPrefix: string | null;
  readonly wireVersion: string | null;
  readonly instrumentType: number | null;
  readonly systemTypeCode: number | null;
  readonly microscopeImagingFactor: number | null;
  readonly lastCollectionTimestamp: string | null;
}

export interface LaserCalibrationRecord {
  /** Registry folder key (e.g. `laser0`, `laser1`). */
  readonly key: string;
  /** Full registry path to this laser section. */
  readonly sectionPath: string;
  /** Display name from `LaserName` (e.g. `"785 P1 HiRes"`). */
  readonly laserName: string;
  /** Extracted 3-digit nominal wavelength in nm (e.g. `"785"`), or `null` if not present in name. */
  readonly wavelengthNm: string | null;
  /** Port/mode hint inferred from `LaserName` (e.g. `"HiRes"`, `"HiSens"`, or `null`). */
  readonly modeHint: 'HiRes' | 'HiSens' | null;
  /** Parsed `LaserWavenumber` in cm^-1, or `null` if missing/unparseable. */
  readonly wavenumber: number | null;
  /** Raw string value of `LaserWavenumber`. */
  readonly rawWavenumber: string | null;
  /** Parsed `MaxPower` in mW, or `null` if missing/unparseable. */
  readonly maxPower: number | null;
  /** Raw string value of `MaxPower`. */
  readonly rawMaxPower: string | null;
  /** Parsed `NDPercent`, or `null` if missing. */
  readonly ndPercent: number | null;
  /** Parsed `MIF` (Microscope Imaging Factor), or `null`. */
  readonly mif: number | null;
  readonly pathId: number | null;
  readonly laserType: number | null;
  readonly diverted: boolean | null;
  /** Mapped grating key from `VirsaHelper_LaserGratingMapping` or `areakeys` (e.g. `"grating0"`). */
  readonly mappedGratingKey: string | null;
  /** Associated Static Dynamic Offset from matching grating calibration block, if found. */
  readonly staticDynamicOffset: number | null;
  /** Raw string for Static Dynamic Offset. */
  readonly rawStaticDynamicOffset: string | null;
  /** Path to the grating calibration entry where `staticDynamicOffset` was resolved. */
  readonly staticDynamicOffsetSourcePath: string | null;
}

export interface GratingCalibrationTrack {
  readonly calibrationIndex: string;
  readonly trackIndex: string;
  readonly areaKeyId: number | null;
  readonly laserKey: string | null;
  readonly focusMode: number | null;
  readonly grooveDensity: number | null;
  readonly gratingOrder: number | null;
  readonly focalLength0: number | null;
  readonly includeAngle: number | null;
  readonly zeroOffset: number | null;
  readonly staticDynamicOffset: number | null;
  readonly calibrationStatus: number | null;
  readonly sectionPath: string;
}

export interface GratingRecord {
  readonly key: string;
  readonly sectionPath: string;
  readonly gratingName: string | null;
  readonly motorKeyName: string | null;
  readonly stepSize: number | null;
  readonly referencePosition: number | null;
  readonly maxAngleDegs: number | null;
  readonly calibrations: readonly GratingCalibrationTrack[];
}

export interface DetectorReadoutMode {
  readonly index: number;
  readonly name: string;
  readonly description: string | null;
  readonly gain: number | null;
  readonly gainName: string | null;
  readonly speed: number | null;
  readonly speedName: string | null;
  readonly fNumber: string | null;
}

export interface DetectorRecord {
  readonly key: string;
  readonly sectionPath: string;
  readonly displayName: string | null;
  readonly identifier: string | null;
  readonly enabled: boolean | null;
  readonly operatingTemperatureC: number | null;
  readonly widthPixels: number | null;
  readonly heightPixels: number | null;
  readonly pixelWidthMm: number | null;
  readonly pixelHeightMm: number | null;
  readonly readoutModes: readonly DetectorReadoutMode[];
}

export interface MotorRecord {
  readonly key: string;
  readonly sectionPath: string;
  readonly motorName: string;
  readonly motorId: number | null;
  readonly present: boolean | null;
  readonly motorised: boolean | null;
  readonly units: string | null;
  readonly positionSteps: number | null;
  readonly positionLogical: number | null;
  readonly minLimit: number | null;
  readonly maxLimit: number | null;
  readonly namedIndexes: Readonly<Record<string, number>>;
}

export type SystemCalibrationState = 'calibrated' | 'partial' | 'uncalibrated' | 'unknown';

export interface CalibrationStateSummary {
  /** Overall inferred calibration state based on grating calibration tracks and collection history. */
  readonly state: SystemCalibrationState;
  /** Grating calibration tracks with Calibration Status === 1. */
  readonly calibratedTrackCount: number;
  /** Grating calibration tracks with Calibration Status !== 1 (e.g. status 2 factory defaults). */
  readonly uncalibratedTrackCount: number;
  /** Total grating calibration tracks inspected across all gratings. */
  readonly totalTrackCount: number;
  /** True when at least one VT_DATE dark-current/collection timestamp exists under the system root. */
  readonly hasDarkCurrentCalibration: boolean;
  /** True when LaserAlign or SpectrometerAlign sections exist under GeneralProperties. */
  readonly hasAlignmentData: boolean;
}

export interface RegistryAnalysisSummary {
  readonly systemRoots: readonly WireSystemRoot[];
  readonly activeSystemRoot: WireSystemRoot | null;
  readonly metadata: SystemMetadataSummary;
  readonly calibration: CalibrationStateSummary;
  readonly lasers: readonly LaserCalibrationRecord[];
  readonly gratings: readonly GratingRecord[];
  readonly detectors: readonly DetectorRecord[];
  readonly motors: readonly MotorRecord[];
  readonly valueKindCounts: Readonly<Record<RegistryValue['kind'], number>>;
  readonly variantKindCounts: Readonly<Record<WireVariantValue['kind'], number>>;
}

export interface SystemQueryOptions {
  /** Explicitly target a specific system root path instead of the first auto-detected root. */
  readonly systemRootPath?: string;
}

// ---------------------------------------------------------------------------
// 7. Extensible Post-Parse Rules Engine Types
// ---------------------------------------------------------------------------

export type RuleStatus = 'pass' | 'fail' | 'warn' | 'skipped';

export type RuleSeverity = 'error' | 'warning' | 'info';

export interface RuleEvidence {
  readonly label: string;
  readonly actual?: string | number | boolean | null;
  readonly expected?: string | number | boolean | null;
  readonly sectionPath?: string;
  readonly entityKey?: string;
}

export interface RuleFinding {
  readonly severity: RuleSeverity;
  readonly message: string;
  readonly entityKey?: string;
  readonly sectionPath?: string;
  readonly evidence?: readonly RuleEvidence[];
}

export interface RuleContext<TConfig = Record<string, unknown>> {
  readonly registry: ParsedRegistry;
  readonly summary: RegistryAnalysisSummary;
  /** Optional external folder name (e.g. "AJ4F17_Customer") for serial prefix checks. */
  readonly sourceFolderName?: string | null;
  /** Optional filename (e.g. "AJ4F17_20250813_sys.rrg") for serial prefix checks. */
  readonly sourceFileName?: string | null;
  /** Rule-specific configuration overrides. */
  readonly config: TConfig;
}

export interface RuleEvaluationOutput {
  readonly status: RuleStatus;
  readonly summary: string;
  readonly findings: readonly RuleFinding[];
}

export interface RuleDefinition<TConfig = Record<string, unknown>> {
  /** Stable unique identifier (e.g. `"virsa-default-wavenumber"`). */
  readonly id: string;
  /** Human-readable rule name. */
  readonly name: string;
  /** Grouping category (e.g. `"Laser"`, `"Calibration"`, `"Identity"`, `"Hardware"`). */
  readonly category: string;
  /** Concise explanation of what this rule verifies. */
  readonly description: string;
  /** Optional legacy test number or tag for traceability (e.g. `"Test 1"`). */
  readonly referenceId?: string;
  /** Pure evaluation function executed after parsing and analysis. */
  readonly evaluate: (context: RuleContext<TConfig>) => RuleEvaluationOutput;
}

export interface RuleResult {
  readonly ruleId: string;
  readonly name: string;
  readonly category: string;
  readonly description: string;
  readonly referenceId?: string;
  readonly status: RuleStatus;
  readonly summary: string;
  readonly findings: readonly RuleFinding[];
}

export interface RuleSuiteReport {
  readonly overallStatus: RuleStatus;
  readonly passedCount: number;
  readonly failedCount: number;
  readonly warnedCount: number;
  readonly skippedCount: number;
  readonly results: readonly RuleResult[];
}

export interface WavenumberToleranceTarget {
  readonly target: number;
  readonly tolerance: number;
}

export interface VirsaRuleConfig {
  /** Factory default wavenumbers keyed by 3-digit wavelength string (nm). */
  readonly defaultWavenumbers: Readonly<Record<string, number>>;
  /** Expected wavenumber targets & allowed ± tolerance keyed by wavelength (nm). */
  readonly wavenumberTargets: Readonly<Record<string, WavenumberToleranceTarget>>;
  /** Minimum laser MaxPower (exclusive, i.e. must be > minLaserPower). */
  readonly minLaserPower: number;
  /** Maximum allowed delta when comparing HiRes & HiSens wavenumbers (default: 0). */
  readonly pairWavenumberTolerance: number;
  /** Number of prefix characters compared between serial number and folder/filename (default: 6). */
  readonly serialPrefixLength: number;
}
