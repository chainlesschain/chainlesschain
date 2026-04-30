/**
 * useUkey — routine UKey signing via the desktop web-shell's `ukey.sign`
 * streaming topic (see desktop-app-vue/src/main/web-shell/handlers/
 * ukey-sign-handler.js).
 *
 * Strategy memo decision #3 (混合协议) — only routine sign rides this
 * path. Destructive ops (key generation / mnemonic export / factory
 * reset) deliberately stay off the WS map and are not reachable here;
 * they live on `window.electronAPI.ukey.*` (preload) and are out of
 * scope for this composable.
 *
 * Usage:
 *   const ukey = useUkey()
 *   const r = await ukey.sign('payload-bytes', {
 *     onStage: (stage) => console.log(stage),  // 'pre_check' | 'signing'
 *   })
 *   if (r.success) {
 *     console.log(r.signature)
 *   } else {
 *     // Driver-level failure — branch on r.reason:
 *     //   'driver_not_initialized' (non-Windows / driver missing)
 *     //   'device_locked'           (insert + unlock the U-Key)
 *     //   ...
 *   }
 *
 * Errors: protocol-level failures (data_required / data_too_large /
 * ukey_unavailable / WebSocket closed) reject the Promise. Driver-level
 * failures resolve with `{success:false, reason, message}` so the UI
 * can branch on the structured reason instead of parsing error.message.
 */

import { useWsStore } from '../stores/ws.js'

export function useUkey() {
  const ws = useWsStore()

  /**
   * Sign a small payload with the connected U-Key.
   *
   * @param {string} data - data to sign (string; binary callers should
   *                        base64-encode before passing). 1..64 KiB.
   * @param {{ onStage?: (stage: string) => void, idleMs?: number, signal?: AbortSignal }} [opts]
   * @returns {Promise<{
   *   success: boolean,
   *   signature?: string,
   *   algorithm?: string,
   *   reason?: string,
   *   message?: string,
   * }>}
   *
   * Cancellation: caller passes an AbortSignal; aborting it rejects the
   * promise with Error('aborted'). The server hint frame is sent best-
   * effort (handler-side abort plumbing not yet built; this is the SPA
   * stub side per strategy memo's "stub now, route later" plan).
   */
  async function sign(data, opts = {}) {
    if (typeof data !== 'string' || data.length === 0) {
      throw new Error('data is required')
    }
    const onStage = typeof opts.onStage === 'function' ? opts.onStage : () => {}
    return ws.sendStream(
      { type: 'ukey.sign', data },
      {
        onChunk: (chunk) => {
          if (chunk && typeof chunk.stage === 'string') {
            onStage(chunk.stage)
          }
        },
        idleMs: opts.idleMs ?? 60000,
        signal: opts.signal,
      },
    )
  }

  return { sign }
}
