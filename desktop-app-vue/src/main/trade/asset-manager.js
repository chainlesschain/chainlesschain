/**
 * 资产管理器
 *
 * 负责数字资产的管理，包括：
 * - 资产创建（Token、NFT、知识产品等）
 * - 资产转账
 * - 资产销毁
 * - 资产查询
 * - 余额管理
 */

const EventEmitter = require('events');
const { v4: uuidv4 } = require('uuid');

/**
 * 资产类型
 */
const AssetType = {
  TOKEN: 'token',           // 可替代通证
  NFT: 'nft',              // 非同质化代币
  KNOWLEDGE: 'knowledge',   // 知识产品
  SERVICE: 'service',       // 服务凭证
};

/**
 * 转账类型
 */
const TransactionType = {
  TRANSFER: 'transfer',     // 转账
  MINT: 'mint',            // 铸造
  BURN: 'burn',            // 销毁
  TRADE: 'trade',          // 交易
};

/**
 * 资产管理器类
 */
class AssetManager extends EventEmitter {
  constructor(database, didManager, p2pManager) {
    super();

    this.database = database;
    this.didManager = didManager;
    this.p2pManager = p2pManager;

    this.initialized = false;
  }

  /**
   * 初始化资产管理器
   */
  async initialize() {
    console.log('[AssetManager] 初始化资产管理器...');

    try {
      // 初始化数据库表
      await this.initializeTables();

      this.initialized = true;
      console.log('[AssetManager] 资产管理器初始化成功');
    } catch (error) {
      console.error('[AssetManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 初始化数据库表
   */
  async initializeTables() {
    const db = this.database.db;

    // 资产定义表
    db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        id TEXT PRIMARY KEY,
        asset_type TEXT NOT NULL,
        name TEXT NOT NULL,
        symbol TEXT,
        description TEXT,
        metadata TEXT,
        creator_did TEXT NOT NULL,
        total_supply INTEGER DEFAULT 0,
        decimals INTEGER DEFAULT 0,
        created_at INTEGER NOT NULL
      )
    `);

    // 资产持有表
    db.exec(`
      CREATE TABLE IF NOT EXISTS asset_holdings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        asset_id TEXT NOT NULL,
        owner_did TEXT NOT NULL,
        amount INTEGER NOT NULL DEFAULT 0,
        metadata TEXT,
        acquired_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        UNIQUE(asset_id, owner_did)
      )
    `);

    // 资产转账记录表
    db.exec(`
      CREATE TABLE IF NOT EXISTS asset_transfers (
        id TEXT PRIMARY KEY,
        asset_id TEXT NOT NULL,
        from_did TEXT NOT NULL,
        to_did TEXT NOT NULL,
        amount INTEGER NOT NULL,
        transaction_type TEXT NOT NULL,
        transaction_id TEXT,
        memo TEXT,
        created_at INTEGER NOT NULL
      )
    `);

    // 创建索引
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_assets_creator ON assets(creator_did);
      CREATE INDEX IF NOT EXISTS idx_holdings_owner ON asset_holdings(owner_did);
      CREATE INDEX IF NOT EXISTS idx_holdings_asset ON asset_holdings(asset_id);
      CREATE INDEX IF NOT EXISTS idx_transfers_asset ON asset_transfers(asset_id);
      CREATE INDEX IF NOT EXISTS idx_transfers_from ON asset_transfers(from_did);
      CREATE INDEX IF NOT EXISTS idx_transfers_to ON asset_transfers(to_did);
    `);

    console.log('[AssetManager] 数据库表初始化完成');
  }

  /**
   * 创建资产
   * @param {Object} options - 资产选项
   * @param {string} options.type - 资产类型
   * @param {string} options.name - 资产名称
   * @param {string} options.symbol - 资产符号
   * @param {string} options.description - 描述
   * @param {Object} options.metadata - 元数据
   * @param {number} options.totalSupply - 总供应量
   * @param {number} options.decimals - 小数位数
   */
  async createAsset({ type, name, symbol, description, metadata = {}, totalSupply = 0, decimals = 0 }) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录，无法创建资产');
      }

      if (!Object.values(AssetType).includes(type)) {
        throw new Error('无效的资产类型');
      }

      if (!name || name.trim().length === 0) {
        throw new Error('资产名称不能为空');
      }

      // Token 类型需要 symbol
      if (type === AssetType.TOKEN && !symbol) {
        throw new Error('Token 资产必须指定 symbol');
      }

      // NFT 每个都是唯一的，总供应量为 1
      if (type === AssetType.NFT) {
        totalSupply = 1;
      }

      const assetId = uuidv4();
      const now = Date.now();

      const db = this.database.db;

      // 插入资产记录
      db.prepare(`
        INSERT INTO assets
        (id, asset_type, name, symbol, description, metadata, creator_did, total_supply, decimals, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        assetId,
        type,
        name.trim(),
        symbol ? symbol.toUpperCase() : null,
        description || null,
        JSON.stringify(metadata),
        currentDid,
        totalSupply,
        decimals,
        now
      );

      // 如果有初始供应量，铸造给创建者
      if (totalSupply > 0) {
        await this.mintAsset(assetId, currentDid, totalSupply);
      }

      const asset = {
        id: assetId,
        asset_type: type,
        name: name.trim(),
        symbol: symbol ? symbol.toUpperCase() : null,
        description,
        metadata,
        creator_did: currentDid,
        total_supply: totalSupply,
        decimals,
        created_at: now,
      };

      console.log('[AssetManager] 已创建资产:', assetId);

      this.emit('asset:created', { asset });

      return asset;
    } catch (error) {
      console.error('[AssetManager] 创建资产失败:', error);
      throw error;
    }
  }

  /**
   * 铸造资产（增发）
   * @param {string} assetId - 资产 ID
   * @param {string} toDid - 接收者 DID
   * @param {number} amount - 数量
   */
  async mintAsset(assetId, toDid, amount) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      if (amount <= 0) {
        throw new Error('铸造数量必须大于 0');
      }

      const db = this.database.db;

      // 检查资产是否存在
      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);

      if (!asset) {
        throw new Error('资产不存在');
      }

      // 只有创建者可以铸造
      if (asset.creator_did !== currentDid) {
        throw new Error('只有创建者可以铸造资产');
      }

      // NFT 不能铸造
      if (asset.asset_type === AssetType.NFT) {
        throw new Error('NFT 资产不能铸造');
      }

      const now = Date.now();
      const transferId = uuidv4();

      // 更新总供应量
      db.prepare('UPDATE assets SET total_supply = total_supply + ? WHERE id = ?').run(amount, assetId);

      // 更新持有记录
      db.prepare(`
        INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, owner_did) DO UPDATE SET
          amount = amount + ?,
          updated_at = ?
      `).run(assetId, toDid, amount, now, now, amount, now);

      // 记录转账
      db.prepare(`
        INSERT INTO asset_transfers
        (id, asset_id, from_did, to_did, amount, transaction_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(transferId, assetId, 'SYSTEM', toDid, amount, TransactionType.MINT, now);

      console.log('[AssetManager] 已铸造资产:', assetId, amount);

      this.emit('asset:minted', { assetId, toDid, amount });

      return { success: true, transferId };
    } catch (error) {
      console.error('[AssetManager] 铸造资产失败:', error);
      throw error;
    }
  }

  /**
   * 转账资产
   * @param {string} assetId - 资产 ID
   * @param {string} toDid - 接收者 DID
   * @param {number} amount - 数量
   * @param {string} memo - 备注
   */
  async transferAsset(assetId, toDid, amount, memo = '') {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      if (currentDid === toDid) {
        throw new Error('不能转账给自己');
      }

      if (amount <= 0) {
        throw new Error('转账数量必须大于 0');
      }

      const db = this.database.db;

      // 检查资产是否存在
      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);

      if (!asset) {
        throw new Error('资产不存在');
      }

      // 检查余额
      const balance = await this.getBalance(currentDid, assetId);

      if (balance < amount) {
        throw new Error('余额不足');
      }

      const now = Date.now();
      const transferId = uuidv4();

      // 扣除发送者余额
      db.prepare(`
        UPDATE asset_holdings
        SET amount = amount - ?, updated_at = ?
        WHERE asset_id = ? AND owner_did = ?
      `).run(amount, now, assetId, currentDid);

      // 增加接收者余额
      db.prepare(`
        INSERT INTO asset_holdings (asset_id, owner_did, amount, acquired_at, updated_at)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(asset_id, owner_did) DO UPDATE SET
          amount = amount + ?,
          updated_at = ?
      `).run(assetId, toDid, amount, now, now, amount, now);

      // 记录转账
      db.prepare(`
        INSERT INTO asset_transfers
        (id, asset_id, from_did, to_did, amount, transaction_type, memo, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(transferId, assetId, currentDid, toDid, amount, TransactionType.TRANSFER, memo, now);

      console.log('[AssetManager] 已转账资产:', assetId, currentDid, '->', toDid, amount);

      // 通过 P2P 通知接收者
      if (this.p2pManager) {
        try {
          await this.p2pManager.sendEncryptedMessage(toDid, JSON.stringify({
            type: 'asset-transfer',
            transferId,
            assetId,
            fromDid: currentDid,
            amount,
            memo,
            timestamp: now,
          }));
        } catch (error) {
          console.warn('[AssetManager] 通知接收者失败:', error.message);
        }
      }

      this.emit('asset:transferred', { assetId, fromDid: currentDid, toDid, amount });

      return { success: true, transferId };
    } catch (error) {
      console.error('[AssetManager] 转账失败:', error);
      throw error;
    }
  }

  /**
   * 销毁资产
   * @param {string} assetId - 资产 ID
   * @param {number} amount - 数量
   */
  async burnAsset(assetId, amount) {
    try {
      const currentDid = this.didManager?.getCurrentIdentity()?.did;

      if (!currentDid) {
        throw new Error('未登录');
      }

      if (amount <= 0) {
        throw new Error('销毁数量必须大于 0');
      }

      const db = this.database.db;

      // 检查资产是否存在
      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);

      if (!asset) {
        throw new Error('资产不存在');
      }

      // 检查余额
      const balance = await this.getBalance(currentDid, assetId);

      if (balance < amount) {
        throw new Error('余额不足');
      }

      const now = Date.now();
      const transferId = uuidv4();

      // 扣除余额
      db.prepare(`
        UPDATE asset_holdings
        SET amount = amount - ?, updated_at = ?
        WHERE asset_id = ? AND owner_did = ?
      `).run(amount, now, assetId, currentDid);

      // 更新总供应量
      db.prepare('UPDATE assets SET total_supply = total_supply - ? WHERE id = ?').run(amount, assetId);

      // 记录转账
      db.prepare(`
        INSERT INTO asset_transfers
        (id, asset_id, from_did, to_did, amount, transaction_type, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(transferId, assetId, currentDid, 'BURNED', amount, TransactionType.BURN, now);

      console.log('[AssetManager] 已销毁资产:', assetId, amount);

      this.emit('asset:burned', { assetId, fromDid: currentDid, amount });

      return { success: true, transferId };
    } catch (error) {
      console.error('[AssetManager] 销毁资产失败:', error);
      throw error;
    }
  }

  /**
   * 获取资产信息
   * @param {string} assetId - 资产 ID
   */
  async getAsset(assetId) {
    try {
      const db = this.database.db;
      const asset = db.prepare('SELECT * FROM assets WHERE id = ?').get(assetId);

      if (!asset) {
        return null;
      }

      return {
        ...asset,
        metadata: asset.metadata ? JSON.parse(asset.metadata) : {},
      };
    } catch (error) {
      console.error('[AssetManager] 获取资产失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户的所有资产
   * @param {string} ownerDid - 所有者 DID
   */
  async getAssetsByOwner(ownerDid) {
    try {
      const db = this.database.db;

      const holdings = db.prepare(`
        SELECT
          h.*,
          a.asset_type,
          a.name,
          a.symbol,
          a.description,
          a.metadata,
          a.decimals
        FROM asset_holdings h
        JOIN assets a ON h.asset_id = a.id
        WHERE h.owner_did = ? AND h.amount > 0
        ORDER BY h.updated_at DESC
      `).all(ownerDid);

      return holdings.map(h => ({
        ...h,
        metadata: h.metadata ? JSON.parse(h.metadata) : {},
      }));
    } catch (error) {
      console.error('[AssetManager] 获取资产列表失败:', error);
      throw error;
    }
  }

  /**
   * 获取资产历史记录
   * @param {string} assetId - 资产 ID
   * @param {number} limit - 限制数量
   */
  async getAssetHistory(assetId, limit = 100) {
    try {
      const db = this.database.db;

      return db.prepare(`
        SELECT * FROM asset_transfers
        WHERE asset_id = ?
        ORDER BY created_at DESC
        LIMIT ?
      `).all(assetId, limit);
    } catch (error) {
      console.error('[AssetManager] 获取资产历史失败:', error);
      throw error;
    }
  }

  /**
   * 获取用户余额
   * @param {string} ownerDid - 所有者 DID
   * @param {string} assetId - 资产 ID
   */
  async getBalance(ownerDid, assetId) {
    try {
      const db = this.database.db;

      const holding = db.prepare(`
        SELECT amount FROM asset_holdings
        WHERE owner_did = ? AND asset_id = ?
      `).get(ownerDid, assetId);

      return holding ? holding.amount : 0;
    } catch (error) {
      console.error('[AssetManager] 获取余额失败:', error);
      return 0;
    }
  }

  /**
   * 获取所有资产列表
   * @param {Object} filters - 筛选条件
   */
  async getAllAssets(filters = {}) {
    try {
      const db = this.database.db;

      let query = 'SELECT * FROM assets WHERE 1=1';
      const params = [];

      if (filters.type) {
        query += ' AND asset_type = ?';
        params.push(filters.type);
      }

      if (filters.creatorDid) {
        query += ' AND creator_did = ?';
        params.push(filters.creatorDid);
      }

      query += ' ORDER BY created_at DESC';

      if (filters.limit) {
        query += ' LIMIT ?';
        params.push(filters.limit);
      }

      const assets = db.prepare(query).all(...params);

      return assets.map(a => ({
        ...a,
        metadata: a.metadata ? JSON.parse(a.metadata) : {},
      }));
    } catch (error) {
      console.error('[AssetManager] 获取资产列表失败:', error);
      throw error;
    }
  }

  /**
   * 关闭资产管理器
   */
  async close() {
    console.log('[AssetManager] 关闭资产管理器');

    this.removeAllListeners();
    this.initialized = false;
  }
}

module.exports = {
  AssetManager,
  AssetType,
  TransactionType,
};
