/**
 * Team Manager
 *
 * Manages organization sub-teams and team membership.
 *
 * @module permission/team-manager
 */

const { logger } = require('../utils/logger.js');
const { v4: uuidv4 } = require('uuid');

class TeamManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * Create a team
   */
  async createTeam(teamData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const teamId = uuidv4();

      db.prepare(`
        INSERT INTO org_teams (
          id, org_id, name, description, parent_team_id, lead_did, lead_name,
          avatar, settings, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        teamId,
        teamData.orgId,
        teamData.name,
        teamData.description,
        teamData.parentTeamId,
        teamData.leadDid,
        teamData.leadName,
        teamData.avatar,
        teamData.settings ? JSON.stringify(teamData.settings) : null,
        now,
        now
      );

      // Add lead as team member
      if (teamData.leadDid) {
        await this.addMember(teamId, teamData.leadDid, teamData.leadName, 'lead', teamData.createdBy);
      }

      logger.info(`[Team] Created team ${teamId}`);

      return { success: true, teamId };
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        return { success: false, error: 'TEAM_NAME_EXISTS' };
      }
      logger.error('[Team] Error creating team:', error);
      throw error;
    }
  }

  /**
   * Update a team
   */
  async updateTeam(teamId, updates) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const allowedFields = ['name', 'description', 'parent_team_id', 'lead_did', 'lead_name', 'avatar', 'settings'];
      const updateParts = [];
      const values = [];

      for (const [key, value] of Object.entries(updates)) {
        const dbKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();
        if (allowedFields.includes(dbKey)) {
          updateParts.push(`${dbKey} = ?`);
          values.push(key === 'settings' ? JSON.stringify(value) : value);
        }
      }

      if (updateParts.length === 0) {
        return { success: true };
      }

      updateParts.push('updated_at = ?');
      values.push(now);
      values.push(teamId);

      db.prepare(`UPDATE org_teams SET ${updateParts.join(', ')} WHERE id = ?`).run(...values);

      return { success: true };
    } catch (error) {
      logger.error('[Team] Error updating team:', error);
      throw error;
    }
  }

  /**
   * Delete a team
   */
  async deleteTeam(teamId) {
    try {
      const db = this.database.getDatabase();

      // Check for sub-teams
      const subTeams = db.prepare(`
        SELECT COUNT(*) as count FROM org_teams WHERE parent_team_id = ?
      `).get(teamId);

      if (subTeams?.count > 0) {
        return {
          success: false,
          error: 'HAS_SUB_TEAMS',
          message: `Team has ${subTeams.count} sub-teams. Delete them first.`
        };
      }

      db.prepare(`DELETE FROM org_teams WHERE id = ?`).run(teamId);

      logger.info(`[Team] Deleted team ${teamId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Team] Error deleting team:', error);
      throw error;
    }
  }

  /**
   * Add a member to team
   */
  async addMember(teamId, memberDid, memberName, role = 'member', invitedBy = null) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const id = uuidv4();

      db.prepare(`
        INSERT INTO org_team_members (id, team_id, member_did, member_name, team_role, joined_at, invited_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(id, teamId, memberDid, memberName, role, now, invitedBy);

      logger.info(`[Team] Added member ${memberDid} to team ${teamId}`);

      return { success: true, memberId: id };
    } catch (error) {
      if (error.message?.includes('UNIQUE constraint')) {
        return { success: false, error: 'ALREADY_MEMBER' };
      }
      logger.error('[Team] Error adding member:', error);
      throw error;
    }
  }

  /**
   * Remove a member from team
   */
  async removeMember(teamId, memberDid) {
    try {
      const db = this.database.getDatabase();

      db.prepare(`
        DELETE FROM org_team_members WHERE team_id = ? AND member_did = ?
      `).run(teamId, memberDid);

      logger.info(`[Team] Removed member ${memberDid} from team ${teamId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Team] Error removing member:', error);
      throw error;
    }
  }

  /**
   * Set team lead
   */
  async setLead(teamId, leadDid, leadName) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      // Update team lead
      db.prepare(`
        UPDATE org_teams SET lead_did = ?, lead_name = ?, updated_at = ? WHERE id = ?
      `).run(leadDid, leadName, now, teamId);

      // Update member role
      db.prepare(`
        UPDATE org_team_members SET team_role = 'member' WHERE team_id = ? AND team_role = 'lead'
      `).run(teamId);

      db.prepare(`
        UPDATE org_team_members SET team_role = 'lead' WHERE team_id = ? AND member_did = ?
      `).run(teamId, leadDid);

      logger.info(`[Team] Set lead ${leadDid} for team ${teamId}`);

      return { success: true };
    } catch (error) {
      logger.error('[Team] Error setting team lead:', error);
      throw error;
    }
  }

  /**
   * Get teams for an organization
   */
  async getTeams(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `SELECT * FROM org_teams WHERE org_id = ?`;
      const params = [orgId];

      if (options.parentTeamId !== undefined) {
        if (options.parentTeamId === null) {
          query += ` AND parent_team_id IS NULL`;
        } else {
          query += ` AND parent_team_id = ?`;
          params.push(options.parentTeamId);
        }
      }

      query += ` ORDER BY name ASC`;

      const teams = db.prepare(query).all(...params);

      // Get member counts
      for (const team of teams) {
        const count = db.prepare(`
          SELECT COUNT(*) as count FROM org_team_members WHERE team_id = ?
        `).get(team.id);
        team.memberCount = count?.count || 0;
      }

      return {
        success: true,
        teams: teams.map(t => ({
          id: t.id,
          name: t.name,
          description: t.description,
          parentTeamId: t.parent_team_id,
          leadDid: t.lead_did,
          leadName: t.lead_name,
          avatar: t.avatar,
          settings: t.settings ? JSON.parse(t.settings) : null,
          memberCount: t.memberCount,
          createdAt: t.created_at,
          updatedAt: t.updated_at
        }))
      };
    } catch (error) {
      logger.error('[Team] Error getting teams:', error);
      throw error;
    }
  }

  /**
   * Get team members
   */
  async getTeamMembers(teamId) {
    try {
      const db = this.database.getDatabase();

      const members = db.prepare(`
        SELECT * FROM org_team_members WHERE team_id = ? ORDER BY team_role DESC, joined_at ASC
      `).all(teamId);

      return {
        success: true,
        members: members.map(m => ({
          id: m.id,
          memberDid: m.member_did,
          memberName: m.member_name,
          role: m.team_role,
          joinedAt: m.joined_at,
          invitedBy: m.invited_by
        }))
      };
    } catch (error) {
      logger.error('[Team] Error getting team members:', error);
      throw error;
    }
  }
}

let teamManager = null;

function getTeamManager(database) {
  if (!teamManager && database) {
    teamManager = new TeamManager(database);
  }
  return teamManager;
}

module.exports = {
  TeamManager,
  getTeamManager
};
