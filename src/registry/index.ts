/**
 * Public API barrel export for the reusable Windows / Renishaw WiRE
 * registry parser, domain analyzer, and extensible rules engine.
 *
 * Pure TypeScript only — safe to copy directly into any Node, browser,
 * Electron, Bun, Deno, or React/Vue/Angular TypeScript project.
 */

// Types & Enums
export { ComVariantTypeCode } from './types';
export type {
  CalibrationStateSummary,
  ComVariantTypeName,
  DecodedRegistrySource,
  DetectedTextEncoding,
  DetectorReadoutMode,
  DetectorRecord,
  DiagnosticCode,
  DiagnosticSeverity,
  GratingCalibrationTrack,
  GratingRecord,
  InstrumentFamily,
  LaserCalibrationRecord,
  MotorRecord,
  ParsedRegistry,
  ParseRegistryOptions,
  RegBinaryValue,
  RegDeleteValue,
  RegDwordValue,
  RegExpandStringValue,
  RegistryAnalysisSummary,
  RegistryDiagnostic,
  RegistryEntry,
  RegistryFormatVersion,
  RegistryInput,
  RegistryParseStats,
  RegistrySection,
  RegistryTreeNode,
  RegistryValue,
  RegMultiStringValue,
  RegNoneValue,
  RegQwordValue,
  RegStringValue,
  RegUnknownValue,
  RuleContext,
  RuleDefinition,
  RuleEvaluationOutput,
  RuleEvidence,
  RuleFinding,
  RuleResult,
  RuleSeverity,
  RuleStatus,
  RuleSuiteReport,
  SystemCalibrationState,
  SystemMetadataSummary,
  SystemQueryOptions,
  VariantBooleanValue,
  VariantComArrayValue,
  VariantComObjectValue,
  VariantDateValue,
  VariantEmptyValue,
  VariantNumberValue,
  VariantStringValue,
  VariantUnknownValue,
  VirsaRuleConfig,
  WavenumberToleranceTarget,
  WireSystemRoot,
  WireVariantValue,
} from './types';

// Decoder
export { decodeRegistryInput, decodeUtf16LeRawBytes } from './decoder';

// Parser
export {
  getComVariantTypeName,
  normalizeEntryName,
  normalizeRegistryPath,
  oleDateToIsoString,
  parseRegistry,
} from './parser';

// Analysis & Queries
export {
  detectWireSystemRoots,
  extractCalibrationState,
  extractDetectors,
  extractGratings,
  extractLasers,
  extractMotors,
  extractSystemMetadata,
  findSections,
  getEntry,
  getSection,
  getWireBoolean,
  getWireNumber,
  getWireString,
  listDirectChildNames,
  listDirectChildSections,
  readWireCollectionKeys,
  summarizeRegistry,
} from './analysis';

// Rules Engine
export {
  BUILT_IN_VIRSA_RULES,
  DEFAULT_VIRSA_RULE_CONFIG,
  defineRule,
  evaluateRuleSuite,
  evaluateVirsaRules,
  virsaDefaultWavenumberRule,
  virsaHiResHiSensPairRule,
  virsaLaserMinPowerRule,
  virsaSerialFolderMatchRule,
  virsaWavenumberToleranceRule,
} from './rules';
export type { EvaluateRulesOptions, EvaluateVirsaOptions } from './rules';

// Sample Fixtures
export {
  SAMPLE_FIXTURES,
  SAMPLE_INVIA_REG,
  SAMPLE_MALFORMED_EDGE_CASES_REG,
  SAMPLE_VIRSA_FAILING_RULES_REG,
  SAMPLE_VIRSA_PASSING_REG,
  SAMPLE_WIRE_LEGACY_WOW64_REG,
} from './fixtures';
export type { RegistryFixtureMetadata } from './fixtures';
