/**
 * useFs — file open/save with native Electron dialogs in embedded
 * desktop web-shell mode, automatic browser fallback (Blob + <a download>
 * / <input type=file>) elsewhere.
 *
 * The fs.openDialog / fs.saveDialog WS topics (see desktop-app-vue/
 * src/main/web-shell/handlers/fs-handlers.js) are dialog-gated — every
 * read/write is confirmed by the user via Electron's native dialog,
 * never an arbitrary path. The browser fallback shape matches: blob+
 * <a download> for save, <input type=file> for open.
 *
 * Usage:
 *   const fs = useFs()
 *   const file = await fs.pickFileText({ filters: [{ name: 'JSON', extensions: ['json'] }] })
 *   if (file && !file.canceled) {
 *     console.log(file.path, file.content)
 *   }
 *   await fs.saveText('hello', { defaultPath: 'note.txt' })
 *   await fs.saveJson({ a: 1 }, { defaultPath: 'data.json' })
 *
 * The shape returned by pickFile is uniform across modes:
 *   { canceled: boolean, path: string|null, content: string|null,
 *     size?: number, reason?: 'too_large' }
 *
 * `saveText` / `saveJson` resolve with `{ canceled: boolean, path: string|null }`.
 */

import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

function browserPickFile({ accept = '' } = {}) {
  return new Promise((resolve) => {
    if (typeof document === 'undefined') {
      resolve({ canceled: true, path: null, content: null })
      return
    }
    const input = document.createElement('input')
    input.type = 'file'
    if (accept) input.accept = accept
    input.style.display = 'none'
    document.body.appendChild(input)

    let settled = false
    const cleanup = () => {
      if (input.parentNode) input.parentNode.removeChild(input)
    }
    const onChange = () => {
      if (settled) return
      settled = true
      const file = input.files && input.files[0]
      if (!file) {
        cleanup()
        resolve({ canceled: true, path: null, content: null })
        return
      }
      const reader = new FileReader()
      reader.onload = () => {
        cleanup()
        resolve({
          canceled: false,
          path: file.name, // browser: only the filename, not a real path
          size: file.size,
          content: typeof reader.result === 'string' ? reader.result : '',
        })
      }
      reader.onerror = () => {
        cleanup()
        resolve({
          canceled: false,
          path: file.name,
          size: file.size,
          content: null,
          reason: 'read_failed',
        })
      }
      reader.readAsText(file)
    }
    // Cancel detection in browsers is unreliable — most fire no event when
    // the dialog is dismissed. We treat any later page-level click without
    // a 'change' as an implicit cancel; for the cleanest fallback we just
    // never resolve a cancel here. Callers should treat a hung promise as
    // "user dismissed dialog" — same as native ones, where canceled is
    // reported only when the dialog is dismissed via the OS button.
    input.addEventListener('change', onChange)
    input.click()
  })
}

function browserSaveText(content, { defaultPath = 'download.txt' } = {}) {
  if (typeof document === 'undefined') {
    return { canceled: true, path: null }
  }
  const blob = new Blob([content], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = defaultPath
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  // Browser mode can't tell whether the user clicked "Save" or "Cancel"
  // in the OS dialog — anchor downloads have no callback. We assume
  // success; the file might land in the user's default Downloads folder
  // even if the user wanted to cancel. This is a known browser limitation
  // and matches every other web SPA's save UX.
  return { canceled: false, path: defaultPath }
}

function acceptStringFromFilters(filters) {
  if (!Array.isArray(filters)) return ''
  const exts = []
  for (const f of filters) {
    if (Array.isArray(f.extensions)) {
      for (const e of f.extensions) exts.push(`.${e.replace(/^\./, '')}`)
    }
  }
  return exts.join(',')
}

export function useFs() {
  const ws = useWsStore()

  async function pickFileText(options = {}) {
    if (useShellMode().isEmbedded) {
      const reply = await ws.sendRaw(
        {
          type: 'fs.openDialog',
          title: options.title,
          filters: options.filters,
        },
        60000,
      )
      if (reply && reply.ok === false) {
        throw new Error(reply.error || 'fs.openDialog failed')
      }
      // sendRaw flattens the envelope: result fields land at top level OR
      // the dispatcher's `.result` shape leaves `.result` keyed. Cover both.
      const r = reply?.result ?? reply
      return {
        canceled: !!r.canceled,
        path: r.path ?? null,
        content: r.content ?? null,
        size: r.size,
        reason: r.reason,
      }
    }
    return browserPickFile({
      accept: acceptStringFromFilters(options.filters),
    })
  }

  async function saveText(content, options = {}) {
    if (typeof content !== 'string') {
      throw new Error('content must be a string')
    }
    if (useShellMode().isEmbedded) {
      const reply = await ws.sendRaw(
        {
          type: 'fs.saveDialog',
          title: options.title,
          defaultPath: options.defaultPath,
          filters: options.filters,
          content,
        },
        60000,
      )
      if (reply && reply.ok === false) {
        throw new Error(reply.error || 'fs.saveDialog failed')
      }
      const r = reply?.result ?? reply
      return {
        canceled: !!r.canceled,
        path: r.path ?? null,
      }
    }
    return browserSaveText(content, { defaultPath: options.defaultPath })
  }

  async function saveJson(data, options = {}) {
    const content = JSON.stringify(data, null, 2)
    const opts = {
      ...options,
      defaultPath: options.defaultPath || 'data.json',
      filters: options.filters || [{ name: 'JSON', extensions: ['json'] }],
    }
    return saveText(content, opts)
  }

  /**
   * Pick a directory via the native Electron dialog (embedded shell only —
   * browser fallback is impossible since browsers can't return absolute
   * paths). The handler also reports whether the picked dir is already a
   * chainlesschain project (`<dir>/.chainlesschain/config.json` exists),
   * so the caller can branch between "bind existing" and "init new".
   *
   * Returns:
   *   { canceled: boolean, path: string|null, initialized: boolean,
   *     unsupported?: true }
   *
   * In browser mode `unsupported: true` is returned — the caller should
   * surface a "请使用桌面壳" hint.
   */
  async function pickDirectory(options = {}) {
    if (!useShellMode().isEmbedded) {
      return { canceled: true, path: null, initialized: false, unsupported: true }
    }
    const reply = await ws.sendRaw(
      {
        type: 'fs.openDirectory',
        title: options.title,
      },
      60000,
    )
    if (reply && reply.ok === false) {
      throw new Error(reply.error || 'fs.openDirectory failed')
    }
    const r = reply?.result ?? reply
    return {
      canceled: !!r.canceled,
      path: r.path ?? null,
      initialized: !!r.initialized,
    }
  }

  return { pickFileText, saveText, saveJson, pickDirectory }
}
