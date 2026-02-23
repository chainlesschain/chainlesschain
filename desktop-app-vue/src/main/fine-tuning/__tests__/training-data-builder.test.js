/**
 * TrainingDataBuilder Unit Tests
 *
 * Covers:
 * - extractFromConversations() query and pair logic
 * - extractFromNotes() query and conversion
 * - formatAsJSONL() file output
 * - formatAsAlpaca() file output
 * - validateData() quality checks, errors, warnings, stats
 * - Edge cases: empty data, missing database, filters
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

// ─── Mocks ────────────────────────────────────────────────────────────────────

vi.mock('../../utils/logger.js', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}));

vi.mock('fs', () => ({
  existsSync: vi.fn(() => true),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  statSync: vi.fn(() => ({ size: 512 })),
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

function createMockDb(stmtOverrides = {}) {
  const stmt = makePrepStmt(stmtOverrides);
  const db = {
    exec: vi.fn(),
    prepare: vi.fn(() => stmt),
    _stmt: stmt,
  };
  return db;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('TrainingDataBuilder', () => {
  let TrainingDataBuilder;
  let builder;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();
    const mod = await import('../training-data-builder.js');
    TrainingDataBuilder = mod.TrainingDataBuilder;
    mockDb = createMockDb();
    builder = new TrainingDataBuilder({ database: mockDb });
  });

  // ────────────────────────────────────────────────────────────────────
  // extractFromConversations()
  // ────────────────────────────────────────────────────────────────────

  describe('extractFromConversations()', () => {
    it('returns empty array when no database', () => {
      const b = new TrainingDataBuilder();
      expect(b.extractFromConversations()).toEqual([]);
    });

    it('pairs user messages with assistant responses', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { role: 'user', content: 'What is AI?', conversation_id: 'c1', created_at: 100 },
          { role: 'assistant', content: 'AI stands for artificial intelligence.', conversation_id: 'c1', created_at: 101 },
          { role: 'user', content: 'Tell me more', conversation_id: 'c1', created_at: 102 },
          { role: 'assistant', content: 'AI is a broad field.', conversation_id: 'c1', created_at: 103 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = builder.extractFromConversations();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        instruction: 'What is AI?',
        input: '',
        output: 'AI stands for artificial intelligence.',
      });
      expect(result[1]).toEqual({
        instruction: 'Tell me more',
        input: '',
        output: 'AI is a broad field.',
      });
    });

    it('skips orphaned user messages without assistant reply', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { role: 'user', content: 'Hello', conversation_id: 'c1', created_at: 100 },
          { role: 'user', content: 'Are you there?', conversation_id: 'c1', created_at: 101 },
          { role: 'assistant', content: 'Yes, I am here.', conversation_id: 'c1', created_at: 102 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = builder.extractFromConversations();
      expect(result).toHaveLength(1);
      // The second user message ("Are you there?") is the one paired
      expect(result[0].instruction).toBe('Are you there?');
    });

    it('applies conversationId filter', () => {
      const stmt = makePrepStmt({ all: vi.fn(() => []) });
      mockDb.prepare.mockReturnValue(stmt);

      builder.extractFromConversations({ conversationId: 'conv-42' });
      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('conversation_id');
    });

    it('applies minLength filter', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { role: 'user', content: 'Q', conversation_id: 'c1', created_at: 100 },
          { role: 'assistant', content: 'Short', conversation_id: 'c1', created_at: 101 },
          { role: 'user', content: 'Q2', conversation_id: 'c1', created_at: 102 },
          { role: 'assistant', content: 'This is a longer response that should pass.', conversation_id: 'c1', created_at: 103 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = builder.extractFromConversations({ minLength: 10 });
      expect(result).toHaveLength(1);
      expect(result[0].output).toBe('This is a longer response that should pass.');
    });

    it('applies limit filter', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { role: 'user', content: 'Q1', conversation_id: 'c1', created_at: 100 },
          { role: 'assistant', content: 'A1', conversation_id: 'c1', created_at: 101 },
          { role: 'user', content: 'Q2', conversation_id: 'c1', created_at: 102 },
          { role: 'assistant', content: 'A2', conversation_id: 'c1', created_at: 103 },
          { role: 'user', content: 'Q3', conversation_id: 'c1', created_at: 104 },
          { role: 'assistant', content: 'A3', conversation_id: 'c1', created_at: 105 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = builder.extractFromConversations({ limit: 2 });
      expect(result).toHaveLength(2);
    });

    it('handles database error gracefully', () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = builder.extractFromConversations();
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // extractFromNotes()
  // ────────────────────────────────────────────────────────────────────

  describe('extractFromNotes()', () => {
    it('returns empty array when no database', () => {
      const b = new TrainingDataBuilder();
      expect(b.extractFromNotes()).toEqual([]);
    });

    it('converts notes to instruction/output pairs', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { title: 'Getting Started', content: 'This is how you begin.', category: 'guide', created_at: 200 },
          { title: 'Advanced Topics', content: 'Deep dive into the system.', category: 'guide', created_at: 201 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = builder.extractFromNotes();
      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        instruction: 'Getting Started',
        input: '',
        output: 'This is how you begin.',
      });
    });

    it('skips notes with empty title or content', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { title: '', content: 'No title', category: null, created_at: 200 },
          { title: 'No content', content: '', category: null, created_at: 201 },
          { title: 'Valid', content: 'Valid content', category: null, created_at: 202 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = builder.extractFromNotes();
      expect(result).toHaveLength(1);
      expect(result[0].instruction).toBe('Valid');
    });

    it('applies category filter', () => {
      const stmt = makePrepStmt({ all: vi.fn(() => []) });
      mockDb.prepare.mockReturnValue(stmt);

      builder.extractFromNotes({ category: 'tutorial' });
      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('category');
    });

    it('applies since filter', () => {
      const stmt = makePrepStmt({ all: vi.fn(() => []) });
      mockDb.prepare.mockReturnValue(stmt);

      builder.extractFromNotes({ since: 1000 });
      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('created_at');
    });

    it('applies limit filter', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { title: 'Note 1', content: 'Content 1', category: null, created_at: 200 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      builder.extractFromNotes({ limit: 1 });
      const query = mockDb.prepare.mock.calls[0][0];
      expect(query).toContain('LIMIT');
    });

    it('applies minLength filter', () => {
      const stmt = makePrepStmt({
        all: vi.fn(() => [
          { title: 'Short', content: 'AB', category: null, created_at: 200 },
          { title: 'Long', content: 'This is a sufficient content string.', category: null, created_at: 201 },
        ]),
      });
      mockDb.prepare.mockReturnValue(stmt);

      const result = builder.extractFromNotes({ minLength: 5 });
      expect(result).toHaveLength(1);
      expect(result[0].instruction).toBe('Long');
    });

    it('handles database error gracefully', () => {
      mockDb.prepare.mockImplementation(() => {
        throw new Error('DB error');
      });

      const result = builder.extractFromNotes();
      expect(result).toEqual([]);
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // formatAsJSONL()
  // ────────────────────────────────────────────────────────────────────

  describe('formatAsJSONL()', () => {
    it('returns zero counts for empty data', () => {
      const result = builder.formatAsJSONL([], '/tmp/empty.jsonl');
      expect(result.recordCount).toBe(0);
      expect(result.path).toBe('/tmp/empty.jsonl');
    });

    it('writes correct JSONL format', () => {
      const fs = require('fs');
      const data = [
        { instruction: 'Q1', input: '', output: 'A1' },
        { instruction: 'Q2', input: 'context', output: 'A2' },
      ];

      const result = builder.formatAsJSONL(data, '/tmp/train.jsonl');

      expect(fs.writeFileSync).toHaveBeenCalled();

      // Verify the written content
      const writtenContent = fs.writeFileSync.mock.calls[0][1];
      const lines = writtenContent.trim().split('\n');
      expect(lines).toHaveLength(2);

      const first = JSON.parse(lines[0]);
      expect(first.instruction).toBe('Q1');
      expect(first.input).toBe('');
      expect(first.output).toBe('A1');

      const second = JSON.parse(lines[1]);
      expect(second.input).toBe('context');

      expect(result.recordCount).toBe(2);
      expect(result.sizeBytes).toBe(512); // mocked statSync
    });

    it('creates directory if it does not exist', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValueOnce(false);

      builder.formatAsJSONL(
        [{ instruction: 'Q', input: '', output: 'A' }],
        '/new/dir/train.jsonl'
      );

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('throws on write error', () => {
      const fs = require('fs');
      fs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('Disk full');
      });

      expect(() =>
        builder.formatAsJSONL(
          [{ instruction: 'Q', input: '', output: 'A' }],
          '/tmp/fail.jsonl'
        )
      ).toThrow('Disk full');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // formatAsAlpaca()
  // ────────────────────────────────────────────────────────────────────

  describe('formatAsAlpaca()', () => {
    it('returns zero counts for empty data', () => {
      const result = builder.formatAsAlpaca([], '/tmp/empty.json');
      expect(result.recordCount).toBe(0);
    });

    it('writes correct Alpaca JSON array format', () => {
      const fs = require('fs');
      const data = [
        { instruction: 'Q1', input: '', output: 'A1' },
        { instruction: 'Q2', input: 'ctx', output: 'A2' },
      ];

      const result = builder.formatAsAlpaca(data, '/tmp/train.json');

      expect(fs.writeFileSync).toHaveBeenCalled();

      const writtenContent = fs.writeFileSync.mock.calls[0][1];
      const parsed = JSON.parse(writtenContent);
      expect(Array.isArray(parsed)).toBe(true);
      expect(parsed).toHaveLength(2);
      expect(parsed[0].instruction).toBe('Q1');
      expect(parsed[1].input).toBe('ctx');

      expect(result.recordCount).toBe(2);
      expect(result.sizeBytes).toBe(512);
    });

    it('creates directory if it does not exist', () => {
      const fs = require('fs');
      fs.existsSync.mockReturnValueOnce(false);

      builder.formatAsAlpaca(
        [{ instruction: 'Q', input: '', output: 'A' }],
        '/new/path/data.json'
      );

      expect(fs.mkdirSync).toHaveBeenCalledWith(expect.any(String), { recursive: true });
    });

    it('throws on write error', () => {
      const fs = require('fs');
      fs.writeFileSync.mockImplementationOnce(() => {
        throw new Error('Permission denied');
      });

      expect(() =>
        builder.formatAsAlpaca(
          [{ instruction: 'Q', input: '', output: 'A' }],
          '/tmp/fail.json'
        )
      ).toThrow('Permission denied');
    });
  });

  // ────────────────────────────────────────────────────────────────────
  // validateData()
  // ────────────────────────────────────────────────────────────────────

  describe('validateData()', () => {
    it('returns invalid for non-array input', () => {
      const result = builder.validateData('not an array');
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Data must be an array');
    });

    it('returns invalid for empty array', () => {
      const result = builder.validateData([]);
      expect(result.valid).toBe(false);
      expect(result.errors).toContain('Data array is empty');
    });

    it('returns valid for good data', () => {
      const data = [
        { instruction: 'What is the capital of France?', input: '', output: 'The capital of France is Paris.' },
        { instruction: 'Explain gravity.', input: '', output: 'Gravity is a fundamental force of nature.' },
      ];

      const result = builder.validateData(data);
      expect(result.valid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.stats.totalRecords).toBe(2);
      expect(result.stats.validRecords).toBe(2);
    });

    it('detects empty instructions', () => {
      const data = [
        { instruction: '', input: '', output: 'Some output' },
      ];

      const result = builder.validateData(data);
      expect(result.valid).toBe(false);
      expect(result.stats.emptyInstructions).toBe(1);
      expect(result.errors.some((e) => e.includes('empty instruction'))).toBe(true);
    });

    it('detects empty outputs', () => {
      const data = [
        { instruction: 'A question', input: '', output: '' },
      ];

      const result = builder.validateData(data);
      expect(result.valid).toBe(false);
      expect(result.stats.emptyOutputs).toBe(1);
      expect(result.errors.some((e) => e.includes('empty output'))).toBe(true);
    });

    it('warns about short outputs', () => {
      const data = [
        { instruction: 'Question', input: '', output: 'Short' },
      ];

      const result = builder.validateData(data);
      expect(result.valid).toBe(true); // Short is a warning, not an error
      expect(result.stats.shortOutputs).toBe(1);
      expect(result.warnings.some((w) => w.includes('very short'))).toBe(true);
    });

    it('detects duplicate instructions', () => {
      const data = [
        { instruction: 'Same question', input: '', output: 'Answer one' },
        { instruction: 'Same question', input: '', output: 'Answer two' },
      ];

      const result = builder.validateData(data);
      expect(result.stats.duplicates).toBe(1);
      expect(result.warnings.some((w) => w.includes('duplicate'))).toBe(true);
    });

    it('calculates average lengths', () => {
      const data = [
        { instruction: '1234567890', input: '', output: '12345678901234567890' }, // 10 and 20
        { instruction: '12345678901234567890', input: '', output: '1234567890' }, // 20 and 10
      ];

      const result = builder.validateData(data);
      expect(result.stats.avgInstructionLength).toBe(15); // (10+20)/2
      expect(result.stats.avgOutputLength).toBe(15); // (20+10)/2
    });

    it('warns when more than 50% records have issues', () => {
      const data = [
        { instruction: '', input: '', output: '' },
        { instruction: '', input: '', output: '' },
        { instruction: 'Valid', input: '', output: 'Valid output here' },
      ];

      const result = builder.validateData(data);
      expect(result.warnings.some((w) => w.includes('50%'))).toBe(true);
    });

    it('handles null instruction and output gracefully', () => {
      const data = [
        { instruction: null, input: '', output: null },
      ];

      const result = builder.validateData(data);
      expect(result.valid).toBe(false);
      expect(result.stats.emptyInstructions).toBe(1);
      expect(result.stats.emptyOutputs).toBe(1);
    });

    it('returns correct stats shape', () => {
      const data = [
        { instruction: 'Q', input: '', output: 'A valid output string' },
      ];

      const result = builder.validateData(data);
      expect(result).toHaveProperty('valid');
      expect(result).toHaveProperty('errors');
      expect(result).toHaveProperty('warnings');
      expect(result).toHaveProperty('stats');
      expect(result.stats).toHaveProperty('totalRecords');
      expect(result.stats).toHaveProperty('validRecords');
      expect(result.stats).toHaveProperty('emptyInstructions');
      expect(result.stats).toHaveProperty('emptyOutputs');
      expect(result.stats).toHaveProperty('shortOutputs');
      expect(result.stats).toHaveProperty('duplicates');
      expect(result.stats).toHaveProperty('avgInstructionLength');
      expect(result.stats).toHaveProperty('avgOutputLength');
    });
  });
});
