'use client'

import { useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Label } from '@/components/ui/label'
import { formatNumber } from '@/lib/utils'
import { Info, TrendingUp } from 'lucide-react'

interface LimitingCasesCardProps {
  /** Number of primary particles in the simulation */
  npo: number
  /** Actual Df from simulation/regression */
  actualDf?: number
  /** Actual kf from simulation/regression */
  actualKf?: number
  /** Callback when visibility changes */
  onVisibilityChange?: (visible: boolean) => void
}

export interface LimitingCase {
  name: string
  df: number
  description: string
  /** Calculate kf for given N */
  kfFormula: (n: number) => number
  /** Calculate Rg/rp for given N (exact formula) */
  rgRpFormula: (n: number) => number
  kfAsymptotic: string
  color: string
}

/**
 * Lapuerta constant: intrinsic Rg²/rp² for a single sphere.
 * This accounts for the mass distribution within each primary particle.
 */
const LAPUERTA = 3 / 5 // = 0.6

/**
 * Get Rg²/rp² for a linear chain of N touching spheres.
 * Formula: (N² - 1)/3 + 3/5
 * Derivation: centers at 0, 2rp, 4rp, ..., 2(N-1)rp
 */
function chainRgSquared(n: number): number {
  if (n <= 0) return LAPUERTA
  return (n * n - 1) / 3 + LAPUERTA
}

/**
 * Get Rg²/rp² for a hexagonal plane with N particles.
 * For complete hexagonal rings: N = 1, 7, 19, 37, 61, ...
 * Formula: (5N² - 4N - 1)/(9N) + 3/5
 */
function planeRgSquared(n: number): number {
  if (n <= 0) return LAPUERTA
  if (n === 1) return LAPUERTA
  return (5 * n * n - 4 * n - 1) / (9 * n) + LAPUERTA
}

/**
 * Get Rg²/rp² for a compact 3D sphere.
 * Uses empirical approximation for HCP packing.
 * For small N, uses exact calculations for specific configurations.
 */
function sphereRgSquared(n: number): number {
  if (n <= 0) return LAPUERTA
  if (n === 1) return LAPUERTA
  // For tetrahedron (N=4): Rg² = edge²/4 + 3/5 where edge = 2rp
  if (n === 4) return 1 + LAPUERTA  // = 1.6
  // For larger N, approximate using Df=3, kf≈1 relationship
  // N = kf × (Rg/rp)^3 → (Rg/rp)² = (N/kf)^(2/3)
  // With kf ≈ 1: (Rg/rp)² ≈ N^(2/3) but need to add Lapuerta
  // Empirical: Rg²/rp² ≈ 0.6 × N^(2/3) + 0.6
  return 0.6 * Math.pow(n, 2/3) + LAPUERTA
}

export const LIMITING_CASES: LimitingCase[] = [
  {
    name: 'Linear Chain',
    df: 1,
    description: 'Particles in a straight line',
    kfFormula: (n: number) => {
      if (n <= 1) return 1
      // kf = N / (Rg/rp)^Df = N / sqrt(Rg²/rp²)
      return n / Math.sqrt(chainRgSquared(n))
    },
    rgRpFormula: (n: number) => Math.sqrt(chainRgSquared(n)),
    kfAsymptotic: '√3 ≈ 1.732',
    color: '#ef4444', // red
  },
  {
    name: 'Hexagonal Plane',
    df: 2,
    description: 'Single-layer hexagonal close-packing',
    kfFormula: (n: number) => {
      if (n <= 1) return 1
      // kf = N / (Rg/rp)^Df = N / (Rg²/rp²)
      return n / planeRgSquared(n)
    },
    rgRpFormula: (n: number) => Math.sqrt(planeRgSquared(n)),
    kfAsymptotic: '9/5 = 1.8',
    color: '#22c55e', // green
  },
  {
    name: 'Compact Sphere',
    df: 3,
    description: 'Dense 3D hexagonal close-packing',
    kfFormula: (n: number) => {
      if (n <= 1) return 1
      // kf = N / (Rg/rp)^Df = N / (Rg²/rp²)^(3/2)
      const rgRpSq = sphereRgSquared(n)
      return n / Math.pow(rgRpSq, 1.5)
    },
    rgRpFormula: (n: number) => Math.sqrt(sphereRgSquared(n)),
    kfAsymptotic: '~1.0',
    color: '#3b82f6', // blue
  },
]

/**
 * Generate reference data points for limiting cases.
 * Returns (Rg/rp, N) pairs for N = 1, 2, 3, ... up to maxN.
 */
export function getLimitingCasePoints(maxN: number = 10): {
  chain: { rgRp: number; n: number }[]
  plane: { rgRp: number; n: number }[]
  sphere: { rgRp: number; n: number }[]
} {
  const nValues = Array.from({ length: maxN }, (_, i) => i + 1)

  return {
    chain: nValues.map(n => ({
      rgRp: LIMITING_CASES[0].rgRpFormula(n),
      n,
    })),
    plane: nValues.map(n => ({
      rgRp: LIMITING_CASES[1].rgRpFormula(n),
      n,
    })),
    sphere: nValues.map(n => ({
      rgRp: LIMITING_CASES[2].rgRpFormula(n),
      n,
    })),
  }
}

export function LimitingCasesCard({
  npo,
  actualDf,
  actualKf,
  onVisibilityChange,
}: LimitingCasesCardProps) {
  const [showOverlay, setShowOverlay] = useState(false)

  const limitingValues = useMemo(() => {
    return LIMITING_CASES.map((lc) => ({
      ...lc,
      kf: lc.kfFormula(npo),
    }))
  }, [npo])

  // Find closest limiting case to actual Df
  const closestCase = useMemo(() => {
    if (actualDf === undefined) return null
    let closest = limitingValues[0]
    let minDiff = Math.abs(actualDf - closest.df)
    for (const lc of limitingValues) {
      const diff = Math.abs(actualDf - lc.df)
      if (diff < minDiff) {
        minDiff = diff
        closest = lc
      }
    }
    return closest
  }, [actualDf, limitingValues])

  const handleVisibilityChange = (checked: boolean) => {
    setShowOverlay(checked)
    onVisibilityChange?.(checked)
  }

  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-lg flex items-center gap-2">
          <TrendingUp className="h-5 w-5" />
          Limiting Cases (N = {npo})
        </CardTitle>
        <CardDescription>
          Theoretical prefactors for canonical geometries at this particle count
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Limiting case values */}
        <div className="grid grid-cols-3 gap-3">
          {limitingValues.map((lc) => (
            <div
              key={lc.df}
              className="bg-muted/50 rounded-lg p-3 space-y-1"
              style={{ borderLeft: `3px solid ${lc.color}` }}
            >
              <p className="text-xs text-muted-foreground">
                D<sub>f</sub> = {lc.df}
              </p>
              <p className="text-lg font-bold font-mono">
                k<sub>f</sub> = {formatNumber(lc.kf, 3)}
              </p>
              <p className="text-xs text-muted-foreground">{lc.name}</p>
            </div>
          ))}
        </div>

        {/* Comparison with actual values */}
        {actualDf !== undefined && actualKf !== undefined && (
          <div className="bg-primary/5 border border-primary/20 rounded-lg p-3 space-y-2">
            <p className="text-sm font-medium">Your Simulation</p>
            <div className="flex gap-6">
              <div>
                <p className="text-xs text-muted-foreground">D<sub>f</sub></p>
                <p className="text-xl font-bold font-mono">{formatNumber(actualDf, 2)}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">k<sub>f</sub></p>
                <p className="text-xl font-bold font-mono">{formatNumber(actualKf, 2)}</p>
              </div>
              {closestCase && (
                <div className="ml-auto text-right">
                  <p className="text-xs text-muted-foreground">Closest to</p>
                  <p className="text-sm font-medium" style={{ color: closestCase.color }}>
                    {closestCase.name}
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Overlay toggle */}
        <div className="flex items-center space-x-2 pt-2 border-t">
          <Checkbox
            id="overlay-toggle"
            checked={showOverlay}
            onCheckedChange={(checked) => handleVisibilityChange(checked === true)}
          />
          <Label htmlFor="overlay-toggle" className="text-sm cursor-pointer">
            Show limiting case lines on fractal plot
          </Label>
        </div>

        {/* Info */}
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <Info className="h-4 w-4 mt-0.5 flex-shrink-0" />
          <div>
            <p>
              These represent idealized geometries. Real agglomerates typically have
              D<sub>f</sub> between 1.7-2.5 depending on formation mechanism.
            </p>
            <p className="mt-1">
              Asymptotic limits (N→∞): Chain → {LIMITING_CASES[0].kfAsymptotic},
              Plane → {LIMITING_CASES[1].kfAsymptotic},
              Sphere → {LIMITING_CASES[2].kfAsymptotic}
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}
