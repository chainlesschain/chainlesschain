/**
 * System Handler Enhanced 单元测试
 *
 * 测试系统命令处理器的完整功能
 */

const { describe, it, expect, beforeEach, afterEach, vi } = require('vitest');
const SystemCommandHandlerEnhanced = require('../../src/main/remote/handlers/system-handler-enhanced');

// Mock dependencies
vi.mock('screenshot-desktop', () => ({
  default: vi.fn()
}));

vi.mock('electron', () => ({
  Notification: class Notification {
    constructor(options) {
      this.options = options;
      this.eventHandlers = {};
    }
    on(event, handler) {
      this.eventHandlers[event] = handler;
    }
    show() {
      // Mock show
    }
  }
}));

vi.mock('systeminformation', () => ({
  default: {
    currentLoad: vi.fn(() => Promise.resolve({
      currentLoad: 45.5
    })),
    mem: vi.fn(() => Promise.resolve({
      total: 16000000000,
      used: 8000000000,
      free: 8000000000
    })),
    fsSize: vi.fn(() => Promise.resolve([
      {
        fs: '/dev/sda1',
        type: 'ext4',
        size: 500000000000,
        used: 250000000000,
        available: 250000000000,
        use: 50
      }
    ])),
    networkStats: vi.fn(() => Promise.resolve([
      {
        iface: 'eth0',
        rx_sec: 1024000,
        tx_sec: 512000
      }
    ])),
    osInfo: vi.fn(() => Promise.resolve({
      platform: 'linux',
      distro: 'Ubuntu',
      release: '22.04',
      arch: 'x64',
      kernel: '5.15.0'
    })),
    cpu: vi.fn(() => Promise.resolve({
      manufacturer: 'Intel',
      brand: 'Core i7-9700K',
      cores: 8,
      speed: 3.6,
      physicalCores: 8
    })),
    graphics: vi.fn(() => Promise.resolve({
      controllers: [
        {
          model: 'NVIDIA GeForce RTX 3080',
          vendor: 'NVIDIA',
          vram: 10240
        }
      ]
    }))
  }
}));

describe('SystemCommandHandlerEnhanced', () => {
  let handler;
  let mockContext;

  beforeEach(() => {
    mockContext = {
      did: 'did:example:test-123',
      channel: 'p2p'
    };

    handler = new SystemCommandHandlerEnhanced({
      screenshotQuality: 80,
      screenshotFormat: 'png',
      maxCommandTimeout: 30000,
      enableCommandWhitelist: true
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('screenshot', () => {
    it('should capture screenshot successfully', async () => {
      // Mock screenshot library
      const mockBuffer = Buffer.from('fake-image-data');
      const screenshot = require('screenshot-desktop').default;
      screenshot.mockResolvedValue(mockBuffer);

      const params = {
        quality: 80,
        format: 'png',
        display: 'all'
      };

      const result = await handler.screenshot(params, mockContext);

      expect(result.success).toBe(true);
      expect(result.format).toBe('png');
      expect(result.data).toBeDefined();
      expect(result.size).toBe(mockBuffer.length);
      expect(result.display).toBe('all');
      expect(handler.metrics.screenshotCount).toBe(1);
    });

    it('should use default quality and format', async () => {
      const mockBuffer = Buffer.from('test-data');
      const screenshot = require('screenshot-desktop').default;
      screenshot.mockResolvedValue(mockBuffer);

      const result = await handler.screenshot({}, mockContext);

      expect(result.format).toBe('png'); // Default
      expect(result.metadata.quality).toBe(80); // Default
    });

    it('should handle screenshot library error', async () => {
      const screenshot = require('screenshot-desktop').default;
      screenshot.mockRejectedValue(new Error('Screenshot failed'));

      await expect(handler.screenshot({}, mockContext)).rejects.toThrow('Screenshot failed');
    });
  });

  describe('notify', () => {
    it('should send notification successfully', async () => {
      const params = {
        title: 'Test Notification',
        body: 'This is a test notification',
        sound: true,
        urgency: 'normal'
      };

      const result = await handler.notify(params, mockContext);

      expect(result.success).toBe(true);
      expect(result.title).toBe('Test Notification');
      expect(result.body).toBe('This is a test notification');
      expect(handler.metrics.notificationCount).toBe(1);
    });

    it('should reject missing title', async () => {
      const params = {
        body: 'Test body'
      };

      await expect(handler.notify(params, mockContext)).rejects.toThrow('Parameter "title" is required');
    });

    it('should reject missing body', async () => {
      const params = {
        title: 'Test title'
      };

      await expect(handler.notify(params, mockContext)).rejects.toThrow('Parameter "body" is required');
    });

    it('should handle notification with custom urgency', async () => {
      const params = {
        title: 'Urgent',
        body: 'Important message',
        urgency: 'critical'
      };

      const result = await handler.notify(params, mockContext);

      expect(result.metadata.urgency).toBe('critical');
    });
  });

  describe('getStatus', () => {
    it('should get system status successfully', async () => {
      const result = await handler.getStatus({}, mockContext);

      expect(result).toHaveProperty('cpu');
      expect(result).toHaveProperty('memory');
      expect(result).toHaveProperty('disk');
      expect(result).toHaveProperty('network');
      expect(result).toHaveProperty('uptime');
      expect(result).toHaveProperty('timestamp');
    });

    it('should get CPU status', async () => {
      const result = await handler.getStatus({}, mockContext);

      expect(result.cpu).toHaveProperty('usage');
      expect(result.cpu).toHaveProperty('cores');
      expect(result.cpu.cores).toBeGreaterThan(0);
    });

    it('should get memory status', async () => {
      const result = await handler.getStatus({}, mockContext);

      expect(result.memory).toHaveProperty('total');
      expect(result.memory).toHaveProperty('used');
      expect(result.memory).toHaveProperty('free');
      expect(result.memory).toHaveProperty('usage');
      expect(parseFloat(result.memory.usage)).toBeGreaterThanOrEqual(0);
      expect(parseFloat(result.memory.usage)).toBeLessThanOrEqual(100);
    });

    it('should get disk status', async () => {
      const result = await handler.getStatus({}, mockContext);

      expect(result.disk).toBeDefined();
      expect(Array.isArray(result.disk)).toBe(true);
    });

    it('should get network status', async () => {
      const result = await handler.getStatus({}, mockContext);

      expect(result.network).toBeDefined();
      expect(result.network).toHaveProperty('rx');
      expect(result.network).toHaveProperty('tx');
    });
  });

  describe('getInfo', () => {
    it('should get system info successfully', async () => {
      const result = await handler.getInfo({}, mockContext);

      expect(result).toHaveProperty('os');
      expect(result).toHaveProperty('cpu');
      expect(result).toHaveProperty('memory');
      expect(result).toHaveProperty('graphics');
      expect(result).toHaveProperty('app');
      expect(result).toHaveProperty('hostname');
      expect(result).toHaveProperty('platform');
      expect(result).toHaveProperty('arch');
    });

    it('should get OS info', async () => {
      const result = await handler.getInfo({}, mockContext);

      expect(result.os).toHaveProperty('platform');
      expect(result.os).toHaveProperty('arch');
    });

    it('should get CPU info', async () => {
      const result = await handler.getInfo({}, mockContext);

      expect(result.cpu).toHaveProperty('cores');
      expect(result.cpu.cores).toBeGreaterThan(0);
    });

    it('should get memory info', async () => {
      const result = await handler.getInfo({}, mockContext);

      expect(result.memory).toHaveProperty('total');
      expect(result.memory).toHaveProperty('free');
      expect(result.memory).toHaveProperty('used');
    });

    it('should get app info', async () => {
      const result = await handler.getInfo({}, mockContext);

      expect(result.app).toBeDefined();
      expect(result.app).toHaveProperty('electron');
      expect(result.app).toHaveProperty('node');
    });
  });

  describe('execCommand', () => {
    it('should execute safe command successfully', async () => {
      const params = {
        command: 'ls -la'
      };

      const result = await handler.execCommand(params, mockContext);

      expect(result.success).toBeDefined();
      expect(result.command).toBe('ls -la');
      expect(result).toHaveProperty('stdout');
      expect(result).toHaveProperty('stderr');
      expect(result).toHaveProperty('exitCode');
    });

    it('should reject dangerous command (rm -rf)', async () => {
      const params = {
        command: 'rm -rf /'
      };

      await expect(handler.execCommand(params, mockContext)).rejects.toThrow('Command not allowed');
      expect(handler.metrics.commandExecutionCount).toBe(0);
    });

    it('should reject dangerous command (format)', async () => {
      const params = {
        command: 'format c:'
      };

      await expect(handler.execCommand(params, mockContext)).rejects.toThrow('Command not allowed');
    });

    it('should reject dangerous command (sudo)', async () => {
      const params = {
        command: 'sudo rm file.txt'
      };

      await expect(handler.execCommand(params, mockContext)).rejects.toThrow('Command not allowed');
    });

    it('should allow whitelisted command (pwd)', async () => {
      const params = {
        command: 'pwd'
      };

      const result = await handler.execCommand(params, mockContext);

      // Should not throw
      expect(result).toBeDefined();
    });

    it('should allow whitelisted command (git status)', async () => {
      const params = {
        command: 'git status'
      };

      const result = await handler.execCommand(params, mockContext);

      // Should not throw
      expect(result).toBeDefined();
    });

    it('should reject command not in whitelist', async () => {
      const params = {
        command: 'unknown-command --option'
      };

      await expect(handler.execCommand(params, mockContext)).rejects.toThrow('Command not allowed');
    });

    it('should handle command execution error', async () => {
      const params = {
        command: 'ls /nonexistent-directory'
      };

      const result = await handler.execCommand(params, mockContext);

      expect(result.success).toBe(false);
      expect(result.exitCode).toBeGreaterThan(0);
      expect(result.stderr).toBeDefined();
    });

    it('should reject missing command parameter', async () => {
      const params = {};

      await expect(handler.execCommand(params, mockContext)).rejects.toThrow('Parameter "command" is required');
    });

    it('should use custom timeout', async () => {
      const params = {
        command: 'ls',
        timeout: 5000
      };

      await handler.execCommand(params, mockContext);

      // Should complete without timeout error
    });

    it('should use custom working directory', async () => {
      const params = {
        command: 'pwd',
        cwd: '/tmp'
      };

      await handler.execCommand(params, mockContext);

      // Should execute in /tmp directory
    });
  });

  describe('isCommandSafe', () => {
    it('should reject blacklisted commands', () => {
      expect(handler.isCommandSafe('rm -rf /')).toBe(false);
      expect(handler.isCommandSafe('del /s /q *')).toBe(false);
      expect(handler.isCommandSafe('format c:')).toBe(false);
      expect(handler.isCommandSafe('sudo rm file')).toBe(false);
      expect(handler.isCommandSafe('shutdown -h now')).toBe(false);
    });

    it('should allow whitelisted commands', () => {
      expect(handler.isCommandSafe('ls -la')).toBe(true);
      expect(handler.isCommandSafe('pwd')).toBe(true);
      expect(handler.isCommandSafe('git status')).toBe(true);
      expect(handler.isCommandSafe('echo hello')).toBe(true);
      expect(handler.isCommandSafe('cat file.txt')).toBe(true);
    });

    it('should reject commands not in whitelist', () => {
      expect(handler.isCommandSafe('unknown-command')).toBe(false);
      expect(handler.isCommandSafe('custom-script.sh')).toBe(false);
    });
  });

  describe('metrics', () => {
    it('should track metrics correctly', async () => {
      await handler.notify({
        title: 'Test',
        body: 'Test'
      }, mockContext);

      const mockBuffer = Buffer.from('test');
      const screenshot = require('screenshot-desktop').default;
      screenshot.mockResolvedValue(mockBuffer);

      await handler.screenshot({}, mockContext);

      const metrics = handler.getMetrics();

      expect(metrics.totalRequests).toBe(2);
      expect(metrics.successCount).toBe(2);
      expect(metrics.notificationCount).toBe(1);
      expect(metrics.screenshotCount).toBe(1);
      expect(metrics.successRate).toBe('100.00%');
    });

    it('should track failures correctly', async () => {
      const params = {
        command: 'rm -rf /'
      };

      try {
        await handler.execCommand(params, mockContext);
      } catch (error) {
        // Expected
      }

      const metrics = handler.getMetrics();

      expect(metrics.failureCount).toBe(1);
    });
  });

  describe('events', () => {
    it('should emit command-success event', async () => {
      const successHandler = vi.fn();
      handler.on('command-success', successHandler);

      await handler.notify({
        title: 'Test',
        body: 'Test'
      }, mockContext);

      expect(successHandler).toHaveBeenCalled();
      expect(successHandler.mock.calls[0][0]).toMatchObject({
        action: 'notify',
        did: mockContext.did
      });
    });

    it('should emit command-failure event', async () => {
      const failureHandler = vi.fn();
      handler.on('command-failure', failureHandler);

      try {
        await handler.execCommand({
          command: 'rm -rf /'
        }, mockContext);
      } catch (error) {
        // Expected
      }

      expect(failureHandler).toHaveBeenCalled();
      expect(failureHandler.mock.calls[0][0]).toMatchObject({
        action: 'execCommand',
        did: mockContext.did
      });
    });
  });

  describe('handle (unified entry)', () => {
    it('should route to correct method', async () => {
      const notifyResult = await handler.handle('notify', {
        title: 'Test',
        body: 'Test body'
      }, mockContext);

      expect(notifyResult.success).toBe(true);

      const statusResult = await handler.handle('getStatus', {}, mockContext);

      expect(statusResult).toHaveProperty('cpu');
      expect(statusResult).toHaveProperty('memory');
    });

    it('should reject unknown action', async () => {
      await expect(handler.handle('unknownAction', {}, mockContext)).rejects.toThrow('Unknown action');
    });
  });
});
