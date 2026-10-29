'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { useState } from 'react'

import { AuthProvider } from '@/contexts/AuthContext'
import { useThemeSync } from '@/stores/useThemeStore'

/**
 * Keeps the theme store in step with the attribute the inline bootstrap
 * script already wrote, and with later changes to the system preference.
 */
function ThemeSync({ children }: { children: React.ReactNode }) {
  useThemeSync()
  return <>{children}</>
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 60 * 1000,
          },
        },
      })
  )

  return (
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <ThemeSync>{children}</ThemeSync>
      </AuthProvider>
    </QueryClientProvider>
  )
}
