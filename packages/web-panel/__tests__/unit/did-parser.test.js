/**
 * Unit tests for src/utils/did-parser.js
 *
 * Run: npx vitest run __tests__/unit/did-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseDidList,
  parseDidListText,
  parseDidShow,
  parseSignResult,
  parseDidExport,
} from '../../src/utils/did-parser.js'

// ─── parseDidList ─────────────────────────────────────────────────────────────

describe('parseDidList', () => {
  it('returns empty array for empty input', () => {
    expect(parseDidList('')).toEqual([])
  })

  it('returns empty array for non-JSON, non-list garbage', () => {
    expect(parseDidList('error: db locked')).toEqual([])
  })

  it('parses a JSON array from `did list --json`', () => {
    const json = JSON.stringify([
      { did: 'did:chainless:abc', displayName: 'alice', isDefault: true, createdAt: '2026-04-21' },
      { did: 'did:chainless:def', displayName: null, isDefault: false, createdAt: '2026-04-22' },
    ])
    const list = parseDidList(json)
    expect(list).toHaveLength(2)
    expect(list[0].did).toBe('did:chainless:abc')
    expect(list[0].displayName).toBe('alice')
    expect(list[0].isDefault).toBe(true)
    expect(list[0].method).toBe('chainless')
    expect(list[1].displayName).toBe('')
    expect(list[1].isDefault).toBe(false)
  })

  it('handles snake_case fields from older CLI versions', () => {
    const json = JSON.stringify([
      { did: 'did:key:xyz', display_name: 'bob', is_default: 1, created_at: '2026-04-20' },
    ])
    const [item] = parseDidList(json)
    expect(item.displayName).toBe('bob')
    expect(item.isDefault).toBe(true)
    expect(item.createdAt).toBe('2026-04-20')
    expect(item.method).toBe('key')
  })

  it('extracts JSON embedded in surrounding text', () => {
    const out = `Loaded 1 identity:\n[{"did":"did:chainless:zzz","isDefault":false}]\nDone.`
    const list = parseDidList(out)
    expect(list).toHaveLength(1)
    expect(list[0].did).toBe('did:chainless:zzz')
  })

  it('handles a wrapper object with `identities` field', () => {
    const out = JSON.stringify({
      identities: [{ did: 'did:chainless:wrapped', isDefault: true }],
    })
    const list = parseDidList(out)
    expect(list).toHaveLength(1)
    expect(list[0].did).toBe('did:chainless:wrapped')
  })

  it('falls back to text parser when input is not JSON', () => {
    const text =
      'DID Identities (1):\n\n  did:chainless:txt123 (alice) [default]\n    created: 2026-04-21 10:00:00'
    const list = parseDidList(text)
    expect(list).toHaveLength(1)
    expect(list[0].did).toBe('did:chainless:txt123')
    expect(list[0].displayName).toBe('alice')
    expect(list[0].isDefault).toBe(true)
    expect(list[0].createdAt).toBe('2026-04-21 10:00:00')
  })

  it('skips entries without a did', () => {
    const json = JSON.stringify([{ displayName: 'orphan' }, { did: 'did:chainless:ok' }])
    const list = parseDidList(json)
    expect(list).toHaveLength(1)
    expect(list[0].did).toBe('did:chainless:ok')
  })
})

// ─── parseDidListText ─────────────────────────────────────────────────────────

describe('parseDidListText', () => {
  it('returns empty array for empty input', () => {
    expect(parseDidListText('')).toEqual([])
  })

  it('parses two identities with [default] marker', () => {
    const text = [
      'DID Identities (2):',
      '',
      '  did:chainless:aaa (alice) [default]',
      '    created: 2026-04-21 10:00:00',
      '  did:chainless:bbb',
      '    created: 2026-04-22 12:30:00',
    ].join('\n')
    const list = parseDidListText(text)
    expect(list).toHaveLength(2)
    expect(list[0].did).toBe('did:chainless:aaa')
    expect(list[0].displayName).toBe('alice')
    expect(list[0].isDefault).toBe(true)
    expect(list[1].did).toBe('did:chainless:bbb')
    expect(list[1].isDefault).toBe(false)
  })

  it('skips separator lines', () => {
    const text = '─────\n  did:chainless:xx\n    created: 2026-04-22'
    const list = parseDidListText(text)
    expect(list).toHaveLength(1)
  })

  it('detects default by Chinese marker 默认', () => {
    const text = '  did:chainless:cn 默认\n    created: 2026-04-22'
    const list = parseDidListText(text)
    expect(list[0].isDefault).toBe(true)
  })
})

// ─── parseDidShow ─────────────────────────────────────────────────────────────

describe('parseDidShow', () => {
  it('returns null for empty input', () => {
    expect(parseDidShow('')).toBeNull()
  })

  it('returns null for non-object JSON', () => {
    expect(parseDidShow('[1,2,3]')).toBeNull()
  })

  it('parses full identity JSON with document', () => {
    const json = JSON.stringify({
      did: 'did:chainless:abc',
      displayName: 'alice',
      publicKey: 'aabbcc',
      isDefault: true,
      document: { id: 'did:chainless:abc', '@context': ['https://www.w3.org/ns/did/v1'] },
      createdAt: '2026-04-21',
    })
    const detail = parseDidShow(json)
    expect(detail.did).toBe('did:chainless:abc')
    expect(detail.publicKey).toBe('aabbcc')
    expect(detail.document).toEqual({
      id: 'did:chainless:abc',
      '@context': ['https://www.w3.org/ns/did/v1'],
    })
  })

  it('returns null when did field is missing', () => {
    expect(parseDidShow('{"displayName":"orphan"}')).toBeNull()
  })
})

// ─── parseSignResult ──────────────────────────────────────────────────────────

describe('parseSignResult', () => {
  it('returns null for empty input', () => {
    expect(parseSignResult('')).toBeNull()
  })

  it('parses JSON output from `did sign --json`', () => {
    const json = JSON.stringify({
      did: 'did:chainless:abc',
      message: 'hello',
      signature: 'deadbeef0123',
    })
    const r = parseSignResult(json)
    expect(r).toEqual({ did: 'did:chainless:abc', message: 'hello', signature: 'deadbeef0123' })
  })

  it('falls back to text "Signature: <hex>" pattern', () => {
    const r = parseSignResult('Message signed\n  Signature: 0123abcdef\n')
    expect(r).not.toBeNull()
    expect(r.signature).toBe('0123abcdef')
  })

  it('returns null when no signature present', () => {
    expect(parseSignResult('Failed to sign')).toBeNull()
  })
})

// ─── parseDidExport ───────────────────────────────────────────────────────────

describe('parseDidExport', () => {
  it('returns null for empty input', () => {
    expect(parseDidExport('')).toBeNull()
  })

  it('returns null for array JSON', () => {
    expect(parseDidExport('[]')).toBeNull()
  })

  it('parses exported identity object', () => {
    const json = JSON.stringify({
      did: 'did:chainless:abc',
      displayName: 'alice',
      publicKey: 'aabbcc',
      document: { id: 'did:chainless:abc' },
      createdAt: '2026-04-21',
    })
    const r = parseDidExport(json)
    expect(r.did).toBe('did:chainless:abc')
    expect(r.publicKey).toBe('aabbcc')
  })
})
