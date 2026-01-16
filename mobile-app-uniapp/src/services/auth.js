/**
 * 认证服务 (Authentication Service)
 *
 * 提供PIN码管理、生物识别认证等安全功能
 * - PIN码设置、验证、修改、重置
 * - 生物识别（指纹、面容）
 * - 密钥派生和管理
 */

import CryptoJS from "crypto-js";

class AuthService {
  constructor() {
    this.pinStorageKey = "chainlesschain_pin_hash";
    this.saltStorageKey = "chainlesschain_pin_salt";
    this.biometricEnabledKey = "chainlesschain_biometric_enabled";
    this.masterKeyCache = null; // 内存中缓存主密钥
    this.sessionTimeout = 30 * 60 * 1000; // 30分钟会话超时
    this.lastAuthTime = null;
  }

  /**
   * 检查是否已设置PIN码
   * @returns {Promise<boolean>}
   */
  async hasPIN() {
    try {
      const pinHash = uni.getStorageSync(this.pinStorageKey);
      return !!pinHash;
    } catch (error) {
      console.error("❌ 检查PIN失败:", error);
      return false;
    }
  }

  /**
   * 设置PIN码（首次设置）
   * @param {string} pin - 6位数字PIN码
   * @returns {Promise<Object>} 结果对象 { success, masterKey }
   */
  async setupPIN(pin) {
    try {
      // 验证PIN格式
      if (!this._validatePIN(pin)) {
        throw new Error("PIN码必须是6位数字");
      }

      // 检查是否已设置
      const hasExisting = await this.hasPIN();
      if (hasExisting) {
        throw new Error("PIN码已设置，请使用修改功能");
      }

      // 生成随机盐值（256位）
      const salt = CryptoJS.lib.WordArray.random(256 / 8).toString();

      // 使用PBKDF2派生PIN哈希（用于验证）
      const pinHash = this._hashPIN(pin, salt, 100000);

      // 派生主密钥（用于加密数据）
      const masterKey = this._deriveMasterKey(pin, salt, 100000);

      // 存储PIN哈希和盐值
      uni.setStorageSync(this.pinStorageKey, pinHash);
      uni.setStorageSync(this.saltStorageKey, salt);

      // 缓存主密钥
      this.masterKeyCache = masterKey;
      this.lastAuthTime = Date.now();

      console.log("✅ PIN码设置成功");

      return {
        success: true,
        masterKey,
      };
    } catch (error) {
      console.error("❌ 设置PIN失败:", error);
      throw error;
    }
  }

  /**
   * 验证PIN码
   * @param {string} pin - 输入的PIN码
   * @returns {Promise<Object>} 结果对象 { success, masterKey }
   */
  async verifyPIN(pin) {
    try {
      // 检查是否已设置PIN
      const hasPin = await this.hasPIN();
      if (!hasPin) {
        throw new Error("未设置PIN码");
      }

      // 获取存储的PIN哈希和盐值
      const storedHash = uni.getStorageSync(this.pinStorageKey);
      const salt = uni.getStorageSync(this.saltStorageKey);

      // 计算输入PIN的哈希
      const inputHash = this._hashPIN(pin, salt, 100000);

      // 比对哈希
      if (inputHash !== storedHash) {
        console.warn("⚠️ PIN码验证失败");
        return {
          success: false,
          masterKey: null,
        };
      }

      // 验证成功，派生主密钥
      const masterKey = this._deriveMasterKey(pin, salt, 100000);

      // 缓存主密钥
      this.masterKeyCache = masterKey;
      this.lastAuthTime = Date.now();

      console.log("✅ PIN码验证成功");

      return {
        success: true,
        masterKey,
      };
    } catch (error) {
      console.error("❌ PIN验证失败:", error);
      throw error;
    }
  }

  /**
   * 修改PIN码
   * @param {string} oldPIN - 旧PIN码
   * @param {string} newPIN - 新PIN码
   * @returns {Promise<Object>} 结果对象 { success, masterKey, oldMasterKey }
   */
  async changePIN(oldPIN, newPIN) {
    try {
      // 验证旧PIN
      const oldResult = await this.verifyPIN(oldPIN);
      if (!oldResult.success) {
        throw new Error("旧PIN码错误");
      }

      // 保存旧密钥用于重新加密
      const oldMasterKey = oldResult.masterKey;

      // 验证新PIN格式
      if (!this._validatePIN(newPIN)) {
        throw new Error("新PIN码必须是6位数字");
      }

      // 生成新的盐值
      const newSalt = CryptoJS.lib.WordArray.random(256 / 8).toString();

      // 计算新PIN的哈希
      const newPinHash = this._hashPIN(newPIN, newSalt, 100000);

      // 派生新的主密钥
      const newMasterKey = this._deriveMasterKey(newPIN, newSalt, 100000);

      // 保存新PIN哈希和盐值
      uni.setStorageSync(this.pinStorageKey, newPinHash);
      uni.setStorageSync(this.saltStorageKey, newSalt);

      // 更新缓存
      this.masterKeyCache = newMasterKey;
      this.lastAuthTime = Date.now();

      console.log("✅ PIN码修改成功");

      return {
        success: true,
        masterKey: newMasterKey,
        oldMasterKey: oldMasterKey, // 返回旧密钥用于重新加密
        message: "PIN码修改成功，请使用新PIN码重新加密您的数据",
      };
    } catch (error) {
      console.error("❌ 修改PIN失败:", error);
      throw error;
    }
  }

  /**
   * 重置PIN码（需要助记词验证）
   * @param {string} mnemonic - 12/24 个单词的助记词
   * @param {string} newPIN - 新PIN码
   * @returns {Promise<boolean>}
   */
  async resetPIN(mnemonic, newPIN) {
    try {
      // 验证助记词
      const mnemonicValidation = this._validateMnemonic(mnemonic);
      if (!mnemonicValidation.valid) {
        throw new Error(mnemonicValidation.error || "助记词验证失败");
      }

      // 验证助记词是否匹配存储的哈希（如果存在）
      const storedMnemonicHash = uni.getStorageSync(
        "chainlesschain_mnemonic_hash",
      );
      if (storedMnemonicHash) {
        const inputMnemonicHash = this._hashMnemonic(mnemonic);
        if (inputMnemonicHash !== storedMnemonicHash) {
          throw new Error("助记词与账户不匹配");
        }
      }

      // 验证新PIN格式
      if (!this._validatePIN(newPIN)) {
        throw new Error("新PIN码必须是6位数字");
      }

      // 生成新的盐值
      const newSalt = CryptoJS.lib.WordArray.random(256 / 8).toString();

      // 计算新PIN的哈希
      const newPinHash = this._hashPIN(newPIN, newSalt, 100000);

      // 派生新的主密钥
      const newMasterKey = this._deriveMasterKey(newPIN, newSalt, 100000);

      // 保存
      uni.setStorageSync(this.pinStorageKey, newPinHash);
      uni.setStorageSync(this.saltStorageKey, newSalt);

      // 更新缓存
      this.masterKeyCache = newMasterKey;
      this.lastAuthTime = Date.now();

      console.log("✅ PIN码重置成功");
      return true;
    } catch (error) {
      console.error("❌ 重置PIN失败:", error);
      throw error;
    }
  }

  /**
   * 生成助记词（BIP39兼容）
   * @param {number} wordCount - 单词数量（12 或 24）
   * @returns {Promise<Object>} { mnemonic, success }
   */
  async generateMnemonic(wordCount = 12) {
    try {
      // 验证单词数量
      if (![12, 24].includes(wordCount)) {
        throw new Error("单词数量必须是 12 或 24");
      }

      // 计算熵的字节数：12词=128位=16字节，24词=256位=32字节
      const entropyBytes = wordCount === 12 ? 16 : 32;
      const entropy = CryptoJS.lib.WordArray.random(entropyBytes);

      // 从熵生成助记词
      const mnemonic = this._entropyToMnemonic(entropy.toString());

      // 存储助记词哈希（用于后续验证）
      const mnemonicHash = this._hashMnemonic(mnemonic);
      uni.setStorageSync("chainlesschain_mnemonic_hash", mnemonicHash);

      console.log("✅ 助记词生成成功");
      return {
        success: true,
        mnemonic,
        wordCount,
      };
    } catch (error) {
      console.error("❌ 生成助记词失败:", error);
      throw error;
    }
  }

  /**
   * 验证助记词格式和校验和（BIP39兼容）
   * @param {string} mnemonic - 助记词字符串
   * @returns {{ valid: boolean, error?: string }}
   */
  _validateMnemonic(mnemonic) {
    if (!mnemonic || typeof mnemonic !== "string") {
      return { valid: false, error: "助记词不能为空" };
    }

    // 清理和规范化
    const words = mnemonic.trim().toLowerCase().split(/\s+/);
    const wordCount = words.length;

    // 检查单词数量（BIP39: 12, 15, 18, 21, 24）
    const validWordCounts = [12, 15, 18, 21, 24];
    if (!validWordCounts.includes(wordCount)) {
      return {
        valid: false,
        error: `助记词必须是 ${validWordCounts.join("/")} 个单词，当前为 ${wordCount} 个`,
      };
    }

    // 检查每个单词是否在 BIP39 词表中
    for (let i = 0; i < words.length; i++) {
      const word = words[i];
      if (!BIP39_WORDLIST_EN.includes(word)) {
        return {
          valid: false,
          error: `第 ${i + 1} 个单词 "${word}" 不在 BIP39 词表中`,
        };
      }
    }

    // 验证校验和
    if (!this._verifyMnemonicChecksum(words)) {
      return {
        valid: false,
        error: "助记词校验和无效",
      };
    }

    return { valid: true };
  }

  /**
   * 验证助记词校验和
   * @private
   * @param {string[]} words - 单词数组
   * @returns {boolean}
   */
  _verifyMnemonicChecksum(words) {
    try {
      // 将单词转换为位串
      let bits = "";
      for (const word of words) {
        const index = BIP39_WORDLIST_EN.indexOf(word);
        if (index === -1) return false;
        bits += index.toString(2).padStart(11, "0");
      }

      // 计算熵和校验和的位数
      const entropyBits = (words.length * 11 * 32) / 33;
      const checksumBits = words.length * 11 - entropyBits;

      // 提取熵
      const entropyBitString = bits.slice(0, entropyBits);
      const checksumBitString = bits.slice(entropyBits);

      // 将熵转换为十六进制
      let entropyHex = "";
      for (let i = 0; i < entropyBitString.length; i += 8) {
        entropyHex += parseInt(entropyBitString.slice(i, i + 8), 2)
          .toString(16)
          .padStart(2, "0");
      }

      // 计算 SHA256 哈希
      const hash = CryptoJS.SHA256(
        CryptoJS.enc.Hex.parse(entropyHex),
      ).toString();

      // 提取前 N 位作为校验和
      let hashBits = "";
      for (let i = 0; i < hash.length; i++) {
        hashBits += parseInt(hash[i], 16).toString(2).padStart(4, "0");
      }
      const expectedChecksum = hashBits.slice(0, checksumBits);

      return checksumBitString === expectedChecksum;
    } catch (error) {
      console.error("校验和验证错误:", error);
      return false;
    }
  }

  /**
   * 从熵生成助记词
   * @private
   * @param {string} entropyHex - 十六进制熵
   * @returns {string}
   */
  _entropyToMnemonic(entropyHex) {
    // 计算 SHA256 校验和
    const hash = CryptoJS.SHA256(CryptoJS.enc.Hex.parse(entropyHex)).toString();

    // 将熵转换为位串
    let bits = "";
    for (let i = 0; i < entropyHex.length; i += 2) {
      bits += parseInt(entropyHex.slice(i, i + 2), 16)
        .toString(2)
        .padStart(8, "0");
    }

    // 计算校验和位数（熵位数 / 32）
    const checksumBits = bits.length / 32;

    // 添加校验和位
    let hashBits = "";
    for (let i = 0; i < hash.length; i++) {
      hashBits += parseInt(hash[i], 16).toString(2).padStart(4, "0");
    }
    bits += hashBits.slice(0, checksumBits);

    // 每 11 位转换为一个单词
    const words = [];
    for (let i = 0; i < bits.length; i += 11) {
      const index = parseInt(bits.slice(i, i + 11), 2);
      words.push(BIP39_WORDLIST_EN[index]);
    }

    return words.join(" ");
  }

  /**
   * 哈希助记词（用于验证）
   * @private
   * @param {string} mnemonic
   * @returns {string}
   */
  _hashMnemonic(mnemonic) {
    const normalized = mnemonic.trim().toLowerCase();
    return CryptoJS.SHA256(normalized).toString();
  }

  /**
   * 清除PIN码（危险操作，仅用于测试）
   * @returns {Promise<boolean>}
   */
  async clearPIN() {
    try {
      uni.removeStorageSync(this.pinStorageKey);
      uni.removeStorageSync(this.saltStorageKey);
      this.masterKeyCache = null;
      this.lastAuthTime = null;
      console.log("⚠️ PIN码已清除");
      return true;
    } catch (error) {
      console.error("❌ 清除PIN失败:", error);
      return false;
    }
  }

  /**
   * 获取缓存的主密钥
   * @param {boolean} checkSession - 是否检查会话超时
   * @returns {string|null}
   */
  getMasterKey(checkSession = true) {
    if (!this.masterKeyCache) {
      return null;
    }

    // 检查会话是否超时
    if (checkSession && this.lastAuthTime) {
      const elapsed = Date.now() - this.lastAuthTime;
      if (elapsed > this.sessionTimeout) {
        console.warn("⚠️ 会话已超时，请重新验证PIN");
        this.clearSession();
        return null;
      }
    }

    // 刷新最后认证时间
    this.lastAuthTime = Date.now();
    return this.masterKeyCache;
  }

  /**
   * 清除会话缓存
   */
  clearSession() {
    this.masterKeyCache = null;
    this.lastAuthTime = null;
    console.log("✅ 会话已清除");
  }

  // ==================== SIMKey硬件安全 ====================

  /**
   * 检测SIMKey设备（占位方法，未实现）
   * @returns {Promise<Object>} { detected, serialNumber }
   */
  async detectSIMKey() {
    // TODO: Phase 2实现SIMKey硬件集成
    return {
      detected: false,
      serialNumber: null,
      message: "SIMKey功能将在Phase 2实现",
    };
  }

  // ==================== 生物识别 ====================

  /**
   * 检查设备是否支持生物识别
   * @returns {Promise<Object>} { supported, types }
   */
  async checkBiometricSupport() {
    return new Promise((resolve) => {
      // #ifdef APP-PLUS || H5
      uni.checkIsSupportSoterAuthentication({
        success(res) {
          console.log("✅ 生物识别支持:", res);
          resolve({
            supported: res.supportMode && res.supportMode.length > 0,
            types: res.supportMode || [],
          });
        },
        fail(err) {
          console.warn("⚠️ 生物识别检查失败:", err);
          resolve({
            supported: false,
            types: [],
          });
        },
      });
      // #endif

      // #ifdef MP-WEIXIN
      // 微信小程序暂不支持生物识别
      resolve({
        supported: false,
        types: [],
      });
      // #endif
    });
  }

  /**
   * 是否已启用生物识别
   * @returns {boolean}
   */
  isBiometricEnabled() {
    try {
      return uni.getStorageSync(this.biometricEnabledKey) === "true";
    } catch (error) {
      return false;
    }
  }

  /**
   * 启用生物识别
   * @param {string} pin - PIN码（用于验证身份）
   * @returns {Promise<boolean>}
   */
  async enableBiometric(pin) {
    try {
      // 1. 验证PIN码
      const result = await this.verifyPIN(pin);
      if (!result.success) {
        throw new Error("PIN码错误");
      }

      // 2. 检查设备支持
      const support = await this.checkBiometricSupport();
      if (!support.supported) {
        throw new Error("设备不支持生物识别");
      }

      // 3. 请求生物识别认证（验证是否可用）
      const authResult = await this._requestBiometric("请验证以启用生物识别");
      if (!authResult.success) {
        throw new Error("生物识别验证失败");
      }

      // 4. 启用
      uni.setStorageSync(this.biometricEnabledKey, "true");
      console.log("✅ 生物识别已启用");

      return true;
    } catch (error) {
      console.error("❌ 启用生物识别失败:", error);
      throw error;
    }
  }

  /**
   * 禁用生物识别
   * @returns {Promise<boolean>}
   */
  async disableBiometric() {
    try {
      uni.setStorageSync(this.biometricEnabledKey, "false");
      console.log("✅ 生物识别已禁用");
      return true;
    } catch (error) {
      console.error("❌ 禁用生物识别失败:", error);
      return false;
    }
  }

  /**
   * 使用生物识别验证
   * @param {string} challenge - 挑战字符串（可选）
   * @returns {Promise<Object>} { success, masterKey }
   */
  async verifyBiometric(challenge = "请验证身份") {
    try {
      // 检查是否启用
      if (!this.isBiometricEnabled()) {
        throw new Error("未启用生物识别");
      }

      // 请求生物识别认证
      const authResult = await this._requestBiometric(challenge);
      if (!authResult.success) {
        return {
          success: false,
          masterKey: null,
        };
      }

      // 认证成功，获取主密钥
      // 注意：这里需要用户先用PIN登录过一次
      const masterKey = this.getMasterKey(false);
      if (!masterKey) {
        throw new Error("请先使用PIN码登录");
      }

      // 刷新会话
      this.lastAuthTime = Date.now();

      console.log("✅ 生物识别验证成功");

      return {
        success: true,
        masterKey,
      };
    } catch (error) {
      console.error("❌ 生物识别验证失败:", error);
      throw error;
    }
  }

  /**
   * 请求生物识别认证（内部方法）
   * @private
   * @param {string} authContent - 认证提示文字
   * @returns {Promise<Object>}
   */
  async _requestBiometric(authContent = "请验证身份") {
    return new Promise((resolve) => {
      // #ifdef APP-PLUS || H5
      uni.startSoterAuthentication({
        requestAuthModes: ["facial", "fingerprint"],
        challenge: Date.now().toString(),
        authContent: authContent,
        success(res) {
          console.log("✅ 生物识别成功:", res);
          resolve({
            success: true,
            authMode: res.authMode,
            resultJSON: res.resultJSON,
          });
        },
        fail(err) {
          console.warn("⚠️ 生物识别失败:", err);
          resolve({
            success: false,
            error: err.errMsg,
          });
        },
      });
      // #endif

      // #ifdef MP-WEIXIN
      // 微信小程序暂不支持
      resolve({
        success: false,
        error: "微信小程序不支持生物识别",
      });
      // #endif
    });
  }

  // ==================== 私有方法 ====================

  /**
   * 验证PIN格式
   * @private
   * @param {string} pin
   * @returns {boolean}
   */
  _validatePIN(pin) {
    return /^\d{6}$/.test(pin);
  }

  /**
   * 使用PBKDF2计算PIN哈希
   * @private
   * @param {string} pin - PIN码
   * @param {string} salt - 盐值
   * @param {number} iterations - 迭代次数
   * @returns {string} Base64编码的哈希
   */
  _hashPIN(pin, salt, iterations = 100000) {
    return CryptoJS.PBKDF2(pin, salt, {
      keySize: 256 / 32,
      iterations: iterations,
      hasher: CryptoJS.algo.SHA256,
    }).toString();
  }

  /**
   * 派生主密钥
   * @private
   * @param {string} pin - PIN码
   * @param {string} salt - 盐值
   * @param {number} iterations - 迭代次数
   * @returns {string} Base64编码的主密钥
   */
  _deriveMasterKey(pin, salt, iterations = 100000) {
    // 使用不同的派生参数，确保主密钥和PIN哈希不同
    const masterKeySalt = "chainlesschain-master-key-" + salt;
    return CryptoJS.PBKDF2(pin, masterKeySalt, {
      keySize: 256 / 32,
      iterations: iterations,
      hasher: CryptoJS.algo.SHA256,
    }).toString();
  }

  /**
   * 使用主密钥加密数据
   * @param {string} data - 明文数据
   * @param {string} masterKey - 主密钥（可选，不提供则从缓存获取）
   * @returns {string} 加密后的数据
   */
  encrypt(data, masterKey = null) {
    const key = masterKey || this.getMasterKey();
    if (!key) {
      throw new Error("主密钥未初始化，请先验证PIN");
    }
    return CryptoJS.AES.encrypt(data, key).toString();
  }

  /**
   * 使用主密钥解密数据
   * @param {string} encryptedData - 密文数据
   * @param {string} masterKey - 主密钥（可选，不提供则从缓存获取）
   * @returns {string} 解密后的数据
   */
  decrypt(encryptedData, masterKey = null) {
    const key = masterKey || this.getMasterKey();
    if (!key) {
      throw new Error("主密钥未初始化，请先验证PIN");
    }
    const bytes = CryptoJS.AES.decrypt(encryptedData, key);
    return bytes.toString(CryptoJS.enc.Utf8);
  }
}

// 导出单例
export default new AuthService();
