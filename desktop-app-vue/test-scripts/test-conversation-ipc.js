/**
 * Test script to verify conversation:create IPC handler is registered
 * Run this with: node test-conversation-ipc.js
 */

const { ipcMain } = require('electron');

console.log('=== Testing Conversation IPC Handler Registration ===\n');

// Check if we can access ipcMain
if (!ipcMain) {
  console.error('❌ ipcMain is not available (not running in Electron main process)');
  process.exit(1);
}

// Try to get the list of registered handlers
// Note: Electron doesn't expose a direct way to list handlers, but we can check if they exist
console.log('Checking for conversation:create handler...');

// The only way to check is to try to register it again and see if it throws
try {
  // This will throw if a handler is already registered
  ipcMain.handle('conversation:create', () => {});
  console.log('⚠️  Handler was NOT registered - we just registered it');
  ipcMain.removeHandler('conversation:create');
} catch (error) {
  if (error.message.includes('already registered') || error.message.includes('already exists')) {
    console.log('✅ Handler IS registered (got expected error when trying to re-register)');
  } else {
    console.log('❌ Unexpected error:', error.message);
  }
}

console.log('\n=== Test Complete ===');
