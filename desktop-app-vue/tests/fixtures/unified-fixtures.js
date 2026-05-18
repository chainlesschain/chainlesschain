/**
 * Unified Test Fixtures
 *
 * Provides mock factories for all major dependencies in the ChainlessChain application.
 * Enables consistent, maintainable testing across unit, integration, and E2E tests.
 *
 * @module unified-fixtures
 * @version 1.0.0
 */

import { vi } from 'vitest';

// Import adapters
import {
  InMemoryFileSystemAdapter,
  InMemoryDatabaseAdapter,
} from '../../src/main/llm/adapters/index.js';

/**
 * MockFactory - Central mock creation factory
 */
export class MockFactory {
  /**
   * Create in-memory database adapter
   * @returns {InMemoryDatabaseAdapter}
   */
  static createDatabase() {
    return new InMemoryDatabaseAdapter();
  }

  /**
   * Create in-memory file system adapter
   * @returns {InMemoryFileSystemAdapter}
   */
  static createFileSystem() {
    return new InMemoryFileSystemAdapter();
  }

  /**
   * Create mock Electron IPC
   * @returns {object} Mock Electron API
   */
  static createElectron() {
    return {
      ipcMain: {
        handle: vi.fn(),
        on: vi.fn(),
        removeHandler: vi.fn(),
      },
      ipcRenderer: {
        invoke: vi.fn(),
        on: vi.fn(),
        send: vi.fn(),
      },
      app: {
        getPath: vi.fn((name) => {
          const paths = {
            userData: '/mock/userData',
            appData: '/mock/appData',
            temp: '/mock/temp',
            home: '/mock/home',
            documents: '/mock/documents',
          };
          return paths[name] || '/mock/default';
        }),
        getVersion: vi.fn(() => '0.27.0'),
        getName: vi.fn(() => 'chainlesschain-desktop-vue'),
      },
    };
  }

  /**
   * Create mock LLM manager
   * @param {string} provider - LLM provider (ollama, openai, anthropic, etc.)
   * @returns {object} Mock LLM manager
   */
  static createLLM(provider = 'ollama') {
    return {
      query: vi.fn(async (options) => {
        const { prompt, maxTokens = 100 } = options;
        return {
          text: `Mock LLM response for: ${prompt.slice(0, 50)}...`,
          tokens: maxTokens,
          model: provider === 'ollama' ? 'qwen2:7b' : 'gpt-4',
        };
      }),

      stream: vi.fn(async function* (options) {
        const { prompt } = options;
        const words = `Mock streaming response for ${prompt}`.split(' ');
        for (const word of words) {
          yield `${word} `;
        }
      }),

      checkStatus: vi.fn(async () => ({
        available: true,
        provider,
        models: provider === 'ollama' ? ['qwen2:7b', 'llama2'] : ['gpt-4', 'gpt-3.5-turbo'],
      })),

      listModels: vi.fn(async () => [
        { name: 'qwen2:7b', size: '4.7GB' },
        { name: 'llama2', size: '3.8GB' },
      ]),
    };
  }

  /**
   * Create mock P2P node
   * @returns {object} Mock P2P node
   */
  static createP2PNode() {
    const peers = new Map();

    return {
      start: vi.fn(async () => {
        return { success: true, peerId: 'QmMockPeer123' };
      }),

      stop: vi.fn(async () => {
        peers.clear();
        return { success: true };
      }),

      connect: vi.fn(async (peerId) => {
        peers.set(peerId, { connected: true, timestamp: Date.now() });
        return { success: true, peerId };
      }),

      disconnect: vi.fn(async (peerId) => {
        peers.delete(peerId);
        return { success: true, peerId };
      }),

      dial: vi.fn(async (multiaddr) => {
        return { success: true, connection: { id: 'conn-123' } };
      }),

      send: vi.fn(async (peerId, data) => {
        return { success: true, bytesSent: JSON.stringify(data).length };
      }),

      on: vi.fn((event, handler) => {
        // Store event handlers
      }),

      getPeers: vi.fn(() => Array.from(peers.keys())),
    };
  }

  /**
   * Create mock U-Key driver
   * @param {string} brand - U-Key brand (feitian, huada, watchdata, etc.)
   * @returns {object} Mock U-Key driver
   */
  static createUKey(brand = 'simulated') {
    return {
      detect: vi.fn(async () => ({
        detected: true,
        brand,
        version: '1.0.0',
        serialNumber: 'MOCK-12345',
      })),

      verifyPIN: vi.fn(async (pin) => ({
        success: pin === '123456',
        attemptsLeft: 3,
      })),

      sign: vi.fn(async (data, options = {}) => {
        const { algorithm = 'RSA-SHA256' } = options;
        return Buffer.from(`mock-signature-${algorithm}-${data.length}`);
      }),

      verify: vi.fn(async (data, signature, options = {}) => {
        return signature.toString().includes('mock-signature');
      }),

      encrypt: vi.fn(async (data, options = {}) => {
        return Buffer.from(`encrypted:${data.toString()}`);
      }),

      decrypt: vi.fn(async (ciphertext, options = {}) => {
        const text = ciphertext.toString();
        return Buffer.from(text.replace('encrypted:', ''));
      }),

      generateKeyPair: vi.fn(async (options = {}) => ({
        publicKey: Buffer.from('mock-public-key'),
        keyId: 'key-001',
      })),

      initialize: vi.fn(async () => ({ success: true })),

      finalize: vi.fn(async () => ({ success: true })),
    };
  }

  /**
   * Create mock RAG pipeline
   * @returns {object} Mock RAG pipeline
   */
  static createRAG() {
    const documents = new Map();

    return {
      importDocuments: vi.fn(async (docs) => {
        docs.forEach((doc) => documents.set(doc.id, doc));
        return { success: true, count: docs.length };
      }),

      search: vi.fn(async (query, options = {}) => {
        const { topK = 5 } = options;
        const results = Array.from(documents.values())
          .slice(0, topK)
          .map((doc, idx) => ({
            ...doc,
            score: 0.9 - idx * 0.1,
          }));
        return results;
      }),

      generateResponse: vi.fn(async (query, context) => {
        return `Based on the retrieved documents, here's the answer to "${query}": ${context.map((c) => c.content.slice(0, 50)).join(', ')}...`;
      }),

      rerank: vi.fn(async (query, results) => {
        return results.sort((a, b) => b.score - a.score);
      }),
    };
  }

  /**
   * Create mock DID manager
   * @returns {object} Mock DID manager
   */
  static createDID() {
    const identities = new Map();

    return {
      createDID: vi.fn(async (options = {}) => {
        const did = `did:key:z6Mk${Math.random().toString(36).slice(2, 44)}`;
        identities.set(did, { ...options, did });
        return { did, ...options };
      }),

      resolveDID: vi.fn(async (did) => {
        return identities.get(did) || null;
      }),

      sign: vi.fn(async (data, did) => {
        return Buffer.from(`did-signature-${did}-${data.length}`);
      }),

      verify: vi.fn(async (data, signature, did) => {
        return signature.toString().includes(did);
      }),

      encrypt: vi.fn(async (data, recipientDid) => {
        return Buffer.from(`did-encrypted:${recipientDid}:${data.toString()}`);
      }),

      decrypt: vi.fn(async (ciphertext, did) => {
        const text = ciphertext.toString();
        return Buffer.from(text.split(':')[2] || '');
      }),
    };
  }

  /**
   * Create mock prompt compressor
   * @returns {object} Mock prompt compressor
   */
  static createPromptCompressor() {
    return {
      compress: vi.fn(async (messages, options = {}) => {
        const { maxHistoryMessages = 10 } = options;
        const compressed = messages.slice(-maxHistoryMessages);
        const summary = `Summary of ${messages.length} messages`;

        return {
          compressed,
          summary,
          stats: {
            originalCount: messages.length,
            compressedCount: compressed.length,
            tokensSaved: (messages.length - compressed.length) * 50,
          },
        };
      }),
    };
  }

  /**
   * Create mock organization manager
   * @returns {object} Mock organization manager
   */
  static createOrganizationManager() {
    const organizations = new Map();
    const members = new Map();

    return {
      createOrganization: vi.fn(async (data) => {
        const org = {
          id: `org-${Date.now()}`,
          ...data,
          createdAt: Date.now(),
        };
        organizations.set(org.id, org);
        return { success: true, organization: org };
      }),

      addMember: vi.fn(async (orgId, userId, role) => {
        const key = `${orgId}:${userId}`;
        members.set(key, { orgId, userId, role });
        return { success: true };
      }),

      getMembers: vi.fn(async (orgId) => {
        const result = [];
        for (const [key, member] of members) {
          if (member.orgId === orgId) {
            result.push(member);
          }
        }
        return result;
      }),

      checkPermission: vi.fn(async (userId, orgId, permission) => {
        const key = `${orgId}:${userId}`;
        const member = members.get(key);
        if (!member) return false;
        if (member.role === 'admin') return true;
        return permission === 'read' || permission === 'comment';
      }),
    };
  }
}

/**
 * Test Data Seeder
 *
 * Generates realistic test data for various entities
 */
export class TestDataSeeder {
  constructor(db) {
    this.db = db;
  }

  /**
   * Seed users
   */
  async seedUsers(count = 5) {
    const users = [];
    for (let i = 1; i <= count; i++) {
      const user = {
        id: `user-${i}`,
        username: `testuser${i}`,
        email: `test${i}@example.com`,
        did: `did:key:z6Mk${i.toString().padStart(43, '0')}`,
        createdAt: Date.now() - i * 86400000,
      };

      if (this.db.prepare) {
        this.db
          .prepare(
            `
          INSERT INTO users (id, username, email, did, created_at)
          VALUES (?, ?, ?, ?, ?)
        `
          )
          .run(user.id, user.username, user.email, user.did, user.createdAt);
      }

      users.push(user);
    }
    return users;
  }

  /**
   * Seed notes/documents
   */
  async seedNotes(userId, count = 10) {
    const notes = [];
    for (let i = 1; i <= count; i++) {
      const note = {
        id: `note-${userId}-${i}`,
        title: `Test Note ${i}`,
        content: `This is test note content #${i}\n\nIncludes some **Markdown** formatting.`,
        userId,
        createdAt: Date.now() - (count - i) * 86400000,
        updatedAt: Date.now() - (count - i) * 86400000,
      };

      if (this.db.prepare) {
        this.db
          .prepare(
            `
          INSERT INTO notes (id, title, content, user_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
          )
          .run(note.id, note.title, note.content, note.userId, note.createdAt, note.updatedAt);
      }

      notes.push(note);
    }
    return notes;
  }

  /**
   * Seed LLM sessions
   */
  async seedSessions(userId, count = 3) {
    const sessions = [];
    for (let i = 1; i <= count; i++) {
      const session = {
        id: `session-${userId}-${i}`,
        conversationId: `conv-${userId}-${i}`,
        title: `Session ${i}`,
        messages: JSON.stringify([
          { role: 'user', content: `User message ${i}`, timestamp: Date.now() },
          { role: 'assistant', content: `AI response ${i}`, timestamp: Date.now() },
        ]),
        metadata: JSON.stringify({ createdAt: Date.now(), updatedAt: Date.now() }),
        createdAt: Date.now() - (count - i) * 3600000,
        updatedAt: Date.now(),
      };

      if (this.db.prepare) {
        this.db
          .prepare(
            `
          INSERT INTO llm_sessions (id, conversation_id, title, messages, metadata, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `
          )
          .run(
            session.id,
            session.conversationId,
            session.title,
            session.messages,
            session.metadata,
            session.createdAt,
            session.updatedAt
          );
      }

      sessions.push(session);
    }
    return sessions;
  }

  /**
   * Seed organizations
   */
  async seedOrganizations(ownerIds, count = 2) {
    const orgs = [];
    for (let i = 1; i <= count; i++) {
      const ownerId = ownerIds[(i - 1) % ownerIds.length];
      const org = {
        id: `org-${i}`,
        name: `Test Organization ${i}`,
        description: `This is test organization description ${i}`,
        ownerId,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      if (this.db.prepare) {
        this.db
          .prepare(
            `
          INSERT INTO organizations (id, name, description, owner_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `
          )
          .run(org.id, org.name, org.description, org.ownerId, org.createdAt, org.updatedAt);

        // Add admin role
        this.db
          .prepare(
            `
          INSERT INTO organization_roles (org_id, user_id, role)
          VALUES (?, ?, ?)
        `
          )
          .run(org.id, ownerId, 'admin');
      }

      orgs.push(org);
    }
    return orgs;
  }

  /**
   * Clean up all data
   */
  async cleanup() {
    if (!this.db.prepare) return;

    const tables = [
      'notes',
      'llm_sessions',
      'users',
      'organizations',
      'organization_roles',
      'session_tags',
    ];

    for (const table of tables) {
      try {
        this.db.prepare(`DELETE FROM ${table}`).run();
      } catch (e) {
        // Table might not exist
      }
    }
  }
}

// Re-export adapters for convenience
export { InMemoryFileSystemAdapter, InMemoryDatabaseAdapter };
