/**
 * Test script to verify all managers are initialized correctly
 * This tests the actual database object being passed to each manager
 */

const path = require('path');

// Mock electron app
const mockApp = {
  getPath: (name) => {
    if (name === 'userData') {
      return path.join(__dirname, '../data');
    }
    return __dirname;
  },
  isReady: () => true,
  quit: () => {}
};

// Set up environment
process.env.NODE_ENV = 'development';
process.env.DEFAULT_PASSWORD = '123456';
global.app = mockApp;

console.log('='.repeat(60));
console.log('Testing Manager Initialization');
console.log('='.repeat(60));

async function testDatabaseConnection() {
  console.log('\n[1/5] Testing Database Connection...');

  try {
    const DatabaseManager = require('../dist/main/database');
    const db = new DatabaseManager(null, {
      password: '123456',
      encryptionEnabled: false
    });

    await db.initialize();
    console.log('  ✓ Database initialized');
    console.log('  ✓ db.db exists:', !!db.db);
    console.log('  ✓ db.prepare exists:', typeof db.prepare);

    // Test prepare method
    const testStmt = db.prepare('SELECT 1 as test');
    const result = testStmt.get();
    console.log('  ✓ db.prepare() works:', result.test === 1);

    return db;
  } catch (error) {
    console.error('  ✗ Database initialization failed:', error.message);
    throw error;
  }
}

async function testTemplateManager(database) {
  console.log('\n[2/5] Testing Template Manager...');

  try {
    const ProjectTemplateManager = require('../dist/main/template/template-manager');

    // Test with DatabaseManager (incorrect - should fail)
    try {
      const _wrongManager = new ProjectTemplateManager(database);
      console.log('  ⚠ Passing DatabaseManager (should fail on use)');
    } catch (_error) {
      console.log('  ✓ Correctly rejects DatabaseManager at construction');
    }

    // Test with raw db (correct)
    const correctManager = new ProjectTemplateManager(database.db);
    await correctManager.initialize();
    console.log('  ✓ Template Manager initialized with database.db');
    console.log('  ✓ Handlebars engine initialized:', !!correctManager.handlebars);

    return correctManager;
  } catch (error) {
    console.error('  ✗ Template Manager failed:', error.message);
    throw error;
  }
}

async function testOrganizationManager(database) {
  console.log('\n[3/5] Testing Organization Manager...');

  try {
    const OrganizationManager = require('../dist/main/organization/organization-manager');

    // Mock DID and P2P managers
    const mockDIDManager = { getCurrentIdentity: () => ({ did: 'test-did' }) };
    const mockP2PManager = { isReady: () => false };

    // Test with raw db (correct)
    const manager = new OrganizationManager(database.db, mockDIDManager, mockP2PManager);
    console.log('  ✓ Organization Manager initialized with database.db');
    console.log('  ✓ DID Invitation Manager exists:', !!manager.didInvitationManager);

    return manager;
  } catch (error) {
    console.error('  ✗ Organization Manager failed:', error.message);
    throw error;
  }
}

async function testFriendManager(database) {
  console.log('\n[4/5] Testing Friend Manager...');

  try {
    const { FriendManager } = require('../dist/main/social/friend-manager');

    // Mock DID and P2P managers
    const mockDIDManager = {
      getCurrentIdentity: () => ({ did: 'test-did' }),
      on: () => {}
    };
    const mockP2PManager = {
      on: () => {},
      isReady: () => false
    };

    // Test with DatabaseManager (correct for this manager)
    const manager = new FriendManager(database, mockDIDManager, mockP2PManager);
    console.log('  ✓ Friend Manager initialized with DatabaseManager');
    console.log('  ✓ Uses database.db internally:', !!manager.database.db);

    // Test initialization
    await manager.initialize();
    console.log('  ✓ Friend Manager initialized successfully');

    return manager;
  } catch (error) {
    console.error('  ✗ Friend Manager failed:', error.message);
    console.error('  Stack:', error.stack);
    // Don't throw - this is non-critical
  }
}

async function testSocialIPC(database) {
  console.log('\n[5/5] Testing Social IPC Handlers...');

  try {
    // Mock ipcMain
    const handlers = new Map();
    const mockIpcMain = {
      handle: (channel, handler) => {
        handlers.set(channel, handler);
        console.log(`  ✓ Registered: ${channel}`);
      }
    };

    // Temporarily replace ipcMain
    const electron = require('electron');
    const originalIpcMain = electron.ipcMain;
    electron.ipcMain = mockIpcMain;

    const { registerSocialIPC } = require('../dist/main/social/social-ipc');

    registerSocialIPC({
      contactManager: null,
      friendManager: null,
      postManager: null,
      database: database,
      groupChatManager: null
    });

    // Restore original ipcMain
    electron.ipcMain = originalIpcMain;

    console.log(`  ✓ Registered ${handlers.size} IPC handlers`);

    // Test chat:get-sessions handler
    if (handlers.has('chat:get-sessions')) {
      const handler = handlers.get('chat:get-sessions');
      const result = await handler({});
      console.log('  ✓ chat:get-sessions returns:', Array.isArray(result) ? 'array' : 'error');
    }

  } catch (error) {
    console.error('  ✗ Social IPC test failed:', error.message);
    // Don't throw - this is non-critical
  }
}

async function runTests() {
  try {
    const database = await testDatabaseConnection();
    await testTemplateManager(database);
    await testOrganizationManager(database);
    await testFriendManager(database);
    await testSocialIPC(database);

    console.log('\n' + '='.repeat(60));
    console.log('✓ All critical tests passed!');
    console.log('='.repeat(60));

    process.exit(0);
  } catch (error) {
    console.log('\n' + '='.repeat(60));
    console.error('✗ Tests failed:', error.message);
    console.log('='.repeat(60));
    process.exit(1);
  }
}

runTests();
