import { useState, useCallback, useEffect, useRef } from "react";
import type { TimelineObject, AssetMeta } from "../types";
import { createTimelineObject } from "../types";
import {
  storeAsset,
  getMediaDuration,
  generateWaveform,
  getTotalAssetSize,
  SIZE_WARN_PER_FILE,
  SIZE_WARN_TOTAL,
} from "../lib/assetStore";

type ImportModalProps = {
  onImport: (objects: TimelineObject[]) => void;
  onClose: () => void;
  insertAtTime?: number;
  onAssetsAdded?: (assets: AssetMeta[]) => void;
};

type PendingAsset = {
  file: File;
  type: "image" | "audio" | "video";
  name: string;
  previewUrl?: string;
  duration?: number;
  sizeWarning?: string;
};

export default function ImportModal({
  onImport,
  onClose,
  insertAtTime = 0,
  onAssetsAdded,
}: ImportModalProps) {
  const [pending, setPending] = useState<PendingAsset[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [importing, setImporting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const addFiles = useCallback(async (files: File[]) => {
    const supported = files.filter(
      (f) =>
        f.type.startsWith("image/") ||
        f.type.startsWith("audio/") ||
        f.type.startsWith("video/")
    );
    if (supported.length === 0) return;

    const newPending: PendingAsset[] = [];
    for (const file of supported) {
      const type = file.type.startsWith("image/")
        ? "image"
        : file.type.startsWith("audio/")
          ? "audio"
          : "video";

      const asset: PendingAsset = {
        file,
        type,
        name: file.name,
      };

      // Size warning
      if (file.size > SIZE_WARN_PER_FILE) {
        asset.sizeWarning = `Large file (${(file.size / 1024 / 1024).toFixed(0)} MB)`;
      }

      // Preview URL for images and videos
      if (type === "image" || type === "video") {
        asset.previewUrl = URL.createObjectURL(file);
      }

      // Get duration for audio/video
      if (type === "audio" || type === "video") {
        try {
          asset.duration = await getMediaDuration(file);
        } catch {
          // duration unknown
        }
      }

      newPending.push(asset);
    }

    setPending((prev) => [...prev, ...newPending]);
  }, []);

  // Paste handler (images only)
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          e.preventDefault();
          const blob = item.getAsFile();
          if (blob) await addFiles([blob]);
        }
      }
    };
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
  }, [addFiles]);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      addFiles(Array.from(e.dataTransfer.files));
    },
    [addFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  }, []);

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (!e.target.files) return;
      addFiles(Array.from(e.target.files));
      e.target.value = "";
    },
    [addFiles]
  );

  const removeItem = useCallback((index: number) => {
    setPending((prev) => {
      const item = prev[index];
      if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      return prev.filter((_, i) => i !== index);
    });
  }, []);

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      pending.forEach((p) => {
        if (p.previewUrl) URL.revokeObjectURL(p.previewUrl);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleImport = useCallback(async () => {
    if (pending.length === 0 || importing) return;
    setImporting(true);

    // Check total size
    const newTotalSize =
      getTotalAssetSize() + pending.reduce((sum, p) => sum + p.file.size, 0);
    if (newTotalSize > SIZE_WARN_TOTAL) {
      const proceed = window.confirm(
        `Total asset size will exceed ${(SIZE_WARN_TOTAL / 1024 / 1024).toFixed(0)} MB. This may cause performance issues. Continue?`
      );
      if (!proceed) {
        setImporting(false);
        return;
      }
    }

    const newObjects: TimelineObject[] = [];
    const newAssets: AssetMeta[] = [];
    let timeOffset = 0;

    for (const item of pending) {
      const { meta } = await storeAsset(item.file);

      // Set duration on meta for audio/video
      if (item.duration != null) {
        meta.duration = item.duration;
      }

      newAssets.push(meta);
      const baseName = item.name.replace(/\.[^.]+$/, "");

      if (item.type === "image") {
        newObjects.push(
          createTimelineObject(
            "photo",
            { assetId: meta.id },
            {
              startTime: insertAtTime + timeOffset,
              duration: 5,
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              name: baseName,
            }
          )
        );
        timeOffset += 5;
      } else if (item.type === "audio") {
        const duration = item.duration ?? 5;
        let waveform: number[] | undefined;
        try {
          waveform = await generateWaveform(item.file);
        } catch {
          // waveform generation failed, continue without it
        }
        newObjects.push(
          createTimelineObject(
            "audio",
            {
              assetId: meta.id,
              volume: 1,
              originalDuration: duration,
              waveform,
            },
            {
              startTime: insertAtTime + timeOffset,
              duration,
              name: baseName,
            }
          )
        );
        timeOffset += duration;
      } else if (item.type === "video") {
        const duration = item.duration ?? 5;
        newObjects.push(
          createTimelineObject(
            "video",
            {
              assetId: meta.id,
              volume: 1,
              originalDuration: duration,
            },
            {
              startTime: insertAtTime + timeOffset,
              duration,
              x: 0,
              y: 0,
              width: 1,
              height: 1,
              name: baseName,
            }
          )
        );
        timeOffset += duration;
      }
    }

    onAssetsAdded?.(newAssets);
    onImport(newObjects);
    onClose();
  }, [pending, importing, insertAtTime, onImport, onClose, onAssetsAdded]);

  // Close on Escape
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [onClose]);

  const imageCount = pending.filter((p) => p.type === "image").length;
  const audioCount = pending.filter((p) => p.type === "audio").length;
  const videoCount = pending.filter((p) => p.type === "video").length;

  const summary = [
    imageCount > 0 ? `${imageCount} image${imageCount !== 1 ? "s" : ""}` : "",
    audioCount > 0 ? `${audioCount} audio` : "",
    videoCount > 0 ? `${videoCount} video` : "",
  ]
    .filter(Boolean)
    .join(", ");

  return (
    <div
      className="fixed inset-0 bg-black/70 flex items-center justify-center z-50"
      onClick={onClose}
    >
      <div
        className="bg-gray-800 rounded-lg shadow-xl w-[640px] max-w-[90vw] max-h-[85vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-bold text-white">Add Assets</h2>
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
                ? "border-indigo-400 bg-indigo-500/10"
                : "border-gray-600 hover:border-gray-500 hover:bg-gray-700/30"
            }`}
          >
            <p className="text-gray-300 text-sm font-medium mb-1">
              Drag & drop files here, or click to browse
            </p>
            <p className="text-gray-500 text-xs">
              Images (PNG, JPG, WebP) · Audio (MP3, WAV, OGG) · Video (MP4,
              WebM, MOV)
            </p>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept="image/*,audio/*,video/*"
            onChange={handleFileSelect}
            className="hidden"
          />
        </div>

        {/* Pending items */}
        {pending.length > 0 && (
          <div className="flex-1 overflow-y-auto px-4 pb-2">
            <p className="text-xs text-gray-400 mb-2">{summary} ready to import</p>
            <div className="space-y-1.5">
              {pending.map((item, i) => (
                <div
                  key={i}
                  className="flex items-center gap-3 bg-gray-900 rounded p-2 group"
                >
                  {/* Preview / icon */}
                  <div className="w-12 h-12 rounded bg-gray-800 flex items-center justify-center shrink-0 overflow-hidden">
                    {item.type === "image" && item.previewUrl ? (
                      <img
                        src={item.previewUrl}
                        alt={item.name}
                        className="w-full h-full object-cover"
                      />
                    ) : item.type === "video" && item.previewUrl ? (
                      <video
                        src={item.previewUrl}
                        className="w-full h-full object-cover"
                        muted
                      />
                    ) : item.type === "audio" ? (
                      <span className="text-lg">♪</span>
                    ) : (
                      <span className="text-lg">▶</span>
                    )}
                  </div>

                  {/* Info */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-white truncate">{item.name}</p>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span
                        className={`px-1.5 py-0.5 rounded text-[10px] font-medium uppercase ${
                          item.type === "image"
                            ? "bg-blue-900/50 text-blue-300"
                            : item.type === "audio"
                              ? "bg-teal-900/50 text-teal-300"
                              : "bg-violet-900/50 text-violet-300"
                        }`}
                      >
                        {item.type}
                      </span>
                      {item.duration != null && (
                        <span>{item.duration.toFixed(1)}s</span>
                      )}
                      <span>
                        {(item.file.size / 1024 / 1024).toFixed(1)} MB
                      </span>
                      {item.sizeWarning && (
                        <span className="text-amber-400">
                          {item.sizeWarning}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Remove */}
                  <button
                    onClick={() => removeItem(i)}
                    className="w-6 h-6 text-gray-500 hover:text-red-400 text-sm opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
                  >
                    x
                  </button>
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
            disabled={pending.length === 0 || importing}
            className="px-4 py-2 text-sm bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-medium rounded transition-colors cursor-pointer"
          >
            {importing
              ? "Importing..."
              : pending.length > 0
                ? `Import ${summary}`
                : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}
