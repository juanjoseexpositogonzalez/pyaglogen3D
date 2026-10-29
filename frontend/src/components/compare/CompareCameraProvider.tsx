'use client'

/**
 * Compare-page camera scope provider (T9, change: visualize-multiple).
 *
 * Responsibilities
 * ----------------
 * 1. Generate a stable `sessionId` once per mount — used to derive scope
 *    keys for `useViewerStore.cameraScopes`. Leaving the Compare page and
 *    returning produces a fresh session (R-DELTA-1 — compare camera state
 *    never leaks into the single-sim viewer or into a previous compare
 *    session).
 *
 * 2. Expose `scopeFor(simId)` returning the scope key each grid cell
 *    should feed into `<AgglomerateViewer cameraSource={...} />`:
 *      - synchronised = true   → all viewers share scope `compare/{sessionId}`
 *      - synchronised = false  → each viewer gets its own sub-scope
 *                                `compare/{sessionId}/{simId}`
 *    Because the viewer already reads/writes its scope through the global
 *    store, giving every cell the same scope key is what makes the orbit
 *    controls appear linked: when one cell's CameraTracker writes
 *    azimuth/elevation, every cell reading that scope re-renders with the
 *    new values.
 *
 * 3. Provide an optional debounced `publishCamera` channel for callers
 *    that want to push camera state changes manually (e.g. a future
 *    "recenter" button). The debouncer coalesces bursts to ~1 frame
 *    (16 ms) to avoid thrashing re-renders.
 *
 * 4. Expose `toggleSync()` to flip between synced and unsynced modes.
 *    Flipping to `false` immediately returns per-sim scope keys — any
 *    viewer that was sharing the session scope will, on its next frame,
 *    begin writing to its own sub-scope; no camera state from the shared
 *    scope bleeds into the per-sim scopes (they start at their existing
 *    per-sim values, or zero if never written).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react'

export interface CameraState {
  /** Spherical azimuth in degrees, 0..360. */
  azimuth: number
  /** Spherical elevation in degrees, -90..90. */
  elevation: number
  /** Orbital distance from target in viewer units. */
  distance: number
}

interface CompareCameraContextValue {
  /** True when all cells share a single camera scope. */
  synchronised: boolean
  /** Stable per-mount id (regenerated on remount). */
  sessionId: string
  /**
   * Return the `useViewerStore` scope key a given sim's viewer should use.
   * Callers pass this as `<AgglomerateViewer cameraSource={{ scope }} />`.
   */
  scopeFor: (simId: string) => string
  /** Current broadcast camera state (debounced). */
  cameraState: CameraState
  /** Push a (partial) camera-state update through the debounced channel. */
  publishCamera: (state: Partial<CameraState>) => void
  /** Flip synced / unsynced. */
  toggleSync: () => void
}

const CompareCameraContext = createContext<CompareCameraContextValue | null>(
  null,
)

/**
 * Consumer hook. Throws if called outside a `<CompareCameraProvider>` —
 * same ergonomic contract as any React context-bound hook.
 */
export function useCompareCamera(): CompareCameraContextValue {
  const ctx = useContext(CompareCameraContext)
  if (!ctx) {
    throw new Error(
      'useCompareCamera must be used inside a <CompareCameraProvider>',
    )
  }
  return ctx
}

const DEFAULT_CAMERA_STATE: CameraState = {
  azimuth: 0,
  elevation: 0,
  distance: 5,
}

interface Props {
  children: ReactNode
  initialSynchronised?: boolean
}

export function CompareCameraProvider({
  children,
  initialSynchronised = true,
}: Props) {
  // Stable session id for this mount. `useMemo` without dependencies is
  // the idiomatic "compute once per mount" for values that only need to
  // survive re-renders (StrictMode's double-invoke still shares the value
  // across the re-render because React preserves the memo cache between
  // the first commit and the second render in the same mount cycle).
  const sessionId = useMemo(
    () =>
      `compare-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    [],
  )

  const [synchronised, setSynchronised] = useState(initialSynchronised)
  const [cameraState, setCameraState] = useState<CameraState>(
    DEFAULT_CAMERA_STATE,
  )

  // Debounce the broadcast channel. We keep the timer in a ref so we
  // don't leak between renders, and we clear it on unmount.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const publishCamera = useCallback((partial: Partial<CameraState>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      setCameraState((prev) => ({ ...prev, ...partial }))
    }, 16)
  }, [])

  const scopeFor = useCallback(
    (simId: string) => {
      // When synced: every viewer reads/writes the same session-wide
      // scope → orbit controls appear linked.
      // When unsynced: each viewer owns its own sub-scope → independent
      // cameras.
      return synchronised
        ? `compare/${sessionId}`
        : `compare/${sessionId}/${simId}`
    },
    [synchronised, sessionId],
  )

  const toggleSync = useCallback(() => setSynchronised((s) => !s), [])

  // Cleanup debounce timer on unmount so unit tests and HMR don't leak.
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current)
    },
    [],
  )

  const value = useMemo<CompareCameraContextValue>(
    () => ({
      synchronised,
      sessionId,
      scopeFor,
      cameraState,
      publishCamera,
      toggleSync,
    }),
    [synchronised, sessionId, scopeFor, cameraState, publishCamera, toggleSync],
  )

  return (
    <CompareCameraContext.Provider value={value}>
      {children}
    </CompareCameraContext.Provider>
  )
}
