/**
 * Shared registry of the single HTMLVideoElement per video timeline object.
 *
 * Written by `useAudioPlayback` (which creates, plays, and seeks the elements)
 * and read by `useCanvasRenderer` (which blits each element's current frame onto
 * the canvas). One element per object means the asset is decoded ONCE — the
 * playing element supplies both audio and the canvas image, instead of the old
 * split where a second muted element seek-stormed in parallel.
 */
const videoElements = new Map<string, HTMLVideoElement>()

export function registerVideoElement(objectId: string, el: HTMLVideoElement): void {
  videoElements.set(objectId, el)
}

export function unregisterVideoElement(objectId: string): void {
  videoElements.delete(objectId)
}

export function getVideoElement(objectId: string): HTMLVideoElement | undefined {
  return videoElements.get(objectId)
}

/**
 * "A video element just decoded a frame worth painting" bus.
 *
 * `useAudioPlayback` (parent) creates + registers the elements; `useCanvasRenderer`
 * (child) blits them. On the import commit the child's effects run BEFORE the parent
 * registers the element, so the canvas can't subscribe to the element directly — it
 * would miss the first-frame `loadeddata`. Instead the element fires here and the
 * canvas re-renders, no matter the effect ordering. Fixes: an imported video staying
 * blank until the next scrub / re-layout.
 */
const readyListeners = new Set<() => void>()

export function subscribeVideoReady(cb: () => void): () => void {
  readyListeners.add(cb)
  return () => readyListeners.delete(cb)
}

export function notifyVideoReady(): void {
  for (const cb of readyListeners) cb()
}
