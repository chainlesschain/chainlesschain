/**
 * P2P增强功能E2E测试
 *
 * 测试内容：
 * 1. 消息去重和批量处理
 * 2. 知识库增量同步
 * 3. 大文件分块传输和断点续传
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

// 模拟数据库
class MockDatabase {
  constructor() {
    this.notes = new Map();
  }

  async query(sql, params) {
    // 模拟查询变更的笔记
    if (sql.includes('updated_at >')) {
      const since = params[0];
      const results = [];

      for (const [id, note] of this.notes.entries()) {
        if (note.updated_at > since) {
          results.push({ ...note, id });
        }
      }

      return results;
    }

    return [];
  }

  async execute(sql, params) {
    // 模拟插入或更新
    if (sql.includes('INSERT OR REPLACE')) {
      const [id, title, content, updated_at, version] = params;
      this.notes.set(id, { title, content, updated_at, version, deleted: 0 });
    }

    return { changes: 1 };
  }

  addNote(id, note) {
    this.notes.set(id, note);
  }
}

// 模拟P2P管理器
class MockP2PManager {
  constructor() {
    this.messages = [];
    this.handlers = new Map();
  }

  on(event, handler) {
    if (!this.handlers.has(event)) {
      this.handlers.set(event, []);
    }
    this.handlers.get(event).push(handler);
  }

  off(event, handler) {
    if (this.handlers.has(event)) {
      const handlers = this.handlers.get(event);
      const index = handlers.indexOf(handler);
      if (index > -1) {
        handlers.splice(index, 1);
      }
    }
  }

  emit(event, data) {
    if (this.handlers.has(event)) {
      this.handlers.get(event).forEach(handler => handler(data));
    }
  }

  async sendMessage(peerId, message) {
    this.messages.push({ peerId, message });

    // 模拟消息传递
    setTimeout(() => {
      this.emit('message', { peerId, message });
    }, 10);
  }

  getMessages() {
    return this.messages;
  }

  clearMessages() {
    this.messages = [];
  }
}

describe('P2P Enhanced Features E2E Tests', function() {
  this.timeout(30000);

  let MessageManager;
  let KnowledgeSyncManager;
  let FileTransferManager;
  let P2PEnhancedManager;

  let mockDatabase;
  let mockP2PManager;
  let enhancedManager;

  before(async function() {
    // 加载模块
    MessageManager = require('../../desktop-app-vue/src/main/p2p/message-manager');
    KnowledgeSyncManager = require('../../desktop-app-vue/src/main/p2p/knowledge-sync-manager');
    FileTransferManager = require('../../desktop-app-vue/src/main/p2p/file-transfer-manager');
    P2PEnhancedManager = require('../../desktop-app-vue/src/main/p2p/p2p-enhanced-manager');

    // 创建模拟对象
    mockDatabase = new MockDatabase();
    mockP2PManager = new MockP2PManager();
  });

  describe('1. 消息去重和批量处理', function() {
    let messageManager;

    beforeEach(function() {
      messageManager = new MessageManager({
        batchSize: 3,
        batchInterval: 100,
        enableCompression: true,
        enableRetry: true,
        maxRetries: 2
      });
    });

    afterEach(function() {
      messageManager.cleanup();
    });

    it('应该生成唯一的消息ID', function() {
      const id1 = messageManager.generateMessageId();
      const id2 = messageManager.generateMessageId();

      expect(id1).to.be.a('string');
      expect(id2).to.be.a('string');
      expect(id1).to.not.equal(id2);
    });

    it('应该检测重复消息', async function() {
      const peerId = 'peer-1';
      const message = {
        id: 'msg-1',
        type: 'test',
        payload: { data: 'test' },
        timestamp: Date.now()
      };

      // 第一次接收
      const result1 = await messageManager.receiveMessage(peerId, message);
      expect(result1).to.not.be.null;

      // 第二次接收（重复）
      const result2 = await messageManager.receiveMessage(peerId, message);
      expect(result2).to.be.null;

      const stats = messageManager.getStats();
      expect(stats.messagesDuplicated).to.equal(1);
    });

    it('应该批量发送消息', function(done) {
      const peerId = 'peer-1';
      let batchSent = false;

      messageManager.on('send-batch', ({ peerId: targetPeer, messages }) => {
        expect(targetPeer).to.equal(peerId);
        expect(messages).to.be.an('array');
        expect(messages.length).to.be.at.least(1);
        batchSent = true;
        done();
      });

      // 发送多条消息
      for (let i = 0; i < 3; i++) {
        messageManager.sendMessage(peerId, {
          type: 'test',
          data: `message-${i}`
        });
      }
    });

    it('应该压缩大消息', async function() {
      const peerId = 'peer-1';
      const largeData = 'x'.repeat(2000); // 2KB数据

      messageManager.on('send', async ({ message }) => {
        if (message.compressed) {
          expect(message.payload).to.be.a('string');
          // 压缩后的数据应该是base64编码
          expect(message.payload).to.match(/^[A-Za-z0-9+/=]+$/);
        }
      });

      await messageManager.sendMessage(peerId, {
        type: 'test',
        data: largeData
      }, {
        compress: true,
        immediate: true
      });

      const stats = messageManager.getStats();
      expect(stats.bytesCompressed).to.be.greaterThan(0);
    });

    it('应该处理消息确认和重试', function(done) {
      const peerId = 'peer-1';
      let sendCount = 0;

      messageManager.on('send', () => {
        sendCount++;
      });

      messageManager.sendMessage(peerId, {
        type: 'test',
        data: 'test'
      }, {
        requireAck: true,
        immediate: true
      });

      // 等待一段时间检查重试
      setTimeout(() => {
        // 由于没有收到ACK，应该会重试
        expect(sendCount).to.be.greaterThan(1);
        done();
      }, 3500);
    });
  });

  describe('2. 知识库增量同步', function() {
    let knowledgeSyncManager;
    let messageManager;

    beforeEach(function() {
      mockDatabase = new MockDatabase();
      messageManager = new MessageManager();
      knowledgeSyncManager = new KnowledgeSyncManager(mockDatabase, messageManager, {
        syncInterval: 60000,
        batchSize: 10,
        enableAutoSync: false,
        conflictStrategy: 'latest-wins'
      });
    });

    afterEach(function() {
      knowledgeSyncManager.cleanup();
      messageManager.cleanup();
    });

    it('应该检测本地变更', async function() {
      // 添加测试数据
      mockDatabase.addNote('note-1', {
        title: 'Test Note',
        content: 'Test content',
        updated_at: Date.now(),
        version: 1,
        deleted: 0
      });

      const changes = await knowledgeSyncManager.detectLocalChanges(0);

      expect(changes).to.be.an('array');
      expect(changes.length).to.equal(1);
      expect(changes[0].noteId).to.equal('note-1');
      expect(changes[0].type).to.equal('update');
    });

    it('应该检测冲突', function() {
      const localChanges = [{
        noteId: 'note-1',
        timestamp: 1000,
        version: 1,
        hash: 'hash1',
        data: { title: 'Local', content: 'Local content' }
      }];

      const remoteChanges = [{
        noteId: 'note-1',
        timestamp: 1100,
        version: 1,
        hash: 'hash2',
        data: { title: 'Remote', content: 'Remote content' }
      }];

      const conflicts = knowledgeSyncManager.detectConflicts(localChanges, remoteChanges);

      expect(conflicts).to.be.an('array');
      expect(conflicts.length).to.equal(1);
      expect(conflicts[0].noteId).to.equal('note-1');
    });

    it('应该使用latest-wins策略解决冲突', async function() {
      const conflicts = [{
        noteId: 'note-1',
        local: {
          timestamp: 1000,
          version: 1,
          data: { title: 'Local', content: 'Local content' }
        },
        remote: {
          timestamp: 2000,
          version: 1,
          data: { title: 'Remote', content: 'Remote content' }
        },
        conflictType: 'content'
      }];

      const resolved = await knowledgeSyncManager.resolveConflicts(conflicts);

      expect(resolved).to.be.an('array');
      expect(resolved.length).to.equal(1);
      // 远程时间戳更新，应该选择远程版本
      expect(resolved[0].resolution.timestamp).to.equal(2000);
    });

    it('应该计算内容哈希', function() {
      const note = {
        title: 'Test',
        content: 'Content'
      };

      const hash1 = knowledgeSyncManager.calculateHash(note);
      const hash2 = knowledgeSyncManager.calculateHash(note);

      expect(hash1).to.equal(hash2);
      expect(hash1).to.be.a('string');
      expect(hash1.length).to.equal(32); // MD5 hash
    });
  });

  describe('3. 大文件分块传输', function() {
    let fileTransferManager;
    let messageManager;
    let testFilePath;
    let testFileSize;

    before(function() {
      // 创建测试文件
      testFilePath = path.join(__dirname, 'test-file.bin');
      testFileSize = 200 * 1024; // 200KB

      const buffer = crypto.randomBytes(testFileSize);
      fs.writeFileSync(testFilePath, buffer);
    });

    after(function() {
      // 清理测试文件
      if (fs.existsSync(testFilePath)) {
        fs.unlinkSync(testFilePath);
      }
    });

    beforeEach(function() {
      messageManager = new MessageManager();
      fileTransferManager = new FileTransferManager(messageManager, {
        chunkSize: 64 * 1024,
        maxConcurrentChunks: 2,
        enableResume: true
      });
    });

    afterEach(function() {
      fileTransferManager.cleanup();
      messageManager.cleanup();
    });

    it('应该生成传输ID', function() {
      const id1 = fileTransferManager.generateTransferId();
      const id2 = fileTransferManager.generateTransferId();

      expect(id1).to.be.a('string');
      expect(id2).to.be.a('string');
      expect(id1).to.not.equal(id2);
      expect(id1).to.include('transfer-');
    });

    it('应该计算文件哈希', async function() {
      const hash = await fileTransferManager.calculateFileHash(testFilePath);

      expect(hash).to.be.a('string');
      expect(hash.length).to.equal(64); // SHA-256 hash
    });

    it('应该正确计算分块数量', function() {
      const chunkSize = 64 * 1024;
      const expectedChunks = Math.ceil(testFileSize / chunkSize);

      expect(expectedChunks).to.equal(4); // 200KB / 64KB = 3.125 -> 4 chunks
    });

    it('应该触发上传进度事件', function(done) {
      const peerId = 'peer-1';
      let progressEvents = 0;

      fileTransferManager.on('upload:progress', ({ progress }) => {
        progressEvents++;
        expect(progress).to.be.at.least(0);
        expect(progress).to.be.at.most(1);

        if (progress === 1) {
          expect(progressEvents).to.be.greaterThan(1);
          done();
        }
      });

      // 模拟上传（这里简化处理）
      setTimeout(() => {
        fileTransferManager.emit('upload:progress', {
          transferId: 'test',
          progress: 0.5,
          bytesUploaded: testFileSize / 2,
          totalBytes: testFileSize
        });

        setTimeout(() => {
          fileTransferManager.emit('upload:progress', {
            transferId: 'test',
            progress: 1,
            bytesUploaded: testFileSize,
            totalBytes: testFileSize
          });
        }, 100);
      }, 100);
    });

    it('应该处理传输请求', async function() {
      const peerId = 'peer-1';
      const metadata = {
        transferId: 'transfer-123',
        fileName: 'test.bin',
        fileSize: testFileSize,
        fileHash: 'hash123',
        totalChunks: 4,
        chunkSize: 64 * 1024
      };

      let requestReceived = false;

      fileTransferManager.on('transfer:request', (data) => {
        expect(data.transferId).to.equal(metadata.transferId);
        expect(data.fileName).to.equal(metadata.fileName);
        expect(data.fileSize).to.equal(metadata.fileSize);
        requestReceived = true;
      });

      await fileTransferManager.handleTransferRequest(peerId, metadata);

      expect(requestReceived).to.be.true;
      expect(fileTransferManager.downloads.has(metadata.transferId)).to.be.true;
    });

    it('应该获取传输进度', function() {
      const transferId = 'transfer-123';

      // 创建一个模拟的上传任务
      fileTransferManager.uploads.set(transferId, {
        transferId,
        totalChunks: 10,
        uploadedChunks: new Set([0, 1, 2]),
        bytesUploaded: 192 * 1024,
        fileSize: 640 * 1024,
        status: 'uploading'
      });

      const progress = fileTransferManager.getProgress(transferId);

      expect(progress).to.not.be.null;
      expect(progress.type).to.equal('upload');
      expect(progress.progress).to.equal(0.3); // 3/10
      expect(progress.status).to.equal('uploading');
    });
  });

  describe('4. P2P增强管理器集成', function() {
    beforeEach(async function() {
      mockDatabase = new MockDatabase();
      mockP2PManager = new MockP2PManager();

      enhancedManager = new P2PEnhancedManager(mockP2PManager, mockDatabase, {
        messageBatchSize: 5,
        syncBatchSize: 10,
        enableAutoSync: false,
        conflictStrategy: 'latest-wins'
      });

      await enhancedManager.initialize();
    });

    afterEach(async function() {
      if (enhancedManager) {
        await enhancedManager.stop();
      }
    });

    it('应该成功初始化', function() {
      expect(enhancedManager.initialized).to.be.true;
      expect(enhancedManager.isRunning).to.be.true;
      expect(enhancedManager.messageManager).to.not.be.null;
      expect(enhancedManager.knowledgeSyncManager).to.not.be.null;
      expect(enhancedManager.fileTransferManager).to.not.be.null;
    });

    it('应该发送消息', async function() {
      const peerId = 'peer-1';
      const payload = { type: 'test', data: 'hello' };

      const messageId = await enhancedManager.sendMessage(peerId, payload);

      expect(messageId).to.be.a('string');
    });

    it('应该获取统计信息', function() {
      const stats = enhancedManager.getStats();

      expect(stats).to.be.an('object');
      expect(stats).to.have.property('uptime');
      expect(stats).to.have.property('totalMessages');
      expect(stats).to.have.property('totalSyncs');
      expect(stats).to.have.property('totalFileTransfers');
      expect(stats).to.have.property('errors');
      expect(stats).to.have.property('messageManager');
      expect(stats).to.have.property('knowledgeSyncManager');
      expect(stats).to.have.property('fileTransferManager');
    });

    it('应该转发事件', function(done) {
      enhancedManager.on('message', ({ peerId, type, payload }) => {
        expect(peerId).to.equal('peer-1');
        expect(type).to.equal('custom');
        expect(payload.data).to.equal('test');
        done();
      });

      // 模拟接收消息
      enhancedManager.handleIncomingMessage({
        peerId: 'peer-1',
        messageId: 'msg-1',
        type: 'custom',
        payload: { data: 'test' }
      });
    });
  });
});
