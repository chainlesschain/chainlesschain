import * as forge from 'node-forge';

/**
 * U盾管理器
 *
 * 注意: 这是一个模拟实现,用于开发测试
 * 生产环境需要集成真实的U盾SDK (如飞天诚信、握奇等)
 */
export class UKeyManager {
  private isUnlocked: boolean = false;
  private simulatedPrivateKey: forge.pki.rsa.PrivateKey | null = null;
  private simulatedPublicKey: forge.pki.rsa.PublicKey | null = null;

  constructor() {
    console.log('[U盾] 初始化U盾管理器 (模拟模式)');
    this.generateSimulatedKeys();
  }

  /**
   * 生成模拟的密钥对 (仅用于开发测试)
   */
  private generateSimulatedKeys(): void {
    console.log('[U盾] 生成模拟密钥对...');
    const keypair = forge.pki.rsa.generateKeyPair({ bits: 2048, workers: -1 });
    this.simulatedPrivateKey = keypair.privateKey;
    this.simulatedPublicKey = keypair.publicKey;
    console.log('[U盾] 模拟密钥对生成完成');
  }

  /**
   * 检测U盾是否连接
   */
  async detectUKey(): Promise<boolean> {
    console.log('[U盾] 检测U盾连接...');

    // TODO: 实际实现需要调用U盾SDK
    // 例如: const devices = await UKeySDK.enumerateDevices();
    // return devices.length > 0;

    // 模拟: 总是返回true
    await this.sleep(500);
    console.log('[U盾] 模拟: U盾已连接');
    return true;
  }

  /**
   * 验证PIN码
   */
  async verifyPIN(pin: string): Promise<boolean> {
    console.log('[U盾] 验证PIN码...');

    // TODO: 实际实现需要调用U盾SDK
    // const result = await UKeySDK.verifyPIN(pin);

    // 模拟: PIN码为"123456"时验证通过
    await this.sleep(300);
    if (pin === '123456') {
      this.isUnlocked = true;
      console.log('[U盾] PIN码验证成功');
      return true;
    } else {
      this.isUnlocked = false;
      console.log('[U盾] PIN码验证失败');
      return false;
    }
  }

  /**
   * 数字签名
   */
  async sign(data: string): Promise<string> {
    if (!this.isUnlocked) {
      throw new Error('U盾未解锁,请先验证PIN码');
    }

    console.log('[U盾] 对数据进行签名...');

    // TODO: 实际实现需要调用U盾SDK
    // const signature = await UKeySDK.sign(data);

    // 模拟: 使用Node-Forge进行RSA签名
    if (!this.simulatedPrivateKey) {
      throw new Error('私钥未初始化');
    }

    const md = forge.md.sha256.create();
    md.update(data, 'utf8');

    const signature = this.simulatedPrivateKey.sign(md);
    const signatureBase64 = forge.util.encode64(signature);

    console.log('[U盾] 签名完成');
    return signatureBase64;
  }

  /**
   * 验证签名
   */
  async verifySignature(data: string, signature: string): Promise<boolean> {
    console.log('[U盾] 验证签名...');

    if (!this.simulatedPublicKey) {
      throw new Error('公钥未初始化');
    }

    try {
      const md = forge.md.sha256.create();
      md.update(data, 'utf8');

      const signatureBytes = forge.util.decode64(signature);
      const verified = this.simulatedPublicKey.verify(md.digest().bytes(), signatureBytes);

      console.log('[U盾] 签名验证结果:', verified);
      return verified;
    } catch (error) {
      console.error('[U盾] 签名验证失败:', error);
      return false;
    }
  }

  /**
   * 加密数据
   */
  async encrypt(data: string): Promise<string> {
    console.log('[U盾] 加密数据...');

    if (!this.simulatedPublicKey) {
      throw new Error('公钥未初始化');
    }

    // 使用公钥加密
    const encrypted = this.simulatedPublicKey.encrypt(data, 'RSA-OAEP', {
      md: forge.md.sha256.create(),
    });

    const encryptedBase64 = forge.util.encode64(encrypted);
    console.log('[U盾] 数据加密完成');
    return encryptedBase64;
  }

  /**
   * 解密数据
   */
  async decrypt(encryptedData: string): Promise<string> {
    if (!this.isUnlocked) {
      throw new Error('U盾未解锁,请先验证PIN码');
    }

    console.log('[U盾] 解密数据...');

    if (!this.simulatedPrivateKey) {
      throw new Error('私钥未初始化');
    }

    try {
      const encryptedBytes = forge.util.decode64(encryptedData);
      const decrypted = this.simulatedPrivateKey.decrypt(encryptedBytes, 'RSA-OAEP', {
        md: forge.md.sha256.create(),
      });

      console.log('[U盾] 数据解密完成');
      return decrypted;
    } catch (error) {
      console.error('[U盾] 解密失败:', error);
      throw error;
    }
  }

  /**
   * 获取公钥 (PEM格式)
   */
  getPublicKeyPEM(): string {
    if (!this.simulatedPublicKey) {
      throw new Error('公钥未初始化');
    }

    return forge.pki.publicKeyToPem(this.simulatedPublicKey);
  }

  /**
   * 生成数据库加密密钥
   */
  async generateDBKey(): Promise<string> {
    if (!this.isUnlocked) {
      throw new Error('U盾未解锁,请先验证PIN码');
    }

    console.log('[U盾] 生成数据库加密密钥...');

    // TODO: 实际实现应该从U盾派生密钥
    // const dbKey = await UKeySDK.deriveKey('db-encryption');

    // 模拟: 生成32字节随机密钥
    const randomBytes = forge.random.getBytesSync(32);
    const key = forge.util.encode64(randomBytes);

    console.log('[U盾] 数据库密钥生成完成');
    return key;
  }

  /**
   * 锁定U盾
   */
  lock(): void {
    this.isUnlocked = false;
    console.log('[U盾] U盾已锁定');
  }

  /**
   * 检查解锁状态
   */
  isUKeyUnlocked(): boolean {
    return this.isUnlocked;
  }

  // 辅助方法: 延迟执行
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}
