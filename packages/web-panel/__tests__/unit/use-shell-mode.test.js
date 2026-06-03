/**
 * useShellMode composable — unit tests.
 *
 * The composable reads window.__CC_CONFIG__ on every call (no caching),
 * so tests just mutate the global and re-call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'

import { useShellMode } from '../../src/composables/useShellMode.js'

beforeEach(() => {
  globalThis.window = globalThis.window || globalThis
  globalThis.window.__CC_CONFIG__ = {}
})

afterEach(() => {
  delete globalThis.window.__CC_CONFIG__
})

describe('useShellMode', () => {
  it('reports isEmbedded:false when __CC_CONFIG__ is empty', () => {
    expect(useShellMode().isEmbedded).toBe(false)
  })

  it('reports isEmbedded:true only when embeddedShell === true (strict)', () => {
    globalThis.window.__CC_CONFIG__ = { embeddedShell: true }
    expect(useShellMode().isEmbedded).toBe(true)

    globalThis.window.__CC_CONFIG__ = { embeddedShell: 'true' }
    expect(useShellMode().isEmbedded).toBe(false)

    globalThis.window.__CC_CONFIG__ = { embeddedShell: 1 }
    expect(useShellMode().isEmbedded).toBe(false)
  })

  it('exposes default wsHost / wsPort when missing', () => {
    const m = useShellMode()
    expect(m.wsHost).toBe('127.0.0.1')
    expect(m.wsPort).toBe(18800)
  })

  it('passes through wsHost / wsPort when set', () => {
    globalThis.window.__CC_CONFIG__ = { wsHost: '0.0.0.0', wsPort: 12345 }
    const m = useShellMode()
    expect(m.wsHost).toBe('0.0.0.0')
    expect(m.wsPort).toBe(12345)
  })

  it('falls back to global when mode is missing or invalid', () => {
    expect(useShellMode().mode).toBe('global')

    globalThis.window.__CC_CONFIG__ = { mode: 'project' }
    expect(useShellMode().mode).toBe('project')

    globalThis.window.__CC_CONFIG__ = { mode: 'unknown' }
    expect(useShellMode().mode).toBe('global')
  })

  it('reports null projectRoot / projectName by default', () => {
    const m = useShellMode()
    expect(m.projectRoot).toBeNull()
    expect(m.projectName).toBeNull()
  })

  it('passes through projectRoot / projectName when set', () => {
    globalThis.window.__CC_CONFIG__ = {
      projectRoot: '/tmp/foo',
      projectName: 'foo',
    }
    const m = useShellMode()
    expect(m.projectRoot).toBe('/tmp/foo')
    expect(m.projectName).toBe('foo')
  })

  it('exposes raw config snapshot for any consumer that needs the full surface', () => {
    globalThis.window.__CC_CONFIG__ = { embeddedShell: true, custom: 'x' }
    expect(useShellMode().config.custom).toBe('x')
  })

  it('does not throw when window is undefined (SSR-safe)', () => {
    const original = globalThis.window
    delete globalThis.window
    expect(() => useShellMode()).not.toThrow()
    expect(useShellMode().isEmbedded).toBe(false)
    expect(useShellMode().wsHost).toBe('127.0.0.1')
    globalThis.window = original
  })
})
