import { useState } from "react";
import type { JobPart, JobPhoto } from "@partspilot/shared";

/** Each photo with a box and label on every detected part. */
export function PhotoOverlay({ photos, parts, highlight, onHover }: { photos: JobPhoto[]; parts: JobPart[]; highlight: string | null; onHover: (id: string | null) => void }) {
  const [index, setIndex] = useState(0);
  if (!photos.length) return <div className="photo-empty">Photos are deleted after 30 days.</div>;
  const photo = photos[Math.min(index, photos.length - 1)]!;
  const boxes = parts.filter((p) => p.image_index === photo.index && p.bbox && p.status !== "removed");
  return (
    <div className="photo-block">
      <div className="photo-frame" style={{ aspectRatio: `${photo.width} / ${photo.height}` }}>
        <img src={photo.url} alt={`Photo ${photo.index + 1} of your parts`} />
        {boxes.map((p) => (
          <div
            key={p.id}
            className={`bbox bbox-${p.duplicate ? "duplicate" : p.status}${highlight === p.id ? " active" : ""}`}
            style={{ left: `${p.bbox!.x * 100}%`, top: `${p.bbox!.y * 100}%`, width: `${p.bbox!.w * 100}%`, height: `${p.bbox!.h * 100}%` }}
            onMouseEnter={() => onHover(p.id)}
            onMouseLeave={() => onHover(null)}
          >
            <span className="bbox-label">{p.name ?? p.label}</span>
          </div>
        ))}
      </div>
      {photos.length > 1 && (
        <div className="photo-tabs" role="tablist">
          {photos.map((ph, i) => (
            <button key={ph.index} role="tab" aria-selected={i === index} type="button" onClick={() => setIndex(i)}>
              Photo {i + 1}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
