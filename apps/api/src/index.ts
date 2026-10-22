import type { QueueMessage } from "@partspilot/shared";
import { createApp } from "./app.js";
import { depsFromEnv } from "./deps.js";
import type { Env } from "./env.js";
import { engineFromEnv } from "./pipeline/ai.js";
import { handleDeadLetters, handleJobMessages } from "./pipeline/consumer.js";
import { cleanupExpired } from "./pipeline/cleanup.js";
import type { PipelineDeps } from "./pipeline/stages.js";

const app = createApp((env) => depsFromEnv(env as Env));

function pipelineDeps(env: Env): PipelineDeps {
  const d = depsFromEnv(env);
  return { repo: d.repo, photos: d.photos, enqueue: d.enqueue, engine: engineFromEnv(env, d.repo) };
}

export default {
  fetch: app.fetch,

  async queue(batch, env) {
    const d = pipelineDeps(env);
    if (batch.queue.endsWith("-dlq")) await handleDeadLetters(batch.messages, d);
    else await handleJobMessages(batch.messages, d);
  },

  async scheduled(_controller, env, ctx) {
    const d = depsFromEnv(env);
    ctx.waitUntil(cleanupExpired(d.repo, d.photos));
  },
} satisfies ExportedHandler<Env, QueueMessage>;
