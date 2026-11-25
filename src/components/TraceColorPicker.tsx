import { useEffect, useRef, useState } from 'react';
import { Check } from 'lucide-react';

export interface TraceColorOption {
  hex: string;
  name: string;
}

/**
 * 16 maximally distinguishable, high-contrast trace colors engineered to stand out
 * clearly against a white (#FFFFFF) scientific chart background.
 */
export const TRACE_COLOR_OPTIONS: TraceColorOption[] = [
  { hex: '#2563EB', name: 'Cobalt Blue' },
  { hex: '#DC2626', name: 'Crimson Red' },
  { hex: '#0D9488', name: 'Deep Teal' },
  { hex: '#D97706', name: 'Amber Gold' },
  { hex: '#7C3AED', name: 'Royal Violet' },
  { hex: '#16A34A', name: 'Emerald Green' },
  { hex: '#DB2777', name: 'Magenta Rose' },
  { hex: '#0284C7', name: 'Cerulean Blue' },
  { hex: '#EA580C', name: 'Burnt Orange' },
  { hex: '#4F46E5', name: 'Indigo' },
  { hex: '#65A30D', name: 'Olive Lime' },
  { hex: '#9333EA', name: 'Amethyst Purple' },
  { hex: '#0891B2', name: 'Deep Cyan' },
  { hex: '#991B1B', name: 'Burgundy' },
  { hex: '#854D0E', name: 'Bronze Brown' },
  { hex: '#1E293B', name: 'Charcoal Slate' },
];

export const TRACE_COLOR_PALETTE: string[] = TRACE_COLOR_OPTIONS.map((c) => c.hex);

interface TraceColorPickerProps {
  color: string;
  fileName: string;
  onChange: (newColor: string) => void;
  size?: 'sm' | 'md';
}

export function TraceColorPicker({
  color,
  fileName,
  onChange,
  size = 'md',
}: TraceColorPickerProps) {
  const [open, setOpen] = useState(false);
  const [popoverPos, setPopoverPos] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  const normalizedColor = color.toUpperCase();
  const activeOption = TRACE_COLOR_OPTIONS.find((c) => c.hex.toUpperCase() === normalizedColor);

  const toggleOpen = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!open && buttonRef.current) {
      const rect = buttonRef.current.getBoundingClientRect();
      const popWidth = 196;
      const popHeight = 208;
      const left = Math.min(window.innerWidth - popWidth - 12, Math.max(8, rect.left));
      const top =
        rect.bottom + popHeight + 12 > window.innerHeight
          ? Math.max(8, rect.top - popHeight - 6)
          : rect.bottom + 6;
      setPopoverPos({ top, left });
    }
    setOpen((prev) => !prev);
  };

  useEffect(() => {
    if (!open) return;
    const handleOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        popoverRef.current &&
        !popoverRef.current.contains(target) &&
        buttonRef.current &&
        !buttonRef.current.contains(target)
      ) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', handleOutside);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('mousedown', handleOutside);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  const dimClass = size === 'sm' ? 'w-3 h-3' : 'w-3.5 h-3.5';

  return (
    <div className="relative inline-flex items-center shrink-0" onClick={(e) => e.stopPropagation()}>
      <button
        ref={buttonRef}
        type="button"
        onClick={toggleOpen}
        aria-label={`Trace color for ${fileName}`}
        aria-expanded={open}
        aria-haspopup="dialog"
        title={`Trace color: ${activeOption?.name ?? color} (${color}) — click to choose from 16 high-contrast colors`}
        className={`${dimClass} rounded-xs shrink-0 cursor-pointer ring-1 ring-slate-300 hover:ring-slate-600 focus:outline-none focus:ring-2 focus:ring-blue-600 transition-shadow`}
        style={{ backgroundColor: color }}
      />

      {open && popoverPos && (
        <div
          ref={popoverRef}
          role="dialog"
          aria-label={`Select trace color for ${fileName}`}
          style={{ top: `${popoverPos.top}px`, left: `${popoverPos.left}px` }}
          className="fixed z-50 w-48 p-2.5 rounded border border-slate-200 bg-white shadow-lg"
        >
          <div className="flex items-center justify-between gap-2 mb-2 pb-1.5 border-b border-slate-100">
            <span className="text-[11px] font-semibold text-slate-700 truncate">
              {activeOption?.name ?? 'Trace Color'}
            </span>
            <span className="text-[10px] font-mono text-slate-400">{normalizedColor}</span>
          </div>

          <div className="grid grid-cols-4 gap-1.5" role="listbox" aria-label="16 high-contrast trace colors">
            {TRACE_COLOR_OPTIONS.map((opt) => {
              const isSelected = opt.hex.toUpperCase() === normalizedColor;
              return (
                <button
                  key={opt.hex}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  aria-label={`${opt.name} (${opt.hex})`}
                  title={`${opt.name} (${opt.hex})`}
                  onClick={() => {
                    onChange(opt.hex);
                    setOpen(false);
                  }}
                  style={{ backgroundColor: opt.hex }}
                  className={`h-7 rounded-xs flex items-center justify-center cursor-pointer transition-transform hover:scale-105 focus:outline-none ${
                    isSelected
                      ? 'ring-2 ring-offset-1 ring-slate-900'
                      : 'ring-1 ring-black/15 hover:ring-slate-500'
                  }`}
                >
                  {isSelected && <Check className="w-3.5 h-3.5 text-white drop-shadow" aria-hidden="true" />}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
