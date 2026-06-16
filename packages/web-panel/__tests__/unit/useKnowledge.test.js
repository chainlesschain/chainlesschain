/**
 * useKnowledge composable — unit tests.
 *
 *   - embedded: knowledge.add-item via ws.sendRaw
 *   - browser: falls back to `note add ...` via ws.execute (shell-quoted)
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'

const sendRaw = vi.fn()
const execute = vi.fn()

vi.mock('../../src/stores/ws.js', () => ({
  useWsStore: () => ({ sendRaw, execute }),
}))

import { useKnowledge } from '../../src/composables/useKnowledge.js'

function embedded(on) {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = on ? { embeddedShell: true } : {}
}

beforeEach(() => {
  sendRaw.mockReset()
  execute.mockReset()
  embedded(false)
})

describe('useKnowledge — validation', () => {
  it('requires a non-empty string title', async () => {
    const k = useKnowledge()
    await expect(k.addItem({ title: '', content: 'x' })).rejects.toThrow(
      /title is required/,
    )
    await expect(k.addItem({ title: 123, content: 'x' })).rejects.toThrow(
      /title is required/,
    )
  })

  it('requires a string content', async () => {
    await expect(
      useKnowledge().addItem({ title: 't', content: 123 }),
    ).rejects.toThrow(/content is required/)
  })
})

describe('useKnowledge — embedded mode', () => {
  beforeEach(() => embedded(true))

  it('sends knowledge.add-item with a trimmed title + normalized tags', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { item: { id: 'k1', title: 'T' } },
    })
    const item = await useKnowledge().addItem({
      title: '  T  ',
      content: 'body',
      tags: ['a', '', null, 'b'],
      type: 'note',
    })
    expect(sendRaw).toHaveBeenCalledWith(
      {
        type: 'knowledge.add-item',
        item: { title: 'T', content: 'body', tags: ['a', 'b'], type: 'note' },
      },
      20000,
    )
    expect(item).toEqual({ id: 'k1', title: 'T' })
    expect(execute).not.toHaveBeenCalled()
  })

  it('returns null when the handler omits the item', async () => {
    sendRaw.mockResolvedValueOnce({ ok: true, result: {} })
    expect(
      await useKnowledge().addItem({ title: 't', content: 'c' }),
    ).toBeNull()
  })

  it('throws on success:false', async () => {
    sendRaw.mockResolvedValueOnce({
      ok: true,
      result: { success: false, error: 'db-locked' },
    })
    await expect(
      useKnowledge().addItem({ title: 't', content: 'c' }),
    ).rejects.toThrow(/db-locked/)
  })
})

describe('useKnowledge — browser fallback (note add)', () => {
  it('builds a shell-quoted `note add` command with tags', async () => {
    execute.mockResolvedValueOnce({ output: 'note added: id=42' })
    const out = await useKnowledge().addItem({
      title: 'Title',
      content: 'the body',
      tags: ['素材', 'x'],
    })
    expect(execute).toHaveBeenCalledWith(
      'note add "Title" -c "the body" -t "素材,x"',
      15000,
    )
    expect(out).toEqual({
      title: 'Title',
      content: 'the body',
      tags: ['素材', 'x'],
      type: 'note',
    })
    expect(sendRaw).not.toHaveBeenCalled()
  })

  it('omits the -t flag when there are no tags', async () => {
    execute.mockResolvedValueOnce({ output: 'ok' })
    await useKnowledge().addItem({ title: 't', content: 'c' })
    expect(execute).toHaveBeenCalledWith('note add "t" -c "c"', 15000)
  })

  it('escapes embedded quotes and backslashes', async () => {
    execute.mockResolvedValueOnce({ output: 'ok' })
    await useKnowledge().addItem({ title: 'a"b\\c', content: 'd"e' })
    expect(execute).toHaveBeenCalledWith(
      'note add "a\\"b\\\\c" -c "d\\"e"',
      15000,
    )
  })

  it('throws when the CLI output signals an error', async () => {
    execute.mockResolvedValueOnce({ output: '✖ failed to add note' })
    await expect(
      useKnowledge().addItem({ title: 't', content: 'c' }),
    ).rejects.toThrow(/failed to add note/)
    execute.mockResolvedValueOnce({ output: 'Error: boom' })
    await expect(
      useKnowledge().addItem({ title: 't', content: 'c' }),
    ).rejects.toThrow(/Error: boom/)
  })
})
