'use strict';

const { EventEmitter } = require('events');
const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

/**
 * Enterprise Organization Manager
 *
 * Provides department management, org hierarchy views, member join workflows,
 * dashboard statistics, and bulk member import on top of the existing
 * OrganizationManager, TeamManager, and ApprovalWorkflowManager.
 *
 * Departments are modelled as org_teams rows whose JSON `settings` column
 * contains `"team_type":"department"`.
 *
 * @module enterprise/enterprise-org-manager
 */
class EnterpriseOrgManager extends EventEmitter {
  constructor() {
    super();
    this.database = null;
    this.teamManager = null;
    this.approvalManager = null;
    this.organizationManager = null;
    this.initialized = false;
  }

  /**
   * Initialize the manager with required dependencies.
   *
   * @param {Object} dependencies
   * @param {Object} dependencies.database - Database instance (must expose getDatabase())
   * @param {Object} dependencies.teamManager - TeamManager instance
   * @param {Object} dependencies.approvalManager - ApprovalWorkflowManager instance
   * @param {Object} dependencies.organizationManager - OrganizationManager instance
   */
  initialize(dependencies) {
    this.database = dependencies.database;
    this.teamManager = dependencies.teamManager;
    this.approvalManager = dependencies.approvalManager;
    this.organizationManager = dependencies.organizationManager;
    this.initialized = true;
    logger.info('[EnterpriseOrg] Initialized');
  }

  // ---------------------------------------------------------------------------
  // Department CRUD
  // ---------------------------------------------------------------------------

  /**
   * Create a department (team with team_type = 'department' stored in settings).
   *
   * @param {string} orgId
   * @param {Object} data
   * @param {string} data.name
   * @param {string} [data.description]
   * @param {string|null} [data.parentDeptId]
   * @param {string} [data.leadDid]
   * @param {string} [data.leadName]
   * @returns {Promise<Object>} Created department record
   */
  async createDepartment(orgId, { name, description, parentDeptId, leadDid, leadName }) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const deptId = uuidv4();

      const settings = JSON.stringify({ team_type: 'department' });

      db.prepare(`
        INSERT INTO org_teams (
          id, org_id, name, description, parent_team_id, lead_did, lead_name,
          avatar, settings, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        deptId,
        orgId,
        name,
        description || null,
        parentDeptId || null,
        leadDid || null,
        leadName || null,
        null,
        settings,
        now,
        now
      );

      // If a lead is specified, add them as a team member with 'lead' role
      if (leadDid) {
        try {
          await this.teamManager.addMember(deptId, leadDid, leadName, 'lead');
        } catch (err) {
          // Non-fatal: the department is created even if member add fails
          logger.warn('[EnterpriseOrg] Failed to add lead as member:', err.message);
        }
      }

      const department = {
        id: deptId,
        orgId,
        name,
        description: description || null,
        parentDeptId: parentDeptId || null,
        leadDid: leadDid || null,
        leadName: leadName || null,
        teamType: 'department',
        memberCount: leadDid ? 1 : 0,
        createdAt: now,
        updatedAt: now,
      };

      this.emit('department-created', department);
      logger.info(`[EnterpriseOrg] Created department ${deptId} (${name}) in org ${orgId}`);

      return department;
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        logger.warn(`[EnterpriseOrg] Department name already exists: ${name}`);
        throw new Error(`Department name "${name}" already exists in this organization`);
      }
      logger.error('[EnterpriseOrg] Error creating department:', error);
      throw error;
    }
  }

  /**
   * Update an existing department.
   *
   * @param {string} deptId
   * @param {Object} updates
   * @param {string} [updates.name]
   * @param {string} [updates.description]
   * @param {string} [updates.leadDid]
   * @param {string} [updates.leadName]
   * @returns {Promise<Object>}
   */
  async updateDepartment(deptId, { name, description, leadDid, leadName }) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const updateParts = [];
      const values = [];

      if (name !== undefined) {
        updateParts.push('name = ?');
        values.push(name);
      }
      if (description !== undefined) {
        updateParts.push('description = ?');
        values.push(description);
      }
      if (leadDid !== undefined) {
        updateParts.push('lead_did = ?');
        values.push(leadDid);
      }
      if (leadName !== undefined) {
        updateParts.push('lead_name = ?');
        values.push(leadName);
      }

      if (updateParts.length === 0) {
        return { success: true };
      }

      updateParts.push('updated_at = ?');
      values.push(now);
      values.push(deptId);

      db.prepare(`UPDATE org_teams SET ${updateParts.join(', ')} WHERE id = ?`).run(...values);

      logger.info(`[EnterpriseOrg] Updated department ${deptId}`);
      this.emit('department-updated', { deptId, name, description, leadDid, leadName });

      return { success: true };
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        throw new Error(`Department name "${name}" already exists in this organization`);
      }
      logger.error('[EnterpriseOrg] Error updating department:', error);
      throw error;
    }
  }

  /**
   * Delete a department. Fails if the department has sub-departments.
   *
   * @param {string} deptId
   * @returns {Promise<Object>}
   */
  async deleteDepartment(deptId) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();

      // Verify this is indeed a department
      const dept = db.prepare('SELECT * FROM org_teams WHERE id = ?').get(deptId);
      if (!dept) {
        return { success: false, error: 'DEPARTMENT_NOT_FOUND' };
      }

      // Check for child teams/departments
      const childCount = db.prepare(
        'SELECT COUNT(*) as count FROM org_teams WHERE parent_team_id = ?'
      ).get(deptId);

      if (childCount?.count > 0) {
        return {
          success: false,
          error: 'HAS_CHILDREN',
          message: `Department has ${childCount.count} child teams/departments. Remove them first.`,
        };
      }

      db.prepare('DELETE FROM org_teams WHERE id = ?').run(deptId);

      logger.info(`[EnterpriseOrg] Deleted department ${deptId}`);
      this.emit('department-deleted', { deptId });

      return { success: true };
    } catch (error) {
      logger.error('[EnterpriseOrg] Error deleting department:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Hierarchy & Querying
  // ---------------------------------------------------------------------------

  /**
   * Get the full organization hierarchy: org -> departments/teams -> members.
   *
   * @param {string} orgId
   * @returns {Promise<Object>} { org, hierarchy }
   */
  async getOrgHierarchy(orgId) {
    this._ensureInitialized();

    try {
      // 1. Fetch org info
      let org = null;
      if (this.organizationManager) {
        org = await this.organizationManager.getOrganization(orgId);
      }

      // 2. Fetch all teams for org (flat list)
      const db = this.database.getDatabase();
      const teams = db.prepare(
        'SELECT * FROM org_teams WHERE org_id = ? ORDER BY name ASC'
      ).all(orgId);

      // Attach member counts
      for (const team of teams) {
        const count = db.prepare(
          'SELECT COUNT(*) as count FROM org_team_members WHERE team_id = ?'
        ).get(team.id);
        team.memberCount = count?.count || 0;
      }

      // 3. Convert to camelCase items
      const items = teams.map((t) => this._mapTeamRow(t));

      // 4. Build tree
      const hierarchy = this._buildTree(items, null);

      logger.info(`[EnterpriseOrg] Built hierarchy for org ${orgId}: ${items.length} nodes`);

      return { org, hierarchy };
    } catch (error) {
      logger.error('[EnterpriseOrg] Error building org hierarchy:', error);
      throw error;
    }
  }

  /**
   * Recursively build a tree from a flat list of items that have a `parentDeptId` field.
   *
   * @param {Array} items - Flat list
   * @param {string|null} parentId
   * @returns {Array} Tree nodes with `children`
   */
  _buildTree(items, parentId = null) {
    const children = items.filter((item) => {
      if (parentId === null) {
        return !item.parentDeptId;
      }
      return item.parentDeptId === parentId;
    });

    return children.map((child) => ({
      ...child,
      children: this._buildTree(items, child.id),
    }));
  }

  /**
   * Move a department to a new parent. Validates no circular reference is created.
   *
   * @param {string} deptId
   * @param {string|null} newParentId
   * @returns {Promise<Object>}
   */
  async moveDepartment(deptId, newParentId) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Validate source exists
      const dept = db.prepare('SELECT * FROM org_teams WHERE id = ?').get(deptId);
      if (!dept) {
        return { success: false, error: 'DEPARTMENT_NOT_FOUND' };
      }

      // Prevent moving to itself
      if (deptId === newParentId) {
        return { success: false, error: 'CIRCULAR_REFERENCE', message: 'Cannot move department under itself' };
      }

      // Validate no circular reference by walking up from newParentId
      if (newParentId) {
        const visited = new Set();
        let currentId = newParentId;
        while (currentId) {
          if (currentId === deptId) {
            return {
              success: false,
              error: 'CIRCULAR_REFERENCE',
              message: 'Moving this department here would create a circular hierarchy',
            };
          }
          if (visited.has(currentId)) {break;}
          visited.add(currentId);
          const parent = db.prepare('SELECT parent_team_id FROM org_teams WHERE id = ?').get(currentId);
          currentId = parent?.parent_team_id || null;
        }
      }

      db.prepare(
        'UPDATE org_teams SET parent_team_id = ?, updated_at = ? WHERE id = ?'
      ).run(newParentId || null, now, deptId);

      logger.info(`[EnterpriseOrg] Moved department ${deptId} to parent ${newParentId || 'root'}`);
      this.emit('department-moved', { deptId, newParentId });

      return { success: true };
    } catch (error) {
      logger.error('[EnterpriseOrg] Error moving department:', error);
      throw error;
    }
  }

  /**
   * Get all departments for an organization (team_type = 'department' in settings).
   *
   * @param {string} orgId
   * @returns {Promise<Array>}
   */
  async getDepartments(orgId) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();

      const teams = db.prepare(`
        SELECT * FROM org_teams
        WHERE org_id = ? AND settings LIKE '%"team_type":"department"%'
        ORDER BY name ASC
      `).all(orgId);

      // Attach member counts
      for (const team of teams) {
        const count = db.prepare(
          'SELECT COUNT(*) as count FROM org_team_members WHERE team_id = ?'
        ).get(team.id);
        team.memberCount = count?.count || 0;
      }

      return teams.map((t) => this._mapTeamRow(t));
    } catch (error) {
      logger.error('[EnterpriseOrg] Error getting departments:', error);
      throw error;
    }
  }

  /**
   * Get all members belonging to a department and its sub-teams.
   *
   * @param {string} deptId
   * @returns {Promise<Array>}
   */
  async getDepartmentMembers(deptId) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();

      // Collect dept + all descendant team IDs
      const teamIds = this._collectDescendantIds(db, deptId);

      if (teamIds.length === 0) {
        return [];
      }

      const placeholders = teamIds.map(() => '?').join(', ');
      const members = db.prepare(`
        SELECT otm.*, ot.name as team_name
        FROM org_team_members otm
        INNER JOIN org_teams ot ON ot.id = otm.team_id
        WHERE otm.team_id IN (${placeholders})
        ORDER BY otm.team_role DESC, otm.joined_at ASC
      `).all(...teamIds);

      return members.map((m) => ({
        id: m.id,
        teamId: m.team_id,
        teamName: m.team_name,
        memberDid: m.member_did,
        memberName: m.member_name,
        role: m.team_role,
        joinedAt: m.joined_at,
        invitedBy: m.invited_by,
      }));
    } catch (error) {
      logger.error('[EnterpriseOrg] Error getting department members:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Member Join Workflow
  // ---------------------------------------------------------------------------

  /**
   * Request a member to join an organization. If an approval workflow of type
   * 'member_join' exists for the org, the request goes through approval.
   * Otherwise the member is added directly.
   *
   * @param {string} orgId
   * @param {string} memberDid
   * @param {string} role
   * @param {string} requestedBy
   * @returns {Promise<Object>} { needsApproval, requestId?, memberId? }
   */
  async requestMemberJoin(orgId, memberDid, role, requestedBy) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();

      // Check if member already exists
      const existing = db.prepare(
        'SELECT * FROM organization_members WHERE org_id = ? AND member_did = ?'
      ).get(orgId, memberDid);

      if (existing) {
        return { needsApproval: false, skipped: true, reason: 'ALREADY_MEMBER' };
      }

      // Check for approval workflow with trigger 'member_join'
      const workflow = db.prepare(`
        SELECT * FROM approval_workflows
        WHERE org_id = ? AND trigger_resource_type = 'member' AND trigger_action = 'join' AND enabled = 1
        LIMIT 1
      `).get(orgId);

      if (workflow && this.approvalManager) {
        // Submit through approval workflow
        const result = await this.approvalManager.submitApproval({
          workflowId: workflow.id,
          requesterDid: requestedBy,
          requesterName: requestedBy,
          resourceType: 'member',
          resourceId: memberDid,
          action: 'join',
          requestData: { memberDid, role, orgId },
        });

        logger.info(`[EnterpriseOrg] Member join request submitted for approval: ${result.requestId}`);

        return { needsApproval: true, requestId: result.requestId };
      }

      // No workflow: add directly via organizationManager
      if (this.organizationManager) {
        await this.organizationManager.addMember(orgId, {
          memberDID: memberDid,
          displayName: memberDid,
          avatar: '',
          role: role || 'member',
          permissions: JSON.stringify([]),
        });

        logger.info(`[EnterpriseOrg] Member ${memberDid} added directly to org ${orgId}`);

        return { needsApproval: false, memberId: memberDid };
      }

      throw new Error('OrganizationManager not available');
    } catch (error) {
      logger.error('[EnterpriseOrg] Error processing member join request:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Dashboard & Statistics
  // ---------------------------------------------------------------------------

  /**
   * Get dashboard statistics for an organization.
   *
   * @param {string} orgId
   * @returns {Promise<Object>}
   */
  async getOrgDashboardStats(orgId) {
    this._ensureInitialized();

    try {
      const db = this.database.getDatabase();

      // Member count
      const memberRow = db.prepare(
        'SELECT COUNT(*) as count FROM organization_members WHERE org_id = ?'
      ).get(orgId);
      const memberCount = memberRow?.count || 0;

      // Team count (all teams including departments)
      const teamRow = db.prepare(
        'SELECT COUNT(*) as count FROM org_teams WHERE org_id = ?'
      ).get(orgId);
      const teamCount = teamRow?.count || 0;

      // Department count (teams with team_type = department in settings)
      const deptRow = db.prepare(`
        SELECT COUNT(*) as count FROM org_teams
        WHERE org_id = ? AND settings LIKE '%"team_type":"department"%'
      `).get(orgId);
      const departmentCount = deptRow?.count || 0;

      // Pending approval count
      const approvalRow = db.prepare(
        "SELECT COUNT(*) as count FROM approval_requests WHERE org_id = ? AND status = 'pending'"
      ).get(orgId);
      const pendingApprovals = approvalRow?.count || 0;

      // Recent activity (last 10 items from org_activity_log if it exists)
      let recentActivity = [];
      try {
        recentActivity = db.prepare(`
          SELECT * FROM organization_activity_log
          WHERE org_id = ?
          ORDER BY timestamp DESC
          LIMIT 10
        `).all(orgId);
      } catch (_err) {
        // Table may not exist in all deployments; ignore gracefully
        logger.debug('[EnterpriseOrg] organization_activity_log query skipped');
      }

      return {
        memberCount,
        teamCount,
        departmentCount,
        pendingApprovals,
        recentActivity,
      };
    } catch (error) {
      logger.error('[EnterpriseOrg] Error getting dashboard stats:', error);
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Bulk Import
  // ---------------------------------------------------------------------------

  /**
   * Bulk import members into an organization.
   *
   * @param {string} orgId
   * @param {Array<Object>} members - [{ did, name, role, teamId? }]
   * @returns {Promise<Object>} { imported, failed, skipped }
   */
  async bulkMemberImport(orgId, members) {
    this._ensureInitialized();

    const imported = [];
    const failed = [];
    const skipped = [];

    for (const member of members) {
      try {
        if (!member.did) {
          failed.push({ ...member, error: 'Missing DID' });
          continue;
        }

        const result = await this.requestMemberJoin(
          orgId,
          member.did,
          member.role || 'member',
          member.did
        );

        if (result.skipped) {
          skipped.push({ ...member, reason: result.reason });
        } else {
          imported.push({ ...member, ...result });

          // If a teamId is specified and the member was added directly, add to team
          if (member.teamId && !result.needsApproval) {
            try {
              await this.teamManager.addMember(
                member.teamId,
                member.did,
                member.name || member.did,
                member.role || 'member'
              );
            } catch (teamErr) {
              logger.warn(
                `[EnterpriseOrg] Bulk import: member added to org but failed to add to team ${member.teamId}:`,
                teamErr.message
              );
            }
          }
        }
      } catch (error) {
        failed.push({ ...member, error: error.message });
      }
    }

    logger.info(
      `[EnterpriseOrg] Bulk import for org ${orgId}: imported=${imported.length}, failed=${failed.length}, skipped=${skipped.length}`
    );

    return { imported, failed, skipped };
  }

  // ---------------------------------------------------------------------------
  // Internal Helpers
  // ---------------------------------------------------------------------------

  _ensureInitialized() {
    if (!this.initialized) {
      throw new Error('EnterpriseOrgManager is not initialized. Call initialize() first.');
    }
  }

  /**
   * Map a raw org_teams DB row to a camelCase object.
   */
  _mapTeamRow(row) {
    let parsedSettings = null;
    try {
      parsedSettings = row.settings ? JSON.parse(row.settings) : null;
    } catch (_e) {
      parsedSettings = null;
    }

    return {
      id: row.id,
      orgId: row.org_id,
      name: row.name,
      description: row.description,
      parentDeptId: row.parent_team_id,
      leadDid: row.lead_did,
      leadName: row.lead_name,
      teamType: parsedSettings?.team_type || 'team',
      memberCount: row.memberCount || 0,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /**
   * Collect the given team ID plus all descendant team IDs (BFS).
   */
  _collectDescendantIds(db, rootId) {
    const ids = [rootId];
    const queue = [rootId];

    while (queue.length > 0) {
      const current = queue.shift();
      const children = db.prepare(
        'SELECT id FROM org_teams WHERE parent_team_id = ?'
      ).all(current);

      for (const child of children) {
        ids.push(child.id);
        queue.push(child.id);
      }
    }

    return ids;
  }
}

// Singleton
let instance = null;

function getEnterpriseOrgManager() {
  if (!instance) {
    instance = new EnterpriseOrgManager();
  }
  return instance;
}

module.exports = { EnterpriseOrgManager, getEnterpriseOrgManager };
