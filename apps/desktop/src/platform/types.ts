/** Async key/value store used for the auth session. */
export interface SecureStore {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

/** Everything the UI needs from the OS. Tauri in the app; browser fallbacks in dev/tests. */
export interface Platform {
  readonly kind: "tauri" | "web";
  secureStore: SecureStore;
  /** Opens a URL in the user's default browser (never inside the app). https only. */
  openExternal(url: string): Promise<void>;
  /** Deep links (partspilot://…) delivered to this instance, incl. the one that launched it. */
  onDeepLink(cb: (url: string) => void): Promise<() => void>;
  notify(title: string, body: string): Promise<void>;
  copyText(text: string): Promise<void>;
  autostart: {
    isEnabled(): Promise<boolean>;
    set(enabled: boolean): Promise<void>;
  };
}
