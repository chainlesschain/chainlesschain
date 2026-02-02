/**
 * Shared Workspace Manager
 *
 * Manages cross-organization shared workspaces.
 *
 * @module crossorg/shared-workspace-manager
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');
const EventEmitter = require('events');

class SharedWorkspaceManager extends EventEmitter {
  constructor(database) {
    super();
    this.database = database;
  }

  // ========================================
  // Workspace CRUD
  // ========================================

  /**
   * Create a shared workspace
   */
  async createWorkspace(workspaceData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const workspaceId = uuidv4();

      db.prepare(`
        INSERT INTO shared_workspaces (
          id, name, description, workspace_type, created_by_org_id, created_by_did,
          visibility, settings, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        workspaceId,
        workspaceData.name,
        workspaceData.description,
        workspaceData.workspaceType || 'project',
        workspaceData.createdByOrgId,
        workspaceData.createdByDid,
        workspaceData.visibility || 'private',
        workspaceData.settings ? JSON.stringify(workspaceData.settings) : null,
        now,
        now
      );

      // Add creating org as admin
      const orgMemberId = uuidv4();
      db.prepare(`
        INSERT INTO shared_workspace_orgs (
          id, workspace_id, org_id, org_name, role, joined_at
        ) VALUES (?, ?, ?, ?, 'admin', ?)
      `).run(
        orgMemberId,
        workspaceId,
        workspaceData.createdByOrgId,
        workspaceData.createdByOrgName,
        now
      );

      // Add creator as member
      const memberId = uuidv4();
      db.prepare(`
        INSERT INTO shared_workspace_members (
          id, workspace_id, member_did, member_name, member_org_id, role, permissions, joined_at
        ) VALUES (?, ?, ?, ?, ?, 'admin', ?, ?)
      `).run(
        memberId,
        workspaceId,
        workspaceData.createdByDid,
        workspaceData.createdByName,
        workspaceData.createdByOrgId,
        JSON.stringify(['read', 'write', 'delete', 'admin']),
        now
      );

      logger.info(`[SharedWorkspace] Created workspace ${workspaceId}`);

      return { success: true, workspaceId };
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        return { success: false, error: 'WORKSPACE_NAME_EXISTS' };
      }
      logger.error('[SharedWorkspace] Error creating workspace:', error);
      throw error;
    }
  }

  /**
   * Update a workspace
   */
  async updateWorkspace(workspaceId, updates) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const allowedFields = ['name', 'description', 'visibility', 'settings'];
      const updateParts = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        if (allowedFields.includes(key)) {
          updateParts.push(`${key} = ?`);
          values.push(key === 'settings' ? JSON.stringify(value) : value);
        }
      }

      if (updateParts.length === 0) {
        return { success: true };
      }

      updateParts.push('updated_at = ?');
      values.push(now);
      values.push(workspaceId);

      db.prepare(`
        UPDATE shared_workspaces SET ${updateParts.join(', ')} WHERE id = ?
      `).run(...values);

      return { success: true };
    } catch (error) {
      logger.error('[SharedWorkspace] Error updating workspace:', error);
      throw error;
    }
  }

  /**
   * Archive a workspace
   */
  async archiveWorkspace(workspaceId, archivedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      db.prepare(`
        UPDATE shared_workspaces
        SET status = 'archived', archived_at = ?, updated_at = ?
        WHERE id = ?
      `).run(now, now, workspaceId);

      logger.info(`[SharedWorkspace] Archived workspace ${workspaceId}`);

      return { success: true };
    } catch (error) {
      logger.error('[SharedWorkspace] Error archiving workspace:', error);
      throw error;
    }
  }

  // ========================================
  // Organization Management
  // ========================================

  /**
   * Invite an organization to workspace
   */
  async inviteOrg(workspaceId, orgData, invitedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Check if already member
      const existing = db.prepare(`
        SELECT id FROM shared_workspace_orgs
        WHERE workspace_id = ? AND org_id = ?
      `).get(workspaceId, orgData.orgId);

      if (existing) {
        return { success: false, error: 'ORG_ALREADY_MEMBER' };
      }

      // Verify partnership exists
      const workspace = db.prepare(`
        SELECT created_by_org_id FROM shared_workspaces WHERE id = ?
      `).get(workspaceId);

      if (!workspace) {
        return { success: false, error: 'WORKSPACE_NOT_FOUND' };
      }

      const partnership = db.prepare(`
        SELECT id FROM org_partnerships
        WHERE ((initiator_org_id = ? AND partner_org_id = ?)
           OR (initiator_org_id = ? AND partner_org_id = ?))
          AND status = 'active'
      `).get(
        workspace.created_by_org_id,
        orgData.orgId,
        orgData.orgId,
        workspace.created_by_org_id
      );

      if (!partnership) {
        return { success: false, error: 'NO_PARTNERSHIP' };
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO shared_workspace_orgs (
          id, workspace_id, org_id, org_name, role, invited_by, joined_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        workspaceId,
        orgData.orgId,
        orgData.orgName,
        orgData.role || 'member',
        invitedByDid,
        now
      );

      this.emit('org-invited', {
        workspaceId,
        orgId: orgData.orgId,
        invitedByDid
      });

      logger.info(`[SharedWorkspace] Invited org ${orgData.orgId} to workspace ${workspaceId}`);

      return { success: true, membershipId: id };
    } catch (error) {
      logger.error('[SharedWorkspace] Error inviting org:', error);
      throw error;
    }
  }

  /**
   * Remove an organization from workspace
   */
  async removeOrg(workspaceId, orgId, removedByDid) {
    try {
      const db = this.database.getDatabase();

      // Check if org is creator
      const workspace = db.prepare(`
        SELECT created_by_org_id FROM shared_workspaces WHERE id = ?
      `).get(workspaceId);

      if (workspace?.created_by_org_id === orgId) {
        return { success: false, error: 'CANNOT_REMOVE_CREATOR' };
      }

      // Remove org membership
      db.prepare(`
        DELETE FROM shared_workspace_orgs WHERE workspace_id = ? AND org_id = ?
      `).run(workspaceId, orgId);

      // Remove all members from that org
      db.prepare(`
        DELETE FROM shared_workspace_members WHERE workspace_id = ? AND member_org_id = ?
      `).run(workspaceId, orgId);

      // Revoke shared resources from that org
      const now = Date.now();
      db.prepare(`
        UPDATE cross_org_shares
        SET status = 'revoked', updated_at = ?
        WHERE target_workspace_id = ? AND target_org_id = ?
      `).run(now, workspaceId, orgId);

      logger.info(`[SharedWorkspace] Removed org ${orgId} from workspace ${workspaceId}`);

      return { success: true };
    } catch (error) {
      logger.error('[SharedWorkspace] Error removing org:', error);
      throw error;
    }
  }

  // ========================================
  // Member Management
  // ========================================

  /**
   * Add a member to workspace
   */
  async addMember(workspaceId, memberData, addedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Verify member's org is in workspace
      const orgMembership = db.prepare(`
        SELECT id FROM shared_workspace_orgs
        WHERE workspace_id = ? AND org_id = ?
      `).get(workspaceId, memberData.memberOrgId);

      if (!orgMembership) {
        return { success: false, error: 'ORG_NOT_IN_WORKSPACE' };
      }

      // Check if already member
      const existing = db.prepare(`
        SELECT id FROM shared_workspace_members
        WHERE workspace_id = ? AND member_did = ?
      `).get(workspaceId, memberData.memberDid);

      if (existing) {
        return { success: false, error: 'ALREADY_MEMBER' };
      }

      const id = uuidv4();
      db.prepare(`
        INSERT INTO shared_workspace_members (
          id, workspace_id, member_did, member_name, member_org_id,
          role, permissions, invited_by, joined_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        workspaceId,
        memberData.memberDid,
        memberData.memberName,
        memberData.memberOrgId,
        memberData.role || 'member',
        JSON.stringify(memberData.permissions || ['read']),
        addedByDid,
        now
      );

      logger.info(`[SharedWorkspace] Added member ${memberData.memberDid} to workspace ${workspaceId}`);

      return { success: true, memberId: id };
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        return { success: false, error: 'ALREADY_MEMBER' };
      }
      logger.error('[SharedWorkspace] Error adding member:', error);
      throw error;
    }
  }

  /**
   * Remove a member from workspace
   */
  async removeMember(workspaceId, memberDid, removedByDid) {
    try {
      const db = this.database.getDatabase();

      // Check if member is workspace creator
      const workspace = db.prepare(`
        SELECT created_by_did FROM shared_workspaces WHERE id = ?
      `).get(workspaceId);

      if (workspace?.created_by_did === memberDid) {
        return { success: false, error: 'CANNOT_REMOVE_CREATOR' };
      }

      db.prepare(`
        DELETE FROM shared_workspace_members WHERE workspace_id = ? AND member_did = ?
      `).run(workspaceId, memberDid);

      logger.info(`[SharedWorkspace] Removed member ${memberDid} from workspace ${workspaceId}`);

      return { success: true };
    } catch (error) {
      logger.error('[SharedWorkspace] Error removing member:', error);
      throw error;
    }
  }

  /**
   * Update member role
   */
  async updateMemberRole(workspaceId, memberDid, role, permissions, updatedByDid) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      db.prepare(`
        UPDATE shared_workspace_members
        SET role = ?, permissions = ?, updated_at = ?
        WHERE workspace_id = ? AND member_did = ?
      `).run(
        role,
        JSON.stringify(permissions),
        now,
        workspaceId,
        memberDid
      );

      logger.info(`[SharedWorkspace] Updated member ${memberDid} role to ${role}`);

      return { success: true };
    } catch (error) {
      logger.error('[SharedWorkspace] Error updating member role:', error);
      throw error;
    }
  }

  // ========================================
  // Query Operations
  // ========================================

  /**
   * Get workspaces for an organization
   */
  async getWorkspaces(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT sw.*, swo.role as org_role
        FROM shared_workspaces sw
        INNER JOIN shared_workspace_orgs swo ON swo.workspace_id = sw.id
        WHERE swo.org_id = ?
      `;
      const params = [orgId];

      if (options.status) {
        query += ` AND sw.status = ?`;
        params.push(options.status);
      } else {
        query += ` AND sw.status != 'archived'`;
      }

      if (options.workspaceType) {
        query += ` AND sw.workspace_type = ?`;
        params.push(options.workspaceType);
      }

      query += ` ORDER BY sw.updated_at DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const workspaces = db.prepare(query).all(...params);

      // Get member counts
      for (const ws of workspaces) {
        const counts = db.prepare(`
          SELECT
            (SELECT COUNT(*) FROM shared_workspace_orgs WHERE workspace_id = ?) as orgCount,
            (SELECT COUNT(*) FROM shared_workspace_members WHERE workspace_id = ?) as memberCount
        `).get(ws.id, ws.id);
        ws.orgCount = counts?.orgCount || 0;
        ws.memberCount = counts?.memberCount || 0;
      }

      return {
        success: true,
        workspaces: workspaces.map(ws => ({
          id: ws.id,
          name: ws.name,
          description: ws.description,
          workspaceType: ws.workspace_type,
          createdByOrgId: ws.created_by_org_id,
          visibility: ws.visibility,
          status: ws.status,
          settings: ws.settings ? JSON.parse(ws.settings) : null,
          orgRole: ws.org_role,
          orgCount: ws.orgCount,
          memberCount: ws.memberCount,
          createdAt: ws.created_at,
          updatedAt: ws.updated_at
        }))
      };
    } catch (error) {
      logger.error('[SharedWorkspace] Error getting workspaces:', error);
      throw error;
    }
  }

  /**
   * Get workspace members
   */
  async getWorkspaceMembers(workspaceId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `
        SELECT * FROM shared_workspace_members WHERE workspace_id = ?
      `;
      const params = [workspaceId];

      if (options.orgId) {
        query += ` AND member_org_id = ?`;
        params.push(options.orgId);
      }

      query += ` ORDER BY role DESC, joined_at ASC`;

      const members = db.prepare(query).all(...params);

      // Get org info
      const orgs = db.prepare(`
        SELECT * FROM shared_workspace_orgs WHERE workspace_id = ?
      `).all(workspaceId);

      return {
        success: true,
        organizations: orgs.map(o => ({
          orgId: o.org_id,
          orgName: o.org_name,
          role: o.role,
          joinedAt: o.joined_at
        })),
        members: members.map(m => ({
          id: m.id,
          memberDid: m.member_did,
          memberName: m.member_name,
          memberOrgId: m.member_org_id,
          role: m.role,
          permissions: m.permissions ? JSON.parse(m.permissions) : [],
          joinedAt: m.joined_at
        }))
      };
    } catch (error) {
      logger.error('[SharedWorkspace] Error getting workspace members:', error);
      throw error;
    }
  }

  /**
   * Check member permission
   */
  async checkMemberPermission(workspaceId, memberDid, permission) {
    try {
      const db = this.database.getDatabase();

      const member = db.prepare(`
        SELECT permissions, role FROM shared_workspace_members
        WHERE workspace_id = ? AND member_did = ?
      `).get(workspaceId, memberDid);

      if (!member) {
        return { success: true, hasPermission: false };
      }

      // Admin has all permissions
      if (member.role === 'admin') {
        return { success: true, hasPermission: true };
      }

      const permissions = member.permissions ? JSON.parse(member.permissions) : [];
      return {
        success: true,
        hasPermission: permissions.includes(permission) || permissions.includes('admin')
      };
    } catch (error) {
      logger.error('[SharedWorkspace] Error checking permission:', error);
      throw error;
    }
  }
}

let sharedWorkspaceManager = null;

function getSharedWorkspaceManager(database) {
  if (!sharedWorkspaceManager && database) {
    sharedWorkspaceManager = new SharedWorkspaceManager(database);
  }
  return sharedWorkspaceManager;
}

module.exports = {
  SharedWorkspaceManager,
  getSharedWorkspaceManager
};
