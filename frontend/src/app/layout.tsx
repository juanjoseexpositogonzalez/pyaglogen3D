import type { Metadata } from 'next'
import { Inter } from 'next/font/google'
import './globals.css'
import { Providers } from './providers'

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
    <html lang="en" className="dark">
      <body className={`${inter.className} app-background`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
