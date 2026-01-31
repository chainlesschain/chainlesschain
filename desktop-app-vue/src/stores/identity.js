/**
 * Identity Store shim for @/stores/identity imports
 *
 * This file exists to support imports from '@/stores/identity' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useIdentityStore } from '../renderer/stores/identity.js';
