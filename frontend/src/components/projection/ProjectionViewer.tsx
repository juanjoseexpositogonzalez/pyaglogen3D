'use client'

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Download, ImageOff } from 'lucide-react'

interface ProjectionViewerProps {
  imageUrl: string | null
  azimuth: number
  elevation: number
  format: 'png' | 'svg'
  onDownload?: () => void
}

export function ProjectionViewer({
  imageUrl,
  azimuth,
  elevation,
  format,
  onDownload,
}: ProjectionViewerProps) {
  const handleDownload = () => {
    if (!imageUrl) return

    const link = document.createElement('a')
    link.href = imageUrl
    link.download = `projection_Az${azimuth.toFixed(0).padStart(3, '0')}_El${elevation.toFixed(0).padStart(3, '0')}.${format}`
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)

    onDownload?.()
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-lg">
          Preview (Az: {azimuth}°, El: {elevation}°)
        </CardTitle>
        {imageUrl && (
          <Button variant="outline" size="sm" onClick={handleDownload}>
            <Download className="h-4 w-4 mr-1" />
            Save
          </Button>
        )}
      </CardHeader>
      <CardContent>
        {imageUrl ? (
          <div className="flex items-center justify-center bg-muted rounded-lg p-2">
            <img
              src={imageUrl}
              alt={`2D Projection at Az=${azimuth}°, El=${elevation}°`}
              className="max-w-full max-h-[500px] object-contain"
            />
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center h-[300px] bg-muted rounded-lg">
            <ImageOff className="h-12 w-12 text-muted-foreground mb-2" />
            <p className="text-muted-foreground text-sm">
              Generate a preview to see the 2D projection
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
