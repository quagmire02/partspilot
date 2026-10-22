"use client";

import { useEffect, useRef, useState } from "react";
import { captureFrame } from "../images";

interface Props {
  disabled: boolean;
  onShot: (blob: Blob) => void;
  onPick: (files: File[]) => void;
}

/** Live viewfinder with a shutter button; falls back to the OS camera picker. */
export function Camera({ disabled, onShot, onPick }: Props) {
  const video = useRef<HTMLVideoElement>(null);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [unavailable, setUnavailable] = useState(false);
  const cameraInput = useRef<HTMLInputElement>(null);
  const galleryInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    let active: MediaStream | null = null;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setUnavailable(true);
      return;
    }
    navigator.mediaDevices
      .getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 3840 }, height: { ideal: 2160 } }, audio: false })
      .then((s) => {
        if (cancelled) return s.getTracks().forEach((t) => t.stop());
        active = s;
        setStream(s);
        if (video.current) video.current.srcObject = s;
      })
      .catch(() => setUnavailable(true));
    return () => {
      cancelled = true;
      active?.getTracks().forEach((t) => t.stop());
    };
  }, []);

  const shoot = async () => {
    if (!video.current || !stream) return cameraInput.current?.click();
    onShot(await captureFrame(video.current, stream.getVideoTracks()[0] ?? null));
  };

  const files = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []);
    e.target.value = "";
    if (list.length) onPick(list);
  };

  return (
    <section className="camera" aria-label="Camera">
      {unavailable ? (
        <button type="button" className="camera-fallback" disabled={disabled} onClick={() => cameraInput.current?.click()}>
          Tap to take a photo
        </button>
      ) : (
        <video ref={video} className="viewfinder" autoPlay playsInline muted aria-label="Camera preview" />
      )}
      <div className="camera-controls">
        <button type="button" className="secondary" disabled={disabled} onClick={() => galleryInput.current?.click()}>
          Gallery
        </button>
        <button type="button" className="shutter" disabled={disabled} onClick={shoot} aria-label="Take photo" />
        <span className="spacer" />
      </div>
      <input ref={cameraInput} type="file" accept="image/*" capture="environment" hidden onChange={files} />
      <input ref={galleryInput} type="file" accept="image/*" multiple hidden onChange={files} />
    </section>
  );
}
