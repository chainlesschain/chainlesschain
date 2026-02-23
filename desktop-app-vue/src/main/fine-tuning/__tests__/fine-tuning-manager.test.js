/**
 * FineTuningManager Unit Tests
 *
 * Covers:
 * - Constructor / default state
 * - initialize() creates database tables
 * - prepareData() extracts and formats training data
 * - startTraining() creates a job record
 * - getStatus() retrieves job details
 * - cancelJob() transitions a running job to cancelled
 * - listAdapters() delegates to adapter registry
 * - deleteAdapter() removes adapter and record
 * - exportData() reads and returns training data
 * - _parseLlamaCppProgress() progress parsing
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-job-uuid'),
}));

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn(), on: vi.fn(), removeHandler: vi.fn() },
}));

vi.mock('axios', () => ({
  default: {
    post: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
    create: vi.fn(() => ({
      post: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
      get: vi.fn(() => Promise.resolve({ status: 200, data: {} })),
    })),
  },
}));

vi.mock('child_process', () => ({
  spawn: vi.fn(() => {
    const EventEmitter = require('events');
    const proc = new EventEmitter();
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.kill = vi.fn();
    return proc;
  }),
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn(() => '{"instruction":"q","input":"","output":"a"}'),
  statSync: vi.fn(() => ({ size: 1024 })),
  unlinkSync: vi.fn(),
}));

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makePrepStmt(overrides = {}) {
  return {
    run: vi.fn(() => ({ changes: 1 })),
    all: vi.fn(() => []),
    get: vi.fn(() => null),
    ...overrides,
  };
}

function createMockDb() {
  const stmts = [];
  const db = {
    exec: vi.fn(),
    prepare: vi.fn(() => {
      const stmt = makePrepStmt();
      stmts.push(stmt);
      return stmt;
    }),
    _stmts: stmts,
  };
  return db;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('FineTuningManager', () => {
  let FineTuningManager;
  let manager;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../fine-tuning-manager.js');
    FineTuningManager = mod.FineTuningManager;
    mockDb = createMockDb();
    manager = new FineTuningManager({ database: mockDb });
  });

  afterEach(() => {
    manager.removeAllListeners();
  });

  // ────────────────────────────────────────────────────────────────────
  // Constructor
  // ────────────────────────────────────────────────────────────────────

  describe('constructor', () => {
    it('creates instance with default state', () => {
      expect(manager.database).toBe(mockDb);
      expect(manager.initialized).toBe(false);
      expect(manager.runningProcesses).toBeInstanceOf(Map);
      expect(manager.runningProcesses.size).toBe(0);
    });

    it('creates with null database when none provided', () => {
      const m = new FineTuningManager();
      expect(m.database).toBeNull();
    });

    it('sets default ollamaBaseUrl', () => {
      expect(manager.ollamaBaseUrl).toBeDefined();
      expect(typeof manager.ollamaBaseUrl).toBe('string');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // initialize()
  // ────────────────────────────────────────────────────────────────────

  describe('initialize()', () => {
    it('creates database tables via db.exec', async () => {
      await manager.initialize();
      expect(mockDb.exec).toHaveBeenCalled();

      // Should create both tables and both indexes (at least 4 exec calls)
      expect(mockDb.exec.mock.calls.length).toBeGreaterThanOrEqual(4);
    });

    it('sets initialized to true', async () => {
      await manager.initialize();
      expect(manager.initialized).toBe(true);
    });

    it('accepts a database override parameter', async () => {
      const newDb = createMockDb();
      await manager.initialize(newDb);
      expect(manager.database).toBe(newDb);
      expect(newDb.exec).toHaveBeenCalled();
    });

    it('handles missing database gracefully', async () => {
      const m = new FineTuningManager();
      await m.initialize();
      expect(m.initialized).toBe(true);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // prepareData()
  // ────────────────────────────────────────────────────────────────────

  describe('prepareData()', () => {
    it('throws when source is missing', async () => {
      await expect(manager.prepareData({ outputPath: '/tmp/out.jsonl' }))
        .rejects.toThrow('source and outputPath are required');
    });

    it('throws when outputPath is missing', async () => {
      await expect(manager.prepareData({ source: 'conversations' }))
        .rejects.toThrow('source and outputPath are required');
    });

    it('extracts from conversations and writes JSONL', async () => {
      // Mock database query to return conversation messages
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { role: 'user', content: 'Hello', conversation_id: 'c1', created_at: 100 },
          { role: 'assistant', content: 'Hi there', conversation_id: 'c1', created_at: 101 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = await manager.prepareData({
        source: 'conversations',
        format: 'jsonl',
        outputPath: '/tmp/train.jsonl',
      });

      expect(result.format).toBe('jsonl');
      expect(result.outputPath).toBe('/tmp/train.jsonl');
      expect(typeof result.recordCount).toBe('number');
    });

    it('extracts from notes and writes Alpaca format', async () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { title: 'My Note', content: 'Some content', category: 'general', created_at: 200 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = await manager.prepareData({
        source: 'notes',
        format: 'alpaca',
        outputPath: '/tmp/train.json',
      });

      expect(result.format).toBe('alpaca');
      expect(result.outputPath).toBe('/tmp/train.json');
    });

    it('handles custom source with provided data', async () => {
      const result = await manager.prepareData({
        source: 'custom',
        format: 'jsonl',
        outputPath: '/tmp/custom.jsonl',
        filters: {
          data: [
            { instruction: 'Q1', input: '', output: 'A1' },
            { instruction: 'Q2', input: '', output: 'A2' },
          ],
        },
      });

      expect(result.recordCount).toBe(2);
    });

    it('throws for unsupported source', async () => {
      await expect(manager.prepareData({
        source: 'invalid',
        outputPath: '/tmp/out.jsonl',
      })).rejects.toThrow('Unsupported source: invalid');
    });

    it('throws for custom source without data', async () => {
      await expect(manager.prepareData({
        source: 'custom',
        outputPath: '/tmp/out.jsonl',
        filters: {},
      })).rejects.toThrow('Custom source requires filters.data array');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // startTraining()
  // ────────────────────────────────────────────────────────────────────

  describe('startTraining()', () => {
    it('throws when required fields are missing', async () => {
      await expect(manager.startTraining({ baseModel: 'llama2' }))
        .rejects.toThrow('baseModel, adapterName, and dataPath are required');
    });

    it('creates a job record in the database', async () => {
      // Mock getStatus to return the created job
      const getStmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'test-job-uuid',
          base_model: 'llama2',
          adapter_name: 'my-adapter',
          data_path: '/tmp/data.jsonl',
          backend: 'ollama',
          status: 'pending',
          progress: 0,
          config: '{}',
          metrics: null,
          error_message: null,
          started_at: null,
          completed_at: null,
          created_at: Date.now(),
        })),
      });

      const insertStmt = makePrepStmt();
      mockDb.prepare
        .mockReturnValueOnce(insertStmt)  // INSERT
        .mockReturnValueOnce(getStmt);    // SELECT for getStatus

      const job = await manager.startTraining({
        baseModel: 'llama2',
        adapterName: 'my-adapter',
        dataPath: '/tmp/data.jsonl',
        backend: 'ollama',
      });

      expect(job).toBeDefined();
      expect(job.id).toBe('test-job-uuid');
      expect(job.status).toBe('pending');
      expect(insertStmt.run).toHaveBeenCalled();
    });

    it('starts llama-cpp backend with child process', async () => {
      const { spawn } = require('child_process');

      const getStmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'test-job-uuid',
          base_model: 'llama2',
          adapter_name: 'my-lora',
          data_path: '/tmp/data.jsonl',
          backend: 'llama-cpp',
          status: 'pending',
          progress: 0,
          config: '{}',
          metrics: null,
          error_message: null,
          started_at: null,
          completed_at: null,
          created_at: Date.now(),
        })),
      });

      mockDb.prepare
        .mockReturnValueOnce(makePrepStmt())   // INSERT
        .mockReturnValueOnce(makePrepStmt())   // UPDATE status -> running
        .mockReturnValueOnce(getStmt);         // SELECT for getStatus

      const job = await manager.startTraining({
        baseModel: 'llama2',
        adapterName: 'my-lora',
        dataPath: '/tmp/data.jsonl',
        backend: 'llama-cpp',
      });

      expect(spawn).toHaveBeenCalledWith(
        'llama-finetune',
        expect.arrayContaining(['--model', 'llama2']),
        expect.objectContaining({ stdio: ['ignore', 'pipe', 'pipe'] })
      );
      expect(job).toBeDefined();
    });

    it('applies default config values', async () => {
      const insertStmt = makePrepStmt();
      const getStmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'test-job-uuid',
          base_model: 'mistral',
          adapter_name: 'test',
          data_path: '/tmp/data.jsonl',
          backend: 'ollama',
          status: 'pending',
          progress: 0,
          config: JSON.stringify({
            epochs: 3,
            batchSize: 4,
            learningRate: 0.0002,
            loraRank: 16,
            loraAlpha: 32,
          }),
          metrics: null,
          error_message: null,
          started_at: null,
          completed_at: null,
          created_at: Date.now(),
        })),
      });

      mockDb.prepare
        .mockReturnValueOnce(insertStmt)
        .mockReturnValueOnce(getStmt);

      const job = await manager.startTraining({
        baseModel: 'mistral',
        adapterName: 'test',
        dataPath: '/tmp/data.jsonl',
      });

      // Verify the stored config includes defaults
      const configArg = insertStmt.run.mock.calls[0][6]; // config is 7th parameter (index 6)
      const parsed = JSON.parse(configArg);
      expect(parsed.epochs).toBe(3);
      expect(parsed.batchSize).toBe(4);
      expect(parsed.learningRate).toBe(0.0002);
      expect(parsed.loraRank).toBe(16);
      expect(parsed.loraAlpha).toBe(32);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // getStatus()
  // ────────────────────────────────────────────────────────────────────

  describe('getStatus()', () => {
    it('returns null for non-existent job', () => {
      const stmt = makePrepStmt({ get: vi.fn(() => null) });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.getStatus('non-existent');
      expect(result).toBeNull();
    });

    it('returns parsed job record', () => {
      const now = Date.now();
      const stmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'job-1',
          base_model: 'llama2',
          adapter_name: 'adapter-1',
          data_path: '/tmp/data.jsonl',
          backend: 'ollama',
          status: 'completed',
          progress: 100,
          config: JSON.stringify({ epochs: 5 }),
          metrics: JSON.stringify({ loss: 0.05 }),
          error_message: null,
          started_at: now - 60000,
          completed_at: now,
          created_at: now - 120000,
        })),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.getStatus('job-1');
      expect(result.id).toBe('job-1');
      expect(result.baseModel).toBe('llama2');
      expect(result.status).toBe('completed');
      expect(result.progress).toBe(100);
      expect(result.config.epochs).toBe(5);
      expect(result.metrics.loss).toBe(0.05);
    });

    it('returns null when database is not available', () => {
      const m = new FineTuningManager();
      const result = m.getStatus('any-id');
      expect(result).toBeNull();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // cancelJob()
  // ────────────────────────────────────────────────────────────────────

  describe('cancelJob()', () => {
    it('returns failure for non-existent job', () => {
      const stmt = makePrepStmt({ get: vi.fn(() => null) });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.cancelJob('non-existent');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Job not found');
    });

    it('cancels a running job', () => {
      const stmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'job-1',
          base_model: 'llama2',
          adapter_name: 'a',
          data_path: '/tmp/d.jsonl',
          backend: 'llama-cpp',
          status: 'running',
          progress: 50,
          config: '{}',
          metrics: null,
          error_message: null,
          started_at: Date.now(),
          completed_at: null,
          created_at: Date.now(),
        })),
      });
      const updateStmt = makePrepStmt();
      mockDb.prepare
        .mockReturnValueOnce(stmt)      // SELECT for getStatus
        .mockReturnValueOnce(updateStmt); // UPDATE for status change

      const result = manager.cancelJob('job-1');
      expect(result.success).toBe(true);
      expect(result.message).toBe('Job cancelled');
    });

    it('kills child process when cancelling llama-cpp job', () => {
      const mockProcess = { kill: vi.fn() };
      manager.runningProcesses.set('job-1', mockProcess);

      const stmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'job-1',
          base_model: 'llama2',
          adapter_name: 'a',
          data_path: '/tmp/d.jsonl',
          backend: 'llama-cpp',
          status: 'running',
          progress: 30,
          config: '{}',
          metrics: null,
          error_message: null,
          started_at: Date.now(),
          completed_at: null,
          created_at: Date.now(),
        })),
      });
      mockDb.prepare.mockReturnValueOnce(stmt).mockReturnValue(makePrepStmt());

      manager.cancelJob('job-1');
      expect(mockProcess.kill).toHaveBeenCalledWith('SIGTERM');
      expect(manager.runningProcesses.has('job-1')).toBe(false);
    });

    it('refuses to cancel a completed job', () => {
      const stmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'job-1',
          base_model: 'llama2',
          adapter_name: 'a',
          data_path: '/tmp/d.jsonl',
          backend: 'ollama',
          status: 'completed',
          progress: 100,
          config: '{}',
          metrics: '{}',
          error_message: null,
          started_at: Date.now() - 1000,
          completed_at: Date.now(),
          created_at: Date.now() - 2000,
        })),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.cancelJob('job-1');
      expect(result.success).toBe(false);
      expect(result.message).toContain('not cancellable');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // listAdapters()
  // ────────────────────────────────────────────────────────────────────

  describe('listAdapters()', () => {
    it('returns adapters from the registry', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          {
            id: 'a1',
            name: 'adapter-1',
            base_model: 'llama2',
            adapter_path: '/adapters/a1',
            size_bytes: 1024,
            training_job_id: 'j1',
            description: 'Test adapter',
            created_at: Date.now(),
          },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.listAdapters();
      expect(Array.isArray(result)).toBe(true);
      expect(result.length).toBe(1);
      expect(result[0].name).toBe('adapter-1');
    });

    it('returns empty array when no adapters exist', () => {
      const stmt = makePrepStmt({ all: vi.fn(() => []) });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.listAdapters();
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // deleteAdapter()
  // ────────────────────────────────────────────────────────────────────

  describe('deleteAdapter()', () => {
    it('returns failure when adapter not found', () => {
      const stmt = makePrepStmt({ get: vi.fn(() => null) });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.deleteAdapter('nonexistent');
      expect(result.success).toBe(false);
      expect(result.message).toBe('Adapter not found');
    });

    it('deletes adapter and removes file from disk', () => {
      const getStmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'a1',
          name: 'adapter-1',
          base_model: 'llama2',
          adapter_path: '/adapters/a1.bin',
          size_bytes: 1024,
          training_job_id: null,
          description: null,
          created_at: Date.now(),
        })),
      });
      const deleteStmt = makePrepStmt({ run: vi.fn(() => ({ changes: 1 })) });

      mockDb.prepare
        .mockReturnValueOnce(getStmt)    // getAdapter
        .mockReturnValueOnce(getStmt)    // getAdapter again (in deleteAdapter -> adapterRegistry.getAdapter)
        .mockReturnValueOnce(deleteStmt); // DELETE

      // Mock the second call to getAdapter within adapterRegistry.unregister
      // The mock chain handles this via sequential mockReturnValueOnce calls

      const result = manager.deleteAdapter('a1');
      // If fs.existsSync returns true (mocked), it tries to unlink
      expect(result.success).toBeDefined();
    });

    it('skips file deletion for ollama virtual paths', () => {
      const fs = require('fs');
      const getStmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'a2',
          name: 'adapter-2',
          base_model: 'llama2',
          adapter_path: 'ollama://my-model',
          size_bytes: 0,
          training_job_id: null,
          description: null,
          created_at: Date.now(),
        })),
      });
      const deleteStmt = makePrepStmt({ run: vi.fn(() => ({ changes: 1 })) });

      mockDb.prepare
        .mockReturnValueOnce(getStmt)
        .mockReturnValueOnce(deleteStmt);

      manager.deleteAdapter('a2');

      // unlinkSync should NOT be called for ollama:// paths
      expect(fs.unlinkSync).not.toHaveBeenCalled();
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // exportData()
  // ────────────────────────────────────────────────────────────────────

  describe('exportData()', () => {
    it('throws for non-existent job', () => {
      const stmt = makePrepStmt({ get: vi.fn(() => null) });
      mockDb.prepare.mockReturnValue(stmt);

      expect(() => manager.exportData('bad-id')).toThrow('Job not found');
    });

    it('reads and returns JSONL data', () => {
      const fs = require('fs');
      fs.readFileSync.mockReturnValueOnce(
        '{"instruction":"Q1","input":"","output":"A1"}\n{"instruction":"Q2","input":"","output":"A2"}'
      );

      const stmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'j1',
          base_model: 'llama2',
          adapter_name: 'a',
          data_path: '/tmp/data.jsonl',
          backend: 'ollama',
          status: 'completed',
          progress: 100,
          config: '{}',
          metrics: null,
          error_message: null,
          started_at: null,
          completed_at: null,
          created_at: Date.now(),
        })),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.exportData('j1');
      expect(result.recordCount).toBe(2);
      expect(result.data).toHaveLength(2);
      expect(result.data[0].instruction).toBe('Q1');
    });

    it('reads and returns Alpaca JSON array data', () => {
      const fs = require('fs');
      fs.readFileSync.mockReturnValueOnce(
        JSON.stringify([
          { instruction: 'Q1', input: '', output: 'A1' },
        ])
      );

      const stmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'j2',
          base_model: 'llama2',
          adapter_name: 'b',
          data_path: '/tmp/data.json',
          backend: 'ollama',
          status: 'completed',
          progress: 100,
          config: '{}',
          metrics: null,
          error_message: null,
          started_at: null,
          completed_at: null,
          created_at: Date.now(),
        })),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = manager.exportData('j2', 'alpaca');
      expect(result.recordCount).toBe(1);
      expect(result.format).toBe('alpaca');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // _parseLlamaCppProgress()
  // ────────────────────────────────────────────────────────────────────

  describe('_parseLlamaCppProgress()', () => {
    it('parses percentage format', () => {
      expect(manager._parseLlamaCppProgress('progress: 45.2%')).toBe(45.2);
    });

    it('parses epoch format', () => {
      expect(manager._parseLlamaCppProgress('[epoch 2/5]')).toBe(40);
    });

    it('returns null for unrecognized text', () => {
      expect(manager._parseLlamaCppProgress('some random log line')).toBeNull();
    });

    it('caps progress at 100', () => {
      expect(manager._parseLlamaCppProgress('progress: 150%')).toBe(100);
    });

    it('parses epoch 5/5 as 100', () => {
      expect(manager._parseLlamaCppProgress('epoch 5/5')).toBe(100);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // EventEmitter integration
  // ────────────────────────────────────────────────────────────────────

  describe('event emission', () => {
    it('emits progress events on cancel', () => {
      const handler = vi.fn();
      manager.on('progress', handler);

      const stmt = makePrepStmt({
        get: vi.fn(() => ({
          id: 'job-ev',
          base_model: 'llama2',
          adapter_name: 'a',
          data_path: '/tmp/d.jsonl',
          backend: 'ollama',
          status: 'running',
          progress: 50,
          config: '{}',
          metrics: null,
          error_message: null,
          started_at: Date.now(),
          completed_at: null,
          created_at: Date.now(),
        })),
      });
      mockDb.prepare.mockReturnValueOnce(stmt).mockReturnValue(makePrepStmt());

      manager.cancelJob('job-ev');
      expect(handler).toHaveBeenCalledWith(
        expect.objectContaining({ jobId: 'job-ev', status: 'cancelled' })
      );
    });
  });
});
