/**
 * Extensible post-parse rules engine and built-in Virsa diagnostic rules.
 *
 * Rules are pure functions operating over `(ParsedRegistry, RegistryAnalysisSummary, config)`.
 * Downstream projects can compose built-in rules with custom rules via `defineRule`
 * and `evaluateRuleSuite`.
 */

import { summarizeRegistry } from './analysis';
import type {
  LaserCalibrationRecord,
  ParsedRegistry,
  RegistryAnalysisSummary,
  RuleContext,
  RuleDefinition,
  RuleFinding,
  RuleResult,
  RuleStatus,
  RuleSuiteReport,
  SystemQueryOptions,
  VirsaRuleConfig,
} from './types';

/**
 * Default Virsa calibration thresholds ported directly from Virsa2.ps1.
 */
export const DEFAULT_VIRSA_RULE_CONFIG: VirsaRuleConfig = {
  defaultWavenumbers: {
    '405': 24691.4,
    '532': 18797,
    '660': 15151.5,
    '785': 12738.9,
    '830': 12048.2,
  },
  wavenumberTargets: {
    '532': { target: 18793.46, tolerance: 10 },
    '785': { target: 12742.1, tolerance: 2 },
  },
  minLaserPower: 12,
  pairWavenumberTolerance: 0,
  serialPrefixLength: 6,
};

/**
 * Type-safe helper for authoring new post-parse rules.
 */
export function defineRule<TConfig = VirsaRuleConfig>(
  definition: RuleDefinition<TConfig>,
): RuleDefinition<TConfig> {
  return definition;
}

// ---------------------------------------------------------------------------
// Built-in Virsa Diagnostic Rules (Tests 1–5)
// ---------------------------------------------------------------------------

/** Test 1: Ensure no laser is left on a factory default wavenumber. */
export const virsaDefaultWavenumberRule: RuleDefinition<VirsaRuleConfig> = defineRule({
  id: 'virsa-default-wavenumber',
  name: 'No Factory Default Wavenumbers',
  category: 'Laser Calibration',
  referenceId: 'Test 1',
  description:
    'Verifies that each configured laser wavenumber has been calibrated away from factory defaults.',
  evaluate: ({ summary, config }) => {
    if (summary.lasers.length === 0) {
      return {
        status: 'skipped',
        summary: 'No lasers detected in this registry file.',
        findings: [],
      };
    }

    const findings: RuleFinding[] = [];
    let hasFailure = false;
    let hasWarning = false;

    for (const laser of summary.lasers) {
      const wl = laser.wavelengthNm;
      if (!wl) {
        hasWarning = true;
        findings.push({
          severity: 'warning',
          entityKey: laser.key,
          sectionPath: laser.sectionPath,
          message: `${laser.key} ("${laser.laserName}") has no 3-digit wavelength in its name; default wavenumber check skipped for this laser.`,
        });
        continue;
      }

      const defaultWn = config.defaultWavenumbers[wl];
      if (defaultWn === undefined) {
        hasWarning = true;
        findings.push({
          severity: 'warning',
          entityKey: laser.key,
          sectionPath: laser.sectionPath,
          message: `New laser wavelength detected (${wl} nm on ${laser.key}) — no factory default wavenumber configured.`,
          evidence: [{ label: 'Wavelength (nm)', actual: wl }],
        });
        continue;
      }

      if (laser.wavenumber === null) {
        hasFailure = true;
        findings.push({
          severity: 'error',
          entityKey: laser.key,
          sectionPath: `${laser.sectionPath}\\LaserWavenumber`,
          message: `${laser.key} ("${laser.laserName}") is missing a valid numeric LaserWavenumber.`,
        });
        continue;
      }

      if (laser.wavenumber === defaultWn) {
        hasFailure = true;
        findings.push({
          severity: 'error',
          entityKey: laser.key,
          sectionPath: `${laser.sectionPath}\\LaserWavenumber`,
          message: `${laser.key} ("${laser.laserName}") still uses factory default wavenumber ${defaultWn} cm^-1.`,
          evidence: [
            {
              label: 'LaserWavenumber',
              actual: laser.wavenumber,
              expected: `!= ${defaultWn}`,
              sectionPath: `${laser.sectionPath}\\LaserWavenumber`,
              entityKey: laser.key,
            },
          ],
        });
      }
    }

    if (hasFailure) {
      return {
        status: 'fail',
        summary: 'One or more lasers still have a factory default wavenumber.',
        findings,
      };
    }
    if (hasWarning) {
      return {
        status: 'warn',
        summary: 'No factory default wavenumbers matched, but an unconfigured wavelength was seen.',
        findings,
      };
    }
    return {
      status: 'pass',
      summary: `All ${summary.lasers.length} lasers use non-default calibrated wavenumbers.`,
      findings: [],
    };
  },
});

/** Test 2: Ensure HiRes / HiSens pairs exist per wavelength and share matching wavenumbers. */
export const virsaHiResHiSensPairRule: RuleDefinition<VirsaRuleConfig> = defineRule({
  id: 'virsa-hires-hisens-pair',
  name: 'HiRes / HiSens Wavenumber Pair Match',
  category: 'Laser Calibration',
  referenceId: 'Test 2',
  description:
    'Groups lasers by nominal wavelength and verifies both HiRes and HiSens ports exist with matching calibrated wavenumbers.',
  evaluate: ({ summary, config }) => {
    if (summary.lasers.length === 0) {
      return {
        status: 'skipped',
        summary: 'No lasers detected in this registry file.',
        findings: [],
      };
    }

    const groups = new Map<string, LaserCalibrationRecord[]>();
    for (const laser of summary.lasers) {
      const groupKey = laser.wavelengthNm ?? '(unknown)';
      const bucket = groups.get(groupKey) ?? [];
      bucket.push(laser);
      groups.set(groupKey, bucket);
    }

    const findings: RuleFinding[] = [];
    let hasFailure = false;

    for (const [wl, lasers] of groups.entries()) {
      if (lasers.length < 2) {
        hasFailure = true;
        findings.push({
          severity: 'error',
          entityKey: lasers[0].key,
          sectionPath: lasers[0].sectionPath,
          message: `Missing HiRes/HiSens pair for ${wl} nm (found only ${lasers.length} laser: "${lasers[0].laserName}").`,
          evidence: [{ label: 'Ports found', actual: lasers.length, expected: '>= 2' }],
        });
        continue;
      }

      const ref = lasers[0];
      for (let i = 1; i < lasers.length; i += 1) {
        const peer = lasers[i];
        if (ref.wavenumber === null || peer.wavenumber === null) {
          hasFailure = true;
          findings.push({
            severity: 'error',
            entityKey: peer.key,
            sectionPath: peer.sectionPath,
            message: `Cannot compare ${wl} nm pair (${ref.key} vs ${peer.key}): missing numeric wavenumber.`,
          });
          continue;
        }

        const delta = Math.abs(ref.wavenumber - peer.wavenumber);
        if (delta > config.pairWavenumberTolerance) {
          hasFailure = true;
          findings.push({
            severity: 'error',
            entityKey: peer.key,
            sectionPath: peer.sectionPath,
            message: `HiRes / HiSens wavenumber mismatch for ${wl} nm: ${ref.key} (${ref.wavenumber}) vs ${peer.key} (${peer.wavenumber}).`,
            evidence: [
              { label: `${ref.key} (${ref.laserName})`, actual: ref.wavenumber },
              {
                label: `${peer.key} (${peer.laserName})`,
                actual: peer.wavenumber,
                expected: ref.wavenumber,
              },
            ],
          });
        }
      }
    }

    if (hasFailure) {
      return {
        status: 'fail',
        summary: 'Missing port pair or HiRes/HiSens wavenumber mismatch detected.',
        findings,
      };
    }

    return {
      status: 'pass',
      summary: `All ${groups.size} wavelength group(s) have matching HiRes/HiSens wavenumbers.`,
      findings: [],
    };
  },
});

/** Test 3: Verify wavelength extraction and wavenumber tolerance range. */
export const virsaWavenumberToleranceRule: RuleDefinition<VirsaRuleConfig> = defineRule({
  id: 'virsa-wavenumber-tolerance',
  name: 'Wavelength & Wavenumber Tolerance',
  category: 'Laser Calibration',
  referenceId: 'Test 3',
  description:
    'Confirms each laser name encodes a 3-digit wavelength and its wavenumber falls within the calibrated tolerance window.',
  evaluate: ({ summary, config }) => {
    if (summary.lasers.length === 0) {
      return {
        status: 'skipped',
        summary: 'No lasers detected in this registry file.',
        findings: [],
      };
    }

    const findings: RuleFinding[] = [];
    let hasFailure = false;
    let hasWarning = false;

    for (const laser of summary.lasers) {
      const wl = laser.wavelengthNm;
      if (!wl) {
        hasFailure = true;
        findings.push({
          severity: 'error',
          entityKey: laser.key,
          sectionPath: `${laser.sectionPath}\\LaserName`,
          message: `Cannot extract 3-digit wavelength from LaserName "${laser.laserName}" on ${laser.key}.`,
        });
        continue;
      }

      const spec = config.wavenumberTargets[wl];
      if (!spec) {
        hasWarning = true;
        findings.push({
          severity: 'warning',
          entityKey: laser.key,
          sectionPath: laser.sectionPath,
          message: `New laser detected (${wl} nm on ${laser.key}) — no tolerance range configured.`,
          evidence: [{ label: 'Wavelength (nm)', actual: wl }],
        });
        continue;
      }

      if (laser.wavenumber === null) {
        hasFailure = true;
        findings.push({
          severity: 'error',
          entityKey: laser.key,
          sectionPath: `${laser.sectionPath}\\LaserWavenumber`,
          message: `${laser.key} ("${laser.laserName}") has no numeric wavenumber to validate against ${spec.target} ± ${spec.tolerance}.`,
        });
        continue;
      }

      const delta = Math.abs(laser.wavenumber - spec.target);
      if (delta > spec.tolerance) {
        hasFailure = true;
        findings.push({
          severity: 'error',
          entityKey: laser.key,
          sectionPath: `${laser.sectionPath}\\LaserWavenumber`,
          message: `Wavenumber out of tolerance for ${wl} nm on ${laser.key}: ${laser.wavenumber} cm^-1 (target ${spec.target} ± ${spec.tolerance}, delta ${delta.toFixed(3)}).`,
          evidence: [
            {
              label: 'LaserWavenumber',
              actual: laser.wavenumber,
              expected: `${spec.target} ± ${spec.tolerance}`,
              sectionPath: `${laser.sectionPath}\\LaserWavenumber`,
              entityKey: laser.key,
            },
          ],
        });
      }
    }

    if (hasFailure) {
      return {
        status: 'fail',
        summary: 'One or more lasers failed wavelength extraction or wavenumber tolerance.',
        findings,
      };
    }
    if (hasWarning) {
      return {
        status: 'warn',
        summary: 'Known wavelengths are within tolerance, but an unconfigured wavelength was found.',
        findings,
      };
    }
    return {
      status: 'pass',
      summary: `All ${summary.lasers.length} lasers are within configured wavenumber tolerances.`,
      findings: [],
    };
  },
});

/** Test 4: Verify all lasers report MaxPower strictly greater than the minimum threshold (default > 12). */
export const virsaLaserMinPowerRule: RuleDefinition<VirsaRuleConfig> = defineRule({
  id: 'virsa-laser-min-power',
  name: 'Minimum Laser Max Power',
  category: 'Laser Hardware',
  referenceId: 'Test 4',
  description:
    'Checks that every configured laser reports MaxPower strictly greater than the minimum threshold (default > 12).',
  evaluate: ({ summary, config }) => {
    if (summary.lasers.length === 0) {
      return {
        status: 'skipped',
        summary: 'No lasers detected in this registry file.',
        findings: [],
      };
    }

    const findings: RuleFinding[] = [];
    let hasFailure = false;

    for (const laser of summary.lasers) {
      if (laser.maxPower === null || laser.maxPower <= config.minLaserPower) {
        hasFailure = true;
        findings.push({
          severity: 'error',
          entityKey: laser.key,
          sectionPath: `${laser.sectionPath}\\MaxPower`,
          message: `${laser.key} ("${laser.laserName}") laser power too low: ${laser.maxPower ?? 'missing'} (must be > ${config.minLaserPower}).`,
          evidence: [
            {
              label: 'MaxPower',
              actual: laser.maxPower,
              expected: `> ${config.minLaserPower}`,
              sectionPath: `${laser.sectionPath}\\MaxPower`,
              entityKey: laser.key,
            },
          ],
        });
      }
    }

    if (hasFailure) {
      return {
        status: 'fail',
        summary: `One or more lasers have MaxPower <= ${config.minLaserPower}.`,
        findings,
      };
    }

    return {
      status: 'pass',
      summary: `All ${summary.lasers.length} lasers exceed minimum MaxPower (> ${config.minLaserPower}).`,
      findings: [],
    };
  },
});

/** Test 5: Compare 6-char prefix of Instrument Serial Number against folder/file context. */
export const virsaSerialFolderMatchRule: RuleDefinition<VirsaRuleConfig> = defineRule({
  id: 'virsa-serial-folder-match',
  name: 'Instrument Serial Prefix Match',
  category: 'System Identity',
  referenceId: 'Test 5',
  description:
    'Confirms the Instrument Serial Number prefix matches the system folder or filename prefix when external source context is provided.',
  evaluate: ({ summary, sourceFolderName, sourceFileName, config }) => {
    const serial = summary.metadata.instrumentSerialNumber;
    const prefixLen = config.serialPrefixLength;

    if (!serial) {
      return {
        status: 'fail',
        summary: 'Instrument Serial Number is missing from GeneralProperties.',
        findings: [
          {
            severity: 'error',
            message: 'Could not read GeneralProperties\\Instrument Serial Number.',
          },
        ],
      };
    }

    const externalName = (sourceFolderName?.trim() || sourceFileName?.trim() || '').replace(
      /^.*[/\\]/,
      '',
    );

    if (!externalName) {
      return {
        status: 'skipped',
        summary: `Instrument Serial Number is "${serial}". Supply sourceFolderName or sourceFileName to verify prefix alignment.`,
        findings: [
          {
            severity: 'info',
            message: 'No external folder or filename provided for serial prefix comparison.',
            evidence: [{ label: 'Instrument Serial Number', actual: serial }],
          },
        ],
      };
    }

    const serialPrefix = serial.slice(0, prefixLen);
    const externalPrefix = externalName.slice(0, prefixLen);

    if (serialPrefix.toUpperCase() !== externalPrefix.toUpperCase()) {
      return {
        status: 'fail',
        summary: `External prefix ("${externalPrefix}") does not match Instrument Serial Number ("${serialPrefix}").`,
        findings: [
          {
            severity: 'error',
            message: `Folder/file prefix "${externalPrefix}" (from "${externalName}") does not match serial prefix "${serialPrefix}".`,
            evidence: [
              {
                label: 'Serial Prefix',
                actual: serialPrefix,
                expected: externalPrefix,
              },
            ],
          },
        ],
      };
    }

    return {
      status: 'pass',
      summary: `Source prefix "${externalPrefix}" matches Instrument Serial Number "${serial}".`,
      findings: [],
    };
  },
});

/** Ordered built-in Virsa rule suite corresponding to Tests 1–5. */
export const BUILT_IN_VIRSA_RULES: readonly RuleDefinition<VirsaRuleConfig>[] = [
  virsaDefaultWavenumberRule,
  virsaHiResHiSensPairRule,
  virsaWavenumberToleranceRule,
  virsaLaserMinPowerRule,
  virsaSerialFolderMatchRule,
];

export interface EvaluateRulesOptions<TConfig = VirsaRuleConfig> extends SystemQueryOptions {
  /** Pre-computed analysis summary (computed automatically if omitted). */
  readonly summary?: RegistryAnalysisSummary;
  /** External system folder name (e.g. `"AJ4F17_Customer"`). */
  readonly sourceFolderName?: string | null;
  /** External filename (defaults to `doc.sourceName` if omitted). */
  readonly sourceFileName?: string | null;
  /** Rule definitions to run (defaults to `BUILT_IN_VIRSA_RULES`). */
  readonly rules?: readonly RuleDefinition<TConfig>[];
  /** Partial or full configuration object passed into each rule. */
  readonly config?: TConfig;
}

function mergeVirsaConfig(overrides?: Partial<VirsaRuleConfig>): VirsaRuleConfig {
  if (!overrides) {
    return DEFAULT_VIRSA_RULE_CONFIG;
  }
  return {
    defaultWavenumbers: {
      ...DEFAULT_VIRSA_RULE_CONFIG.defaultWavenumbers,
      ...(overrides.defaultWavenumbers ?? {}),
    },
    wavenumberTargets: {
      ...DEFAULT_VIRSA_RULE_CONFIG.wavenumberTargets,
      ...(overrides.wavenumberTargets ?? {}),
    },
    minLaserPower: overrides.minLaserPower ?? DEFAULT_VIRSA_RULE_CONFIG.minLaserPower,
    pairWavenumberTolerance:
      overrides.pairWavenumberTolerance ?? DEFAULT_VIRSA_RULE_CONFIG.pairWavenumberTolerance,
    serialPrefixLength:
      overrides.serialPrefixLength ?? DEFAULT_VIRSA_RULE_CONFIG.serialPrefixLength,
  };
}

/**
 * Evaluates a suite of post-parse rules against a parsed registry document.
 */
export function evaluateRuleSuite<TConfig = VirsaRuleConfig>(
  registry: ParsedRegistry,
  options: EvaluateRulesOptions<TConfig> = {},
): RuleSuiteReport {
  const summary =
    options.summary ??
    summarizeRegistry(registry, { systemRootPath: options.systemRootPath });

  const rules = (options.rules ??
    (BUILT_IN_VIRSA_RULES as unknown as readonly RuleDefinition<TConfig>[])) as readonly RuleDefinition<TConfig>[];

  const config = (options.config ??
    (DEFAULT_VIRSA_RULE_CONFIG as unknown as TConfig)) as TConfig;

  const context: RuleContext<TConfig> = {
    registry,
    summary,
    sourceFolderName: options.sourceFolderName ?? null,
    sourceFileName: options.sourceFileName !== undefined ? options.sourceFileName : registry.sourceName,
    config,
  };

  const results: RuleResult[] = rules.map((rule) => {
    const out = rule.evaluate(context);
    return {
      ruleId: rule.id,
      name: rule.name,
      category: rule.category,
      description: rule.description,
      referenceId: rule.referenceId,
      status: out.status,
      summary: out.summary,
      findings: out.findings,
    };
  });

  let passedCount = 0;
  let failedCount = 0;
  let warnedCount = 0;
  let skippedCount = 0;

  for (const r of results) {
    if (r.status === 'pass') passedCount += 1;
    else if (r.status === 'fail') failedCount += 1;
    else if (r.status === 'warn') warnedCount += 1;
    else skippedCount += 1;
  }

  let overallStatus: RuleStatus = 'pass';
  if (failedCount > 0) {
    overallStatus = 'fail';
  } else if (warnedCount > 0) {
    overallStatus = 'warn';
  } else if (passedCount === 0 && skippedCount > 0) {
    overallStatus = 'skipped';
  }

  return {
    overallStatus,
    passedCount,
    failedCount,
    warnedCount,
    skippedCount,
    results,
  };
}

export interface EvaluateVirsaOptions extends SystemQueryOptions {
  readonly summary?: RegistryAnalysisSummary;
  readonly sourceFolderName?: string | null;
  readonly sourceFileName?: string | null;
  readonly configOverrides?: Partial<VirsaRuleConfig>;
  /** Optional extra custom rules appended after the built-in Virsa rules. */
  readonly extraRules?: readonly RuleDefinition<VirsaRuleConfig>[];
}

/**
 * Convenience wrapper that merges `VirsaRuleConfig` overrides and runs
 * `BUILT_IN_VIRSA_RULES` plus any `extraRules`.
 */
export function evaluateVirsaRules(
  registry: ParsedRegistry,
  options: EvaluateVirsaOptions = {},
): RuleSuiteReport {
  const mergedConfig = mergeVirsaConfig(options.configOverrides);
  const rules = options.extraRules
    ? [...BUILT_IN_VIRSA_RULES, ...options.extraRules]
    : BUILT_IN_VIRSA_RULES;

  return evaluateRuleSuite(registry, {
    summary: options.summary,
    systemRootPath: options.systemRootPath,
    sourceFolderName: options.sourceFolderName,
    sourceFileName: options.sourceFileName,
    rules,
    config: mergedConfig,
  });
}
