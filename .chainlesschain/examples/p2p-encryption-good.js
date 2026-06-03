/**
 * ✅ P2P 加密正确示例
 *
 * 展示如何正确使用 Signal Protocol 进行端到端加密
 */

// 注意: 这是简化的示例，实际项目使用 @privacyresearch/libsignal-protocol-typescript

class P2PEncryptionExample {
  constructor() {
    this.signalProtocol = null; // 实际项目中初始化 Signal Protocol
    this.p2pNode = null;        // 实际项目中初始化 libp2p
  }

  /**
   * ✅ 正确: 发送加密消息
   */
  async sendEncryptedMessage(recipientDID, message) {
    try {
      // 1. 获取或建立 Signal Protocol 会话
      const session = await this.getOrCreateSession(recipientDID);

      // 2. 加密消息
      const encryptedData = await session.encrypt(message);

      // 3. 通过 P2P 网络发送加密数据
      await this.p2pNode.pubsub.publish(recipientDID, encryptedData);

      // 4. 保存到离线消息队列（如果对方不在线）
      await this.saveToOfflineQueue(recipientDID, encryptedData);

      console.log('✅ 消息已加密并发送');
      return true;
    } catch (error) {
      console.error('发送加密消息失败:', error);
      throw error;
    }
  }

  /**
   * ✅ 正确: 接收并解密消息
   */
  async receiveEncryptedMessage(senderDID, encryptedData) {
    try {
      // 1. 获取 Signal Protocol 会话
      const session = await this.getSession(senderDID);

      if (!session) {
        throw new Error('No session found for sender: ' + senderDID);
      }

      // 2. 解密消息
      const decryptedMessage = await session.decrypt(encryptedData);

      // 3. 验证消息完整性
      if (!this.verifyMessageIntegrity(decryptedMessage)) {
        throw new Error('Message integrity check failed');
      }

      console.log('✅ 消息已解密:', decryptedMessage);
      return decryptedMessage;
    } catch (error) {
      console.error('解密消息失败:', error);
      throw error;
    }
  }

  /**
   * ✅ 正确: 群组消息加密
   */
  async sendGroupMessage(groupMembers, message) {
    const results = [];

    for (const memberDID of groupMembers) {
      try {
        // 为每个成员单独加密
        const session = await this.getOrCreateSession(memberDID);
        const encryptedData = await session.encrypt(message);

        await this.p2pNode.pubsub.publish(memberDID, encryptedData);
        results.push({ did: memberDID, success: true });
      } catch (error) {
        results.push({ did: memberDID, success: false, error: error.message });
      }
    }

    return results;
  }

  /**
   * ✅ 正确: 文件加密传输
   */
  async sendEncryptedFile(recipientDID, fileBuffer, metadata) {
    try {
      // 1. 生成对称密钥
      const symmetricKey = await this.generateSymmetricKey();

      // 2. 使用对称密钥加密文件
      const encryptedFile = await this.encryptFileWithSymmetricKey(fileBuffer, symmetricKey);

      // 3. 使用 Signal Protocol 加密对称密钥
      const session = await this.getOrCreateSession(recipientDID);
      const encryptedKey = await session.encrypt(JSON.stringify({
        key: symmetricKey,
        metadata
      }));

      // 4. 发送加密的密钥和文件
      await this.p2pNode.pubsub.publish(recipientDID, {
        type: 'encrypted_file',
        key: encryptedKey,
        file: encryptedFile
      });

      console.log('✅ 文件已加密并发送');
      return true;
    } catch (error) {
      console.error('发送加密文件失败:', error);
      throw error;
    }
  }

  /**
   * ✅ 正确: 密钥轮换
   */
  async rotateSessionKey(recipientDID) {
    try {
      // 1. 生成新的会话密钥
      const newSession = await this.createNewSession(recipientDID);

      // 2. 通知对方密钥已更新
      await this.sendKeyRotationNotification(recipientDID, newSession.publicKey);

      // 3. 保存新会话
      await this.saveSession(recipientDID, newSession);

      console.log('✅ 会话密钥已轮换');
      return true;
    } catch (error) {
      console.error('密钥轮换失败:', error);
      throw error;
    }
  }

  /**
   * ✅ 正确: 多设备同步
   */
  async syncToOtherDevices(deviceIDs, data) {
    for (const deviceID of deviceIDs) {
      try {
        // 为每个设备创建独立会话
        const session = await this.getOrCreateSession(deviceID);

        // 加密同步数据
        const encryptedData = await session.encrypt(JSON.stringify(data));

        // 发送到设备
        await this.p2pNode.pubsub.publish(deviceID, {
          type: 'device_sync',
          data: encryptedData
        });
      } catch (error) {
        console.error(`设备 ${deviceID} 同步失败:`, error);
      }
    }
  }

  /**
   * ✅ 正确: 验证消息完整性
   */
  verifyMessageIntegrity(message) {
    if (!message || typeof message !== 'object') {
      return false;
    }

    // 检查必要字段
    if (!message.content || !message.signature || !message.timestamp) {
      return false;
    }

    // 验证签名
    return this.verifySignature(message);
  }

  /**
   * ✅ 正确: 安全存储会话密钥
   */
  async saveSession(did, session) {
    // 使用 SQLCipher 加密存储
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO signal_sessions
      (did, session_data, created_at, updated_at)
      VALUES (?, ?, ?, ?)
    `);

    const sessionData = JSON.stringify(session);
    const now = Date.now();

    stmt.run(did, sessionData, now, now);
  }

  /**
   * ✅ 正确: 离线消息队列
   */
  async saveToOfflineQueue(recipientDID, encryptedData) {
    const stmt = this.db.prepare(`
      INSERT INTO offline_messages
      (recipient_did, encrypted_data, created_at, retry_count)
      VALUES (?, ?, ?, 0)
    `);

    stmt.run(recipientDID, JSON.stringify(encryptedData), Date.now());
  }

  /**
   * ✅ 正确: 处理离线消息
   */
  async processOfflineMessages(recipientDID) {
    const messages = this.db.prepare(`
      SELECT * FROM offline_messages
      WHERE recipient_did = ?
      ORDER BY created_at ASC
    `).all(recipientDID);

    for (const msg of messages) {
      try {
        // 重新尝试发送
        await this.p2pNode.pubsub.publish(recipientDID, JSON.parse(msg.encrypted_data));

        // 发送成功，删除队列中的消息
        this.db.prepare('DELETE FROM offline_messages WHERE id = ?').run(msg.id);
      } catch (error) {
        // 增加重试次数
        this.db.prepare(`
          UPDATE offline_messages
          SET retry_count = retry_count + 1
          WHERE id = ?
        `).run(msg.id);
      }
    }
  }

  // === 辅助方法（示例） ===

  async getOrCreateSession(did) {
    let session = await this.getSession(did);
    if (!session) {
      session = await this.createNewSession(did);
    }
    return session;
  }

  async getSession(did) {
    // 从数据库加载会话
    const result = this.db.prepare('SELECT session_data FROM signal_sessions WHERE did = ?').get(did);
    return result ? JSON.parse(result.session_data) : null;
  }

  async createNewSession(did) {
    // 创建新的 Signal Protocol 会话
    return {
      did,
      publicKey: 'mock_public_key',
      privateKey: 'mock_private_key',
      encrypt: async (data) => ({ encrypted: data }),
      decrypt: async (data) => data.encrypted
    };
  }

  async generateSymmetricKey() {
    // 生成 AES-256 对称密钥
    return 'mock_symmetric_key_256bit';
  }

  async encryptFileWithSymmetricKey(buffer, key) {
    // 使用 AES-256-GCM 加密文件
    return { encrypted: buffer, iv: 'mock_iv' };
  }

  async sendKeyRotationNotification(did, publicKey) {
    // 发送密钥轮换通知
    console.log('发送密钥轮换通知到:', did);
  }

  verifySignature(message) {
    // 验证消息签名
    return true;
  }
}

// ✅ 使用示例

async function main() {
  const p2p = new P2PEncryptionExample();

  // 示例1: 发送加密消息
  await p2p.sendEncryptedMessage(
    'did:key:recipient123',
    { text: 'Hello, this is a secret message!' }
  );

  // 示例2: 发送群组消息
  await p2p.sendGroupMessage(
    ['did:key:user1', 'did:key:user2', 'did:key:user3'],
    { text: 'Group announcement' }
  );

  // 示例3: 发送加密文件
  const fileBuffer = Buffer.from('file content');
  await p2p.sendEncryptedFile(
    'did:key:recipient123',
    fileBuffer,
    { filename: 'secret.pdf', size: fileBuffer.length }
  );

  // 示例4: 密钥轮换（每30天）
  await p2p.rotateSessionKey('did:key:recipient123');

  console.log('✅ 所有加密操作完成');
}

module.exports = P2PEncryptionExample;

if (require.main === module) {
  main().catch(console.error);
}
