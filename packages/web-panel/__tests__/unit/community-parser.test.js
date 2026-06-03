/**
 * Unit tests for src/utils/community-parser.js
 *
 * Run: npx vitest run __tests__/unit/community-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  stripCliNoise,
  parseSocialStats,
  parseContacts,
  parseFriends,
  parsePosts,
  parsePublishedPost,
  parseAddedContact,
  STATS_DEFAULTS,
} from '../../src/utils/community-parser.js'

// Reproduce the noise headers the CLI bootstrap actually emits, so the
// test reflects production output not synthetic input.
const NOISE_PREAMBLE = [
  '[AppConfig] Configuration loaded',
  '[DatabaseManager] better-sqlite3-multiple-ciphers unusable',
  '[DatabaseManager] Using better-sqlite3 (no encryption)',
  '[DatabaseManager] Database initialized: C:\\Users\\x\\db',
].join('\n')

const NOISE_TRAILER = '[DatabaseManager] Database closed'

function withNoise(jsonBody) {
  return `${NOISE_PREAMBLE}\n${jsonBody}\n${NOISE_TRAILER}`
}

// ─── stripCliNoise ────────────────────────────────────────────────────────────

describe('stripCliNoise', () => {
  it('returns empty string for empty input', () => {
    expect(stripCliNoise('')).toBe('')
    expect(stripCliNoise(null)).toBe('')
    expect(stripCliNoise(undefined)).toBe('')
  })

  it('drops [Tag] bootstrap noise prefixes', () => {
    const input = '[AppConfig] Config loaded\n[DatabaseManager] Init\n{"x":1}'
    expect(stripCliNoise(input)).toBe('{"x":1}')
  })

  it('drops status icon prefixes (✖ ✓ ℹ ⚠)', () => {
    const input = '✖ Failed: db locked\n✓ Done\nreal output'
    expect(stripCliNoise(input)).toBe('real output')
  })

  it('preserves lines that begin with [ but are not a noise prefix', () => {
    // JSON arrays must survive
    expect(stripCliNoise('[]')).toBe('[]')
    expect(stripCliNoise('[1,2,3]')).toBe('[1,2,3]')
  })

  it('preserves multiline JSON bodies between noise lines', () => {
    const json = '{\n  "contacts": 0,\n  "friends": 1\n}'
    const cleaned = stripCliNoise(withNoise(json))
    expect(cleaned).toBe(json)
  })
})

// ─── parseSocialStats ────────────────────────────────────────────────────────

describe('parseSocialStats', () => {
  it('returns defaults for empty / non-JSON output', () => {
    expect(parseSocialStats('')).toEqual(STATS_DEFAULTS)
    expect(parseSocialStats('error: db locked')).toEqual(STATS_DEFAULTS)
  })

  it('parses a clean JSON payload', () => {
    const json = JSON.stringify({
      contacts: 5,
      friends: 3,
      posts: 12,
      messages: 41,
      pendingRequests: 2,
    })
    expect(parseSocialStats(json)).toEqual({
      contacts: 5,
      friends: 3,
      posts: 12,
      messages: 41,
      pendingRequests: 2,
    })
  })

  it('parses a payload wrapped in CLI bootstrap noise', () => {
    const json = JSON.stringify({ contacts: 7, friends: 0, posts: 0, messages: 0, pendingRequests: 0 })
    const stats = parseSocialStats(withNoise(json))
    expect(stats.contacts).toBe(7)
  })

  it('falls back to defaults for missing fields', () => {
    const stats = parseSocialStats(JSON.stringify({ contacts: 4 }))
    expect(stats.contacts).toBe(4)
    expect(stats.friends).toBe(0)
    expect(stats.posts).toBe(0)
  })

  it('accepts snake_case pending_requests fallback', () => {
    const json = JSON.stringify({ pending_requests: 9 })
    expect(parseSocialStats(json).pendingRequests).toBe(9)
  })

  it('ignores non-numeric or non-finite values', () => {
    const json = JSON.stringify({ contacts: 'abc', friends: NaN, posts: null })
    expect(parseSocialStats(json)).toEqual(STATS_DEFAULTS)
  })

  it('does not treat JSON arrays as a stats object', () => {
    expect(parseSocialStats('[]')).toEqual(STATS_DEFAULTS)
  })
})

// ─── parseContacts ───────────────────────────────────────────────────────────

describe('parseContacts', () => {
  it('returns empty array for empty / non-array output', () => {
    expect(parseContacts('')).toEqual([])
    expect(parseContacts('{}')).toEqual([])
  })

  it('parses a clean array', () => {
    const json = JSON.stringify([
      { id: 'c1', name: 'alice', did: 'did:key:abc', email: 'a@x.com', notes: 'n', createdAt: '2026-04-26' },
      { id: 'c2', name: 'bob' },
    ])
    const list = parseContacts(json)
    expect(list).toHaveLength(2)
    expect(list[0].id).toBe('c1')
    expect(list[0].name).toBe('alice')
    expect(list[0].did).toBe('did:key:abc')
    expect(list[1].name).toBe('bob')
    expect(list[1].did).toBe('')
    expect(list[1].email).toBe('')
  })

  it('survives CLI noise around the JSON array', () => {
    const json = JSON.stringify([{ id: 'c1', name: 'alice' }])
    expect(parseContacts(withNoise(json))).toHaveLength(1)
  })

  it('parses an empty array', () => {
    expect(parseContacts(withNoise('[]'))).toEqual([])
  })

  it('falls back to snake_case created_at + contact_id', () => {
    const json = JSON.stringify([
      { contact_id: 'c9', name: 'eve', created_at: '2026-04-25' },
    ])
    const [c] = parseContacts(json)
    expect(c.id).toBe('c9')
    expect(c.createdAt).toBe('2026-04-25')
  })

  it('drops entries without an id', () => {
    const json = JSON.stringify([{ name: 'no-id' }, { id: 'c1', name: 'ok' }])
    const list = parseContacts(json)
    expect(list).toHaveLength(1)
    expect(list[0].id).toBe('c1')
  })

  it('uses the contact id as the row key for ant-design tables', () => {
    const json = JSON.stringify([{ id: 'c1', name: 'a' }, { id: 'c2', name: 'b' }])
    const list = parseContacts(json)
    expect(list[0].key).toBe('c1')
    expect(list[1].key).toBe('c2')
  })
})

// ─── parseFriends ────────────────────────────────────────────────────────────

describe('parseFriends', () => {
  it('returns empty array for empty output', () => {
    expect(parseFriends('')).toEqual([])
  })

  it('parses a clean array of friend records', () => {
    const json = JSON.stringify([
      { id: 'f1', contactId: 'c1', status: 'accepted', createdAt: '2026-04-26' },
      { id: 'f2', contactId: 'c2', status: 'pending' },
    ])
    const list = parseFriends(json)
    expect(list).toHaveLength(2)
    expect(list[0].contactId).toBe('c1')
    expect(list[0].status).toBe('accepted')
    expect(list[1].status).toBe('pending')
  })

  it('falls back to contact_id snake_case', () => {
    const json = JSON.stringify([{ contact_id: 'c5', status: 'pending' }])
    const [f] = parseFriends(json)
    expect(f.contactId).toBe('c5')
  })

  it('defaults status to pending when missing', () => {
    const json = JSON.stringify([{ contactId: 'c1' }])
    expect(parseFriends(json)[0].status).toBe('pending')
  })

  it('drops entries without a contact id', () => {
    const json = JSON.stringify([{ status: 'pending' }, { contactId: 'c1' }])
    expect(parseFriends(json)).toHaveLength(1)
  })
})

// ─── parsePosts ──────────────────────────────────────────────────────────────

describe('parsePosts', () => {
  it('returns empty array for empty output', () => {
    expect(parsePosts('')).toEqual([])
  })

  it('parses a clean post array', () => {
    const json = JSON.stringify([
      { id: 'p1', author: 'alice', content: 'hello', likes: 3, createdAt: '2026-04-26' },
      { id: 'p2', author: 'bob', content: 'world', likes: 0 },
    ])
    const list = parsePosts(json)
    expect(list).toHaveLength(2)
    expect(list[0].author).toBe('alice')
    expect(list[0].likes).toBe(3)
    expect(list[1].likes).toBe(0)
  })

  it('defaults likes to 0 when missing', () => {
    const json = JSON.stringify([{ id: 'p1', author: 'a', content: 'x' }])
    expect(parsePosts(json)[0].likes).toBe(0)
  })

  it('defaults author to "unknown" when missing', () => {
    const json = JSON.stringify([{ id: 'p1', content: 'x' }])
    expect(parsePosts(json)[0].author).toBe('unknown')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'p1', author: 'a', content: 'b' }])
    expect(parsePosts(withNoise(json))).toHaveLength(1)
  })

  it('drops entries without an id', () => {
    const json = JSON.stringify([{ content: 'orphan' }, { id: 'p1', content: 'ok' }])
    expect(parsePosts(json)).toHaveLength(1)
  })
})

// ─── parsePublishedPost / parseAddedContact (single-record returns) ──────────

describe('parsePublishedPost', () => {
  it('returns null on empty / non-object output', () => {
    expect(parsePublishedPost('')).toBeNull()
    expect(parsePublishedPost('[]')).toBeNull()
  })

  it('normalizes a single post envelope', () => {
    const json = JSON.stringify({ id: 'p1', author: 'a', content: 'hi', likes: 0, createdAt: 'now' })
    const post = parsePublishedPost(json)
    expect(post.id).toBe('p1')
    expect(post.author).toBe('a')
    expect(post.likes).toBe(0)
  })

  it('returns null when the post lacks an id', () => {
    const json = JSON.stringify({ author: 'a', content: 'x' })
    expect(parsePublishedPost(json)).toBeNull()
  })
})

describe('parseAddedContact', () => {
  it('returns null on empty output', () => {
    expect(parseAddedContact('')).toBeNull()
  })

  it('normalizes a single contact envelope', () => {
    const json = JSON.stringify({ id: 'c1', name: 'alice', did: 'did:key:abc' })
    const c = parseAddedContact(json)
    expect(c.id).toBe('c1')
    expect(c.name).toBe('alice')
  })

  it('returns null when contact lacks an id', () => {
    expect(parseAddedContact(JSON.stringify({ name: 'no-id' }))).toBeNull()
  })
})
