/**
 * useScreenshot — web-panel composable wrapping `screenshot.*` WS topics
 * (Phase 3c.7, 2026-05-07). Pure-browser mode returns `{unsupported:true}`
 * instead of attempting capture — `screenshot-desktop` shells out to OS
 * APIs and isn't reachable from a sandboxed browser tab. Mirror of the
 * `useFs.pickDirectory` precedent.
 *
 * Usage:
 *   const ss = useScreenshot()
 *   if (ss.unsupported) { showAlert('请用桌面壳'); return }
 *   const cap = await ss.capture()         // {path, dataUrl, ...}
 *   const ocr = await ss.ocr(cap.path, undefined, 'auto')
 *                                           // {text, confidence, language, engine, model?}
 *   ...save via useKnowledge().addItem()...
 *   await ss.cleanup(cap.path)
 *
 * Envelope unwrap: ws.sendRaw lands on { ok, result } from ws-cli-loader;
 * `_unwrap` pulls .result, then handlers themselves return {success, ...}
 * — same shape as useFs/useKnowledge (Phase 3c.6 precedent).
 */

import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'screenshot handler failed')
  }
  return reply?.result ?? reply
}

export function useScreenshot() {
  const ws = useWsStore()
  const isEmbedded = useShellMode().isEmbedded

  if (!isEmbedded) {
    return {
      unsupported: true,
      capture: async () => {
        throw new Error('截图需要桌面壳;浏览器模式不支持')
      },
      ocr: async () => {
        throw new Error('OCR 仅在桌面壳可用')
      },
      cleanup: async () => {
        /* no-op */
      },
    }
  }

  async function capture({ screenIndex } = {}) {
    const reply = await ws.sendRaw(
      { type: 'screenshot.capture', screenIndex },
      30000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'screenshot.capture failed')
    }
    return r
  }

  async function ocr(path, lang, engine) {
    if (!path) throw new Error('path is required')
    const reply = await ws.sendRaw(
      {
        type: 'screenshot.ocr',
        path,
        lang,
        // engine: 'auto' | 'llm' | 'tesseract'。undefined → 主进程默认 auto。
        engine,
      },
      // OCR 时延上界:tesseract.js worker 在低端 CPU 上 30-60s 是常态;
      // LLM 路径走网络 + 大图 base64,1-3s 但偶有 timeout。统一 90s 兜底。
      90000,
    )
    const r = _unwrap(reply)
    if (r?.success === false) {
      throw new Error(r.error || 'screenshot.ocr failed')
    }
    return r
  }

  async function cleanup(path) {
    if (!path) return
    try {
      const reply = await ws.sendRaw(
        { type: 'screenshot.cleanup', path },
        10000,
      )
      const r = _unwrap(reply)
      if (r?.success === false) {
        // 静默 — cleanup 失败不挂主流程。
        // eslint-disable-next-line no-console
        console.warn('[useScreenshot] cleanup failed:', r.error)
      }
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('[useScreenshot] cleanup error:', err?.message || err)
    }
  }

  return { unsupported: false, capture, ocr, cleanup }
}
