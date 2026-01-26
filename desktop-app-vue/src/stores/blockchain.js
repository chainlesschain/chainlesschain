/**
 * Blockchain Store shim for @/stores/blockchain imports
 *
 * This file exists to support imports from '@/stores/blockchain' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useBlockchainStore } from '../renderer/stores/blockchain.js';
