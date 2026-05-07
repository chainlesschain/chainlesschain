/**
 * useMtcArchive composable tests.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

import { useWsStore } from '../../src/stores/ws.js'
import { useMtcArchive } from '../../src/composables/useMtcArchive.js'

function setEmbedded(embedded) {
  if (typeof window === 'undefined') globalThis.window = {}
  window.__CC_CONFIG__ = { embeddedShell: !!embedded }
}

describe('useMtcArchive', () => {
  let sendRawMock

  beforeEach(() => {
    setActivePinia(createPinia())
    sendRawMock = vi.fn()
    useWsStore().sendRaw = sendRawMock
    setEmbedded(true)
  })

  describe('listArchives', () => {
    it('returns + caches archive list on success', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: true, archives: ['a.zip', 'b.zip'] },
      })
      const { archives, listArchives } = useMtcArchive()
      const r = await listArchives('c', { kind: 'filesystem', rootDir: '/x' })
      expect(r).toEqual(['a.zip', 'b.zip'])
      expect(archives.value).toEqual(['a.zip', 'b.zip'])
      const args = sendRawMock.mock.calls[0][0]
      expect(args.type).toBe('mtc.archive.list')
      expect(args.communityId).toBe('c')
    })

    it('rejects empty communityId', async () => {
      const { listArchives, errorMessage } = useMtcArchive()
      const r = await listArchives('', { kind: 'filesystem' })
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/communityId/)
    })

    it('captures handler error envelope', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: false, error: 'provider unauthorized' },
      })
      const { listArchives, errorMessage } = useMtcArchive()
      const r = await listArchives('c', { kind: 'webdav' })
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/unauthorized/)
    })
  })

  describe('pushArchive', () => {
    it('returns push result + caches lastResult', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: {
          success: true,
          result: { ok: true, name: 'a.zip', bytes: 1024 },
        },
      })
      const { lastResult, pushArchive } = useMtcArchive()
      const r = await pushArchive('c', { kind: 'filesystem', rootDir: '/x' })
      expect(r.name).toBe('a.zip')
      expect(lastResult.value.name).toBe('a.zip')
    })

    it('forwards packOpts including sinceBatchId', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: true, result: {} },
      })
      const { pushArchive } = useMtcArchive()
      await pushArchive('c', { kind: 'filesystem', rootDir: '/x' }, { sinceBatchId: '000003' })
      const args = sendRawMock.mock.calls[0][0]
      expect(args.packOpts).toEqual({ sinceBatchId: '000003' })
    })

    it('captures error on success:false', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: false, error: 'nothing to archive' },
      })
      const { pushArchive, errorMessage } = useMtcArchive()
      const r = await pushArchive('c', { kind: 'filesystem' })
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/nothing/)
    })
  })

  describe('restoreArchive', () => {
    it('happy path', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: true, result: { ok: true, restored: 7, skipped: 0 } },
      })
      const { restoreArchive } = useMtcArchive()
      const r = await restoreArchive('c', 'a.zip', { kind: 'filesystem' })
      expect(r.restored).toBe(7)
    })

    it('rejects missing archiveName', async () => {
      const { restoreArchive, errorMessage } = useMtcArchive()
      const r = await restoreArchive('c', '', { kind: 'filesystem' })
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/archiveName/)
    })
  })

  it('isEmbedded reflects shell mode', () => {
    setEmbedded(false)
    const { isEmbedded } = useMtcArchive()
    expect(isEmbedded).toBe(false)
  })

  describe('checkStoredWebdavCredentials (B4-cred-persist v1)', () => {
    it('updates flag to true when vault has credentials', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: true, hasCredentials: true },
      })
      const { hasStoredWebdavCredentials, checkStoredWebdavCredentials } =
        useMtcArchive()
      const r = await checkStoredWebdavCredentials()
      expect(r).toBe(true)
      expect(hasStoredWebdavCredentials.value).toBe(true)
      const args = sendRawMock.mock.calls[0][0]
      expect(args.type).toBe('mtc.archive.has-stored-webdav-credentials')
      // Critical: the request payload itself must not carry any cred fields
      expect(args).not.toHaveProperty('password')
      expect(args).not.toHaveProperty('url')
      expect(args).not.toHaveProperty('username')
    })

    it('updates flag to false when vault empty', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: true, hasCredentials: false },
      })
      const { hasStoredWebdavCredentials, checkStoredWebdavCredentials } =
        useMtcArchive()
      const r = await checkStoredWebdavCredentials()
      expect(r).toBe(false)
      expect(hasStoredWebdavCredentials.value).toBe(false)
    })

    it('treats handler error as "unknown / disabled" (false), not hard failure', async () => {
      sendRawMock.mockResolvedValue({
        ok: true,
        result: { success: false, error: 'syncCredentials not injected' },
      })
      const { hasStoredWebdavCredentials, checkStoredWebdavCredentials } =
        useMtcArchive()
      const r = await checkStoredWebdavCredentials()
      // pure-browser / pre-init shells legitimately can't probe; we only
      // want to disable the toggle, not blow up the page
      expect(r).toBe(false)
      expect(hasStoredWebdavCredentials.value).toBe(false)
    })

    it('returns null on transport error', async () => {
      sendRawMock.mockRejectedValue(new Error('ws closed'))
      const { hasStoredWebdavCredentials, checkStoredWebdavCredentials, errorMessage } =
        useMtcArchive()
      const r = await checkStoredWebdavCredentials()
      expect(r).toBeNull()
      expect(errorMessage.value).toMatch(/ws closed/)
      expect(hasStoredWebdavCredentials.value).toBe(false)
    })
  })
})
