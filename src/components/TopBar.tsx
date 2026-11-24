import { Upload } from 'lucide-react';

export type ActiveTab = 'spectrum' | 'instrument' | 'blocks' | 'export';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  onOpenFileClick: () => void;
}

const NAV_ITEMS: Array<{ id: ActiveTab; label: string }> = [
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'blocks', label: 'Block Map' },
  { id: 'export', label: 'TypeScript Export' },
];

export function TopBar({ activeTab, onSelectTab, onOpenFileClick }: TopBarProps) {
  return (
    <header className="bg-white border-b border-slate-200 shrink-0">
      <div className="h-14 px-4 lg:px-6 flex items-center justify-between gap-4">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-baseline gap-2.5 min-w-0 shrink-0">
          <span className="text-[15px] font-semibold tracking-tight text-slate-900 whitespace-nowrap">
            WDF Reader
          </span>
          <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap">
            Renishaw WiRE Binary Parser
          </span>
        </div>

        {/* Zone 2: Navigation Tabs (Desktop) */}
        <nav aria-label="Primary sections" className="hidden md:flex items-center h-full gap-2">
          {NAV_ITEMS.map((item) => {
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectTab(item.id)}
                aria-current={isActive ? 'page' : undefined}
                className={`h-full px-3 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                  isActive
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-slate-600 hover:text-slate-900 hover:border-slate-300'
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <button
          type="button"
          onClick={onOpenFileClick}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium whitespace-nowrap shrink-0 transition-colors cursor-pointer"
        >
          <Upload className="w-3.5 h-3.5" aria-hidden="true" />
          <span>Open .wdf File</span>
        </button>
      </div>

      {/* Mobile Navigation Row */}
      <nav
        aria-label="Mobile sections"
        className="flex md:hidden items-center border-t border-slate-100 px-3 gap-1 overflow-x-auto"
      >
        {NAV_ITEMS.map((item) => {
          const isActive = activeTab === item.id;
          return (
            <button
              key={`mobile-${item.id}`}
              type="button"
              onClick={() => onSelectTab(item.id)}
              aria-current={isActive ? 'page' : undefined}
              className={`py-2 px-2.5 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors cursor-pointer ${
                isActive
                  ? 'border-blue-600 text-blue-600'
                  : 'border-transparent text-slate-600 hover:text-slate-900'
              }`}
            >
              {item.label}
            </button>
          );
        })}
      </nav>
    </header>
  );
}
