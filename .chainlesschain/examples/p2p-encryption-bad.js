/**
 * ❌ P2P 加密错误示例
 *
 * 展示常见的加密错误（仅供教学，切勿使用！）
 *
 * ⚠️ 警告: 这些代码都是不安全的，不要在生产环境中使用！
 */

class UnsafeP2PExample {
  constructor() {
    this.p2pNode = null; // 模拟 libp2p 节点
  }

  // ❌ 错误1: 明文传输消息
  async sendMessageUnsafe1(recipientDID, message) {
    // 危险！直接发送明文消息
    await this.p2pNode.pubsub.publish(recipientDID, message);
    console.log('❌ 消息以明文发送！');
  }

  // ❌ 错误2: 使用 Base64 "加密"
  async sendMessageUnsafe2(recipientDID, message) {
    // Base64 不是加密，只是编码！
    const encoded = Buffer.from(JSON.stringify(message)).toString('base64');

    await this.p2pNode.pubsub.publish(recipientDID, encoded);
    console.log('❌ Base64 不是加密！');
  }

  // ❌ 错误3: 自定义弱加密算法
  async sendMessageUnsafe3(recipientDID, message) {
    // 危险！ROT13 是玩具级别的"加密"
    const rot13 = (str) => str.replace(/[a-zA-Z]/g, (c) =>
      String.fromCharCode((c <= 'Z' ? 90 : 122) >= (c = c.charCodeAt(0) + 13) ? c : c - 26)
    );

    const "encrypted" = rot13(JSON.stringify(message));

    await this.p2pNode.pubsub.publish(recipientDID, "encrypted");
    console.log('❌ ROT13 不是真正的加密！');
  }

  // ❌ 错误4: 硬编码密钥
  async sendMessageUnsafe4(recipientDID, message) {
    const HARDCODED_KEY = 'my-secret-key-123'; // 危险！

    // 即使使用了真正的加密算法，硬编码密钥也不安全
    const encrypted = this.simpleXOR(JSON.stringify(message), HARDCODED_KEY);

    await this.p2pNode.pubsub.publish(recipientDID, encrypted);
    console.log('❌ 硬编码的密钥会被反编译！');
  }

  // ❌ 错误5: 使用弱加密算法（MD5）
  async sendMessageUnsafe5(recipientDID, message) {
    const crypto = require('crypto');

    // MD5 是哈希算法，不是加密算法！
    const hash = crypto.createHash('md5').update(JSON.stringify(message)).digest('hex');

    await this.p2pNode.pubsub.publish(recipientDID, hash);
    console.log('❌ MD5 是单向哈希，不能解密！');
  }

  // ❌ 错误6: 不验证接收方身份
  async sendMessageUnsafe6(recipientDID, message) {
    // 没有验证 recipientDID 是否合法
    // 可能发送到恶意节点！

    const encrypted = await this.weakEncrypt(message);
    await this.p2pNode.pubsub.publish(recipientDID, encrypted);
    console.log('❌ 未验证接收方身份！');
  }

  // ❌ 错误7: 重复使用相同的密钥
  async sendMessageUnsafe7(recipientDID, message) {
    // 所有消息使用相同的密钥
    const SAME_KEY_FOR_ALL = 'global-key';

    const encrypted = this.simpleXOR(JSON.stringify(message), SAME_KEY_FOR_ALL);

    await this.p2pNode.pubsub.publish(recipientDID, encrypted);
    console.log('❌ 密钥重用会降低安全性！');
  }

  // ❌ 错误8: 不使用初始化向量 (IV)
  async sendMessageUnsafe8(recipientDID, message) {
    const crypto = require('crypto');
    const key = 'fixed-16-byte-key';

    // 危险！每次加密相同的明文会产生相同的密文
    const cipher = crypto.createCipheriv('aes-128-ecb', key, null);
    let encrypted = cipher.update(JSON.stringify(message), 'utf8', 'hex');
    encrypted += cipher.final('hex');

    await this.p2pNode.pubsub.publish(recipientDID, encrypted);
    console.log('❌ 没有 IV，相同明文产生相同密文！');
  }

  // ❌ 错误9: 将敏感信息记录到日志
  async sendMessageUnsafe9(recipientDID, message) {
    console.log('发送消息:', message); // 危险！泄露到日志

    const session = await this.getSession(recipientDID);
    console.log('使用会话:', session); // 危险！泄露密钥

    const encrypted = await session.encrypt(message);

    await this.p2pNode.pubsub.publish(recipientDID, encrypted);
    console.log('❌ 敏感信息已记录到日志！');
  }

  // ❌ 错误10: 不处理解密失败
  async receiveMessageUnsafe(senderDID, encryptedData) {
    try {
      const session = await this.getSession(senderDID);
      const decrypted = await session.decrypt(encryptedData);

      // 没有验证解密是否成功
      // 直接使用可能损坏的数据
      return decrypted;
    } catch (error) {
      // 忽略错误，返回原始数据！
      console.log('❌ 解密失败，返回原始数据（危险）');
      return encryptedData;
    }
  }

  // ❌ 错误11: 存储明文会话密钥
  async saveSessionUnsafe(did, session) {
    // 危险！会话密钥以明文存储在数据库
    this.db.exec(`
      INSERT INTO sessions (did, session_key)
      VALUES ('${did}', '${session.key}')
    `);
    console.log('❌ 会话密钥以明文存储！');
  }

  // ❌ 错误12: 不验证消息完整性
  async receiveMessageUnsafe12(senderDID, encryptedData) {
    const session = await this.getSession(senderDID);
    const decrypted = await session.decrypt(encryptedData);

    // 没有验证消息是否被篡改
    // 直接使用可能被修改的数据
    return decrypted;
  }

  // ❌ 错误13: 群组消息使用相同密钥
  async sendGroupMessageUnsafe(groupMembers, message) {
    const SHARED_GROUP_KEY = 'group-secret-key';

    // 所有成员共享同一密钥
    // 任何成员都可以冒充其他成员
    const encrypted = this.simpleXOR(JSON.stringify(message), SHARED_GROUP_KEY);

    for (const memberDID of groupMembers) {
      await this.p2pNode.pubsub.publish(memberDID, encrypted);
    }
    console.log('❌ 群组共享密钥不安全！');
  }

  // ❌ 错误14: 文件传输不加密元数据
  async sendFileUnsafe(recipientDID, fileBuffer, metadata) {
    // 文件内容加密了，但元数据是明文
    const encryptedFile = await this.weakEncrypt(fileBuffer);

    await this.p2pNode.pubsub.publish(recipientDID, {
      type: 'file',
      metadata: metadata, // 危险！明文元数据
      file: encryptedFile
    });
    console.log('❌ 文件元数据未加密！');
  }

  // ❌ 错误15: 密钥从不轮换
  async neverRotateKeys() {
    // 危险！密钥永久使用
    // 一旦泄露，历史消息全部暴露
    console.log('❌ 密钥应该定期轮换！');
  }

  // === 辅助方法 ===

  simpleXOR(text, key) {
    let result = '';
    for (let i = 0; i < text.length; i++) {
      result += String.fromCharCode(text.charCodeAt(i) ^ key.charCodeAt(i % key.length));
    }
    return Buffer.from(result).toString('base64');
  }

  async weakEncrypt(data) {
    // 模拟弱加密
    return Buffer.from(JSON.stringify(data)).toString('base64');
  }

  async getSession(did) {
    return {
      key: 'weak-key',
      encrypt: async (data) => this.weakEncrypt(data),
      decrypt: async (data) => JSON.parse(Buffer.from(data, 'base64').toString())
    };
  }
}

// ✅ 如何修复这些问题？

class SafeP2PExample {
  // ✅ 正确: 使用 Signal Protocol
  async sendMessageSafe(recipientDID, message) {
    const session = await this.getOrCreateSignalSession(recipientDID);

    // 1. 使用 Signal Protocol 加密
    const encryptedData = await session.encrypt(message);

    // 2. 验证接收方身份
    if (!this.verifyRecipientIdentity(recipientDID)) {
      throw new Error('Invalid recipient');
    }

    // 3. 发送加密数据
    await this.p2pNode.pubsub.publish(recipientDID, encryptedData);

    console.log('✅ 消息已安全加密并发送');
  }

  // ✅ 正确: 验证并解密消息
  async receiveMessageSafe(senderDID, encryptedData) {
    try {
      // 1. 验证发送方身份
      if (!this.verifySenderIdentity(senderDID)) {
        throw new Error('Invalid sender');
      }

      // 2. 获取会话并解密
      const session = await this.getSignalSession(senderDID);
      const decrypted = await session.decrypt(encryptedData);

      // 3. 验证消息完整性
      if (!this.verifyMessageIntegrity(decrypted)) {
        throw new Error('Message integrity check failed');
      }

      return decrypted;
    } catch (error) {
      console.error('解密失败:', error);
      // 不返回原始数据
      throw error;
    }
  }

  // ✅ 正确: 安全存储会话密钥
  async saveSessionSafe(did, session) {
    // 使用 SQLCipher 加密数据库
    const stmt = this.db.prepare(`
      INSERT OR REPLACE INTO signal_sessions
      (did, encrypted_session, created_at)
      VALUES (?, ?, ?)
    `);

    // 会话数据也加密
    const encryptedSession = await this.encryptSessionData(session);
    stmt.run(did, encryptedSession, Date.now());
  }

  // ✅ 正确: 定期轮换密钥
  async rotateKeysRegularly(recipientDID) {
    const ROTATION_INTERVAL = 30 * 24 * 60 * 60 * 1000; // 30 天

    const session = await this.getSignalSession(recipientDID);

    if (Date.now() - session.createdAt > ROTATION_INTERVAL) {
      // 创建新会话
      const newSession = await this.createNewSignalSession(recipientDID);

      // 通知对方
      await this.sendKeyRotationNotification(recipientDID, newSession.publicKey);

      // 保存新会话
      await this.saveSessionSafe(recipientDID, newSession);

      console.log('✅ 密钥已轮换');
    }
  }

  // === 辅助方法 ===

  async getOrCreateSignalSession(did) {
    // 实现 Signal Protocol 会话
    return {};
  }

  async getSignalSession(did) {
    return {};
  }

  verifyRecipientIdentity(did) {
    return true;
  }

  verifySenderIdentity(did) {
    return true;
  }

  verifyMessageIntegrity(message) {
    return true;
  }

  async encryptSessionData(session) {
    return JSON.stringify(session);
  }

  async createNewSignalSession(did) {
    return {};
  }

  async sendKeyRotationNotification(did, publicKey) {
    console.log('发送密钥轮换通知');
  }
}

// 演示示例

async function demonstrateUnsafePractices() {
  console.log('===== ❌ 不安全的加密示例 =====\n');

  const unsafe = new UnsafeP2PExample();

  // 演示各种不安全的做法
  await unsafe.sendMessageUnsafe1('did:key:user1', { text: 'secret' });
  await unsafe.sendMessageUnsafe2('did:key:user1', { text: 'secret' });
  await unsafe.sendMessageUnsafe3('did:key:user1', { text: 'secret' });

  console.log('\n💡 这些方法都不安全，请使用 Signal Protocol！');
}

async function demonstrateSafePractices() {
  console.log('\n===== ✅ 安全的加密示例 =====\n');

  const safe = new SafeP2PExample();

  await safe.sendMessageSafe('did:key:user1', { text: 'secret message' });
  console.log('✅ 消息已安全发送');

  await safe.rotateKeysRegularly('did:key:user1');
  console.log('✅ 密钥轮换检查完成');
}

module.exports = { UnsafeP2PExample, SafeP2PExample };

if (require.main === module) {
  (async () => {
    await demonstrateUnsafePractices();
    await demonstrateSafePractices();
  })();
}
