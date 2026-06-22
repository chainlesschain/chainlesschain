/**
 * Unit tests for src/composables/useShellMode.js
 *
 * useShellMode is the single source of truth for "what runtime hosts the SPA"
 * (embedded desktop web-shell vs plain browser) and the WS host/port/mode
 * defaults. A wrong embedded-detection mis-routes the whole panel, so the
 * type-guarded defaulting is pinned here. It re-reads window.__CC_CONFIG__ on
 * every call, so tests just mutate the global and call again.
 *
 * Run: npx vitest run __tests__/unit/useShellMode.test.js
 */

import { describe, it, expect, afterEach } from 'vitest'
import { useShellMode } from '../../src/composables/useShellMode.js'

afterEach(() => {
  delete window.__CC_CONFIG__
})

describe('useShellMode — defaults', () => {
  it('falls back to browser mode + default WS host/port when no config', () => {
    const s = useShellMode()
    expect(s.isEmbedded).toBe(false)
    expect(s.wsHost).toBe('127.0.0.1')
    expect(s.wsPort).toBe(18800)
    expect(s.mode).toBe('global')
    expect(s.projectRoot).toBe(null)
    expect(s.projectName).toBe(null)
  })
})

describe('useShellMode — embedded detection', () => {
  it('is embedded only when embeddedShell is strictly true', () => {
    window.__CC_CONFIG__ = { embeddedShell: true }
    expect(useShellMode().isEmbedded).toBe(true)
  })

  it('is not embedded for truthy-but-not-true values', () => {
    window.__CC_CONFIG__ = { embeddedShell: 'true' }
    expect(useShellMode().isEmbedded).toBe(false)
    window.__CC_CONFIG__ = { embeddedShell: 1 }
    expect(useShellMode().isEmbedded).toBe(false)
  })
})

describe('useShellMode — typed fields', () => {
  it('uses injected wsHost/wsPort only when the right type', () => {
    window.__CC_CONFIG__ = { wsHost: '10.0.0.5', wsPort: 9000 }
    const s = useShellMode()
    expect(s.wsHost).toBe('10.0.0.5')
    expect(s.wsPort).toBe(9000)
  })

  it('rejects mistyped wsHost/wsPort and uses defaults', () => {
    window.__CC_CONFIG__ = { wsHost: 123, wsPort: '9000' }
    const s = useShellMode()
    expect(s.wsHost).toBe('127.0.0.1')
    expect(s.wsPort).toBe(18800)
  })

  it("maps mode to 'project' only on exact match, else 'global'", () => {
    window.__CC_CONFIG__ = { mode: 'project' }
    expect(useShellMode().mode).toBe('project')
    window.__CC_CONFIG__ = { mode: 'something' }
    expect(useShellMode().mode).toBe('global')
  })

  it('keeps string projectRoot/projectName, nulls otherwise', () => {
    window.__CC_CONFIG__ = { projectRoot: '/p', projectName: 'Acme' }
    let s = useShellMode()
    expect(s.projectRoot).toBe('/p')
    expect(s.projectName).toBe('Acme')

    window.__CC_CONFIG__ = { projectRoot: 42, projectName: {} }
    s = useShellMode()
    expect(s.projectRoot).toBe(null)
    expect(s.projectName).toBe(null)
  })

  it('exposes the raw config snapshot', () => {
    const cfg = { embeddedShell: true, extra: 'x' }
    window.__CC_CONFIG__ = cfg
    expect(useShellMode().config).toBe(cfg)
  })
})

describe('useShellMode — re-reads on each call', () => {
  it('reflects a mutated global without caching', () => {
    expect(useShellMode().isEmbedded).toBe(false)
    window.__CC_CONFIG__ = { embeddedShell: true }
    expect(useShellMode().isEmbedded).toBe(true)
  })
})
