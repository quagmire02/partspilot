import { useEffect, useState } from "react";
import type { Session } from "@supabase/supabase-js";
import { isLocalStack } from "@partspilot/shared";
import { handleDeepLink, signInWithGoogle, supabase } from "./auth";
import { DevSignIn } from "./components/DevSignIn";
import { NewScan } from "./components/NewScan";
import { config } from "./config";
import { platform } from "./platform";
import { JobsProvider, useJobs } from "./state/jobs";
import { Inbox } from "./pages/Inbox";
import { JobDetail } from "./pages/JobDetail";
import { Inventory } from "./pages/Inventory";
import { Settings } from "./pages/Settings";

type View = "inbox" | "inventory" | "settings";

export function App() {
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    const sb = supabase();
    sb.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: sub } = sb.auth.onAuthStateChange((_e, s) => setSession(s));
    let stop: (() => void) | undefined;
    void platform()
      .onDeepLink((url) => void handleDeepLink(url))
      .then((f) => (stop = f));
    return () => {
      sub.subscription.unsubscribe();
      stop?.();
    };
  }, []);

  if (session === undefined) return <div className="splash">PartsPilot</div>;
  if (!session) return <SignIn />;
  return (
    <JobsProvider userId={session.user.id}>
      <Shell email={session.user.email ?? null} />
    </JobsProvider>
  );
}

/** Self-hosted (local stack): scans can be uploaded from this computer, no phone needed. */
const canUpload = isLocalStack(config.supabaseUrl);

function Shell({ email }: { email: string | null }) {
  const [view, setView] = useState<View>("inbox");
  const [jobId, setJobId] = useState<string | null>(null);
  const [composing, setComposing] = useState(false);
  const { jobs, refresh } = useJobs();
  const open = (id: string) => {
    setComposing(false);
    setJobId(id);
  };
  const attention = jobs.filter((j) => j.status === "needs_check" || j.status === "needs_review").length;

  return (
    <div className="shell">
      <nav className="sidebar" aria-label="Main">
        <div className="brand">PartsPilot</div>
        <button type="button" className={view === "inbox" ? "active" : ""} onClick={() => setView("inbox")}>
          Inbox {attention > 0 && <span className="count" aria-label={`${attention} need attention`}>{attention}</span>}
        </button>
        <button type="button" className={view === "inventory" ? "active" : ""} onClick={() => setView("inventory")}>
          My Inventory
        </button>
        <button type="button" className={view === "settings" ? "active" : ""} onClick={() => setView("settings")}>
          Settings
        </button>
      </nav>
      <main className="content">
        {view === "inbox" && (
          <div className="split">
            <Inbox selected={jobId} onOpen={open} onNew={canUpload ? () => setComposing(true) : undefined} />
            {composing ? (
              <NewScan
                onCancel={() => setComposing(false)}
                onCreated={(id) => {
                  open(id);
                  void refresh();
                }}
              />
            ) : jobId ? (
              <JobDetail key={jobId} jobId={jobId} onDeleted={() => setJobId(null)} />
            ) : (
              <div className="detail empty-detail muted">{canUpload ? "Select a scan, or click New scan to start one." : "Select a scan to see the result."}</div>
            )}
          </div>
        )}
        {view === "inventory" && (
          <Inventory
            onJobCreated={(id) => {
              open(id);
              setView("inbox");
            }}
          />
        )}
        {view === "settings" && <Settings email={email} />}
      </main>
    </div>
  );
}

function SignIn() {
  const [state, setState] = useState<"idle" | "waiting" | "error">("idle");
  const start = async () => {
    try {
      setState("waiting");
      await signInWithGoogle();
    } catch {
      setState("error");
    }
  };
  return (
    <div className="signin">
      <h1>PartsPilot</h1>
      <p>Photograph your electronic parts. See what you can build, what's missing, how to wire it and the code.</p>
      {(!canUpload || config.googleSignIn) && (
        <button type="button" className="primary big" onClick={() => void start()}>
          Sign in with Google
        </button>
      )}
      {state === "waiting" && <p className="muted">Finish signing in in your browser, then return here.</p>}
      {state === "error" && <p className="notice error">Couldn't open the sign-in page. Check your connection and try again.</p>}
      {canUpload && <DevSignIn />}
    </div>
  );
}
