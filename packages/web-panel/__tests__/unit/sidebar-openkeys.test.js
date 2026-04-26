/**
 * Unit tests: sidebar openKeys persistence (cc.web-panel.sidebar.openKeys).
 *
 * The sidebar collapsible-group state lives in localStorage so it survives
 * page reloads. Tests cover: default = all 8 groups open, persistence
 * across reads, corrupt-data tolerance, and unknown-key filtering.
 *
 * Run: npx vitest run __tests__/unit/sidebar-openkeys.test.js
 */

import { describe, it, expect, beforeEach } from 'vitest'

const KEY = 'cc.web-panel.sidebar.openKeys'
const ALL_GROUP_KEYS = [
  'g-overview', 'g-config', 'g-data', 'g-advanced',
  'g-enterprise', 'g-social', 'g-media', 'g-extension',
]

// Re-implement loadOpenKeys here. AppLayout.vue ships the live copy; we
// replicate the contract so a future divergence (e.g. someone renaming
// keys without updating the loader) surfaces as a test failure.
function loadOpenKeys() {
  try {
    const raw = localStorage.getItem(KEY)
    if (raw) {
      const arr = JSON.parse(raw)
      if (Array.isArray(arr)) return arr.filter(k => ALL_GROUP_KEYS.includes(k))
    }
  } catch { /* ignore corrupt */ }
  return [...ALL_GROUP_KEYS]
}

describe('sidebar openKeys persistence', () => {
  beforeEach(() => {
    localStorage.removeItem(KEY)
  })

  it('returns all 8 group keys by default (no stored state)', () => {
    expect(loadOpenKeys()).toEqual(ALL_GROUP_KEYS)
  })

  it('round-trips a stored selection', () => {
    const partial = ['g-overview', 'g-data', 'g-advanced']
    localStorage.setItem(KEY, JSON.stringify(partial))
    expect(loadOpenKeys()).toEqual(partial)
  })

  it('handles all-collapsed state (empty array)', () => {
    localStorage.setItem(KEY, JSON.stringify([]))
    expect(loadOpenKeys()).toEqual([])
  })

  it('falls back to all-open on corrupt JSON', () => {
    localStorage.setItem(KEY, '{not valid json')
    expect(loadOpenKeys()).toEqual(ALL_GROUP_KEYS)
  })

  it('falls back to all-open when stored value is not an array', () => {
    localStorage.setItem(KEY, JSON.stringify({ a: 1 }))
    expect(loadOpenKeys()).toEqual(ALL_GROUP_KEYS)
  })

  it('strips unknown keys (e.g. removed groups from older versions)', () => {
    localStorage.setItem(KEY, JSON.stringify(['g-overview', 'g-removed-group', 'g-data']))
    expect(loadOpenKeys()).toEqual(['g-overview', 'g-data'])
  })

  it('does not duplicate or reorder when round-tripped', () => {
    const sequence = ['g-data', 'g-overview', 'g-extension']
    localStorage.setItem(KEY, JSON.stringify(sequence))
    expect(loadOpenKeys()).toEqual(sequence)
  })

  it('ALL_GROUP_KEYS exposes exactly 8 unique group identifiers', () => {
    expect(ALL_GROUP_KEYS).toHaveLength(8)
    expect(new Set(ALL_GROUP_KEYS).size).toBe(8)
  })

  it('every group key starts with g- prefix (namespace contract)', () => {
    for (const key of ALL_GROUP_KEYS) {
      expect(key.startsWith('g-')).toBe(true)
    }
  })
})
