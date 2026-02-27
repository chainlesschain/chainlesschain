import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

vi.mock('uuid', () => ({
  v4: vi.fn(() => 'test-uuid-' + Math.random().toString(36).substr(2, 9)),
}));

describe('DataClassifier', () => {
  let DataClassifier, DATA_CATEGORIES, PII_PATTERNS, SEVERITY_LEVELS;
  let classifier;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import('../../../src/main/audit/data-classifier.js');
    DataClassifier = mod.DataClassifier;
    DATA_CATEGORIES = mod.DATA_CATEGORIES;
    PII_PATTERNS = mod.PII_PATTERNS;
    SEVERITY_LEVELS = mod.SEVERITY_LEVELS;

    mockDb = {
      db: {
        exec: vi.fn(),
        prepare: vi.fn(() => ({
          run: vi.fn(),
          get: vi.fn(() => null),
          all: vi.fn(() => []),
        })),
      },
      saveToFile: vi.fn(),
    };

    classifier = new DataClassifier(mockDb, null);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Constants ---

  it('should export DATA_CATEGORIES with PII, PHI, PCI, GENERAL', () => {
    expect(DATA_CATEGORIES.PII).toBe('pii');
    expect(DATA_CATEGORIES.PHI).toBe('phi');
    expect(DATA_CATEGORIES.PCI).toBe('pci');
    expect(DATA_CATEGORIES.GENERAL).toBe('general');
  });

  it('should export PII_PATTERNS with expected keys', () => {
    expect(PII_PATTERNS).toHaveProperty('EMAIL');
    expect(PII_PATTERNS).toHaveProperty('PHONE');
    expect(PII_PATTERNS).toHaveProperty('SSN');
    expect(PII_PATTERNS).toHaveProperty('CREDIT_CARD');
    expect(PII_PATTERNS).toHaveProperty('IP_ADDRESS');
    expect(PII_PATTERNS).toHaveProperty('CN_ID');
    expect(PII_PATTERNS).toHaveProperty('CN_PHONE');
  });

  it('should export SEVERITY_LEVELS with CRITICAL, HIGH, MEDIUM, LOW', () => {
    expect(SEVERITY_LEVELS.CRITICAL).toBe('critical');
    expect(SEVERITY_LEVELS.HIGH).toBe('high');
    expect(SEVERITY_LEVELS.MEDIUM).toBe('medium');
    expect(SEVERITY_LEVELS.LOW).toBe('low');
  });

  // --- Constructor ---

  it('should set database, llmManager, and initialized=false in constructor', () => {
    expect(classifier.database).toBe(mockDb);
    expect(classifier.llmManager).toBeNull();
    expect(classifier.initialized).toBe(false);
  });

  // --- initialize ---

  it('should call _ensureTables and set initialized on initialize()', async () => {
    await classifier.initialize();
    expect(classifier.initialized).toBe(true);
    expect(mockDb.db.exec).toHaveBeenCalled();
  });

  // --- classify: empty/blank ---

  it('should return GENERAL for empty content', async () => {
    const result = await classifier.classify('');
    expect(result.category).toBe(DATA_CATEGORIES.GENERAL);
    expect(result.detections).toEqual([]);
    expect(result.severity).toBe(SEVERITY_LEVELS.LOW);
  });

  it('should return GENERAL for blank/whitespace content', async () => {
    const result = await classifier.classify('   ');
    expect(result.category).toBe(DATA_CATEGORIES.GENERAL);
    expect(result.detections).toEqual([]);
  });

  it('should return GENERAL for null content', async () => {
    const result = await classifier.classify(null);
    expect(result.category).toBe(DATA_CATEGORIES.GENERAL);
  });

  // --- classify: email ---

  it('should detect email addresses as PII with HIGH severity', async () => {
    const result = await classifier.classify('Contact me at test@example.com', { save: false });
    expect(result.category).toBe(DATA_CATEGORIES.PII);
    const emailDetection = result.detections.find((d) => d.type === 'EMAIL');
    expect(emailDetection).toBeTruthy();
    expect(emailDetection.category).toBe(DATA_CATEGORIES.PII);
    expect(emailDetection.severity).toBe(SEVERITY_LEVELS.HIGH);
  });

  // --- classify: phone ---

  it('should detect phone numbers as PII with HIGH severity', async () => {
    const result = await classifier.classify('Call me at 555-123-4567', { save: false });
    expect(result.category).toBe(DATA_CATEGORIES.PII);
    const phoneDetection = result.detections.find((d) => d.type === 'PHONE');
    expect(phoneDetection).toBeTruthy();
    expect(phoneDetection.severity).toBe(SEVERITY_LEVELS.HIGH);
  });

  // --- classify: SSN ---

  it('should detect SSN (123-45-6789) as PII with CRITICAL severity', async () => {
    const result = await classifier.classify('SSN: 123-45-6789', { save: false });
    const ssnDetection = result.detections.find((d) => d.type === 'SSN');
    expect(ssnDetection).toBeTruthy();
    expect(ssnDetection.severity).toBe(SEVERITY_LEVELS.CRITICAL);
  });

  // --- classify: credit card ---

  it('should detect credit card numbers as PCI with CRITICAL severity', async () => {
    const result = await classifier.classify('Card: 4111-1111-1111-1111', { save: false });
    expect(result.category).toBe(DATA_CATEGORIES.PCI);
    const ccDetection = result.detections.find((d) => d.type === 'CREDIT_CARD');
    expect(ccDetection).toBeTruthy();
    expect(ccDetection.category).toBe(DATA_CATEGORIES.PCI);
    expect(ccDetection.severity).toBe(SEVERITY_LEVELS.CRITICAL);
  });

  // --- classify: Chinese ID ---

  it('should detect Chinese ID (18 digits) as PII with CRITICAL severity', async () => {
    const result = await classifier.classify('ID: 110101199001011234', { save: false });
    const cnIdDetection = result.detections.find((d) => d.type === 'CN_ID');
    expect(cnIdDetection).toBeTruthy();
    expect(cnIdDetection.severity).toBe(SEVERITY_LEVELS.CRITICAL);
  });

  // --- classify: Chinese phone ---

  it('should detect Chinese phone (1xx xxxx xxxx) as PII with HIGH severity', async () => {
    const result = await classifier.classify('Phone: 13812345678', { save: false });
    const cnPhoneDetection = result.detections.find((d) => d.type === 'CN_PHONE');
    expect(cnPhoneDetection).toBeTruthy();
    expect(cnPhoneDetection.severity).toBe(SEVERITY_LEVELS.HIGH);
  });

  // --- classify: IP address ---

  it('should detect IP addresses with MEDIUM severity', async () => {
    const result = await classifier.classify('Server at 192.168.1.100', { save: false });
    const ipDetection = result.detections.find((d) => d.type === 'IP_ADDRESS');
    expect(ipDetection).toBeTruthy();
    expect(ipDetection.severity).toBe(SEVERITY_LEVELS.MEDIUM);
  });

  // --- classify: PHI keywords ---

  it('should detect PHI keywords (2+ matches) as PHI with HIGH severity', async () => {
    const result = await classifier.classify(
      'The patient was given a diagnosis and prescription for medication',
      { save: false }
    );
    expect(result.category).toBe(DATA_CATEGORIES.PHI);
    const phiDetection = result.detections.find((d) => d.type === 'PHI_KEYWORDS');
    expect(phiDetection).toBeTruthy();
    expect(phiDetection.severity).toBe(SEVERITY_LEVELS.HIGH);
    expect(phiDetection.keywords.length).toBeGreaterThanOrEqual(2);
  });

  it('should NOT detect PHI with only 1 keyword match', async () => {
    const result = await classifier.classify('The patient walked in', { save: false });
    const phiDetection = result.detections.find((d) => d.type === 'PHI_KEYWORDS');
    expect(phiDetection).toBeUndefined();
  });

  // --- classify: category priority ---

  it('should prioritize PCI over PII', async () => {
    const result = await classifier.classify(
      'Card: 4111-1111-1111-1111 Email: test@example.com',
      { save: false }
    );
    expect(result.category).toBe(DATA_CATEGORIES.PCI);
  });

  it('should prioritize PHI over PII when both detected', async () => {
    const result = await classifier.classify(
      'Email: test@example.com. The patient received a diagnosis and prescription for treatment.',
      { save: false }
    );
    expect(result.category).toBe(DATA_CATEGORIES.PHI);
  });

  // --- classify: confidence ---

  it('should have confidence 0.85 when detections found', async () => {
    const result = await classifier.classify('test@example.com', { save: false });
    expect(result.confidence).toBe(0.85);
  });

  it('should have confidence 0 when content is clean', async () => {
    const result = await classifier.classify('Hello world, no sensitive data here.', { save: false });
    expect(result.confidence).toBe(0);
  });

  // --- classify: save behavior ---

  it('should save to DB by default when detections found', async () => {
    await classifier.classify('test@example.com');
    expect(mockDb.db.prepare).toHaveBeenCalled();
    expect(mockDb.saveToFile).toHaveBeenCalled();
  });

  it('should skip save when options.save=false', async () => {
    mockDb.saveToFile.mockClear();
    await classifier.classify('test@example.com', { save: false });
    expect(mockDb.saveToFile).not.toHaveBeenCalled();
  });

  // --- batchScan ---

  it('should return results and summary from batchScan', async () => {
    const items = [
      { id: '1', content: 'test@example.com' },
      { id: '2', content: 'Hello world' },
    ];
    const { results, summary } = await classifier.batchScan(items);
    expect(results).toHaveLength(2);
    expect(summary.total).toBe(2);
    expect(summary.pii).toBe(1);
    expect(summary.clean).toBe(1);
  });

  it('should limit batchScan to 100 items', async () => {
    const items = Array.from({ length: 120 }, (_, i) => ({ id: `${i}`, content: 'safe text' }));
    const { results } = await classifier.batchScan(items);
    expect(results).toHaveLength(100);
  });

  it('should return empty results for non-array input to batchScan', async () => {
    const result = await classifier.batchScan('not-an-array');
    expect(result.results).toEqual([]);
  });

  // --- getHistory ---

  it('should return records from getHistory', async () => {
    const mockRecords = [{ id: 'rec1', category: 'pii' }];
    mockDb.db.prepare.mockReturnValue({
      run: vi.fn(),
      get: vi.fn(),
      all: vi.fn(() => mockRecords),
    });
    const records = await classifier.getHistory();
    expect(records).toEqual(mockRecords);
  });

  it('should return empty array when database is missing', async () => {
    const noDbClassifier = new DataClassifier(null, null);
    const records = await noDbClassifier.getHistory();
    expect(records).toEqual([]);
  });

  // --- _getPatternSeverity ---

  it('should map pattern severities correctly', () => {
    expect(classifier._getPatternSeverity('SSN')).toBe(SEVERITY_LEVELS.CRITICAL);
    expect(classifier._getPatternSeverity('CREDIT_CARD')).toBe(SEVERITY_LEVELS.CRITICAL);
    expect(classifier._getPatternSeverity('CN_ID')).toBe(SEVERITY_LEVELS.CRITICAL);
    expect(classifier._getPatternSeverity('EMAIL')).toBe(SEVERITY_LEVELS.HIGH);
    expect(classifier._getPatternSeverity('PHONE')).toBe(SEVERITY_LEVELS.HIGH);
    expect(classifier._getPatternSeverity('CN_PHONE')).toBe(SEVERITY_LEVELS.HIGH);
    expect(classifier._getPatternSeverity('IP_ADDRESS')).toBe(SEVERITY_LEVELS.MEDIUM);
    expect(classifier._getPatternSeverity('UNKNOWN')).toBe(SEVERITY_LEVELS.MEDIUM);
  });

  // --- _compareSeverity ---

  it('should compare severity levels correctly', () => {
    expect(classifier._compareSeverity('critical', 'low')).toBeGreaterThan(0);
    expect(classifier._compareSeverity('low', 'critical')).toBeLessThan(0);
    expect(classifier._compareSeverity('high', 'high')).toBe(0);
    expect(classifier._compareSeverity('medium', 'low')).toBeGreaterThan(0);
  });
});
