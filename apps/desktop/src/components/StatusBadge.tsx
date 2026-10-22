import type { JobStatus } from "@partspilot/shared";

const LABEL: Record<JobStatus, string> = {
  processing: "Processing",
  needs_check: "Needs your check",
  ready: "Ready",
  needs_review: "Needs review",
};

export function StatusBadge({ status }: { status: JobStatus }) {
  return (
    <span className={`badge badge-${status}`} aria-label={`Status: ${LABEL[status]}`}>
      {status === "processing" && <span className="spinner" aria-hidden />}
      {LABEL[status]}
    </span>
  );
}
