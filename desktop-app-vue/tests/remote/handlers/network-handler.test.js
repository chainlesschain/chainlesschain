/**
 * NetworkHandler 单元测试
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock logger
vi.mock("../../../src/main/utils/logger", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// Mock execAsync results
const mockExecAsync = vi.fn();

// Mock child_process
vi.mock("child_process", () => ({
  exec: vi.fn((cmd, opts, callback) => {
    if (typeof opts === "function") {
      callback = opts;
    }
    setImmediate(() => callback(null, "", ""));
  }),
}));

// Mock util.promisify
vi.mock("util", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    promisify: (fn) => {
      if (fn.name === "exec") {
        return mockExecAsync;
      }
      return actual.promisify(fn);
    },
  };
});

// Mock os module
vi.mock("os", () => ({
  networkInterfaces: () => ({
    eth0: [
      {
        address: "192.168.1.100",
        netmask: "255.255.255.0",
        family: "IPv4",
        mac: "00:11:22:33:44:55",
        internal: false,
        cidr: "192.168.1.100/24",
      },
    ],
    lo: [
      {
        address: "127.0.0.1",
        netmask: "255.0.0.0",
        family: "IPv4",
        mac: "00:00:00:00:00:00",
        internal: true,
        cidr: "127.0.0.1/8",
      },
    ],
  }),
}));

// Mock dns module
vi.mock("dns", () => ({
  getServers: () => ["8.8.8.8", "8.8.4.4"],
  resolve: vi.fn((hostname, type, callback) => {
    callback(null, ["93.184.216.34"]);
  }),
}));

// Mock https/http modules
vi.mock("https", () => ({
  get: vi.fn((url, opts, callback) => {
    if (typeof opts === "function") {
      callback = opts;
    }
    const mockRes = {
      on: vi.fn((event, handler) => {
        if (event === "data") {
          handler(Buffer.from(JSON.stringify({ ip: "203.0.113.1" })));
        }
        if (event === "end") {
          handler();
        }
        return mockRes;
      }),
      destroy: vi.fn(),
    };
    setImmediate(() => callback(mockRes));
    return {
      on: vi.fn().mockReturnThis(),
      destroy: vi.fn(),
    };
  }),
}));

const {
  NetworkHandler,
} = require("../../../src/main/remote/handlers/network-handler");

describe("NetworkHandler", () => {
  let handler;
  const mockContext = { did: "did:example:123" };

  beforeEach(() => {
    vi.clearAllMocks();
    mockExecAsync.mockResolvedValue({ stdout: "", stderr: "" });
    handler = new NetworkHandler();
  });

  afterEach(async () => {
    if (handler) {
      await handler.cleanup();
    }
  });

  describe("getStatus", () => {
    it("应该返回网络状态", async () => {
      const result = await handler.handle("getStatus", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.status).toBeDefined();
      expect(typeof result.status.hasIPv4).toBe("boolean");
      expect(typeof result.status.hasIPv6).toBe("boolean");
      expect(result.status.interfaceCount).toBeGreaterThan(0);
    });

    it("应该返回主要网络接口", async () => {
      const result = await handler.handle("getStatus", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.status.primaryInterface).toBeDefined();
    });
  });

  describe("getInterfaces", () => {
    it("应该返回网络接口列表", async () => {
      const result = await handler.handle("getInterfaces", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.interfaces)).toBe(true);
      expect(result.total).toBeGreaterThan(0);
    });

    it("不包含内部接口（默认）", async () => {
      const result = await handler.handle("getInterfaces", {}, mockContext);

      expect(result.success).toBe(true);
      const hasInternal = result.interfaces.some((iface) =>
        iface.addresses.some((addr) => addr.internal),
      );
      expect(hasInternal).toBe(false);
    });

    it("应该支持包含内部接口", async () => {
      const result = await handler.handle(
        "getInterfaces",
        { includeInternal: true },
        mockContext,
      );

      expect(result.success).toBe(true);
    });
  });

  describe("getConnections", () => {
    it("应该返回活动连接列表", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Active Connections
Proto  Local Address          Foreign Address        State           PID
TCP    192.168.1.100:445      192.168.1.50:52341     ESTABLISHED     4
TCP    192.168.1.100:3389     0.0.0.0:0              LISTENING       1234`,
        stderr: "",
      });

      const result = await handler.handle("getConnections", {}, mockContext);

      expect(result.success).toBe(true);
      expect(Array.isArray(result.connections)).toBe(true);
    });

    it("应该支持按协议过滤", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Active Connections
Proto  Local Address          Foreign Address        State           PID
TCP    192.168.1.100:445      192.168.1.50:52341     ESTABLISHED     4
UDP    192.168.1.100:137      0.0.0.0:0              LISTENING       1234`,
        stderr: "",
      });

      const result = await handler.handle(
        "getConnections",
        { protocol: "tcp" },
        mockContext,
      );

      expect(result.success).toBe(true);
    });
  });

  describe("getBandwidth", () => {
    it("应该返回带宽使用情况", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { Name: "Ethernet", ReceivedBytes: 1000000, SentBytes: 500000 },
        ]),
        stderr: "",
      });

      const result = await handler.handle("getBandwidth", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.bandwidth).toBeDefined();
      expect(typeof result.bandwidth.bytesReceived).toBe("number");
      expect(typeof result.bandwidth.bytesSent).toBe("number");
    });

    it("应该计算传输速率", async () => {
      // 第一次调用建立基线
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { Name: "Ethernet", ReceivedBytes: 1000000, SentBytes: 500000 },
        ]),
        stderr: "",
      });
      await handler.handle("getBandwidth", {}, mockContext);

      // 第二次调用计算速率
      mockExecAsync.mockResolvedValueOnce({
        stdout: JSON.stringify([
          { Name: "Ethernet", ReceivedBytes: 2000000, SentBytes: 600000 },
        ]),
        stderr: "",
      });
      const result = await handler.handle("getBandwidth", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.bandwidth.rxRate).toBeGreaterThanOrEqual(0);
      expect(result.bandwidth.txRate).toBeGreaterThanOrEqual(0);
    });
  });

  describe("ping", () => {
    it.skip("应该成功执行 ping 测试 (跳过: 需要实际网络)", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Pinging google.com [142.250.185.46] with 32 bytes of data:
Reply from 142.250.185.46: bytes=32 time=15ms TTL=117
Reply from 142.250.185.46: bytes=32 time=14ms TTL=117

Ping statistics for 142.250.185.46:
    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),
Approximate round trip times in milli-seconds:
    Minimum = 14ms, Maximum = 15ms, Average = 14ms`,
        stderr: "",
      });

      const result = await handler.handle(
        "ping",
        { host: "google.com" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.host).toBe("google.com");
      expect(result.reachable).toBe(true);
    }, 30000);

    it("缺少 host 参数应该报错", async () => {
      await expect(handler.handle("ping", {}, mockContext)).rejects.toThrow(
        'Parameter "host" is required',
      );
    });

    it("应该处理 ping 失败的情况", async () => {
      mockExecAsync.mockRejectedValueOnce(new Error("Request timed out"));

      const result = await handler.handle(
        "ping",
        { host: "nonexistent.example.com" },
        mockContext,
      );

      expect(result.success).toBe(false);
      expect(result.reachable).toBe(false);
    });

    // 命令注入防护测试
    it("应该拒绝包含命令注入的 host", async () => {
      await expect(
        handler.handle("ping", { host: "127.0.0.1 & whoami" }, mockContext),
      ).rejects.toThrow("Invalid host format");
    });

    it("应该拒绝包含分号的 host", async () => {
      await expect(
        handler.handle("ping", { host: "127.0.0.1; rm -rf /" }, mockContext),
      ).rejects.toThrow("Invalid host format");
    });

    it("应该拒绝包含管道符的 host", async () => {
      await expect(
        handler.handle(
          "ping",
          { host: "127.0.0.1 | cat /etc/passwd" },
          mockContext,
        ),
      ).rejects.toThrow("Invalid host format");
    });

    it("应该拒绝包含反引号的 host", async () => {
      await expect(
        handler.handle("ping", { host: "`whoami`.example.com" }, mockContext),
      ).rejects.toThrow("Invalid host format");
    });

    it.skip("应该接受有效的 IPv4 地址 (跳过: 需要实际网络)", async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: "Ping reply", stderr: "" });
      const result = await handler.handle(
        "ping",
        { host: "192.168.1.1" },
        mockContext,
      );
      expect(result.host).toBe("192.168.1.1");
    });

    it.skip("应该接受有效的域名 (跳过: 需要实际网络)", async () => {
      mockExecAsync.mockResolvedValueOnce({ stdout: "Ping reply", stderr: "" });
      const result = await handler.handle(
        "ping",
        { host: "sub.example-site.com" },
        mockContext,
      );
      expect(result.host).toBe("sub.example-site.com");
    });
  });

  describe("getPublicIP", () => {
    it("应该返回公网 IP", async () => {
      const result = await handler.handle("getPublicIP", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.ip).toBeDefined();
    });
  });

  describe("getDNS", () => {
    it("应该返回 DNS 配置", async () => {
      const result = await handler.handle("getDNS", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.dns).toBeDefined();
      expect(Array.isArray(result.dns.nodeServers)).toBe(true);
    });
  });

  describe("resolve", () => {
    it("应该解析域名", async () => {
      const result = await handler.handle(
        "resolve",
        { hostname: "example.com" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.hostname).toBe("example.com");
      expect(Array.isArray(result.records)).toBe(true);
    });

    it("缺少 hostname 参数应该报错", async () => {
      await expect(handler.handle("resolve", {}, mockContext)).rejects.toThrow(
        'Parameter "hostname" is required',
      );
    });
  });

  describe("traceroute", () => {
    it.skip("应该执行路由追踪 (跳过: 需要实际网络)", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `traceroute to google.com (142.250.185.46), 30 hops max
 1  192.168.1.1  1.234 ms  1.456 ms  1.789 ms
 2  10.0.0.1    5.678 ms  6.789 ms  7.890 ms
 3  142.250.185.46  15.234 ms  15.456 ms  15.789 ms`,
        stderr: "",
      });

      const result = await handler.handle(
        "traceroute",
        { host: "google.com" },
        mockContext,
      );

      expect(result.success).toBe(true);
      expect(result.host).toBe("google.com");
      expect(Array.isArray(result.hops)).toBe(true);
    }, 65000);

    it("缺少 host 参数应该报错", async () => {
      await expect(
        handler.handle("traceroute", {}, mockContext),
      ).rejects.toThrow('Parameter "host" is required');
    });

    // 命令注入防护测试
    it("应该拒绝包含命令注入的 host", async () => {
      await expect(
        handler.handle(
          "traceroute",
          { host: "8.8.8.8 && cat /etc/shadow" },
          mockContext,
        ),
      ).rejects.toThrow("Invalid host format");
    });

    it("应该拒绝包含换行符的 host", async () => {
      await expect(
        handler.handle("traceroute", { host: "8.8.8.8\nwhoami" }, mockContext),
      ).rejects.toThrow("Invalid host format");
    });
  });

  describe("getWifi", () => {
    it("应该返回 WiFi 信息", async () => {
      mockExecAsync.mockResolvedValueOnce({
        stdout: `Name: Wi-Fi
Description: Intel Wireless
SSID: MyNetwork
BSSID: 00:11:22:33:44:55
Signal: 95%
Channel: 6`,
        stderr: "",
      });

      const result = await handler.handle("getWifi", {}, mockContext);

      expect(result.success).toBe(true);
    });

    it("无 WiFi 时应该返回 null 或空对象", async () => {
      mockExecAsync.mockRejectedValueOnce(new Error("No WiFi"));

      const result = await handler.handle("getWifi", {}, mockContext);

      expect(result.success).toBe(true);
      // WiFi 信息可能为 null 或包含 undefined 值的对象
      if (result.wifi !== null) {
        expect(result.wifi.ssid).toBeUndefined();
      }
    });
  });

  describe("getSpeed", () => {
    it("应该执行速度测试", async () => {
      const result = await handler.handle("getSpeed", {}, mockContext);

      expect(result.success).toBe(true);
      expect(result.download).toBeDefined();
      expect(typeof result.download.speedMbps).toBe("number");
    });
  });

  describe("unknown action", () => {
    it("应该对未知操作报错", async () => {
      await expect(
        handler.handle("unknownAction", {}, mockContext),
      ).rejects.toThrow("Unknown action: unknownAction");
    });
  });
});
