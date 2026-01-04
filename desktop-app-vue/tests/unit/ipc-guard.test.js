/**
 * IPC Guard 单元测试
 * 测试IPC注册保护机制
 */

const { describe, it, beforeEach, afterEach } = require('@jest/globals');
const { expect } = require('chai');
const { EventEmitter } = require('events');

describe('IPC Guard', () => {
  let ipcGuard;
  let mockIpcMain;

  beforeEach(() => {
    // 重置模块缓存
    delete require.cache[require.resolve('../../src/main/ipc-guard')];
    ipcGuard = require('../../src/main/ipc-guard');

    // 创建模拟的ipcMain
    mockIpcMain = new EventEmitter();
    mockIpcMain.handle = jest.fn();
    mockIpcMain.removeHandler = jest.fn();
    mockIpcMain.removeAllListeners = jest.fn();

    // 重置所有状态
    ipcGuard.resetAll();
  });

  afterEach(() => {
    ipcGuard.resetAll();
  });

  describe('Channel注册保护', () => {
    it('应该能够注册新的channel', () => {
      const handler = jest.fn();
      const result = ipcGuard.safeRegisterHandler('test:channel', handler, 'test-module');

      expect(result).to.be.true;
      expect(ipcGuard.isChannelRegistered('test:channel')).to.be.true;
    });

    it('应该阻止重复注册相同的channel', () => {
      const handler1 = jest.fn();
      const handler2 = jest.fn();

      const result1 = ipcGuard.safeRegisterHandler('test:channel', handler1, 'module1');
      const result2 = ipcGuard.safeRegisterHandler('test:channel', handler2, 'module2');

      expect(result1).to.be.true;
      expect(result2).to.be.false;
    });

    it('应该正确跟踪channel的模块信息', () => {
      ipcGuard.safeRegisterHandler('test:channel', jest.fn(), 'test-module');

      const stats = ipcGuard.getStats();
      const channelInfo = stats.channels.find(c => c.channel === 'test:channel');

      expect(channelInfo).to.exist;
      expect(channelInfo.module).to.equal('test-module');
    });
  });

  describe('模块注册保护', () => {
    it('应该能够注册新的模块', () => {
      const registerFunc = jest.fn();
      const result = ipcGuard.safeRegisterModule('test-module', registerFunc);

      expect(result).to.be.true;
      expect(registerFunc).toHaveBeenCalled();
      expect(ipcGuard.isModuleRegistered('test-module')).to.be.true;
    });

    it('应该阻止重复注册相同的模块', () => {
      const registerFunc1 = jest.fn();
      const registerFunc2 = jest.fn();

      const result1 = ipcGuard.safeRegisterModule('test-module', registerFunc1);
      const result2 = ipcGuard.safeRegisterModule('test-module', registerFunc2);

      expect(result1).to.be.true;
      expect(result2).to.be.false;
      expect(registerFunc1).toHaveBeenCalled();
      expect(registerFunc2).not.toHaveBeenCalled();
    });
  });

  describe('批量注册', () => {
    it('应该能够批量注册多个handlers', () => {
      const handlers = {
        'test:handler1': jest.fn(),
        'test:handler2': jest.fn(),
        'test:handler3': jest.fn()
      };

      const result = ipcGuard.safeRegisterHandlers(handlers, 'test-module');

      expect(result.registered).to.equal(3);
      expect(result.skipped).to.equal(0);
    });

    it('应该正确统计已注册和跳过的handlers', () => {
      // 先注册一个handler
      ipcGuard.safeRegisterHandler('test:handler1', jest.fn(), 'module1');

      // 再批量注册，包含已存在的handler
      const handlers = {
        'test:handler1': jest.fn(),  // 已存在，应该跳过
        'test:handler2': jest.fn(),  // 新的
        'test:handler3': jest.fn()   // 新的
      };

      const result = ipcGuard.safeRegisterHandlers(handlers, 'test-module');

      expect(result.registered).to.equal(2);
      expect(result.skipped).to.equal(1);
    });
  });

  describe('注销功能', () => {
    it('应该能够注销单个channel', () => {
      ipcGuard.safeRegisterHandler('test:channel', jest.fn(), 'test-module');
      expect(ipcGuard.isChannelRegistered('test:channel')).to.be.true;

      ipcGuard.unregisterChannel('test:channel');
      expect(ipcGuard.isChannelRegistered('test:channel')).to.be.false;
    });

    it('应该能够注销整个模块', () => {
      ipcGuard.safeRegisterHandler('test:channel1', jest.fn(), 'test-module');
      ipcGuard.safeRegisterHandler('test:channel2', jest.fn(), 'test-module');
      ipcGuard.markModuleRegistered('test-module');

      expect(ipcGuard.isModuleRegistered('test-module')).to.be.true;
      expect(ipcGuard.isChannelRegistered('test:channel1')).to.be.true;
      expect(ipcGuard.isChannelRegistered('test:channel2')).to.be.true;

      ipcGuard.unregisterModule('test-module');

      expect(ipcGuard.isModuleRegistered('test-module')).to.be.false;
      expect(ipcGuard.isChannelRegistered('test:channel1')).to.be.false;
      expect(ipcGuard.isChannelRegistered('test:channel2')).to.be.false;
    });

    it('应该能够重置所有注册', () => {
      ipcGuard.safeRegisterHandler('test:channel1', jest.fn(), 'module1');
      ipcGuard.safeRegisterHandler('test:channel2', jest.fn(), 'module2');
      ipcGuard.markModuleRegistered('module1');
      ipcGuard.markModuleRegistered('module2');

      const beforeStats = ipcGuard.getStats();
      expect(beforeStats.totalChannels).to.equal(2);
      expect(beforeStats.totalModules).to.equal(2);

      ipcGuard.resetAll();

      const afterStats = ipcGuard.getStats();
      expect(afterStats.totalChannels).to.equal(0);
      expect(afterStats.totalModules).to.equal(0);
    });
  });

  describe('统计功能', () => {
    it('应该正确统计注册的channels和modules', () => {
      ipcGuard.safeRegisterHandler('test:channel1', jest.fn(), 'module1');
      ipcGuard.safeRegisterHandler('test:channel2', jest.fn(), 'module1');
      ipcGuard.safeRegisterHandler('test:channel3', jest.fn(), 'module2');
      ipcGuard.markModuleRegistered('module1');
      ipcGuard.markModuleRegistered('module2');

      const stats = ipcGuard.getStats();

      expect(stats.totalChannels).to.equal(3);
      expect(stats.totalModules).to.equal(2);
      expect(stats.channels).to.have.lengthOf(3);
      expect(stats.modules).to.have.lengthOf(2);
    });

    it('printStats不应该抛出错误', () => {
      ipcGuard.safeRegisterHandler('test:channel', jest.fn(), 'test-module');
      ipcGuard.markModuleRegistered('test-module');

      expect(() => ipcGuard.printStats()).not.to.throw();
    });
  });
});
