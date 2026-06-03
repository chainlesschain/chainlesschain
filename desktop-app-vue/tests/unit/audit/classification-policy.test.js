import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

vi.mock('../../../src/main/utils/logger.js', () => ({
  logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}));

describe('ClassificationPolicy', () => {
  let ClassificationPolicy, CLASSIFICATION_LEVELS, LEVEL_PRIORITIES;
  let policy;
  let mockDb;

  beforeEach(async () => {
    vi.clearAllMocks();

    const mod = await import('../../../src/main/audit/classification-policy.js');
    ClassificationPolicy = mod.ClassificationPolicy;
    CLASSIFICATION_LEVELS = mod.CLASSIFICATION_LEVELS;
    LEVEL_PRIORITIES = mod.LEVEL_PRIORITIES;

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

    policy = new ClassificationPolicy(mockDb);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // --- Constants ---

  it('should export CLASSIFICATION_LEVELS', () => {
    expect(CLASSIFICATION_LEVELS.PUBLIC).toBe('public');
    expect(CLASSIFICATION_LEVELS.INTERNAL).toBe('internal');
    expect(CLASSIFICATION_LEVELS.CONFIDENTIAL).toBe('confidential');
    expect(CLASSIFICATION_LEVELS.TOP_SECRET).toBe('top_secret');
  });

  it('should export LEVEL_PRIORITIES with correct ordering', () => {
    expect(LEVEL_PRIORITIES['public']).toBe(0);
    expect(LEVEL_PRIORITIES['internal']).toBe(1);
    expect(LEVEL_PRIORITIES['confidential']).toBe(2);
    expect(LEVEL_PRIORITIES['top_secret']).toBe(3);
  });

  // --- Constructor ---

  it('should load DEFAULT_POLICIES in constructor', () => {
    expect(policy.policies.length).toBe(4);
    expect(policy.policies.some((p) => p.id === 'policy-pci')).toBe(true);
    expect(policy.policies.some((p) => p.id === 'policy-phi')).toBe(true);
    expect(policy.policies.some((p) => p.id === 'policy-pii')).toBe(true);
    expect(policy.policies.some((p) => p.id === 'policy-internal')).toBe(true);
  });

  it('should have initialized=false initially', () => {
    expect(policy.initialized).toBe(false);
  });

  // --- initialize ---

  it('should set initialized on initialize()', async () => {
    await policy.initialize();
    expect(policy.initialized).toBe(true);
  });

  // --- determineLevel ---

  it('should return PUBLIC for unknown category', () => {
    const result = policy.determineLevel('unknown-category');
    expect(result.level).toBe(CLASSIFICATION_LEVELS.PUBLIC);
    expect(result.matchedPolicies).toEqual([]);
  });

  it('should return TOP_SECRET for PCI data', () => {
    const result = policy.determineLevel('pci');
    expect(result.level).toBe(CLASSIFICATION_LEVELS.TOP_SECRET);
    expect(result.matchedPolicies).toContain('PCI Data Protection');
  });

  it('should return CONFIDENTIAL for PHI data', () => {
    const result = policy.determineLevel('phi');
    expect(result.level).toBe(CLASSIFICATION_LEVELS.CONFIDENTIAL);
    expect(result.matchedPolicies).toContain('PHI Data Protection');
  });

  it('should return CONFIDENTIAL for PII data', () => {
    const result = policy.determineLevel('pii');
    expect(result.level).toBe(CLASSIFICATION_LEVELS.CONFIDENTIAL);
    expect(result.matchedPolicies).toContain('PII Data Protection');
  });

  it('should return INTERNAL for general data', () => {
    const result = policy.determineLevel('general');
    expect(result.level).toBe(CLASSIFICATION_LEVELS.INTERNAL);
    expect(result.matchedPolicies).toContain('Internal Documents');
  });

  it('should override with containsCreditCard context to TOP_SECRET', () => {
    const result = policy.determineLevel('pii', { containsCreditCard: true });
    expect(result.level).toBe(CLASSIFICATION_LEVELS.TOP_SECRET);
  });

  it('should override with containsMedical context to CONFIDENTIAL', () => {
    const result = policy.determineLevel('general', { containsMedical: true });
    // general maps to INTERNAL (priority 1), containsMedical bumps to CONFIDENTIAL (priority 2)
    expect(result.level).toBe(CLASSIFICATION_LEVELS.CONFIDENTIAL);
  });

  it('should not downgrade with containsMedical if already CONFIDENTIAL or higher', () => {
    const result = policy.determineLevel('pci', { containsMedical: true });
    // PCI is TOP_SECRET, containsMedical should not downgrade
    expect(result.level).toBe(CLASSIFICATION_LEVELS.TOP_SECRET);
  });

  it('should set autoTagged=true on all results', () => {
    const result = policy.determineLevel('pii');
    expect(result.autoTagged).toBe(true);
  });

  // --- autoTag ---

  it('should return tag with level and policies', async () => {
    const classificationResult = {
      category: 'pci',
      severity: 'critical',
      detections: [{ type: 'CREDIT_CARD', category: 'pci' }],
    };
    const tag = await policy.autoTag('content-123', classificationResult);
    expect(tag.contentId).toBe('content-123');
    expect(tag.level).toBe(CLASSIFICATION_LEVELS.TOP_SECRET);
    expect(tag.category).toBe('pci');
    expect(tag.severity).toBe('critical');
    expect(tag.matchedPolicies).toContain('PCI Data Protection');
    expect(tag).toHaveProperty('taggedAt');
  });

  it('should emit content:tagged event from autoTag', async () => {
    const handler = vi.fn();
    policy.on('content:tagged', handler);
    await policy.autoTag('c1', { category: 'general', detections: [] });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // --- getPolicies ---

  it('should return a copy of policies array', () => {
    const policies = policy.getPolicies();
    expect(policies).toEqual(policy.policies);
    // Should be a copy, not the same reference
    expect(policies).not.toBe(policy.policies);
  });

  // --- addPolicy ---

  it('should throw on missing required fields', () => {
    expect(() => policy.addPolicy({ id: 'x' })).toThrow('Policy requires id, name, and level');
    expect(() => policy.addPolicy({ name: 'x' })).toThrow('Policy requires id, name, and level');
    expect(() => policy.addPolicy({})).toThrow('Policy requires id, name, and level');
  });

  it('should add a custom policy', () => {
    const customPolicy = { id: 'custom-1', name: 'Custom', level: 'internal', triggers: ['custom'] };
    const result = policy.addPolicy(customPolicy);
    expect(result).toEqual(customPolicy);
    expect(policy.policies).toContainEqual(customPolicy);
    expect(policy.policies.length).toBe(5);
  });

  it('should emit policy:added event', () => {
    const handler = vi.fn();
    policy.on('policy:added', handler);
    policy.addPolicy({ id: 'p1', name: 'P1', level: 'internal' });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  // --- removePolicy ---

  it('should remove a policy by id', () => {
    expect(policy.policies.length).toBe(4);
    policy.removePolicy('policy-pci');
    expect(policy.policies.length).toBe(3);
    expect(policy.policies.find((p) => p.id === 'policy-pci')).toBeUndefined();
  });

  it('should emit policy:removed event', () => {
    const handler = vi.fn();
    policy.on('policy:removed', handler);
    policy.removePolicy('policy-pci');
    expect(handler).toHaveBeenCalledWith({ policyId: 'policy-pci' });
  });

  // --- checkAccess ---

  it('should allow when clearance >= required level', () => {
    expect(policy.checkAccess('public', 'top_secret')).toBe(true);
    expect(policy.checkAccess('confidential', 'confidential')).toBe(true);
    expect(policy.checkAccess('internal', 'top_secret')).toBe(true);
  });

  it('should deny when clearance < required level', () => {
    expect(policy.checkAccess('top_secret', 'public')).toBe(false);
    expect(policy.checkAccess('confidential', 'internal')).toBe(false);
    expect(policy.checkAccess('top_secret', 'confidential')).toBe(false);
  });

  it('should handle unknown levels as priority 0', () => {
    expect(policy.checkAccess('unknown', 'public')).toBe(true);
    expect(policy.checkAccess('top_secret', 'unknown')).toBe(false);
  });
});
