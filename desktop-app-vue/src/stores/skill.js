/**
 * Skill Store shim for @/stores/skill imports
 *
 * This file exists to support imports from '@/stores/skill' in renderer code.
 * It re-exports from the renderer-specific store.
 */

export { useSkillStore } from '../renderer/stores/skill.js';
