import { useCallback, useEffect, useState } from "react";
import { ApiRequestError, ERROR_USER_TEXT, type JobDetailResponse } from "@partspilot/shared";
import { api } from "../auth";
import { PartsEditor } from "../components/PartsEditor";
import { PhotoOverlay } from "../components/PhotoOverlay";
import { PlanView, ProjectCards } from "../components/PlanView";
import { StatusBadge } from "../components/StatusBadge";
import { useJobs } from "../state/jobs";
import { ago } from "./Inbox";

const STAGE_TEXT: Record<string, string> = {
  queued: "Waiting to start…",
  detecting: "Finding parts in your photos…",
  matching: "Matching exact part names…",
  planning: "Planning your build…",
  validating: "Checking the wiring against electrical rules…",
  rendering: "Drawing the diagram…",
};

export function JobDetail({ jobId, onDeleted }: { jobId: string; onDeleted: () => void }) {
  const { version, refresh } = useJobs();
  const [data, setData] = useState<JobDetailResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [highlight, setHighlight] = useState<string | null>(null);
  const [planId, setPlanId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api.getJob(jobId));
      setError(null);
    } catch (e) {
      setError(e instanceof ApiRequestError && e.code === "not_found" ? "This scan no longer exists." : "Couldn't load this scan.");
    }
  }, [jobId]);

  useEffect(() => {
    setData(null);
    setPlanId(null);
  }, [jobId]);
  useEffect(() => void load(), [load, version]);
  // Signed photo URLs last 5 minutes; refresh them while the view is open.
  useEffect(() => {
    const t = setInterval(() => void load(), 4 * 60 * 1000);
    return () => clearInterval(t);
  }, [load]);

  if (error) return <div className="detail pad">{error}</div>;
  if (!data) return <div className="detail pad muted">Loading…</div>;
  const { job, photos, parts, result } = data;

  const remove = async () => {
    if (!window.confirm("Delete this scan and its photos?")) return;
    await api.deleteJob(job.id);
    await refresh();
    onDeleted();
  };

  const plans = result?.plans ?? [];
  const chosen = result?.kind === "discovery" ? plans.find((p) => p.id === planId) : plans[0];

  return (
    <article className="detail" aria-label="Scan result">
      <header className="detail-head">
        <div>
          <h1>{job.goal || (job.source === "inventory" ? "What can I build with my inventory?" : "What can I build?")}</h1>
          <span className="muted">{ago(job.created_at)}</span>
        </div>
        <StatusBadge status={job.status} />
        <button type="button" className="link danger" onClick={() => void remove()}>
          Delete
        </button>
      </header>

      {job.source === "photo" && <PhotoOverlay photos={photos} parts={parts} highlight={highlight} onHover={setHighlight} />}
      {parts.length > 0 && <PartsEditor job={job} parts={parts} onHover={setHighlight} onSubmitted={() => void load()} />}

      {job.status === "processing" && (
        <div className="progress" role="status">
          <span className="spinner" aria-hidden /> {STAGE_TEXT[job.stage] ?? "Working…"}
        </div>
      )}
      {job.status === "needs_review" && !result && <p className="notice error">{(job.error_code && ERROR_USER_TEXT[job.error_code]) ?? "Something went wrong with this scan."}</p>}

      {result?.kind === "discovery" && !chosen && (
        <section aria-labelledby="ideas-h">
          <h2 id="ideas-h">Here's what you can build</h2>
          <ProjectCards plans={plans} onOpen={setPlanId} />
        </section>
      )}
      {result?.kind === "discovery" && chosen && (
        <button type="button" className="link" onClick={() => setPlanId(null)}>
          ← All ideas
        </button>
      )}
      {chosen && job.status !== "processing" && <PlanView plan={chosen} />}
    </article>
  );
}
