/**
 * Detached cache refresher for the startup update notice.
 * Spawned unref'd by update-notice.js; argv[2] = cache file path.
 * Exits quietly on any failure — the notice is strictly best-effort.
 */
import { refreshCacheOnce } from "./update-notice.js";

refreshCacheOnce({ cacheFile: process.argv[2] })
  .catch(() => {})
  .finally(() => process.exit(0));
