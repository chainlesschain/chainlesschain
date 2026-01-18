/**
 * Storage Factory - Creates platform-specific storage instances
 * Automatically detects the current platform and returns the appropriate implementation
 */

// #ifdef H5
import { H5Storage } from './h5-storage.js';
// #endif

// #ifdef MP-WEIXIN
import { MPWeixinStorage } from './mp-weixin-storage.js';
// #endif

// #ifdef APP-PLUS
import { AppStorage } from './app-storage.js';
// #endif

/**
 * Create a storage instance for the current platform
 * @returns {StorageInterface} Platform-specific storage implementation
 */
export function createStorage() {
  // #ifdef H5
  console.log('[Storage Factory] Creating H5 storage (IndexedDB)');
  return new H5Storage();
  // #endif

  // #ifdef MP-WEIXIN
  console.log('[Storage Factory] Creating WeChat Mini Program storage');
  return new MPWeixinStorage();
  // #endif

  // #ifdef APP-PLUS
  console.log('[Storage Factory] Creating App Plus storage (SQLite)');
  return new AppStorage();
  // #endif

  // Fallback (should never reach here in production)
  throw new Error('Unsupported platform - cannot create storage instance');
}

/**
 * Get the current platform name
 * @returns {string} Platform name ('h5', 'mp-weixin', 'app-plus', or 'unknown')
 */
export function getPlatform() {
  // #ifdef H5
  return 'h5';
  // #endif

  // #ifdef MP-WEIXIN
  return 'mp-weixin';
  // #endif

  // #ifdef APP-PLUS
  return 'app-plus';
  // #endif

  return 'unknown';
}
