/**
 * Scientific chart theme for Plotly.
 *
 * The product plots with `plotly.js`; the Base44 prototype used recharts, so
 * the design is portable but its chart code is not. Copying it would add a
 * second charting library and a second source of truth for the same ramp.
 *
 * The series ramp lives in `globals.css` as `--series-1` through `--series-6`.
 * This module reads it from the document and re-reads it when the active theme
 * changes, so charts repaint with the ramp in force. The literals below are the
 * documented exception to the no-colour-literal rule: they are the fallback for
 * environments without a DOM, such as a server render.
 *
 * Multi-series charts carry three cues at once — colour, dash pattern and
 * marker shape, all indexed by the same series position — so a plot stays
 * readable in greyscale, which is how it ends up in a paper.
 */

export type Theme = 'light' | 'dark'

/** SSR fallback only; the document is authoritative whenever one exists. */
const FALLBACK_SERIES = ['#1d858c', '#c25d1e', '#7046b0', '#6f8540', '#a8386b', '#3e6584']

const SERIES = FALLBACK_SERIES.slice()

/**
 * Dash patterns in Plotly's pixel-list syntax, ordered by series index.
 * Index 0 is solid: the reference series stays unbroken.
 */
const DASH = ['solid', '6px,3px', '2px,3px', '8px,3px,2px,3px', '12px,4px', '4px,2px']

/** Marker glyphs, ordered by series index. */
const MARKERS = ['circle', 'square', 'triangle-up', 'diamond', 'x', 'star']

function readCustomProperty(name: string): string {
  if (typeof document === 'undefined') return ''
  const styles = getComputedStyle(document.documentElement)
  return styles.getPropertyValue(name).trim()
}

/**
 * Re-read the ramp from the document. Exported so a theme change can force it
 * and so tests can drive it explicitly.
 */
export function readSeries(): string[] {
  for (let i = 0; i < SERIES.length; i++) {
    // Falling back explicitly, rather than keeping whatever was read last,
    // so the ramp never carries a stale value from a theme no longer active.
    SERIES[i] = readCustomProperty('--series-' + (i + 1)) || FALLBACK_SERIES[i]
  }
  return SERIES
}

/** Colour of series `i`, wrapping around the six-colour ramp. */
export function series(i: number): string {
  readSeries()
  return SERIES[((i % SERIES.length) + SERIES.length) % SERIES.length]
}

/** Dash pattern of series `i`. */
export function dash(i: number): string {
  return DASH[((i % DASH.length) + DASH.length) % DASH.length]
}

/** Marker glyph of series `i`. */
export function marker(i: number): string {
  return MARKERS[((i % MARKERS.length) + MARKERS.length) % MARKERS.length]
}

/**
 * Indices at which to draw a marker, so a dense series shows glyphs instead of
 * a smear. Keeps at most `max` markers however long the series is.
 */
export function markEvery(pointCount: number, max: number): number[] {
  const cap = max > 0 ? max : 1
  if (pointCount <= 0) return []
  const step = Math.max(1, Math.ceil(pointCount / cap))
  const out: number[] = []
  for (let i = 0; i < pointCount; i += step) out.push(i)
  return out
}

export interface TraceOptions {
  /**
   * Colour imposed by the caller. Some capabilities bind a series colour to an
   * entity — `multi-aggregate-comparison` ties each Rg curve to its
   * simulation's own colour, shared with that simulation's viewer border — and
   * that binding wins. Dash and marker still follow the series index.
   */
  color?: string
  /** Number of samples, used to thin the markers. */
  pointCount?: number
  /** A lone series needs no cues to tell it apart: solid, no markers. */
  soleSeries?: boolean
  name?: string
  maxMarkers?: number
}

export interface TraceStyle {
  line: { color: string; dash: string; width: number }
  marker: { symbol: string; size: number; color: string }
  mode: string
  showlegend: boolean
  name?: string
}

/** Style one trace with the three cues, honouring any caller-bound colour. */
export function traceStyle(index: number, options?: TraceOptions): TraceStyle {
  const opts = options || {}
  const colour = opts.color || series(index)

  if (opts.soleSeries) {
    return {
      line: { color: colour, dash: 'solid', width: 1.8 },
      marker: { symbol: marker(0), size: 0, color: colour },
      mode: 'lines',
      showlegend: false,
      name: opts.name,
    }
  }

  return {
    line: { color: colour, dash: dash(index), width: 1.8 },
    marker: { symbol: marker(index), size: 7, color: colour },
    mode: 'lines+markers',
    showlegend: true,
    name: opts.name,
  }
}

export interface AxisTitle {
  /** Quantity, without its unit. */
  quantity: string
  /** Unit, rendered separately so it never fuses with the numbers. */
  unit?: string
}

export function axisTitle(title: AxisTitle): string {
  return title.unit ? title.quantity + ' (' + title.unit + ')' : title.quantity
}

/** Shared layout: grid, axes, typography and hover styling, from the tokens. */
export function layout(overrides?: Record<string, unknown>): Record<string, unknown> {
  // No literal fallbacks here. `react-plotly.js` is loaded dynamically with
  // `ssr: false` throughout this codebase, so a layout is only ever built with
  // a document present. An empty value simply leaves Plotly on its default,
  // which is better than hard-coding a colour the design system does not own.
  const grid = readCustomProperty('--visual-grid')
  const ink = readCustomProperty('--ink')
  const inkMuted = readCustomProperty('--ink-muted')
  const surface = readCustomProperty('--surface-strong')
  const line = readCustomProperty('--line-strong')

  const axis = {
    gridcolor: grid,
    zerolinecolor: grid,
    linecolor: grid,
    tickfont: { size: 10, color: inkMuted, family: 'Inter, sans-serif' },
    titlefont: { size: 11, color: inkMuted, family: 'Inter, sans-serif' },
    automargin: true,
  }

  const base: Record<string, unknown> = {
    paper_bgcolor: 'transparent',
    plot_bgcolor: 'transparent',
    font: { family: 'Inter, sans-serif', color: ink, size: 12 },
    margin: { t: 16, r: 16, b: 44, l: 56 },
    xaxis: axis,
    yaxis: axis,
    hoverlabel: {
      bgcolor: surface,
      bordercolor: line,
      font: { family: 'Inter, sans-serif', size: 11, color: ink },
    },
    legend: { font: { size: 11, color: inkMuted }, bgcolor: 'transparent' },
  }

  if (overrides) {
    const keys = Object.keys(overrides)
    for (let i = 0; i < keys.length; i++) base[keys[i]] = overrides[keys[i]]
  }
  return base
}

/**
 * Keep the ramp in step with the active theme. Charts repaint with the dark
 * values without a reload.
 */
function watchTheme(): void {
  if (typeof document === 'undefined' || typeof MutationObserver === 'undefined') return
  const observer = new MutationObserver(function () {
    readSeries()
  })
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-theme', 'class'],
  })
}

readSeries()
watchTheme()
