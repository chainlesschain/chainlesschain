/**
 * crosschain-parser.js — Pure parsers for `cc crosschain ...` CLI output.
 *
 * Cross-chain DB rows come back snake_case (from_chain, sender_address,
 * created_at, ...) — we normalize to camelCase in the view layer.
 * Reuses `stripCliNoise` from community-parser.
 */

import { stripCliNoise } from './community-parser.js'

function tryParseJson(output) {
  const cleaned = stripCliNoise(output)
  if (!cleaned) return null
  try { return JSON.parse(cleaned) } catch { /* fallthrough */ }
  const m = cleaned.match(/\{[\s\S]*\}|\[[\s\S]*\]/)
  if (!m) return null
  try { return JSON.parse(m[0]) } catch { return null }
}

export const BRIDGE_STATUSES = Object.freeze([
  'pending', 'locked', 'minted', 'completed', 'refunded', 'failed',
])
export const SWAP_STATUSES = Object.freeze([
  'initiated', 'hash_locked', 'claimed', 'refunded', 'expired',
])
export const MESSAGE_STATUSES = Object.freeze([
  'pending', 'sent', 'delivered', 'failed',
])

function num(v, fallback = 0) {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback
}

function normalizeChain(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    name: String(raw.name || id),
    symbol: String(raw.symbol || ''),
    chainId: num(raw.chainId ?? raw.chain_id, 0),
    _idx: idx,
  }
}

/** Parse `cc crosschain chains --json`. Returns supported chain catalogue. */
export function parseChains(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeChain).filter(Boolean)
}

function normalizeBridge(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    fromChain: raw.fromChain ?? raw.from_chain ?? '',
    toChain: raw.toChain ?? raw.to_chain ?? '',
    asset: String(raw.asset || 'native'),
    amount: num(raw.amount, 0),
    senderAddress: raw.senderAddress ?? raw.sender_address ?? '',
    recipientAddress: raw.recipientAddress ?? raw.recipient_address ?? '',
    lockTxHash: raw.lockTxHash ?? raw.lock_tx_hash ?? '',
    mintTxHash: raw.mintTxHash ?? raw.mint_tx_hash ?? '',
    status: String(raw.status || 'pending').toLowerCase(),
    feeAmount: num(raw.feeAmount ?? raw.fee_amount, 0),
    feeChain: raw.feeChain ?? raw.fee_chain ?? '',
    errorMessage: raw.errorMessage ?? raw.error_message ?? '',
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    completedAt: raw.completedAt ?? raw.completed_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc crosschain bridges --json`. */
export function parseBridges(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeBridge).filter(Boolean)
}

function normalizeSwap(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    fromChain: raw.fromChain ?? raw.from_chain ?? '',
    toChain: raw.toChain ?? raw.to_chain ?? '',
    fromAsset: raw.fromAsset ?? raw.from_asset ?? 'native',
    toAsset: raw.toAsset ?? raw.to_asset ?? 'native',
    amount: num(raw.amount, 0),
    counterpartyAddress: raw.counterpartyAddress ?? raw.counterparty_address ?? '',
    hashLock: raw.hashLock ?? raw.hash_lock ?? '',
    expiresAt: raw.expiresAt ?? raw.expires_at ?? null,
    status: String(raw.status || 'initiated').toLowerCase(),
    claimTxHash: raw.claimTxHash ?? raw.claim_tx_hash ?? '',
    refundTxHash: raw.refundTxHash ?? raw.refund_tx_hash ?? '',
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc crosschain swaps --json`. The CLI strips `secret` from list output. */
export function parseSwaps(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeSwap).filter(Boolean)
}

function normalizeMessage(raw, idx = 0) {
  if (!raw || typeof raw !== 'object') return null
  const id = raw.id || ''
  if (!id) return null
  return {
    key: id,
    id,
    fromChain: raw.fromChain ?? raw.from_chain ?? '',
    toChain: raw.toChain ?? raw.to_chain ?? '',
    payload: String(raw.payload || ''),
    targetContract: raw.targetContract ?? raw.target_contract ?? '',
    sourceTxHash: raw.sourceTxHash ?? raw.source_tx_hash ?? '',
    destinationTxHash: raw.destinationTxHash ?? raw.destination_tx_hash ?? '',
    status: String(raw.status || 'pending').toLowerCase(),
    retries: num(raw.retries, 0),
    createdAt: raw.createdAt ?? raw.created_at ?? null,
    deliveredAt: raw.deliveredAt ?? raw.delivered_at ?? null,
    _idx: idx,
  }
}

/** Parse `cc crosschain messages --json`. */
export function parseMessages(output) {
  const parsed = tryParseJson(output)
  if (!Array.isArray(parsed)) return []
  return parsed.map(normalizeMessage).filter(Boolean)
}

const STATS_DEFAULTS = {
  bridges: { total: 0, byStatus: {}, totalVolume: 0, totalFees: 0 },
  swaps: { total: 0, byStatus: {} },
  messages: { total: 0, byStatus: {} },
}

/** Parse `cc crosschain stats --json`. Always returns the full shape. */
export function parseStats(output) {
  const result = JSON.parse(JSON.stringify(STATS_DEFAULTS))
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return result

  if (parsed.bridges && typeof parsed.bridges === 'object') {
    result.bridges.total = num(parsed.bridges.total, 0)
    result.bridges.totalVolume = num(parsed.bridges.totalVolume ?? parsed.bridges.total_volume, 0)
    result.bridges.totalFees = num(parsed.bridges.totalFees ?? parsed.bridges.total_fees, 0)
    if (parsed.bridges.byStatus && typeof parsed.bridges.byStatus === 'object') {
      result.bridges.byStatus = { ...parsed.bridges.byStatus }
    }
  }
  if (parsed.swaps && typeof parsed.swaps === 'object') {
    result.swaps.total = num(parsed.swaps.total, 0)
    if (parsed.swaps.byStatus && typeof parsed.swaps.byStatus === 'object') {
      result.swaps.byStatus = { ...parsed.swaps.byStatus }
    }
  }
  if (parsed.messages && typeof parsed.messages === 'object') {
    result.messages.total = num(parsed.messages.total, 0)
    if (parsed.messages.byStatus && typeof parsed.messages.byStatus === 'object') {
      result.messages.byStatus = { ...parsed.messages.byStatus }
    }
  }
  return result
}

/** Parse `cc crosschain estimate-fee <from> <to> <amount> --json`. */
export function parseFeeEstimate(output) {
  const parsed = tryParseJson(output)
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  return {
    fee: num(parsed.fee, 0),
    breakdown: {
      sourceFee: num(parsed?.breakdown?.sourceFee ?? parsed?.breakdown?.source_fee, 0),
      destFee: num(parsed?.breakdown?.destFee ?? parsed?.breakdown?.dest_fee, 0),
      bridgeFee: num(parsed?.breakdown?.bridgeFee ?? parsed?.breakdown?.bridge_fee, 0),
    },
    currency: String(parsed.currency || 'USD'),
  }
}

/** Format a numeric ms timestamp from cross-chain CLI; em-dash on empty. */
export function formatXChainTime(ts) {
  if (ts == null || ts === '') return '—'
  const d = typeof ts === 'number' ? new Date(ts) : new Date(String(ts))
  if (isNaN(d.getTime())) return String(ts)
  return d.toLocaleString('zh-CN', { hour12: false })
}
