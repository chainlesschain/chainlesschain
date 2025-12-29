/**
 * 合约 Artifacts 加载器
 *
 * 加载编译后的合约 ABI 和字节码
 */

const path = require('path');
const fs = require('fs');

const ARTIFACTS_DIR = path.join(__dirname, '../../../contracts/artifacts/contracts');

/**
 * 加载合约 artifact
 * @param {string} contractPath - 合约路径（相对于 contracts/）
 * @param {string} contractName - 合约名称
 * @returns {object} { abi, bytecode }
 */
function loadContractArtifact(contractPath, contractName) {
  const artifactPath = path.join(ARTIFACTS_DIR, contractPath, `${contractName}.sol`, `${contractName}.json`);

  if (!fs.existsSync(artifactPath)) {
    throw new Error(`合约 artifact 不存在: ${artifactPath}`);
  }

  const artifact = JSON.parse(fs.readFileSync(artifactPath, 'utf8'));

  return {
    abi: artifact.abi,
    bytecode: artifact.bytecode,
  };
}

/**
 * 获取 ChainlessToken (ERC-20) artifact
 */
function getChainlessTokenArtifact() {
  return loadContractArtifact('tokens', 'ChainlessToken');
}

/**
 * 获取 ChainlessNFT (ERC-721) artifact
 */
function getChainlessNFTArtifact() {
  return loadContractArtifact('tokens', 'ChainlessNFT');
}

/**
 * 获取 EscrowContract artifact
 */
function getEscrowContractArtifact() {
  return loadContractArtifact('marketplace', 'EscrowContract');
}

/**
 * 获取 SubscriptionContract artifact
 */
function getSubscriptionContractArtifact() {
  return loadContractArtifact('payment', 'SubscriptionContract');
}

/**
 * 获取 BountyContract artifact
 */
function getBountyContractArtifact() {
  return loadContractArtifact('payment', 'BountyContract');
}

/**
 * 获取 AssetBridge artifact
 */
function getAssetBridgeArtifact() {
  return loadContractArtifact('bridge', 'AssetBridge');
}

/**
 * 获取 ERC-20 标准 ABI (用于与任意 ERC-20 代币交互)
 */
function getERC20ABI() {
  return [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function decimals() view returns (uint8)',
    'function totalSupply() view returns (uint256)',
    'function balanceOf(address) view returns (uint256)',
    'function transfer(address to, uint256 amount) returns (bool)',
    'function allowance(address owner, address spender) view returns (uint256)',
    'function approve(address spender, uint256 amount) returns (bool)',
    'function transferFrom(address from, address to, uint256 amount) returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 value)',
    'event Approval(address indexed owner, address indexed spender, uint256 value)',
  ];
}

/**
 * 获取 ERC-721 标准 ABI (用于与任意 NFT 交互)
 */
function getERC721ABI() {
  return [
    'function name() view returns (string)',
    'function symbol() view returns (string)',
    'function tokenURI(uint256 tokenId) view returns (string)',
    'function balanceOf(address owner) view returns (uint256)',
    'function ownerOf(uint256 tokenId) view returns (address)',
    'function safeTransferFrom(address from, address to, uint256 tokenId)',
    'function transferFrom(address from, address to, uint256 tokenId)',
    'function approve(address to, uint256 tokenId)',
    'function getApproved(uint256 tokenId) view returns (address)',
    'function setApprovalForAll(address operator, bool approved)',
    'function isApprovedForAll(address owner, address operator) view returns (bool)',
    'event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)',
    'event Approval(address indexed owner, address indexed approved, uint256 indexed tokenId)',
    'event ApprovalForAll(address indexed owner, address indexed operator, bool approved)',
  ];
}

module.exports = {
  loadContractArtifact,
  getChainlessTokenArtifact,
  getChainlessNFTArtifact,
  getEscrowContractArtifact,
  getSubscriptionContractArtifact,
  getBountyContractArtifact,
  getAssetBridgeArtifact,
  getERC20ABI,
  getERC721ABI,
};
