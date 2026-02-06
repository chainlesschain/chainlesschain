/**
 * Identity Store - Enterprise Multi-Identity Management
 * Manages personal identity and organization identity switching
 */

import { logger } from '@/utils/logger';
import { defineStore } from 'pinia';
import { ref, computed, type Ref, type ComputedRef } from 'vue';

// ==================== Type Definitions ====================

/**
 * Identity context type
 */
export type ContextType = 'personal' | 'organization';

/**
 * Organization role
 */
export type OrgRole = 'owner' | 'admin' | 'member' | 'viewer';

/**
 * Identity context
 */
export interface IdentityContext {
  type: ContextType;
  displayName: string;
  avatar: string;
  localDB: string;
  orgId?: string;
  orgName?: string;
  role?: OrgRole;
}

/**
 * Identity contexts map
 */
export interface IdentityContexts {
  personal: IdentityContext;
  [key: string]: IdentityContext;
}

/**
 * User organization
 */
export interface UserOrganization {
  orgId: string;
  name: string;
  description?: string;
  type?: string;
  avatar?: string;
  role: OrgRole;
  joinedAt?: number;
}

/**
 * DID identity from IPC
 */
export interface DIDIdentity {
  did: string;
  displayName?: string;
  avatar?: string;
}

/**
 * Organization from IPC
 */
export interface Organization {
  org_id: string;
  name: string;
  description?: string;
  type?: string;
  avatar?: string;
  created_at?: number;
}

/**
 * Organization data for creation
 */
export interface OrganizationCreateData {
  name: string;
  description?: string;
  type?: string;
  avatar?: string;
}

/**
 * Invitation data
 */
export interface InvitationData {
  role?: OrgRole;
  expiresAt?: number;
  maxUses?: number;
  invitedBy?: string;
}

/**
 * Invitation result
 */
export interface Invitation {
  code: string;
  orgId: string;
  role: OrgRole;
  expiresAt?: number;
  maxUses?: number;
  createdAt: number;
}

/**
 * Organization member
 */
export interface OrganizationMember {
  did: string;
  displayName?: string;
  avatar?: string;
  role: OrgRole;
  joinedAt: number;
}

// ==================== Store ====================

export const useIdentityStore = defineStore('identity', () => {
  // ==================== State ====================

  // User primary DID
  const primaryDID: Ref<string | null> = ref(null);

  // Current active identity context
  const currentContext: Ref<string> = ref('personal'); // Default to personal

  // All identity contexts
  const contexts: Ref<IdentityContexts> = ref({
    personal: {
      type: 'personal',
      displayName: 'Personal',
      avatar: '',
      localDB: 'data/personal.db',
    },
    // Organization identities are dynamically added
  });

  // User organizations list
  const organizations: Ref<UserOrganization[]> = ref([]);

  // Loading state
  const loading: Ref<boolean> = ref(false);

  // ==================== Getters ====================

  /**
   * Get current identity info
   */
  const currentIdentity: ComputedRef<IdentityContext> = computed(() => {
    return contexts.value[currentContext.value] || contexts.value.personal;
  });

  /**
   * Get all organization identities
   */
  const organizationIdentities: ComputedRef<IdentityContext[]> = computed(() => {
    return Object.values(contexts.value).filter((ctx) => ctx.type === 'organization');
  });

  /**
   * Is current context an organization
   */
  const isOrganizationContext: ComputedRef<boolean> = computed(() => {
    return currentIdentity.value.type === 'organization';
  });

  /**
   * Current organization ID (if in organization context)
   */
  const currentOrgId: ComputedRef<string | null> = computed(() => {
    if (isOrganizationContext.value) {
      return currentIdentity.value.orgId || null;
    }
    return null;
  });

  // ==================== Actions ====================

  /**
   * Initialize identity store
   */
  async function initialize(): Promise<void> {
    loading.value = true;

    try {
      // 1. Get current user DID
      const identity = (await (window as any).ipc.invoke(
        'did:get-current-identity'
      )) as DIDIdentity | null;
      if (identity) {
        primaryDID.value = identity.did;

        // Update personal identity info
        contexts.value.personal = {
          type: 'personal',
          displayName: identity.displayName || 'Personal',
          avatar: identity.avatar || '',
          localDB: 'data/personal.db',
        };
      }

      // 2. Load user organizations
      if (primaryDID.value) {
        await loadUserOrganizations();
      }

      // 3. Load identity contexts (from database)
      // TODO: Load saved contexts from identity-contexts table

      logger.info('[IdentityStore] Identity store initialized successfully');
    } catch (error) {
      logger.error('[IdentityStore] Initialization failed:', error as any);
    } finally {
      loading.value = false;
    }
  }

  /**
   * Load user organizations
   */
  async function loadUserOrganizations(): Promise<void> {
    if (!primaryDID.value) {
      logger.warn('[IdentityStore] Primary DID not set, skipping organization load');
      return;
    }

    try {
      const orgs = (await (window as any).ipc.invoke(
        'org:get-user-organizations',
        primaryDID.value
      )) as UserOrganization[];
      organizations.value = orgs;

      // Create identity context for each organization
      orgs.forEach((org) => {
        const contextId = `org_${org.orgId}`;
        contexts.value[contextId] = {
          type: 'organization',
          orgId: org.orgId,
          orgName: org.name,
          role: org.role,
          displayName: `${contexts.value.personal.displayName || 'Me'}@${org.name}`,
          avatar: org.avatar || '',
          localDB: `data/${org.orgId}.db`,
        };
      });

      logger.info(`[IdentityStore] Loaded ${orgs.length} organizations`);
    } catch (error) {
      logger.error('[IdentityStore] Failed to load organizations:', error as any);
    }
  }

  /**
   * Switch identity context
   * @param contextId - Identity context ID ('personal' or 'org_xxx')
   */
  async function switchContext(contextId: string): Promise<void> {
    if (!contexts.value[contextId]) {
      throw new Error(`Identity context does not exist: ${contextId}`);
    }

    if (currentContext.value === contextId) {
      logger.info('[IdentityStore] Already in current identity, no switch needed');
      return;
    }

    loading.value = true;

    try {
      logger.info('[IdentityStore] Switching identity:', contextId);

      // 1. Save current context state
      await saveCurrentContext();

      // 2. Switch database file
      logger.info('[IdentityStore] Switching database to:', contextId);
      const result = await (window as any).ipc.invoke('db:switch-database', contextId);
      logger.info('[IdentityStore] Database switch result:', result);

      // 3. Switch context
      currentContext.value = contextId;

      // 4. Update P2P network identity
      // TODO: Update P2P network identity info
      // if (window.ipc) {
      //   await window.ipc.invoke('p2p:update-identity', contextId);
      // }

      // 5. Save identity switch record
      await saveContextSwitch(contextId);

      logger.info(
        '[IdentityStore] Identity switch successful:',
        contexts.value[contextId].displayName
      );

      // Reload page to load new identity data
      window.location.reload();
    } catch (error) {
      logger.error('[IdentityStore] Identity switch failed:', error as any);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Create organization and add to identity list
   * @param orgData - Organization data
   * @returns Created organization info
   */
  async function createOrganization(orgData: OrganizationCreateData): Promise<Organization> {
    loading.value = true;

    try {
      logger.info('[IdentityStore] Creating organization:', orgData.name);

      // 1. Call backend to create organization
      const org = (await (window as any).ipc.invoke(
        'org:create-organization',
        orgData
      )) as Organization;

      // 2. Add to organization list
      organizations.value.push({
        orgId: org.org_id,
        name: org.name,
        description: org.description,
        type: org.type,
        avatar: org.avatar,
        role: 'owner', // Creator is owner
        joinedAt: org.created_at,
      });

      // 3. Create organization identity context
      const contextId = `org_${org.org_id}`;
      contexts.value[contextId] = {
        type: 'organization',
        orgId: org.org_id,
        orgName: org.name,
        role: 'owner',
        displayName: `${contexts.value.personal.displayName || 'Me'}@${org.name}`,
        avatar: org.avatar || '',
        localDB: `data/${org.org_id}.db`,
      };

      logger.info('[IdentityStore] Organization created successfully:', org.org_id);

      return org;
    } catch (error) {
      logger.error('[IdentityStore] Failed to create organization:', error as any);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Join organization
   * @param inviteCode - Invitation code
   * @returns Joined organization info
   */
  async function joinOrganization(inviteCode: string): Promise<Organization> {
    loading.value = true;

    try {
      logger.info('[IdentityStore] Joining organization with invite code:', inviteCode);

      // 1. Call backend to join organization
      const org = (await (window as any).ipc.invoke(
        'org:join-organization',
        inviteCode
      )) as Organization;

      // 2. Reload organization list
      await loadUserOrganizations();

      logger.info('[IdentityStore] Successfully joined organization:', org.org_id);

      return org;
    } catch (error) {
      logger.error('[IdentityStore] Failed to join organization:', error as any);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Leave organization
   * @param orgId - Organization ID
   */
  async function leaveOrganization(orgId: string): Promise<void> {
    if (!primaryDID.value) {
      throw new Error('User DID not found');
    }

    loading.value = true;

    try {
      logger.info('[IdentityStore] Leaving organization:', orgId);

      // 1. Call backend to leave organization
      await (window as any).ipc.invoke('org:leave-organization', orgId, primaryDID.value);

      // 2. Remove from list
      organizations.value = organizations.value.filter((org) => org.orgId !== orgId);

      // 3. Remove identity context
      const contextId = `org_${orgId}`;
      delete contexts.value[contextId];

      // 4. If currently in this organization identity, switch back to personal
      if (currentContext.value === contextId) {
        await switchContext('personal');
      }

      logger.info('[IdentityStore] Left organization:', orgId);
    } catch (error) {
      logger.error('[IdentityStore] Failed to leave organization:', error as any);
      throw error;
    } finally {
      loading.value = false;
    }
  }

  /**
   * Save current context state
   */
  async function saveCurrentContext(): Promise<void> {
    // TODO: Save to identity-contexts table
    logger.info('[IdentityStore] Saving current context:', currentContext.value);
  }

  /**
   * Save identity switch record
   * @param contextId - New context ID
   */
  async function saveContextSwitch(contextId: string): Promise<void> {
    // TODO: Save to database, record switch time
    logger.info('[IdentityStore] Recording identity switch:', contextId);
  }

  /**
   * Get organization info
   * @param orgId - Organization ID
   */
  async function getOrganization(orgId: string): Promise<Organization | null> {
    try {
      return (await (window as any).ipc.invoke('org:get-organization', orgId)) as Organization;
    } catch (error) {
      logger.error('[IdentityStore] Failed to get organization info:', error as any);
      return null;
    }
  }

  /**
   * Get organization members list
   * @param orgId - Organization ID
   */
  async function getOrganizationMembers(orgId: string): Promise<OrganizationMember[]> {
    try {
      return (await (window as any).ipc.invoke(
        'org:get-members',
        orgId
      )) as OrganizationMember[];
    } catch (error) {
      logger.error('[IdentityStore] Failed to get members list:', error as any);
      return [];
    }
  }

  /**
   * Check permission
   * @param permission - Permission string
   * @returns Has permission
   */
  async function checkPermission(permission: string): Promise<boolean> {
    if (!isOrganizationContext.value || !primaryDID.value) {
      return false; // Personal identity or not logged in, no org permission
    }

    try {
      return (await (window as any).ipc.invoke(
        'org:check-permission',
        currentOrgId.value,
        primaryDID.value,
        permission
      )) as boolean;
    } catch (error) {
      logger.error('[IdentityStore] Failed to check permission:', error as any);
      return false;
    }
  }

  /**
   * Create invitation
   * @param inviteData - Invitation data
   * @returns Invitation info
   */
  async function createInvitation(inviteData: InvitationData): Promise<Invitation> {
    if (!isOrganizationContext.value || !primaryDID.value) {
      throw new Error('Must be in organization identity to create invitation');
    }

    try {
      return (await (window as any).ipc.invoke('org:create-invitation', currentOrgId.value, {
        ...inviteData,
        invitedBy: primaryDID.value,
      })) as Invitation;
    } catch (error) {
      logger.error('[IdentityStore] Failed to create invitation:', error as any);
      throw error;
    }
  }

  // ==================== Return ====================

  return {
    // State
    primaryDID,
    currentContext,
    contexts,
    organizations,
    loading,

    // Getters
    currentIdentity,
    organizationIdentities,
    isOrganizationContext,
    currentOrgId,

    // Actions
    initialize,
    loadUserOrganizations,
    switchContext,
    createOrganization,
    joinOrganization,
    leaveOrganization,
    getOrganization,
    getOrganizationMembers,
    checkPermission,
    createInvitation,
  };
});
