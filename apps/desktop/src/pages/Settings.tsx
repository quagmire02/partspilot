import { useEffect, useState } from "react";
import { config } from "../config";
import { signOut } from "../auth";
import { platform } from "../platform";
import { NOTIFY_PREF, notificationsEnabled } from "../state/jobs";

export function Settings({ email }: { email: string | null }) {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [notify, setNotify] = useState(notificationsEnabled());

  useEffect(() => {
    platform().autostart.isEnabled().then(setAutostart, () => setAutostart(false));
  }, []);

  return (
    <section className="page" aria-labelledby="settings-h">
      <h1 id="settings-h">Settings</h1>

      <div className="card">
        <h2>Account</h2>
        <p>Signed in as {email ?? "your Google account"}</p>
        <button type="button" className="secondary" onClick={() => void signOut()}>
          Sign out
        </button>
      </div>

      <div className="card">
        <h2>Background</h2>
        <label className="toggle">
          <input
            type="checkbox"
            checked={Boolean(autostart)}
            disabled={autostart === null || platform().kind !== "tauri"}
            onChange={async (e) => {
              await platform().autostart.set(e.target.checked);
              setAutostart(await platform().autostart.isEnabled());
            }}
          />
          Start with Windows and run in the tray (so results reach you as notifications)
        </label>
        <label className="toggle">
          <input
            type="checkbox"
            checked={notify}
            onChange={(e) => {
              localStorage.setItem(NOTIFY_PREF, e.target.checked ? "on" : "off");
              setNotify(e.target.checked);
            }}
          />
          Show a Windows notification when a result is ready
        </label>
        <button type="button" className="link" onClick={() => void platform().notify("PartsPilot", "Notifications are working.")}>
          Send a test notification
        </button>
      </div>

      <div className="card about">
        <h2>About</h2>
        <p>PartsPilot {config.version}</p>
        <p>Part data is derived from the Fritzing parts library (© Friends-of-Fritzing e.V. and contributors, CC BY-SA 3.0) and the KiCad symbol libraries (CC BY-SA 4.0 with the KiCad libraries exception). PartsPilot's catalog data is shared under CC BY-SA 4.0.</p>
        <p>Wiring diagrams use wokwi-elements (MIT). Built with Tauri (MIT/Apache-2.0), React (MIT) and Supabase.</p>
        <p className="muted">
          Wiring is checked against electrical rules, but always double-check connections before powering a circuit. PartsPilot never plans mains-voltage builds.
        </p>
      </div>
    </section>
  );
}
