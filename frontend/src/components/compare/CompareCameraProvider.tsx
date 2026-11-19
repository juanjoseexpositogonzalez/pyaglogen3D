'use client'

import { useCameraStore } from '@/stores/viewerStore'

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
  azimuth: number
  elevation: number
  distance: number
  target: [number, number, number]
  zoom: number
}

interface CompareCameraContextValue {
  synchronised: boolean
  sessionId: string
  /** Every viewer owns an isolated volatile scope, even while synchronized. */
  scopeFor: (simId: string) => string
  /** Latest pose published by the accepted writer. */
  cameraState: CameraState | null
  /** Cell currently being manipulated; null means no cell may write. */
  activeWriterId: string | null
  beginCameraWrite: (simId: string) => void
  endCameraWrite: (simId: string) => void
  /** Publish only when the source owns the channel, or flush its final pose. */
  publishCamera: (simId: string, state: CameraState) => void
  toggleSync: () => void
}

const CompareCameraContext = createContext<CompareCameraContextValue | null>(
  null,
)

export function useCompareCamera(): CompareCameraContextValue {
  const context = useContext(CompareCameraContext)
  if (!context) {
    throw new Error(
      'useCompareCamera must be used inside a <CompareCameraProvider>',
    )
  }
  return context
}

interface Props {
  children: ReactNode
  initialSynchronised?: boolean
}

export function CompareCameraProvider({
  children,
  initialSynchronised = true,
}: Props) {
  const sessionId = useMemo(
    () =>
      `compare-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`,
    [],
  )
  const [synchronised, setSynchronised] = useState(initialSynchronised)
  const [cameraState, setCameraState] = useState<CameraState | null>(null)
  const [activeWriterId, setActiveWriterId] = useState<string | null>(null)
  const activeWriterRef = useRef<string | null>(null)
  const publishTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingCameraRef = useRef<{
    simId: string
    state: CameraState
  } | null>(null)

  const scopeFor = useCallback(
    (simId: string) => `compare/${sessionId}/${simId}`,
    [sessionId],
  )

  const beginCameraWrite = useCallback((simId: string) => {
    activeWriterRef.current = simId
    setActiveWriterId(simId)
  }, [])

  const endCameraWrite = useCallback((simId: string) => {
    if (activeWriterRef.current === simId) activeWriterRef.current = null
    setActiveWriterId((current) => (current === simId ? null : current))
  }, [])

  const publishCamera = useCallback(
    (simId: string, nextCamera: CameraState) => {
      const activeWriter = activeWriterRef.current
      if (activeWriter !== null && activeWriter !== simId) return
      pendingCameraRef.current = { simId, state: nextCamera }
      if (publishTimerRef.current !== null) return

      publishTimerRef.current = setTimeout(() => {
        const pendingCamera = pendingCameraRef.current
        pendingCameraRef.current = null
        publishTimerRef.current = null
        if (
          pendingCamera &&
          (activeWriterRef.current === null ||
            activeWriterRef.current === pendingCamera.simId)
        ) {
          setCameraState(pendingCamera.state)
        }
      }, 16)
    },
    [],
  )

  const toggleSync = useCallback(() => {
    setSynchronised((current) => !current)
    activeWriterRef.current = null
    setActiveWriterId(null)
  }, [])

  useEffect(
    () => () => {
      if (publishTimerRef.current !== null) {
        clearTimeout(publishTimerRef.current)
      }
      pendingCameraRef.current = null
      useCameraStore.getState().clearCameraScopes(`compare/${sessionId}`)
    },
    [sessionId],
  )

  const value = useMemo<CompareCameraContextValue>(
    () => ({
      synchronised,
      sessionId,
      scopeFor,
      cameraState,
      activeWriterId,
      beginCameraWrite,
      endCameraWrite,
      publishCamera,
      toggleSync,
    }),
    [
      synchronised,
      sessionId,
      scopeFor,
      cameraState,
      activeWriterId,
      beginCameraWrite,
      endCameraWrite,
      publishCamera,
      toggleSync,
    ],
  )

  return (
    <CompareCameraContext.Provider value={value}>
      {children}
    </CompareCameraContext.Provider>
  )
}
