/**
 * DID 自动更新管理器
 *
 * 自动检测并更新DID文档变更
 *
 * 功能:
 * - DID文档版本管理
 * - 自动重新发布
 * - 变更通知机制
 * - 冲突解决
 */

const EventEmitter = require('events');

/**
 * DID更新器配置
 */
const DEFAULT_CONFIG = {
  updateInterval: 24 * 60 * 60 * 1000,  // 更新检查间隔 (24小时)
  autoRepublish: true,                   // 自动重新发布
  republishInterval: 24 * 60 * 60 * 1000, // 重新发布间隔 (24小时)
  enableVersioning: true,                 // 启用版本管理
  maxVersionHistory: 10,                  // 最大版本历史数量
};

/**
 * DID自动更新器类
 */
class DIDUpdater extends EventEmitter {
  constructor(didManager, p2pManager, config = {}) {
    super();

    this.didManager = didManager;
    this.p2pManager = p2pManager;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // 更新定时器
    this.updateTimers = new Map();

    // 重新发布定时器
    this.republishTimers = new Map();

    console.log('[DIDUpdater] DID自动更新器已创建');
  }

  /**
   * 初始化更新器
   */
  async initialize() {
    console.log('[DIDUpdater] 初始化DID自动更新器...');

    try {
      // 确保版本历史表存在
      if (this.config.enableVersioning) {
        await this.ensureVersionHistoryTable();
      }

      console.log('[DIDUpdater] DID自动更新器初始化成功');
      this.emit('initialized');

      return true;
    } catch (error) {
      console.error('[DIDUpdater] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保版本历史表存在
   */
  async ensureVersionHistoryTable() {
    try {
      this.didManager.db.exec(`
        CREATE TABLE IF NOT EXISTS did_version_history (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          did TEXT NOT NULL,
          version INTEGER NOT NULL,
          document TEXT NOT NULL,
          changes TEXT,
          updated_at INTEGER NOT NULL,
          UNIQUE(did, version)
        )
      `);

      // 创建索引
      this.didManager.db.exec(`
        CREATE INDEX IF NOT EXISTS idx_did_version_history_did
        ON did_version_history(did, version DESC)
      `);

      console.log('[DIDUpdater] 版本历史表已就绪');
    } catch (error) {
      console.error('[DIDUpdater] 创建版本历史表失败:', error);
      throw error;
    }
  }

  /**
   * 启动自动更新
   * @param {string} did - DID标识符
   */
  startAutoUpdate(did) {
    if (this.updateTimers.has(did)) {
      console.log(`[DIDUpdater] DID ${did} 已启动自动更新`);
      return;
    }

    const timer = setInterval(async () => {
      try {
        await this.checkAndUpdate(did);
      } catch (error) {
        console.error(`[DIDUpdater] DID ${did} 自动更新失败:`, error);
        this.emit('update-error', { did, error });
      }
    }, this.config.updateInterval);

    this.updateTimers.set(did, timer);

    console.log(`[DIDUpdater] 已启动 DID ${did} 的自动更新`);
    this.emit('auto-update-started', { did });
  }

  /**
   * 停止自动更新
   * @param {string} did - DID标识符
   */
  stopAutoUpdate(did) {
    const timer = this.updateTimers.get(did);
    if (timer) {
      clearInterval(timer);
      this.updateTimers.delete(did);

      console.log(`[DIDUpdater] 已停止 DID ${did} 的自动更新`);
      this.emit('auto-update-stopped', { did });
    }
  }

  /**
   * 启动自动重新发布
   * @param {string} did - DID标识符
   */
  startAutoRepublish(did) {
    if (!this.config.autoRepublish) {
      return;
    }

    if (this.republishTimers.has(did)) {
      console.log(`[DIDUpdater] DID ${did} 已启动自动重新发布`);
      return;
    }

    const timer = setInterval(async () => {
      try {
        await this.republish(did);
      } catch (error) {
        console.error(`[DIDUpdater] DID ${did} 自动重新发布失败:`, error);
        this.emit('republish-error', { did, error });
      }
    }, this.config.republishInterval);

    this.republishTimers.set(did, timer);

    console.log(`[DIDUpdater] 已启动 DID ${did} 的自动重新发布`);
    this.emit('auto-republish-started', { did });
  }

  /**
   * 停止自动重新发布
   * @param {string} did - DID标识符
   */
  stopAutoRepublish(did) {
    const timer = this.republishTimers.get(did);
    if (timer) {
      clearInterval(timer);
      this.republishTimers.delete(did);

      console.log(`[DIDUpdater] 已停止 DID ${did} 的自动重新发布`);
      this.emit('auto-republish-stopped', { did });
    }
  }

  /**
   * 检查并更新DID
   * @param {string} did - DID标识符
   */
  async checkAndUpdate(did) {
    console.log(`[DIDUpdater] 检查 DID ${did} 的更新...`);

    try {
      // 1. 从DHT获取最新版本
      const remoteDID = await this.didManager.resolveFromDHT(did);

      if (!remoteDID) {
        console.log(`[DIDUpdater] DHT中未找到 DID ${did}`);
        return { updated: false, reason: 'not-found-in-dht' };
      }

      // 2. 获取本地版本
      const localIdentity = this.didManager.getIdentityByDID(did);

      if (!localIdentity) {
        console.log(`[DIDUpdater] 本地未找到 DID ${did}`);
        return { updated: false, reason: 'not-found-locally' };
      }

      // 3. 比较版本
      const localDoc = JSON.parse(localIdentity.did_document);
      const remoteDoc = remoteDID.didDocument;

      const needsUpdate = this.needsUpdate(localDoc, remoteDoc);

      if (!needsUpdate) {
        console.log(`[DIDUpdater] DID ${did} 无需更新`);
        return { updated: false, reason: 'up-to-date' };
      }

      // 4. 保存旧版本到历史
      if (this.config.enableVersioning) {
        await this.saveVersionHistory(did, localDoc);
      }

      // 5. 更新本地DID
      await this.updateLocalDID(did, remoteDoc, remoteDID);

      // 6. 触发更新事件
      this.emit('did-updated', {
        did,
        oldVersion: localDoc.version || 1,
        newVersion: remoteDoc.version || 1,
        changes: this.detectChanges(localDoc, remoteDoc),
      });

      console.log(`[DIDUpdater] DID ${did} 已更新`);

      return { updated: true, oldVersion: localDoc.version, newVersion: remoteDoc.version };
    } catch (error) {
      console.error(`[DIDUpdater] 检查更新失败:`, error);
      throw error;
    }
  }

  /**
   * 判断是否需要更新
   * @param {Object} localDoc - 本地DID文档
   * @param {Object} remoteDoc - 远程DID文档
   * @returns {boolean} 是否需要更新
   */
  needsUpdate(localDoc, remoteDoc) {
    // 比较版本号
    const localVersion = localDoc.version || 1;
    const remoteVersion = remoteDoc.version || 1;

    if (remoteVersion > localVersion) {
      return true;
    }

    // 比较更新时间
    const localUpdated = new Date(localDoc.updated || 0).getTime();
    const remoteUpdated = new Date(remoteDoc.updated || 0).getTime();

    if (remoteUpdated > localUpdated) {
      return true;
    }

    return false;
  }

  /**
   * 检测变更
   * @param {Object} oldDoc - 旧文档
   * @param {Object} newDoc - 新文档
   * @returns {Array} 变更列表
   */
  detectChanges(oldDoc, newDoc) {
    const changes = [];

    // 检查验证方法变更
    if (JSON.stringify(oldDoc.verificationMethod) !== JSON.stringify(newDoc.verificationMethod)) {
      changes.push('verificationMethod');
    }

    // 检查认证方法变更
    if (JSON.stringify(oldDoc.authentication) !== JSON.stringify(newDoc.authentication)) {
      changes.push('authentication');
    }

    // 检查密钥协商变更
    if (JSON.stringify(oldDoc.keyAgreement) !== JSON.stringify(newDoc.keyAgreement)) {
      changes.push('keyAgreement');
    }

    // 检查服务端点变更
    if (JSON.stringify(oldDoc.service) !== JSON.stringify(newDoc.service)) {
      changes.push('service');
    }

    return changes;
  }

  /**
   * 更新本地DID
   * @param {string} did - DID标识符
   * @param {Object} newDoc - 新DID文档
   * @param {Object} remoteDID - 远程DID数据
   */
  async updateLocalDID(did, newDoc, remoteDID) {
    try {
      // 更新数据库
      this.didManager.db.exec(`
        UPDATE identities
        SET
          public_key_sign = ?,
          public_key_encrypt = ?,
          did_document = ?
        WHERE did = ?
      `, [
        remoteDID.publicKeySign,
        remoteDID.publicKeyEncrypt,
        JSON.stringify(newDoc),
        did,
      ]);

      this.didManager.db.saveToFile();

      console.log(`[DIDUpdater] 本地DID ${did} 已更新`);
    } catch (error) {
      console.error('[DIDUpdater] 更新本地DID失败:', error);
      throw error;
    }
  }

  /**
   * 保存版本历史
   * @param {string} did - DID标识符
   * @param {Object} document - DID文档
   */
  async saveVersionHistory(did, document) {
    try {
      const version = document.version || 1;
      const changes = document.versionHistory?.[document.versionHistory.length - 1]?.changes || 'Unknown';

      this.didManager.db.exec(`
        INSERT INTO did_version_history (
          did, version, document, changes, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `, [
        did,
        version,
        JSON.stringify(document),
        changes,
        Date.now(),
      ]);

      // 清理旧版本历史
      await this.cleanupVersionHistory(did);

      console.log(`[DIDUpdater] 已保存 DID ${did} 版本 ${version} 到历史`);
    } catch (error) {
      console.error('[DIDUpdater] 保存版本历史失败:', error);
    }
  }

  /**
   * 清理旧版本历史
   * @param {string} did - DID标识符
   */
  async cleanupVersionHistory(did) {
    try {
      // 保留最新的N个版本
      this.didManager.db.exec(`
        DELETE FROM did_version_history
        WHERE did = ?
        AND version NOT IN (
          SELECT version FROM did_version_history
          WHERE did = ?
          ORDER BY version DESC
          LIMIT ?
        )
      `, [did, did, this.config.maxVersionHistory]);

      this.didManager.db.saveToFile();
    } catch (error) {
      console.error('[DIDUpdater] 清理版本历史失败:', error);
    }
  }

  /**
   * 获取版本历史
   * @param {string} did - DID标识符
   * @returns {Array} 版本历史列表
   */
  getVersionHistory(did) {
    try {
      const result = this.didManager.db.exec(`
        SELECT version, changes, updated_at
        FROM did_version_history
        WHERE did = ?
        ORDER BY version DESC
      `, [did]);

      if (!result || result.length === 0 || !result[0].values) {
        return [];
      }

      return result[0].values.map(row => ({
        version: row[0],
        changes: row[1],
        updatedAt: row[2],
      }));
    } catch (error) {
      console.error('[DIDUpdater] 获取版本历史失败:', error);
      return [];
    }
  }

  /**
   * 重新发布DID到DHT
   * @param {string} did - DID标识符
   */
  async republish(did) {
    console.log(`[DIDUpdater] 重新发布 DID ${did} 到DHT...`);

    try {
      await this.didManager.publishToDHT(did);

      this.emit('did-republished', { did, timestamp: Date.now() });

      console.log(`[DIDUpdater] DID ${did} 已重新发布`);

      return { success: true };
    } catch (error) {
      console.error(`[DIDUpdater] 重新发布失败:`, error);
      throw error;
    }
  }

  /**
   * 增加DID文档版本号
   * @param {string} did - DID标识符
   * @param {string} changes - 变更说明
   */
  async incrementVersion(did, changes = 'Updated') {
    try {
      const identity = this.didManager.getIdentityByDID(did);

      if (!identity) {
        throw new Error(`DID ${did} 不存在`);
      }

      const document = JSON.parse(identity.did_document);

      // 增加版本号
      const newVersion = (document.version || 1) + 1;
      document.version = newVersion;
      document.updated = new Date().toISOString();

      // 添加版本历史
      if (!document.versionHistory) {
        document.versionHistory = [];
      }

      document.versionHistory.push({
        version: newVersion,
        updated: document.updated,
        changes,
      });

      // 保存旧版本
      if (this.config.enableVersioning) {
        await this.saveVersionHistory(did, JSON.parse(identity.did_document));
      }

      // 更新数据库
      this.didManager.db.exec(`
        UPDATE identities
        SET did_document = ?
        WHERE did = ?
      `, [JSON.stringify(document), did]);

      this.didManager.db.saveToFile();

      // 重新发布到DHT
      if (this.config.autoRepublish) {
        await this.republish(did);
      }

      this.emit('version-incremented', { did, version: newVersion, changes });

      console.log(`[DIDUpdater] DID ${did} 版本已更新为 ${newVersion}`);

      return { version: newVersion };
    } catch (error) {
      console.error('[DIDUpdater] 增加版本号失败:', error);
      throw error;
    }
  }

  /**
   * 销毁更新器
   */
  async destroy() {
    console.log('[DIDUpdater] 销毁DID自动更新器...');

    // 停止所有定时器
    for (const did of this.updateTimers.keys()) {
      this.stopAutoUpdate(did);
    }

    for (const did of this.republishTimers.keys()) {
      this.stopAutoRepublish(did);
    }

    // 移除所有监听器
    this.removeAllListeners();

    console.log('[DIDUpdater] DID自动更新器已销毁');
  }
}

module.exports = { DIDUpdater };
