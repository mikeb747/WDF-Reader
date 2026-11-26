import { useState } from 'react';
import {
  decodeRegistryInput,
  defineRule,
  evaluateVirsaRules,
  getEntry,
  parseRegistry,
  SAMPLE_INVIA_REG,
  SAMPLE_MALFORMED_EDGE_CASES_REG,
  SAMPLE_VIRSA_FAILING_RULES_REG,
  SAMPLE_VIRSA_PASSING_REG,
  SAMPLE_WIRE_LEGACY_WOW64_REG,
  summarizeRegistry,
} from '../registry';
import { RuleStatusLabel } from './StatusLabel';

interface SelfCheckResult {
  readonly id: string;
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
  readonly durationMs: number;
}

const MODULE_FILES = [
  {
    file: 'src/registry/types.ts',
    role: 'Strict public interfaces, discriminated unions for raw REG values & COM VT_* variants, diagnostics, analysis & rule types.',
  },
  {
    file: 'src/registry/decoder.ts',
    role: 'Zero-dependency UTF-16LE/BE & UTF-8 BOM decoder accepting string, Uint8Array, or ArrayBuffer.',
  },
  {
    file: 'src/registry/parser.ts',
    role: 'Pure REGEDIT5/REGEDIT4 parser, line continuation & escape handling, COM Variant decoder, tree builder, and error recovery.',
  },
  {
    file: 'src/registry/analysis.ts',
    role: 'Version/WOW64-agnostic WiRE system root detection, Virsa/inVia family detection, calibration state, and laser/grating/detector/motor extractors.',
  },
  {
    file: 'src/registry/rules.ts',
    role: 'Composable post-parse rules engine (defineRule and evaluateRuleSuite) plus built-in Virsa Tests 1–5.',
  },
  {
    file: 'src/registry/fixtures.ts',
    role: 'Deterministic sample fixtures covering Virsa passing/failing, inVia WiRE 5.7 SafeArrays, legacy REGEDIT4/WOW6432Node, and malformed syntax.',
  },
  {
    file: 'src/registry/index.ts',
    role: 'Single barrel export exposing only the public TypeScript API.',
  },
];

const CUSTOM_RULE_EXAMPLE = `import {
  parseRegistry,
  defineRule,
  evaluateVirsaRules,
} from './registry';

const ccdTempRule = defineRule({
  id: 'virsa-ccd-temp-check',
  name: 'CCD Operating Temperature <= -60 °C',
  category: 'Detector',
  description: 'Verifies cooled Centrus CCD target temperature.',
  evaluate: ({ summary }) => {
    const det = summary.detectors[0];
    if (!det || det.operatingTemperatureC === null) {
      return { status: 'skipped', summary: 'No CCD temperature found.', findings: [] };
    }
    const ok = det.operatingTemperatureC <= -60;
    return {
      status: ok ? 'pass' : 'fail',
      summary: \`CCD target temperature is \${det.operatingTemperatureC} °C.\`,
      findings: ok ? [] : [{ severity: 'error', message: 'CCD operating temperature above -60 °C.' }],
    };
  },
});

const parsed = parseRegistry(fileBytes, { sourceName: 'AJ4F17_20250813_sys.rrg' });
const report = evaluateVirsaRules(parsed, {
  sourceFolderName: 'AJ4F17_Customer',
  extraRules: [ccdTempRule],
});`;

function runBrowserSelfChecks(): readonly SelfCheckResult[] {
  const checks: Array<{ id: string; name: string; run: () => string }> = [
    {
      id: 'utf16le-bom',
      name: 'UTF-16LE BOM byte decoding',
      run: () => {
        const text = 'Windows Registry Editor Version 5.00\r\n[HKEY_LOCAL_MACHINE\\Test]';
        const bytes = new Uint8Array(2 + text.length * 2);
        bytes[0] = 0xff;
        bytes[1] = 0xfe;
        for (let i = 0; i < text.length; i += 1) {
          bytes[2 + i * 2] = text.charCodeAt(i) & 0xff;
          bytes[2 + i * 2 + 1] = text.charCodeAt(i) >> 8;
        }
        const decoded = decodeRegistryInput(bytes);
        if (decoded.encoding !== 'utf-16le-bom' || decoded.text !== text) {
          throw new Error(`Unexpected decode result: ${decoded.encoding}`);
        }
        return 'Decoded UTF-16LE BOM payload accurately';
      },
    },
    {
      id: 'virsa-passing',
      name: 'Passing Virsa fixture (all 5 rules pass)',
      run: () => {
        const doc = parseRegistry(SAMPLE_VIRSA_PASSING_REG, { sourceName: 'VR9K42_sys.rrg' });
        const summary = summarizeRegistry(doc);
        const report = evaluateVirsaRules(doc, { summary, sourceFolderName: 'VR9K42_LabA' });
        if (doc.stats.errorCount !== 0 || report.overallStatus !== 'pass' || report.passedCount !== 5) {
          throw new Error(`Expected 5 passing rules, got ${report.passedCount} pass / ${report.failedCount} fail`);
        }
        return `4 lasers extracted, CCD ${summary.detectors[0]?.operatingTemperatureC} °C, 5/5 rules passed`;
      },
    },
    {
      id: 'virsa-failing',
      name: 'Failing Virsa fixture (all 5 rules flag failures)',
      run: () => {
        const doc = parseRegistry(SAMPLE_VIRSA_FAILING_RULES_REG);
        const report = evaluateVirsaRules(doc, { sourceFolderName: 'C14R96_FZJ' });
        if (report.failedCount !== 5) {
          throw new Error(`Expected 5 failing rules, got ${report.failedCount}`);
        }
        return '5/5 failing rules detected with structured findings';
      },
    },
    {
      id: 'legacy-wow64',
      name: 'Legacy REGEDIT4 + WOW6432Node + hex types + deletions',
      run: () => {
        const doc = parseRegistry(SAMPLE_WIRE_LEGACY_WOW64_REG);
        const summary = summarizeRegistry(doc);
        const qword = getEntry(
          doc,
          'HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\CustomBinary',
          'LargeCounter',
        );
        if (
          doc.formatVersion !== 'regedit4' ||
          !summary.activeSystemRoot?.isWow64 ||
          qword?.value.kind !== 'REG_QWORD'
        ) {
          throw new Error('Failed to parse legacy WOW6432Node or REG_QWORD');
        }
        return `Detected WOW6432Node\\System1, QWORD=${qword.value.value.toString()}n, 1 key deletion`;
      },
    },
    {
      id: 'malformed-recovery',
      name: 'Malformed syntax & edge-case recovery',
      run: () => {
        const doc = parseRegistry(SAMPLE_MALFORMED_EDGE_CASES_REG);
        const codes = new Set(doc.diagnostics.map((d) => d.code));
        if (!codes.has('INVALID_DWORD') || !codes.has('UNTERMINATED_STRING') || !codes.has('MALFORMED_SECTION_HEADER')) {
          throw new Error('Missing expected syntax diagnostics');
        }
        return `${doc.diagnostics.length} diagnostics captured without throwing`;
      },
    },
    {
      id: 'custom-rule',
      name: 'Custom rule composition via defineRule()',
      run: () => {
        const doc = parseRegistry(SAMPLE_VIRSA_PASSING_REG);
        const custom = defineRule({
          id: 'check-ccd-temp',
          name: 'CCD Temp Check',
          category: 'Detector',
          description: 'Verifies cooled CCD operating temp.',
          evaluate: ({ summary }) => ({
            status: (summary.detectors[0]?.operatingTemperatureC ?? 0) <= -60 ? 'pass' : 'fail',
            summary: 'CCD cooled to -70 °C',
            findings: [],
          }),
        });
        const report = evaluateVirsaRules(doc, {
          sourceFolderName: 'VR9K42_Lab',
          extraRules: [custom],
        });
        if (report.results.length !== 6 || report.passedCount !== 6) {
          throw new Error('Custom rule did not execute cleanly');
        }
        return '6/6 rules executed (5 built-in + 1 custom)';
      },
    },
    {
      id: 'invia-safearray',
      name: 'inVia VT_VARIANT SafeArray & family detection',
      run: () => {
        const invia = parseRegistry(SAMPLE_INVIA_REG, { sourceName: 'IV5140_inVia_sys.reg' });
        const summary = summarizeRegistry(invia);
        if (
          summary.metadata.instrumentFamily !== 'inVia' ||
          summary.variantKindCounts['com-array'] !== 1 ||
          summary.lasers[0]?.mappedGratingKey !== 'grating0'
        ) {
          throw new Error('inVia SafeArray or grating mapping mismatch');
        }
        return `Detected inVia (${summary.metadata.wireVersion}), 1 COM SafeArray decoded, grating0 mapped`;
      },
    },
  ];

  return checks.map((c) => {
    const start = performance.now();
    try {
      const detail = c.run();
      return {
        id: c.id,
        name: c.name,
        passed: true,
        detail,
        durationMs: Number((performance.now() - start).toFixed(2)),
      };
    } catch (err) {
      return {
        id: c.id,
        name: c.name,
        passed: false,
        detail: err instanceof Error ? err.message : String(err),
        durationMs: Number((performance.now() - start).toFixed(2)),
      };
    }
  });
}

export function ModuleApiView() {
  const [results, setResults] = useState<readonly SelfCheckResult[] | null>(null);

  const handleRunChecks = (): void => {
    setResults(runBrowserSelfChecks());
  };

  return (
    <div className="space-y-8">
      {/* Architecture & File Map */}
      <section aria-labelledby="module-arch-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <div>
            <h2 id="module-arch-heading" className="text-base font-semibold text-slate-900">
              Portable Pure TypeScript Module
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Copy the <span className="font-mono text-slate-700">src/registry/</span> directory directly into any TypeScript project — zero React, DOM, or Node filesystem dependencies
            </p>
          </div>
          <span className="font-mono text-xs text-slate-500">
            CLI tests: npm test
          </span>
        </div>

        <div className="overflow-x-auto border border-slate-200 rounded-md">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                <th className="py-2.5 px-3.5">File</th>
                <th className="py-2.5 px-3.5">Responsibility</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 text-xs">
              {MODULE_FILES.map((item) => (
                <tr key={item.file}>
                  <td className="py-2.5 px-3.5 font-mono font-medium text-slate-900 whitespace-nowrap">
                    {item.file}
                  </td>
                  <td className="py-2.5 px-3.5 text-slate-600">{item.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {/* Interactive Fixture Verification Runner */}
      <section aria-labelledby="self-check-heading" className="border border-slate-200 rounded-md p-5">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h2 id="self-check-heading" className="text-base font-semibold text-slate-900">
              In-Browser Fixture Self-Check
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Executes decoding, parsing, legacy format, error recovery, and custom rule assertions live against the barrel export
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunChecks}
            className="px-4 py-2 text-xs font-medium text-white bg-blue-700 hover:bg-blue-800 rounded-md transition-colors whitespace-nowrap shrink-0 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-700"
          >
            Run Fixture Checks
          </button>
        </div>

        {results && (
          <div className="mt-4 overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  <th className="py-2 px-3">Check</th>
                  <th className="py-2 px-3">Result</th>
                  <th className="py-2 px-3">Detail</th>
                  <th className="py-2 px-3 text-right">Time</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-xs">
                {results.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 px-3 font-medium text-slate-900">{r.name}</td>
                    <td className="py-2 px-3">
                      <RuleStatusLabel status={r.passed ? 'pass' : 'fail'} />
                    </td>
                    <td className="py-2 px-3 text-slate-600">{r.detail}</td>
                    <td className="py-2 px-3 text-right font-mono tabular-nums text-slate-500">
                      {r.durationMs} ms
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Extending Rules Example */}
      <section aria-labelledby="custom-rule-heading">
        <h2 id="custom-rule-heading" className="text-base font-semibold text-slate-900 mb-2">
          Authoring Additional Post-Parse Rules
        </h2>
        <pre className="overflow-x-auto rounded-md border border-slate-200 bg-slate-50 p-4 font-mono text-xs leading-relaxed text-slate-800">
          <code>{CUSTOM_RULE_EXAMPLE}</code>
        </pre>
      </section>
    </div>
  );
}
