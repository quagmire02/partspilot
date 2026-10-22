import type { JobListItem } from "@partspilot/shared";
import { StatusBadge } from "../components/StatusBadge";
import { useJobs } from "../state/jobs";

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: "auto" });
export function ago(iso: string, now = Date.now()): string {
  const s = Math.round((Date.parse(iso) - now) / 1000);
  const abs = Math.abs(s);
  if (abs < 60) return rtf.format(Math.trunc(s), "second");
  if (abs < 3600) return rtf.format(Math.trunc(s / 60), "minute");
  if (abs < 86400) return rtf.format(Math.trunc(s / 3600), "hour");
  return rtf.format(Math.trunc(s / 86400), "day");
}

function title(j: JobListItem): string {
  if (j.goal) return j.goal;
  return j.source === "inventory" ? "What can I build with my inventory?" : "What can I build?";
}

export function Inbox({ selected, onOpen, onNew }: { selected: string | null; onOpen: (id: string) => void; onNew?: () => void }) {
  const { jobs, loading, error } = useJobs();
  return (
    <section className="inbox" aria-label="Inbox">
      <div className="pane-head">
        <h1 className="pane-title">Inbox</h1>
        {onNew && (
          <button type="button" className="primary" onClick={onNew}>
            + New scan
          </button>
        )}
      </div>
      {error && <p className="notice error">{error}</p>}
      {loading && !jobs.length && <p className="muted pad">Loading…</p>}
      {!loading && !jobs.length && (
        <div className="empty">
          <p>No scans yet.</p>
          <p className="muted">
            {onNew
              ? "Click New scan, add photos of your parts and ask what you want to build. Results appear here."
              : "Open PartsPilot on your phone, photograph your parts and tap Send. Results appear here — even if this PC was off."}
          </p>
        </div>
      )}
      <ul className="job-list">
        {jobs.map((j) => (
          <li key={j.id}>
            <button type="button" className={`job-row${selected === j.id ? " selected" : ""}`} onClick={() => onOpen(j.id)}>
              {j.thumbnail_url ? <img src={j.thumbnail_url} alt="" className="thumb" /> : <span className="thumb placeholder" aria-hidden>{j.source === "inventory" ? "📦" : "📷"}</span>}
              <span className="job-text">
                <span className="job-goal">{title(j)}</span>
                <span className="job-meta">
                  {ago(j.created_at)}
                  {j.summary?.title && ` · ${j.summary.title}`}
                </span>
              </span>
              <StatusBadge status={j.status} />
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
