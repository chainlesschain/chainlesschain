/**
 * 区块链适配器集成测试
 *
 * 需要先启动本地 Hardhat 节点:
 * cd desktop-app-vue/contracts && npx hardhat node
 */

const { expect } = require('chai');
const { ethers } = require('ethers');
const EventEmitter = require('events');

// 注意：这里我们需要 mock database 和 walletManager
// 在真实环境中，它们由 main process 提供

// Mock Database
class MockDatabase extends EventEmitter {
  constructor() {
    super();
    this.data = new Map();
  }

  async run(sql, params = []) {
    console.log('[MockDatabase] run:', sql, params);
    return { lastID: Date.now() };
  }

  async get(sql, params = []) {
    console.log('[MockDatabase] get:', sql, params);
    return null;
  }

  async all(sql, params = []) {
    console.log('[MockDatabase] all:', sql, params);
    return [];
  }
}

// Mock WalletManager
class MockWalletManager extends EventEmitter {
  constructor() {
    super();
    // 使用 Hardhat 默认的测试账户
    this.testWallet = ethers.Wallet.createRandom();
    this.provider = null;
    this.connectedWallet = null;
  }

  setProvider(provider) {
    this.provider = provider;
    // 创建一个连接的钱包实例并缓存，这样 nonce 会被正确跟踪
    this.connectedWallet = this.testWallet.connect(provider);
  }

  async unlockWallet(walletId, password) {
    console.log('[MockWalletManager] unlockWallet:', walletId);
    // 始终返回同一个连接的钱包实例，这样 nonce 会被正确管理
    if (this.connectedWallet) {
      return this.connectedWallet;
    }
    return this.testWallet;
  }

  async getWalletAddress(walletId) {
    return this.testWallet.address;
  }
}

// 动态导入需要测试的模块
describe('BlockchainAdapter Integration Tests', function () {
  let BlockchainAdapter;
  let adapter;
  let mockDatabase;
  let mockWalletManager;

  // 增加超时时间，因为区块链操作较慢
  this.timeout(60000);

  before(async function () {
    console.log('\n=== 开始区块链适配器测试 ===\n');
    console.log('⚠️  请确保已启动本地 Hardhat 节点:');
    console.log('   cd desktop-app-vue/contracts && npx hardhat node\n');

    // 等待用户确认
    await new Promise(resolve => setTimeout(resolve, 2000));

    try {
      // 动态加载模块
      BlockchainAdapter = require('../../src/main/blockchain/blockchain-adapter');

      // 创建 mock 对象
      mockDatabase = new MockDatabase();
      mockWalletManager = new MockWalletManager();

      // 创建适配器实例
      adapter = new BlockchainAdapter(mockDatabase, mockWalletManager);
    } catch (error) {
      console.error('❌ 加载模块失败:', error);
      throw error;
    }
  });

  describe('1. 网络初始化和切换', function () {
    it('应该成功初始化适配器', async function () {
      await adapter.initialize();

      expect(adapter.initialized).to.be.true;
      expect(adapter.providers.size).to.be.greaterThan(0);
      expect(adapter.currentChainId).to.exist;

      // 设置 provider 到 mockWalletManager 以便自动管理 nonce
      const provider = adapter.getProvider();
      mockWalletManager.setProvider(provider);

      console.log(`✅ 已初始化 ${adapter.providers.size} 个网络`);
      console.log(`   当前链 ID: ${adapter.currentChainId}`);
    });

    it('应该能够获取当前提供者', function () {
      const provider = adapter.getProvider();
      expect(provider).to.exist;
      expect(provider).to.be.instanceOf(ethers.JsonRpcProvider);
      console.log('✅ 成功获取当前提供者');
    });

    it('应该能够切换网络（如果本地节点可用）', async function () {
      const initialChainId = adapter.currentChainId;

      // 尝试切换到本地 Hardhat 节点 (31337)
      if (adapter.providers.has(31337)) {
        await adapter.switchChain(31337);
        expect(adapter.currentChainId).to.equal(31337);
        console.log(`✅ 成功从链 ${initialChainId} 切换到链 31337`);

        // 切换回去
        await adapter.switchChain(initialChainId);
        expect(adapter.currentChainId).to.equal(initialChainId);
      } else {
        console.log('⚠️  本地 Hardhat 节点未运行，跳过网络切换测试');
        this.skip();
      }
    });

    it('切换到不支持的网络应该抛出错误', async function () {
      try {
        await adapter.switchChain(999999);
        expect.fail('应该抛出错误');
      } catch (error) {
        expect(error.message).to.include('不支持的链');
        console.log('✅ 正确处理无效链 ID');
      }
    });
  });

  describe('2. ERC-20 代币部署', function () {
    let tokenAddress;

    it('应该成功部署 ERC-20 代币（需要本地节点）', async function () {
      // 只在本地 Hardhat 节点上测试
      if (!adapter.providers.has(31337)) {
        console.log('⚠️  本地 Hardhat 节点未运行，跳过部署测试');
        this.skip();
        return;
      }

      // 切换到本地节点
      await adapter.switchChain(31337);

      // 给测试钱包转一些 ETH（从 Hardhat 默认账户）
      const provider = adapter.getProvider();
      const [deployer] = await provider.listAccounts();

      if (deployer) {
        const tx = await deployer.sendTransaction({
          to: mockWalletManager.testWallet.address,
          value: ethers.parseEther('10'),
        });
        await tx.wait();
        console.log('✅ 已向测试钱包转账 10 ETH');
      }

      // 部署代币
      const result = await adapter.deployERC20Token('test-wallet-id', {
        name: 'Test Token',
        symbol: 'TEST',
        decimals: 18,
        initialSupply: '1000000',
        password: 'test-password',
      });

      expect(result.address).to.exist;
      expect(result.txHash).to.exist;
      expect(ethers.isAddress(result.address)).to.be.true;

      tokenAddress = result.address;

      console.log('✅ ERC-20 代币部署成功:');
      console.log(`   地址: ${result.address}`);
      console.log(`   交易: ${result.txHash}`);
    });

    it('应该能够查询代币余额', async function () {
      if (!tokenAddress) {
        this.skip();
        return;
      }

      const ownerAddress = mockWalletManager.testWallet.address;
      const balance = await adapter.getTokenBalance(tokenAddress, ownerAddress);

      expect(balance).to.exist;
      expect(parseFloat(balance)).to.be.greaterThan(0);

      console.log('✅ 代币余额查询成功:');
      console.log(`   地址: ${ownerAddress}`);
      console.log(`   余额: ${balance} TEST`);
    });

    it('应该能够转账代币', async function () {
      if (!tokenAddress) {
        this.skip();
        return;
      }

      // 创建接收地址
      const recipient = ethers.Wallet.createRandom();

      // 转账 100 代币
      const txHash = await adapter.transferToken(
        'test-wallet-id',
        tokenAddress,
        recipient.address,
        '100',
        'test-password'
      );

      expect(txHash).to.exist;
      expect(txHash).to.match(/^0x[a-fA-F0-9]{64}$/);

      console.log('✅ 代币转账成功:');
      console.log(`   接收者: ${recipient.address}`);
      console.log(`   交易: ${txHash}`);

      // 验证余额
      const balance = await adapter.getTokenBalance(tokenAddress, recipient.address);
      expect(balance).to.equal('100.0');
      console.log(`   接收者余额: ${balance} TEST`);
    });
  });

  describe('3. ERC-721 NFT 部署和铸造', function () {
    let nftAddress;

    it('应该成功部署 ERC-721 NFT（需要本地节点）', async function () {
      if (!adapter.providers.has(31337)) {
        console.log('⚠️  本地 Hardhat 节点未运行，跳过 NFT 部署测试');
        this.skip();
        return;
      }

      await adapter.switchChain(31337);

      const result = await adapter.deployNFT('test-wallet-id', {
        name: 'Test NFT',
        symbol: 'TNFT',
        password: 'test-password',
      });

      expect(result.address).to.exist;
      expect(result.txHash).to.exist;
      expect(ethers.isAddress(result.address)).to.be.true;

      nftAddress = result.address;

      console.log('✅ ERC-721 NFT 部署成功:');
      console.log(`   地址: ${result.address}`);
      console.log(`   交易: ${result.txHash}`);
    });

    it('应该能够铸造 NFT', async function () {
      if (!nftAddress) {
        this.skip();
        return;
      }

      const recipient = mockWalletManager.testWallet.address;
      const metadataURI = 'ipfs://QmTest123';

      const result = await adapter.mintNFT(
        'test-wallet-id',
        nftAddress,
        recipient,
        metadataURI,
        'test-password'
      );

      expect(result.tokenId).to.exist;
      expect(result.txHash).to.exist;
      expect(result.tokenId).to.be.a('number');

      console.log('✅ NFT 铸造成功:');
      console.log(`   Token ID: ${result.tokenId}`);
      console.log(`   接收者: ${recipient}`);
      console.log(`   交易: ${result.txHash}`);
    });
  });

  describe('4. 事件监听', function () {
    it('应该能够监听合约事件（需要本地节点）', async function () {
      if (!adapter.providers.has(31337)) {
        console.log('⚠️  本地 Hardhat 节点未运行，跳过事件监听测试');
        this.skip();
        return;
      }

      // 使用之前部署的代币合约
      const { getChainlessTokenArtifact } = require('../../src/main/blockchain/contract-artifacts');
      const { abi } = getChainlessTokenArtifact();

      // 部署一个新的代币用于测试
      const result = await adapter.deployERC20Token('test-wallet-id', {
        name: 'Event Test Token',
        symbol: 'ETT',
        decimals: 18,
        initialSupply: '1000000',
        password: 'test-password',
      });

      const tokenAddress = result.address;

      // 设置事件监听
      let eventReceived = false;
      let eventCount = 0;
      const eventPromise = new Promise((resolve) => {
        adapter.listenToEvents(
          tokenAddress,
          abi,
          'Transfer',
          (eventData) => {
            eventCount++;
            // 第一个事件是部署时的 mint，跳过
            // 等待第二个事件（转账）
            if (eventCount === 2) {
              eventReceived = true;
              console.log('✅ 收到 Transfer 事件:');
              console.log(`   区块: ${eventData.blockNumber || '(pending)'}`);
              console.log(`   交易: ${eventData.transactionHash || '(pending)'}`);
              console.log(`   参数数量: ${eventData.args.length}`);
              resolve(eventData);
            }
          }
        );
      });

      // 等待监听器设置
      await new Promise(resolve => setTimeout(resolve, 1000));

      // 触发一个转账事件
      const recipient = ethers.Wallet.createRandom();
      await adapter.transferToken(
        'test-wallet-id',
        tokenAddress,
        recipient.address,
        '100',
        'test-password'
      );

      // 等待事件（最多 10 秒）
      const eventData = await Promise.race([
        eventPromise,
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('事件超时')), 10000)
        ),
      ]);

      expect(eventReceived).to.be.true;
      expect(eventData.args).to.exist;
      expect(eventData.args.length).to.be.greaterThan(0);

      // 停止监听
      await adapter.stopListening(tokenAddress, abi, 'Transfer');
      console.log('✅ 已停止监听事件');
    });
  });

  describe('5. Gas 估算和价格', function () {
    it('应该能够获取 Gas 价格', async function () {
      if (!adapter.providers.has(31337)) {
        console.log('⚠️  本地 Hardhat 节点未运行，跳过 Gas 测试');
        this.skip();
        return;
      }

      await adapter.switchChain(31337);

      const gasPrice = await adapter.getGasPrice();

      expect(gasPrice).to.exist;
      expect(gasPrice.gasPrice).to.exist;

      console.log('✅ Gas 价格查询成功:');
      console.log(`   gasPrice: ${gasPrice.gasPrice}`);
      if (gasPrice.maxFeePerGas) {
        console.log(`   maxFeePerGas: ${gasPrice.maxFeePerGas}`);
      }
      if (gasPrice.maxPriorityFeePerGas) {
        console.log(`   maxPriorityFeePerGas: ${gasPrice.maxPriorityFeePerGas}`);
      }
    });

    it('应该能够估算 Gas', async function () {
      if (!adapter.providers.has(31337)) {
        this.skip();
        return;
      }

      const recipient = ethers.Wallet.createRandom();
      const tx = {
        to: recipient.address,
        value: ethers.parseEther('1'),
      };

      const gasEstimate = await adapter.estimateGas(tx);

      expect(gasEstimate).to.exist;
      expect(gasEstimate).to.be.a('bigint');
      expect(Number(gasEstimate)).to.be.greaterThan(0);

      console.log('✅ Gas 估算成功:');
      console.log(`   估算值: ${gasEstimate.toString()}`);
    });
  });

  describe('6. 清理资源', function () {
    it('应该能够清理资源', async function () {
      await adapter.cleanup();

      expect(adapter.providers.size).to.equal(0);
      expect(adapter.initialized).to.be.false;

      console.log('✅ 资源清理成功');
    });
  });

  after(function () {
    console.log('\n=== 区块链适配器测试完成 ===\n');
  });
});
