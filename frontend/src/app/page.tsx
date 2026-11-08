'use client'

import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'
import { useAuth } from '@/contexts/AuthContext'

const API_BASE = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000/api/v1'

export default function Home() {
  const { isAuthenticated, isLoading } = useAuth()

  // Padding and heading scale with the viewport: `p-24` alone left 128px of
  // usable width at 320px, which the 5xl wordmark overflowed on its own.
  // 320px is a supported width.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-6 sm:p-12 lg:p-24">
      <div className="w-full max-w-4xl text-center">
        <h1 className="mb-4 text-3xl font-bold sm:text-4xl md:text-5xl">pyAgloGen3D</h1>
        <p className="mb-8 text-base text-ink-muted sm:text-lg md:text-xl">
          3D Agglomerate Simulation and Fractal Analysis Platform
        </p>

        <div className="flex gap-4 justify-center flex-wrap">
          {!isLoading && (
            isAuthenticated ? (
              <Link
                href="/dashboard"
                className={buttonVariants({ size: 'lg' })}
              >
                Go to Dashboard
              </Link>
            ) : (
              <>
                <Link
                  href="/auth/login"
                  className={buttonVariants({ size: 'lg' })}
                >
                  Sign In
                </Link>
                <Link
                  href="/auth/register"
                  className={buttonVariants({ variant: 'outline', size: 'lg' })}
                >
                  Create Account
                </Link>
              </>
            )
          )}
          <a
            href={`${API_BASE}/`}
            target="_blank"
            rel="noopener noreferrer"
            className={buttonVariants({ variant: 'outline', size: 'lg' })}
          >
            API Docs
          </a>
        </div>

        <div className="mt-12 grid max-w-4xl grid-cols-1 gap-6 sm:mt-16 sm:gap-8 md:grid-cols-3">
          <FeatureCard
            title="3D Simulation"
            description="DLA, CCA, Ballistic aggregation with real-time visualization"
          />
          <FeatureCard
            title="Fractal Analysis"
            description="Box-counting, Sandbox, Multifractal methods for 2D images"
          />
          <FeatureCard
            title="Full Reproducibility"
            description="All parameters and results persisted for scientific research"
          />
        </div>
      </div>
    </main>
  )
}

function FeatureCard({
  title,
  description,
}: {
  title: string
  description: string
}) {
  return (
    <div className="bg-surface-soft rounded-lg p-6 text-left">
      <h3 className="text-lg font-semibold mb-2">{title}</h3>
      <p className="text-sm text-ink-muted">{description}</p>
    </div>
  )
}
