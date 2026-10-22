import type { Platform } from "./types";
import { webPlatform } from "./web";

export type { Platform } from "./types";

const isTauri = () => typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

let current: Platform | null = null;

export async function initPlatform(): Promise<Platform> {
  if (current) return current;
  current = isTauri() ? (await import("./tauri")).tauriPlatform() : webPlatform();
  return current;
}

export function platform(): Platform {
  if (!current) throw new Error("platform not initialised");
  return current;
}
