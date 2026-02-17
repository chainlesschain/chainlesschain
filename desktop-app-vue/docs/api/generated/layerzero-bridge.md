# layerzero-bridge

**Source**: `src/main/blockchain/bridges/layerzero-bridge.js`

**Generated**: 2026-02-17T10:13:18.270Z

---

## const

```javascript
const
```

* LayerZero Bridge Implementation
 *
 * Production-ready cross-chain bridge using LayerZero protocol
 *
 * Features:
 * - Omnichain asset transfers
 * - Message verification
 * - Fee estimation
 * - Transaction tracking
 * - Retry mechanism

---

## const LZ_CHAIN_IDS =

```javascript
const LZ_CHAIN_IDS =
```

* LayerZero Chain IDs
 * https://layerzero.gitbook.io/docs/technical-reference/mainnet/supported-chain-ids

---

## class LayerZeroBridge extends EventEmitter

```javascript
class LayerZeroBridge extends EventEmitter
```

* LayerZero Bridge Class

---

## async initialize()

```javascript
async initialize()
```

* Initialize bridge

---

## async loadContractABIs()

```javascript
async loadContractABIs()
```

* Load contract ABIs

---

## async bridgeAsset(params)

```javascript
async bridgeAsset(params)
```

* Bridge asset to another chain

---

## async estimateFee(params)

```javascript
async estimateFee(params)
```

* Estimate bridge fee

---

## async getStatus(txHash)

```javascript
async getStatus(txHash)
```

* Get transaction status

---

## async monitorDestinationChain(requestId, chainId, recipient)

```javascript
async monitorDestinationChain(requestId, chainId, recipient)
```

* Monitor destination chain for asset receipt

---

## validateBridgeParams(params)

```javascript
validateBridgeParams(params)
```

* Validate bridge parameters

---

## extractRequestId(receipt)

```javascript
extractRequestId(receipt)
```

* Extract request ID from transaction receipt

---

## trackTransaction(txHash, data)

```javascript
trackTransaction(txHash, data)
```

* Track transaction

---

## updateTransaction(txHash, updates)

```javascript
updateTransaction(txHash, updates)
```

* Update transaction

---

## updateTransactionByRequestId(requestId, updates)

```javascript
updateTransactionByRequestId(requestId, updates)
```

* Update transaction by request ID

---

## getSupportedChains()

```javascript
getSupportedChains()
```

* Get supported chains

---

## async close()

```javascript
async close()
```

* Close bridge

---

