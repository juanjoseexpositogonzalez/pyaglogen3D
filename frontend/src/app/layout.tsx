import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'
import { THEME_BOOTSTRAP_SCRIPT } from '@/lib/theme'

const inter = Inter({ subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'pyAgloGen3D',
  description: '3D Agglomerate Simulation and Fractal Analysis Platform',
}

export default function RootLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/*
          Resolves the theme before the first paint. Without it the page
          renders light and then flips, which is worse than either theme.
          `suppressHydrationWarning` on <html> because this script writes an
          attribute the server render cannot know about.
        */}
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP_SCRIPT }} />
      </head>
      <body className={inter.className}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
