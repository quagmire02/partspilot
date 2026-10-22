import type { Platform } from "./types";

/** Browser fallback for `vite dev` and UI tests. Not used by the installed app. */
export function webPlatform(): Platform {
  return {
    kind: "web",
    secureStore: {
      getItem: async (k) => localStorage.getItem(k),
      setItem: async (k, v) => localStorage.setItem(k, v),
      removeItem: async (k) => localStorage.removeItem(k),
    },
    async openExternal(url) {
      if (/^https?:\/\//i.test(url)) window.open(url, "_blank", "noopener,noreferrer");
    },
    async onDeepLink() {
      return () => undefined;
    },
    async notify(title, body) {
      if (!("Notification" in window)) return;
      if (Notification.permission === "default") await Notification.requestPermission();
      if (Notification.permission === "granted") new Notification(title, { body });
    },
    copyText: (text) => navigator.clipboard.writeText(text),
    autostart: {
      isEnabled: async () => false,
      set: async () => undefined,
    },
  };
}
