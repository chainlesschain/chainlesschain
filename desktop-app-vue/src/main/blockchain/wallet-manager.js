/**
 * 钱包管理器
 *
 * 负责管理内置钱包和外部钱包的所有操作
 * 功能：
 * - 生成HD钱包（BIP39助记词）
 * - 从助记词/私钥导入钱包
 * - 解锁钱包（验证密码）
 * - 签名交易（支持U-Key硬件签名）
 * - 余额查询
 */

const { logger, createLogger } = require('../utils/logger.js');
const EventEmitter = require('events');
const { ethers } = require('ethers');
const { v4: uuidv4 } = require('uuid');
const bip39 = require('bip39');
const HDKey = require('hdkey');
const crypto = require('crypto');

/**
 * 钱包类型
 */
const WalletType = {
  INTERNAL: 'internal', // 内置钱包
  EXTERNAL: 'external', // 外部钱包（MetaMask/WalletConnect）
};

/**
 * 钱包提供者
 */
const WalletProvider = {
  BUILTIN: 'builtin', // 内置
  METAMASK: 'metamask', // MetaMask
  WALLETCONNECT: 'walletconnect', // WalletConnect
};

/**
 * 加密算法配置
 */
const ENCRYPTION_CONFIG = {
  algorithm: 'aes-256-gcm',
  keyLength: 32,
  ivLength: 16,
  saltLength: 64,
  tagLength: 16,
  iterations: 100000, // PBKDF2 迭代次数
};

class WalletManager extends EventEmitter {
  constructor(database, ukeyManager = null, blockchainAdapter = null) {
    super();

    this.database = database;
    this.ukeyManager = ukeyManager;
    this.blockchainAdapter = blockchainAdapter;

    // 缓存解锁的钱包 (walletId => ethers.Wallet)
    this.unlockedWallets = new Map();

    // HD 钱包派生路径（BIP44 标准）
    this.derivationPath = "m/44'/60'/0'/0/0"; // Ethereum 默认路径

    this.initialized = false;
  }

  /**
   * 初始化钱包管理器
   */
  async initialize() {
    logger.info('[WalletManager] 初始化钱包管理器...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      this.initialized = true;
      logger.info('[WalletManager] 钱包管理器初始化成功');
    } catch (error) {
      logger.error('[WalletManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 表已在 database.js 中创建，这里只做验证
    try {
      db.prepare('SELECT 1 FROM blockchain_wallets LIMIT 1').get();
    } catch (error) {
      throw new Error('blockchain_wallets 表未创建，请先运行数据库迁移');
    }
  }

  /**
   * 生成新钱包（HD钱包）
   * @param {string} password - 密码（用于加密私钥）
   * @param {string} chainId - 链ID（默认以太坊主网）
   * @returns {Promise<object>} 钱包信息 {id, address, mnemonic}
   */
  async createWallet(password, chainId = 1) {
    if (!password || password.length < 8) {
      throw new Error('密码长度不能少于8位');
    }

    try {
      // 1. 生成 BIP39 助记词（12个单词）
      const mnemonic = bip39.generateMnemonic();

      // 2. 从助记词派生私钥
      const hdNode = HDKey.fromMasterSeed(await bip39.mnemonicToSeed(mnemonic));
      const addrNode = hdNode.derive(this.derivationPath);
      const privateKey = addrNode.privateKey.toString('hex');

      // 3. 创建 ethers.Wallet
      const wallet = new ethers.Wallet('0x' + privateKey);
      const address = wallet.address;

      // 4. 加密私钥和助记词
      const encryptedPrivateKey = this._encryptData(privateKey, password);
      const encryptedMnemonic = this._encryptData(mnemonic, password);

      // 5. 保存到数据库
      const walletId = uuidv4();
      const createdAt = Date.now();

      const db = this.database.db;
      const stmt = db.prepare(`
        INSERT INTO blockchain_wallets (
          id, address, wallet_type, provider, encrypted_private_key,
          mnemonic_encrypted, derivation_path, chain_id, is_default, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      // 如果是第一个钱包，设为默认
      const existingWallets = await this.getAllWallets();
      const isDefault = existingWallets.length === 0 ? 1 : 0;

      stmt.run(
        walletId,
        address,
        WalletType.INTERNAL,
        WalletProvider.BUILTIN,
        encryptedPrivateKey,
        encryptedMnemonic,
        this.derivationPath,
        chainId,
        isDefault,
        createdAt
      );

      logger.info(`[WalletManager] 创建钱包成功: ${address}`);

      this.emit('wallet:created', { walletId, address });

      return {
        id: walletId,
        address,
        mnemonic, // 注意：返回明文助记词供用户备份
        chainId,
        createdAt,
      };
    } catch (error) {
      logger.error('[WalletManager] 创建钱包失败:', error);
      throw error;
    }
  }

  /**
   * 从助记词导入钱包
   * @param {string} mnemonic - 助记词
   * @param {string} password - 密码
   * @param {number} chainId - 链ID
   * @returns {Promise<object>} 钱包信息
   */
  async importFromMnemonic(mnemonic, password, chainId = 1) {
    if (!password || password.length < 8) {
      throw new Error('密码长度不能少于8位');
    }

    // 验证助记词
    if (!bip39.validateMnemonic(mnemonic)) {
      throw new Error('无效的助记词');
    }

    try {
      // 从助记词派生私钥
      const hdNode = HDKey.fromMasterSeed(await bip39.mnemonicToSeed(mnemonic));
      const addrNode = hdNode.derive(this.derivationPath);
      const privateKey = addrNode.privateKey.toString('hex');

      // 创建钱包
      const wallet = new ethers.Wallet('0x' + privateKey);
      const address = wallet.address;

      // 检查是否已存在
      const existing = await this.getWalletByAddress(address);
      if (existing) {
        throw new Error('该钱包已存在');
      }

      // 加密私钥和助记词
      const encryptedPrivateKey = this._encryptData(privateKey, password);
      const encryptedMnemonic = this._encryptData(mnemonic, password);

      // 保存到数据库
      const walletId = uuidv4();
      const createdAt = Date.now();

      const db = this.database.db;
      const stmt = db.prepare(`
        INSERT INTO blockchain_wallets (
          id, address, wallet_type, provider, encrypted_private_key,
          mnemonic_encrypted, derivation_path, chain_id, is_default, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const existingWallets = await this.getAllWallets();
      const isDefault = existingWallets.length === 0 ? 1 : 0;

      stmt.run(
        walletId,
        address,
        WalletType.INTERNAL,
        WalletProvider.BUILTIN,
        encryptedPrivateKey,
        encryptedMnemonic,
        this.derivationPath,
        chainId,
        isDefault,
        createdAt
      );

      logger.info(`[WalletManager] 导入钱包成功: ${address}`);

      this.emit('wallet:imported', { walletId, address });

      return {
        id: walletId,
        address,
        chainId,
        createdAt,
      };
    } catch (error) {
      logger.error('[WalletManager] 导入钱包失败:', error);
      throw error;
    }
  }

  /**
   * 从私钥导入钱包
   * @param {string} privateKey - 私钥（带或不带 0x 前缀）
   * @param {string} password - 密码
   * @param {number} chainId - 链ID
   * @returns {Promise<object>} 钱包信息
   */
  async importFromPrivateKey(privateKey, password, chainId = 1) {
    if (!password || password.length < 8) {
      throw new Error('密码长度不能少于8位');
    }

    try {
      // 规范化私钥格式
      const normalizedPrivateKey = privateKey.startsWith('0x') ? privateKey : '0x' + privateKey;

      // 验证私钥
      let wallet;
      try {
        wallet = new ethers.Wallet(normalizedPrivateKey);
      } catch (error) {
        throw new Error('无效的私钥');
      }

      const address = wallet.address;

      // 检查是否已存在
      const existing = await this.getWalletByAddress(address);
      if (existing) {
        throw new Error('该钱包已存在');
      }

      // 加密私钥（去除 0x 前缀）
      const pkToStore = normalizedPrivateKey.substring(2);
      const encryptedPrivateKey = this._encryptData(pkToStore, password);

      // 保存到数据库
      const walletId = uuidv4();
      const createdAt = Date.now();

      const db = this.database.db;
      const stmt = db.prepare(`
        INSERT INTO blockchain_wallets (
          id, address, wallet_type, provider, encrypted_private_key,
          derivation_path, chain_id, is_default, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `);

      const existingWallets = await this.getAllWallets();
      const isDefault = existingWallets.length === 0 ? 1 : 0;

      stmt.run(
        walletId,
        address,
        WalletType.INTERNAL,
        WalletProvider.BUILTIN,
        encryptedPrivateKey,
        null, // 没有助记词
        chainId,
        isDefault,
        createdAt
      );

      logger.info(`[WalletManager] 从私钥导入钱包成功: ${address}`);

      this.emit('wallet:imported', { walletId, address });

      return {
        id: walletId,
        address,
        chainId,
        createdAt,
      };
    } catch (error) {
      logger.error('[WalletManager] 从私钥导入失败:', error);
      throw error;
    }
  }

  /**
   * 解锁钱包
   * @param {string} walletId - 钱包ID
   * @param {string} password - 密码
   * @returns {Promise<ethers.Wallet>} 解锁的钱包实例
   */
  async unlockWallet(walletId, password) {
    // 检查是否已解锁
    if (this.unlockedWallets.has(walletId)) {
      return this.unlockedWallets.get(walletId);
    }

    try {
      // 从数据库读取钱包
      const walletData = await this.getWallet(walletId);
      if (!walletData) {
        throw new Error('钱包不存在');
      }

      if (walletData.wallet_type !== WalletType.INTERNAL) {
        throw new Error('只能解锁内置钱包');
      }

      // 解密私钥
      const privateKey = this._decryptData(walletData.encrypted_private_key, password);

      // 创建 ethers.Wallet 实例
      const wallet = new ethers.Wallet('0x' + privateKey);

      // 验证地址是否匹配
      if (wallet.address.toLowerCase() !== walletData.address.toLowerCase()) {
        throw new Error('密码错误或钱包数据损坏');
      }

      // 缓存钱包
      this.unlockedWallets.set(walletId, wallet);

      logger.info(`[WalletManager] 解锁钱包成功: ${wallet.address}`);

      this.emit('wallet:unlocked', { walletId, address: wallet.address });

      return wallet;
    } catch (error) {
      if (error.message.includes('Unsupported state or unable to authenticate')) {
        throw new Error('密码错误');
      }
      logger.error('[WalletManager] 解锁钱包失败:', error);
      throw error;
    }
  }

  /**
   * 锁定钱包
   * @param {string} walletId - 钱包ID
   */
  lockWallet(walletId) {
    this.unlockedWallets.delete(walletId);
    this.emit('wallet:locked', { walletId });
    logger.info(`[WalletManager] 锁定钱包: ${walletId}`);
  }

  /**
   * 签名交易
   * @param {string} walletId - 钱包ID
   * @param {object} transaction - 交易对象
   * @param {boolean} useUKey - 是否使用U-Key签名
   * @returns {Promise<string>} 签名后的交易
   */
  async signTransaction(walletId, transaction, useUKey = false) {
    try {
      if (useUKey && this.ukeyManager) {
        // 使用 U-Key 签名
        return await this._signWithUKey(walletId, transaction);
      } else {
        // 使用软件钱包签名
        const wallet = this.unlockedWallets.get(walletId);
        if (!wallet) {
          throw new Error('钱包未解锁，请先解锁钱包');
        }

        // 连接到提供者
        if (this.blockchainAdapter) {
          const provider = this.blockchainAdapter.getProvider();
          const connectedWallet = wallet.connect(provider);
          return await connectedWallet.signTransaction(transaction);
        } else {
          return await wallet.signTransaction(transaction);
        }
      }
    } catch (error) {
      logger.error('[WalletManager] 签名交易失败:', error);
      throw error;
    }
  }

  /**
   * 签名消息
   * @param {string} walletId - 钱包ID
   * @param {string} message - 消息
   * @param {boolean} useUKey - 是否使用U-Key签名
   * @returns {Promise<string>} 签名
   */
  async signMessage(walletId, message, useUKey = false) {
    try {
      if (useUKey && this.ukeyManager) {
        // 使用 U-Key 签名消息
        return await this._signMessageWithUKey(walletId, message);
      } else {
        // 使用软件钱包签名
        const wallet = this.unlockedWallets.get(walletId);
        if (!wallet) {
          throw new Error('钱包未解锁，请先解锁钱包');
        }

        return await wallet.signMessage(message);
      }
    } catch (error) {
      logger.error('[WalletManager] 签名消息失败:', error);
      throw error;
    }
  }

  /**
   * 使用 U-Key 签名交易
   * @private
   */
  async _signWithUKey(walletId, transaction) {
    if (!this.ukeyManager) {
      throw new Error('U-Key 管理器未初始化');
    }

    try {
      // 1. 获取钱包信息
      const walletData = await this.getWallet(walletId);
      if (!walletData) {
        throw new Error('钱包不存在');
      }

      // 2. 序列化交易（使用 ethers.js 的序列化）
      const unsignedTx = ethers.Transaction.from(transaction);
      const txHash = unsignedTx.unsignedHash;

      logger.info('[WalletManager] 交易哈希:', txHash);

      // 3. 使用 U-Key 签名哈希
      // 将十六进制哈希转换为 Buffer
      const hashBuffer = Buffer.from(txHash.substring(2), 'hex');

      // 调用 U-Key 签名
      const ukeySignature = await this.ukeyManager.sign(hashBuffer);

      // 4. 将 U-Key 签名转换为以太坊签名格式
      // U-Key 返回的签名格式通常是 DER 或 原始 r,s 格式
      // 这里需要根据实际的 U-Key 返回格式进行转换

      // 假设 ukeySignature 是一个包含 r, s 的对象或 Buffer
      // 需要添加 v 值（恢复 ID）
      let signature;

      if (Buffer.isBuffer(ukeySignature)) {
        // 如果是 Buffer，假设是 64 字节 (r: 32字节, s: 32字节)
        const r = '0x' + ukeySignature.subarray(0, 32).toString('hex');
        const s = '0x' + ukeySignature.subarray(32, 64).toString('hex');

        // 尝试恢复正确的 v 值
        for (const v of [27, 28]) {
          try {
            const sig = ethers.Signature.from({ r, s, v });
            const recoveredAddress = ethers.recoverAddress(txHash, sig);

            if (recoveredAddress.toLowerCase() === walletData.address.toLowerCase()) {
              signature = sig;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!signature) {
          throw new Error('无法从 U-Key 签名中恢复地址');
        }
      } else if (ukeySignature.signature) {
        // 如果返回的是字符串签名
        signature = ethers.Signature.from(ukeySignature.signature);
      } else {
        throw new Error('不支持的 U-Key 签名格式');
      }

      // 5. 组装签名后的交易
      unsignedTx.signature = signature;
      const signedTx = unsignedTx.serialized;

      logger.info('[WalletManager] U-Key 签名交易成功');

      return signedTx;
    } catch (error) {
      logger.error('[WalletManager] U-Key 签名交易失败:', error);
      throw error;
    }
  }

  /**
   * 使用 U-Key 签名消息
   * @private
   */
  async _signMessageWithUKey(walletId, message) {
    if (!this.ukeyManager) {
      throw new Error('U-Key 管理器未初始化');
    }

    try {
      // 1. 获取钱包信息
      const walletData = await this.getWallet(walletId);
      if (!walletData) {
        throw new Error('钱包不存在');
      }

      // 2. 计算消息哈希（符合 EIP-191 标准）
      const messageHash = ethers.hashMessage(message);

      logger.info('[WalletManager] 消息哈希:', messageHash);

      // 3. 使用 U-Key 签名哈希
      const hashBuffer = Buffer.from(messageHash.substring(2), 'hex');
      const ukeySignature = await this.ukeyManager.sign(hashBuffer);

      // 4. 将 U-Key 签名转换为以太坊签名格式
      let signature;

      if (Buffer.isBuffer(ukeySignature)) {
        // 64 字节签名 (r: 32, s: 32)
        const r = '0x' + ukeySignature.subarray(0, 32).toString('hex');
        const s = '0x' + ukeySignature.subarray(32, 64).toString('hex');

        // 尝试恢复正确的 v 值
        for (const v of [27, 28]) {
          try {
            const sig = ethers.Signature.from({ r, s, v });
            const recoveredAddress = ethers.recoverAddress(messageHash, sig);

            if (recoveredAddress.toLowerCase() === walletData.address.toLowerCase()) {
              signature = sig.serialized;
              break;
            }
          } catch (e) {
            continue;
          }
        }

        if (!signature) {
          throw new Error('无法从 U-Key 签名中恢复地址');
        }
      } else if (ukeySignature.signature) {
        signature = ukeySignature.signature;
      } else {
        throw new Error('不支持的 U-Key 签名格式');
      }

      logger.info('[WalletManager] U-Key 签名消息成功');

      return signature;
    } catch (error) {
      logger.error('[WalletManager] U-Key 签名消息失败:', error);
      throw error;
    }
  }

  /**
   * 获取余额
   * @param {string} address - 地址
   * @param {number} chainId - 链ID
   * @param {string|null} tokenAddress - 代币合约地址（null表示原生币）
   * @returns {Promise<string>} 余额（字符串）
   */
  async getBalance(address, chainId, tokenAddress = null) {
    if (!this.blockchainAdapter) {
      throw new Error('BlockchainAdapter 未初始化');
    }

    try {
      // 切换到目标链
      if (this.blockchainAdapter.currentChainId !== chainId) {
        await this.blockchainAdapter.switchChain(chainId);
      }

      const provider = this.blockchainAdapter.getProvider();

      if (!tokenAddress) {
        // 查询原生币余额（ETH/MATIC）
        const balance = await provider.getBalance(address);
        return ethers.formatEther(balance);
      } else {
        // 查询 ERC-20 代币余额
        const tokenContract = new ethers.Contract(
          tokenAddress,
          ['function balanceOf(address) view returns (uint256)'],
          provider
        );

        const balance = await tokenContract.balanceOf(address);
        return balance.toString();
      }
    } catch (error) {
      logger.error('[WalletManager] 获取余额失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有钱包
   * @returns {Promise<array>} 钱包列表
   */
  async getAllWallets() {
    const db = this.database.db;
    const stmt = db.prepare(`
      SELECT id, address, wallet_type, provider, chain_id, is_default, created_at
      FROM blockchain_wallets
      ORDER BY is_default DESC, created_at DESC
    `);
    return stmt.all();
  }

  /**
   * 获取钱包详情
   * @param {string} walletId - 钱包ID
   * @returns {Promise<object>} 钱包详情
   */
  async getWallet(walletId) {
    const db = this.database.db;
    const stmt = db.prepare('SELECT * FROM blockchain_wallets WHERE id = ?');
    return stmt.get(walletId);
  }

  /**
   * 根据地址获取钱包
   * @param {string} address - 地址
   * @returns {Promise<object>} 钱包详情
   */
  async getWalletByAddress(address) {
    const db = this.database.db;
    const stmt = db.prepare('SELECT * FROM blockchain_wallets WHERE LOWER(address) = LOWER(?)');
    return stmt.get(address);
  }

  /**
   * 设置默认钱包
   * @param {string} walletId - 钱包ID
   */
  async setDefaultWallet(walletId) {
    const db = this.database.db;

    db.transaction(() => {
      // 取消所有默认钱包
      db.prepare('UPDATE blockchain_wallets SET is_default = 0').run();

      // 设置新的默认钱包
      db.prepare('UPDATE blockchain_wallets SET is_default = 1 WHERE id = ?').run(walletId);
    })();

    this.emit('wallet:default-changed', { walletId });
    logger.info(`[WalletManager] 设置默认钱包: ${walletId}`);
  }

  /**
   * 删除钱包
   * @param {string} walletId - 钱包ID
   */
  async deleteWallet(walletId) {
    const db = this.database.db;

    // 先锁定钱包
    this.lockWallet(walletId);

    // 从数据库删除
    db.prepare('DELETE FROM blockchain_wallets WHERE id = ?').run(walletId);

    this.emit('wallet:deleted', { walletId });
    logger.info(`[WalletManager] 删除钱包: ${walletId}`);
  }

  /**
   * 导出私钥
   * @param {string} walletId - 钱包ID
   * @param {string} password - 密码
   * @returns {Promise<string>} 私钥（带 0x 前缀）
   */
  async exportPrivateKey(walletId, password) {
    try {
      const walletData = await this.getWallet(walletId);
      if (!walletData) {
        throw new Error('钱包不存在');
      }

      if (walletData.wallet_type !== WalletType.INTERNAL) {
        throw new Error('只能导出内置钱包的私钥');
      }

      // 解密私钥
      const privateKey = this._decryptData(walletData.encrypted_private_key, password);

      return '0x' + privateKey;
    } catch (error) {
      if (error.message.includes('Unsupported state or unable to authenticate')) {
        throw new Error('密码错误');
      }
      logger.error('[WalletManager] 导出私钥失败:', error);
      throw error;
    }
  }

  /**
   * 导出助记词
   * @param {string} walletId - 钱包ID
   * @param {string} password - 密码
   * @returns {Promise<string>} 助记词
   */
  async exportMnemonic(walletId, password) {
    try {
      const walletData = await this.getWallet(walletId);
      if (!walletData) {
        throw new Error('钱包不存在');
      }

      if (!walletData.mnemonic_encrypted) {
        throw new Error('该钱包没有助记词（可能是从私钥导入的）');
      }

      // 解密助记词
      const mnemonic = this._decryptData(walletData.mnemonic_encrypted, password);

      return mnemonic;
    } catch (error) {
      if (error.message.includes('Unsupported state or unable to authenticate')) {
        throw new Error('密码错误');
      }
      logger.error('[WalletManager] 导出助记词失败:', error);
      throw error;
    }
  }

  /**
   * 加密数据
   * @param {string} data - 原始数据
   * @param {string} password - 密码
   * @returns {string} 加密后的数据（Base64）
   */
  _encryptData(data, password) {
    try {
      // 生成盐
      const salt = crypto.randomBytes(ENCRYPTION_CONFIG.saltLength);

      // 从密码派生密钥
      const key = crypto.pbkdf2Sync(
        password,
        salt,
        ENCRYPTION_CONFIG.iterations,
        ENCRYPTION_CONFIG.keyLength,
        'sha256'
      );

      // 生成初始化向量
      const iv = crypto.randomBytes(ENCRYPTION_CONFIG.ivLength);

      // 创建加密器
      const cipher = crypto.createCipheriv(ENCRYPTION_CONFIG.algorithm, key, iv);

      // 加密数据
      let encrypted = cipher.update(data, 'utf8', 'hex');
      encrypted += cipher.final('hex');

      // 获取认证标签
      const tag = cipher.getAuthTag();

      // 组合: salt(64) + iv(16) + tag(16) + encrypted
      const combined = Buffer.concat([
        salt,
        iv,
        tag,
        Buffer.from(encrypted, 'hex'),
      ]);

      return combined.toString('base64');
    } catch (error) {
      logger.error('[WalletManager] 加密失败:', error);
      throw new Error('数据加密失败');
    }
  }

  /**
   * 解密数据
   * @param {string} encryptedData - 加密数据（Base64）
   * @param {string} password - 密码
   * @returns {string} 解密后的数据
   */
  _decryptData(encryptedData, password) {
    try {
      // 解码 Base64
      const combined = Buffer.from(encryptedData, 'base64');

      // 提取各部分
      const salt = combined.subarray(0, ENCRYPTION_CONFIG.saltLength);
      const iv = combined.subarray(
        ENCRYPTION_CONFIG.saltLength,
        ENCRYPTION_CONFIG.saltLength + ENCRYPTION_CONFIG.ivLength
      );
      const tag = combined.subarray(
        ENCRYPTION_CONFIG.saltLength + ENCRYPTION_CONFIG.ivLength,
        ENCRYPTION_CONFIG.saltLength + ENCRYPTION_CONFIG.ivLength + ENCRYPTION_CONFIG.tagLength
      );
      const encrypted = combined.subarray(
        ENCRYPTION_CONFIG.saltLength + ENCRYPTION_CONFIG.ivLength + ENCRYPTION_CONFIG.tagLength
      );

      // 从密码派生密钥
      const key = crypto.pbkdf2Sync(
        password,
        salt,
        ENCRYPTION_CONFIG.iterations,
        ENCRYPTION_CONFIG.keyLength,
        'sha256'
      );

      // 创建解密器
      const decipher = crypto.createDecipheriv(ENCRYPTION_CONFIG.algorithm, key, iv);
      decipher.setAuthTag(tag);

      // 解密数据
      let decrypted = decipher.update(encrypted, undefined, 'utf8');
      decrypted += decipher.final('utf8');

      return decrypted;
    } catch (error) {
      logger.error('[WalletManager] 解密失败:', error);
      throw new Error('数据解密失败（密码可能错误）');
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    logger.info('[WalletManager] 清理资源...');

    // 锁定所有钱包
    this.unlockedWallets.clear();

    this.initialized = false;
  }
}

module.exports = {
  WalletManager,
  WalletType,
  WalletProvider,
};
