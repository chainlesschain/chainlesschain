# bridge-relayer

**Source**: `src\main\blockchain\bridge-relayer.js`

**Generated**: 2026-01-27T06:44:03.872Z

---

## const

```javascript
const
```

* Bridge Relayer System
 *
 * Automated relayer for cross-chain bridge operations:
 * - Monitors lock events on source chains
 * - Automatically submits mint transactions on destination chains
 * - Verifies transaction proofs
 * - Handles retries and error recovery
 * - Provides relayer incentives tracking

---

## const RELAYER_CONFIG =

```javascript
const RELAYER_CONFIG =
```

* Relayer configuration

---

## class BridgeRelayer extends EventEmitter

```javascript
class BridgeRelayer extends EventEmitter
```

* Bridge Relayer

---

## async initialize()

```javascript
async initialize()
```

* Initialize relayer

---

## async initializeTables()

```javascript
async initializeTables()
```

* Initialize database tables

---

## async loadLastProcessedBlocks()

```javascript
async loadLastProcessedBlocks()
```

* Load last processed blocks

---

## async loadPendingRelays()

```javascript
async loadPendingRelays()
```

* Load pending relays

---

## async start()

```javascript
async start()
```

* Start relayer

---

## async stop()

```javascript
async stop()
```

* Stop relayer

---

## async monitoringLoop()

```javascript
async monitoringLoop()
```

* Monitoring loop - scan for new lock events

---

## async processingLoop()

```javascript
async processingLoop()
```

* Processing loop - process pending relays

---

## async scanForLockEvents()

```javascript
async scanForLockEvents()
```

* Scan for lock events on all chains

---

## async scanChainForLockEvents(chainId)

```javascript
async scanChainForLockEvents(chainId)
```

* Scan specific chain for lock events

---

## async handleLockEvent(event, sourceChainId)

```javascript
async handleLockEvent(event, sourceChainId)
```

* Handle lock event

---

## async processRelay(requestId)

```javascript
async processRelay(requestId)
```

* Process relay task

---

## async verifySourceTransaction(relayTask)

```javascript
async verifySourceTransaction(relayTask)
```

* Verify source transaction

---

## async submitMintTransaction(relayTask)

```javascript
async submitMintTransaction(relayTask)
```

* Submit mint transaction on destination chain

---

## async waitForConfirmation(chainId, txHash)

```javascript
async waitForConfirmation(chainId, txHash)
```

* Wait for transaction confirmation

---

## calculateRelayerFee(amount)

```javascript
calculateRelayerFee(amount)
```

* Calculate relayer fee

---

## async getOptimizedGasPrice()

```javascript
async getOptimizedGasPrice()
```

* Get optimized gas price

---

## async saveRelayTask(task)

```javascript
async saveRelayTask(task)
```

* Save relay task to database

---

## async updateRelayTask(requestId, updates)

```javascript
async updateRelayTask(requestId, updates)
```

* Update relay task

---

## getStatistics()

```javascript
getStatistics()
```

* Get relayer statistics

---

## async getRelayHistory(filters =

```javascript
async getRelayHistory(filters =
```

* Get relay history

---

## async close()

```javascript
async close()
```

* Close relayer

---

