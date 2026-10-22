import { disable as disableAutostart, enable as enableAutostart, isEnabled as autostartEnabled } from "@tauri-apps/plugin-autostart";
import { writeText } from "@tauri-apps/plugin-clipboard-manager";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { openUrl } from "@tauri-apps/plugin-opener";
import { deleteSecret, getSecret, setSecret } from "tauri-plugin-keyring-api";
import { chunkedStore } from "./chunked";
import type { Platform } from "./types";

const SERVICE = "app.partspilot.desktop";

export function tauriPlatform(): Platform {
  const secureStore = chunkedStore({
    get: async (name) => {
      try {
        return await getSecret(SERVICE, name);
      } catch {
        return null; // "no entry" is reported as an error by the OS store
      }
    },
    set: (name, bytes) => setSecret(SERVICE, name, bytes),
    remove: async (name) => {
      try {
        await deleteSecret(SERVICE, name);
      } catch {
        // already gone
      }
    },
  });

  return {
    kind: "tauri",
    secureStore,
    async openExternal(url) {
      if (!/^https:\/\//i.test(url) && !/^http:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//i.test(url)) return;
      await openUrl(url);
    },
    async onDeepLink(cb) {
      const launched = await getCurrent();
      for (const u of launched ?? []) cb(u);
      return onOpenUrl((urls) => urls.forEach(cb));
    },
    async notify(title, body) {
      let ok = await isPermissionGranted();
      if (!ok) ok = (await requestPermission()) === "granted";
      if (ok) sendNotification({ title, body });
    },
    copyText: (text) => writeText(text),
    autostart: {
      isEnabled: () => autostartEnabled(),
      set: (on) => (on ? enableAutostart() : disableAutostart()),
    },
  };
}
