/**
 * Unit tests for src/utils/project-settings-parser.js
 *
 * Run: npx vitest run __tests__/unit/project-settings-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseProjectConfig,
  diffProjectConfig,
  PROJECT_DEFAULTS,
} from '../../src/utils/project-settings-parser.js'

// ─── parseProjectConfig ───────────────────────────────────────────────────────

describe('parseProjectConfig', () => {
  it('returns defaults for empty input', () => {
    expect(parseProjectConfig('')).toEqual(PROJECT_DEFAULTS)
  })

  it('returns defaults when key not found', () => {
    expect(parseProjectConfig('Key not found: project')).toEqual(PROJECT_DEFAULTS)
  })

  it('parses full JSON object dump', () => {
    const json = JSON.stringify({
      rootPath: '/home/user/projects',
      maxSizeMB: 2000,
      autoSync: true,
      syncIntervalSeconds: 600,
    })
    const r = parseProjectConfig(json)
    expect(r.rootPath).toBe('/home/user/projects')
    expect(r.maxSizeMB).toBe(2000)
    expect(r.autoSync).toBe(true)
    expect(r.syncIntervalSeconds).toBe(600)
  })

  it('falls back to defaults for missing fields in JSON', () => {
    const json = JSON.stringify({ rootPath: '/x' })
    const r = parseProjectConfig(json)
    expect(r.rootPath).toBe('/x')
    expect(r.maxSizeMB).toBe(PROJECT_DEFAULTS.maxSizeMB)
    expect(r.autoSync).toBe(PROJECT_DEFAULTS.autoSync)
    expect(r.syncIntervalSeconds).toBe(PROJECT_DEFAULTS.syncIntervalSeconds)
  })

  it('coerces string number to number', () => {
    const json = JSON.stringify({ maxSizeMB: '500', syncIntervalSeconds: '120' })
    const r = parseProjectConfig(json)
    expect(r.maxSizeMB).toBe(500)
    expect(r.syncIntervalSeconds).toBe(120)
  })

  it('coerces "true"/"false" strings to boolean', () => {
    expect(parseProjectConfig(JSON.stringify({ autoSync: 'true' })).autoSync).toBe(true)
    expect(parseProjectConfig(JSON.stringify({ autoSync: 'false' })).autoSync).toBe(false)
    expect(parseProjectConfig(JSON.stringify({ autoSync: '1' })).autoSync).toBe(true)
    expect(parseProjectConfig(JSON.stringify({ autoSync: 'no' })).autoSync).toBe(false)
  })

  it('handles invalid number by falling back to default', () => {
    const json = JSON.stringify({ maxSizeMB: 'not-a-number' })
    expect(parseProjectConfig(json).maxSizeMB).toBe(PROJECT_DEFAULTS.maxSizeMB)
  })

  it('parses single scalar line "rootPath = /x"', () => {
    expect(parseProjectConfig('rootPath = /tmp/p').rootPath).toBe('/tmp/p')
  })

  it('parses scalar line with project. prefix', () => {
    expect(parseProjectConfig('project.maxSizeMB = 750').maxSizeMB).toBe(750)
  })

  it('parses multiple scalar lines', () => {
    const text = [
      'project.rootPath = /home/work',
      'project.maxSizeMB = 1500',
      'project.autoSync = true',
      'project.syncIntervalSeconds = 90',
    ].join('\n')
    const r = parseProjectConfig(text)
    expect(r.rootPath).toBe('/home/work')
    expect(r.maxSizeMB).toBe(1500)
    expect(r.autoSync).toBe(true)
    expect(r.syncIntervalSeconds).toBe(90)
  })

  it('returns defaults for JSON array (wrong shape)', () => {
    expect(parseProjectConfig('[1,2,3]')).toEqual(PROJECT_DEFAULTS)
  })

  it('extracts JSON embedded in surrounding text', () => {
    const text = `Loaded:\n${JSON.stringify({ rootPath: '/x' })}\nDone.`
    expect(parseProjectConfig(text).rootPath).toBe('/x')
  })

  it('coerces empty rootPath to empty string (not "null")', () => {
    expect(parseProjectConfig(JSON.stringify({ rootPath: null })).rootPath).toBe('')
    expect(parseProjectConfig(JSON.stringify({ rootPath: '' })).rootPath).toBe('')
  })
})

// ─── diffProjectConfig ────────────────────────────────────────────────────────

describe('diffProjectConfig', () => {
  it('returns empty object when nothing changed', () => {
    const d = diffProjectConfig(PROJECT_DEFAULTS, { ...PROJECT_DEFAULTS })
    expect(d).toEqual({})
  })

  it('returns only the changed keys', () => {
    const baseline = { ...PROJECT_DEFAULTS, rootPath: '/old' }
    const current = { ...baseline, rootPath: '/new', maxSizeMB: 5000 }
    const d = diffProjectConfig(baseline, current)
    expect(d).toEqual({ rootPath: '/new', maxSizeMB: 5000 })
  })

  it('detects boolean toggle', () => {
    const baseline = { ...PROJECT_DEFAULTS, autoSync: false }
    const current = { ...baseline, autoSync: true }
    expect(diffProjectConfig(baseline, current)).toEqual({ autoSync: true })
  })

  it('ignores keys not in PROJECT_DEFAULTS schema', () => {
    const baseline = { ...PROJECT_DEFAULTS }
    const current = { ...PROJECT_DEFAULTS, extraneous: 'ignored' }
    expect(diffProjectConfig(baseline, current)).toEqual({})
  })

  it('detects all 4 fields changing simultaneously', () => {
    const baseline = { ...PROJECT_DEFAULTS }
    const current = {
      rootPath: '/p',
      maxSizeMB: 9999,
      autoSync: true,
      syncIntervalSeconds: 3600,
    }
    const d = diffProjectConfig(baseline, current)
    expect(Object.keys(d)).toHaveLength(4)
    expect(d.rootPath).toBe('/p')
    expect(d.maxSizeMB).toBe(9999)
    expect(d.autoSync).toBe(true)
    expect(d.syncIntervalSeconds).toBe(3600)
  })
})

// ─── PROJECT_DEFAULTS ─────────────────────────────────────────────────────────

describe('PROJECT_DEFAULTS', () => {
  it('exposes the 4 expected keys', () => {
    expect(Object.keys(PROJECT_DEFAULTS).sort()).toEqual(
      ['autoSync', 'maxSizeMB', 'rootPath', 'syncIntervalSeconds']
    )
  })

  it('is frozen (immutable defaults)', () => {
    expect(Object.isFrozen(PROJECT_DEFAULTS)).toBe(true)
  })
})
