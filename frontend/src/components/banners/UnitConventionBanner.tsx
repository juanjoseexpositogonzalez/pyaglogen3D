"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { Info, X } from "lucide-react";

/**
 * Banner informing users about the Rg unit-convention correction for legacy
 * simulations. Renders only when the stored parameters schema is v1 or null
 * (i.e. pre-migration data). v2 simulations never see it — callers must pass
 * `"v1" | null` only, which is enforced by the prop type.
 *
 * Dismissal is persisted in `localStorage` under a per-user key so the banner
 * stays dismissed across sessions and simulations for the same user.
 */

interface UnitConventionBannerProps {
  simulationId: string;
  schemaVersion: "v1" | null;
  userId: string;
  onDismiss?: () => void;
}

const DISMISS_KEY_PREFIX = "dismissed-banner:unit-convention:";

function dismissKey(userId: string): string {
  return DISMISS_KEY_PREFIX + userId;
}

export function UnitConventionBanner({
  schemaVersion: _schemaVersion,
  userId,
  onDismiss,
}: UnitConventionBannerProps) {
  // Start hidden to avoid a flash before the localStorage check runs on the
  // client; SSR renders nothing. The effect below flips to visible when the
  // user has not previously dismissed the banner.
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      const flag = window.localStorage.getItem(dismissKey(userId));
      setVisible(flag !== "true");
    } catch {
      // localStorage access may throw (Safari private mode, etc.). Fall back
      // to rendering the banner — explicit dismissal will retry the write.
      setVisible(true);
    }
  }, [userId]);

  // Prop type enforces only "v1" | null reaches this component, but guard
  // anyway so a future caller passing through a union stays safe.
  // (No-op: this component is only rendered when callers have narrowed the
  // schema version to v1/null.)

  if (!visible) return null;

  const handleDismiss = () => {
    if (typeof window !== "undefined") {
      try {
        window.localStorage.setItem(dismissKey(userId), "true");
      } catch {
        // Ignore write failures; the banner will reappear on next render
        // which is acceptable fallback behaviour.
      }
    }
    setVisible(false);
    onDismiss?.();
  };

  return (
    <div
      role="alert"
      className="mb-6 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 p-4 text-sm dark:border-blue-800 dark:bg-blue-950/30"
    >
      <Info className="mt-0.5 h-4 w-4 flex-shrink-0 text-blue-600 dark:text-blue-400" />
      <div className="flex-1 space-y-1">
        <p className="text-blue-900 dark:text-blue-100">
          Unit convention updated. Rg values previously displayed were 2× the
          correct nm value; display is now corrected. Stored data unchanged.
        </p>
        <Link
          href="/docs/unit-convention"
          className="inline-block text-blue-700 underline hover:text-blue-900 dark:text-blue-300 dark:hover:text-blue-100"
        >
          Learn more
        </Link>
      </div>
      <button
        type="button"
        onClick={handleDismiss}
        aria-label="Dismiss banner"
        className="flex-shrink-0 rounded p-1 text-blue-700 hover:bg-blue-100 dark:text-blue-300 dark:hover:bg-blue-900/50"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
