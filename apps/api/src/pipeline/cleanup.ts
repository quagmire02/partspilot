import { LIMITS } from "@partspilot/shared";
import type { PhotoStore, Repo } from "../db/types.js";
import { log } from "../lib/log.js";

/** Daily cron: delete photos older than 30 days and stale cache rows. */
export async function cleanupExpired(repo: Repo, photos: PhotoStore, batch = 200): Promise<{ jobs: number; cache: number }> {
  let jobs = 0;
  for (let round = 0; round < 10; round++) {
    const due = await repo.expiredPhotos(LIMITS.PHOTO_RETENTION_DAYS, batch);
    if (due.length === 0) break;
    await photos.remove(due.flatMap((j) => j.photo_paths));
    jobs += await repo.markPhotosDeleted(due.map((j) => j.id));
    if (due.length < batch) break;
  }
  const cache = await repo.purgeCache(LIMITS.PHOTO_RETENTION_DAYS);
  log("cleanup", { n: jobs, code: `cache_${cache}` });
  return { jobs, cache };
}
