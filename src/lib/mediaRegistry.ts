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
