/**
 * components/update-banner.tsx — Auto-update banner driven by the main process.
 *
 * Subscribes to `window.scvn.onUpdateStatus` and kicks off a check on mount
 * (after the listener is registered, so no early event is missed). It renders
 * only for actionable phases — an available update, download progress, a ready
 * install, or an error — and stays out of the way otherwise. Download is
 * user-initiated (main sets autoDownload=false); install relaunches the app.
 *
 * In dev / self-test the main process never wires the updater, so no status is
 * ever pushed and this banner renders nothing.
 */

import * as React from "react";
import { Download, RefreshCw, RotateCw, AlertTriangle, X } from "lucide-react";

import type { UpdateStatus } from "@shared/ipc";
import { Button } from "@/components/ui/button";

function formatMB(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

export function UpdateBanner() {
  const [status, setStatus] = React.useState<UpdateStatus | null>(null);
  const [dismissed, setDismissed] = React.useState(false);

  React.useEffect(() => {
    const unsubscribe = window.scvn.onUpdateStatus((next) => {
      setDismissed(false);
      setStatus(next);
    });
    // Listener is registered — safe to trigger the check now.
    window.scvn.checkForUpdates();
    return unsubscribe;
  }, []);

  if (!status || dismissed) return null;
  // Informational phases carry no action; keep the chrome clean.
  if (status.phase === "checking" || status.phase === "not-available") return null;

  const dismissible = status.phase === "available" || status.phase === "error";

  return (
    <div className="flex shrink-0 items-center gap-3 border-b border-border bg-accent/40 px-4 py-2 text-sm">
      {status.phase === "available" && (
        <>
          <Download className="size-4 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            Version <span className="font-medium">{status.version}</span> is available.
          </span>
          <Button size="sm" onClick={() => window.scvn.downloadUpdate()}>
            Download update
          </Button>
        </>
      )}

      {status.phase === "downloading" && (
        <>
          <RefreshCw className="size-4 animate-spin text-primary" />
          <span className="min-w-0 flex-1">
            <span className="mr-2">Downloading update… {Math.round(status.percent)}%</span>
            <span className="text-muted-foreground">
              {formatMB(status.transferred)} / {formatMB(status.total)}
            </span>
            <span className="mt-1 block h-1 w-full overflow-hidden rounded bg-border">
              <span
                className="block h-full bg-primary transition-[width] duration-200"
                style={{ width: `${Math.min(100, Math.max(0, status.percent))}%` }}
              />
            </span>
          </span>
        </>
      )}

      {status.phase === "downloaded" && (
        <>
          <RotateCw className="size-4 text-primary" />
          <span className="min-w-0 flex-1 truncate">
            Version <span className="font-medium">{status.version}</span> is ready to install.
          </span>
          <Button size="sm" onClick={() => window.scvn.quitAndInstall()}>
            Restart & install
          </Button>
        </>
      )}

      {status.phase === "error" && (
        <>
          <AlertTriangle className="size-4 text-destructive" />
          <span className="min-w-0 flex-1 truncate text-muted-foreground">
            Update failed: {status.message}
          </span>
          <Button size="sm" variant="outline" onClick={() => window.scvn.checkForUpdates()}>
            Retry
          </Button>
        </>
      )}

      {dismissible && (
        <Button
          size="icon"
          variant="ghost"
          className="size-7"
          aria-label="Dismiss update notice"
          onClick={() => setDismissed(true)}
        >
          <X className="size-4" />
        </Button>
      )}
    </div>
  );
}
