/**
 * Unit tests for src/utils/crosschain-parser.js
 *
 * Run: npx vitest run __tests__/unit/crosschain-parser.test.js
 */

import { describe, it, expect } from 'vitest'
import {
  parseChains,
  parseBridges,
  parseSwaps,
  parseMessages,
  parseStats,
  parseFeeEstimate,
  formatXChainTime,
  BRIDGE_STATUSES,
  SWAP_STATUSES,
  MESSAGE_STATUSES,
} from '../../src/utils/crosschain-parser.js'

const NOISE_PREAMBLE = '[AppConfig] Configuration loaded\n[DatabaseManager] Database initialized'
const NOISE_TRAILER = '[DatabaseManager] Database closed'
const withNoise = (body) => `${NOISE_PREAMBLE}\n${body}\n${NOISE_TRAILER}`

// ─── frozen status enums ────────────────────────────────────────────────────

describe('status enum exports', () => {
  it('BRIDGE_STATUSES contains the 6 CLI states', () => {
    expect(BRIDGE_STATUSES).toEqual(['pending', 'locked', 'minted', 'completed', 'refunded', 'failed'])
  })

  it('SWAP_STATUSES contains the 5 HTLC states', () => {
    expect(SWAP_STATUSES).toEqual(['initiated', 'hash_locked', 'claimed', 'refunded', 'expired'])
  })

  it('MESSAGE_STATUSES contains the 4 message states', () => {
    expect(MESSAGE_STATUSES).toEqual(['pending', 'sent', 'delivered', 'failed'])
  })

  it('all enums are frozen', () => {
    expect(Object.isFrozen(BRIDGE_STATUSES)).toBe(true)
    expect(Object.isFrozen(SWAP_STATUSES)).toBe(true)
    expect(Object.isFrozen(MESSAGE_STATUSES)).toBe(true)
  })
})

// ─── parseChains ────────────────────────────────────────────────────────────

describe('parseChains', () => {
  it('returns empty array for empty / non-array output', () => {
    expect(parseChains('')).toEqual([])
    expect(parseChains('{}')).toEqual([])
  })

  it('parses the 5 supported chains', () => {
    const json = JSON.stringify([
      { id: 'ethereum', name: 'Ethereum', symbol: 'ETH', chainId: 1 },
      { id: 'polygon', name: 'Polygon', symbol: 'MATIC', chainId: 137 },
      { id: 'bsc', name: 'BNB Smart Chain', symbol: 'BNB', chainId: 56 },
      { id: 'arbitrum', name: 'Arbitrum One', symbol: 'ETH', chainId: 42161 },
      { id: 'solana', name: 'Solana', symbol: 'SOL', chainId: 0 },
    ])
    const chains = parseChains(json)
    expect(chains).toHaveLength(5)
    expect(chains[0].id).toBe('ethereum')
    expect(chains[2].symbol).toBe('BNB')
    expect(chains[3].chainId).toBe(42161)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'eth', name: 'Ethereum', symbol: 'ETH', chainId: 1 }])
    expect(parseChains(withNoise(json))).toHaveLength(1)
  })

  it('falls back to snake_case chain_id', () => {
    const json = JSON.stringify([{ id: 'eth', name: 'Ethereum', symbol: 'ETH', chain_id: 1 }])
    expect(parseChains(json)[0].chainId).toBe(1)
  })

  it('drops entries without an id', () => {
    const json = JSON.stringify([{ name: 'orphan' }, { id: 'eth', name: 'Ethereum', symbol: 'ETH' }])
    expect(parseChains(json)).toHaveLength(1)
  })

  it('falls back name to id when name missing', () => {
    const json = JSON.stringify([{ id: 'eth' }])
    expect(parseChains(json)[0].name).toBe('eth')
  })
})

// ─── parseBridges ───────────────────────────────────────────────────────────

describe('parseBridges', () => {
  it('returns empty for empty output', () => {
    expect(parseBridges('')).toEqual([])
  })

  it('parses snake_case DB rows into camelCase', () => {
    const json = JSON.stringify([
      {
        id: 'b1',
        from_chain: 'ethereum',
        to_chain: 'polygon',
        asset: 'USDC',
        amount: 100,
        sender_address: '0xA',
        recipient_address: '0xB',
        lock_tx_hash: '0xLOCK',
        mint_tx_hash: null,
        status: 'locked',
        fee_amount: 0.5,
        fee_chain: 'ethereum',
        error_message: null,
        created_at: 1700000000000,
        completed_at: null,
      },
    ])
    const [b] = parseBridges(json)
    expect(b.id).toBe('b1')
    expect(b.fromChain).toBe('ethereum')
    expect(b.toChain).toBe('polygon')
    expect(b.amount).toBe(100)
    expect(b.senderAddress).toBe('0xA')
    expect(b.recipientAddress).toBe('0xB')
    expect(b.lockTxHash).toBe('0xLOCK')
    expect(b.status).toBe('locked')
    expect(b.feeAmount).toBe(0.5)
    expect(b.createdAt).toBe(1700000000000)
  })

  it('also accepts already-camelCase fields', () => {
    const json = JSON.stringify([
      { id: 'b1', fromChain: 'a', toChain: 'b', amount: 5, status: 'pending' },
    ])
    const [b] = parseBridges(json)
    expect(b.fromChain).toBe('a')
    expect(b.toChain).toBe('b')
  })

  it('lowercases status', () => {
    const json = JSON.stringify([{ id: 'b1', status: 'LOCKED' }])
    expect(parseBridges(json)[0].status).toBe('locked')
  })

  it('drops entries without an id', () => {
    const json = JSON.stringify([{ status: 'pending' }, { id: 'b1', status: 'pending' }])
    expect(parseBridges(json)).toHaveLength(1)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify([{ id: 'b1', from_chain: 'eth', to_chain: 'bsc', status: 'pending' }])
    expect(parseBridges(withNoise(json))).toHaveLength(1)
  })
})

// ─── parseSwaps ─────────────────────────────────────────────────────────────

describe('parseSwaps', () => {
  it('returns empty for empty output', () => {
    expect(parseSwaps('')).toEqual([])
  })

  it('parses HTLC swap rows', () => {
    const json = JSON.stringify([
      {
        id: 's1',
        from_chain: 'ethereum',
        to_chain: 'bsc',
        from_asset: 'ETH',
        to_asset: 'BNB',
        amount: 1.5,
        counterparty_address: '0xC',
        hash_lock: 'abc123',
        expires_at: 1700001000000,
        status: 'hash_locked',
        claim_tx_hash: null,
        refund_tx_hash: null,
        created_at: 1700000000000,
      },
    ])
    const [s] = parseSwaps(json)
    expect(s.id).toBe('s1')
    expect(s.fromAsset).toBe('ETH')
    expect(s.toAsset).toBe('BNB')
    expect(s.hashLock).toBe('abc123')
    expect(s.expiresAt).toBe(1700001000000)
    expect(s.status).toBe('hash_locked')
  })

  it('defaults assets to native', () => {
    const json = JSON.stringify([{ id: 's1', from_chain: 'a', to_chain: 'b', amount: 1 }])
    const [s] = parseSwaps(json)
    expect(s.fromAsset).toBe('native')
    expect(s.toAsset).toBe('native')
  })

  it('drops entries without an id', () => {
    expect(parseSwaps(JSON.stringify([{ from_chain: 'a' }]))).toEqual([])
  })
})

// ─── parseMessages ──────────────────────────────────────────────────────────

describe('parseMessages', () => {
  it('returns empty for empty output', () => {
    expect(parseMessages('')).toEqual([])
  })

  it('parses cross-chain message rows', () => {
    const json = JSON.stringify([
      {
        id: 'm1',
        from_chain: 'ethereum',
        to_chain: 'polygon',
        payload: 'hello',
        target_contract: '0xT',
        source_tx_hash: '0xS',
        destination_tx_hash: null,
        status: 'sent',
        retries: 1,
        created_at: 1700000000000,
        delivered_at: null,
      },
    ])
    const [m] = parseMessages(json)
    expect(m.payload).toBe('hello')
    expect(m.targetContract).toBe('0xT')
    expect(m.sourceTxHash).toBe('0xS')
    expect(m.retries).toBe(1)
    expect(m.status).toBe('sent')
  })

  it('defaults retries to 0 when missing', () => {
    const json = JSON.stringify([{ id: 'm1', from_chain: 'a', to_chain: 'b' }])
    expect(parseMessages(json)[0].retries).toBe(0)
  })
})

// ─── parseStats ─────────────────────────────────────────────────────────────

describe('parseStats', () => {
  it('returns full zero shape for empty output', () => {
    const s = parseStats('')
    expect(s.bridges.total).toBe(0)
    expect(s.bridges.totalVolume).toBe(0)
    expect(s.bridges.totalFees).toBe(0)
    expect(s.bridges.byStatus).toEqual({})
    expect(s.swaps.total).toBe(0)
    expect(s.messages.total).toBe(0)
  })

  it('parses a complete stats payload', () => {
    const json = JSON.stringify({
      bridges: { total: 12, byStatus: { pending: 3, completed: 9 }, totalVolume: 1500, totalFees: 7.5 },
      swaps: { total: 4, byStatus: { initiated: 2, claimed: 2 } },
      messages: { total: 1, byStatus: { delivered: 1 } },
    })
    const s = parseStats(json)
    expect(s.bridges.total).toBe(12)
    expect(s.bridges.byStatus.completed).toBe(9)
    expect(s.bridges.totalVolume).toBe(1500)
    expect(s.swaps.total).toBe(4)
    expect(s.messages.total).toBe(1)
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ bridges: { total: 5, byStatus: {}, totalVolume: 0, totalFees: 0 }, swaps: { total: 0, byStatus: {} }, messages: { total: 0, byStatus: {} } })
    expect(parseStats(withNoise(json)).bridges.total).toBe(5)
  })

  it('falls back to snake_case totalVolume / totalFees', () => {
    const json = JSON.stringify({ bridges: { total: 1, total_volume: 10, total_fees: 1, byStatus: {} } })
    const s = parseStats(json)
    expect(s.bridges.totalVolume).toBe(10)
    expect(s.bridges.totalFees).toBe(1)
  })

  it('treats non-object substructure as zero', () => {
    const json = JSON.stringify({ bridges: null, swaps: 'x', messages: undefined })
    const s = parseStats(json)
    expect(s.bridges.total).toBe(0)
    expect(s.swaps.total).toBe(0)
    expect(s.messages.total).toBe(0)
  })
})

// ─── parseFeeEstimate ───────────────────────────────────────────────────────

describe('parseFeeEstimate', () => {
  it('returns null on empty / array output', () => {
    expect(parseFeeEstimate('')).toBeNull()
    expect(parseFeeEstimate('[]')).toBeNull()
  })

  it('parses a fee envelope', () => {
    const json = JSON.stringify({
      fee: 5.4,
      breakdown: { sourceFee: 5, destFee: 0.1, bridgeFee: 0.3 },
      currency: 'USD',
    })
    const f = parseFeeEstimate(json)
    expect(f.fee).toBe(5.4)
    expect(f.breakdown.sourceFee).toBe(5)
    expect(f.breakdown.bridgeFee).toBe(0.3)
    expect(f.currency).toBe('USD')
  })

  it('falls back to snake_case breakdown keys', () => {
    const json = JSON.stringify({
      fee: 1, breakdown: { source_fee: 0.5, dest_fee: 0.2, bridge_fee: 0.3 }, currency: 'USD',
    })
    const f = parseFeeEstimate(json)
    expect(f.breakdown.sourceFee).toBe(0.5)
    expect(f.breakdown.destFee).toBe(0.2)
    expect(f.breakdown.bridgeFee).toBe(0.3)
  })

  it('defaults currency to USD when missing', () => {
    expect(parseFeeEstimate(JSON.stringify({ fee: 1 })).currency).toBe('USD')
  })

  it('survives CLI noise', () => {
    const json = JSON.stringify({ fee: 2, breakdown: { sourceFee: 1, destFee: 0.5, bridgeFee: 0.5 }, currency: 'USD' })
    expect(parseFeeEstimate(withNoise(json)).fee).toBe(2)
  })
})

// ─── formatXChainTime ───────────────────────────────────────────────────────

describe('formatXChainTime', () => {
  it('returns em-dash for null / empty', () => {
    expect(formatXChainTime(null)).toBe('—')
    expect(formatXChainTime('')).toBe('—')
    expect(formatXChainTime(undefined)).toBe('—')
  })

  it('formats a numeric ms timestamp', () => {
    const formatted = formatXChainTime(1700000000000)
    expect(formatted.length).toBeGreaterThan(8)
  })

  it('returns raw value for non-parseable input', () => {
    expect(formatXChainTime('not a date')).toBe('not a date')
  })
})
