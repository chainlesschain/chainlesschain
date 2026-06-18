/**
 * Shared fetch-with-timeout for the webhook notifiers (DingTalk / Feishu /
 * Telegram / WeCom). A notification POST must not hang forever on a slow or
 * dead webhook endpoint — abort after NOTIFIER_TIMEOUT_MS (env-overridable via
 * CC_NOTIFIER_TIMEOUT_MS). Each notifier's send() already try/catches into
 * { ok: false, reason }, so a timeout surfaces as a clean failed-send rather
 * than a hang.
 */

export const NOTIFIER_TIMEOUT_MS =
  Number(process.env.CC_NOTIFIER_TIMEOUT_MS) || 15000;

export async function fetchWithTimeout(
  url,
  opts = {},
  ms = NOTIFIER_TIMEOUT_MS,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  if (timer && typeof timer.unref === "function") timer.unref();
  try {
    return await fetch(url, { ...opts, signal: controller.signal });
  } catch (e) {
    if (controller.signal.aborted) {
      throw new Error(`notifier request timed out after ${ms / 1000}s`);
    }
    throw e;
  } finally {
    clearTimeout(timer);
  }
}
