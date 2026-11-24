import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import type { WdfBlockSummary, WdfFile } from '../lib/wdf';

interface BlockMapViewProps {
  wdf: WdfFile;
  rawBytes: Uint8Array;
}

const BYTES_PER_ROW = 16;
const BYTES_PER_PAGE = 256;

const BLOCK_BAR_COLORS: Record<string, string> = {
  WDF1: '#1E40AF',
  DATA: '#2563EB',
  XLST: '#0284C7',
  YLST: '#0891B2',
  BKXL: '#0D9488',
  ORGN: '#059669',
  TEXT: '#65A30D',
  WXDA: '#4F46E5',
  WXDM: '#64748B',
  WXCS: '#7C3AED',
  WXIS: '#0F766E',
  ZLDC: '#475569',
  WMAP: '#D97706',
  WHTL: '#DC2626',
};

function formatHexOffset(offset: number): string {
  return `0x${offset.toString(16).toUpperCase().padStart(6, '0')}`;
}

function formatHexDump(bytes: Uint8Array, blockOffset: number, pageOffset: number, length: number) {
  const rows: Array<{ addr: string; hex: string; ascii: string }> = [];
  const start = blockOffset + pageOffset;
  const end = Math.min(bytes.length, start + length);

  for (let pos = start; pos < end; pos += BYTES_PER_ROW) {
    const hexParts: string[] = [];
    let ascii = '';
    for (let i = 0; i < BYTES_PER_ROW; i++) {
      if (pos + i < end) {
        const b = bytes[pos + i];
        hexParts.push(b.toString(16).toUpperCase().padStart(2, '0'));
        ascii += b >= 32 && b <= 126 ? String.fromCharCode(b) : '.';
      } else {
        hexParts.push('  ');
        ascii += ' ';
      }
      if (i === 7) hexParts.push('');
    }
    rows.push({
      addr: formatHexOffset(pos),
      hex: hexParts.join(' '),
      ascii,
    });
  }
  return rows;
}

export function BlockMapView({ wdf, rawBytes }: BlockMapViewProps) {
  const [selectedIdx, setSelectedIdx] = useState(0);
  const [hexPage, setHexPage] = useState(0);

  useEffect(() => {
    setSelectedIdx(0);
    setHexPage(0);
  }, [wdf]);

  const selectedBlock: WdfBlockSummary | null = wdf.blocks[selectedIdx] ?? null;

  const totalPages = selectedBlock ? Math.max(1, Math.ceil(selectedBlock.size / BYTES_PER_PAGE)) : 1;
  const clampedPage = Math.min(hexPage, totalPages - 1);

  const hexRows = useMemo(() => {
    if (!selectedBlock) return [];
    const pageOffset = clampedPage * BYTES_PER_PAGE;
    const remaining = Math.max(0, selectedBlock.size - pageOffset);
    return formatHexDump(rawBytes, selectedBlock.offset, pageOffset, Math.min(BYTES_PER_PAGE, remaining));
  }, [rawBytes, selectedBlock, clampedPage]);

  const handleSelectBlock = (idx: number) => {
    setSelectedIdx(idx);
    setHexPage(0);
  };

  return (
    <div className="p-5 lg:p-6 space-y-5 max-w-[1400px]">
      <div className="flex flex-col sm:flex-row sm:items-end justify-between gap-3 border-b border-slate-200 pb-4">
        <div>
          <h1 className="text-lg font-semibold text-slate-900 tracking-tight">
            Binary Block Structure &amp; Hex Inspector
          </h1>
          <p className="mt-0.5 text-xs text-slate-500 font-mono tabular-nums">
            Total size {wdf.byteLength.toLocaleString()} bytes · {wdf.blocks.length} blocks parsed ·{' '}
            {wdf.warnings.length === 0 ? 'Clean EOF walk' : `${wdf.warnings.length} warnings`}
          </p>
        </div>
      </div>

      {/* Proportional Byte-Offset Map Bar */}
      <section className="bg-white border border-slate-200 rounded p-4 space-y-2.5">
        <div className="flex items-center justify-between text-xs">
          <h2 className="font-semibold text-slate-700 uppercase tracking-wider text-[11px]">
            Proportional File Layout (Click Block to Inspect)
          </h2>
          <span className="font-mono tabular-nums text-slate-500 text-[11px]">
            0x000000 → {formatHexOffset(wdf.byteLength)}
          </span>
        </div>

        <div className="w-full h-7 rounded overflow-hidden border border-slate-200 flex bg-slate-100">
          {wdf.blocks.map((block, idx) => {
            const pct = Math.max(1.2, (block.size / Math.max(1, wdf.byteLength)) * 100);
            const isSelected = idx === selectedIdx;
            const color = BLOCK_BAR_COLORS[block.id] ?? '#64748B';
            return (
              <button
                key={`${block.id}-${block.offset}`}
                type="button"
                onClick={() => handleSelectBlock(idx)}
                title={`${block.id}: ${block.size.toLocaleString()} bytes @ ${formatHexOffset(block.offset)}`}
                style={{ width: `${pct}%`, backgroundColor: color }}
                className={`h-full transition-opacity cursor-pointer border-r border-white/40 last:border-r-0 ${
                  isSelected ? 'opacity-100 ring-2 ring-inset ring-slate-900' : 'opacity-75 hover:opacity-100'
                }`}
                aria-label={`Select block ${block.id} at offset ${formatHexOffset(block.offset)}`}
              />
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] font-mono text-slate-600">
          {wdf.blocks.map((block, idx) => (
            <button
              key={`legend-${block.id}-${block.offset}`}
              type="button"
              onClick={() => handleSelectBlock(idx)}
              className={`inline-flex items-center gap-1.5 cursor-pointer ${
                idx === selectedIdx ? 'font-semibold text-blue-600 underline' : 'hover:text-slate-900'
              }`}
            >
              <span
                className="w-2.5 h-2.5 rounded-xs inline-block shrink-0"
                style={{ backgroundColor: BLOCK_BAR_COLORS[block.id] ?? '#64748B' }}
              />
              <span>{block.id}</span>
            </button>
          ))}
        </div>
      </section>

      {/* Block Directory Table */}
      <section className="bg-white border border-slate-200 rounded overflow-hidden">
        <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-wider text-slate-700">
            Block Directory
          </h2>
          <span className="text-[11px] font-mono text-slate-500">
            16-byte header per block (4B ID + 4B UID + 8B Size)
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs text-left border-collapse">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 bg-white">
                <th className="py-2 px-3 font-medium">Offset</th>
                <th className="py-2 px-3 font-medium">Block ID</th>
                <th className="py-2 px-3 font-medium">Hex Signature</th>
                <th className="py-2 px-3 font-medium text-right">UID</th>
                <th className="py-2 px-3 font-medium text-right">Size (Bytes)</th>
                <th className="py-2 px-3 font-medium text-right">Share</th>
                <th className="py-2 px-3 font-medium">Description</th>
                <th className="py-2 px-3 font-medium text-right">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {wdf.blocks.map((block, idx) => {
                const isSelected = idx === selectedIdx;
                const share = (block.size / Math.max(1, wdf.byteLength)) * 100;
                return (
                  <tr
                    key={`${block.id}-${block.offset}`}
                    onClick={() => handleSelectBlock(idx)}
                    className={`cursor-pointer transition-colors ${
                      isSelected ? 'bg-blue-50/70' : 'hover:bg-slate-50'
                    }`}
                  >
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-600">
                      {formatHexOffset(block.offset)}
                    </td>
                    <td className="py-2 px-3 font-mono font-semibold text-slate-900">
                      {block.id}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-slate-500">{block.idHex}</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-600">{block.uid}</td>
                    <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-900">
                      {block.size.toLocaleString()}
                    </td>
                    <td className="py-2 px-3 font-mono tabular-nums text-right text-slate-500">
                      {share.toFixed(1)}%
                    </td>
                    <td className="py-2 px-3 text-slate-700">{block.description}</td>
                    <td className="py-2 px-3 text-right font-mono text-[11px]">
                      <span className={block.parsed ? 'text-emerald-700 font-medium' : 'text-amber-700'}>
                        {block.parsed ? 'Decoded' : 'Raw'}
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* Hex & ASCII Inspector for Selected Block */}
      {selectedBlock && (
        <section className="bg-white border border-slate-200 rounded overflow-hidden">
          <div className="px-4 py-2.5 bg-slate-50 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-baseline gap-2.5">
              <h2 className="text-xs font-mono font-semibold text-slate-900">
                Hex Inspector · {selectedBlock.id}
              </h2>
              <span className="text-xs font-mono tabular-nums text-slate-500">
                Offset {formatHexOffset(selectedBlock.offset)} ({selectedBlock.size.toLocaleString()} bytes)
              </span>
            </div>

            <div className="flex items-center gap-2 text-xs font-mono tabular-nums">
              <button
                type="button"
                disabled={clampedPage === 0}
                onClick={() => setHexPage((p) => Math.max(0, p - 1))}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 cursor-pointer"
              >
                <ChevronLeft className="w-3.5 h-3.5" aria-hidden="true" />
                <span>Prev</span>
              </button>
              <span className="text-slate-600">
                Page {clampedPage + 1} / {totalPages.toLocaleString()}
              </span>
              <button
                type="button"
                disabled={clampedPage >= totalPages - 1}
                onClick={() => setHexPage((p) => Math.min(totalPages - 1, p + 1))}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-slate-200 bg-white hover:bg-slate-50 disabled:opacity-40 text-slate-700 cursor-pointer"
              >
                <span>Next</span>
                <ChevronRight className="w-3.5 h-3.5" aria-hidden="true" />
              </button>
            </div>
          </div>

          <div className="p-4 overflow-x-auto bg-slate-950 text-slate-100 font-mono text-[11px] leading-5">
            <div className="min-w-[680px]">
              <div className="text-slate-400 border-b border-slate-800 pb-1.5 mb-1.5 flex gap-6">
                <span className="w-20 shrink-0">OFFSET</span>
                <span className="w-[388px] shrink-0">00 01 02 03 04 05 06 07  08 09 0A 0B 0C 0D 0E 0F</span>
                <span>ASCII</span>
              </div>
              {hexRows.map((row) => (
                <div key={row.addr} className="flex gap-6 hover:bg-slate-900">
                  <span className="w-20 shrink-0 text-blue-400">{row.addr}</span>
                  <span className="w-[388px] shrink-0 text-slate-200 whitespace-pre">{row.hex}</span>
                  <span className="text-emerald-300 whitespace-pre">{row.ascii}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
