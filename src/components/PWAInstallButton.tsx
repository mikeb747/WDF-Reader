import { useState } from 'react';
import { MonitorDown, WifiOff, X } from 'lucide-react';
import { useOnlineStatus, usePWAInstall } from './usePWAInstall';

export function PWAInstallButton() {
  const { isInstallable, isInstalled, isIOS, install } = usePWAInstall();
  const [showGuide, setShowGuide] = useState(false);

  if (isInstalled) {
    return null;
  }

  const handleClick = async () => {
    if (isInstallable) {
      await install();
    } else {
      setShowGuide(true);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => void handleClick()}
        className="w-full px-3 py-1.5 rounded border border-slate-200 bg-white hover:bg-slate-50 hover:border-slate-300 text-xs font-medium text-slate-800 flex items-center justify-between transition-colors cursor-pointer"
        title="Install WDF Reader as an offline-ready desktop or mobile Progressive Web App"
      >
        <span className="flex items-center gap-2">
          <MonitorDown className="w-3.5 h-3.5 text-blue-600" aria-hidden="true" />
          <span>{isIOS ? 'Install PWA on iOS' : 'Install Desktop / Mobile PWA'}</span>
        </span>
        <span className="text-[10px] font-mono text-slate-500">PWA</span>
      </button>

      {showGuide && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="pwa-install-title"
          className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
        >
          <div className="w-full max-w-md rounded border border-slate-200 bg-white p-5 shadow-xl space-y-3">
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 pb-2.5">
              <h3 id="pwa-install-title" className="text-sm font-semibold text-slate-900">
                Install WDF Reader as a Progressive Web App
              </h3>
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                aria-label="Close install guide"
                className="text-slate-400 hover:text-slate-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {isIOS ? (
              <ol className="list-decimal list-inside space-y-1.5 text-xs text-slate-700">
                <li>
                  Tap the <strong>Share</strong> button in the Safari toolbar.
                </li>
                <li>
                  Scroll down and tap <strong>Add to Home Screen</strong>.
                </li>
              </ol>
            ) : (
              <div className="space-y-2 text-xs text-slate-700">
                <p>
                  WDF Reader is configured with a Web App Manifest and Workbox offline service worker:
                </p>
                <ol className="list-decimal list-inside space-y-1.5 text-slate-600">
                  <li>
                    If viewing inside an embedded preview frame, open the standalone app URL or deployed GitHub Pages URL in a top-level browser tab.
                  </li>
                  <li>
                    Click the <strong>Install WDF Reader</strong> icon in the browser address bar (Chrome / Edge) or choose <strong>File → Add to Dock</strong> (macOS Safari).
                  </li>
                </ol>
              </div>
            )}

            <div className="pt-2 flex justify-end">
              <button
                type="button"
                onClick={() => setShowGuide(false)}
                className="px-3 py-1.5 rounded bg-slate-900 hover:bg-slate-800 text-white text-xs font-medium cursor-pointer"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export function OfflineIndicator() {
  const isOnline = useOnlineStatus();
  if (isOnline) return null;

  return (
    <div
      role="status"
      className="fixed bottom-4 left-4 z-50 flex items-center gap-2 rounded border border-amber-300 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-900 shadow"
    >
      <WifiOff className="w-3.5 h-3.5 text-amber-700 shrink-0" aria-hidden="true" />
      <span>Offline Mode — Local WDF parsing and cached assets remain active.</span>
    </div>
  );
}
