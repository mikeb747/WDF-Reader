import type {
  ParsedRegistry,
  RegistryAnalysisSummary,
  RuleSuiteReport,
} from '../registry';
import { RuleStatusLabel } from './StatusLabel';

interface AnalysisViewProps {
  readonly registry: ParsedRegistry;
  readonly summary: RegistryAnalysisSummary;
  readonly report: RuleSuiteReport;
  readonly folderContext: string;
  readonly onFolderContextChange: (value: string) => void;
  readonly minLaserPower: number;
  readonly onMinLaserPowerChange: (value: number) => void;
  readonly onInspectPath: (path: string) => void;
}

function formatNumber(value: number | null, suffix = ''): string {
  if (value === null) {
    return '—';
  }
  return `${value}${suffix}`;
}

export function AnalysisView({
  registry,
  summary,
  report,
  folderContext,
  onFolderContextChange,
  minLaserPower,
  onMinLaserPowerChange,
  onInspectPath,
}: AnalysisViewProps) {
  const { metadata, calibration, lasers, gratings, detectors, motors } = summary;

  // Map failing laser keys -> failure labels for clean inline highlighting in the laser table
  const laserFindingsMap = new Map<string, string[]>();
  for (const rule of report.results) {
    for (const finding of rule.findings) {
      if (finding.entityKey) {
        const list = laserFindingsMap.get(finding.entityKey) ?? [];
        list.push(finding.message);
        laserFindingsMap.set(finding.entityKey, list);
      }
    }
  }

  return (
    <div className="space-y-8">
      {/* System Metadata Strip */}
      <section aria-labelledby="system-summary-heading" className="border-b border-slate-200 pb-6">
        <div className="flex flex-wrap items-baseline justify-between gap-4 mb-5">
          <div>
            <h1
              id="system-summary-heading"
              className="text-2xl font-semibold tracking-tight text-slate-900 text-balance"
            >
              {metadata.instrumentSerialNumber
                ? `Instrument ${metadata.instrumentSerialNumber}`
                : registry.sourceName ?? 'Parsed Registry Document'}
              {metadata.instrumentFamily !== 'unknown' && (
                <span className="ml-2.5 text-base font-normal text-slate-500">
                  {metadata.instrumentFamily}
                </span>
              )}
            </h1>
            <p className="mt-1 text-sm text-slate-500">
              {metadata.wireVersion ?? 'WiRE version not present'}
              <span className="mx-2 text-slate-300" aria-hidden="true">·</span>
              <span className="font-mono text-xs text-slate-600">
                {summary.activeSystemRoot?.path ?? 'No Renishaw WiRE system root detected'}
              </span>
            </p>
          </div>
          <div className="flex items-center gap-4 text-sm">
            <span className="text-slate-500">Rule Suite</span>
            <RuleStatusLabel status={report.overallStatus} />
            <span className="font-mono text-xs tabular-nums text-slate-600">
              {report.passedCount} pass / {report.failedCount} fail / {report.warnedCount} warn
            </span>
          </div>
        </div>

        <dl className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-6 gap-y-4 border-t border-slate-100 pt-5">
          <div>
            <dt className="text-xs font-medium text-slate-500">Serial Number</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {metadata.instrumentSerialNumber ?? '—'}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Lasers</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {lasers.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Gratings</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {gratings.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Detectors</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {detectors.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Motors</dt>
            <dd className="mt-1 font-mono text-lg font-semibold tabular-nums text-slate-900">
              {motors.length}
            </dd>
          </div>
          <div>
            <dt className="text-xs font-medium text-slate-500">Calibration State</dt>
            <dd className="mt-1">
              <div
                className={`text-sm font-semibold ${
                  calibration.state === 'uncalibrated'
                    ? 'text-amber-700'
                    : calibration.state === 'calibrated'
                      ? 'text-emerald-700'
                      : 'text-slate-800'
                }`}
              >
                {calibration.state === 'uncalibrated'
                  ? 'Uncalibrated'
                  : calibration.state === 'calibrated'
                    ? 'Calibrated'
                    : calibration.state === 'partial'
                      ? 'Partial'
                      : 'Unknown'}
              </div>
              <div className="font-mono text-[11px] tabular-nums text-slate-500 mt-0.5">
                {metadata.lastCollectionTimestamp
                  ? metadata.lastCollectionTimestamp.slice(0, 10)
                  : calibration.totalTrackCount > 0
                    ? `${calibration.calibratedTrackCount}/${calibration.totalTrackCount} tracks`
                    : 'No timestamp'}
              </div>
            </dd>
          </div>
        </dl>
      </section>

      {/* Virsa Laser Table */}
      <section aria-labelledby="laser-table-heading">
        <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
          <h2 id="laser-table-heading" className="text-base font-semibold text-slate-900">
            {metadata.instrumentFamily === 'inVia'
              ? 'inVia Laser Table'
              : metadata.instrumentFamily === 'Virsa'
                ? 'Virsa Laser Table'
                : 'Laser Calibration Table'}
          </h2>
          <p className="text-xs text-slate-500">
            Extracted from Laser Collection and mapped Grating Collection calibration tracks
          </p>
        </div>

        {lasers.length === 0 ? (
          <div className="border border-slate-200 rounded-md px-5 py-8 text-center">
            <p className="text-sm text-slate-600">
              No entries found under <span className="font-mono text-xs">Laser Collection</span> in this registry document.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-slate-200 rounded-md">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="bg-slate-50 border-b border-slate-200 text-xs font-medium text-slate-600">
                  <th className="py-2.5 px-3.5">Key</th>
                  <th className="py-2.5 px-3.5">Laser Name</th>
                  <th className="py-2.5 px-3.5 text-right">Wavelength</th>
                  <th className="py-2.5 px-3.5 text-right">Wavenumber</th>
                  <th className="py-2.5 px-3.5 text-right">Max Power</th>
                  <th className="py-2.5 px-3.5 text-right">ND %</th>
                  <th className="py-2.5 px-3.5 text-right">Dynamic Offset</th>
                  <th className="py-2.5 px-3.5">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                {lasers.map((laser) => {
                  const issues = laserFindingsMap.get(laser.key) ?? [];
                  const hasIssue = issues.length > 0;
                  return (
                    <tr
                      key={laser.key}
                      className="hover:bg-slate-50/70 transition-colors"
                    >
                      <td className="py-2.5 px-3.5 font-mono text-xs">
                        <button
                          type="button"
                          onClick={() => onInspectPath(laser.sectionPath)}
                          className="text-blue-700 hover:underline focus-visible:outline-2 focus-visible:outline-blue-600 rounded-xs"
                        >
                          {laser.key}
                        </button>
                      </td>
                      <td className="py-2.5 px-3.5 font-medium text-slate-900">
                        {laser.laserName || '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                        {laser.wavelengthNm ? `${laser.wavelengthNm} nm` : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono text-xs tabular-nums text-slate-900">
                        {laser.wavenumber !== null ? `${laser.wavenumber} cm⁻¹` : '—'}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono text-xs tabular-nums text-slate-900">
                        {formatNumber(laser.maxPower)}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono text-xs tabular-nums text-slate-600">
                        {formatNumber(laser.ndPercent, '%')}
                      </td>
                      <td className="py-2.5 px-3.5 text-right font-mono text-xs tabular-nums text-slate-700">
                        {formatNumber(laser.staticDynamicOffset)}
                      </td>
                      <td className="py-2.5 px-3.5">
                        {hasIssue ? (
                          <span className="text-xs text-red-700 font-medium">
                            {issues.length} issue{issues.length > 1 ? 's' : ''}
                          </span>
                        ) : (
                          <span className="text-xs text-emerald-700 font-medium">Nominal</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {/* Post-Parse Rules Evaluation */}
      <section aria-labelledby="rules-heading">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-3">
          <div>
            <h2 id="rules-heading" className="text-base font-semibold text-slate-900">
              Post-Parse Diagnostic Rules
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Modular rule pipeline executed after parsing; adjust runtime context to verify rule outcomes
            </p>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="flex flex-col gap-1">
              <label
                htmlFor="folder-context-input"
                className="text-xs font-medium text-slate-600"
              >
                Source folder or file prefix (Test 5)
              </label>
              <input
                id="folder-context-input"
                type="text"
                value={folderContext}
                onChange={(e) => onFolderContextChange(e.target.value)}
                placeholder="e.g. AJ4F17_Customer"
                className="h-9 w-56 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>

            <div className="flex flex-col gap-1">
              <label
                htmlFor="min-power-input"
                className="text-xs font-medium text-slate-600"
              >
                Min power threshold (Test 4)
              </label>
              <input
                id="min-power-input"
                type="number"
                min={0}
                step={1}
                value={minLaserPower}
                onChange={(e) => {
                  const parsed = Number(e.target.value);
                  onMinLaserPowerChange(Number.isFinite(parsed) ? parsed : 12);
                }}
                className="h-9 w-28 rounded-md border border-slate-300 bg-white px-2.5 font-mono text-xs tabular-nums text-slate-900 focus:border-blue-600 focus:outline-none focus:ring-2 focus:ring-blue-600/20"
              />
            </div>
          </div>
        </div>

        {metadata.instrumentFamily === 'inVia' && (
          <div className="mb-3 rounded-md border border-slate-200 bg-slate-50 px-3.5 py-2.5 text-xs text-slate-600">
            Detected <span className="font-semibold text-slate-900">Renishaw inVia</span> system (Instrument type 0). Built-in Virsa checks (HiRes/HiSens pairs, 785/532 nm factory targets, MaxPower &gt; 12) are shown for reference and may report expected differences on inVia hardware.
          </div>
        )}

        <div className="border border-slate-200 rounded-md divide-y divide-slate-200">
          {report.results.map((rule) => (
            <div key={rule.ruleId} className="px-4 py-3.5">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-baseline gap-2">
                    {rule.referenceId && (
                      <span className="font-mono text-xs font-medium text-slate-500">
                        {rule.referenceId}
                      </span>
                    )}
                    <h3 className="text-sm font-semibold text-slate-900">{rule.name}</h3>
                    <span className="text-xs text-slate-400" aria-hidden="true">·</span>
                    <span className="font-mono text-xs text-slate-500">{rule.ruleId}</span>
                  </div>
                  <p className="mt-0.5 text-sm text-slate-600">{rule.summary}</p>
                </div>
                <RuleStatusLabel status={rule.status} />
              </div>

              {rule.findings.length > 0 && (
                <ul className="mt-2.5 space-y-1.5 border-t border-slate-100 pt-2.5">
                  {rule.findings.map((finding, idx) => (
                    <li
                      key={`${rule.ruleId}-finding-${idx}`}
                      className="flex flex-wrap items-baseline justify-between gap-2 text-xs text-slate-700"
                    >
                      <span>
                        <span
                          className={
                            finding.severity === 'error'
                              ? 'font-semibold text-red-700 mr-1.5'
                              : finding.severity === 'warning'
                                ? 'font-semibold text-amber-700 mr-1.5'
                                : 'font-semibold text-slate-500 mr-1.5'
                          }
                        >
                          [{finding.severity.toUpperCase()}]
                        </span>
                        {finding.message}
                      </span>
                      {finding.sectionPath && (
                        <button
                          type="button"
                          onClick={() => onInspectPath(finding.sectionPath!)}
                          className="font-mono text-xs text-blue-700 hover:underline shrink-0"
                        >
                          Inspect key
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Hardware Summary: Detectors, Gratings & Motors */}
      <section aria-labelledby="hardware-heading" className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="border border-slate-200 rounded-md p-4">
          <h2 id="hardware-heading" className="text-sm font-semibold text-slate-900 mb-3">
            Detectors ({detectors.length})
          </h2>
          {detectors.length === 0 ? (
            <p className="text-xs text-slate-500">No detector entries detected.</p>
          ) : (
            <div className="space-y-3">
              {detectors.map((det) => (
                <div key={det.key} className="text-xs space-y-1">
                  <div className="font-medium text-slate-900">{det.displayName ?? det.key}</div>
                  <div className="font-mono text-slate-600 tabular-nums">
                    Temp: {det.operatingTemperatureC !== null ? `${det.operatingTemperatureC} °C` : '—'}
                    <span className="mx-1.5 text-slate-300">·</span>
                    Array: {det.widthPixels ?? '—'} × {det.heightPixels ?? '—'} px
                  </div>
                  <div className="text-slate-500">
                    ID: <span className="font-mono text-slate-700">{det.identifier ?? '—'}</span>
                    <span className="mx-1.5 text-slate-300">·</span>
                    Readout modes: <span className="font-mono tabular-nums">{det.readoutModes.length}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="border border-slate-200 rounded-md p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            Gratings ({gratings.length})
          </h2>
          {gratings.length === 0 ? (
            <p className="text-xs text-slate-500">No grating entries detected.</p>
          ) : (
            <div className="space-y-3">
              {gratings.map((g) => {
                const calibratedTracks = g.calibrations.filter(
                  (c) => c.calibrationStatus === 1,
                ).length;
                const uncalibratedTracks = g.calibrations.filter(
                  (c) => c.calibrationStatus !== null && c.calibrationStatus !== 1,
                ).length;
                return (
                  <div key={g.key} className="text-xs space-y-1">
                    <div className="flex items-baseline justify-between gap-2">
                      <span className="font-medium text-slate-900">{g.gratingName ?? g.key}</span>
                      <button
                        type="button"
                        onClick={() => onInspectPath(g.sectionPath)}
                        className="font-mono text-blue-700 hover:underline"
                      >
                        {g.key}
                      </button>
                    </div>
                    <div className="font-mono text-slate-600 tabular-nums">
                      Tracks: {g.calibrations.length}
                      {uncalibratedTracks > 0 ? (
                        <span className="ml-1.5 text-amber-700 font-medium">
                          ({calibratedTracks}/{g.calibrations.length} calibrated)
                        </span>
                      ) : calibratedTracks > 0 ? (
                        <span className="ml-1.5 text-emerald-700">
                          ({calibratedTracks}/{g.calibrations.length} calibrated)
                        </span>
                      ) : null}
                    </div>
                    <div className="text-slate-500 font-mono">
                      Motor: <span className="text-slate-700">{g.motorKeyName ?? '—'}</span>
                      <span className="mx-1.5 text-slate-300">·</span>
                      Step: {g.stepSize !== null ? g.stepSize.toFixed(2) : '—'}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="border border-slate-200 rounded-md p-4">
          <h2 className="text-sm font-semibold text-slate-900 mb-3">
            Motors ({motors.length})
          </h2>
          {motors.length === 0 ? (
            <p className="text-xs text-slate-500">No motor entries detected.</p>
          ) : (
            <ul className="space-y-2 text-xs">
              {motors.map((m) => (
                <li key={m.key} className="flex items-baseline justify-between gap-2">
                  <button
                    type="button"
                    onClick={() => onInspectPath(m.sectionPath)}
                    className="text-left font-medium text-slate-800 hover:text-blue-700 truncate"
                  >
                    {m.motorName}
                  </button>
                  <span className="font-mono text-slate-500 tabular-nums shrink-0">
                    {m.positionLogical !== null
                      ? `${Number(m.positionLogical.toFixed(2))} ${m.units ?? ''}`.trim()
                      : '—'}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </div>
  );
}
