/**
 * Identity Store shim for @/stores/identityStore imports
 *
 * This file exists to support imports from '@/stores/identityStore' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useIdentityStore } from '../renderer/stores/identityStore.js';
