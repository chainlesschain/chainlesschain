/**
 * Identity Context Store
 *
 * Manages multiple identity contexts (personal, organization) switching and state
 *
 * @module identityStore
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';

// ==================== Type Definitions ====================

/**
 * Context type
 */
export type IdentityContextType = 'personal' | 'organization';

/**
 * Identity context
 */
export interface IdentityContext {
  context_id: string;
  context_type: IdentityContextType;
  user_did: string;
  org_id?: string;
  org_did?: string;
  display_name: string;
  avatar?: string;
  is_active: number;
  created_at: number;
  updated_at?: number;
}

/**
 * Context switch history item
 */
export interface ContextSwitchHistory {
  id: string;
  from_context_id: string;
  to_context_id: string;
  switched_at: number;
}

/**
 * IPC result for identity operations
 */
export interface IdentityIpcResult<T = any> {
  success: boolean;
  context?: IdentityContext;
  contexts?: IdentityContext[];
  history?: ContextSwitchHistory[];
  error?: string;
  skipped?: boolean;
}

/**
 * Initialize result
 */
export interface InitializeResult {
  success: boolean;
  skipped?: boolean;
  error?: string;
}

// ==================== Store ====================

export const useIdentityStore = defineStore('identityContext', () => {
  // ==================== State ====================

  // Current active context
  const activeContext: Ref<IdentityContext | null> = ref(null);

  // All available contexts
  const contexts: Ref<IdentityContext[]> = ref([]);

  // Current user DID
  const currentUserDID: Ref<string | null> = ref(null);

  // Loading state
  const loading: Ref<boolean> = ref(false);

  // Switching state
  const switching: Ref<boolean> = ref(false);

  // ==================== Getters ====================

  /**
   * Is in personal context
   */
  const isPersonalContext: ComputedRef<boolean> = computed(() => {
    return activeContext.value?.context_type === 'personal';
  });

  /**
   * Is in organization context
   */
  const isOrganizationContext: ComputedRef<boolean> = computed(() => {
    return activeContext.value?.context_type === 'organization';
  });

  /**
   * Current context ID
   */
  const currentContextId: ComputedRef<string | undefined> = computed(() => {
    return activeContext.value?.context_id;
  });

  /**
   * Current organization ID
   */
  const currentOrgId: ComputedRef<string | undefined> = computed(() => {
    return activeContext.value?.org_id;
  });

  /**
   * Personal context
   */
  const personalContext: ComputedRef<IdentityContext | undefined> = computed(() => {
    return contexts.value.find((ctx) => ctx.context_type === 'personal');
  });

  /**
   * Organization context list
   */
  const organizationContexts: ComputedRef<IdentityContext[]> = computed(() => {
    return contexts.value.filter((ctx) => ctx.context_type === 'organization');
  });

  /**
   * Context count
   */
  const contextCount: ComputedRef<number> = computed(() => {
    return contexts.value.length;
  });

  /**
   * Has organizations
   */
  const hasOrganizations: ComputedRef<boolean> = computed(() => {
    return organizationContexts.value.length > 0;
  });

  // ==================== Actions ====================

  /**
   * Initialize identity context
   */
  async function initialize(userDID: string): Promise<InitializeResult> {
    try {
      loading.value = true;
      currentUserDID.value = userDID;

      // 1. Load all contexts
      await loadContexts();

      // 2. Get current active context
      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:get-active-context', { userDID });

      if (result.success && result.context) {
        activeContext.value = result.context;
      } else if (result.error && result.error.includes('not initialized')) {
        // Identity context manager not initialized (user hasn't created DID yet), this is normal
        logger.info('Identity context manager not initialized, skipping identity context load');
        return { success: true, skipped: true };
      } else {
        // If no active context, create and activate personal context
        await ensurePersonalContext(userDID);
      }

      return { success: true };
    } catch (error) {
      logger.error('Failed to initialize identity context:', error as any);
      // Don't block app startup, just log error
      return { success: true, error: (error as Error).message };
    } finally {
      loading.value = false;
    }
  }

  /**
   * Load all contexts
   */
  async function loadContexts(): Promise<IdentityIpcResult> {
    try {
      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:get-all-contexts', {
        userDID: currentUserDID.value,
      });

      if (result.success) {
        contexts.value = result.contexts || [];
      } else if (result.error && result.error.includes('not initialized')) {
        // Manager not initialized, return empty list
        contexts.value = [];
      }

      return result;
    } catch (error) {
      logger.error('Failed to load context list:', error as any);
      contexts.value = [];
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Ensure personal context exists
   */
  async function ensurePersonalContext(
    userDID: string,
    displayName: string = 'Personal'
  ): Promise<IdentityIpcResult> {
    try {
      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:create-personal-context', {
        userDID,
        displayName,
      });

      if (result.success) {
        // Refresh context list
        await loadContexts();

        // Activate personal context
        if (!activeContext.value) {
          await switchContext('personal');
        }
      } else if (result.error && result.error.includes('not initialized')) {
        // Manager not initialized, skip
        logger.info('Identity context manager not initialized, skipping personal context creation');
        return { success: true, skipped: true };
      }

      return result;
    } catch (error) {
      logger.error('Failed to create personal context:', error as any);
      return { success: true, error: (error as Error).message };
    }
  }

  /**
   * Create organization context
   */
  async function createOrganizationContext(
    orgId: string,
    orgDID: string,
    displayName: string,
    avatar: string | null = null
  ): Promise<IdentityIpcResult> {
    try {
      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:create-organization-context', {
        userDID: currentUserDID.value,
        orgId,
        orgDID,
        displayName,
        avatar,
      });

      if (result.success) {
        // Refresh context list
        await loadContexts();
      }

      return result;
    } catch (error) {
      logger.error('Failed to create organization context:', error as any);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Switch identity context
   */
  async function switchContext(targetContextId: string): Promise<IdentityIpcResult> {
    try {
      if (targetContextId === currentContextId.value) {
        logger.info('Already in current context');
        return { success: true, context: activeContext.value || undefined };
      }

      switching.value = true;

      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:switch-context', {
        userDID: currentUserDID.value,
        targetContextId,
      });

      if (result.success) {
        // Update active context
        activeContext.value = result.context || null;

        // Refresh context list
        await loadContexts();

        logger.info(`Switched to: ${result.context?.display_name}`);
      }

      return result;
    } catch (error) {
      logger.error('Failed to switch identity context:', error as any);
      return { success: false, error: (error as Error).message };
    } finally {
      switching.value = false;
    }
  }

  /**
   * Switch to personal identity
   */
  async function switchToPersonal(): Promise<IdentityIpcResult> {
    return await switchContext('personal');
  }

  /**
   * Switch to organization identity
   */
  async function switchToOrganization(orgId: string): Promise<IdentityIpcResult> {
    return await switchContext(`org_${orgId}`);
  }

  /**
   * Delete organization context
   */
  async function deleteOrganizationContext(orgId: string): Promise<IdentityIpcResult> {
    try {
      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:delete-organization-context', {
        userDID: currentUserDID.value,
        orgId,
      });

      if (result.success) {
        // Refresh context list
        await loadContexts();
      }

      return result;
    } catch (error) {
      logger.error('Failed to delete organization context:', error as any);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Get switch history
   */
  async function getSwitchHistory(limit: number = 10): Promise<ContextSwitchHistory[]> {
    try {
      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:get-switch-history', {
        userDID: currentUserDID.value,
        limit,
      });

      return result.success ? result.history || [] : [];
    } catch (error) {
      logger.error('Failed to get switch history:', error as any);
      return [];
    }
  }

  /**
   * Get context by ID
   */
  function getContextById(contextId: string): IdentityContext | undefined {
    return contexts.value.find((ctx) => ctx.context_id === contextId);
  }

  /**
   * Refresh active context
   */
  async function refreshActiveContext(): Promise<IdentityIpcResult> {
    try {
      const result: IdentityIpcResult = await (
        window as any
      ).electron.ipcRenderer.invoke('identity:get-active-context', {
        userDID: currentUserDID.value,
      });

      if (result.success && result.context) {
        activeContext.value = result.context;
      }

      return result;
    } catch (error) {
      logger.error('Failed to refresh active context:', error as any);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Reset store
   */
  function reset(): void {
    activeContext.value = null;
    contexts.value = [];
    currentUserDID.value = null;
    loading.value = false;
    switching.value = false;
  }

  // ==================== Return ====================

  return {
    // State
    activeContext,
    contexts,
    currentUserDID,
    loading,
    switching,

    // Getters
    isPersonalContext,
    isOrganizationContext,
    currentContextId,
    currentOrgId,
    personalContext,
    organizationContexts,
    contextCount,
    hasOrganizations,

    // Actions
    initialize,
    loadContexts,
    ensurePersonalContext,
    createOrganizationContext,
    switchContext,
    switchToPersonal,
    switchToOrganization,
    deleteOrganizationContext,
    getSwitchHistory,
    getContextById,
    refreshActiveContext,
    reset,
  };
});
