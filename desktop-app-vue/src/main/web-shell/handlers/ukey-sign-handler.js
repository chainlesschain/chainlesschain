/**
 * `ukey.sign` WS handler — Phase 2 streaming hardware-signature topic
 * (2026-04-30).
 *
 * Routine signing path of strategy memo decision #3 (混合协议):
 *   - Routine sign over WS (this handler) — low-risk, small data, ID
 *     correlation via the streaming envelope so the SPA can render
 *     "正在与硬件通信..." while the driver call is in-flight.
 *   - High-risk operations (key generation, mnemonic export, factory
 *     reset) stay on `window.electronAPI.ukey.*` and are NOT exposed
 *     here. That decision is enforced by what we register, not by any
 *     server-side check — security guarantee: if a future SPA is
 *     compromised, an attacker only ever sees `ukey.sign` over the wire,
 *     never the destructive operations.
 *
 * Async-generator surface so the dispatcher (ws-cli-loader.js) wraps
 * yields as `<topic>.chunk` frames — see commit `da1fc0caa` for the
 * envelope. We yield stage markers so the SPA can show progress; the
 * underlying `UKeyManager.sign()` does NOT expose hardware-level progress
 * events, so the stages are limited to coarse phases:
 *
 *   { stage: "pre_check"      }   - about to verify driver + unlock state
 *   { stage: "signing"        }   - driver.sign() is in flight (this is
 *                                   when the user may be prompted on the
 *                                   hardware to touch / enter PIN)
 *   ... (no further chunks — UKeyManager.sign is a single await) ...
 *   .result {success, signature?, reason?, message?}
 *
 * Frame:
 *   client → server: { id, type: "ukey.sign", data: <string | base64> }
 *   server → client: chunk frames (above) + terminal .result.
 *
 * Construction (DI for unit tests):
 *
 *     createUkeySignHandler({ ukeyManager })
 *
 * Errors that abort BEFORE the first yield (no manager / bad input)
 * throw — the dispatcher's plain-error path emits a single
 * `.result(ok:false)` with zero `.chunk` frames. Driver-level failures
 * (device_locked, driver_not_initialized, etc.) are returned by
 * UKeyManager.sign as `{success:false, reason}` and are passed through
 * as the terminal `.result.result` value with `ok:true` — the SPA
 * checks `result.success` to branch on success/failure.
 *
 * Why not throw on driver failures: those are *expected* user-facing
 * states ("您的设备未解锁，请插入并解锁"), not protocol errors. Mixing
 * them into ok:false would force the SPA to parse error.message strings
 * instead of inspecting structured `reason` codes.
 */

function getManager(options) {
  const mgr = options.ukeyManager;
  if (!mgr || typeof mgr.sign !== "function") {
    throw new Error("ukey_unavailable");
  }
  return mgr;
}

/**
 * Build the `ukey.sign` topic handler.
 *
 * @param {{ ukeyManager: object | null }} options
 * @returns {(frame: any) => AsyncGenerator<{stage: string}, object, void>}
 */
function createUkeySignHandler(options = {}) {
  return async function* ukeySignHandler(frame) {
    const mgr = getManager(options);

    const data = frame?.data;
    if (typeof data !== "string" || data.length === 0) {
      throw new Error("data_required");
    }
    if (data.length > 64 * 1024) {
      // Hardware sign on small payloads only; large blobs almost always
      // mean the SPA forgot to hash first. 64 KiB is generous.
      throw new Error("data_too_large");
    }

    // Stage 1 — about to verify the driver + unlock state on the manager.
    // Cheap — sub-ms — but lets the SPA flip to a busy state immediately.
    yield { stage: "pre_check" };

    // Stage 2 — driver.sign() is in flight. On real hardware this is when
    // the user may be prompted to touch the key / enter PIN. We yield the
    // marker BEFORE awaiting so the SPA shows the prompt state without
    // a render delay.
    yield { stage: "signing" };

    const result = await mgr.sign(data);

    // Pass result.* through verbatim. result.success is the SPA's branch
    // discriminant — driver_not_initialized, device_locked, etc. all
    // arrive here with success:false and a structured `reason`.
    return result;
  };
}

module.exports = { createUkeySignHandler };
