import { convertXAxis, getSpectrum } from './parser';
import {
  WdfDataType,
  WdfDataUnits,
  WdfMeasurementType,
  WdfScanType,
  getUnitInfo,
  type WdfFile,
} from './types';

export type ArithmeticOperator = '+' | '-' | '*' | '/';

type Token =
  | { type: 'number'; value: number }
  | { type: 'var'; name: 'd1' | 'd2' }
  | { type: 'op'; op: ArithmeticOperator }
  | { type: 'lparen' }
  | { type: 'rparen' };

export type ArithmeticExprNode =
  | { kind: 'number'; value: number }
  | { kind: 'var'; name: 'd1' | 'd2' }
  | { kind: 'unary'; op: '+' | '-'; operand: ArithmeticExprNode }
  | { kind: 'binary'; op: ArithmeticOperator; left: ArithmeticExprNode; right: ArithmeticExprNode };

export interface ParsedArithmeticExpression {
  ast: ArithmeticExprNode;
  usesD1: boolean;
  usesD2: boolean;
}

/**
 * Tokenize a user-supplied spectral arithmetic formula.
 * Supports D1, D2, data1, data2, "data 1", "data 2" (case-insensitive),
 * numeric literals (including decimals and scientific notation), +, -, *, /, and parentheses.
 */
function tokenizeArithmetic(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  const len = input.length;

  while (i < len) {
    const ch = input[i];
    if (/\s/.test(ch)) {
      i++;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ type: 'op', op: ch });
      i++;
      continue;
    }

    if (ch === '×') {
      tokens.push({ type: 'op', op: '*' });
      i++;
      continue;
    }

    if (ch === '÷') {
      tokens.push({ type: 'op', op: '/' });
      i++;
      continue;
    }

    if (ch === '−') {
      tokens.push({ type: 'op', op: '-' });
      i++;
      continue;
    }

    if (ch === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }

    if (ch === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    // Quoted variable reference e.g. "data 1" or 'data 2'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i + 1;
      i++;
      while (i < len && input[i] !== quote) {
        i++;
      }
      if (i >= len) {
        throw new Error(`Unterminated quote near position ${start}`);
      }
      const rawIdent = input.slice(start, i).trim().toLowerCase().replace(/\s+/g, '');
      i++; // consume closing quote
      if (rawIdent === 'data1' || rawIdent === 'd1') {
        tokens.push({ type: 'var', name: 'd1' });
      } else if (rawIdent === 'data2' || rawIdent === 'd2') {
        tokens.push({ type: 'var', name: 'd2' });
      } else {
        throw new Error(`Unknown dataset reference "${input.slice(start, i - 1)}". Use D1 / D2 or "data 1" / "data 2".`);
      }
      continue;
    }

    // Numeric literal (e.g. 150, 0.25, .5, 1e-3)
    if (/[0-9.]/.test(ch)) {
      const start = i;
      let sawDot = ch === '.';
      i++;
      while (i < len && (/[0-9]/.test(input[i]) || (input[i] === '.' && !sawDot))) {
        if (input[i] === '.') sawDot = true;
        i++;
      }
      // Optional scientific notation exponent
      if (i < len && (input[i] === 'e' || input[i] === 'E')) {
        const expPos = i;
        i++;
        if (i < len && (input[i] === '+' || input[i] === '-')) i++;
        const digitStart = i;
        while (i < len && /[0-9]/.test(input[i])) i++;
        if (i === digitStart) {
          i = expPos; // backtrack invalid exponent
        }
      }
      const raw = input.slice(start, i);
      const val = Number(raw);
      if (!Number.isFinite(val)) {
        throw new Error(`Invalid number "${raw}"`);
      }
      tokens.push({ type: 'number', value: val });
      continue;
    }

    // Unquoted identifier: D1, D2, data1, data2, data 1, data 2
    if (/[a-zA-Z_]/.test(ch)) {
      const start = i;
      while (i < len && /[a-zA-Z0-9_]/.test(input[i])) i++;
      let word = input.slice(start, i).toLowerCase();

      // Support unquoted "data 1" or "data 2"
      if (word === 'data') {
        let j = i;
        while (j < len && /\s/.test(input[j])) j++;
        if (j < len && (input[j] === '1' || input[j] === '2')) {
          word = `data${input[j]}`;
          i = j + 1;
        }
      }

      if (word === 'd1' || word === 'data1') {
        tokens.push({ type: 'var', name: 'd1' });
      } else if (word === 'd2' || word === 'data2') {
        tokens.push({ type: 'var', name: 'd2' });
      } else {
        throw new Error(`Unknown identifier "${input.slice(start, i)}". Use D1, D2, "data 1", or "data 2".`);
      }
      continue;
    }

    throw new Error(`Unexpected character "${ch}" at position ${i + 1}`);
  }

  return tokens;
}

/**
 * Safe recursive-descent parser for arithmetic expressions (no eval / Function).
 * Grammar:
 *   expr   := term (('+' | '-') term)*
 *   term   := unary (('*' | '/') unary)*
 *   unary  := ('+' | '-') unary | primary
 *   primary:= NUMBER | VAR | '(' expr ')'
 */
export function parseArithmeticExpression(input: string): ParsedArithmeticExpression {
  const trimmed = input.trim();
  if (!trimmed) {
    throw new Error('Enter an arithmetic formula (for example: D1 / 150).');
  }

  const tokens = tokenizeArithmetic(trimmed);
  if (tokens.length === 0) {
    throw new Error('Enter an arithmetic formula.');
  }

  let pos = 0;
  let usesD1 = false;
  let usesD2 = false;

  const peek = (): Token | undefined => tokens[pos];
  const consume = (): Token => tokens[pos++];

  function parseExpr(): ArithmeticExprNode {
    let node = parseTerm();
    while (true) {
      const tok = peek();
      if (tok && tok.type === 'op' && (tok.op === '+' || tok.op === '-')) {
        consume();
        const right = parseTerm();
        node = { kind: 'binary', op: tok.op, left: node, right };
      } else {
        break;
      }
    }
    return node;
  }

  function parseTerm(): ArithmeticExprNode {
    let node = parseUnary();
    while (true) {
      const tok = peek();
      if (tok && tok.type === 'op' && (tok.op === '*' || tok.op === '/')) {
        consume();
        const right = parseUnary();
        if (tok.op === '/' && right.kind === 'number' && right.value === 0) {
          throw new Error('Division by zero constant is not allowed.');
        }
        node = { kind: 'binary', op: tok.op, left: node, right };
      } else {
        break;
      }
    }
    return node;
  }

  function parseUnary(): ArithmeticExprNode {
    const tok = peek();
    if (tok && tok.type === 'op' && (tok.op === '+' || tok.op === '-')) {
      consume();
      return { kind: 'unary', op: tok.op, operand: parseUnary() };
    }
    return parsePrimary();
  }

  function parsePrimary(): ArithmeticExprNode {
    const tok = peek();
    if (!tok) {
      throw new Error('Unexpected end of formula.');
    }
    if (tok.type === 'number') {
      consume();
      return { kind: 'number', value: tok.value };
    }
    if (tok.type === 'var') {
      consume();
      if (tok.name === 'd1') usesD1 = true;
      if (tok.name === 'd2') usesD2 = true;
      return { kind: 'var', name: tok.name };
    }
    if (tok.type === 'lparen') {
      consume();
      const inner = parseExpr();
      const close = peek();
      if (!close || close.type !== 'rparen') {
        throw new Error('Missing closing parenthesis ")".');
      }
      consume();
      return inner;
    }
    throw new Error(`Unexpected token "${tok.type === 'op' ? tok.op : ')'}" in formula.`);
  }

  const ast = parseExpr();
  if (pos < tokens.length) {
    const extra = tokens[pos];
    const label =
      extra.type === 'number'
        ? String(extra.value)
        : extra.type === 'var'
          ? extra.name.toUpperCase()
          : extra.type === 'op'
            ? extra.op
            : extra.type === 'lparen'
              ? '('
              : ')';
    throw new Error(`Unexpected "${label}" — check missing operator between terms.`);
  }

  if (!usesD1 && !usesD2) {
    throw new Error('Formula must reference at least one dataset (D1 or D2).');
  }

  return { ast, usesD1, usesD2 };
}

export function evaluateArithmeticAst(
  node: ArithmeticExprNode,
  d1: number,
  d2: number,
  state: { guardedDivisions: number },
): number {
  switch (node.kind) {
    case 'number':
      return node.value;
    case 'var':
      return node.name === 'd1' ? d1 : d2;
    case 'unary': {
      const v = evaluateArithmeticAst(node.operand, d1, d2, state);
      return node.op === '-' ? -v : v;
    }
    case 'binary': {
      const l = evaluateArithmeticAst(node.left, d1, d2, state);
      const r = evaluateArithmeticAst(node.right, d1, d2, state);
      switch (node.op) {
        case '+':
          return l + r;
        case '-':
          return l - r;
        case '*':
          return l * r;
        case '/':
          if (Math.abs(r) < 1e-12) {
            state.guardedDivisions += 1;
            return 0;
          }
          return l / r;
      }
    }
  }
}

interface SortedXY {
  x: Float64Array;
  y: Float64Array;
  minX: number;
  maxX: number;
}

function buildSortedXY(xs: ArrayLike<number>, ys: ArrayLike<number>): SortedXY {
  const n = Math.min(xs.length, ys.length);
  const pairs: Array<{ x: number; y: number }> = new Array(n);
  for (let i = 0; i < n; i++) {
    pairs[i] = { x: xs[i], y: ys[i] };
  }
  pairs.sort((a, b) => a.x - b.x);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    x[i] = pairs[i].x;
    y[i] = pairs[i].y;
  }
  return {
    x,
    y,
    minX: n > 0 ? x[0] : 0,
    maxX: n > 0 ? x[n - 1] : 0,
  };
}

/** Linear interpolation on an ascending X array */
function interpolateLinear(sorted: SortedXY, targetX: number): number {
  const { x, y } = sorted;
  const n = x.length;
  if (n === 0) return 0;
  if (targetX <= x[0]) return y[0];
  if (targetX >= x[n - 1]) return y[n - 1];

  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (x[mid] <= targetX) lo = mid;
    else hi = mid;
  }
  const dx = x[hi] - x[lo];
  if (dx <= 1e-12) return y[lo];
  const t = (targetX - x[lo]) / dx;
  return y[lo] + t * (y[hi] - y[lo]);
}

export interface SpectrumArithmeticInput {
  expression: string;
  primary: { wdf: WdfFile; fileName: string; spectrumIndex?: number };
  secondary?: { wdf: WdfFile; fileName: string; spectrumIndex?: number } | null;
  outputName: string;
  /** If true and X-ranges don't overlap, align point-by-point by array index instead of X interpolation. */
  alignByIndex?: boolean;
}

export interface SpectrumArithmeticResult {
  wdf: WdfFile;
  pointCount: number;
  interpolated: boolean;
  overlapUsed: boolean;
  guardedDivisions: number;
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  xUnitsName: string;
  xUnitsSymbol: string;
}

/**
 * Evaluate a spectral arithmetic expression across 1 or 2 WDF datasets and construct
 * a fully compatible derived WdfFile ready for plotting, peak picking, baseline correction, and statistics.
 */
export function computeSpectrumArithmetic(input: SpectrumArithmeticInput): SpectrumArithmeticResult {
  const parsed = parseArithmeticExpression(input.expression);
  const { primary, secondary } = input;

  if (!primary.wdf.xAxis) {
    throw new Error('Dataset 1 does not contain a valid X-axis.');
  }

  if (parsed.usesD2 && (!secondary || !secondary.wdf.xAxis)) {
    throw new Error('Formula references D2 — please select Dataset 2.');
  }

  const y1Raw = getSpectrum(primary.wdf, primary.spectrumIndex ?? 0);
  const x1Native = primary.wdf.xAxis.values;
  const n1 = Math.min(x1Native.length, y1Raw.length);
  if (n1 === 0) {
    throw new Error('Dataset 1 contains no spectral points.');
  }

  let outX: Float32Array;
  let outY: Float32Array;
  let outUnits: WdfDataUnits = primary.wdf.xAxis.units;
  let interpolated = false;
  let overlapUsed = false;
  const evalState = { guardedDivisions: 0 };

  if (!parsed.usesD2 || !secondary || !secondary.wdf.xAxis) {
    // Single-dataset arithmetic directly on D1's native X-axis
    outX = new Float32Array(n1);
    outY = new Float32Array(n1);
    for (let i = 0; i < n1; i++) {
      outX[i] = x1Native[i];
      const val = evaluateArithmeticAst(parsed.ast, y1Raw[i], 0, evalState);
      outY[i] = Number.isFinite(val) ? val : 0;
    }
  } else {
    const y2Raw = getSpectrum(secondary.wdf, secondary.spectrumIndex ?? 0);
    const x2Native = secondary.wdf.xAxis.values;
    const n2 = Math.min(x2Native.length, y2Raw.length);
    if (n2 === 0) {
      throw new Error('Dataset 2 contains no spectral points.');
    }

    // Check if both datasets share identical units and identical X grid (fast direct point-by-point)
    let identicalGrid =
      primary.wdf.xAxis.units === secondary.wdf.xAxis.units && n1 === n2;
    if (identicalGrid) {
      for (let i = 0; i < n1; i++) {
        if (Math.abs(x1Native[i] - x2Native[i]) > 1e-3) {
          identicalGrid = false;
          break;
        }
      }
    }

    if (identicalGrid) {
      outX = new Float32Array(n1);
      outY = new Float32Array(n1);
      for (let i = 0; i < n1; i++) {
        outX[i] = x1Native[i];
        const val = evaluateArithmeticAst(parsed.ast, y1Raw[i], y2Raw[i], evalState);
        outY[i] = Number.isFinite(val) ? val : 0;
      }
    } else if (input.alignByIndex) {
      const nCommon = Math.min(n1, n2);
      outX = new Float32Array(nCommon);
      outY = new Float32Array(nCommon);
      for (let i = 0; i < nCommon; i++) {
        outX[i] = x1Native[i];
        const val = evaluateArithmeticAst(parsed.ast, y1Raw[i], y2Raw[i], evalState);
        outY[i] = Number.isFinite(val) ? val : 0;
      }
    } else {
      // Align both spectra in a common spectral unit (prefer native if same unit, else Raman Shift cm⁻¹)
      const sameUnit = primary.wdf.xAxis.units === secondary.wdf.xAxis.units;
      const commonUnit = sameUnit ? 'native' : 'ramanShift';
      const conv1 = convertXAxis(primary.wdf.xAxis, primary.wdf.header.laserWavenumber, commonUnit);
      const conv2 = convertXAxis(secondary.wdf.xAxis, secondary.wdf.header.laserWavenumber, commonUnit);
      outUnits = sameUnit ? primary.wdf.xAxis.units : WdfDataUnits.RamanShift;

      const s1 = buildSortedXY(conv1.values, y1Raw);
      const s2 = buildSortedXY(conv2.values, y2Raw);

      const overlapMin = Math.max(s1.minX, s2.minX);
      const overlapMax = Math.min(s1.maxX, s2.maxX);
      if (overlapMax <= overlapMin) {
        throw new Error(
          `Datasets have no overlapping X-axis range (${s1.minX.toFixed(1)}–${s1.maxX.toFixed(1)} vs ${s2.minX.toFixed(1)}–${s2.maxX.toFixed(1)} ${conv1.symbol}). Enable "Align by pixel index" to combine them point-by-point.`,
        );
      }

      const xsOverlap: number[] = [];
      const ysOverlap: number[] = [];
      for (let i = 0; i < s1.x.length; i++) {
        const xv = s1.x[i];
        if (xv < overlapMin - 1e-6 || xv > overlapMax + 1e-6) continue;
        const v2 = interpolateLinear(s2, xv);
        const val = evaluateArithmeticAst(parsed.ast, s1.y[i], v2, evalState);
        xsOverlap.push(xv);
        ysOverlap.push(Number.isFinite(val) ? val : 0);
      }

      if (xsOverlap.length < 2) {
        throw new Error('Too few overlapping X points between Dataset 1 and Dataset 2.');
      }

      outX = Float32Array.from(xsOverlap);
      outY = Float32Array.from(ysOverlap);
      interpolated = true;
      overlapUsed = true;
    }
  }

  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let peakX: number | null = null;
  let peakIntensity: number | null = null;

  for (let i = 0; i < outX.length; i++) {
    const xv = outX[i];
    const yv = outY[i];
    if (xv < minX) minX = xv;
    if (xv > maxX) maxX = xv;
    if (yv < minY) minY = yv;
    if (yv > maxY) {
      maxY = yv;
      peakX = xv;
      peakIntensity = yv;
    }
  }

  const xUnitInfo = getUnitInfo(outUnits);
  const baseHeader = primary.wdf.header;
  const baseSummary = primary.wdf.summary;
  const cleanTitle = input.outputName.trim() || input.expression.trim();
  const formulaNote = parsed.usesD2 && secondary
    ? `Data Arithmetic: ${input.expression.trim()} (D1 = ${primary.fileName}, D2 = ${secondary.fileName})`
    : `Data Arithmetic: ${input.expression.trim()} (D1 = ${primary.fileName})`;

  const derivedWdf: WdfFile = {
    byteLength: outX.byteLength + outY.byteLength,
    header: {
      ...baseHeader,
      pointsPerSpectrum: outX.length,
      capacity: 1,
      spectraCollected: 1,
      xListCount: outX.length,
      yListCount: 1,
      originCount: 0,
      scanType: WdfScanType.Static,
      scanTypeName: 'Derived',
      measurementType: WdfMeasurementType.Single,
      measurementTypeName: 'Arithmetic',
      title: cleanTitle,
      timeStart: new Date().toISOString(),
      timeEnd: new Date().toISOString(),
    },
    summary: {
      ...baseSummary,
      title: cleanTitle,
      measurementType: 'Data Arithmetic',
      scanType: interpolated ? 'Derived (X-Interpolated)' : 'Derived',
      pointsPerSpectrum: outX.length,
      spectraCollected: 1,
      xAxisMin: Number.isFinite(minX) ? minX : null,
      xAxisMax: Number.isFinite(maxX) ? maxX : null,
      xAxisUnits: xUnitInfo.name,
      xAxisSymbol: xUnitInfo.symbol,
      peakX,
      peakIntensity,
      comment: formulaNote,
    },
    xAxis: {
      dataType: WdfDataType.Spectral,
      dataTypeName: 'Spectral',
      units: outUnits,
      unitsName: xUnitInfo.name,
      unitsSymbol: xUnitInfo.symbol,
      values: outX,
    },
    yAxis: null,
    backgroundXAxis: null,
    spectra: outY,
    origins: [],
    comment: formulaNote,
    mapArea: null,
    maps: [],
    whiteLightImage: null,
    propertySets: {},
    measurementScript: null,
    blocks: [],
    warnings:
      evalState.guardedDivisions > 0
        ? [`Guarded ${evalState.guardedDivisions} zero-denominator point(s) by clamping to 0.`]
        : [],
  };

  return {
    wdf: derivedWdf,
    pointCount: outX.length,
    interpolated,
    overlapUsed,
    guardedDivisions: evalState.guardedDivisions,
    minX,
    maxX,
    minY,
    maxY,
    xUnitsName: xUnitInfo.name,
    xUnitsSymbol: xUnitInfo.symbol,
  };
}
