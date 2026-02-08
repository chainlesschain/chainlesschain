/**
 * Native Module Binding for XinJinKe U盾
 *
 * 使用 Koffi (Foreign Function Interface) 调用 xjk.dll
 */

const { logger } = require("../utils/logger.js");
const koffi = require("koffi");
const path = require("path");
const os = require("os");
const fs = require("fs");

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

    if (platform === "win32") {
      // Windows平台查找路径
      const possiblePaths = [
        path.join(process.cwd(), "resources", "xjk.dll"),
        path.join(
          process.env.ProgramFiles || "C:\\Program Files",
          "XinJinKe",
          "xjk.dll",
        ),
        path.join(
          process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
          "XinJinKe",
          "xjk.dll",
        ),
        "C:\\Windows\\System32\\xjk.dll",
      ];

      for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
          return p;
        }
      }

      // 默认路径
      return path.join(process.cwd(), "resources", "xjk.dll");
    }

    throw new Error(
      `Unsupported platform: ${platform}. XinJinKe dongle only supports Windows.`,
    );
  }

  /**
   * 加载DLL库
   */
  load() {
    if (this.isLoaded) {
      return true;
    }

    try {
      // 加载DLL
      this.lib = koffi.load(this.dllPath);

      // 绑定所有函数
      // 基础功能
      this.xjkOpenKey = this.lib.func("xjkOpenKey", "int", []);
      this.xjkOpenKeyEx = this.lib.func("xjkOpenKeyEx", "int", ["string"]);
      this.xjkCloseKey = this.lib.func("xjkCloseKey", "int", []);
      this.xjkFindPort = this.lib.func("xjkFindPort", "int", []);

      // 设备信息
      this.xjkGetSerial = this.lib.func("xjkGetSerial", "int", [
        koffi.out(koffi.pointer("char", 256)),
      ]);
      this.xjkGetSectors = this.lib.func("xjkGetSectors", "int", []);
      this.xjkGetClusters = this.lib.func("xjkGetClusters", "int", []);

      // 数据读写 - 扇区(512字节)
      this.xjkReadSector = this.lib.func("xjkReadSector", "int", [
        koffi.out(koffi.pointer("char", 512)),
        "int",
      ]);
      this.xjkWriteSector = this.lib.func("xjkWriteSector", "int", [
        koffi.pointer("char"),
        "int",
      ]);

      // 数据读写 - 簇(4096字节)
      this.xjkReadCluster = this.lib.func("xjkReadCluster", "int", [
        koffi.out(koffi.pointer("char", 4096)),
        "int",
      ]);
      this.xjkWriteCluster = this.lib.func("xjkWriteCluster", "int", [
        koffi.pointer("char"),
        "int",
      ]);

      // 密码管理
      this.xjkChangePwd = this.lib.func("xjkChangePwd", "int", [
        "string",
        "string",
      ]);
      this.xjkChangePwdEx = this.lib.func("xjkChangePwdEx", "int", [
        "string",
        "string",
      ]);

      // 加密解密
      this.xjkEncrypt = this.lib.func("xjkEncrypt", "int", [
        koffi.pointer("char"),
        "int",
        koffi.out(koffi.pointer("char")),
      ]);
      this.xjkDecrypt = this.lib.func("xjkDecrypt", "int", [
        koffi.pointer("char"),
        "int",
        koffi.out(koffi.pointer("char")),
      ]);

      this.isLoaded = true;
      logger.info(`XinJinKe DLL loaded successfully: ${this.dllPath}`);
      return true;
    } catch (error) {
      logger.error("Failed to load XinJinKe DLL:", error.message);
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
        this.closeKey();
      } catch (error) {
        logger.error("Error closing key:", error);
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
      throw new Error("DLL not loaded");
    }
    return this.xjkOpenKey() === 1;
  }

  /**
   * 打开U盾（指定密码）
   * @param {string} password - 密码
   */
  openKeyEx(password) {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }
    return this.xjkOpenKeyEx(password) === 1;
  }

  /**
   * 关闭U盾
   */
  closeKey() {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }
    return this.xjkCloseKey() === 1;
  }

  /**
   * 查找U盾端口
   */
  findPort() {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }
    return this.xjkFindPort();
  }

  /**
   * 获取序列号
   * @returns {string} 序列号
   */
  getSerial() {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }

    const serialBuffer = Buffer.alloc(256);
    const result = this.xjkGetSerial(serialBuffer);

    if (result === 1) {
      return serialBuffer.toString("utf8").replace(/\0/g, "");
    }

    return null;
  }

  /**
   * 获取扇区总数
   */
  getSectors() {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }
    return this.xjkGetSectors();
  }

  /**
   * 获取簇总数
   */
  getClusters() {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }
    return this.xjkGetClusters();
  }

  /**
   * 读取扇区数据
   * @param {number} sector - 扇区号
   * @returns {Buffer} 512字节数据
   */
  readSector(sector) {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }

    const dataBuffer = Buffer.alloc(512);
    const result = this.xjkReadSector(dataBuffer, sector);

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
      throw new Error("DLL not loaded");
    }

    if (data.length !== 512) {
      throw new Error("Sector data must be exactly 512 bytes");
    }

    return this.xjkWriteSector(data, sector) === 1;
  }

  /**
   * 读取簇数据
   * @param {number} cluster - 簇号
   * @returns {Buffer} 4096字节数据
   */
  readCluster(cluster) {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }

    const dataBuffer = Buffer.alloc(4096);
    const result = this.xjkReadCluster(dataBuffer, cluster);

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
      throw new Error("DLL not loaded");
    }

    if (data.length !== 4096) {
      throw new Error("Cluster data must be exactly 4096 bytes");
    }

    return this.xjkWriteCluster(data, cluster) === 1;
  }

  /**
   * 修改密码
   * @param {string} oldPassword - 旧密码
   * @param {string} newPassword - 新密码
   */
  changePassword(oldPassword, newPassword) {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }
    return this.xjkChangePwdEx(oldPassword, newPassword) === 1;
  }

  /**
   * 加密数据
   * @param {Buffer} data - 原始数据
   * @returns {Buffer} 加密后数据
   */
  encrypt(data) {
    if (!this.isLoaded) {
      throw new Error("DLL not loaded");
    }

    const encryptedBuffer = Buffer.alloc(data.length + 16); // AES padding
    const result = this.xjkEncrypt(data, data.length, encryptedBuffer);

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
      throw new Error("DLL not loaded");
    }

    const decryptedBuffer = Buffer.alloc(encryptedData.length);
    const result = this.xjkDecrypt(
      encryptedData,
      encryptedData.length,
      decryptedBuffer,
    );

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
