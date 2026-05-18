/**
 * 网络信息远程处理器
 *
 * 处理来自 Android 端的网络相关命令：
 * - network.getStatus: 获取网络状态 (PUBLIC)
 * - network.getInterfaces: 获取网络接口 (PUBLIC)
 * - network.getConnections: 获取活动连接 (NORMAL)
 * - network.getBandwidth: 获取带宽使用 (NORMAL)
 * - network.ping: Ping 测试 (NORMAL)
 * - network.getPublicIP: 获取公网 IP (PUBLIC)
 * - network.getDNS: 获取 DNS 配置 (PUBLIC)
 * - network.traceroute: 路由追踪 (ADMIN)
 * - network.getWifi: 获取 WiFi 信息 (PUBLIC)
 * - network.getSpeed: 网络速度测试 (NORMAL)
 *
 * @module remote/handlers/network-handler
 */

const { exec } = require("child_process");
const { promisify } = require("util");
const os = require("os");
const dns = require("dns");
const https = require("https");
const http = require("http");
const { logger } = require("../../utils/logger");

const execAsync = promisify(exec);
const dnsResolve = promisify(dns.resolve);

/**
 * 可取消的命令执行
 * @param {string} command - 要执行的命令
 * @param {Object} options - 执行选项
 * @param {AbortSignal} signal - 取消信号
 * @returns {Promise<{stdout: string, stderr: string}>}
 */
function execWithAbort(command, options = {}, signal) {
  return new Promise((resolve, reject) => {
    const child = exec(command, options, (error, stdout, stderr) => {
      if (error) {
        reject(error);
      } else {
        resolve({ stdout, stderr });
      }
    });

    // 监听取消信号
    if (signal) {
      const onAbort = () => {
        child.kill("SIGTERM");
        reject(new Error("Command cancelled"));
      };

      if (signal.aborted) {
        child.kill("SIGTERM");
        reject(new Error("Command cancelled"));
        return;
      }

      signal.addEventListener("abort", onAbort, { once: true });

      // 命令完成后移除监听器
      child.on("exit", () => {
        signal.removeEventListener("abort", onAbort);
      });
    }
  });
}

// 平台检测
const isWindows = process.platform === "win32";
const isMac = process.platform === "darwin";
const isLinux = process.platform === "linux";

/**
 * 验证主机名/IP地址格式（防止命令注入）
 * @param {string} host - 主机名或IP地址
 * @returns {boolean} 是否有效
 */
function isValidHost(host) {
  if (!host || typeof host !== "string") {
    return false;
  }

  // 限制长度
  if (host.length > 253) {
    return false;
  }

  // IPv4 地址
  const ipv4Regex =
    /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
  if (ipv4Regex.test(host)) {
    return true;
  }

  // IPv6 地址（简化验证）
  const ipv6Regex =
    /^(?:[0-9a-fA-F]{1,4}:){7}[0-9a-fA-F]{1,4}$|^::(?:[0-9a-fA-F]{1,4}:){0,6}[0-9a-fA-F]{1,4}$|^(?:[0-9a-fA-F]{1,4}:){1,7}:$|^(?:[0-9a-fA-F]{1,4}:){0,6}::(?:[0-9a-fA-F]{1,4}:){0,5}[0-9a-fA-F]{1,4}$/;
  if (ipv6Regex.test(host)) {
    return true;
  }

  // 主机名/域名（仅允许字母、数字、连字符、点）
  const hostnameRegex =
    /^[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(\.[a-zA-Z0-9]([a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
  if (hostnameRegex.test(host)) {
    return true;
  }

  return false;
}

/**
 * 验证正整数参数
 * @param {any} value - 输入值
 * @param {number} min - 最小值
 * @param {number} max - 最大值
 * @returns {number|null} 有效的整数或 null
 */
function validatePositiveInt(value, min = 1, max = 1000) {
  const num = parseInt(value, 10);
  if (isNaN(num) || num < min || num > max) {
    return null;
  }
  return num;
}

/**
 * 网络信息处理器类
 */
class NetworkHandler {
  constructor(options = {}) {
    this.options = {
      pingTimeout: options.pingTimeout || 5000,
      pingCount: options.pingCount || 4,
      speedTestDuration: options.speedTestDuration || 10000,
      ...options,
    };

    // 带宽监控数据
    this.bandwidthHistory = [];
    this.lastBandwidthCheck = null;

    logger.info("[NetworkHandler] 网络信息处理器已创建");
  }

  /**
   * 处理命令（统一入口）
   * @param {string} action - 操作名称
   * @param {Object} params - 参数
   * @param {Object} context - 上下文（包含 signal 用于取消）
   */
  async handle(action, params, context = {}) {
    logger.debug(`[NetworkHandler] 处理命令: ${action}`);

    switch (action) {
      case "getStatus":
        return await this.getStatus(params, context);

      case "getInterfaces":
        return await this.getInterfaces(params, context);

      case "getConnections":
        return await this.getConnections(params, context);

      case "getBandwidth":
        return await this.getBandwidth(params, context);

      case "ping":
        return await this.ping(params, context);

      case "getPublicIP":
        return await this.getPublicIP(params, context);

      case "getDNS":
        return await this.getDNS(params, context);

      case "traceroute":
        return await this.traceroute(params, context);

      case "getWifi":
        return await this.getWifi(params, context);

      case "getSpeed":
        return await this.getSpeed(params, context);

      case "resolve":
        return await this.resolveDNS(params, context);

      default:
        throw new Error(`Unknown action: ${action}`);
    }
  }

  /**
   * 获取网络状态
   */
  async getStatus(params = {}, context) {
    logger.debug(`[NetworkHandler] 获取网络状态`);

    try {
      const interfaces = os.networkInterfaces();
      let isOnline = false;
      let hasIPv4 = false;
      let hasIPv6 = false;
      let primaryInterface = null;

      // 检查网络接口
      for (const [name, addrs] of Object.entries(interfaces)) {
        for (const addr of addrs) {
          if (!addr.internal) {
            if (addr.family === "IPv4") {
              hasIPv4 = true;
              if (!primaryInterface) {
                primaryInterface = { name, address: addr.address };
              }
            } else if (addr.family === "IPv6") {
              hasIPv6 = true;
            }
          }
        }
      }

      // 测试网络连通性
      try {
        await this._checkConnectivity();
        isOnline = true;
      } catch {
        isOnline = false;
      }

      return {
        success: true,
        status: {
          online: isOnline,
          hasIPv4,
          hasIPv6,
          primaryInterface,
          interfaceCount: Object.keys(interfaces).length,
          timestamp: Date.now(),
        },
      };
    } catch (error) {
      logger.error("[NetworkHandler] 获取网络状态失败:", error);
      throw new Error(`Failed to get network status: ${error.message}`);
    }
  }

  /**
   * 检查网络连通性
   */
  async _checkConnectivity() {
    return new Promise((resolve, reject) => {
      const req = https.get(
        "https://www.google.com",
        { timeout: 5000 },
        (res) => {
          resolve(true);
          res.destroy();
        },
      );
      req.on("error", () => {
        // 尝试备用地址
        const req2 = https.get(
          "https://www.baidu.com",
          { timeout: 5000 },
          (res) => {
            resolve(true);
            res.destroy();
          },
        );
        req2.on("error", reject);
        req2.on("timeout", () => reject(new Error("Timeout")));
      });
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
    });
  }

  /**
   * 获取网络接口列表
   */
  async getInterfaces(params = {}, context) {
    const { includeInternal = false } = params;

    logger.debug(`[NetworkHandler] 获取网络接口`);

    try {
      const interfaces = os.networkInterfaces();
      const result = [];

      for (const [name, addrs] of Object.entries(interfaces)) {
        const addresses = [];

        for (const addr of addrs) {
          if (!includeInternal && addr.internal) {
            continue;
          }

          addresses.push({
            address: addr.address,
            netmask: addr.netmask,
            family: addr.family,
            mac: addr.mac,
            internal: addr.internal,
            cidr: addr.cidr,
          });
        }

        if (addresses.length > 0) {
          result.push({
            name,
            addresses,
          });
        }
      }

      return {
        success: true,
        interfaces: result,
        total: result.length,
      };
    } catch (error) {
      logger.error("[NetworkHandler] 获取网络接口失败:", error);
      throw new Error(`Failed to get interfaces: ${error.message}`);
    }
  }

  /**
   * 获取活动网络连接
   */
  async getConnections(params = {}, context) {
    const { protocol = "all", state = "all", limit = 100 } = params;

    logger.debug(`[NetworkHandler] 获取活动连接`);

    try {
      let connections = [];

      if (isWindows) {
        connections = await this._getWindowsConnections();
      } else {
        connections = await this._getUnixConnections();
      }

      // 过滤协议
      if (protocol !== "all") {
        connections = connections.filter(
          (c) => c.protocol.toLowerCase() === protocol.toLowerCase(),
        );
      }

      // 过滤状态
      if (state !== "all") {
        connections = connections.filter(
          (c) => c.state.toLowerCase() === state.toLowerCase(),
        );
      }

      // 限制数量
      const limited = connections.slice(0, limit);

      return {
        success: true,
        connections: limited,
        total: connections.length,
        returned: limited.length,
      };
    } catch (error) {
      logger.error("[NetworkHandler] 获取活动连接失败:", error);
      throw new Error(`Failed to get connections: ${error.message}`);
    }
  }

  async _getWindowsConnections() {
    const { stdout } = await execAsync("netstat -ano", {
      maxBuffer: 10 * 1024 * 1024,
    });

    const lines = stdout.trim().split("\n").slice(4); // Skip header
    const connections = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 4) {
        const [protocol, localAddr, foreignAddr, state, pid] = parts;
        const [localIp, localPort] = this._parseAddress(localAddr);
        const [remoteIp, remotePort] = this._parseAddress(foreignAddr);

        connections.push({
          protocol: protocol.toUpperCase(),
          localAddress: localIp,
          localPort: parseInt(localPort) || 0,
          remoteAddress: remoteIp,
          remotePort: parseInt(remotePort) || 0,
          state: state || "UNKNOWN",
          pid: parseInt(pid) || 0,
        });
      }
    }

    return connections;
  }

  async _getUnixConnections() {
    const { stdout } = await execAsync(
      "ss -tunapo 2>/dev/null || netstat -tunap 2>/dev/null",
      {
        maxBuffer: 10 * 1024 * 1024,
      },
    );

    const lines = stdout.trim().split("\n").slice(1); // Skip header
    const connections = [];

    for (const line of lines) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5) {
        const protocol = parts[0].toUpperCase();
        const state = parts[1];
        const localAddr = parts[4] || parts[3];
        const remoteAddr = parts[5] || parts[4];

        const [localIp, localPort] = this._parseAddress(localAddr);
        const [remoteIp, remotePort] = this._parseAddress(remoteAddr);

        connections.push({
          protocol,
          localAddress: localIp,
          localPort: parseInt(localPort) || 0,
          remoteAddress: remoteIp,
          remotePort: parseInt(remotePort) || 0,
          state: state || "UNKNOWN",
        });
      }
    }

    return connections;
  }

  _parseAddress(addr) {
    if (!addr) {
      return ["", ""];
    }

    // Handle IPv6
    if (addr.includes("[")) {
      const match = addr.match(/\[([^\]]+)\]:(\d+)/);
      if (match) {
        return [match[1], match[2]];
      }
    }

    // Handle IPv4 or hostname:port
    const lastColon = addr.lastIndexOf(":");
    if (lastColon > 0) {
      return [addr.substring(0, lastColon), addr.substring(lastColon + 1)];
    }

    return [addr, ""];
  }

  /**
   * 获取带宽使用情况
   */
  async getBandwidth(params = {}, context) {
    logger.debug(`[NetworkHandler] 获取带宽使用`);

    try {
      let bandwidth = {};

      if (isWindows) {
        bandwidth = await this._getWindowsBandwidth();
      } else if (isLinux) {
        bandwidth = await this._getLinuxBandwidth();
      } else if (isMac) {
        bandwidth = await this._getMacBandwidth();
      }

      // 计算速率
      const now = Date.now();
      let rxRate = 0;
      let txRate = 0;

      if (this.lastBandwidthCheck) {
        const timeDiff = (now - this.lastBandwidthCheck.timestamp) / 1000;
        if (timeDiff > 0) {
          rxRate =
            (bandwidth.bytesReceived - this.lastBandwidthCheck.bytesReceived) /
            timeDiff;
          txRate =
            (bandwidth.bytesSent - this.lastBandwidthCheck.bytesSent) /
            timeDiff;
        }
      }

      this.lastBandwidthCheck = {
        ...bandwidth,
        timestamp: now,
      };

      return {
        success: true,
        bandwidth: {
          ...bandwidth,
          rxRate: Math.round(rxRate), // bytes/sec
          txRate: Math.round(txRate),
          rxRateFormatted: this._formatBytes(rxRate) + "/s",
          txRateFormatted: this._formatBytes(txRate) + "/s",
          timestamp: now,
        },
      };
    } catch (error) {
      logger.error("[NetworkHandler] 获取带宽使用失败:", error);
      throw new Error(`Failed to get bandwidth: ${error.message}`);
    }
  }

  async _getWindowsBandwidth() {
    try {
      const { stdout } = await execAsync(
        'powershell -command "Get-NetAdapterStatistics | Select-Object Name, ReceivedBytes, SentBytes | ConvertTo-Json"',
      );

      const stats = JSON.parse(stdout);
      const statArray = Array.isArray(stats) ? stats : [stats];

      let totalRx = 0;
      let totalTx = 0;

      for (const stat of statArray) {
        totalRx += stat.ReceivedBytes || 0;
        totalTx += stat.SentBytes || 0;
      }

      return {
        bytesReceived: totalRx,
        bytesSent: totalTx,
        bytesReceivedFormatted: this._formatBytes(totalRx),
        bytesSentFormatted: this._formatBytes(totalTx),
      };
    } catch {
      return {
        bytesReceived: 0,
        bytesSent: 0,
        bytesReceivedFormatted: "0 B",
        bytesSentFormatted: "0 B",
      };
    }
  }

  async _getLinuxBandwidth() {
    try {
      const { stdout } = await execAsync("cat /proc/net/dev");
      const lines = stdout.trim().split("\n").slice(2);

      let totalRx = 0;
      let totalTx = 0;

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 10) {
          const iface = parts[0].replace(":", "");
          if (iface !== "lo") {
            totalRx += parseInt(parts[1]) || 0;
            totalTx += parseInt(parts[9]) || 0;
          }
        }
      }

      return {
        bytesReceived: totalRx,
        bytesSent: totalTx,
        bytesReceivedFormatted: this._formatBytes(totalRx),
        bytesSentFormatted: this._formatBytes(totalTx),
      };
    } catch {
      return {
        bytesReceived: 0,
        bytesSent: 0,
        bytesReceivedFormatted: "0 B",
        bytesSentFormatted: "0 B",
      };
    }
  }

  async _getMacBandwidth() {
    try {
      const { stdout } = await execAsync("netstat -ib");
      const lines = stdout.trim().split("\n").slice(1);

      let totalRx = 0;
      let totalTx = 0;

      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 10 && !parts[0].startsWith("lo")) {
          totalRx += parseInt(parts[6]) || 0;
          totalTx += parseInt(parts[9]) || 0;
        }
      }

      return {
        bytesReceived: totalRx,
        bytesSent: totalTx,
        bytesReceivedFormatted: this._formatBytes(totalRx),
        bytesSentFormatted: this._formatBytes(totalTx),
      };
    } catch {
      return {
        bytesReceived: 0,
        bytesSent: 0,
        bytesReceivedFormatted: "0 B",
        bytesSentFormatted: "0 B",
      };
    }
  }

  _formatBytes(bytes) {
    if (bytes === 0) {
      return "0 B";
    }
    const k = 1024;
    const sizes = ["B", "KB", "MB", "GB", "TB"];
    const i = Math.floor(Math.log(Math.abs(bytes)) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
  }

  /**
   * Ping 测试
   */
  async ping(params, context) {
    const { host, count = 4, timeout = 5000 } = params;

    if (!host) {
      throw new Error('Parameter "host" is required');
    }

    // 安全验证：防止命令注入
    if (!isValidHost(host)) {
      throw new Error(
        "Invalid host format: only alphanumeric, dots, and hyphens allowed",
      );
    }

    // 验证数值参数
    const safeCount = validatePositiveInt(count, 1, 10) || 4;
    const safeTimeout = validatePositiveInt(timeout, 1000, 30000) || 5000;

    logger.info(
      `[NetworkHandler] Ping: ${host} (count: ${safeCount}, timeout: ${safeTimeout})`,
    );

    try {
      let command;
      if (isWindows) {
        command = `ping -n ${safeCount} -w ${safeTimeout} ${host}`;
      } else {
        command = `ping -c ${safeCount} -W ${Math.ceil(safeTimeout / 1000)} ${host}`;
      }

      const startTime = Date.now();
      // 使用可取消的命令执行
      const { stdout } = await execWithAbort(
        command,
        { timeout: safeTimeout * safeCount + 5000 },
        context.signal,
      );
      const duration = Date.now() - startTime;

      // 解析结果
      const result = this._parsePingOutput(stdout, host);

      return {
        success: true,
        host,
        ...result,
        totalDuration: duration,
      };
    } catch (error) {
      logger.error(`[NetworkHandler] Ping ${host} 失败:`, error);
      return {
        success: false,
        host,
        reachable: false,
        error: error.message,
      };
    }
  }

  _parsePingOutput(output, host) {
    const lines = output.split("\n");
    let packetsTransmitted = 0;
    let packetsReceived = 0;
    let minTime = 0;
    let maxTime = 0;
    let avgTime = 0;

    for (const line of lines) {
      // Windows: Packets: Sent = 4, Received = 4, Lost = 0
      // Linux/Mac: 4 packets transmitted, 4 received, 0% packet loss
      if (line.includes("Sent =") || line.includes("packets transmitted")) {
        const match = line.match(/(\d+).*?(\d+)/);
        if (match) {
          packetsTransmitted = parseInt(match[1]);
          packetsReceived = parseInt(match[2]);
        }
      }

      // Windows: Minimum = 1ms, Maximum = 5ms, Average = 2ms
      // Linux/Mac: rtt min/avg/max/mdev = 1.234/2.345/5.678/1.234 ms
      if (line.includes("Minimum =") || line.includes("min/avg/max")) {
        const times = line.match(/[\d.]+/g);
        if (times && times.length >= 3) {
          minTime = parseFloat(times[0]);
          avgTime = parseFloat(times[1]);
          maxTime = parseFloat(times[2]);
        }
      }
    }

    const packetLoss =
      packetsTransmitted > 0
        ? ((packetsTransmitted - packetsReceived) / packetsTransmitted) * 100
        : 100;

    return {
      reachable: packetsReceived > 0,
      packetsTransmitted,
      packetsReceived,
      packetLoss: Math.round(packetLoss * 100) / 100,
      minTime,
      maxTime,
      avgTime,
    };
  }

  /**
   * 获取公网 IP
   */
  async getPublicIP(params = {}, context) {
    logger.debug(`[NetworkHandler] 获取公网 IP`);

    const services = [
      "https://api.ipify.org?format=json",
      "https://ipinfo.io/json",
      "https://api.ip.sb/geoip",
    ];

    for (const url of services) {
      try {
        const result = await this._fetchJSON(url);
        return {
          success: true,
          ip: result.ip || result.query,
          location: result.city
            ? `${result.city}, ${result.country}`
            : result.country,
          isp: result.org || result.isp,
          source: url,
        };
      } catch {
        continue;
      }
    }

    throw new Error("Failed to get public IP from all services");
  }

  async _fetchJSON(url) {
    return new Promise((resolve, reject) => {
      const client = url.startsWith("https") ? https : http;
      const req = client.get(url, { timeout: 5000 }, (res) => {
        let data = "";
        res.on("data", (chunk) => (data += chunk));
        res.on("end", () => {
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error("Invalid JSON response"));
          }
        });
      });
      req.on("error", reject);
      req.on("timeout", () => {
        req.destroy();
        reject(new Error("Timeout"));
      });
    });
  }

  /**
   * 获取 DNS 配置
   */
  async getDNS(params = {}, context) {
    logger.debug(`[NetworkHandler] 获取 DNS 配置`);

    try {
      const servers = dns.getServers();
      let systemDNS = [];

      if (isWindows) {
        try {
          const { stdout } = await execAsync(
            'powershell -command "Get-DnsClientServerAddress -AddressFamily IPv4 | Select-Object -ExpandProperty ServerAddresses"',
          );
          systemDNS = stdout.trim().split("\n").filter(Boolean);
        } catch {
          // Fallback
        }
      } else if (isLinux || isMac) {
        try {
          const { stdout } = await execAsync(
            "cat /etc/resolv.conf | grep nameserver",
          );
          systemDNS = stdout
            .trim()
            .split("\n")
            .map((line) => line.replace("nameserver ", "").trim())
            .filter(Boolean);
        } catch {
          // Fallback
        }
      }

      return {
        success: true,
        dns: {
          nodeServers: servers,
          systemServers: systemDNS.length > 0 ? systemDNS : servers,
        },
      };
    } catch (error) {
      logger.error("[NetworkHandler] 获取 DNS 配置失败:", error);
      throw new Error(`Failed to get DNS: ${error.message}`);
    }
  }

  /**
   * DNS 解析
   */
  async resolveDNS(params, context) {
    const { hostname, type = "A" } = params;

    if (!hostname) {
      throw new Error('Parameter "hostname" is required');
    }

    logger.debug(`[NetworkHandler] DNS 解析: ${hostname} (${type})`);

    try {
      const records = await dnsResolve(hostname, type);

      return {
        success: true,
        hostname,
        type,
        records: Array.isArray(records) ? records : [records],
      };
    } catch (error) {
      logger.error(`[NetworkHandler] DNS 解析 ${hostname} 失败:`, error);
      throw new Error(`Failed to resolve ${hostname}: ${error.message}`);
    }
  }

  /**
   * 路由追踪
   */
  async traceroute(params, context) {
    const { host, maxHops = 30 } = params;

    if (!host) {
      throw new Error('Parameter "host" is required');
    }

    // 安全验证：防止命令注入
    if (!isValidHost(host)) {
      throw new Error(
        "Invalid host format: only alphanumeric, dots, and hyphens allowed",
      );
    }

    // 验证数值参数
    const safeMaxHops = validatePositiveInt(maxHops, 1, 64) || 30;

    logger.info(
      `[NetworkHandler] Traceroute: ${host} (maxHops: ${safeMaxHops})`,
    );

    try {
      let command;
      if (isWindows) {
        command = `tracert -h ${safeMaxHops} ${host}`;
      } else {
        command = `traceroute -m ${safeMaxHops} ${host}`;
      }

      // 使用可取消的命令执行（traceroute 可能很慢）
      const { stdout } = await execWithAbort(
        command,
        { timeout: 120000 }, // 增加超时时间
        context.signal,
      );
      const hops = this._parseTraceroute(stdout);

      return {
        success: true,
        host,
        hops,
        totalHops: hops.length,
      };
    } catch (error) {
      logger.error(`[NetworkHandler] Traceroute ${host} 失败:`, error);
      throw new Error(`Traceroute failed: ${error.message}`);
    }
  }

  _parseTraceroute(output) {
    const lines = output.split("\n").slice(1); // Skip header
    const hops = [];

    for (const line of lines) {
      if (!line.trim()) {
        continue;
      }

      const match = line.match(/^\s*(\d+)\s+(.+)/);
      if (match) {
        const hopNum = parseInt(match[1]);
        const rest = match[2];

        // 解析 IP 和时间
        const ipMatch = rest.match(/(\d+\.\d+\.\d+\.\d+)/);
        const timeMatch = rest.match(/([\d.]+)\s*ms/g);

        hops.push({
          hop: hopNum,
          ip: ipMatch ? ipMatch[1] : null,
          times: timeMatch ? timeMatch.map((t) => parseFloat(t)) : [],
          timeout: rest.includes("*"),
        });
      }
    }

    return hops;
  }

  /**
   * 获取 WiFi 信息
   */
  async getWifi(params = {}, context) {
    logger.debug(`[NetworkHandler] 获取 WiFi 信息`);

    try {
      let wifiInfo = null;

      if (isWindows) {
        wifiInfo = await this._getWindowsWifi();
      } else if (isMac) {
        wifiInfo = await this._getMacWifi();
      } else if (isLinux) {
        wifiInfo = await this._getLinuxWifi();
      }

      return {
        success: true,
        wifi: wifiInfo,
      };
    } catch (error) {
      logger.error("[NetworkHandler] 获取 WiFi 信息失败:", error);
      return {
        success: true,
        wifi: null,
        error: error.message,
      };
    }
  }

  async _getWindowsWifi() {
    try {
      const { stdout } = await execAsync("netsh wlan show interfaces");

      const info = {};
      const lines = stdout.split("\n");

      for (const line of lines) {
        const [key, ...valueParts] = line.split(":");
        if (key && valueParts.length) {
          const cleanKey = key.trim().toLowerCase().replace(/\s+/g, "_");
          const value = valueParts.join(":").trim();
          info[cleanKey] = value;
        }
      }

      return {
        ssid: info.ssid || info.profile,
        bssid: info.bssid,
        signal: info.signal ? parseInt(info.signal) : null,
        channel: info.channel ? parseInt(info.channel) : null,
        connectionType: info.radio_type || info.network_type,
        authentication: info.authentication,
      };
    } catch {
      return null;
    }
  }

  async _getMacWifi() {
    try {
      const { stdout } = await execAsync(
        "/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport -I",
      );

      const info = {};
      const lines = stdout.split("\n");

      for (const line of lines) {
        const [key, ...valueParts] = line.split(":");
        if (key && valueParts.length) {
          info[key.trim()] = valueParts.join(":").trim();
        }
      }

      return {
        ssid: info.SSID,
        bssid: info.BSSID,
        signal: info.agrCtlRSSI ? parseInt(info.agrCtlRSSI) : null,
        noise: info.agrCtlNoise ? parseInt(info.agrCtlNoise) : null,
        channel: info.channel ? parseInt(info.channel) : null,
      };
    } catch {
      return null;
    }
  }

  async _getLinuxWifi() {
    try {
      const { stdout } = await execAsync("iwconfig 2>/dev/null | head -20");

      const info = {};
      const essidMatch = stdout.match(/ESSID:"([^"]+)"/);
      const signalMatch = stdout.match(/Signal level[=:](-?\d+)/);
      const freqMatch = stdout.match(/Frequency[=:]([0-9.]+)/);

      return {
        ssid: essidMatch ? essidMatch[1] : null,
        signal: signalMatch ? parseInt(signalMatch[1]) : null,
        frequency: freqMatch ? parseFloat(freqMatch[1]) : null,
      };
    } catch {
      return null;
    }
  }

  /**
   * 网络速度测试（简化版）
   */
  async getSpeed(params = {}, context) {
    const { testUrl = "https://speed.cloudflare.com/__down?bytes=10000000" } =
      params;

    logger.info(`[NetworkHandler] 网络速度测试`);

    try {
      const startTime = Date.now();
      let bytesDownloaded = 0;

      await new Promise((resolve, reject) => {
        const req = https.get(testUrl, { timeout: 30000 }, (res) => {
          res.on("data", (chunk) => {
            bytesDownloaded += chunk.length;
          });
          res.on("end", resolve);
          res.on("error", reject);
        });
        req.on("error", reject);
        req.on("timeout", () => {
          req.destroy();
          resolve(); // Don't reject, use what we got
        });
      });

      const duration = (Date.now() - startTime) / 1000;
      const speedBps = bytesDownloaded / duration;
      const speedMbps = (speedBps * 8) / (1024 * 1024);

      return {
        success: true,
        download: {
          bytes: bytesDownloaded,
          duration: Math.round(duration * 1000) / 1000,
          speedBps: Math.round(speedBps),
          speedMbps: Math.round(speedMbps * 100) / 100,
          speedFormatted: `${Math.round(speedMbps * 100) / 100} Mbps`,
        },
      };
    } catch (error) {
      logger.error("[NetworkHandler] 网络速度测试失败:", error);
      throw new Error(`Speed test failed: ${error.message}`);
    }
  }

  /**
   * 清理资源
   */
  async cleanup() {
    this.bandwidthHistory = [];
    this.lastBandwidthCheck = null;
    logger.info("[NetworkHandler] 资源已清理");
  }
}

module.exports = { NetworkHandler };
