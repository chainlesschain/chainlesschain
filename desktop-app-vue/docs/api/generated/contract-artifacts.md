# contract-artifacts

**Source**: `src/main/blockchain/contract-artifacts.js`

**Generated**: 2026-02-21T22:45:05.319Z

---

## const path = require('path');

```javascript
const path = require('path');
```

* 合约 Artifacts 加载器
 *
 * 加载编译后的合约 ABI 和字节码

---

## function loadContractArtifact(contractPath, contractName)

```javascript
function loadContractArtifact(contractPath, contractName)
```

* 加载合约 artifact
 * @param {string} contractPath - 合约路径（相对于 contracts/）
 * @param {string} contractName - 合约名称
 * @returns {object} { abi, bytecode }

---

## function getChainlessTokenArtifact()

```javascript
function getChainlessTokenArtifact()
```

* 获取 ChainlessToken (ERC-20) artifact

---

## function getChainlessNFTArtifact()

```javascript
function getChainlessNFTArtifact()
```

* 获取 ChainlessNFT (ERC-721) artifact

---

## function getEscrowContractArtifact()

```javascript
function getEscrowContractArtifact()
```

* 获取 EscrowContract artifact

---

## function getSubscriptionContractArtifact()

```javascript
function getSubscriptionContractArtifact()
```

* 获取 SubscriptionContract artifact

---

## function getBountyContractArtifact()

```javascript
function getBountyContractArtifact()
```

* 获取 BountyContract artifact

---

## function getAssetBridgeArtifact()

```javascript
function getAssetBridgeArtifact()
```

* 获取 AssetBridge artifact

---

## function getERC20ABI()

```javascript
function getERC20ABI()
```

* 获取 ERC-20 标准 ABI (用于与任意 ERC-20 代币交互)

---

## function getERC721ABI()

```javascript
function getERC721ABI()
```

* 获取 ERC-721 标准 ABI (用于与任意 NFT 交互)

---

