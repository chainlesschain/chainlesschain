/**
 * useThresholdSecurityStore -- Pinia store unit tests
 *
 * Covers:
 *  - Initial state shape
 *  - Getters: activeBindings, keyCount
 *  - setupKeys()       -> threshold-security:setup-keys
 *  - sign()            -> threshold-security:sign
 *  - bindBiometric()   -> threshold-security:bind-biometric
 *  - verifyBiometric() -> threshold-security:verify-biometric
 *  - loadKeys()        -> threshold-security:setup-keys (list)
 *  - loadBindings()    -> threshold-security:bind-biometric (list)
 *  - Loading state toggling
 *  - Error handling for each action
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { setActivePinia, createPinia } from 'pinia';

// vi.hoisted runs before imports -- set up electronAPI before store captures it
const { mockInvoke } = vi.hoisted(() => {
  const mockInvoke = vi.fn();
  (globalThis as any).window = (globalThis as any).window || {};
  (window as any).electronAPI = { invoke: mockInvoke };
  return { mockInvoke };
});

import { useThresholdSecurityStore } from '../../../src/renderer/stores/thresholdSecurity';

describe('useThresholdSecurityStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    mockInvoke.mockReset();
  });

  // ---------------------------------------------------------------------------
  // Initial state
  // ---------------------------------------------------------------------------

  describe('Initial state', () => {
    it('keys starts as empty array', () => {
      const store = useThresholdSecurityStore();
      expect(store.keys).toEqual([]);
    });

    it('bindings starts as empty array', () => {
      const store = useThresholdSecurityStore();
      expect(store.bindings).toEqual([]);
    });

    it('currentSetup starts as null', () => {
      const store = useThresholdSecurityStore();
      expect(store.currentSetup).toBeNull();
    });

    it('loading starts as false', () => {
      const store = useThresholdSecurityStore();
      expect(store.loading).toBe(false);
    });

    it('error starts as null', () => {
      const store = useThresholdSecurityStore();
      expect(store.error).toBeNull();
    });
  });

  // ---------------------------------------------------------------------------
  // Getters
  // ---------------------------------------------------------------------------

  describe('Getters', () => {
    it('activeBindings returns only bindings with status active', () => {
      const store = useThresholdSecurityStore();
      store.bindings = [
        { id: '1', key_id: 'k1', biometric_type: 'fingerprint', status: 'active', bound_at: 1000, expires_at: null, last_verified_at: null, verification_count: 0 },
        { id: '2', key_id: 'k1', biometric_type: 'face', status: 'revoked', bound_at: 2000, expires_at: null, last_verified_at: null, verification_count: 0 },
        { id: '3', key_id: 'k2', biometric_type: 'fingerprint', status: 'active', bound_at: 3000, expires_at: null, last_verified_at: null, verification_count: 0 },
      ];
      expect(store.activeBindings).toHaveLength(2);
      expect(store.activeBindings.every(b => b.status === 'active')).toBe(true);
    });

    it('activeBindings returns empty array when no bindings', () => {
      const store = useThresholdSecurityStore();
      expect(store.activeBindings).toEqual([]);
    });

    it('keyCount returns number of keys', () => {
      const store = useThresholdSecurityStore();
      expect(store.keyCount).toBe(0);
      store.keys = [
        { key_id: 'k1', public_key: 'pub1', share_count: 3, created_at: 1000 },
        { key_id: 'k2', public_key: 'pub2', share_count: 5, created_at: 2000 },
      ];
      expect(store.keyCount).toBe(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  describe('setupKeys', () => {
    it('calls IPC and sets currentSetup on success', async () => {
      const store = useThresholdSecurityStore();
      const setupResult = {
        success: true,
        keyId: 'k1',
        publicKey: 'pub1',
        shares: [{ id: 's1', index: 0, source: 'local' }],
        threshold: 2,
        total: 3,
      };
      // loadKeys will be called after success
      mockInvoke
        .mockResolvedValueOnce(setupResult)
        .mockResolvedValueOnce({ success: true, keys: [] });

      const result = await store.setupKeys('k1', ['local', 'cloud']);
      expect(mockInvoke).toHaveBeenCalledWith('threshold-security:setup-keys', { keyId: 'k1', sources: ['local', 'cloud'] });
      expect(result.success).toBe(true);
      expect(store.currentSetup).toEqual(setupResult);
      expect(store.loading).toBe(false);
    });

    it('sets error when result is not success', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Bad params' });

      const result = await store.setupKeys('k1');
      expect(store.error).toBe('Bad params');
      expect(store.currentSetup).toBeNull();
      expect(result.success).toBe(false);
    });

    it('toggles loading during call', async () => {
      const store = useThresholdSecurityStore();
      expect(store.loading).toBe(false);

      let loadingDuringCall = false;
      mockInvoke.mockImplementationOnce(() => {
        loadingDuringCall = store.loading;
        return Promise.resolve({ success: false, error: 'test' });
      });

      await store.setupKeys('k1');
      expect(loadingDuringCall).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('catches exceptions and sets error', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockRejectedValueOnce(new Error('IPC timeout'));

      const result = await store.setupKeys('k1');
      expect(store.error).toBe('IPC timeout');
      expect(result).toEqual({ success: false, error: 'IPC timeout' });
      expect(store.loading).toBe(false);
    });
  });

  describe('sign', () => {
    it('calls IPC and returns result on success', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValueOnce({ success: true, signature: 'sig123' });

      const result = await store.sign('k1', 'data', ['local', 'cloud']);
      expect(mockInvoke).toHaveBeenCalledWith('threshold-security:sign', { keyId: 'k1', data: 'data', shareSources: ['local', 'cloud'] });
      expect(result.success).toBe(true);
      expect(store.error).toBeNull();
    });

    it('sets error when result is not success', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Threshold not met' });

      const result = await store.sign('k1', 'data', ['local']);
      expect(store.error).toBe('Threshold not met');
      expect(result.success).toBe(false);
    });

    it('catches exceptions and sets error', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockRejectedValueOnce(new Error('Network error'));

      const result = await store.sign('k1', 'data', []);
      expect(store.error).toBe('Network error');
      expect(result).toEqual({ success: false, error: 'Network error' });
      expect(store.loading).toBe(false);
    });
  });

  describe('bindBiometric', () => {
    it('calls IPC and reloads bindings on success', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke
        .mockResolvedValueOnce({ success: true })
        .mockResolvedValueOnce({ success: true, bindings: [{ id: 'b1', key_id: 'k1', biometric_type: 'fingerprint', status: 'active', bound_at: 1000, expires_at: null, last_verified_at: null, verification_count: 0 }] });

      const result = await store.bindBiometric('k1', 'fingerprint', 'tpl-data', 30);
      expect(mockInvoke).toHaveBeenCalledWith('threshold-security:bind-biometric', { keyId: 'k1', biometricType: 'fingerprint', templateData: 'tpl-data', expiresInDays: 30 });
      expect(result.success).toBe(true);
      expect(store.loading).toBe(false);
    });

    it('sets error on failure', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Biometric not supported' });

      await store.bindBiometric('k1', 'iris', 'tpl');
      expect(store.error).toBe('Biometric not supported');
    });

    it('catches exceptions', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockRejectedValueOnce(new Error('HW error'));

      const result = await store.bindBiometric('k1', 'fingerprint', 'tpl');
      expect(store.error).toBe('HW error');
      expect(result).toEqual({ success: false, error: 'HW error' });
    });
  });

  describe('verifyBiometric', () => {
    it('calls IPC and returns result on success', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValueOnce({ success: true, verified: true });

      const result = await store.verifyBiometric('k1', 'fingerprint', 'tpl');
      expect(mockInvoke).toHaveBeenCalledWith('threshold-security:verify-biometric', { keyId: 'k1', biometricType: 'fingerprint', templateData: 'tpl' });
      expect(result.success).toBe(true);
      expect(store.error).toBeNull();
    });

    it('sets error on failure', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockResolvedValueOnce({ success: false, error: 'Mismatch' });

      await store.verifyBiometric('k1', 'fingerprint', 'tpl');
      expect(store.error).toBe('Mismatch');
    });

    it('catches exceptions', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockRejectedValueOnce(new Error('Timeout'));

      const result = await store.verifyBiometric('k1', 'fingerprint', 'tpl');
      expect(store.error).toBe('Timeout');
      expect(result).toEqual({ success: false, error: 'Timeout' });
      expect(store.loading).toBe(false);
    });
  });

  describe('loadKeys', () => {
    it('calls IPC with list action and sets keys', async () => {
      const store = useThresholdSecurityStore();
      const keys = [{ key_id: 'k1', public_key: 'pub1', share_count: 3, created_at: 1000 }];
      mockInvoke.mockResolvedValueOnce({ success: true, keys });

      await store.loadKeys();
      expect(mockInvoke).toHaveBeenCalledWith('threshold-security:setup-keys', { action: 'list' });
      expect(store.keys).toEqual(keys);
    });

    it('does not throw on failure', async () => {
      const store = useThresholdSecurityStore();
      mockInvoke.mockRejectedValueOnce(new Error('fail'));

      await expect(store.loadKeys()).resolves.not.toThrow();
      expect(store.keys).toEqual([]);
    });
  });

  describe('loadBindings', () => {
    it('calls IPC with list action and sets bindings', async () => {
      const store = useThresholdSecurityStore();
      const bindings = [{ id: 'b1', key_id: 'k1', biometric_type: 'fingerprint', status: 'active', bound_at: 1000, expires_at: null, last_verified_at: null, verification_count: 0 }];
      mockInvoke.mockResolvedValueOnce({ success: true, bindings });

      await store.loadBindings('k1');
      expect(mockInvoke).toHaveBeenCalledWith('threshold-security:bind-biometric', { action: 'list', keyId: 'k1' });
      expect(store.bindings).toEqual(bindings);
    });
  });
});
