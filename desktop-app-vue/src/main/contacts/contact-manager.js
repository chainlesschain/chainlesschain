/**
 * 联系人管理器
 *
 * 管理 DID 联系人、好友关系、信任评分
 */

const EventEmitter = require('events');

/**
 * 联系人管理器类
 */
class ContactManager extends EventEmitter {
  constructor(databaseManager, p2pManager, didManager) {
    super();

    this.db = databaseManager;
    this.p2p = p2pManager;
    this.did = didManager;
  }

  /**
   * 初始化联系人管理器
   */
  async initialize() {
    console.log('[ContactManager] 初始化联系人管理器...');

    try {
      // 确保数据库表存在
      await this.ensureTables();

      console.log('[ContactManager] 联系人管理器初始化成功');
      this.emit('initialized');

      return true;
    } catch (error) {
      console.error('[ContactManager] 初始化失败:', error);
      throw error;
    }
  }

  /**
   * 确保数据库表存在
   */
  async ensureTables() {
    try {
      // 检查 contacts 表
      const result = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='contacts'"
      ).all();

      if (!result || result.length === 0) {
        // 创建 contacts 表
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS contacts (
            did TEXT PRIMARY KEY,
            nickname TEXT,
            avatar_url TEXT,
            public_key_sign TEXT NOT NULL,
            public_key_encrypt TEXT NOT NULL,
            relationship TEXT DEFAULT 'contact',
            trust_score REAL DEFAULT 0.0,
            node_address TEXT,
            added_at INTEGER NOT NULL,
            last_seen INTEGER,
            notes TEXT
          )
        `);

        console.log('[ContactManager] contacts 表已创建');
      }

      // 创建好友请求表
      const requestResult = this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='friend_requests'"
      ).all();

      if (!requestResult || requestResult.length === 0) {
        this.db.exec(`
          CREATE TABLE IF NOT EXISTS friend_requests (
            id TEXT PRIMARY KEY,
            from_did TEXT NOT NULL,
            to_did TEXT NOT NULL,
            status TEXT DEFAULT 'pending',
            message TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER
          )
        `);

        console.log('[ContactManager] friend_requests 表已创建');
      }
    } catch (error) {
      console.error('[ContactManager] 检查数据库表失败:', error);
      throw error;
    }
  }

  /**
   * 添加联系人
   * @param {Object} contact - 联系人信息
   */
  async addContact(contact) {
    try {
      console.log('[ContactManager] 添加联系人:', contact.did);

      // 验证必填字段
      if (!contact.did || !contact.public_key_sign || !contact.public_key_encrypt) {
        throw new Error('缺少必填字段: did, public_key_sign, public_key_encrypt');
      }

      const contactData = {
        did: contact.did,
        nickname: contact.nickname || 'Unknown',
        avatar_url: contact.avatar_url || null,
        public_key_sign: contact.public_key_sign,
        public_key_encrypt: contact.public_key_encrypt,
        relationship: contact.relationship || 'contact',
        trust_score: contact.trust_score || 0.0,
        node_address: contact.node_address || null,
        added_at: Date.now(),
        last_seen: null,
        notes: contact.notes || null,
      };

      this.db.prepare(
        `
        INSERT OR REPLACE INTO contacts (
          did, nickname, avatar_url, public_key_sign, public_key_encrypt,
          relationship, trust_score, node_address, added_at, last_seen, notes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
      ).run(
        contactData.did,
        contactData.nickname,
        contactData.avatar_url,
        contactData.public_key_sign,
        contactData.public_key_encrypt,
        contactData.relationship,
        contactData.trust_score,
        contactData.node_address,
        contactData.added_at,
        contactData.last_seen,
        contactData.notes
      );

      this.db.saveToFile();

      console.log('[ContactManager] 联系人已添加:', contact.did);
      this.emit('contact:added', contactData);

      return contactData;
    } catch (error) {
      console.error('[ContactManager] 添加联系人失败:', error);
      throw error;
    }
  }

  /**
   * 从二维码数据添加联系人
   * @param {string} qrData - 二维码 JSON 数据
   */
  async addContactFromQR(qrData) {
    try {
      const data = JSON.parse(qrData);

      console.log('[ContactManager] 从二维码添加联系人:', data.did);

      // 验证 DID 格式
      if (!data.did || !data.did.startsWith('did:chainlesschain:')) {
        throw new Error('无效的 DID 格式');
      }

      const contact = {
        did: data.did,
        nickname: data.nickname || 'Unknown',
        public_key_sign: data.publicKeySign,
        public_key_encrypt: data.publicKeyEncrypt,
        relationship: 'contact',
      };

      return await this.addContact(contact);
    } catch (error) {
      console.error('[ContactManager] 从二维码添加联系人失败:', error);
      throw error;
    }
  }

  /**
   * 获取所有联系人
   */
  getAllContacts() {
    try {
      const result = this.db.prepare('SELECT * FROM contacts ORDER BY added_at DESC').all();

      if (!result || result.length === 0 || !result[0].values) {
        return [];
      }

      const columns = result[0].columns;
      const rows = result[0].values;

      return rows.map((row) => {
        const contact = {};
        columns.forEach((col, index) => {
          contact[col] = row[index];
        });
        return contact;
      });
    } catch (error) {
      console.error('[ContactManager] 获取联系人列表失败:', error);
      return [];
    }
  }

  /**
   * 根据 DID 获取联系人
   * @param {string} did - DID 标识符
   */
  getContactByDID(did) {
    try {
      const result = this.db.prepare('SELECT * FROM contacts WHERE did = ?').all([did]);

      if (!result || result.length === 0 || !result[0].values || result[0].values.length === 0) {
        return null;
      }

      const columns = result[0].columns;
      const row = result[0].values[0];

      const contact = {};
      columns.forEach((col, index) => {
        contact[col] = row[index];
      });

      return contact;
    } catch (error) {
      console.error('[ContactManager] 获取联系人失败:', error);
      return null;
    }
  }

  /**
   * 更新联系人信息
   * @param {string} did - DID 标识符
   * @param {Object} updates - 更新内容
   */
  async updateContact(did, updates) {
    try {
      const contact = this.getContactByDID(did);

      if (!contact) {
        throw new Error('联系人不存在');
      }

      const fields = [];
      const values = [];

      const allowedFields = ['nickname', 'avatar_url', 'relationship', 'trust_score', 'node_address', 'notes'];

      allowedFields.forEach((field) => {
        if (updates[field] !== undefined) {
          fields.push(`${field} = ?`);
          values.push(updates[field]);
        }
      });

      if (fields.length === 0) {
        return contact;
      }

      values.push(did);

      this.db.prepare(`UPDATE contacts SET ${fields.join(', ')} WHERE did = ?`).run(values);

      this.db.saveToFile();

      console.log('[ContactManager] 联系人已更新:', did);
      this.emit('contact:updated', { did, updates });

      return this.getContactByDID(did);
    } catch (error) {
      console.error('[ContactManager] 更新联系人失败:', error);
      throw error;
    }
  }

  /**
   * 删除联系人
   * @param {string} did - DID 标识符
   */
  async deleteContact(did) {
    try {
      const contact = this.getContactByDID(did);

      if (!contact) {
        throw new Error('联系人不存在');
      }

      this.db.prepare('DELETE FROM contacts WHERE did = ?').run([did]);
      this.db.saveToFile();

      console.log('[ContactManager] 联系人已删除:', did);
      this.emit('contact:deleted', { did });

      return true;
    } catch (error) {
      console.error('[ContactManager] 删除联系人失败:', error);
      throw error;
    }
  }

  /**
   * 搜索联系人
   * @param {string} query - 搜索关键词
   */
  searchContacts(query) {
    try {
      const result = this.db.prepare(
        `SELECT * FROM contacts
         WHERE nickname LIKE ? OR did LIKE ? OR notes LIKE ?
         ORDER BY trust_score DESC, added_at DESC`
      ).all(`%${query}%`, `%${query}%`, `%${query}%`);

      if (!result || result.length === 0 || !result[0].values) {
        return [];
      }

      const columns = result[0].columns;
      const rows = result[0].values;

      return rows.map((row) => {
        const contact = {};
        columns.forEach((col, index) => {
          contact[col] = row[index];
        });
        return contact;
      });
    } catch (error) {
      console.error('[ContactManager] 搜索联系人失败:', error);
      return [];
    }
  }

  /**
   * 获取好友列表（relationship='friend'）
   */
  getFriends() {
    try {
      const result = this.db.prepare(
        "SELECT * FROM contacts WHERE relationship = 'friend' ORDER BY trust_score DESC"
      ).all();

      if (!result || result.length === 0 || !result[0].values) {
        return [];
      }

      const columns = result[0].columns;
      const rows = result[0].values;

      return rows.map((row) => {
        const contact = {};
        columns.forEach((col, index) => {
          contact[col] = row[index];
        });
        return contact;
      });
    } catch (error) {
      console.error('[ContactManager] 获取好友列表失败:', error);
      return [];
    }
  }

  /**
   * 更新最后在线时间
   * @param {string} did - DID 标识符
   */
  async updateLastSeen(did) {
    try {
      this.db.prepare('UPDATE contacts SET last_seen = ? WHERE did = ?').run([Date.now(), did]);

      this.db.saveToFile();

      this.emit('contact:last-seen-updated', { did });
    } catch (error) {
      console.error('[ContactManager] 更新最后在线时间失败:', error);
    }
  }

  /**
   * 更新信任评分
   * @param {string} did - DID 标识符
   * @param {number} delta - 评分变化（正数增加，负数减少）
   */
  async updateTrustScore(did, delta) {
    try {
      const contact = this.getContactByDID(did);

      if (!contact) {
        throw new Error('联系人不存在');
      }

      let newScore = (contact.trust_score || 0) + delta;

      // 限制在 0-100 范围内
      newScore = Math.max(0, Math.min(100, newScore));

      this.db.prepare('UPDATE contacts SET trust_score = ? WHERE did = ?').run([newScore, did]);

      this.db.saveToFile();

      console.log('[ContactManager] 信任评分已更新:', did, newScore);
      this.emit('contact:trust-score-updated', { did, score: newScore });

      return newScore;
    } catch (error) {
      console.error('[ContactManager] 更新信任评分失败:', error);
      throw error;
    }
  }

  /**
   * 获取统计信息
   */
  getStatistics() {
    try {
      // 总联系人数
      const totalResult = this.db.prepare('SELECT COUNT(*) as count FROM contacts').all();
      const total = totalResult[0]?.values[0]?.[0] || 0;

      // 好友数
      const friendsResult = this.db.prepare(
        "SELECT COUNT(*) as count FROM contacts WHERE relationship = 'friend'"
      ).all();
      const friends = friendsResult[0]?.values[0]?.[0] || 0;

      // 按关系类型统计
      const byRelationshipResult = this.db.prepare('SELECT relationship, COUNT(*) as count FROM contacts GROUP BY relationship').all();

      const byRelationship = {};
      if (byRelationshipResult && byRelationshipResult[0]?.values) {
        byRelationshipResult[0].values.forEach((row) => {
          byRelationship[row[0]] = row[1];
        });
      }

      return {
        total,
        friends,
        byRelationship,
      };
    } catch (error) {
      console.error('[ContactManager] 获取统计信息失败:', error);
      return { total: 0, friends: 0, byRelationship: {} };
    }
  }

  /**
   * 关闭管理器
   */
  async close() {
    console.log('[ContactManager] 关闭联系人管理器');
    this.emit('closed');
  }
}

module.exports = ContactManager;
