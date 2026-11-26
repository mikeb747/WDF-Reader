/**
 * Pure TypeScript sample registry fixtures for immediate unit testing and
 * interactive verification before copying the module to another project.
 */

export interface RegistryFixtureMetadata {
  readonly id: string;
  readonly label: string;
  readonly description: string;
  readonly suggestedFileName: string;
  readonly suggestedFolderName?: string;
  readonly content: string;
}

/**
 * Fixture 1: Clean, passing Virsa WiRE 5.6 system with dual-wavelength
 * 785 nm + 532 nm HiRes/HiSens pairs, Centrus CCD, grating calibration, and motors.
 */
export const SAMPLE_VIRSA_PASSING_REG = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0]

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\Instrument Serial Number]
"__type__"=dword:00000008
"__value__"="VR9K42"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\WiRE2 Version]
"__type__"=dword:00000008
"__value__"="WiRE 5.6, original release"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\Instrument type]
"__type__"=dword:00000003
"__value__"=dword:00000002

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\akdm\\zeroLevel_darkCurrent\\props\\0\\LastCollectionTime]
"__type__"=dword:00000007
"__value__"="45882.5"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\CCD\\Name]
"__type__"=dword:00000008
"__value__"="Renishaw Centrus 9K4201"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\CCD\\Operating Temperature]
"__type__"=dword:00000016
"__value__"=dword:ffffffba

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\CCD\\Width in Pixels]
"__type__"=dword:00000016
"__value__"=dword:00000410

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\CCD\\Height In Pixels]
"__type__"=dword:00000016
"__value__"=dword:00000100

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\_nitems]
"__type__"=dword:00000003
"__value__"=dword:00000004

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\_key0]
"__type__"=dword:00000008
"__value__"="laser0"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\_key1]
"__type__"=dword:00000008
"__value__"="laser1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\_key2]
"__type__"=dword:00000008
"__value__"="laser2"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\_key3]
"__type__"=dword:00000008
"__value__"="laser3"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0]
"__type__"=dword:0000000d
@="{9142E587-BA52-498E-8DFF-18CDF12B3771}"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\LaserName]
"__type__"=dword:00000008
"__value__"="785 P1 HiRes"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="12742.4"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\MaxPower]
"__type__"=dword:00000005
"__value__"="88"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\NDPercent]
"__type__"=dword:00000005
"__value__"="10"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1]
"__type__"=dword:0000000d
@="{9142E587-BA52-498E-8DFF-18CDF12B3771}"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\LaserName]
"__type__"=dword:00000008
"__value__"="785 P1 HiSens"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="12742.4"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\MaxPower]
"__type__"=dword:00000005
"__value__"="90"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\NDPercent]
"__type__"=dword:00000005
"__value__"="10"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser2\\LaserName]
"__type__"=dword:00000008
"__value__"="532 P2 HiRes"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser2\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="18794.1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser2\\MaxPower]
"__type__"=dword:00000005
"__value__"="45"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser2\\NDPercent]
"__type__"=dword:00000005
"__value__"="5"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser3\\LaserName]
"__type__"=dword:00000008
"__value__"="532 P2 HiSens"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser3\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="18794.1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser3\\MaxPower]
"__type__"=dword:00000005
"__value__"="48"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser3\\NDPercent]
"__type__"=dword:00000005
"__value__"="5"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\_nitems]
"__type__"=dword:00000003
"__value__"=dword:00000001

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\_key0]
"__type__"=dword:00000008
"__value__"="grating0"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\Grating Name]
"__type__"=dword:00000008
"__value__"="1500 l/mm (vis)"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\_nitems]
"__type__"=dword:00000003
"__value__"=dword:00000002

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\_key0]
"__type__"=dword:00000008
"__value__"="0"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\_key1]
"__type__"=dword:00000008
"__value__"="1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\0\\Area Key\\Laser Name]
"__type__"=dword:00000008
"__value__"="laser0"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\0\\0\\Static Dynamic Offset]
"__type__"=dword:00000005
"__value__"="0.12"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\1\\Area Key\\Laser Name]
"__type__"=dword:00000008
"__value__"="laser1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\1\\0\\Static Dynamic Offset]
"__type__"=dword:00000005
"__value__"="0.05"
`;

/**
 * Fixture 2: Deliberately triggers all 5 built-in Virsa rules
 * (factory default wavenumber, HiRes/HiSens mismatch, out-of-tolerance wavenumber,
 * low laser power, and folder serial mismatch).
 */
export const SAMPLE_VIRSA_FAILING_RULES_REG = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\Instrument Serial Number]
"__type__"=dword:00000008
"__value__"="BAD999"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\WiRE2 Version]
"__type__"=dword:00000008
"__value__"="WiRE 5.5 Service Pack 1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\LaserName]
"__type__"=dword:00000008
"__value__"="785 P1 HiRes"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="12738.9"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\MaxPower]
"__type__"=dword:00000005
"__value__"="9.5"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser0\\NDPercent]
"__type__"=dword:00000005
"__value__"="10"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\LaserName]
"__type__"=dword:00000008
"__value__"="785 P1 HiSens"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="12749.5"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\MaxPower]
"__type__"=dword:00000005
"__value__"="85"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\NDPercent]
"__type__"=dword:00000005
"__value__"="10"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser2\\LaserName]
"__type__"=dword:00000008
"__value__"="532 P2 Solo"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser2\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="18793.8"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser2\\MaxPower]
"__type__"=dword:00000005
"__value__"="42"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\1\\0\\Static Dynamic Offset]
"__type__"=dword:00000005
"__value__"="0"
`;

/**
 * Fixture 3: Legacy REGEDIT4 + WOW6432Node + System1 + binary/expand/multi/qword/deletion
 * syntax demonstrating cross-version compatibility.
 */
export const SAMPLE_WIRE_LEGACY_WOW64_REG = `REGEDIT4
; Legacy 32-bit WiRE export stored under WOW6432Node on 64-bit Windows

[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\GeneralProperties\\Instrument Serial Number]
"__type__"=dword:00000008
"__value__"="LG4012"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\GeneralProperties\\WiRE2 Version]
"__type__"=dword:00000008
"__value__"="WiRE 4.4"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\Laser Collection\\laser0\\LaserName]
"__type__"=dword:00000008
"__value__"="633 HeNe"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\Laser Collection\\laser0\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="15802.7"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\Laser Collection\\laser0\\MaxPower]
"__type__"=dword:00000005
"__value__"="17"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\CustomBinary]
"Blob"=hex:01,02,0a,ff,\\
  10,20,30,40
"InstallDir"=hex(2):25,50,72,6f,67,72,61,6d,44,61,74,61,25,00
"SearchPaths"=hex(7):41,6c,70,68,61,00,42,65,74,61,00,00
"LargeCounter"=hex(b):01,00,00,00,02,00,00,00
"ObsoleteValue"=-

[-HKEY_LOCAL_MACHINE\\SOFTWARE\\WOW6432Node\\Renishaw\\WiRE2\\Systems\\System1\\DeprecatedKey]
`;

/**
 * Fixture 4: Malformed lines & edge cases to verify graceful error recovery,
 * exact line-number diagnostics, escaped quotes/backslashes, and duplicate handling.
 */
export const SAMPLE_MALFORMED_EDGE_CASES_REG = `Windows Registry Editor Version 5.00
; Fixture exercising malformed syntax and edge cases

"OrphanBeforeSection"="should trigger ORPHAN_VALUE_ENTRY"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\EscapedDemo]
"Quoted\\"Key"="Value with \\"quotes\\" and C:\\\\Renishaw\\\\WiRE2\\\\"
"BadDword"=dword:ZZZZ1234
"Unterminated"="missing closing quote
"BadHex"=hex:01,GG,03
"BadQword"=hex(b):01,02,03
"UnknownPrefix"=foo:bar
NotAValidAssignmentLine
"DuplicateKey"="first"
"DuplicateKey"="second"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\UnclosedHeader
"IgnoredUnderBrokenHeader"="orphan"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\EscapedDemo]
"MergedAfterDuplicateSection"=dword:0000002a
`;

/**
 * Fixture 5: Compact Renishaw inVia WiRE 5.7 system with Instrument type 0,
 * 514 nm edge laser, 1800 l/mm grating, CameraOverheads, and VT_VARIANT COM SafeArray.
 */
export const SAMPLE_INVIA_REG = `Windows Registry Editor Version 5.00

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0]

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\CameraOverheads\\DllVersion]
"__type__"=dword:00000008
"__value__"="5.7.0.44973"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\Instrument Serial Number]
"__type__"=dword:00000008
"__value__"="IV5140"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\WiRE2 Version]
"__type__"=dword:00000008
"__value__"="WiRE 5.7, original release"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\Instrument type]
"__type__"=dword:00000003
"__value__"=dword:00000000

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\LaserAlign\\NDForLaser\\laser1]
@="Array"
"__type__"=dword:0000000c
"nElements"=dword:00000003
"cDims"=dword:00000001
"d0"="0 3"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\LaserAlign\\NDForLaser\\laser1\\0]
"__type__"=dword:00000005
"__value__"="0.5"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\GeneralProperties\\WiREMoveXYZ\\0\\FriendlyName]
"__type__"=dword:00000008
"__value__"="inVia"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\_nitems]
"__type__"=dword:00000003
"__value__"=dword:00000001

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\_key0]
"__type__"=dword:00000008
"__value__"="laser1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\LaserName]
"__type__"=dword:00000008
"__value__"="514 nm edge"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\LaserWavenumber]
"__type__"=dword:00000005
"__value__"="19437.45"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\MaxPower]
"__type__"=dword:00000005
"__value__"="0"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Laser Collection\\laser1\\NDPercent]
"__type__"=dword:00000005
"__value__"="100"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\Grating Name]
"__type__"=dword:00000008
"__value__"="1800 l/mm (vis)"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\0\\Area Key\\Laser Name]
"__type__"=dword:00000008
"__value__"="laser1"

[HKEY_LOCAL_MACHINE\\SOFTWARE\\Renishaw\\WiRE2\\Systems\\System0\\Grating Collection\\grating0\\0\\0\\Static Dynamic Offset]
"__type__"=dword:00000005
"__value__"="-4.2"
`;

export const SAMPLE_FIXTURES: readonly RegistryFixtureMetadata[] = [
  {
    id: 'virsa-passing',
    label: 'Virsa Passing (785 + 532 nm)',
    description: 'Clean dual-wavelength WiRE 5.6 Virsa system where all 5 built-in rules pass.',
    suggestedFileName: 'VR9K42_20250813_sys.rrg',
    suggestedFolderName: 'VR9K42_LabA',
    content: SAMPLE_VIRSA_PASSING_REG,
  },
  {
    id: 'invia-wire57',
    label: 'inVia Sample (514 nm · WiRE 5.7)',
    description: 'Renishaw inVia WiRE 5.7 sample with VT_VARIANT COM SafeArrays, CameraOverheads, and 1800 l/mm grating.',
    suggestedFileName: 'IV5140_inVia_sys.reg',
    suggestedFolderName: 'IV5140_LabB',
    content: SAMPLE_INVIA_REG,
  },
  {
    id: 'virsa-failing',
    label: 'Virsa Failing Rules',
    description:
      'Triggers default wavenumber, HiRes/HiSens mismatch, out-of-tolerance wavenumber, low power, and serial mismatch.',
    suggestedFileName: 'C14R96_20250813_sys.rrg',
    suggestedFolderName: 'C14R96_FZJ',
    content: SAMPLE_VIRSA_FAILING_RULES_REG,
  },
  {
    id: 'wire-legacy-wow64',
    label: 'Legacy REGEDIT4 / WOW6432Node',
    description:
      'REGEDIT4 export under WOW6432Node\\System1 with hex binary continuations, REG_EXPAND_SZ, REG_MULTI_SZ, REG_QWORD, and deletions.',
    suggestedFileName: 'LG4012_legacy_sys.reg',
    suggestedFolderName: 'LG4012_Legacy',
    content: SAMPLE_WIRE_LEGACY_WOW64_REG,
  },
  {
    id: 'malformed-edge-cases',
    label: 'Malformed & Edge Cases',
    description:
      'Exercises syntax recovery, escaped strings, bad DWORD/hex/QWORD payloads, duplicate sections/values, and unclosed headers.',
    suggestedFileName: 'malformed_sample.reg',
    content: SAMPLE_MALFORMED_EDGE_CASES_REG,
  },
];
