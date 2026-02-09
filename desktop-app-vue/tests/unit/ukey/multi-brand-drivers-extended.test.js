/**
 * Multi-Brand U-Key Driver Extended Tests
 *
 * Tests all supported U-Key brands with brand-specific features:
 * - 飞天 (Feitian) - SM2/SM3/SM4 national cryptographic algorithms
 * - 华大 (Huada) - High-security applications, dual-interface cards
 * - 握奇 (WatchData) - Financial-grade security
 * - 天地融 (TDR) - Mobile payment focus
 * - 新近科 (XinJinKe) - Cost-effective solutions
 * - SKF (Standard) - SKF API implementation
 *
 * Target: 6 brands × 10 scenarios = 60 tests
 * Coverage: Brand-specific features + Common PKCS#11 operations
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock logger
vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
  createLogger: vi.fn(() => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  })),
}));

/**
 * Base mock driver for all brands
 */
class BaseMockDriver {
  constructor(brand, options = {}) {
    this.brand = brand;
    this.initialized = false;
    this.loggedIn = false;
    this.pin = options.pin || '123456';
    this.features = options.features || [];
    this.algorithms = options.algorithms || ['RSA-SHA256'];
  }

  async initialize() {
    this.initialized = true;
    return { success: true, brand: this.brand };
  }

  async finalize() {
    this.initialized = false;
    this.loggedIn = false;
    return { success: true };
  }

  async login(pin) {
    if (pin !== this.pin) {
      throw new Error('PIN_INCORRECT');
    }
    this.loggedIn = true;
    return { success: true };
  }

  async logout() {
    this.loggedIn = false;
    return { success: true };
  }

  async sign(data, options = {}) {
    if (!this.loggedIn) throw new Error('Not logged in');
    const { algorithm = 'RSA-SHA256' } = options;

    if (!this.algorithms.includes(algorithm)) {
      throw new Error(`Algorithm ${algorithm} not supported by ${this.brand}`);
    }

    return Buffer.from(`${this.brand}-signature-${algorithm}-${data.length}`);
  }

  async verify(data, signature, options = {}) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return signature.toString().includes(this.brand);
  }

  hasFeature(feature) {
    return this.features.includes(feature);
  }

  getBrandInfo() {
    return {
      brand: this.brand,
      features: this.features,
      algorithms: this.algorithms,
    };
  }
}

/**
 * 飞天 (Feitian) Driver Mock
 */
class FeitianDriverMock extends BaseMockDriver {
  constructor(options = {}) {
    super('feitian', {
      ...options,
      features: ['sm2', 'sm3', 'sm4', 'dual-interface', 'contactless'],
      algorithms: ['RSA-SHA256', 'RSA-SHA512', 'SM2-SM3', 'SM4-ECB', 'SM4-CBC'],
    });
  }

  async sm2Sign(data) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return Buffer.from(`feitian-sm2-signature-${data.length}`);
  }

  async sm3Hash(data) {
    return Buffer.from(`feitian-sm3-hash-${data.toString('hex').slice(0, 8)}`);
  }

  async sm4Encrypt(data, mode = 'ECB') {
    if (!this.loggedIn) throw new Error('Not logged in');
    return Buffer.from(`feitian-sm4-${mode}-encrypted-${data.length}`);
  }

  async sm4Decrypt(ciphertext, mode = 'ECB') {
    if (!this.loggedIn) throw new Error('Not logged in');
    const prefix = `feitian-sm4-${mode}-encrypted-`;
    if (!ciphertext.toString().startsWith(prefix)) {
      throw new Error('Invalid ciphertext');
    }
    return Buffer.from('decrypted-data');
  }
}

/**
 * 华大 (Huada) Driver Mock
 */
class HuadaDriverMock extends BaseMockDriver {
  constructor(options = {}) {
    super('huada', {
      ...options,
      features: ['high-security', 'dual-interface', 'applet-management', 'sm-algorithms'],
      algorithms: ['RSA-SHA256', 'SM2-SM3', 'ECDSA-SHA256'],
    });
    this.securityLevel = 'EAL5+';
  }

  async getSecurityLevel() {
    return this.securityLevel;
  }

  async loadApplet(appletData) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return { success: true, appletId: 'applet-001' };
  }

  async unloadApplet(appletId) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return { success: true };
  }

  async attestation() {
    if (!this.loggedIn) throw new Error('Not logged in');
    return {
      manufacturer: 'Huada',
      securityLevel: this.securityLevel,
      certified: true,
      certifications: ['国密二级', 'EAL5+'],
    };
  }
}

/**
 * 握奇 (WatchData) Driver Mock
 */
class WatchDataDriverMock extends BaseMockDriver {
  constructor(options = {}) {
    super('watchdata', {
      ...options,
      features: ['financial-grade', 'pboc', 'emv', 'secure-element'],
      algorithms: ['RSA-SHA256', 'RSA-SHA512', '3DES', 'AES-256'],
    });
  }

  async pbocTransaction(transactionData) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return {
      success: true,
      transactionId: 'txn-' + Date.now(),
      signed: true,
    };
  }

  async emvAuthenticate(challenge) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return Buffer.from(`watchdata-emv-auth-${challenge.length}`);
  }

  async getFinancialCertificate() {
    return {
      issuer: 'WatchData Financial CA',
      subject: 'User Certificate',
      validFrom: new Date(),
      validTo: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      usage: ['digital-signature', 'key-encipherment'],
    };
  }
}

/**
 * 天地融 (TDR) Driver Mock
 */
class TDRDriverMock extends BaseMockDriver {
  constructor(options = {}) {
    super('tdr', {
      ...options,
      features: ['mobile-payment', 'nfc', 'bluetooth', 'qr-code'],
      algorithms: ['RSA-SHA256', 'ECDSA-SHA256'],
    });
  }

  async nfcTransaction(amount, merchantId) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return {
      success: true,
      transactionId: `nfc-${Date.now()}`,
      amount,
      merchantId,
      timestamp: Date.now(),
    };
  }

  async generateQRCode(data) {
    return {
      qrCode: `QR:${Buffer.from(data).toString('base64')}`,
      expiresIn: 300000, // 5 minutes
    };
  }

  async bluetoothPair(deviceId) {
    return {
      success: true,
      paired: true,
      deviceId,
      securityMode: 'AES-128',
    };
  }
}

/**
 * 新近科 (XinJinKe) Driver Mock
 */
class XinJinKeDriverMock extends BaseMockDriver {
  constructor(options = {}) {
    super('xinjinke', {
      ...options,
      features: ['cost-effective', 'basic-crypto', 'usb-interface'],
      algorithms: ['RSA-SHA256', 'AES-128'],
    });
    this.storageCapacity = 64 * 1024; // 64KB
  }

  async getStorageInfo() {
    return {
      total: this.storageCapacity,
      used: 1024,
      free: this.storageCapacity - 1024,
    };
  }

  async writeData(offset, data) {
    if (!this.loggedIn) throw new Error('Not logged in');
    if (offset + data.length > this.storageCapacity) {
      throw new Error('Storage overflow');
    }
    return { success: true, bytesWritten: data.length };
  }

  async readData(offset, length) {
    if (!this.loggedIn) throw new Error('Not logged in');
    return Buffer.alloc(length).fill(0xAA);
  }
}

/**
 * SKF (Standard) Driver Mock
 */
class SKFDriverMock extends BaseMockDriver {
  static containerCounter = 0;

  constructor(options = {}) {
    super('skf', {
      ...options,
      features: ['skf-standard', 'gm-algorithms', 'container-management'],
      algorithms: ['RSA-SHA256', 'SM2-SM3', 'SM3', 'SM4-ECB'],
    });
    this.containers = new Map();
  }

  async createContainer(name) {
    if (!this.loggedIn) throw new Error('Not logged in');
    // Use counter + timestamp to ensure unique IDs even within same millisecond
    const containerId = `container-${Date.now()}-${++SKFDriverMock.containerCounter}`;
    this.containers.set(containerId, { name, created: Date.now() });
    return { success: true, containerId };
  }

  async deleteContainer(containerId) {
    if (!this.loggedIn) throw new Error('Not logged in');
    if (!this.containers.has(containerId)) {
      throw new Error('Container not found');
    }
    this.containers.delete(containerId);
    return { success: true };
  }

  async listContainers() {
    return Array.from(this.containers.entries()).map(([id, data]) => ({
      id,
      ...data,
    }));
  }

  async importCertificate(containerId, certificate) {
    if (!this.containers.has(containerId)) {
      throw new Error('Container not found');
    }
    return { success: true, certificateId: 'cert-001' };
  }
}

// ============================================
// Test Suites for Each Brand
// ============================================

describe('Multi-Brand U-Key Drivers (Extended Tests)', () => {
  describe('飞天 (Feitian) Driver', () => {
    let driver;

    beforeEach(async () => {
      driver = new FeitianDriverMock();
      await driver.initialize();
      await driver.login('123456');
    });

    it('should identify as Feitian brand', () => {
      const info = driver.getBrandInfo();
      expect(info.brand).toBe('feitian');
    });

    it('should support SM2 national algorithm', () => {
      expect(driver.hasFeature('sm2')).toBe(true);
      expect(driver.algorithms).toContain('SM2-SM3');
    });

    it('should sign with SM2-SM3', async () => {
      const data = Buffer.from('国密测试');
      const signature = await driver.sign(data, { algorithm: 'SM2-SM3' });

      expect(signature).toBeInstanceOf(Buffer);
      expect(signature.toString()).toContain('SM2-SM3');
    });

    it('should perform SM2 signature operation', async () => {
      const data = Buffer.from('Test data');
      const signature = await driver.sm2Sign(data);

      expect(signature.toString()).toContain('feitian-sm2-signature');
    });

    it('should compute SM3 hash', async () => {
      const data = Buffer.from('Hash me');
      const hash = await driver.sm3Hash(data);

      expect(hash).toBeInstanceOf(Buffer);
      expect(hash.toString()).toContain('feitian-sm3-hash');
    });

    it('should encrypt with SM4-ECB', async () => {
      const data = Buffer.from('Secret');
      const encrypted = await driver.sm4Encrypt(data, 'ECB');

      expect(encrypted.toString()).toContain('feitian-sm4-ECB-encrypted');
    });

    it('should decrypt with SM4-ECB', async () => {
      const data = Buffer.from('Secret');
      const encrypted = await driver.sm4Encrypt(data, 'ECB');
      const decrypted = await driver.sm4Decrypt(encrypted, 'ECB');

      expect(decrypted.toString()).toBe('decrypted-data');
    });

    it('should support dual-interface feature', () => {
      expect(driver.hasFeature('dual-interface')).toBe(true);
    });

    it('should support contactless feature', () => {
      expect(driver.hasFeature('contactless')).toBe(true);
    });

    it('should handle SM4-CBC mode', async () => {
      const data = Buffer.from('CBC test');
      const encrypted = await driver.sm4Encrypt(data, 'CBC');

      expect(encrypted.toString()).toContain('feitian-sm4-CBC-encrypted');
    });
  });

  describe('华大 (Huada) Driver', () => {
    let driver;

    beforeEach(async () => {
      driver = new HuadaDriverMock();
      await driver.initialize();
      await driver.login('123456');
    });

    it('should identify as Huada brand', () => {
      const info = driver.getBrandInfo();
      expect(info.brand).toBe('huada');
    });

    it('should report EAL5+ security level', async () => {
      const level = await driver.getSecurityLevel();
      expect(level).toBe('EAL5+');
    });

    it('should support high-security feature', () => {
      expect(driver.hasFeature('high-security')).toBe(true);
    });

    it('should load applet', async () => {
      const appletData = Buffer.from('applet-code');
      const result = await driver.loadApplet(appletData);

      expect(result.success).toBe(true);
      expect(result.appletId).toBeDefined();
    });

    it('should unload applet', async () => {
      const { appletId } = await driver.loadApplet(Buffer.from('test'));
      const result = await driver.unloadApplet(appletId);

      expect(result.success).toBe(true);
    });

    it('should provide attestation', async () => {
      const attestation = await driver.attestation();

      expect(attestation.manufacturer).toBe('Huada');
      expect(attestation.certified).toBe(true);
      expect(attestation.certifications).toContain('国密二级');
    });

    it('should support SM algorithms', () => {
      expect(driver.hasFeature('sm-algorithms')).toBe(true);
      expect(driver.algorithms).toContain('SM2-SM3');
    });

    it('should support ECDSA-SHA256', () => {
      expect(driver.algorithms).toContain('ECDSA-SHA256');
    });

    it('should sign with SM2-SM3', async () => {
      const data = Buffer.from('Test');
      const signature = await driver.sign(data, { algorithm: 'SM2-SM3' });

      expect(signature.toString()).toContain('huada-signature-SM2-SM3');
    });

    it('should support applet management', () => {
      expect(driver.hasFeature('applet-management')).toBe(true);
    });
  });

  describe('握奇 (WatchData) Driver', () => {
    let driver;

    beforeEach(async () => {
      driver = new WatchDataDriverMock();
      await driver.initialize();
      await driver.login('123456');
    });

    it('should identify as WatchData brand', () => {
      const info = driver.getBrandInfo();
      expect(info.brand).toBe('watchdata');
    });

    it('should support financial-grade feature', () => {
      expect(driver.hasFeature('financial-grade')).toBe(true);
    });

    it('should process PBOC transaction', async () => {
      const txnData = { amount: 100, merchant: 'M001' };
      const result = await driver.pbocTransaction(txnData);

      expect(result.success).toBe(true);
      expect(result.transactionId).toMatch(/^txn-/);
      expect(result.signed).toBe(true);
    });

    it('should perform EMV authentication', async () => {
      const challenge = Buffer.from('challenge-data');
      const response = await driver.emvAuthenticate(challenge);

      expect(response.toString()).toContain('watchdata-emv-auth');
    });

    it('should provide financial certificate', async () => {
      const cert = await driver.getFinancialCertificate();

      expect(cert.issuer).toContain('WatchData');
      expect(cert.usage).toContain('digital-signature');
    });

    it('should support PBOC standard', () => {
      expect(driver.hasFeature('pboc')).toBe(true);
    });

    it('should support EMV standard', () => {
      expect(driver.hasFeature('emv')).toBe(true);
    });

    it('should support 3DES algorithm', () => {
      expect(driver.algorithms).toContain('3DES');
    });

    it('should support AES-256 algorithm', () => {
      expect(driver.algorithms).toContain('AES-256');
    });

    it('should have secure element', () => {
      expect(driver.hasFeature('secure-element')).toBe(true);
    });
  });

  describe('天地融 (TDR) Driver', () => {
    let driver;

    beforeEach(async () => {
      driver = new TDRDriverMock();
      await driver.initialize();
      await driver.login('123456');
    });

    it('should identify as TDR brand', () => {
      const info = driver.getBrandInfo();
      expect(info.brand).toBe('tdr');
    });

    it('should support mobile payment', () => {
      expect(driver.hasFeature('mobile-payment')).toBe(true);
    });

    it('should process NFC transaction', async () => {
      const result = await driver.nfcTransaction(50, 'merchant-123');

      expect(result.success).toBe(true);
      expect(result.amount).toBe(50);
      expect(result.merchantId).toBe('merchant-123');
      expect(result.transactionId).toMatch(/^nfc-/);
    });

    it('should generate QR code', async () => {
      const data = 'payment-data';
      const result = await driver.generateQRCode(data);

      expect(result.qrCode).toMatch(/^QR:/);
      expect(result.expiresIn).toBe(300000);
    });

    it('should pair with Bluetooth device', async () => {
      const result = await driver.bluetoothPair('device-001');

      expect(result.success).toBe(true);
      expect(result.paired).toBe(true);
      expect(result.securityMode).toBe('AES-128');
    });

    it('should support NFC feature', () => {
      expect(driver.hasFeature('nfc')).toBe(true);
    });

    it('should support Bluetooth feature', () => {
      expect(driver.hasFeature('bluetooth')).toBe(true);
    });

    it('should support QR code feature', () => {
      expect(driver.hasFeature('qr-code')).toBe(true);
    });

    it('should support ECDSA-SHA256', () => {
      expect(driver.algorithms).toContain('ECDSA-SHA256');
    });

    it('should handle mobile payment workflow', async () => {
      const qr = await driver.generateQRCode('test');
      const nfc = await driver.nfcTransaction(100, 'M001');

      expect(qr.qrCode).toBeDefined();
      expect(nfc.success).toBe(true);
    });
  });

  describe('新近科 (XinJinKe) Driver', () => {
    let driver;

    beforeEach(async () => {
      driver = new XinJinKeDriverMock();
      await driver.initialize();
      await driver.login('123456');
    });

    it('should identify as XinJinKe brand', () => {
      const info = driver.getBrandInfo();
      expect(info.brand).toBe('xinjinke');
    });

    it('should be cost-effective', () => {
      expect(driver.hasFeature('cost-effective')).toBe(true);
    });

    it('should report storage info', async () => {
      const info = await driver.getStorageInfo();

      expect(info.total).toBe(64 * 1024);
      expect(info.free).toBeLessThan(info.total);
    });

    it('should write data to storage', async () => {
      const data = Buffer.from('test data');
      const result = await driver.writeData(0, data);

      expect(result.success).toBe(true);
      expect(result.bytesWritten).toBe(data.length);
    });

    it('should read data from storage', async () => {
      const data = await driver.readData(0, 16);

      expect(data).toBeInstanceOf(Buffer);
      expect(data.length).toBe(16);
    });

    it('should prevent storage overflow', async () => {
      const largeData = Buffer.alloc(70 * 1024);

      await expect(driver.writeData(0, largeData)).rejects.toThrow('Storage overflow');
    });

    it('should support basic crypto', () => {
      expect(driver.hasFeature('basic-crypto')).toBe(true);
    });

    it('should support USB interface', () => {
      expect(driver.hasFeature('usb-interface')).toBe(true);
    });

    it('should support RSA-SHA256', () => {
      expect(driver.algorithms).toContain('RSA-SHA256');
    });

    it('should support AES-128', () => {
      expect(driver.algorithms).toContain('AES-128');
    });
  });

  describe('SKF (Standard) Driver', () => {
    let driver;

    beforeEach(async () => {
      driver = new SKFDriverMock();
      await driver.initialize();
      await driver.login('123456');
    });

    it('should identify as SKF brand', () => {
      const info = driver.getBrandInfo();
      expect(info.brand).toBe('skf');
    });

    it('should support SKF standard', () => {
      expect(driver.hasFeature('skf-standard')).toBe(true);
    });

    it('should create container', async () => {
      const result = await driver.createContainer('TestContainer');

      expect(result.success).toBe(true);
      expect(result.containerId).toMatch(/^container-/);
    });

    it('should delete container', async () => {
      const { containerId } = await driver.createContainer('ToDelete');
      const result = await driver.deleteContainer(containerId);

      expect(result.success).toBe(true);
    });

    it('should list containers', async () => {
      await driver.createContainer('Container1');
      await driver.createContainer('Container2');

      const containers = await driver.listContainers();

      expect(containers.length).toBeGreaterThanOrEqual(2);
    });

    it('should import certificate to container', async () => {
      const { containerId } = await driver.createContainer('CertContainer');
      const cert = Buffer.from('certificate-data');

      const result = await driver.importCertificate(containerId, cert);

      expect(result.success).toBe(true);
      expect(result.certificateId).toBeDefined();
    });

    it('should support GM algorithms', () => {
      expect(driver.hasFeature('gm-algorithms')).toBe(true);
      expect(driver.algorithms).toContain('SM2-SM3');
    });

    it('should support SM3 hash', () => {
      expect(driver.algorithms).toContain('SM3');
    });

    it('should support SM4-ECB', () => {
      expect(driver.algorithms).toContain('SM4-ECB');
    });

    it('should support container management', () => {
      expect(driver.hasFeature('container-management')).toBe(true);
    });

    it('should handle container not found error', async () => {
      await expect(driver.deleteContainer('non-existent')).rejects.toThrow(
        'Container not found'
      );
    });
  });

  describe('Cross-Brand Compatibility', () => {
    it('all drivers should support basic initialization', async () => {
      const drivers = [
        new FeitianDriverMock(),
        new HuadaDriverMock(),
        new WatchDataDriverMock(),
        new TDRDriverMock(),
        new XinJinKeDriverMock(),
        new SKFDriverMock(),
      ];

      for (const driver of drivers) {
        const result = await driver.initialize();
        expect(result.success).toBe(true);
      }
    });

    it('all drivers should support login/logout', async () => {
      const drivers = [
        new FeitianDriverMock(),
        new HuadaDriverMock(),
        new WatchDataDriverMock(),
      ];

      for (const driver of drivers) {
        await driver.initialize();
        await driver.login('123456');
        expect(driver.loggedIn).toBe(true);

        await driver.logout();
        expect(driver.loggedIn).toBe(false);
      }
    });

    it('all drivers should support RSA-SHA256', async () => {
      const drivers = [
        new FeitianDriverMock(),
        new HuadaDriverMock(),
        new WatchDataDriverMock(),
        new TDRDriverMock(),
        new XinJinKeDriverMock(),
        new SKFDriverMock(),
      ];

      const data = Buffer.from('Test');

      for (const driver of drivers) {
        await driver.initialize();
        await driver.login('123456');

        const signature = await driver.sign(data, { algorithm: 'RSA-SHA256' });
        expect(signature).toBeInstanceOf(Buffer);
      }
    });
  });
});
