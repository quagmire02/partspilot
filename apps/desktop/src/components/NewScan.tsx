import { useRef, useState, type DragEvent } from "react";
import { ApiRequestError, buildCreateJobForm, ERROR_USER_TEXT, LIMITS, type ErrorCode } from "@partspilot/shared";
import { api } from "../auth";

const MAX_EDGE = 2048;

/** Re-encodes to JPEG (drops EXIF/location, applies orientation, caps size). */
async function toJpeg(file: File): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode"))), "image/jpeg", 0.9));
}

type Photo = { blob: Blob; url: string };

/** Upload from this computer (self-hosted mode): photos + goal → a new scan in the Inbox. */
export function NewScan({ onCreated, onCancel }: { onCreated: (jobId: string) => void; onCancel: () => void }) {
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [goal, setGoal] = useState("");
  const [busy, setBusy] = useState(false);
  const [drag, setDrag] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const add = async (files: File[]) => {
    setError(null);
    const room = LIMITS.MAX_PHOTOS - photos.length;
    if (files.length > room) setError(`Up to ${LIMITS.MAX_PHOTOS} photos per scan.`);
    const added: Photo[] = [];
    for (const f of files.slice(0, room)) {
      try {
        const blob = await toJpeg(f);
        added.push({ blob, url: URL.createObjectURL(blob) });
      } catch {
        setError(`Couldn't read ${f.name}. Use a JPEG, PNG or WebP photo.`);
      }
    }
    setPhotos((p) => [...p, ...added]);
  };
  const remove = (i: number) =>
    setPhotos((p) => {
      URL.revokeObjectURL(p[i]!.url);
      return p.filter((_, j) => j !== i);
    });
  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    void add(Array.from(e.dataTransfer.files));
  };

  const send = async () => {
    setBusy(true);
    setError(null);
    try {
      const form = buildCreateJobForm({ clientRequestId: crypto.randomUUID(), goal: goal.trim(), photos: photos.map((p) => p.blob), turnstileToken: "local" });
      const res = await api.createJob(form);
      photos.forEach((p) => URL.revokeObjectURL(p.url));
      onCreated(res.job_id);
    } catch (e) {
      const code = e instanceof ApiRequestError ? e.code : "internal";
      setError(ERROR_USER_TEXT[code as ErrorCode] ?? "Couldn't send. Is PartsPilot still running?");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="detail new-scan">
      <h2>New scan</h2>
      <p className="muted">Lay your parts out on a table with some space between them. Add up to {LIMITS.MAX_PHOTOS} photos; close-ups help read part numbers.</p>
      <div
        className={`dropzone${drag ? " over" : ""}`}
        role="button"
        tabIndex={0}
        aria-label="Add photos"
        onClick={() => input.current?.click()}
        onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && input.current?.click()}
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
      >
        {photos.length === 0 && <span>Drop photos here, or click to choose</span>}
        {photos.map((p, i) => (
          <span key={p.url} className="scan-thumb">
            <img src={p.url} alt={`Photo ${i + 1}`} />
            <button
              type="button"
              aria-label={`Remove photo ${i + 1}`}
              onClick={(e) => {
                e.stopPropagation();
                remove(i);
              }}
            >
              ×
            </button>
          </span>
        ))}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        multiple
        hidden
        data-testid="scan-files"
        onChange={(e) => {
          void add(Array.from(e.target.files ?? []));
          e.target.value = "";
        }}
      />
      <label className="goal">
        What do you want to build?
        <textarea
          rows={3}
          value={goal}
          maxLength={LIMITS.MAX_GOAL_CHARS}
          placeholder="e.g. Can I build an RC car?  Leave empty to get 3 project ideas."
          onChange={(e) => setGoal(e.target.value)}
        />
      </label>
      {error && <p className="notice error">{error}</p>}
      <div className="scan-actions">
        <button type="button" className="primary big" disabled={!photos.length || busy} onClick={() => void send()}>
          {busy ? "Sending…" : "Find what I can build"}
        </button>
        <button type="button" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  );
}
