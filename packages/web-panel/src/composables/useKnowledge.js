/**
 * useKnowledge — web-panel composable wrapping `knowledge.*` WS topics
 * (Phase 3c.6, 2026-05-06). Pure-browser mode falls back to the
 * `note add "..."` CLI execute path, which works the same way Notes.vue
 * already adds notes (no in-process db conflict because cc CLI subprocess
 * exits immediately after writing its own row).
 *
 * Embedded shell (Electron) MUST go through the WS topic to avoid spawning
 * a second cc process competing with the main process db handle.
 *
 * Usage:
 *   const k = useKnowledge()
 *   const item = await k.addItem({ title, content, tags: ['素材'], type: 'note' })
 */

import { useWsStore } from '../stores/ws.js'
import { useShellMode } from './useShellMode.js'

function _unwrap(reply) {
  if (reply && reply.ok === false) {
    throw new Error(reply.error || 'knowledge handler failed')
  }
  return reply?.result ?? reply
}

function _shellQuote(s) {
  return String(s).replace(/(["\\])/g, '\\$1')
}

export function useKnowledge() {
  const ws = useWsStore()

  async function addItem({ title, content, tags = [], type = 'note' } = {}) {
    if (typeof title !== 'string' || !title.trim()) {
      throw new Error('title is required')
    }
    if (typeof content !== 'string') {
      throw new Error('content is required')
    }
    const tagsArr = Array.isArray(tags) ? tags.filter(Boolean) : []

    if (useShellMode().isEmbedded) {
      const reply = await ws.sendRaw(
        {
          type: 'knowledge.add-item',
          item: { title: title.trim(), content, tags: tagsArr, type },
        },
        20000,
      )
      const r = _unwrap(reply)
      if (r?.success === false) {
        throw new Error(r.error || 'knowledge.add-item failed')
      }
      return r?.item ?? null
    }

    // Pure-browser fallback: use the CLI execute channel that Notes.vue
    // already relies on. Tags need a trailing -t flag with comma list.
    let cmd = `note add "${_shellQuote(title.trim())}" -c "${_shellQuote(content)}"`
    if (tagsArr.length) cmd += ` -t "${_shellQuote(tagsArr.join(','))}"`
    const { output } = await ws.execute(cmd, 15000)
    if (output && /^[\s\S]*✖|error/i.test(output)) {
      throw new Error(output.slice(0, 200))
    }
    return { title: title.trim(), content, tags: tagsArr, type }
  }

  return { addItem }
}
