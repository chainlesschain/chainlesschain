/**
 * Native Module Binding for XinJinKe U盾
 *
 * 使用 FFI (Foreign Function Interface) 调用 xjk.dll
 */

const ffi = require('ffi-napi');
const ref = require('ref-napi');
const path = require('path');
const os = require('os');

/**
 * Native types definition
 */
const BOOL = ref.types.int;
const INT = ref.types.int;
const CHAR_PTR = ref.refType(ref.types.char);

/**
 * XinJinKe Native Binding
 *
 * 根据官方文档绑定所有DLL函数
 */
class XinJinKeNativeBinding {
  constructor(dllPath) {
    this.dllPath = dllPath || this.findDllPath();
    this.lib = null;
    this.isLoaded = false;
  }

  /**
   * 查找DLL路径
   */
  findDllPath() {
    const platform = os.platform();

    if (platform === 'win32') {
      // Windows平台查找路径
      const possiblePaths = [
        path.join(process.cwd(), 'resources', 'xjk.dll'),
        path.join(process.env.ProgramFiles || 'C:\\Program Files', 'XinJinKe', 'xjk.dll'),
        path.join(process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)', 'XinJinKe', 'xjk.dll'),
        'C:\\Windows\\System32\\xjk.dll',
      ];

      const fs = require('fs');
      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          return p;
        }
      }

      // 默认路径
      return path.join(process.cwd(), 'resources', 'xjk.dll');
    }

    throw new Error(`Unsupported platform: ${platform}. XinJinKe dongle only supports Windows.`);
  }

  /**
   * 加载DLL库
   */
  load() {
    if (this.isLoaded) {
      return true;
    }

    try {
      // 加载DLL并绑定所有函数
      this.lib = ffi.Library(this.dllPath, {
        // 基础功能
        'xjkOpenKey': [BOOL, []],
        'xjkOpenKeyEx': [BOOL, [CHAR_PTR]],
        'xjkCloseKey': [BOOL, []],
        'xjkFindPort': [INT, []],

        // 设备信息
        'xjkGetSerial': [BOOL, [CHAR_PTR]],
        'xjkGetSectors': [INT, []],
        'xjkGetClusters': [INT, []],

        // 数据读写 - 扇区(512字节)
        'xjkReadSector': [BOOL, [CHAR_PTR, INT]],
        'xjkWriteSector': [BOOL, [CHAR_PTR, INT]],

        // 数据读写 - 簇(4096字节)
        'xjkReadCluster': [BOOL, [CHAR_PTR, INT]],
        'xjkWriteCluster': [BOOL, [CHAR_PTR, INT]],

        // 密码管理
        'xjkChangePwd': [BOOL, [CHAR_PTR, CHAR_PTR]],
        'xjkChangePwdEx': [BOOL, [CHAR_PTR, CHAR_PTR]],

        // 加密解密
        'xjkEncrypt': [BOOL, [CHAR_PTR, INT, CHAR_PTR]],
        'xjkDecrypt': [BOOL, [CHAR_PTR, INT, CHAR_PTR]],
      });

      this.isLoaded = true;
      console.log(`XinJinKe DLL loaded successfully: ${this.dllPath}`);
      return true;
    } catch (error) {
      console.error('Failed to load XinJinKe DLL:', error.message);
      this.isLoaded = false;
      return false;
    }
  }

  /**
   * 卸载DLL库
   */
  unload() {
    if (this.lib) {
      try {
        this.lib.xjkCloseKey();
      } catch (error) {
        console.error('Error closing key:', error);
      }
      this.lib = null;
      this.isLoaded = false;
    }
  }

  /**
   * 打开U盾（默认密码）
   */
  openKey() {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }
    return this.lib.xjkOpenKey() === 1;
  }

  /**
   * 打开U盾（指定密码）
   * @param {string} password - 密码
   */
  openKeyEx(password) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    const passwordBuffer = Buffer.from(password, 'utf8');
    return this.lib.xjkOpenKeyEx(passwordBuffer) === 1;
  }

  /**
   * 关闭U盾
   */
  closeKey() {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }
    return this.lib.xjkCloseKey() === 1;
  }

  /**
   * 查找U盾端口
   */
  findPort() {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }
    return this.lib.xjkFindPort();
  }

  /**
   * 获取序列号
   * @returns {string} 序列号
   */
  getSerial() {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    const serialBuffer = Buffer.alloc(256);
    const result = this.lib.xjkGetSerial(serialBuffer);

    if (result === 1) {
      return serialBuffer.toString('utf8').replace(/\0/g, '');
    }

    return null;
  }

  /**
   * 获取扇区总数
   */
  getSectors() {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }
    return this.lib.xjkGetSectors();
  }

  /**
   * 获取簇总数
   */
  getClusters() {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }
    return this.lib.xjkGetClusters();
  }

  /**
   * 读取扇区数据
   * @param {number} sector - 扇区号
   * @returns {Buffer} 512字节数据
   */
  readSector(sector) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    const dataBuffer = Buffer.alloc(512);
    const result = this.lib.xjkReadSector(dataBuffer, sector);

    if (result === 1) {
      return dataBuffer;
    }

    return null;
  }

  /**
   * 写入扇区数据
   * @param {Buffer} data - 512字节数据
   * @param {number} sector - 扇区号
   */
  writeSector(data, sector) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    if (data.length !== 512) {
      throw new Error('Sector data must be exactly 512 bytes');
    }

    return this.lib.xjkWriteSector(data, sector) === 1;
  }

  /**
   * 读取簇数据
   * @param {number} cluster - 簇号
   * @returns {Buffer} 4096字节数据
   */
  readCluster(cluster) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    const dataBuffer = Buffer.alloc(4096);
    const result = this.lib.xjkReadCluster(dataBuffer, cluster);

    if (result === 1) {
      return dataBuffer;
    }

    return null;
  }

  /**
   * 写入簇数据
   * @param {Buffer} data - 4096字节数据
   * @param {number} cluster - 簇号
   */
  writeCluster(data, cluster) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    if (data.length !== 4096) {
      throw new Error('Cluster data must be exactly 4096 bytes');
    }

    return this.lib.xjkWriteCluster(data, cluster) === 1;
  }

  /**
   * 修改密码
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   */
  changePassword(oldPassword, newPassword) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    const oldPwdBuffer = Buffer.from(oldPassword, 'utf8');
    const newPwdBuffer = Buffer.from(newPassword, 'utf8');

    return this.lib.xjkChangePwdEx(oldPwdBuffer, newPwdBuffer) === 1;
  }

  /**
   * 加密数据
   * @param {Buffer} data - 原始数据
   * @returns {Buffer} 加密后数据
   */
  encrypt(data) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    const encryptedBuffer = Buffer.alloc(data.length + 16); // AES padding
    const result = this.lib.xjkEncrypt(data, data.length, encryptedBuffer);

    if (result === 1) {
      return encryptedBuffer;
    }

    return null;
  }

  /**
   * 解密数据
   * @param {Buffer} encryptedData - 加密数据
   * @returns {Buffer} 解密后数据
   */
  decrypt(encryptedData) {
    if (!this.isLoaded) {
      throw new Error('DLL not loaded');
    }

    const decryptedBuffer = Buffer.alloc(encryptedData.length);
    const result = this.lib.xjkDecrypt(encryptedData, encryptedData.length, decryptedBuffer);

    if (result === 1) {
      return decryptedBuffer;
    }

    return null;
  }

  /**
   * 检查DLL是否已加载
   */
  isLibraryLoaded() {
    return this.isLoaded;
  }
}

module.exports = XinJinKeNativeBinding;
