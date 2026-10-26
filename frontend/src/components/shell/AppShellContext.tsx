'use client'

import { createContext, useContext } from 'react'

/**
 * Tells a component whether the application shell is already mounted.
 *
 * It exists for one transitional reason: eighteen files still import the
 * legacy `Header`, and migrating them all in this wave would mean editing
 * pages that belong to later waves, some of them next to files another change
 * has reserved. Instead the shell mounts once in the root layout and `Header`
 * renders nothing when it sees this context, so no route shows two
 * navigations and no page changes an import.
 *
 * The wave that deletes `Header` deletes this too.
 */
const AppShellContext = createContext(false)

export function AppShellProvider({
  value,
  children,
}: {
  /**
   * Whether the shell is actually showing its chrome. Always mounting the
   * provider keeps the tree shape stable, but the value must follow the
   * chrome: a signed-out visitor sees no shell, so `Header` has to keep
   * rendering its own sign-in and register links instead of yielding.
   */
  value: boolean
  children: React.ReactNode
}) {
  return <AppShellContext.Provider value={value}>{children}</AppShellContext.Provider>
}

/** True when rendered inside the application shell. */
export function useIsInsideAppShell(): boolean {
  return useContext(AppShellContext)
}
