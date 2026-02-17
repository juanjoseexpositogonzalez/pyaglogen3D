'use client'

import dynamic from 'next/dynamic'
import { useMemo } from 'react'
import type { PlotParams } from 'react-plotly.js'

const Plot = dynamic(() => import('react-plotly.js'), { ssr: false })

interface RgEvolutionChartProps {
  rgEvolution: number[]
  className?: string
}

export function RgEvolutionChart({ rgEvolution, className }: RgEvolutionChartProps) {
  const { xData, yData } = useMemo(() => {
    // Create N values from 1 to length of rgEvolution
    const n = rgEvolution.map((_, i) => i + 1)
    return {
      xData: n.map((v) => Math.log10(v)),
      yData: rgEvolution.map((v) => Math.log10(v)),
    }
  }, [rgEvolution])

  if (rgEvolution.length === 0) {
    return (
      <div className={className}>
        <p className="text-muted-foreground text-center py-8">
          No evolution data available
        </p>
      </div>
    )
  }

  const plotData: PlotParams['data'] = [
    {
      x: xData,
      y: yData,
      mode: 'lines+markers',
      type: 'scatter',
      name: 'Rg vs N',
      marker: {
        color: '#4488ff',
        size: 4,
      },
      line: {
        color: '#4488ff',
        width: 2,
      },
    },
  ]

  const layout: PlotParams['layout'] = {
    title: {
      text: 'Radius of Gyration Evolution',
      font: { size: 14, color: '#e2e8f0' },
    },
    xaxis: {
      title: { text: 'log10(N)', font: { color: '#e2e8f0' } },
      gridcolor: '#334155',
      zerolinecolor: '#475569',
      color: '#e2e8f0',
    },
    yaxis: {
      title: { text: 'log10(Rg)', font: { color: '#e2e8f0' } },
      gridcolor: '#334155',
      zerolinecolor: '#475569',
      color: '#e2e8f0',
    },
    paper_bgcolor: '#1e293b',
    plot_bgcolor: '#0f172a',
    font: { color: '#e2e8f0' },
    margin: { t: 50, r: 30, b: 50, l: 60 },
    showlegend: false,
  }

  return (
    <div className={className}>
      <Plot
        data={plotData}
        layout={layout}
        config={{ responsive: true, displayModeBar: false }}
        style={{ width: '100%', height: '300px' }}
      />
    </div>
  )
}
