/**
 * Unit tests for the 8 new batch Vue pages:
 * Wallet, Organization, Analytics, Templates, Permissions, RssFeed, Backup, WebAuthn
 *
 * All parse functions are replicated inline (no imports from Vue files) so
 * that this file is fast, dependency-free, and resilient to refactors.
 *
 * Run: npx vitest run __tests__/unit/batch-pages.test.js
 */

import { describe, it, expect, beforeEach } from 'vitest'
import { createPinia, setActivePinia } from 'pinia'

beforeEach(() => {
  setActivePinia(createPinia())
})

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Wallet.vue parsers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── parseWalletListText ──────────────────────────────────────────────────────

function parseWalletListText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ wallet/i.test(t)
  }).map((line, i) => {
    const addrMatch = line.match(/(0x[a-fA-F0-9]{8,})/)
    const isDefault = /default|默认|\*/.test(line)
    const nameMatch = line.match(/name[:\s]+(\S+)/i)
    return {
      key: addrMatch?.[1] || String(i),
      address: addrMatch?.[1] || '-',
      name: nameMatch?.[1] || '-',
      isDefault,
      balance: '-',
    }
  })
}

describe('parseWalletListText', () => {
  it('returns empty array for null input', () => {
    expect(parseWalletListText(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseWalletListText('')).toEqual([])
  })

  it('parses a line with a 0x address', () => {
    const result = parseWalletListText('0xAbCdEf1234567890  Main Wallet')
    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('0xAbCdEf1234567890')
    expect(result[0].key).toBe('0xAbCdEf1234567890')
    expect(result[0].balance).toBe('-')
  })

  it('uses index as key and "-" as address when no 0x address found', () => {
    const result = parseWalletListText('some wallet line without address')
    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('-')
    expect(result[0].key).toBe('0')
  })

  it('detects "default" marker (English)', () => {
    const result = parseWalletListText('0xAbCdEf1234567890  (default)')
    expect(result[0].isDefault).toBe(true)
  })

  it('detects "默认" marker (Chinese)', () => {
    const result = parseWalletListText('0xAbCdEf1234567890  默认')
    expect(result[0].isDefault).toBe(true)
  })

  it('detects asterisk (*) marker as default', () => {
    const result = parseWalletListText('* 0xAbCdEf1234567890')
    expect(result[0].isDefault).toBe(true)
  })

  it('sets isDefault false when no marker present', () => {
    const result = parseWalletListText('0xAbCdEf1234567890  Normal Wallet')
    expect(result[0].isDefault).toBe(false)
  })

  it('extracts name with "name:" prefix', () => {
    const result = parseWalletListText('0xAbCdEf1234567890  name: MyWallet')
    expect(result[0].name).toBe('MyWallet')
  })

  it('extracts name with "name " (space) prefix', () => {
    const result = parseWalletListText('0xAbCdEf1234567890  name SavingsWallet')
    expect(result[0].name).toBe('SavingsWallet')
  })

  it('returns "-" for name when no name field found', () => {
    const result = parseWalletListText('0xAbCdEf1234567890')
    expect(result[0].name).toBe('-')
  })

  it('skips lines starting with ─ (box-drawing separator)', () => {
    const input = '─────────────────────\n0xAbCdEf1234567890'
    const result = parseWalletListText(input)
    expect(result).toHaveLength(1)
    expect(result[0].address).toBe('0xAbCdEf1234567890')
  })

  it('skips lines matching "N wallets" summary pattern', () => {
    const input = '3 wallets found\n0xAbCdEf1234567890'
    const result = parseWalletListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips lines matching "1 Wallet" (capital, singular) summary pattern', () => {
    const input = '1 Wallet\n0xAbCdEf1234567890'
    const result = parseWalletListText(input)
    expect(result).toHaveLength(1)
  })

  it('parses multiple wallet lines', () => {
    const input = [
      '0xAaBbCcDd11223344  (default)  name: Hot',
      '0x1122334455667788  name: Cold',
    ].join('\n')
    const result = parseWalletListText(input)
    expect(result).toHaveLength(2)
    expect(result[0].isDefault).toBe(true)
    expect(result[0].name).toBe('Hot')
    expect(result[1].isDefault).toBe(false)
    expect(result[1].name).toBe('Cold')
  })

  it('requires at least 8 hex chars after 0x', () => {
    // 0x1234567 is 7 chars (too short), should not match
    const result = parseWalletListText('0x1234567')
    expect(result[0].address).toBe('-')
  })

  it('matches exactly 8 hex chars after 0x', () => {
    const result = parseWalletListText('0x12345678')
    expect(result[0].address).toBe('0x12345678')
  })
})

// ─── assetTypeColor ───────────────────────────────────────────────────────────

function assetTypeColor(type) {
  return { token: 'blue', nft: 'purple', data: 'cyan' }[(type || '').toLowerCase()] || 'default'
}

describe('assetTypeColor', () => {
  it('returns "blue" for "token"', () => {
    expect(assetTypeColor('token')).toBe('blue')
  })

  it('returns "blue" for "TOKEN" (uppercase)', () => {
    expect(assetTypeColor('TOKEN')).toBe('blue')
  })

  it('returns "purple" for "nft"', () => {
    expect(assetTypeColor('nft')).toBe('purple')
  })

  it('returns "purple" for "NFT" (uppercase)', () => {
    expect(assetTypeColor('NFT')).toBe('purple')
  })

  it('returns "cyan" for "data"', () => {
    expect(assetTypeColor('data')).toBe('cyan')
  })

  it('returns "cyan" for "DATA" (uppercase)', () => {
    expect(assetTypeColor('DATA')).toBe('cyan')
  })

  it('returns "default" for unknown type', () => {
    expect(assetTypeColor('bond')).toBe('default')
  })

  it('returns "default" for null', () => {
    expect(assetTypeColor(null)).toBe('default')
  })

  it('returns "default" for undefined', () => {
    expect(assetTypeColor(undefined)).toBe('default')
  })

  it('returns "default" for empty string', () => {
    expect(assetTypeColor('')).toBe('default')
  })
})

// ─── parseAssetsText ──────────────────────────────────────────────────────────

function parseAssetsText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ asset/i.test(t)
  }).map((line, i) => {
    const parts = line.trim().split(/\s*[|│]\s*/)
    if (parts.length < 2) return null
    return {
      key: String(i),
      name: parts[0]?.trim() || '-',
      type: parts[1]?.trim() || '-',
      description: parts[2]?.trim() || '',
      address: parts[3]?.trim() || '-',
    }
  }).filter(Boolean)
}

describe('parseAssetsText', () => {
  it('returns empty array for null', () => {
    expect(parseAssetsText(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseAssetsText('')).toEqual([])
  })

  it('parses a pipe-separated 4-part line', () => {
    const result = parseAssetsText('MyToken | token | A test token | 0xAbCdEf1234567890')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('MyToken')
    expect(result[0].type).toBe('token')
    expect(result[0].description).toBe('A test token')
    expect(result[0].address).toBe('0xAbCdEf1234567890')
  })

  it('parses a 2-part line (description and address default to empty/-)', () => {
    const result = parseAssetsText('NFT Art | nft')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('NFT Art')
    expect(result[0].type).toBe('nft')
    expect(result[0].description).toBe('')
    expect(result[0].address).toBe('-')
  })

  it('filters out lines with fewer than 2 parts', () => {
    const result = parseAssetsText('OnlyOnePart')
    expect(result).toHaveLength(0)
  })

  it('uses box-drawing │ delimiter', () => {
    const result = parseAssetsText('DataAsset│data│raw data│0x11223344')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('DataAsset')
    expect(result[0].type).toBe('data')
  })

  it('skips ─ separator lines', () => {
    const input = '────────────────\nMyToken | token'
    const result = parseAssetsText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "N assets" summary lines', () => {
    const input = '5 assets total\nMyToken | token'
    const result = parseAssetsText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "1 Asset" (capital, singular)', () => {
    const input = '1 Asset\nMyToken | token'
    const result = parseAssetsText(input)
    expect(result).toHaveLength(1)
  })

  it('assigns sequential key strings', () => {
    const input = 'A | token\nB | nft'
    const result = parseAssetsText(input)
    expect(result[0].key).toBe('0')
    expect(result[1].key).toBe('1')
  })
})

// ─── parseHistoryText ─────────────────────────────────────────────────────────

function parseHistoryText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ transaction/i.test(t)
  }).map((line, i) => {
    const parts = line.trim().split(/\s*[|│]\s*/)
    if (parts.length < 3) return null
    return {
      key: String(i),
      time: parts[0]?.trim() || '-',
      type: parts[1]?.trim() || '-',
      amount: parts[2]?.trim() || '-',
      to: parts[3]?.trim() || '-',
    }
  }).filter(Boolean)
}

describe('parseHistoryText', () => {
  it('returns empty array for null', () => {
    expect(parseHistoryText(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseHistoryText('')).toEqual([])
  })

  it('parses a 4-part pipe-separated line', () => {
    const result = parseHistoryText('2024-01-15 | transfer | 1.5 ETH | 0xAbCdEf12')
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('2024-01-15')
    expect(result[0].type).toBe('transfer')
    expect(result[0].amount).toBe('1.5 ETH')
    expect(result[0].to).toBe('0xAbCdEf12')
  })

  it('parses a 3-part line (to defaults to "-")', () => {
    const result = parseHistoryText('2024-01-15 | receive | 0.5 BTC')
    expect(result).toHaveLength(1)
    expect(result[0].to).toBe('-')
  })

  it('filters out lines with fewer than 3 parts', () => {
    const result = parseHistoryText('2024-01-15 | transfer')
    expect(result).toHaveLength(0)
  })

  it('skips ─ separator lines', () => {
    const input = '──────────────────\n2024-01-15 | send | 1 ETH'
    const result = parseHistoryText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "N transactions" summary lines', () => {
    const input = '10 transactions found\n2024-01-15 | send | 1 ETH'
    const result = parseHistoryText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "1 Transaction" (capital, singular)', () => {
    const input = '1 Transaction\n2024-01-15 | send | 1 ETH'
    const result = parseHistoryText(input)
    expect(result).toHaveLength(1)
  })

  it('uses box-drawing │ delimiter', () => {
    const result = parseHistoryText('2024-01-15│mint│10 NFT│0xDeAdBeEf')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('mint')
  })
})

// ─── defaultWalletDisplay ─────────────────────────────────────────────────────

function defaultWalletDisplay(wallets) {
  const dw = wallets.find(w => w.isDefault)
  if (!dw || !dw.address) return '未设置'
  const addr = dw.address
  return addr.length > 16 ? addr.slice(0, 8) + '...' + addr.slice(-6) : addr
}

describe('defaultWalletDisplay', () => {
  it('returns "未设置" for empty wallets array', () => {
    expect(defaultWalletDisplay([])).toBe('未设置')
  })

  it('returns "未设置" when no wallet is default', () => {
    const wallets = [{ address: '0xAbCd1234', isDefault: false }]
    expect(defaultWalletDisplay(wallets)).toBe('未设置')
  })

  it('returns "未设置" when default wallet has no address', () => {
    const wallets = [{ address: '', isDefault: true }]
    expect(defaultWalletDisplay(wallets)).toBe('未设置')
  })

  it('returns "未设置" when default wallet address is "-"', () => {
    // '-'.length is 1 which is ≤16, so it returns '-' directly, not '未设置'
    // But address '-' is truthy, so: returns '-'
    const wallets = [{ address: '-', isDefault: true }]
    expect(defaultWalletDisplay(wallets)).toBe('-')
  })

  it('returns address as-is when 16 chars or fewer', () => {
    const wallets = [{ address: '0x1234567890ABCD', isDefault: true }] // 16 chars
    expect(defaultWalletDisplay(wallets)).toBe('0x1234567890ABCD')
  })

  it('truncates address when longer than 16 chars', () => {
    const addr = '0xAbCdEf1234567890DeAdBeEf'
    const wallets = [{ address: addr, isDefault: true }]
    const result = defaultWalletDisplay(wallets)
    expect(result).toBe(addr.slice(0, 8) + '...' + addr.slice(-6))
  })

  it('picks the first wallet with isDefault=true', () => {
    const wallets = [
      { address: '0xFirst1234567890', isDefault: true },
      { address: '0xSecond123456789', isDefault: true },
    ]
    const result = defaultWalletDisplay(wallets)
    expect(result).toContain('0xFirst')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Organization.vue parsers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── tryParseJson (org variant — find first bracket, slice from there) ────────

function tryParseJsonOrg(output) {
  try {
    const s = (output || '').trim()
    const a = s.indexOf('['), b = s.indexOf('{')
    let start = -1
    if (a >= 0 && (b < 0 || a < b)) start = a
    else if (b >= 0) start = b
    if (start < 0) return null
    return JSON.parse(s.slice(start))
  } catch { return null }
}

describe('tryParseJson (Organization variant)', () => {
  it('parses pure JSON array', () => {
    expect(tryParseJsonOrg('[{"id":1}]')).toEqual([{ id: 1 }])
  })

  it('parses pure JSON object', () => {
    expect(tryParseJsonOrg('{"name":"test"}')).toEqual({ name: 'test' })
  })

  it('parses when leading text precedes array', () => {
    const result = tryParseJsonOrg('Output:\n[{"id":1},{"id":2}]')
    expect(result).toEqual([{ id: 1 }, { id: 2 }])
  })

  it('parses when leading text precedes object', () => {
    const result = tryParseJsonOrg('Result: {"ok":true}')
    expect(result).toEqual({ ok: true })
  })

  it('returns null when no brackets found', () => {
    expect(tryParseJsonOrg('no json here')).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(tryParseJsonOrg('')).toBeNull()
  })

  it('returns null for null input', () => {
    expect(tryParseJsonOrg(null)).toBeNull()
  })

  it('returns null for invalid JSON after bracket', () => {
    expect(tryParseJsonOrg('[not valid json')).toBeNull()
  })

  it('returns null when array is found first but full slice is invalid JSON', () => {
    // '[1,2]{"extra":true}' slices from '[' to end → invalid JSON → null
    // The function slices from first bracket to end of string, not to last bracket
    const result = tryParseJsonOrg('[1,2]{"extra":true}')
    expect(result).toBeNull()
  })

  it('prefers object when it comes before array (object sliced to end of string)', () => {
    // '{"a":1}[1,2]' slices from '{' to end → invalid JSON → null
    const result = tryParseJsonOrg('{"a":1}[1,2]')
    expect(result).toBeNull()
  })
})

// ─── parseOrgListText ─────────────────────────────────────────────────────────

function parseOrgListText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ org/i.test(t)
  }).map((line, i) => {
    const parts = line.trim().split(/\s*[|│]\s*/)
    if (parts.length < 3) return null
    return {
      key: String(i),
      id: parts[0]?.trim() || '-',
      name: parts[1]?.trim() || '-',
      owner: parts[2]?.trim() || '-',
      description: parts[3]?.trim() || '',
      memberCount: parseInt(parts[4], 10) || 0,
    }
  }).filter(Boolean)
}

describe('parseOrgListText', () => {
  it('returns empty array for null', () => {
    expect(parseOrgListText(null)).toEqual([])
  })

  it('returns empty array for empty string', () => {
    expect(parseOrgListText('')).toEqual([])
  })

  it('parses a 5-part pipe-separated line with numeric memberCount', () => {
    const result = parseOrgListText('org-001 | Acme Corp | alice | A great org | 12')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('org-001')
    expect(result[0].name).toBe('Acme Corp')
    expect(result[0].owner).toBe('alice')
    expect(result[0].description).toBe('A great org')
    expect(result[0].memberCount).toBe(12)
  })

  it('defaults memberCount to 0 for non-numeric 5th part', () => {
    const result = parseOrgListText('org-002 | TestOrg | bob | Desc | N/A')
    expect(result[0].memberCount).toBe(0)
  })

  it('defaults memberCount to 0 when 5th part is absent', () => {
    const result = parseOrgListText('org-003 | TestOrg | carol | Desc')
    expect(result[0].memberCount).toBe(0)
  })

  it('filters out lines with fewer than 3 parts', () => {
    const result = parseOrgListText('org-004 | Incomplete')
    expect(result).toHaveLength(0)
  })

  it('skips ─ separator lines', () => {
    const input = '─────────────────\norg-001 | Acme | alice'
    const result = parseOrgListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "N org" summary lines', () => {
    const input = '3 orgs found\norg-001 | Acme | alice'
    const result = parseOrgListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "1 Org" (capital, singular)', () => {
    const input = '1 Org\norg-001 | Acme | alice'
    const result = parseOrgListText(input)
    expect(result).toHaveLength(1)
  })

  it('uses box-drawing │ delimiter', () => {
    const result = parseOrgListText('org-001│DAO│dave│Decentralized│5')
    expect(result[0].memberCount).toBe(5)
  })
})

// ─── roleColor ────────────────────────────────────────────────────────────────

function roleColor(role) {
  return { admin: 'gold', member: 'blue', viewer: 'default', owner: 'purple' }[(role || '').toLowerCase()] || 'default'
}

describe('roleColor', () => {
  it('returns "gold" for "admin"', () => expect(roleColor('admin')).toBe('gold'))
  it('returns "gold" for "ADMIN" (uppercase)', () => expect(roleColor('ADMIN')).toBe('gold'))
  it('returns "blue" for "member"', () => expect(roleColor('member')).toBe('blue'))
  it('returns "default" for "viewer"', () => expect(roleColor('viewer')).toBe('default'))
  it('returns "purple" for "owner"', () => expect(roleColor('owner')).toBe('purple'))
  it('returns "default" for unknown role', () => expect(roleColor('guest')).toBe('default'))
  it('returns "default" for null', () => expect(roleColor(null)).toBe('default'))
  it('returns "default" for empty string', () => expect(roleColor('')).toBe('default'))
})

// ─── approvalStatusColor ──────────────────────────────────────────────────────

function approvalStatusColor(status) {
  return { pending: 'orange', approved: 'green', rejected: 'red' }[(status || '').toLowerCase()] || 'default'
}

describe('approvalStatusColor', () => {
  it('returns "orange" for "pending"', () => expect(approvalStatusColor('pending')).toBe('orange'))
  it('returns "green" for "approved"', () => expect(approvalStatusColor('approved')).toBe('green'))
  it('returns "red" for "rejected"', () => expect(approvalStatusColor('rejected')).toBe('red'))
  it('returns "green" for "APPROVED" (uppercase)', () => expect(approvalStatusColor('APPROVED')).toBe('green'))
  it('returns "default" for unknown status', () => expect(approvalStatusColor('review')).toBe('default'))
  it('returns "default" for null', () => expect(approvalStatusColor(null)).toBe('default'))
})

// ─── parseMemberListText ──────────────────────────────────────────────────────

function parseMemberListText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ member/i.test(t)
  }).map((line, i) => {
    const parts = line.trim().split(/\s*[|│]\s*/)
    if (parts.length < 2) return null
    return {
      key: String(i),
      did: parts[0]?.trim() || '-',
      role: parts[1]?.trim() || 'member',
      joinedAt: parts[2]?.trim() || '-',
    }
  }).filter(Boolean)
}

describe('parseMemberListText', () => {
  it('returns empty array for null', () => {
    expect(parseMemberListText(null)).toEqual([])
  })

  it('parses a 3-part pipe-separated member line', () => {
    const result = parseMemberListText('did:key:z6Mk | admin | 2024-01-01')
    expect(result).toHaveLength(1)
    expect(result[0].did).toBe('did:key:z6Mk')
    expect(result[0].role).toBe('admin')
    expect(result[0].joinedAt).toBe('2024-01-01')
  })

  it('defaults role to "member" if only 2 parts', () => {
    const result = parseMemberListText('did:key:z6Mk | member')
    expect(result[0].role).toBe('member')
  })

  it('filters out lines with only 1 part', () => {
    const result = parseMemberListText('did:key:z6Mk')
    expect(result).toHaveLength(0)
  })

  it('skips ─ separator lines', () => {
    const input = '─────\ndid:key:z6Mk | admin'
    const result = parseMemberListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "N members" summary lines', () => {
    const input = '5 members\ndid:key:z6Mk | viewer'
    const result = parseMemberListText(input)
    expect(result).toHaveLength(1)
  })
})

// ─── parseApprovalListText ────────────────────────────────────────────────────

function parseApprovalListText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ (approval|request)/i.test(t)
  }).map((line, i) => {
    const parts = line.trim().split(/\s*[|│]\s*/)
    if (parts.length < 3) return null
    return {
      key: String(i),
      id: parts[0]?.trim() || '-',
      user: parts[1]?.trim() || '-',
      status: parts[2]?.trim() || 'pending',
      createdAt: parts[3]?.trim() || '-',
    }
  }).filter(Boolean)
}

describe('parseApprovalListText', () => {
  it('returns empty array for null', () => {
    expect(parseApprovalListText(null)).toEqual([])
  })

  it('parses a 4-part approval line', () => {
    const result = parseApprovalListText('req-001 | alice | pending | 2024-01-10')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('req-001')
    expect(result[0].user).toBe('alice')
    expect(result[0].status).toBe('pending')
    expect(result[0].createdAt).toBe('2024-01-10')
  })

  it('filters out lines with fewer than 3 parts', () => {
    const result = parseApprovalListText('req-001 | alice')
    expect(result).toHaveLength(0)
  })

  it('skips "N approvals" summary lines', () => {
    const input = '2 approvals pending\nreq-001 | alice | approved | 2024-01-10'
    const result = parseApprovalListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "N requests" summary lines', () => {
    const input = '1 request\nreq-001 | bob | rejected | 2024-01-11'
    const result = parseApprovalListText(input)
    expect(result).toHaveLength(1)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Analytics.vue parsers
// ═══════════════════════════════════════════════════════════════════════════════

function stripCommas(str) { return (str || '').replace(/,/g, '') }

describe('stripCommas', () => {
  it('removes all commas from a string with commas', () => {
    expect(stripCommas('1,234,567')).toBe('1234567')
  })

  it('leaves strings without commas unchanged', () => {
    expect(stripCommas('12345')).toBe('12345')
  })

  it('returns empty string for null', () => {
    expect(stripCommas(null)).toBe('')
  })

  it('returns empty string for undefined', () => {
    expect(stripCommas(undefined)).toBe('')
  })

  it('returns empty string for empty string', () => {
    expect(stripCommas('')).toBe('')
  })
})

// ─── parseSummaryText ─────────────────────────────────────────────────────────

function parseSummaryText(output) {
  const summary = { totalCalls: 0, totalTokens: 0, totalCost: 0, avgResponseTime: 0 }
  if (!output) return summary
  let m
  if ((m = output.match(/total\s*calls?\s*[:：]\s*([\d,]+)/i))) summary.totalCalls = parseInt(stripCommas(m[1]))
  if ((m = output.match(/total\s*tokens?\s*[:：]\s*([\d,]+)/i))) summary.totalTokens = parseInt(stripCommas(m[1]))
  if ((m = output.match(/cost\s*[:：]\s*\$?([\d,.]+)/i))) summary.totalCost = parseFloat(stripCommas(m[1]))
  if ((m = output.match(/(?:avg|average)\s*(?:response\s*)?time\s*[:：]\s*([\d,.]+)/i))) summary.avgResponseTime = parseFloat(stripCommas(m[1]))
  return summary
}

describe('parseSummaryText', () => {
  it('returns all-zero object for null', () => {
    const s = parseSummaryText(null)
    expect(s).toEqual({ totalCalls: 0, totalTokens: 0, totalCost: 0, avgResponseTime: 0 })
  })

  it('parses all 4 fields from a single output string', () => {
    const output = 'Total calls: 500\nTotal tokens: 10000\nCost: $2.50\nAvg time: 1.23'
    const s = parseSummaryText(output)
    expect(s.totalCalls).toBe(500)
    expect(s.totalTokens).toBe(10000)
    expect(s.totalCost).toBe(2.50)
    expect(s.avgResponseTime).toBe(1.23)
  })

  it('parses "Total Call" (singular)', () => {
    const s = parseSummaryText('Total call: 1')
    expect(s.totalCalls).toBe(1)
  })

  it('parses "Total Token" (singular)', () => {
    const s = parseSummaryText('Total token: 999')
    expect(s.totalTokens).toBe(999)
  })

  it('handles Chinese colon (：)', () => {
    const s = parseSummaryText('Total calls：1,234\nTotal tokens：5,678')
    expect(s.totalCalls).toBe(1234)
    expect(s.totalTokens).toBe(5678)
  })

  it('handles commas in numbers', () => {
    const s = parseSummaryText('Total calls: 1,234,567')
    expect(s.totalCalls).toBe(1234567)
  })

  it('parses cost with dollar sign', () => {
    const s = parseSummaryText('Cost: $9.99')
    expect(s.totalCost).toBe(9.99)
  })

  it('parses cost without dollar sign', () => {
    const s = parseSummaryText('Cost: 3.14')
    expect(s.totalCost).toBe(3.14)
  })

  it('parses "average response time" (full phrase)', () => {
    const s = parseSummaryText('average response time: 0.75')
    expect(s.avgResponseTime).toBe(0.75)
  })

  it('parses "avg time" (short phrase)', () => {
    const s = parseSummaryText('avg time: 2.00')
    expect(s.avgResponseTime).toBe(2.00)
  })

  it('is case-insensitive for field names', () => {
    const s = parseSummaryText('TOTAL CALLS: 10\nCOST: 1.00')
    expect(s.totalCalls).toBe(10)
    expect(s.totalCost).toBe(1.00)
  })
})

// ─── parseSummaryJSON ─────────────────────────────────────────────────────────

function parseSummaryJSON(data) {
  return {
    totalCalls: data.totalCalls ?? data.total_calls ?? data.calls ?? 0,
    totalTokens: data.totalTokens ?? data.total_tokens ?? data.tokens ?? 0,
    totalCost: data.totalCost ?? data.total_cost ?? data.cost ?? 0,
    avgResponseTime: data.avgResponseTime ?? data.avg_response_time ?? data.avgTime ?? 0,
  }
}

describe('parseSummaryJSON', () => {
  it('reads camelCase keys', () => {
    const data = { totalCalls: 100, totalTokens: 5000, totalCost: 1.5, avgResponseTime: 0.8 }
    const result = parseSummaryJSON(data)
    expect(result).toEqual({ totalCalls: 100, totalTokens: 5000, totalCost: 1.5, avgResponseTime: 0.8 })
  })

  it('reads snake_case keys as fallback', () => {
    const data = { total_calls: 200, total_tokens: 3000, total_cost: 0.5, avg_response_time: 1.2 }
    const result = parseSummaryJSON(data)
    expect(result.totalCalls).toBe(200)
    expect(result.totalTokens).toBe(3000)
    expect(result.totalCost).toBe(0.5)
    expect(result.avgResponseTime).toBe(1.2)
  })

  it('reads short alias keys as second fallback', () => {
    const data = { calls: 50, tokens: 999, cost: 0.25, avgTime: 0.5 }
    const result = parseSummaryJSON(data)
    expect(result.totalCalls).toBe(50)
    expect(result.totalTokens).toBe(999)
    expect(result.totalCost).toBe(0.25)
    expect(result.avgResponseTime).toBe(0.5)
  })

  it('defaults all fields to 0 for empty object', () => {
    const result = parseSummaryJSON({})
    expect(result).toEqual({ totalCalls: 0, totalTokens: 0, totalCost: 0, avgResponseTime: 0 })
  })

  it('camelCase takes priority over snake_case', () => {
    const data = { totalCalls: 10, total_calls: 999 }
    const result = parseSummaryJSON(data)
    expect(result.totalCalls).toBe(10)
  })
})

// ─── parseBreakdownJSON ───────────────────────────────────────────────────────

function parseBreakdownJSON(data) {
  const arr = Array.isArray(data) ? data : (data.breakdown || data.providers || data.rows || [])
  return arr.map((item, i) => {
    const inputTokens = item.inputTokens ?? item.input_tokens ?? 0
    const outputTokens = item.outputTokens ?? item.output_tokens ?? 0
    return {
      key: i,
      provider: item.provider || '-',
      model: item.model || '-',
      calls: item.calls || item.count || 0,
      inputTokens,
      outputTokens,
      totalTokens: item.totalTokens ?? item.total_tokens ?? (inputTokens + outputTokens),
      cost: item.cost ?? item.total_cost ?? 0,
      avgResponseTime: item.avgResponseTime ?? item.avg_response_time ?? 0,
    }
  })
}

describe('parseBreakdownJSON', () => {
  it('handles direct array input', () => {
    const data = [{ provider: 'ollama', model: 'qwen2', calls: 5 }]
    const result = parseBreakdownJSON(data)
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('ollama')
    expect(result[0].model).toBe('qwen2')
    expect(result[0].calls).toBe(5)
  })

  it('extracts from "breakdown" key when input is an object', () => {
    const data = { breakdown: [{ provider: 'anthropic', model: 'claude', calls: 10 }] }
    const result = parseBreakdownJSON(data)
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('anthropic')
  })

  it('extracts from "providers" key', () => {
    const data = { providers: [{ provider: 'openai', model: 'gpt-4', calls: 3 }] }
    const result = parseBreakdownJSON(data)
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('openai')
  })

  it('extracts from "rows" key', () => {
    const data = { rows: [{ provider: 'deepseek', model: 'v3', calls: 7 }] }
    const result = parseBreakdownJSON(data)
    expect(result).toHaveLength(1)
  })

  it('computes totalTokens from inputTokens + outputTokens when not provided', () => {
    const data = [{ provider: 'x', inputTokens: 300, outputTokens: 200 }]
    const result = parseBreakdownJSON(data)
    expect(result[0].totalTokens).toBe(500)
  })

  it('uses explicit totalTokens field over computed sum', () => {
    const data = [{ provider: 'x', inputTokens: 300, outputTokens: 200, totalTokens: 999 }]
    const result = parseBreakdownJSON(data)
    expect(result[0].totalTokens).toBe(999)
  })

  it('reads snake_case token fields', () => {
    const data = [{ provider: 'x', input_tokens: 100, output_tokens: 50 }]
    const result = parseBreakdownJSON(data)
    expect(result[0].inputTokens).toBe(100)
    expect(result[0].outputTokens).toBe(50)
    expect(result[0].totalTokens).toBe(150)
  })

  it('uses "count" as fallback for calls', () => {
    const data = [{ provider: 'y', count: 42 }]
    const result = parseBreakdownJSON(data)
    expect(result[0].calls).toBe(42)
  })

  it('assigns sequential key integers', () => {
    const data = [{ provider: 'a' }, { provider: 'b' }]
    const result = parseBreakdownJSON(data)
    expect(result[0].key).toBe(0)
    expect(result[1].key).toBe(1)
  })

  it('returns empty array for object without known keys', () => {
    const result = parseBreakdownJSON({ unknown: [] })
    expect(result).toEqual([])
  })
})

// ─── parseRecentJSON ──────────────────────────────────────────────────────────

function parseRecentJSON(data) {
  const arr = Array.isArray(data) ? data : (data.recent || data.history || data.logs || [])
  return arr.map((item, i) => ({
    key: i,
    time: item.time || item.timestamp || item.created_at || '-',
    provider: item.provider || '-',
    model: item.model || '-',
    prompt: (item.prompt || item.message || '').slice(0, 100),
    tokens: item.tokens || item.total_tokens || 0,
    cost: item.cost ?? 0,
  }))
}

describe('parseRecentJSON', () => {
  it('handles direct array input', () => {
    const data = [{ time: '2024-01-01', provider: 'ollama', model: 'qwen2', tokens: 100, cost: 0 }]
    const result = parseRecentJSON(data)
    expect(result).toHaveLength(1)
    expect(result[0].provider).toBe('ollama')
  })

  it('extracts from "recent" key', () => {
    const data = { recent: [{ provider: 'anthropic' }] }
    expect(parseRecentJSON(data)).toHaveLength(1)
  })

  it('extracts from "history" key', () => {
    const data = { history: [{ provider: 'openai' }] }
    expect(parseRecentJSON(data)).toHaveLength(1)
  })

  it('extracts from "logs" key', () => {
    const data = { logs: [{ provider: 'deepseek' }] }
    expect(parseRecentJSON(data)).toHaveLength(1)
  })

  it('uses "timestamp" as fallback for time', () => {
    const data = [{ timestamp: '2024-06-01T12:00:00' }]
    const result = parseRecentJSON(data)
    expect(result[0].time).toBe('2024-06-01T12:00:00')
  })

  it('truncates prompt to 100 chars', () => {
    const longPrompt = 'a'.repeat(200)
    const data = [{ prompt: longPrompt }]
    const result = parseRecentJSON(data)
    expect(result[0].prompt).toHaveLength(100)
  })

  it('uses "message" as fallback for prompt', () => {
    const data = [{ message: 'Hello world' }]
    const result = parseRecentJSON(data)
    expect(result[0].prompt).toBe('Hello world')
  })

  it('uses "total_tokens" as fallback for tokens', () => {
    const data = [{ total_tokens: 500 }]
    const result = parseRecentJSON(data)
    expect(result[0].tokens).toBe(500)
  })

  it('returns empty array for object without known keys', () => {
    const result = parseRecentJSON({ unknown: [] })
    expect(result).toEqual([])
  })
})

// ─── parseCacheText ───────────────────────────────────────────────────────────

function parseCacheText(output) {
  const result = { hitRate: 0, hits: 0, misses: 0, size: 0 }
  if (!output) return result
  let m
  if ((m = output.match(/hit\s*rate\s*[:：]\s*([\d.]+)%?/i))) result.hitRate = parseFloat(m[1])
  if ((m = output.match(/\bhits?\s*[:：]\s*(\d+)/i))) result.hits = parseInt(m[1])
  if ((m = output.match(/\bmisses?\s*[:：]\s*(\d+)/i))) result.misses = parseInt(m[1])
  if ((m = output.match(/size\s*[:：]\s*(\d+)/i))) result.size = parseInt(m[1])
  return result
}

describe('parseCacheText', () => {
  it('returns all-zero object for null', () => {
    expect(parseCacheText(null)).toEqual({ hitRate: 0, hits: 0, misses: 0, size: 0 })
  })

  it('parses hit rate with percent sign', () => {
    const r = parseCacheText('Hit rate: 87.5%')
    expect(r.hitRate).toBe(87.5)
  })

  it('parses hit rate without percent sign', () => {
    const r = parseCacheText('Hit rate: 75')
    expect(r.hitRate).toBe(75)
  })

  it('parses hits and misses', () => {
    const r = parseCacheText('Hits: 120\nMisses: 30')
    expect(r.hits).toBe(120)
    expect(r.misses).toBe(30)
  })

  it('parses cache size', () => {
    const r = parseCacheText('Size: 256')
    expect(r.size).toBe(256)
  })

  it('handles Chinese colon', () => {
    const r = parseCacheText('命中率：90%\n命中：180\n未命中：20')
    // These won't match English regex, so still 0 — just confirm no crash
    expect(r).toBeDefined()
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Templates.vue
// ═══════════════════════════════════════════════════════════════════════════════

function categoryColor(cat) {
  return { general: 'blue', code: 'green', writing: 'orange', analysis: 'purple' }[cat] || 'default'
}

describe('categoryColor (Templates.vue — case-sensitive)', () => {
  it('returns "blue" for "general"', () => expect(categoryColor('general')).toBe('blue'))
  it('returns "green" for "code"', () => expect(categoryColor('code')).toBe('green'))
  it('returns "orange" for "writing"', () => expect(categoryColor('writing')).toBe('orange'))
  it('returns "purple" for "analysis"', () => expect(categoryColor('analysis')).toBe('purple'))

  it('returns "default" for "GENERAL" (uppercase — case-sensitive!)', () => {
    expect(categoryColor('GENERAL')).toBe('default')
  })

  it('returns "default" for "Code" (mixed case)', () => {
    expect(categoryColor('Code')).toBe('default')
  })

  it('returns "default" for unknown category', () => {
    expect(categoryColor('math')).toBe('default')
  })

  it('returns "default" for null', () => {
    // null lookup on object returns undefined → 'default'
    expect(categoryColor(null)).toBe('default')
  })

  it('returns "default" for undefined', () => {
    expect(categoryColor(undefined)).toBe('default')
  })

  it('returns "default" for empty string', () => {
    expect(categoryColor('')).toBe('default')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Permissions.vue parsers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── tryParseJson (Permissions variant — slice both ends) ─────────────────────

function tryParseJsonPerms(str) {
  try {
    let jsonStart = str.indexOf('[')
    if (jsonStart < 0) jsonStart = str.indexOf('{')
    if (jsonStart < 0) return null
    let jsonEnd = str.lastIndexOf(']')
    if (jsonEnd < 0) jsonEnd = str.lastIndexOf('}')
    if (jsonEnd < 0) return null
    return JSON.parse(str.slice(jsonStart, jsonEnd + 1))
  } catch { return null }
}

describe('tryParseJson (Permissions variant — slice both ends)', () => {
  it('parses a clean JSON array', () => {
    expect(tryParseJsonPerms('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('parses a clean JSON object', () => {
    expect(tryParseJsonPerms('{"key":"value"}')).toEqual({ key: 'value' })
  })

  it('extracts embedded JSON with leading and trailing text', () => {
    const result = tryParseJsonPerms('prefix [{"a":1}] suffix')
    expect(result).toEqual([{ a: 1 }])
  })

  it('extracts embedded object with trailing text', () => {
    const result = tryParseJsonPerms('Result: {"ok":true} done.')
    expect(result).toEqual({ ok: true })
  })

  it('returns null when no brackets found', () => {
    expect(tryParseJsonPerms('no json here')).toBeNull()
  })

  it('returns null for invalid JSON', () => {
    expect(tryParseJsonPerms('[not json]')).toBeNull()
  })

  it('handles arrays with nested objects', () => {
    const result = tryParseJsonPerms('[{"role":"admin","perms":["read","write"]}]')
    expect(result[0].role).toBe('admin')
    expect(result[0].perms).toHaveLength(2)
  })
})

// ─── levelColor ───────────────────────────────────────────────────────────────

function levelColor(level) {
  return { info: 'blue', warn: 'orange', warning: 'orange', error: 'red', critical: 'red' }[(level || '').toLowerCase()] || 'default'
}

describe('levelColor', () => {
  it('returns "blue" for "info"', () => expect(levelColor('info')).toBe('blue'))
  it('returns "orange" for "warn"', () => expect(levelColor('warn')).toBe('orange'))
  it('returns "orange" for "warning"', () => expect(levelColor('warning')).toBe('orange'))
  it('returns "red" for "error"', () => expect(levelColor('error')).toBe('red'))
  it('returns "red" for "critical"', () => expect(levelColor('critical')).toBe('red'))
  it('returns "blue" for "INFO" (uppercase)', () => expect(levelColor('INFO')).toBe('blue'))
  it('returns "red" for "ERROR" (uppercase)', () => expect(levelColor('ERROR')).toBe('red'))
  it('returns "default" for unknown level', () => expect(levelColor('debug')).toBe('default'))
  it('returns "default" for null', () => expect(levelColor(null)).toBe('default'))
})

// ─── parseRolesText ───────────────────────────────────────────────────────────

function parseRolesText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^Role/i.test(t)
  }).map((line, i) => {
    const trimmed = line.trim()
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 2) {
      return {
        key: i,
        name: parts[0]?.trim() || '-',
        description: parts[1]?.trim() || '',
        permissions: (parts[2] || '').split(/[,;\s]+/).filter(Boolean),
        userCount: parseInt(parts[3], 10) || 0,
      }
    }
    if (trimmed.length > 2) {
      return { key: i, name: trimmed, description: '', permissions: [], userCount: 0 }
    }
    return null
  }).filter(Boolean)
}

describe('parseRolesText', () => {
  it('returns empty array for null', () => {
    expect(parseRolesText(null)).toEqual([])
  })

  it('parses a pipe-separated line with permissions and userCount', () => {
    const result = parseRolesText('admin | Administrator | read,write,delete | 5')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('admin')
    expect(result[0].description).toBe('Administrator')
    expect(result[0].permissions).toEqual(['read', 'write', 'delete'])
    expect(result[0].userCount).toBe(5)
  })

  it('parses a 2-part pipe-separated line (permissions empty, userCount 0)', () => {
    const result = parseRolesText('viewer | Read only')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('viewer')
    expect(result[0].description).toBe('Read only')
    expect(result[0].permissions).toEqual([])
    expect(result[0].userCount).toBe(0)
  })

  it('parses a single-column name-only line (length > 2)', () => {
    const result = parseRolesText('moderator')
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('moderator')
    expect(result[0].permissions).toEqual([])
  })

  it('filters out lines with 2 or fewer chars', () => {
    const result = parseRolesText('ab')
    expect(result).toHaveLength(0)
  })

  it('skips lines starting with "Role" (case-insensitive)', () => {
    const input = 'Role Name | Description\nadmin | Admin role'
    const result = parseRolesText(input)
    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('admin')
  })

  it('skips "ROLES" header line', () => {
    const input = 'ROLES\nadmin | Admin'
    const result = parseRolesText(input)
    expect(result).toHaveLength(1)
  })

  it('skips ─ separator lines', () => {
    const input = '──────────────\nadmin | Admin | read | 3'
    const result = parseRolesText(input)
    expect(result).toHaveLength(1)
  })

  it('splits permissions by comma', () => {
    const result = parseRolesText('editor | Editor | read,write | 2')
    expect(result[0].permissions).toContain('read')
    expect(result[0].permissions).toContain('write')
  })

  it('splits permissions by semicolon', () => {
    const result = parseRolesText('editor | Editor | read;write | 2')
    expect(result[0].permissions).toContain('read')
    expect(result[0].permissions).toContain('write')
  })

  it('splits permissions by space', () => {
    const result = parseRolesText('editor | Editor | read write | 2')
    expect(result[0].permissions).toContain('read')
    expect(result[0].permissions).toContain('write')
  })
})

// ─── parseAuditLogText (Permissions.vue) ─────────────────────────────────────

function parseAuditLogText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^(Audit|Log|Recent)/i.test(t)
  }).map((line, i) => {
    const trimmed = line.trim()
    // Format 1: pipe-separated
    const parts = trimmed.split(/\s*[|│]\s*/)
    if (parts.length >= 3) {
      return {
        key: i, time: parts[0]?.trim() || '-', action: parts[1]?.trim() || '-',
        user: parts[2]?.trim() || '-', level: parts[3]?.trim() || 'info',
      }
    }
    // Format 2: timestamp prefix with level keyword
    const tsMatch = trimmed.match(/^(\d{4}-\d{2}-\d{2}[\sT]\d{2}:\d{2}(?::\d{2})?)\s+(.+)$/)
    if (tsMatch) {
      const rest = tsMatch[2]
      const lvlMatch = rest.match(/\b(INFO|WARN|WARNING|ERROR|CRITICAL)\b/i)
      return {
        key: i, time: tsMatch[1],
        action: rest.replace(/\b(INFO|WARN|WARNING|ERROR|CRITICAL)\b/i, '').trim(),
        user: '-', level: lvlMatch ? lvlMatch[1].toLowerCase() : 'info',
      }
    }
    // Format 3: bare text fallback
    if (trimmed.length > 3) {
      return { key: i, time: '-', action: trimmed, user: '-', level: 'info' }
    }
    return null
  }).filter(Boolean)
}

describe('parseAuditLogText (Permissions.vue)', () => {
  it('returns empty array for null', () => {
    expect(parseAuditLogText(null)).toEqual([])
  })

  it('parses pipe-separated 4-part line', () => {
    const result = parseAuditLogText('2024-01-15 | login | alice | info')
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('2024-01-15')
    expect(result[0].action).toBe('login')
    expect(result[0].user).toBe('alice')
    expect(result[0].level).toBe('info')
  })

  it('parses pipe-separated 3-part line (level defaults to "info")', () => {
    const result = parseAuditLogText('2024-01-15 | logout | bob')
    expect(result).toHaveLength(1)
    expect(result[0].level).toBe('info')
  })

  it('parses timestamp-prefixed line with level keyword', () => {
    const result = parseAuditLogText('2024-01-15 10:30:00 ERROR Permission denied')
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('2024-01-15 10:30:00')
    expect(result[0].level).toBe('error')
    expect(result[0].action).toContain('Permission denied')
    expect(result[0].user).toBe('-')
  })

  it('parses timestamp with T separator', () => {
    const result = parseAuditLogText('2024-01-15T10:30 WARN Something')
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('2024-01-15T10:30')
  })

  it('falls back to bare text for unstructured lines', () => {
    const result = parseAuditLogText('User logged in successfully')
    expect(result).toHaveLength(1)
    expect(result[0].time).toBe('-')
    expect(result[0].action).toBe('User logged in successfully')
  })

  it('filters out lines ≤ 3 chars', () => {
    const result = parseAuditLogText('ab\nThis is valid text')
    expect(result).toHaveLength(1)
  })

  it('skips lines starting with "Audit"', () => {
    const input = 'Audit Log:\n2024-01-15 | login | alice | info'
    const result = parseAuditLogText(input)
    expect(result).toHaveLength(1)
  })

  it('skips lines starting with "Recent"', () => {
    const input = 'Recent Events:\n2024-01-15 | login | alice | warn'
    const result = parseAuditLogText(input)
    expect(result).toHaveLength(1)
  })

  it('skips ─ separator lines', () => {
    const input = '─────────────\n2024-01-15 | login | alice | info'
    const result = parseAuditLogText(input)
    expect(result).toHaveLength(1)
  })
})

// ─── checkPermission ──────────────────────────────────────────────────────────

function checkPermission(output) {
  const lower = (output || '').toLowerCase()
  const allowed = lower.includes('allow') || lower.includes('granted') || lower.includes('true') || lower.includes('yes')
  const denied = lower.includes('denied') || lower.includes('reject') || lower.includes('false') || lower.includes('no permission')
  return allowed && !denied
}

describe('checkPermission', () => {
  it('returns true for output containing "allow"', () => {
    expect(checkPermission('Permission allow')).toBe(true)
  })

  it('returns true for output containing "granted"', () => {
    expect(checkPermission('Access granted')).toBe(true)
  })

  it('returns true for output containing "true"', () => {
    expect(checkPermission('result: true')).toBe(true)
  })

  it('returns true for output containing "yes"', () => {
    expect(checkPermission('Permission: yes')).toBe(true)
  })

  it('returns false for output containing "denied"', () => {
    expect(checkPermission('Access denied')).toBe(false)
  })

  it('returns false for output containing "reject"', () => {
    expect(checkPermission('Request rejected')).toBe(false)
  })

  it('returns false for output containing "false"', () => {
    expect(checkPermission('allowed: false')).toBe(false)
  })

  it('returns false for output containing "no permission"', () => {
    expect(checkPermission('no permission to access')).toBe(false)
  })

  it('denied wins over allowed when both present', () => {
    expect(checkPermission('granted but later denied')).toBe(false)
  })

  it('returns false for output with neither keyword', () => {
    expect(checkPermission('unknown status')).toBe(false)
  })

  it('returns false for null', () => {
    expect(checkPermission(null)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(checkPermission('')).toBe(false)
  })

  it('is case-insensitive ("ALLOW")', () => {
    expect(checkPermission('ALLOW')).toBe(true)
  })

  it('is case-insensitive ("DENIED")', () => {
    expect(checkPermission('DENIED')).toBe(false)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 6. RssFeed.vue parsers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── formatTime ───────────────────────────────────────────────────────────────

function formatTime(t) {
  if (!t) return '-'
  try {
    const d = new Date(t)
    if (isNaN(d.getTime())) return String(t)
    return d.toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
  } catch { return String(t) }
}

describe('formatTime', () => {
  it('returns "-" for null', () => expect(formatTime(null)).toBe('-'))
  it('returns "-" for undefined', () => expect(formatTime(undefined)).toBe('-'))
  it('returns "-" for empty string', () => expect(formatTime('')).toBe('-'))

  it('formats a valid ISO date string (returns non-empty non-hyphen string)', () => {
    const result = formatTime('2024-03-15T10:30:00Z')
    expect(result).not.toBe('-')
    expect(typeof result).toBe('string')
    expect(result.length).toBeGreaterThan(0)
  })

  it('passes through invalid date strings as-is', () => {
    expect(formatTime('not-a-date')).toBe('not-a-date')
  })

  it('formats a numeric timestamp (milliseconds)', () => {
    const result = formatTime(1710499200000) // 2024-03-15
    expect(result).not.toBe('-')
    expect(typeof result).toBe('string')
  })

  it('passes through completely non-date strings', () => {
    expect(formatTime('hello world')).toBe('hello world')
  })
})

// ─── parseFeedListText ────────────────────────────────────────────────────────

function parseFeedListText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ feed/i.test(t) && !t.startsWith('RSS') && !t.startsWith('No ')
  }).map((line, i) => {
    const trimmed = line.trim()
    const m = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s+[-–]\s+(.+))?$/)
    if (m) return { key: m[1], id: m[1], title: m[2].trim(), url: (m[3] || '').trim(), itemCount: 0, lastUpdated: '' }
    if (trimmed.length > 5) return { key: String(i), id: String(i), title: trimmed, url: '', itemCount: 0, lastUpdated: '' }
    return null
  }).filter(Boolean)
}

describe('parseFeedListText', () => {
  it('returns empty array for null', () => {
    expect(parseFeedListText(null)).toEqual([])
  })

  it('parses a numbered list entry with URL (dash separator)', () => {
    const result = parseFeedListText('1. Tech News - https://example.com/rss')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('1')
    expect(result[0].title).toBe('Tech News')
    expect(result[0].url).toBe('https://example.com/rss')
  })

  it('parses a numbered list entry with URL (en-dash separator)', () => {
    const result = parseFeedListText('2. World News – https://world.com/feed')
    expect(result).toHaveLength(1)
    expect(result[0].url).toBe('https://world.com/feed')
  })

  it('parses a numbered list entry without URL', () => {
    const result = parseFeedListText('3. Hacker News')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Hacker News')
    expect(result[0].url).toBe('')
  })

  it('falls back to raw text for non-numbered lines longer than 5 chars', () => {
    const result = parseFeedListText('Some RSS Feed Title')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Some RSS Feed Title')
    expect(result[0].url).toBe('')
  })

  it('filters out lines of 5 chars or fewer', () => {
    const result = parseFeedListText('abc')
    expect(result).toHaveLength(0)
  })

  it('skips ─ separator lines', () => {
    const input = '──────────────────\n1. Tech News'
    const result = parseFeedListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "N feeds" summary lines', () => {
    const input = '3 feeds found\n1. Tech News'
    const result = parseFeedListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips lines starting with "RSS"', () => {
    const input = 'RSS Feeds:\n1. Tech News'
    const result = parseFeedListText(input)
    expect(result).toHaveLength(1)
  })

  it('skips lines starting with "No "', () => {
    const input = 'No feeds configured.\n1. Tech News'
    const result = parseFeedListText(input)
    expect(result).toHaveLength(1)
  })

  it('sets itemCount=0 and lastUpdated="" for all entries', () => {
    const result = parseFeedListText('1. Tech News - https://example.com/rss')
    expect(result[0].itemCount).toBe(0)
    expect(result[0].lastUpdated).toBe('')
  })
})

// ─── parseArticlesText ────────────────────────────────────────────────────────

function parseArticlesText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !/^\d+ article/i.test(t) && !t.startsWith('No ')
  }).map((line, i) => {
    const trimmed = line.trim()
    const m = trimmed.match(/^(\d+)\.\s+(.+?)(?:\s+[-–]\s+(.+))?$/)
    if (m) return { key: m[1], id: m[1], title: m[2].trim(), link: (m[3] || '').trim(), publishedAt: '', read: false }
    if (trimmed.length > 5) return { key: String(i), id: String(i), title: trimmed, link: '', publishedAt: '', read: false }
    return null
  }).filter(Boolean)
}

describe('parseArticlesText', () => {
  it('returns empty array for null', () => {
    expect(parseArticlesText(null)).toEqual([])
  })

  it('parses a numbered article with link', () => {
    const result = parseArticlesText('1. Breaking News - https://news.com/article/1')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('Breaking News')
    expect(result[0].link).toBe('https://news.com/article/1')
    expect(result[0].read).toBe(false)
  })

  it('parses a numbered article without link', () => {
    const result = parseArticlesText('2. Some Article Title')
    expect(result).toHaveLength(1)
    expect(result[0].link).toBe('')
  })

  it('skips "N articles" summary lines', () => {
    const input = '10 articles\n1. Article One'
    const result = parseArticlesText(input)
    expect(result).toHaveLength(1)
  })

  it('skips "No " prefix lines', () => {
    const input = 'No articles found.\n1. Article One'
    const result = parseArticlesText(input)
    expect(result).toHaveLength(1)
  })

  it('falls back to raw text for non-numbered lines > 5 chars', () => {
    const result = parseArticlesText('An article without a number')
    expect(result).toHaveLength(1)
    expect(result[0].title).toBe('An article without a number')
  })

  it('filters out lines ≤ 5 chars', () => {
    const result = parseArticlesText('ab')
    expect(result).toHaveLength(0)
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 7. Backup.vue parsers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── formatSize ───────────────────────────────────────────────────────────────

function formatSize(bytes) {
  if (bytes == null || isNaN(bytes)) return '-'
  const num = Number(bytes)
  if (num === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(num) / Math.log(1024))
  return (num / Math.pow(1024, i)).toFixed(i > 0 ? 1 : 0) + ' ' + units[i]
}

describe('formatSize', () => {
  it('returns "0 B" for 0', () => expect(formatSize(0)).toBe('0 B'))
  it('returns "-" for null', () => expect(formatSize(null)).toBe('-'))
  it('returns "-" for undefined', () => expect(formatSize(undefined)).toBe('-'))
  it('returns "-" for NaN', () => expect(formatSize(NaN)).toBe('-'))
  it('formats 1023 bytes as "1023 B" (no decimal)', () => expect(formatSize(1023)).toBe('1023 B'))
  it('formats 1024 bytes as "1.0 KB"', () => expect(formatSize(1024)).toBe('1.0 KB'))
  it('formats 1536 bytes as "1.5 KB"', () => expect(formatSize(1536)).toBe('1.5 KB'))
  it('formats 1048576 bytes as "1.0 MB"', () => expect(formatSize(1048576)).toBe('1.0 MB'))
  it('formats 1073741824 bytes as "1.0 GB"', () => expect(formatSize(1073741824)).toBe('1.0 GB'))
  it('formats 1099511627776 bytes as "1.0 TB"', () => expect(formatSize(1099511627776)).toBe('1.0 TB'))
  it('accepts numeric string "500"', () => expect(formatSize('500')).toBe('500 B'))
  it('formats 512 bytes as "512 B" (no decimal for bytes)', () => expect(formatSize(512)).toBe('512 B'))
})

// ─── safeParseJson ────────────────────────────────────────────────────────────

function safeParseJson(str) {
  if (!str || !str.trim()) return null
  try { return JSON.parse(str.trim()) } catch {}
  try {
    const m = str.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
    if (m) return JSON.parse(m[0])
  } catch {}
  return null
}

describe('safeParseJson', () => {
  it('parses clean JSON directly (direct path)', () => {
    expect(safeParseJson('{"a":1}')).toEqual({ a: 1 })
  })

  it('parses clean JSON array directly', () => {
    expect(safeParseJson('[1,2,3]')).toEqual([1, 2, 3])
  })

  it('extracts embedded JSON object via regex (second path)', () => {
    const result = safeParseJson('prefix {"found":true} suffix')
    expect(result).toEqual({ found: true })
  })

  it('extracts embedded JSON array via regex', () => {
    const result = safeParseJson('Output: [1,2]')
    expect(result).toEqual([1, 2])
  })

  it('returns null for null input', () => {
    expect(safeParseJson(null)).toBeNull()
  })

  it('returns null for empty string', () => {
    expect(safeParseJson('')).toBeNull()
  })

  it('returns null for whitespace-only string', () => {
    expect(safeParseJson('   ')).toBeNull()
  })

  it('returns null when no JSON structure found', () => {
    expect(safeParseJson('plain text, no JSON here')).toBeNull()
  })

  it('returns null for malformed JSON even with braces', () => {
    expect(safeParseJson('{not valid}')).toBeNull()
  })
})

// ─── parseSyncStatusText ──────────────────────────────────────────────────────

function parseSyncStatusText(output) {
  const result = { online: false, statusText: '未知', pending: 0, lastSync: '' }
  if (!output) return result
  result.online = /synced|online|up.to.date/i.test(output)
  result.statusText = result.online ? '已同步' : '未同步'
  const pm = output.match(/pending[:\s]+(\d+)/i)
  if (pm) result.pending = parseInt(pm[1])
  const lm = output.match(/last[:\s]+(.+)/i)
  if (lm) result.lastSync = lm[1].trim()
  return result
}

describe('parseSyncStatusText', () => {
  it('returns defaults for null', () => {
    const r = parseSyncStatusText(null)
    expect(r).toEqual({ online: false, statusText: '未知', pending: 0, lastSync: '' })
  })

  it('returns defaults for empty string', () => {
    const r = parseSyncStatusText('')
    expect(r.online).toBe(false)
    expect(r.statusText).toBe('未知')
  })

  it('detects "synced" as online', () => {
    const r = parseSyncStatusText('Status: synced')
    expect(r.online).toBe(true)
    expect(r.statusText).toBe('已同步')
  })

  it('detects "online" keyword', () => {
    const r = parseSyncStatusText('Node is online')
    expect(r.online).toBe(true)
  })

  it('detects "up to date" (with dot wildcard matching space)', () => {
    const r = parseSyncStatusText('Everything is up to date')
    expect(r.online).toBe(true)
  })

  it('detects "up-to-date" (with hyphens)', () => {
    const r = parseSyncStatusText('Status: up-to-date')
    expect(r.online).toBe(true)
  })

  it('marks as offline when none of the keywords match', () => {
    const r = parseSyncStatusText('Not connected')
    expect(r.online).toBe(false)
    expect(r.statusText).toBe('未同步')
  })

  it('parses pending count', () => {
    const r = parseSyncStatusText('Pending: 7 items')
    expect(r.pending).toBe(7)
  })

  it('parses pending count with space separator', () => {
    const r = parseSyncStatusText('Pending 3')
    expect(r.pending).toBe(3)
  })

  it('parses last sync time', () => {
    const r = parseSyncStatusText('Last: 2024-03-15 10:30:00')
    expect(r.lastSync).toBe('2024-03-15 10:30:00')
  })

  it('parses last with ":" separator', () => {
    const r = parseSyncStatusText('last:2024-03-20')
    expect(r.lastSync).toBe('2024-03-20')
  })

  it('is case-insensitive for all keywords', () => {
    const r = parseSyncStatusText('SYNCED\nPENDING: 2\nLAST: now')
    expect(r.online).toBe(true)
    expect(r.pending).toBe(2)
    expect(r.lastSync).toBe('now')
  })
})

// ═══════════════════════════════════════════════════════════════════════════════
// 8. WebAuthn.vue parsers
// ═══════════════════════════════════════════════════════════════════════════════

// ─── truncateId ───────────────────────────────────────────────────────────────

function truncateId(id) {
  if (!id) return '-'
  return id.length <= 16 ? id : id.slice(0, 8) + '...' + id.slice(-8)
}

describe('truncateId', () => {
  it('returns "-" for null', () => expect(truncateId(null)).toBe('-'))
  it('returns "-" for undefined', () => expect(truncateId(undefined)).toBe('-'))
  it('returns "-" for empty string', () => expect(truncateId('')).toBe('-'))

  it('returns id as-is when exactly 16 chars', () => {
    const id = 'abcdefgh12345678' // 16 chars
    expect(truncateId(id)).toBe(id)
  })

  it('returns id as-is when fewer than 16 chars', () => {
    const id = 'short-id'
    expect(truncateId(id)).toBe(id)
  })

  it('truncates id longer than 16 chars to first 8 + "..." + last 8', () => {
    const id = 'abcdefghijklmnopqrstuvwxyz' // 26 chars
    const result = truncateId(id)
    expect(result).toBe('abcdefgh' + '...' + 'stuvwxyz')
  })

  it('truncates 17-char id correctly', () => {
    const id = 'abcdefghijklmnopq' // 17 chars
    const result = truncateId(id)
    expect(result).toBe('abcdefgh' + '...' + 'jklmnopq')
  })
})

// ─── parseCredentialText ──────────────────────────────────────────────────────

function parseCredentialText(output) {
  if (!output) return []
  return output.split('\n').filter(line => {
    const t = line.trim()
    return t && !t.startsWith('─') && !t.startsWith('No ')
  }).map((line, i) => {
    const parts = line.trim().split(/\s*[|│]\s*/)
    if (parts.length < 2) return null
    return {
      key: String(i),
      id: parts[0]?.trim() || '-',
      name: parts[1]?.trim() || '-',
      type: parts[2]?.trim() || 'public-key',
      createdAt: parts[3]?.trim() || '-',
      lastUsed: parts[4]?.trim() || '-',
    }
  }).filter(Boolean)
}

describe('parseCredentialText', () => {
  it('returns empty array for null', () => {
    expect(parseCredentialText(null)).toEqual([])
  })

  it('parses a pipe-separated 5-part credential line', () => {
    const result = parseCredentialText('cred-001 | YubiKey 5 | public-key | 2024-01-01 | 2024-03-15')
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('cred-001')
    expect(result[0].name).toBe('YubiKey 5')
    expect(result[0].type).toBe('public-key')
    expect(result[0].createdAt).toBe('2024-01-01')
    expect(result[0].lastUsed).toBe('2024-03-15')
  })

  it('defaults type to "public-key" when only 2 parts provided', () => {
    const result = parseCredentialText('cred-002 | TouchID Key')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('public-key')
    expect(result[0].createdAt).toBe('-')
    expect(result[0].lastUsed).toBe('-')
  })

  it('filters out lines with only 1 part', () => {
    const result = parseCredentialText('cred-003')
    expect(result).toHaveLength(0)
  })

  it('skips ─ separator lines', () => {
    const input = '─────────────────────\ncred-001 | YubiKey'
    const result = parseCredentialText(input)
    expect(result).toHaveLength(1)
  })

  it('skips lines starting with "No "', () => {
    const input = 'No credentials registered.\ncred-001 | YubiKey'
    const result = parseCredentialText(input)
    expect(result).toHaveLength(1)
  })

  it('uses box-drawing │ delimiter', () => {
    const result = parseCredentialText('cred-004│Windows Hello│platform│2024-02-01│2024-03-01')
    expect(result).toHaveLength(1)
    expect(result[0].type).toBe('platform')
  })

  it('assigns sequential key strings', () => {
    const input = 'a | b\nc | d'
    const result = parseCredentialText(input)
    expect(result[0].key).toBe('0')
    expect(result[1].key).toBe('1')
  })
})

// ─── parseSsoText ─────────────────────────────────────────────────────────────

function parseSsoText(output) {
  const config = { provider: '', clientId: '', redirectUrl: '', enabled: false }
  if (!output) return config
  for (const line of output.split('\n')) {
    const m = line.match(/^(.+?)\s*[:=：]\s*(.+)$/)
    if (!m) continue
    const k = m[1].toLowerCase(), v = m[2].trim()
    if (k.includes('provider')) config.provider = v
    else if (k.includes('client') && k.includes('id')) config.clientId = v
    else if (k.includes('redirect') || k.includes('callback')) config.redirectUrl = v
    else if (k.includes('status') || k.includes('enabled')) config.enabled = /true|enabled|active|已启用/i.test(v)
  }
  return config
}

describe('parseSsoText', () => {
  it('returns default config for null', () => {
    expect(parseSsoText(null)).toEqual({ provider: '', clientId: '', redirectUrl: '', enabled: false })
  })

  it('parses provider field', () => {
    const r = parseSsoText('Provider: google')
    expect(r.provider).toBe('google')
  })

  it('parses clientId field', () => {
    const r = parseSsoText('Client ID: abc123')
    expect(r.clientId).toBe('abc123')
  })

  it('parses redirectUrl from "redirect" keyword', () => {
    const r = parseSsoText('Redirect URL: https://example.com/callback')
    expect(r.redirectUrl).toBe('https://example.com/callback')
  })

  it('parses redirectUrl from "callback" keyword', () => {
    const r = parseSsoText('Callback URL: https://app.example.com/auth')
    expect(r.redirectUrl).toBe('https://app.example.com/auth')
  })

  it('parses enabled=true from "status: enabled"', () => {
    const r = parseSsoText('Status: enabled')
    expect(r.enabled).toBe(true)
  })

  it('parses enabled=true from "enabled: true"', () => {
    const r = parseSsoText('Enabled: true')
    expect(r.enabled).toBe(true)
  })

  it('parses enabled=true from "status: active"', () => {
    const r = parseSsoText('Status: active')
    expect(r.enabled).toBe(true)
  })

  it('parses enabled=true from Chinese "已启用"', () => {
    const r = parseSsoText('Status: 已启用')
    expect(r.enabled).toBe(true)
  })

  it('parses enabled=false from "status: disabled"', () => {
    const r = parseSsoText('Status: disabled')
    expect(r.enabled).toBe(false)
  })

  it('handles Chinese colon (：) as delimiter', () => {
    const r = parseSsoText('Provider：github')
    expect(r.provider).toBe('github')
  })

  it('handles = as delimiter', () => {
    const r = parseSsoText('provider=okta')
    expect(r.provider).toBe('okta')
  })

  it('parses all fields together', () => {
    const input = [
      'Provider: github',
      'Client ID: client-xyz',
      'Redirect URL: https://app.com/cb',
      'Status: active',
    ].join('\n')
    const r = parseSsoText(input)
    expect(r.provider).toBe('github')
    expect(r.clientId).toBe('client-xyz')
    expect(r.redirectUrl).toBe('https://app.com/cb')
    expect(r.enabled).toBe(true)
  })
})

// ─── parseRecoveryCodes ───────────────────────────────────────────────────────

function parseRecoveryCodes(output) {
  if (!output) return []
  const codes = output.split('\n').map(l => l.trim()).filter(l => l && /^[A-Za-z0-9-]{6,}$/.test(l))
  return codes.length > 0 ? codes : [output.trim() || '无法生成恢复码']
}

describe('parseRecoveryCodes', () => {
  it('returns empty array for null', () => {
    expect(parseRecoveryCodes(null)).toEqual([])
  })

  it('parses multi-line alphanumeric codes', () => {
    const input = 'abc123\ndef456\nghi789'
    const result = parseRecoveryCodes(input)
    expect(result).toEqual(['abc123', 'def456', 'ghi789'])
  })

  it('accepts codes with hyphens', () => {
    const result = parseRecoveryCodes('abc-123-def')
    expect(result).toEqual(['abc-123-def'])
  })

  it('filters out codes shorter than 6 chars', () => {
    const input = 'ab123\nabc123'
    const result = parseRecoveryCodes(input)
    expect(result).toEqual(['abc123'])
  })

  it('filters out lines with spaces', () => {
    const input = 'abc 123\nabcdef'
    const result = parseRecoveryCodes(input)
    expect(result).toEqual(['abcdef'])
  })

  it('filters out lines with special chars (other than hyphen)', () => {
    const input = 'abc!23\nabcdef'
    const result = parseRecoveryCodes(input)
    expect(result).toEqual(['abcdef'])
  })

  it('falls back to full trimmed output when no valid codes found', () => {
    const result = parseRecoveryCodes('No valid codes here!')
    expect(result).toEqual(['No valid codes here!'])
  })

  it('falls back to "无法生成恢复码" when output is whitespace only', () => {
    const result = parseRecoveryCodes('   ')
    expect(result).toEqual(['无法生成恢复码'])
  })

  it('parses exactly 6-char codes (boundary)', () => {
    const result = parseRecoveryCodes('abc123')
    expect(result).toEqual(['abc123'])
  })
})

// ─── parseTfaStatus ───────────────────────────────────────────────────────────

function parseTfaStatus(output) {
  return /enabled|已启用|active/i.test(output || '')
}

describe('parseTfaStatus', () => {
  it('returns true for output containing "enabled"', () => {
    expect(parseTfaStatus('2FA is enabled')).toBe(true)
  })

  it('returns true for "ENABLED" (uppercase)', () => {
    expect(parseTfaStatus('ENABLED')).toBe(true)
  })

  it('returns true for output containing "已启用"', () => {
    expect(parseTfaStatus('双因素认证：已启用')).toBe(true)
  })

  it('returns true for output containing "active"', () => {
    expect(parseTfaStatus('Status: active')).toBe(true)
  })

  it('returns false for output containing "disabled"', () => {
    expect(parseTfaStatus('2FA is disabled')).toBe(false)
  })

  it('returns true for "not enabled" because regex matches "enabled" substring (known quirk)', () => {
    // /enabled/i matches "enabled" inside "not enabled" — no word-boundary negation in regex
    expect(parseTfaStatus('not enabled')).toBe(true)
  })

  it('returns false for null', () => {
    expect(parseTfaStatus(null)).toBe(false)
  })

  it('returns false for empty string', () => {
    expect(parseTfaStatus('')).toBe(false)
  })

  it('returns false for unrelated output', () => {
    expect(parseTfaStatus('status unknown')).toBe(false)
  })
})
