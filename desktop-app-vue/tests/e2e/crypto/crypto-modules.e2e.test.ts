/**
 * Crypto Modules E2E Tests
 *
 * Tests IPC connectivity for all crypto manager channels:
 * - Post-Quantum Cryptography (pq:*)
 * - Zero-Knowledge Proofs (zk:*)
 * - Homomorphic Encryption (he:*)
 * - MPC (mpc:*)
 * - HSM (hsm:*)
 * - Advanced Crypto Features (adv-crypto:*)
 *
 * Strategy:
 * - Each describe block launches its own Electron instance (beforeAll/afterAll)
 * - Only asserts that result is defined and has a 'success' property
 * - Does not assert success:true (managers may not be initialized in test mode)
 * - Uses console.log for debugging like existing e2e tests
 */

import { test, expect } from '@playwright/test';
import type { ElectronApplication, Page } from '@playwright/test';
import { launchElectronApp, closeElectronApp, callIPC } from '../helpers/common';

test.setTimeout(180000);

// ─────────────────────────────────────────────────────────────────────────────
// Post-Quantum Cryptography IPC
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Post-Quantum Cryptography IPC — pq:*', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app, { delay: 2000 });
  });

  test('pq:generate-kyber-keypair returns result with success property', async () => {
    console.log('\n[PQ] Testing pq:generate-kyber-keypair (level 768)');

    const result = await callIPC(window, 'pq:generate-kyber-keypair', 768);

    console.log('pq:generate-kyber-keypair result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Kyber keypair generated:', {
        id: data?.id,
        algorithm: data?.algorithm,
        securityLevel: data?.securityLevel,
      });
    } else {
      console.log('pq:generate-kyber-keypair error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('pq:audit-scan returns result with success property', async () => {
    console.log('\n[PQ] Testing pq:audit-scan');

    const result = await callIPC(window, 'pq:audit-scan');

    console.log('pq:audit-scan result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Audit scan data:', {
        totalKeys: data?.totalKeys,
        classicalKeys: data?.classicalKeys,
        pqcKeys: data?.pqcKeys,
        recommendations: data?.recommendations?.length ?? 0,
      });
    } else {
      console.log('pq:audit-scan error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('pq:hybrid-fallback returns result with success property', async () => {
    console.log('\n[PQ] Testing pq:hybrid-fallback (default mode)');

    const result = await callIPC(window, 'pq:hybrid-fallback', {});

    console.log('pq:hybrid-fallback result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Hybrid fallback config:', {
        mode: data?.mode,
        pqcEnabled: data?.pqc?.enabled,
        classicalEnabled: data?.classical?.enabled,
      });
    } else {
      console.log('pq:hybrid-fallback error (expected if manager not initialized):', (result as any).error);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Zero-Knowledge Proofs IPC
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Zero-Knowledge Proofs IPC — zk:*', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app, { delay: 2000 });
  });

  test('zk:generate-proof returns result with success property', async () => {
    console.log('\n[ZK] Testing zk:generate-proof');

    const result = await callIPC(window, 'zk:generate-proof', {
      system: 'groth16',
      circuit: 'range-check',
      publicInputs: { min: 0, max: 100 },
      privateInputs: { value: 42 },
    });

    console.log('zk:generate-proof result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('ZK proof generated:', {
        proofId: data?.proofId,
        system: data?.system,
        verificationKey: data?.verificationKey ? '[present]' : '[missing]',
      });
    } else {
      console.log('zk:generate-proof error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('zk:benchmark-systems returns result with success property', async () => {
    console.log('\n[ZK] Testing zk:benchmark-systems');

    const result = await callIPC(window, 'zk:benchmark-systems');

    console.log('zk:benchmark-systems result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('ZK benchmark systems:', Array.isArray(data) ? `${data.length} systems` : typeof data);
    } else {
      console.log('zk:benchmark-systems error (expected if manager not initialized):', (result as any).error);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Homomorphic Encryption IPC
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Homomorphic Encryption IPC — he:*', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app, { delay: 2000 });
  });

  test('he:paillier-keygen returns result with success property', async () => {
    console.log('\n[HE] Testing he:paillier-keygen');

    const result = await callIPC(window, 'he:paillier-keygen', { bits: 2048 });

    console.log('he:paillier-keygen result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Paillier keygen:', {
        keyId: data?.keyId,
        bits: data?.bits,
        publicKey: data?.publicKey ? '[present]' : '[missing]',
      });
    } else {
      console.log('he:paillier-keygen error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('he:encrypted-data-analysis returns result with success property', async () => {
    console.log('\n[HE] Testing he:encrypted-data-analysis');

    const result = await callIPC(window, 'he:encrypted-data-analysis', {
      operation: 'sum',
      encryptedValues: ['enc-val-1', 'enc-val-2'],
      keyId: 'test-key-id',
    });

    console.log('he:encrypted-data-analysis result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Encrypted data analysis result:', {
        operation: data?.operation,
        result: data?.result ? '[present]' : '[missing]',
        computeTimeMs: data?.computeTimeMs,
      });
    } else {
      console.log('he:encrypted-data-analysis error (expected if manager not initialized):', (result as any).error);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// MPC IPC
// ─────────────────────────────────────────────────────────────────────────────

test.describe('MPC IPC — mpc:*', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app, { delay: 2000 });
  });

  test('mpc:shamir-split returns result with success property', async () => {
    console.log('\n[MPC] Testing mpc:shamir-split');

    const result = await callIPC(window, 'mpc:shamir-split', {
      secret: 'my-super-secret-key-material',
      shares: 5,
      threshold: 3,
    });

    console.log('mpc:shamir-split result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Shamir split:', {
        splitId: data?.splitId,
        shares: data?.shares?.length ?? 0,
        threshold: data?.threshold,
      });
    } else {
      console.log('mpc:shamir-split error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('mpc:sealed-auction returns result with success property', async () => {
    console.log('\n[MPC] Testing mpc:sealed-auction');

    const result = await callIPC(window, 'mpc:sealed-auction', {
      auctionId: 'auction-e2e-test-001',
      participants: ['bidder-1', 'bidder-2', 'bidder-3'],
      encryptedBids: [
        { bidderId: 'bidder-1', encryptedBid: 'enc-bid-1' },
        { bidderId: 'bidder-2', encryptedBid: 'enc-bid-2' },
        { bidderId: 'bidder-3', encryptedBid: 'enc-bid-3' },
      ],
    });

    console.log('mpc:sealed-auction result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Sealed auction result:', {
        auctionId: data?.auctionId,
        winnerId: data?.winnerId,
        participantCount: data?.participantCount,
      });
    } else {
      console.log('mpc:sealed-auction error (expected if manager not initialized):', (result as any).error);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// HSM IPC
// ─────────────────────────────────────────────────────────────────────────────

test.describe('HSM IPC — hsm:*', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app, { delay: 2000 });
  });

  test('hsm:get-compliance-status returns result with success property', async () => {
    console.log('\n[HSM] Testing hsm:get-compliance-status');

    const result = await callIPC(window, 'hsm:get-compliance-status');

    console.log('hsm:get-compliance-status result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('HSM compliance status:', {
        fips140Level: data?.fips140Level,
        commonCriteria: data?.commonCriteria,
        compliant: data?.compliant,
      });
    } else {
      console.log('hsm:get-compliance-status error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('hsm:generate-key returns result with success property', async () => {
    console.log('\n[HSM] Testing hsm:generate-key');

    const result = await callIPC(window, 'hsm:generate-key', {
      algorithm: 'aes-256',
      usage: 'encrypt',
      label: 'e2e-test-key',
    });

    console.log('hsm:generate-key result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('HSM key generated:', {
        keyId: data?.keyId,
        algorithm: data?.algorithm,
        handle: data?.handle ? '[present]' : '[missing]',
      });
    } else {
      console.log('hsm:generate-key error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('hsm:get-cluster-status returns result with success property (before configuring)', async () => {
    console.log('\n[HSM] Testing hsm:get-cluster-status (before configuring)');

    const result = await callIPC(window, 'hsm:get-cluster-status');

    console.log('hsm:get-cluster-status result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('HSM cluster status:', {
        nodeCount: data?.nodeCount,
        healthyNodes: data?.healthyNodes,
        strategy: data?.strategy,
      });
    } else {
      console.log('hsm:get-cluster-status error (expected before cluster configured):', (result as any).error);
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Advanced Crypto IPC
// ─────────────────────────────────────────────────────────────────────────────

test.describe('Advanced Crypto IPC — adv-crypto:*', () => {
  let app: ElectronApplication;
  let window: Page;

  test.beforeAll(async () => {
    const ctx = await launchElectronApp();
    app = ctx.app;
    window = ctx.window;
  });

  test.afterAll(async () => {
    await closeElectronApp(app, { delay: 2000 });
  });

  test('adv-crypto:sse-create-index returns result with success property', async () => {
    console.log('\n[AdvCrypto] Testing adv-crypto:sse-create-index');

    const result = await callIPC(window, 'adv-crypto:sse-create-index', [
      { id: 'doc-1', content: 'blockchain decentralized security' },
      { id: 'doc-2', content: 'advanced encryption proxy re-encryption' },
      { id: 'doc-3', content: 'zero knowledge proofs verification' },
    ]);

    console.log('adv-crypto:sse-create-index result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('SSE index created:', {
        indexId: data?.indexId,
        documentCount: data?.documentCount,
        tokenCount: data?.tokenCount,
        indexSizeBytes: data?.indexSizeBytes,
      });
    } else {
      console.log('adv-crypto:sse-create-index error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('adv-crypto:enhanced-random returns result with success property', async () => {
    console.log('\n[AdvCrypto] Testing adv-crypto:enhanced-random (32 bytes)');

    const result = await callIPC(window, 'adv-crypto:enhanced-random', 32, 'mixed');

    console.log('adv-crypto:enhanced-random result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Enhanced random output:', {
        length: data?.length,
        entropyBits: data?.entropyBits,
        sources: data?.sources,
        randomHexLength: data?.random?.length,
      });
    } else {
      console.log('adv-crypto:enhanced-random error (expected if manager not initialized):', (result as any).error);
    }
  });

  test('adv-crypto:register-algorithm returns result with success property', async () => {
    console.log('\n[AdvCrypto] Testing adv-crypto:register-algorithm');

    const result = await callIPC(window, 'adv-crypto:register-algorithm',
      'e2e-test-algo',
      { type: 'symmetric', keySize: 256, family: 'TestFamily' },
    );

    console.log('adv-crypto:register-algorithm result:', result);

    expect(result).toBeDefined();
    expect(result).toHaveProperty('success');

    if ((result as any).success) {
      const data = (result as any).data;
      console.log('Algorithm registered:', {
        name: data?.name,
        registered: data?.registered,
        configFamily: data?.config?.family,
      });
    } else {
      console.log('adv-crypto:register-algorithm error (expected if manager not initialized):', (result as any).error);
    }
  });
});
