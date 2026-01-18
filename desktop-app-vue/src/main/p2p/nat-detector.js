/**
 * NAT类型检测器
 * 使用STUN协议检测NAT类型和公网IP
 */

const dgram = require("dgram");
const { promisify } = require("util");

/**
 * NAT类型枚举
 */
const NAT_TYPES = {
  NONE: "none", // 无NAT（公网IP）
  FULL_CONE: "full-cone", // 完全锥形NAT
  RESTRICTED: "restricted", // 受限锥形NAT
  PORT_RESTRICTED: "port-restricted", // 端口受限NAT
  SYMMETRIC: "symmetric", // 对称NAT
  UNKNOWN: "unknown", // 未知
};

class NATDetector {
  constructor() {
    this.cache = null;
    this.cacheTTL = 60 * 60 * 1000; // 1小时
  }

  /**
   * 检测NAT类型
   * @param {Array<string>} stunServers - STUN服务器列表 (格式: 'stun:host:port')
   * @returns {Promise<Object>} NAT检测结果
   */
  async detectNATType(stunServers) {
    // 检查缓存
    const cached = this.getCachedResult();
    if (cached) {
      console.log("[NAT Detector] 使用缓存的NAT检测结果");
      return cached;
    }

    if (!stunServers || stunServers.length === 0) {
      console.warn("[NAT Detector] 未提供STUN服务器，使用默认配置");
      stunServers = ["stun:stun.l.google.com:19302"];
    }

    try {
      // 获取本地IP
      const localIP = await this.getLocalIP();

      // 尝试查询第一个STUN服务器
      const result1 = await this.querySTUNServer(stunServers[0]);

      if (!result1) {
        throw new Error("STUN查询失败");
      }

      const publicIP = result1.mappedAddress;

      // 判断是否无NAT
      if (localIP === publicIP) {
        const result = {
          type: NAT_TYPES.NONE,
          publicIP: publicIP,
          localIP: localIP,
          timestamp: Date.now(),
          description: "无NAT，设备拥有公网IP",
        };
        this.cacheResult(result);
        return result;
      }

      // 尝试查询第二个STUN服务器（不同IP）
      if (stunServers.length > 1) {
        const result2 = await this.querySTUNServer(stunServers[1]);

        if (result2) {
          // 比较两个服务器返回的映射地址
          if (
            result1.mappedAddress === result2.mappedAddress &&
            result1.mappedPort === result2.mappedPort
          ) {
            // 映射地址一致，可能是Full Cone或Restricted NAT
            const result = {
              type: NAT_TYPES.FULL_CONE,
              publicIP: publicIP,
              localIP: localIP,
              timestamp: Date.now(),
              description: "完全锥形NAT，NAT穿透能力最佳",
            };
            this.cacheResult(result);
            return result;
          } else {
            // 映射地址不一致，是对称NAT
            const result = {
              type: NAT_TYPES.SYMMETRIC,
              publicIP: publicIP,
              localIP: localIP,
              timestamp: Date.now(),
              description: "对称NAT，需要中继或TURN服务器",
            };
            this.cacheResult(result);
            return result;
          }
        }
      }

      // 默认返回受限NAT
      const result = {
        type: NAT_TYPES.RESTRICTED,
        publicIP: publicIP,
        localIP: localIP,
        timestamp: Date.now(),
        description: "受限NAT，WebRTC可穿透",
      };
      this.cacheResult(result);
      return result;
    } catch (error) {
      console.error("[NAT Detector] NAT检测失败:", error);
      return {
        type: NAT_TYPES.UNKNOWN,
        publicIP: null,
        localIP: await this.getLocalIP(),
        timestamp: Date.now(),
        error: error.message,
        description: "NAT检测失败，可能网络不可达",
      };
    }
  }

  /**
   * 查询STUN服务器
   * @param {string} stunServerUrl - STUN服务器URL (格式: 'stun:host:port')
   * @returns {Promise<Object|null>} STUN响应结果
   */
  async querySTUNServer(stunServerUrl) {
    return new Promise((resolve) => {
      // 解析STUN URL
      const match = stunServerUrl.match(/stun:([^:]+):(\d+)/);
      if (!match) {
        console.error("[NAT Detector] 无效的STUN URL:", stunServerUrl);
        resolve(null);
        return;
      }

      const host = match[1];
      const port = parseInt(match[2]);

      // 创建UDP socket
      const socket = dgram.createSocket("udp4");
      let timeout;
      let socketClosed = false;

      // 安全关闭 socket 的辅助函数
      const safeClose = () => {
        if (!socketClosed) {
          socketClosed = true;
          try {
            socket.close();
          } catch (e) {
            // 忽略关闭时的错误
          }
        }
      };

      // 构建STUN绑定请求 (RFC 5389)
      const stunRequest = this.buildSTUNBindingRequest();

      socket.on("message", (msg, rinfo) => {
        clearTimeout(timeout);

        try {
          // 解析STUN响应
          const response = this.parseSTUNResponse(msg);

          if (response) {
            console.log(
              `[NAT Detector] STUN响应: ${rinfo.address}:${rinfo.port} -> 映射地址: ${response.mappedAddress}:${response.mappedPort}`,
            );
            safeClose();
            resolve(response);
          } else {
            safeClose();
            resolve(null);
          }
        } catch (error) {
          console.error("[NAT Detector] 解析STUN响应失败:", error);
          safeClose();
          resolve(null);
        }
      });

      socket.on("error", (err) => {
        console.error(
          `[NAT Detector] STUN查询错误 (${host}:${port}):`,
          err.message,
        );
        clearTimeout(timeout);
        safeClose();
        resolve(null);
      });

      // 设置5秒超时
      timeout = setTimeout(() => {
        console.warn(`[NAT Detector] STUN查询超时 (${host}:${port})`);
        safeClose();
        resolve(null);
      }, 5000);

      // 发送STUN请求
      socket.send(stunRequest, port, host, (err) => {
        if (err) {
          console.error(
            `[NAT Detector] 发送STUN请求失败 (${host}:${port}):`,
            err,
          );
          clearTimeout(timeout);
          safeClose();
          resolve(null);
        } else {
          console.log(`[NAT Detector] 已发送STUN请求到 ${host}:${port}`);
        }
      });
    });
  }

  /**
   * 构建STUN绑定请求 (RFC 5389)
   * @returns {Buffer} STUN请求数据包
   */
  buildSTUNBindingRequest() {
    const buffer = Buffer.alloc(20);

    // Message Type: Binding Request (0x0001)
    buffer.writeUInt16BE(0x0001, 0);

    // Message Length: 0 (no attributes)
    buffer.writeUInt16BE(0x0000, 2);

    // Magic Cookie: 0x2112A442
    buffer.writeUInt32BE(0x2112a442, 4);

    // Transaction ID: 12 random bytes
    for (let i = 0; i < 12; i++) {
      buffer[8 + i] = Math.floor(Math.random() * 256);
    }

    return buffer;
  }

  /**
   * 解析STUN响应
   * @param {Buffer} buffer - STUN响应数据包
   * @returns {Object|null} 解析结果
   */
  parseSTUNResponse(buffer) {
    if (buffer.length < 20) {
      return null;
    }

    // 验证Magic Cookie
    const magicCookie = buffer.readUInt32BE(4);
    if (magicCookie !== 0x2112a442) {
      return null;
    }

    // Message Type: Binding Success Response (0x0101)
    const messageType = buffer.readUInt16BE(0);
    if (messageType !== 0x0101) {
      return null;
    }

    const messageLength = buffer.readUInt16BE(2);
    let offset = 20;

    // 解析属性
    while (offset < 20 + messageLength) {
      const attrType = buffer.readUInt16BE(offset);
      const attrLength = buffer.readUInt16BE(offset + 2);
      const attrValue = buffer.slice(offset + 4, offset + 4 + attrLength);

      // MAPPED-ADDRESS (0x0001) 或 XOR-MAPPED-ADDRESS (0x0020)
      if (attrType === 0x0001 || attrType === 0x0020) {
        const family = attrValue[1];

        if (family === 0x01) {
          // IPv4
          let port, ip;

          if (attrType === 0x0020) {
            // XOR-MAPPED-ADDRESS
            // XOR端口与Magic Cookie的前16位
            port = attrValue.readUInt16BE(2) ^ 0x2112;

            // XOR IP地址与Magic Cookie
            const xorIP = Buffer.alloc(4);
            for (let i = 0; i < 4; i++) {
              xorIP[i] = attrValue[4 + i] ^ buffer[4 + i];
            }
            ip = Array.from(xorIP).join(".");
          } else {
            // MAPPED-ADDRESS
            port = attrValue.readUInt16BE(2);
            ip = Array.from(attrValue.slice(4, 8)).join(".");
          }

          return {
            mappedAddress: ip,
            mappedPort: port,
          };
        }
      }

      // 移动到下一个属性（4字节对齐）
      offset += 4 + attrLength;
      const padding = (4 - (attrLength % 4)) % 4;
      offset += padding;
    }

    return null;
  }

  /**
   * 获取本地IP地址
   * @returns {Promise<string>} 本地IP
   */
  async getLocalIP() {
    const os = require("os");
    const interfaces = os.networkInterfaces();

    for (const name of Object.keys(interfaces)) {
      for (const iface of interfaces[name]) {
        // 跳过内部和IPv6地址
        if (!iface.internal && iface.family === "IPv4") {
          return iface.address;
        }
      }
    }

    return "127.0.0.1";
  }

  /**
   * 获取公网IP（从缓存的检测结果）
   * @returns {string|null} 公网IP
   */
  getPublicIP() {
    const cached = this.getCachedResult();
    return cached ? cached.publicIP : null;
  }

  /**
   * 获取缓存的检测结果
   * @returns {Object|null} 缓存的结果
   */
  getCachedResult() {
    if (!this.cache) {
      return null;
    }

    const now = Date.now();
    if (now - this.cache.timestamp > this.cacheTTL) {
      console.log("[NAT Detector] 缓存已过期");
      this.cache = null;
      return null;
    }

    return this.cache;
  }

  /**
   * 缓存检测结果
   * @param {Object} result - 检测结果
   */
  cacheResult(result) {
    this.cache = result;
    console.log(`[NAT Detector] 已缓存NAT检测结果，类型: ${result.type}`);
  }

  /**
   * 使缓存失效
   */
  invalidateCache() {
    this.cache = null;
    console.log("[NAT Detector] 缓存已清除");
  }
}

module.exports = NATDetector;
