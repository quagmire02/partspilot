import { QueueMessage } from "@partspilot/shared";
import { log } from "../lib/log.js";
import { asPipelineFailure } from "./engine.js";
import { failJob, runDetect, runPlan, type PipelineDeps } from "./stages.js";

/** Must match max_retries in wrangler.jsonc; the last failure goes to the DLQ path below. */
export const MAX_ATTEMPTS = 3;

export interface QueueMessageLike {
  body: unknown;
  attempts: number;
  ack(): void;
  retry(options?: { delaySeconds?: number }): void;
}

export async function handleJobMessages(messages: readonly QueueMessageLike[], d: PipelineDeps): Promise<void> {
  await Promise.all(messages.map((m) => handleOne(m, d)));
}

async function handleOne(m: QueueMessageLike, d: PipelineDeps): Promise<void> {
  const parsed = QueueMessage.safeParse(m.body);
  if (!parsed.success) {
    log("queue_bad_message", { code: "bad_request" });
    m.ack();
    return;
  }
  const msg = parsed.data;
  try {
    if (msg.type === "detect") await runDetect(msg.job_id, d);
    else await runPlan(msg.job_id, msg.plan_version, d);
    m.ack();
  } catch (err) {
    const f = asPipelineFailure(err);
    log("stage_error", { job_id: msg.job_id, code: f.code, attempt: m.attempts, stage: msg.type });
    if (f.retryable && m.attempts < MAX_ATTEMPTS) {
      m.retry({ delaySeconds: 5 * 2 ** (m.attempts - 1) });
      return;
    }
    await failJob(d.repo, msg.job_id, f.code === "internal" && f.retryable ? "model_unavailable" : f.code).catch(() => undefined);
    m.ack();
  }
}

/** Dead-letter consumer: anything that exhausted its retries becomes "Needs review". */
export async function handleDeadLetters(messages: readonly QueueMessageLike[], d: PipelineDeps): Promise<void> {
  for (const m of messages) {
    const parsed = QueueMessage.safeParse(m.body);
    if (parsed.success) {
      const job = await d.repo.getJob(parsed.data.job_id).catch(() => null);
      if (job && job.status === "processing") await failJob(d.repo, job.id, "model_unavailable").catch(() => undefined);
    }
    m.ack();
  }
}
