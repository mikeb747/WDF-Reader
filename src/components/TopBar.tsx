import { PWAInstallButton } from './PWAInstallButton';

export type ActiveTab = 'spectrum' | 'instrument' | 'registry' | 'blocks' | 'export';

interface TopBarProps {
  activeTab: ActiveTab;
  onSelectTab: (tab: ActiveTab) => void;
  isPwaBuild?: boolean;
}

const ALL_NAV_ITEMS: Array<{ id: ActiveTab; label: string; demoOnly?: boolean }> = [
  { id: 'spectrum', label: 'Spectrum' },
  { id: 'instrument', label: 'Instrument' },
  { id: 'registry', label: 'Registry' },
  { id: 'blocks', label: 'Block Map', demoOnly: true },
  { id: 'export', label: 'TypeScript Export', demoOnly: true },
];

export function TopBar({ activeTab, onSelectTab, isPwaBuild = false }: TopBarProps) {
  const navItems = isPwaBuild
    ? ALL_NAV_ITEMS.filter((item) => !item.demoOnly)
    : ALL_NAV_ITEMS;

  return (
    <header className="bg-white border-b border-slate-200 shrink-0">
      <div className="h-14 px-4 lg:px-6 flex items-center justify-between gap-4">
        {/* Zone 1: Brand Wordmark */}
        <div className="flex items-baseline gap-2.5 min-w-0 shrink-0">
          <span className="text-[15px] font-semibold tracking-tight text-slate-900 whitespace-nowrap">
            WiRE Reader
          </span>
          <span className="hidden sm:inline text-xs text-slate-500 whitespace-nowrap">
            Renishaw WiRE Parser
          </span>
        </div>

        {/* Zone 2: Navigation Tabs (Desktop) */}
        <nav aria-label="Primary sections" className="hidden md:flex items-center h-full gap-2">
          {navItems.map((item) => {
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

        {/* Zone 3: Install Desktop PWA Action */}
        <div className="flex items-center justify-end shrink-0 min-w-[2rem]">
          <PWAInstallButton />
        </div>
      </div>

      {/* Mobile Navigation Row */}
      <nav
        aria-label="Mobile sections"
        className="flex md:hidden items-center border-t border-slate-100 px-3 gap-1 overflow-x-auto"
      >
        {navItems.map((item) => {
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
