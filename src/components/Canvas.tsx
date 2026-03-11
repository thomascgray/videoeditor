import { useRef, useEffect } from 'react'
import type { TimelineObject } from '../types'
import { useCanvasRenderer } from '../hooks/useCanvasRenderer'

type CanvasProps = {
  objects: TimelineObject[]
  globalTime: number
  width: number
  height: number
}

export default function Canvas({ objects, globalTime, width, height }: CanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useCanvasRenderer(canvasRef, objects, globalTime)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    canvas.width = width
    canvas.height = height
  }, [width, height])

  return (
    <div className="flex-1 flex items-center justify-center bg-gray-950 p-4 overflow-hidden">
      <canvas
        ref={canvasRef}
        className="max-w-full max-h-full rounded shadow-lg"
        style={{ aspectRatio: `${width}/${height}` }}
      />
    </div>
  )
}
