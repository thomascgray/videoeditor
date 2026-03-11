import { useState, useCallback, useEffect, useRef } from 'react'
import type { TimelineObject, ProjectAction } from '../types'
import { createTimelineObject } from '../types'

type ImportModalProps = {
  dispatch: React.Dispatch<ProjectAction>
  onClose: () => void
  /** Where on the timeline to place imported photos */
  insertAtTime?: number
  /** Which lane to place them on (auto-assigns if not provided) */
  insertAtLane?: number
}

export default function ImportModal({ dispatch, onClose, insertAtTime = 0, insertAtLane = 0 }: ImportModalProps) {
  const [previews, setPreviews] = useState<{ src: string; name: string }[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)

  const addImages = useCallback(async (files: File[]) => {
    const imageFiles = files.filter((f) => f.type.startsWith('image/'))
    if (imageFiles.length === 0) return

    const newPreviews: { src: string; name: string }[] = []
    for (const file of imageFiles) {
      const src = await fileToBase64(file)
      newPreviews.push({ src, name: file.name })
    }
    setPreviews((prev) => [...prev, ...newPreviews])
  }, [])

  const addImageFromBlob = useCallback(async (blob: Blob, name: string) => {
    const src = await blobToBase64(blob)
    setPreviews((prev) => [...prev, { src, name }])
  }, [])

  // Paste handler — active while modal is open
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of Array.from(items)) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const blob = item.getAsFile()
          if (blob) {
            await addImageFromBlob(blob, `pasted-${Date.now()}.png`)
          }
        }
      }
    }

    window.addEventListener('paste', handlePaste)
    return () => window.removeEventListener('paste', handlePaste)
  }, [addImageFromBlob])

  // Drop handler
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault()
      setIsDragging(false)
      const files = Array.from(e.dataTransfer.files)
      addImages(files)
    },
    [addImages],
  )

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(true)
  }, [])

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
  }, [])

  // File picker
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return
      addImages(Array.from(e.target.files))
      e.target.value = ''
    },
    [addImages],
  )

  const removePreview = useCallback((index: number) => {
    setPreviews((prev) => prev.filter((_, i) => i !== index))
  }, [])

  const handleImport = useCallback(() => {
    if (previews.length === 0) return
    const newObjects: TimelineObject[] = previews.map((p, i) =>
      createTimelineObject('photo', { src: p.src }, {
        startTime: insertAtTime + i * 5,
        duration: 5,
        lane: insertAtLane,
        x: 0,
        y: 0,
        width: 1,
        height: 1,
        name: p.name.replace(/\.[^.]+$/, ''),
      }),
    )
    dispatch({ type: 'ADD_OBJECTS', objects: newObjects })
    onClose()
  }, [previews, dispatch, onClose, insertAtTime, insertAtLane])

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={onClose}>
      <div
        className="bg-gray-800 rounded-lg shadow-xl w-[640px] max-w-[90vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Add Photos</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white text-xl leading-none cursor-pointer"
          >
            x
          </button>
        </div>

        {/* Drop zone */}
        <div className="p-4">
          <div
            onDrop={handleDrop}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onClick={() => fileInputRef.current?.click()}
            className={`border-2 border-dashed rounded-lg p-8 text-center cursor-pointer transition-colors ${
              isDragging
                ? 'border-indigo-400 bg-indigo-500/10'
                : 'border-gray-600 hover:border-gray-500 hover:bg-gray-700/30'
            }`}
          >
            <p className="text-gray-300 text-sm font-medium mb-1">
              Drag & drop images here, click to browse, or paste from clipboard
            </p>
            <p className="text-gray-500 text-xs">
              Supports PNG, JPG, WebP, and other image formats
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Previews */}
        {previews.length > 0 && (
          <div className="flex-1 overflow-y-auto px-4 pb-2">
            <p className="text-xs text-gray-400 mb-2">{previews.length} image{previews.length !== 1 ? 's' : ''} ready to import</p>
            <div className="grid grid-cols-3 gap-2">
              {previews.map((preview, i) => (
                <div key={i} className="relative group rounded overflow-hidden bg-gray-900">
                  <img
                    src={preview.src}
                    alt={preview.name}
                    className="w-full aspect-video object-cover"
                  />
                  <button
                    onClick={() => removePreview(i)}
                    className="absolute top-1 right-1 w-5 h-5 bg-black/70 hover:bg-red-600 text-white text-xs rounded-full opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer flex items-center justify-center"
                  >
                    x
                  </button>
                  <p className="text-[10px] text-gray-500 truncate px-1 py-0.5">{preview.name}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 p-4 border-t border-gray-700">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 text-white rounded transition-colors cursor-pointer"
          >
            Cancel
          </button>
          <button
            onClick={handleImport}
            disabled={previews.length === 0}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded transition-colors cursor-pointer"
          >
            Import {previews.length > 0 ? `${previews.length} Photo${previews.length !== 1 ? 's' : ''}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

function blobToBase64(blob: Blob): Promise<string> {
  return fileToBase64(blob as File)
}
