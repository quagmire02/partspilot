import type { Job, JobStatus } from "@partspilot/shared";

export interface Notice {
  jobId: string;
  title: string;
  body: string;
}

const NOTIFY: JobStatus[] = ["ready", "needs_check", "needs_review"];

function describe(job: Pick<Job, "id" | "status" | "summary" | "goal">): Notice {
  const s = job.summary;
  if (job.status === "needs_check") {
    const n = s?.needs_check_count ?? 0;
    return { jobId: job.id, title: "Check your parts", body: n === 1 ? "1 part needs a quick look." : `${n} parts need a quick look.` };
  }
  if (job.status === "needs_review") {
    return { jobId: job.id, title: "This scan needs your review", body: job.goal ? `“${job.goal.slice(0, 60)}”` : "Open PartsPilot for details." };
  }
  const verdict =
    s?.verdict === "yes"
      ? "You can build it."
      : s?.verdict === "yes_missing"
        ? `You can build it — ${s.missing_count ?? 0} part${s.missing_count === 1 ? "" : "s"} missing.`
        : s?.verdict === "no_closest"
          ? "Not quite — here's the closest build."
          : s?.verdict === "refused"
            ? "We can't help with this build."
            : s?.idea_titles?.length
              ? `${s.idea_titles.length} project ideas for your parts.`
              : "Your result is ready.";
  return { jobId: job.id, title: s?.title ?? "Your build plan is ready", body: verdict };
}

/** Notices for jobs that just entered a status the user should hear about. */
export function transitions(prev: ReadonlyMap<string, JobStatus>, jobs: Pick<Job, "id" | "status" | "summary" | "goal">[]): Notice[] {
  return jobs.filter((j) => NOTIFY.includes(j.status) && prev.get(j.id) !== j.status && prev.has(j.id)).map(describe);
}

/** After the PC was off: everything that finished since the last sync, collapsed if many. */
export function catchUp(jobs: Pick<Job, "id" | "status" | "summary" | "goal">[]): Notice[] {
  const done = jobs.filter((j) => NOTIFY.includes(j.status));
  if (done.length <= 2) return done.map(describe);
  return [{ jobId: done[0]!.id, title: `${done.length} results are waiting`, body: "Open PartsPilot to see them." }];
}
