import { clsx, type ClassValue } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Format a date string as a relative time (e.g., "2 hours ago").
 */
export function formatDistanceToNow(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSeconds = Math.floor(diffMs / 1000)
  const diffMinutes = Math.floor(diffSeconds / 60)
  const diffHours = Math.floor(diffMinutes / 60)
  const diffDays = Math.floor(diffHours / 24)

  if (diffSeconds < 60) {
    return 'just now'
  } else if (diffMinutes < 60) {
    return `${diffMinutes} minute${diffMinutes === 1 ? '' : 's'} ago`
  } else if (diffHours < 24) {
    return `${diffHours} hour${diffHours === 1 ? '' : 's'} ago`
  } else if (diffDays < 30) {
    return `${diffDays} day${diffDays === 1 ? '' : 's'} ago`
  } else {
    return date.toLocaleDateString()
  }
}

/**
 * Format a number with appropriate precision.
 */
export function formatNumber(value: number, decimals = 2): string {
  if (Math.abs(value) < 0.001) {
    return value.toExponential(decimals)
  }
  return value.toFixed(decimals)
}

/**
 * Detect the system's decimal separator (. or ,)
 */
export function getDecimalSeparator(): string {
  const n = 1.1
  return n.toLocaleString().substring(1, 2)
}

/**
 * Get the appropriate CSV field separator based on locale.
 * If decimal separator is comma, use semicolon for CSV fields.
 */
export function getCsvSeparator(): string {
  return getDecimalSeparator() === ',' ? ';' : ','
}

export type DataExportFormat = 'csv' | 'tsv'

interface ExportDataOptions {
  filename: string
  headers: string[]
  rows: (string | number)[][]
  format: DataExportFormat
}

/**
 * Export tabular data as CSV or TSV file.
 * Automatically detects locale for proper decimal/field separators.
 */
export function exportData({ filename, headers, rows, format }: ExportDataOptions): void {
  const separator = format === 'tsv' ? '\t' : getCsvSeparator()
  const decimalSep = getDecimalSeparator()

  // Format numbers with locale-appropriate decimal separator
  const formatValue = (val: string | number): string => {
    if (typeof val === 'number') {
      // Use locale decimal separator
      const str = val.toString()
      return decimalSep === ',' ? str.replace('.', ',') : str
    }
    // Escape strings that contain separator or quotes
    if (typeof val === 'string' && (val.includes(separator) || val.includes('"'))) {
      return `"${val.replace(/"/g, '""')}"`
    }
    return String(val)
  }

  const lines = [
    headers.join(separator),
    ...rows.map(row => row.map(formatValue).join(separator))
  ]

  const content = lines.join('\n')
  const extension = format === 'tsv' ? 'tsv' : 'csv'
  const mimeType = format === 'tsv' ? 'text/tab-separated-values' : 'text/csv'

  // Add BOM for Excel compatibility with UTF-8
  const bom = '\uFEFF'
  const blob = new Blob([bom + content], { type: `${mimeType};charset=utf-8` })

  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${filename}.${extension}`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}
