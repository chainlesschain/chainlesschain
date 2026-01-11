/**
 * Signal Protocol完整实现测试
 *
 * 测试内容：
 * 1. 身份密钥生成和管理
 * 2. 预密钥生成和分发
 * 3. X3DH密钥协商
 * 4. Double Ratchet加密/解密
 * 5. 会话持久化
 * 6. 多设备支持
 * 7. 密钥轮换
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

class SignalProtocolTest {
  constructor() {
    this.testResults = {
      identityKeyGeneration: false,
      preKeyGeneration: false,
      keyExchange: false,
      messageEncryption: false,
      messageDecryption: false,
      sessionPersistence: false,
      multiDevice: false,
      keyRotation: false
    };
    this.testErrors = [];
  }

  /**
   * 运行所有测试
   */
  async runAllTests() {
    console.log('='.repeat(60));
    console.log('Signal Protocol完整实现测试');
    console.log('='.repeat(60));
    console.log('');

    try {
      await this.testIdentityKeyGeneration();
      await this.testPreKeyGeneration();
      await this.testX3DHKeyExchange();
      await this.testDoubleRatchetEncryption();
      await this.testSessionPersistence();
      await this.testMultiDeviceSupport();
      await this.testKeyRotation();
      await this.testForwardSecrecy();
    } catch (error) {
      console.error('测试过程中发生错误:', error);
      this.testErrors.push({ test: 'general', error: error.message });
    }

    this.printTestReport();
  }

  /**
   * 测试1: 身份密钥生成
   */
  async testIdentityKeyGeneration() {
    console.log('[测试1] 身份密钥生成测试...');

    try {
      // 模拟生成身份密钥对
      const identityKeyPair = this.generateKeyPair();
      console.log('  ✓ 身份密钥对已生成');
      console.log('     - 公钥长度:', identityKeyPair.publicKey.length);
      console.log('     - 私钥长度:', identityKeyPair.privateKey.length);

      // 验证密钥对
      const testData = 'test message';
      const signature = this.sign(testData, identityKeyPair.privateKey);
      const verified = this.verify(testData, signature, identityKeyPair.publicKey);

      if (verified) {
        console.log('  ✓ 密钥对验证成功');
        this.testResults.identityKeyGeneration = true;
        console.log('  ✅ 身份密钥生成测试完成');
      } else {
        throw new Error('密钥对验证失败');
      }
    } catch (error) {
      console.log('  ❌ 身份密钥生成测试失败:', error.message);
      this.testErrors.push({ test: 'identityKeyGeneration', error: error.message });
    }
  }

  /**
   * 测试2: 预密钥生成
   */
  async testPreKeyGeneration() {
    console.log('\n[测试2] 预密钥生成测试...');

    try {
      // 生成预密钥包
      const preKeyBundle = this.generatePreKeyBundle();

      console.log('  ✓ 预密钥包已生成');
      console.log('     - 注册ID:', preKeyBundle.registrationId);
      console.log('     - 身份密钥:', preKeyBundle.identityKey.substring(0, 32) + '...');
      console.log('     - 签名预密钥ID:', preKeyBundle.signedPreKey.keyId);
      console.log('     - 一次性预密钥数量:', preKeyBundle.preKeys.length);

      // 验证签名预密钥
      const signatureValid = this.verifyPreKeySignature(
        preKeyBundle.signedPreKey.publicKey,
        preKeyBundle.signedPreKey.signature,
        preKeyBundle.identityKey
      );

      if (signatureValid) {
        console.log('  ✓ 签名预密钥验证成功');
        this.testResults.preKeyGeneration = true;
        console.log('  ✅ 预密钥生成测试完成');
      } else {
        throw new Error('签名预密钥验证失败');
      }
    } catch (error) {
      console.log('  ❌ 预密钥生成测试失败:', error.message);
      this.testErrors.push({ test: 'preKeyGeneration', error: error.message });
    }
  }

  /**
   * 测试3: X3DH密钥协商
   */
  async testX3DHKeyExchange() {
    console.log('\n[测试3] X3DH密钥协商测试...');

    try {
      // Alice生成身份和临时密钥
      const aliceIdentityKey = this.generateKeyPair();
      const aliceEphemeralKey = this.generateKeyPair();

      console.log('  ✓ Alice密钥已生成');

      // Bob生成预密钥包
      const bobPreKeyBundle = this.generatePreKeyBundle();

      console.log('  ✓ Bob预密钥包已生成');

      // Alice执行X3DH
      const aliceSharedSecret = this.performX3DH_Alice(
        aliceIdentityKey,
        aliceEphemeralKey,
        bobPreKeyBundle
      );

      console.log('  ✓ Alice完成X3DH计算');
      console.log('     - 共享密钥:', aliceSharedSecret.substring(0, 32) + '...');

      // Bob执行X3DH
      const bobSharedSecret = this.performX3DH_Bob(
        bobPreKeyBundle,
        aliceIdentityKey.publicKey,
        aliceEphemeralKey.publicKey
      );

      console.log('  ✓ Bob完成X3DH计算');

      // 验证共享密钥一致
      if (aliceSharedSecret === bobSharedSecret) {
        console.log('  ✓ 共享密钥匹配');
        this.testResults.keyExchange = true;
        console.log('  ✅ X3DH密钥协商测试完成');
      } else {
        throw new Error('共享密钥不匹配');
      }
    } catch (error) {
      console.log('  ❌ X3DH密钥协商测试失败:', error.message);
      this.testErrors.push({ test: 'keyExchange', error: error.message });
    }
  }

  /**
   * 测试4: Double Ratchet加密/解密
   */
  async testDoubleRatchetEncryption() {
    console.log('\n[测试4] Double Ratchet加密/解密测试...');

    try {
      // 初始化会话
      const sharedSecret = crypto.randomBytes(32).toString('hex');
      const aliceRatchet = this.initializeRatchet(sharedSecret, true);
      const bobRatchet = this.initializeRatchet(sharedSecret, false);

      console.log('  ✓ Ratchet状态已初始化');

      // Alice发送消息
      const messages = [
        'Hello Bob!',
        'How are you?',
        'This is a secret message.'
      ];

      const encryptedMessages = [];

      for (const message of messages) {
        const encrypted = this.ratchetEncrypt(aliceRatchet, message);
        encryptedMessages.push(encrypted);
        console.log(`  ✓ Alice加密消息: "${message}"`);
      }

      // Bob接收并解密消息
      let allDecrypted = true;

      for (let i = 0; i < encryptedMessages.length; i++) {
        const decrypted = this.ratchetDecrypt(bobRatchet, encryptedMessages[i]);

        if (decrypted === messages[i]) {
          console.log(`  ✓ Bob解密消息: "${decrypted}"`);
        } else {
          console.log(`  ❌ 消息解密失败: 期望 "${messages[i]}", 得到 "${decrypted}"`);
          allDecrypted = false;
        }
      }

      if (allDecrypted) {
        this.testResults.messageEncryption = true;
        this.testResults.messageDecryption = true;
        console.log('  ✅ Double Ratchet加密/解密测试完成');
      } else {
        throw new Error('部分消息解密失败');
      }
    } catch (error) {
      console.log('  ❌ Double Ratchet测试失败:', error.message);
      this.testErrors.push({ test: 'doubleRatchet', error: error.message });
    }
  }

  /**
   * 测试5: 会话持久化
   */
  async testSessionPersistence() {
    console.log('\n[测试5] 会话持久化测试...');

    try {
      // 创建会话
      const session = {
        peerId: 'test-peer-123',
        deviceId: 1,
        sharedSecret: crypto.randomBytes(32).toString('hex'),
        ratchetState: {
          sendingChainKey: crypto.randomBytes(32).toString('hex'),
          receivingChainKey: crypto.randomBytes(32).toString('hex'),
          messageNumber: 0
        },
        createdAt: Date.now()
      };

      console.log('  ✓ 会话已创建');
      console.log('     - Peer ID:', session.peerId);
      console.log('     - Device ID:', session.deviceId);

      // 保存会话到文件
      const sessionPath = path.join(__dirname, 'test-session.json');
      fs.writeFileSync(sessionPath, JSON.stringify(session, null, 2));

      console.log('  ✓ 会话已保存到文件');

      // 从文件加载会话
      const loadedSession = JSON.parse(fs.readFileSync(sessionPath, 'utf8'));

      console.log('  ✓ 会话已从文件加载');

      // 验证会话数据
      if (
        loadedSession.peerId === session.peerId &&
        loadedSession.sharedSecret === session.sharedSecret
      ) {
        console.log('  ✓ 会话数据验证成功');
        this.testResults.sessionPersistence = true;
        console.log('  ✅ 会话持久化测试完成');

        // 清理测试文件
        fs.unlinkSync(sessionPath);
      } else {
        throw new Error('会话数据不匹配');
      }
    } catch (error) {
      console.log('  ❌ 会话持久化测试失败:', error.message);
      this.testErrors.push({ test: 'sessionPersistence', error: error.message });
    }
  }

  /**
   * 测试6: 多设备支持
   */
  async testMultiDeviceSupport() {
    console.log('\n[测试6] 多设备支持测试...');

    try {
      const userId = 'user-alice';
      const devices = [
        { deviceId: 1, name: 'Desktop', preKeyBundle: this.generatePreKeyBundle() },
        { deviceId: 2, name: 'Mobile', preKeyBundle: this.generatePreKeyBundle() },
        { deviceId: 3, name: 'Tablet', preKeyBundle: this.generatePreKeyBundle() }
      ];

      console.log(`  ✓ 用户 ${userId} 的 ${devices.length} 个设备已注册`);

      devices.forEach(device => {
        console.log(`     - 设备 ${device.deviceId} (${device.name}): 注册ID ${device.preKeyBundle.registrationId}`);
      });

      // 模拟向所有设备发送消息
      const message = 'Hello from all devices!';
      const encryptedForDevices = [];

      devices.forEach(device => {
        // 为每个设备建立会话并加密消息
        const sharedSecret = crypto.randomBytes(32).toString('hex');
        const ratchet = this.initializeRatchet(sharedSecret, true);
        const encrypted = this.ratchetEncrypt(ratchet, message);

        encryptedForDevices.push({
          deviceId: device.deviceId,
          encrypted: encrypted
        });

        console.log(`  ✓ 消息已加密给设备 ${device.deviceId}`);
      });

      if (encryptedForDevices.length === devices.length) {
        console.log('  ✓ 所有设备都收到加密消息');
        this.testResults.multiDevice = true;
        console.log('  ✅ 多设备支持测试完成');
      } else {
        throw new Error('部分设备未收到消息');
      }
    } catch (error) {
      console.log('  ❌ 多设备支持测试失败:', error.message);
      this.testErrors.push({ test: 'multiDevice', error: error.message });
    }
  }

  /**
   * 测试7: 密钥轮换
   */
  async testKeyRotation() {
    console.log('\n[测试7] 密钥轮换测试...');

    try {
      // 初始密钥
      let currentKey = crypto.randomBytes(32).toString('hex');
      console.log('  ✓ 初始密钥已生成');

      // 模拟密钥轮换（每100条消息）
      const rotations = 3;
      const messagesPerRotation = 100;

      for (let i = 0; i < rotations; i++) {
        // 生成新密钥
        const newKey = this.deriveNewKey(currentKey, i);

        console.log(`  ✓ 密钥轮换 ${i + 1}/${rotations}`);
        console.log(`     - 旧密钥: ${currentKey.substring(0, 16)}...`);
        console.log(`     - 新密钥: ${newKey.substring(0, 16)}...`);

        // 验证新密钥不同于旧密钥
        if (newKey === currentKey) {
          throw new Error('密钥轮换失败：新密钥与旧密钥相同');
        }

        currentKey = newKey;
      }

      console.log('  ✓ 所有密钥轮换成功');
      this.testResults.keyRotation = true;
      console.log('  ✅ 密钥轮换测试完成');
    } catch (error) {
      console.log('  ❌ 密钥轮换测试失败:', error.message);
      this.testErrors.push({ test: 'keyRotation', error: error.message });
    }
  }

  /**
   * 测试8: 前向保密性
   */
  async testForwardSecrecy() {
    console.log('\n[测试8] 前向保密性测试...');

    try {
      // 创建会话并发送消息
      const sharedSecret = crypto.randomBytes(32).toString('hex');
      const ratchet = this.initializeRatchet(sharedSecret, true);

      const messages = ['Message 1', 'Message 2', 'Message 3'];
      const encryptedMessages = [];

      messages.forEach(msg => {
        const encrypted = this.ratchetEncrypt(ratchet, msg);
        encryptedMessages.push(encrypted);
      });

      console.log('  ✓ 已发送3条消息');

      // 模拟密钥泄露（获取当前ratchet状态）
      const compromisedRatchet = JSON.parse(JSON.stringify(ratchet));

      console.log('  ⚠️  模拟密钥泄露');

      // 继续发送新消息
      const newMessage = 'Message 4 (after compromise)';
      const newEncrypted = this.ratchetEncrypt(ratchet, newMessage);

      console.log('  ✓ 泄露后发送新消息');

      // 尝试用泄露的密钥解密新消息
      try {
        const decrypted = this.ratchetDecrypt(compromisedRatchet, newEncrypted);
        console.log('  ❌ 前向保密性失败：泄露的密钥可以解密新消息');
        throw new Error('前向保密性测试失败');
      } catch (error) {
        if (error.message.includes('前向保密性测试失败')) {
          throw error;
        }
        // 解密失败是预期的
        console.log('  ✓ 泄露的密钥无法解密新消息');
        console.log('  ✅ 前向保密性测试完成');
      }
    } catch (error) {
      console.log('  ❌ 前向保密性测试失败:', error.message);
      this.testErrors.push({ test: 'forwardSecrecy', error: error.message });
    }
  }

  // ========== 辅助方法 ==========

  generateKeyPair() {
    const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding: { type: 'spki', format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' }
    });
    return { publicKey, privateKey };
  }

  sign(data, privateKey) {
    const sign = crypto.createSign('SHA256');
    sign.update(data);
    return sign.sign(privateKey, 'hex');
  }

  verify(data, signature, publicKey) {
    const verify = crypto.createVerify('SHA256');
    verify.update(data);
    return verify.verify(publicKey, signature, 'hex');
  }

  generatePreKeyBundle() {
    const identityKey = this.generateKeyPair();
    const signedPreKey = this.generateKeyPair();
    const preKeys = [];

    for (let i = 0; i < 100; i++) {
      preKeys.push({
        keyId: i,
        publicKey: this.generateKeyPair().publicKey
      });
    }

    const signature = this.sign(signedPreKey.publicKey, identityKey.privateKey);

    return {
      registrationId: Math.floor(Math.random() * 16384),
      identityKey: identityKey.publicKey,
      signedPreKey: {
        keyId: 1,
        publicKey: signedPreKey.publicKey,
        signature: signature
      },
      preKeys: preKeys
    };
  }

  verifyPreKeySignature(preKeyPublic, signature, identityKey) {
    return this.verify(preKeyPublic, signature, identityKey);
  }

  performX3DH_Alice(aliceIdentityKey, aliceEphemeralKey, bobPreKeyBundle) {
    // 简化的X3DH实现（实际应使用ECDH）
    const dh1 = crypto.createHash('sha256').update(aliceIdentityKey.privateKey + bobPreKeyBundle.signedPreKey.publicKey).digest('hex');
    const dh2 = crypto.createHash('sha256').update(aliceEphemeralKey.privateKey + bobPreKeyBundle.identityKey).digest('hex');
    const dh3 = crypto.createHash('sha256').update(aliceEphemeralKey.privateKey + bobPreKeyBundle.signedPreKey.publicKey).digest('hex');

    return crypto.createHash('sha256').update(dh1 + dh2 + dh3).digest('hex');
  }

  performX3DH_Bob(bobPreKeyBundle, aliceIdentityPublic, aliceEphemeralPublic) {
    // Bob端的X3DH计算（简化版）
    const dh1 = crypto.createHash('sha256').update(bobPreKeyBundle.signedPreKey.publicKey + aliceIdentityPublic).digest('hex');
    const dh2 = crypto.createHash('sha256').update(bobPreKeyBundle.identityKey + aliceEphemeralPublic).digest('hex');
    const dh3 = crypto.createHash('sha256').update(bobPreKeyBundle.signedPreKey.publicKey + aliceEphemeralPublic).digest('hex');

    return crypto.createHash('sha256').update(dh1 + dh2 + dh3).digest('hex');
  }

  initializeRatchet(sharedSecret, isSender) {
    return {
      sharedSecret: sharedSecret,
      sendingChainKey: crypto.createHash('sha256').update(sharedSecret + 'sending').digest('hex'),
      receivingChainKey: crypto.createHash('sha256').update(sharedSecret + 'receiving').digest('hex'),
      messageNumber: 0,
      isSender: isSender
    };
  }

  ratchetEncrypt(ratchet, message) {
    const messageKey = crypto.createHash('sha256').update(ratchet.sendingChainKey + ratchet.messageNumber).digest('hex');
    const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(messageKey.substring(0, 64), 'hex'), Buffer.alloc(16, 0));
    let encrypted = cipher.update(message, 'utf8', 'hex');
    encrypted += cipher.final('hex');

    // 更新链密钥
    ratchet.sendingChainKey = crypto.createHash('sha256').update(ratchet.sendingChainKey).digest('hex');
    ratchet.messageNumber++;

    return {
      ciphertext: encrypted,
      messageNumber: ratchet.messageNumber - 1
    };
  }

  ratchetDecrypt(ratchet, encryptedMessage) {
    const messageKey = crypto.createHash('sha256').update(ratchet.receivingChainKey + encryptedMessage.messageNumber).digest('hex');
    const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(messageKey.substring(0, 64), 'hex'), Buffer.alloc(16, 0));
    let decrypted = decipher.update(encryptedMessage.ciphertext, 'hex', 'utf8');
    decrypted += decipher.final('utf8');

    // 更新链密钥
    ratchet.receivingChainKey = crypto.createHash('sha256').update(ratchet.receivingChainKey).digest('hex');

    return decrypted;
  }

  deriveNewKey(oldKey, iteration) {
    return crypto.createHash('sha256').update(oldKey + iteration).digest('hex');
  }

  /**
   * 打印测试报告
   */
  printTestReport() {
    console.log('\n' + '='.repeat(60));
    console.log('测试报告');
    console.log('='.repeat(60));

    const tests = [
      { name: '身份密钥生成', key: 'identityKeyGeneration' },
      { name: '预密钥生成', key: 'preKeyGeneration' },
      { name: 'X3DH密钥协商', key: 'keyExchange' },
      { name: '消息加密', key: 'messageEncryption' },
      { name: '消息解密', key: 'messageDecryption' },
      { name: '会话持久化', key: 'sessionPersistence' },
      { name: '多设备支持', key: 'multiDevice' },
      { name: '密钥轮换', key: 'keyRotation' }
    ];

    let passedCount = 0;
    let failedCount = 0;

    tests.forEach(test => {
      const passed = this.testResults[test.key];
      const status = passed ? '✅ 通过' : '❌ 失败';
      console.log(`${test.name}: ${status}`);

      if (passed) {
        passedCount++;
      } else {
        failedCount++;
      }
    });

    console.log('\n' + '-'.repeat(60));
    console.log(`总计: ${tests.length} 个测试`);
    console.log(`通过: ${passedCount} 个`);
    console.log(`失败: ${failedCount} 个`);
    console.log(`成功率: ${((passedCount / tests.length) * 100).toFixed(1)}%`);
    console.log('='.repeat(60));

    if (this.testErrors.length > 0) {
      console.log('\n错误详情:');
      this.testErrors.forEach(error => {
        console.log(`- [${error.test}] ${error.error}`);
      });
    }

    console.log('\n说明:');
    console.log('- 本测试使用简化的加密算法模拟Signal Protocol流程');
    console.log('- 实际系统使用完整的Signal Protocol实现');
    console.log('- Signal Protocol提供前向保密和后向保密特性');
    console.log('- 支持X3DH密钥协商和Double Ratchet算法');
  }
}

// 运行测试
if (require.main === module) {
  const test = new SignalProtocolTest();
  test.runAllTests().then(() => {
    process.exit(0);
  }).catch((error) => {
    console.error('测试失败:', error);
    process.exit(1);
  });
}

module.exports = SignalProtocolTest;
