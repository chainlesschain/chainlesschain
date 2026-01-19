/**
 * Enterprise Dashboard IPC Handlers
 *
 * Provides data for the enterprise dashboard including:
 * - Statistics and metrics
 * - Activity analytics
 * - Member engagement
 * - Knowledge graph visualization
 * - Storage and resource usage
 */

const { logger, createLogger } = require('../utils/logger.js');
const { ipcMain } = require('electron');

/**
 * Register all dashboard IPC handlers
 * @param {Object} dependencies
 * @param {Object} dependencies.database - Database manager
 * @param {Object} dependencies.organizationManager - Organization manager
 */
function registerDashboardIPC({ database, organizationManager }) {
  // Statistics
  ipcMain.handle('dashboard:get-stats', async (event, { orgId, dateRange }) => {
    return getStats(database, organizationManager, orgId, dateRange);
  });

  ipcMain.handle('dashboard:get-top-contributors', async (event, { orgId, limit = 10 }) => {
    return getTopContributors(database, orgId, limit);
  });

  ipcMain.handle('dashboard:get-recent-activities', async (event, { orgId, limit = 20 }) => {
    return getRecentActivities(database, orgId, limit);
  });

  ipcMain.handle('dashboard:get-role-stats', async (event, { orgId }) => {
    return getRoleStats(database, orgId);
  });

  // Charts and analytics
  ipcMain.handle('dashboard:get-activity-timeline', async (event, { orgId, days = 30 }) => {
    return getActivityTimeline(database, orgId, days);
  });

  ipcMain.handle('dashboard:get-activity-breakdown', async (event, { orgId }) => {
    return getActivityBreakdown(database, orgId);
  });

  ipcMain.handle('dashboard:get-knowledge-graph', async (event, { orgId }) => {
    return getKnowledgeGraph(database, orgId);
  });

  ipcMain.handle('dashboard:get-storage-breakdown', async (event, { orgId }) => {
    return getStorageBreakdown(database, orgId);
  });

  ipcMain.handle('dashboard:get-member-engagement', async (event, { orgId }) => {
    return getMemberEngagement(database, orgId);
  });

  ipcMain.handle('dashboard:get-activity-heatmap', async (event, { orgId }) => {
    return getActivityHeatmap(database, orgId);
  });

  logger.info('[DashboardIPC] All handlers registered (10 handlers)');
}

/**
 * Get dashboard statistics
 */
async function getStats(database, organizationManager, orgId, dateRange) {
  try {
    const db = database.getDatabase();
    const now = Date.now();
    const oneMonthAgo = now - 30 * 24 * 60 * 60 * 1000;

    // Get total members
    const totalMembers = db.prepare(`
      SELECT COUNT(*) as count
      FROM organization_members
      WHERE org_id = ? AND status = 'active'
    `).get(orgId)?.count || 0;

    // Get member growth (last month)
    const previousMonthMembers = db.prepare(`
      SELECT COUNT(*) as count
      FROM organization_members
      WHERE org_id = ? AND status = 'active' AND joined_at < ?
    `).get(orgId, oneMonthAgo)?.count || 0;

    const memberGrowth = previousMonthMembers > 0
      ? ((totalMembers - previousMonthMembers) / previousMonthMembers * 100).toFixed(1)
      : 0;

    // Get total knowledge items
    const totalKnowledge = db.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_items
      WHERE org_id = ? AND deleted_at IS NULL
    `).get(orgId)?.count || 0;

    // Get knowledge created today
    const todayStart = new Date().setHours(0, 0, 0, 0);
    const knowledgeCreatedToday = db.prepare(`
      SELECT COUNT(*) as count
      FROM knowledge_items
      WHERE org_id = ? AND created_at >= ? AND deleted_at IS NULL
    `).get(orgId, todayStart)?.count || 0;

    // Get active collaborations (documents with recent activity)
    const recentThreshold = now - 24 * 60 * 60 * 1000; // Last 24 hours
    const activeCollaborations = db.prepare(`
      SELECT COUNT(DISTINCT knowledge_id) as count
      FROM organization_activities
      WHERE org_id = ? AND timestamp >= ?
    `).get(orgId, recentThreshold)?.count || 0;

    // Get online members (from P2P network)
    const onlineMembers = organizationManager ? organizationManager.getOnlineMemberCount(orgId) : 0;

    // Get storage used
    const storageUsed = db.prepare(`
      SELECT SUM(LENGTH(content)) as total
      FROM knowledge_items
      WHERE org_id = ? AND deleted_at IS NULL
    `).get(orgId)?.total || 0;

    // Get network health
    const networkStats = organizationManager ? organizationManager.getOrgNetworkStats(orgId) : null;
    const networkHealth = networkStats ? Math.min(100, networkStats.connectedPeers * 20) : 0;

    return {
      success: true,
      stats: {
        totalMembers,
        memberGrowth: parseFloat(memberGrowth),
        totalKnowledge,
        knowledgeCreatedToday,
        activeCollaborations,
        onlineMembers,
        storageUsed,
        storageLimit: 10 * 1024 * 1024 * 1024, // 10GB
        bandwidthUsed: 0, // TODO: Implement bandwidth tracking
        bandwidthLimit: 100 * 1024 * 1024 * 1024, // 100GB
        networkHealth,
        activeConnections: networkStats?.connectedPeers || 0,
        maxConnections: 100
      }
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting stats:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get top contributors
 */
async function getTopContributors(database, orgId, limit) {
  try {
    const db = database.getDatabase();

    const contributors = db.prepare(`
      SELECT
        m.member_did,
        m.display_name as name,
        m.role,
        COUNT(CASE WHEN a.action = 'create' THEN 1 END) as knowledgeCreated,
        COUNT(CASE WHEN a.action = 'edit' THEN 1 END) as edits,
        COUNT(CASE WHEN a.action = 'comment' THEN 1 END) as comments
      FROM organization_members m
      LEFT JOIN organization_activities a ON m.member_did = a.actor_did AND m.org_id = a.org_id
      WHERE m.org_id = ? AND m.status = 'active'
      GROUP BY m.member_did
      ORDER BY (knowledgeCreated + edits + comments) DESC
      LIMIT ?
    `).all(orgId, limit);

    return {
      success: true,
      contributors
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting top contributors:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get recent activities
 */
async function getRecentActivities(database, orgId, limit) {
  try {
    const db = database.getDatabase();

    const activities = db.prepare(`
      SELECT
        a.id,
        a.action as activity_type,
        a.actor_did,
        m.display_name as user_name,
        a.metadata,
        a.timestamp as created_at
      FROM organization_activities a
      LEFT JOIN organization_members m ON a.actor_did = m.member_did AND a.org_id = m.org_id
      WHERE a.org_id = ?
      ORDER BY a.timestamp DESC
      LIMIT ?
    `).all(orgId, limit);

    // Parse metadata JSON
    const parsedActivities = activities.map(activity => ({
      ...activity,
      metadata: activity.metadata ? JSON.parse(activity.metadata) : {}
    }));

    return {
      success: true,
      activities: parsedActivities
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting recent activities:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get role statistics
 */
async function getRoleStats(database, orgId) {
  try {
    const db = database.getDatabase();

    const roleStats = db.prepare(`
      SELECT
        role,
        COUNT(*) as count
      FROM organization_members
      WHERE org_id = ? AND status = 'active'
      GROUP BY role
    `).all(orgId);

    const total = roleStats.reduce((sum, r) => sum + r.count, 0);

    const rolesWithPercentage = roleStats.map(r => ({
      ...r,
      percentage: total > 0 ? ((r.count / total) * 100).toFixed(1) + '%' : '0%'
    }));

    return {
      success: true,
      roles: rolesWithPercentage
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting role stats:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get activity timeline
 */
async function getActivityTimeline(database, orgId, days) {
  try {
    const db = database.getDatabase();
    const now = Date.now();
    const startTime = now - days * 24 * 60 * 60 * 1000;

    // Generate date range
    const timeline = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(now - i * 24 * 60 * 60 * 1000);
      const dateStr = date.toISOString().split('T')[0];
      const dayStart = new Date(date.setHours(0, 0, 0, 0)).getTime();
      const dayEnd = dayStart + 24 * 60 * 60 * 1000;

      const activities = db.prepare(`
        SELECT
          action,
          COUNT(*) as count
        FROM organization_activities
        WHERE org_id = ? AND timestamp >= ? AND timestamp < ?
        GROUP BY action
      `).all(orgId, dayStart, dayEnd);

      const activityMap = {};
      activities.forEach(a => {
        activityMap[a.action] = a.count;
      });

      timeline.unshift({
        date: dateStr,
        creates: activityMap.create || 0,
        edits: activityMap.edit || 0,
        views: activityMap.view || 0,
        comments: activityMap.comment || 0
      });
    }

    return {
      success: true,
      timeline
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting activity timeline:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get activity breakdown
 */
async function getActivityBreakdown(database, orgId) {
  try {
    const db = database.getDatabase();

    const breakdown = db.prepare(`
      SELECT
        action as name,
        COUNT(*) as value
      FROM organization_activities
      WHERE org_id = ?
      GROUP BY action
    `).all(orgId);

    return {
      success: true,
      breakdown
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting activity breakdown:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get knowledge graph data
 */
async function getKnowledgeGraph(database, orgId) {
  try {
    const db = database.getDatabase();

    // Get knowledge items as nodes
    const items = db.prepare(`
      SELECT
        id,
        title,
        type,
        created_by
      FROM knowledge_items
      WHERE org_id = ? AND deleted_at IS NULL
      LIMIT 100
    `).all(orgId);

    const nodes = items.map(item => ({
      id: item.id,
      name: item.title || 'Untitled',
      category: item.type,
      symbolSize: 20
    }));

    // Get relationships (based on tags or references)
    const links = [];

    // Simple relationship: items by same creator
    const creatorGroups = {};
    items.forEach(item => {
      if (!creatorGroups[item.created_by]) {
        creatorGroups[item.created_by] = [];
      }
      creatorGroups[item.created_by].push(item.id);
    });

    Object.values(creatorGroups).forEach(group => {
      for (let i = 0; i < group.length - 1; i++) {
        links.push({
          source: group[i],
          target: group[i + 1]
        });
      }
    });

    return {
      success: true,
      nodes,
      links
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting knowledge graph:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get storage breakdown
 */
async function getStorageBreakdown(database, orgId) {
  try {
    const db = database.getDatabase();

    const breakdown = db.prepare(`
      SELECT
        type as name,
        SUM(LENGTH(content)) as value
      FROM knowledge_items
      WHERE org_id = ? AND deleted_at IS NULL
      GROUP BY type
    `).all(orgId);

    return {
      success: true,
      breakdown
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting storage breakdown:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get member engagement
 */
async function getMemberEngagement(database, orgId) {
  try {
    const db = database.getDatabase();

    const members = db.prepare(`
      SELECT
        m.member_did,
        m.display_name as name,
        COUNT(a.id) as activityCount,
        MAX(a.timestamp) as lastActivity
      FROM organization_members m
      LEFT JOIN organization_activities a ON m.member_did = a.actor_did AND m.org_id = a.org_id
      WHERE m.org_id = ? AND m.status = 'active'
      GROUP BY m.member_did
      ORDER BY activityCount DESC
    `).all(orgId);

    const now = Date.now();
    const membersWithScore = members.map(m => {
      const daysSinceActivity = m.lastActivity
        ? Math.floor((now - m.lastActivity) / (24 * 60 * 60 * 1000))
        : 999;

      // Engagement score: activity count * recency factor
      const recencyFactor = Math.max(0, 1 - daysSinceActivity / 30);
      const engagementScore = Math.round(m.activityCount * (1 + recencyFactor));

      return {
        ...m,
        engagementScore
      };
    });

    return {
      success: true,
      members: membersWithScore
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting member engagement:', error);
    return { success: false, error: error.message };
  }
}

/**
 * Get activity heatmap
 */
async function getActivityHeatmap(database, orgId) {
  try {
    const db = database.getDatabase();
    const now = Date.now();
    const sevenDaysAgo = now - 7 * 24 * 60 * 60 * 1000;

    // Get activities for last 7 days
    const activities = db.prepare(`
      SELECT timestamp
      FROM organization_activities
      WHERE org_id = ? AND timestamp >= ?
    `).all(orgId, sevenDaysAgo);

    // Create heatmap data structure
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const hours = Array.from({ length: 24 }, (_, i) => i.toString().padStart(2, '0'));

    const heatmapData = {};
    days.forEach(day => {
      hours.forEach(hour => {
        heatmapData[`${day}-${hour}`] = 0;
      });
    });

    // Fill heatmap with activity data
    activities.forEach(activity => {
      const date = new Date(activity.timestamp);
      const day = days[date.getDay()];
      const hour = date.getHours().toString().padStart(2, '0');
      const key = `${day}-${hour}`;
      if (heatmapData[key] !== undefined) {
        heatmapData[key]++;
      }
    });

    // Convert to array format for ECharts
    const data = [];
    let maxValue = 0;

    days.forEach((day, dayIndex) => {
      hours.forEach((hour, hourIndex) => {
        const value = heatmapData[`${day}-${hour}`];
        data.push([hourIndex, dayIndex, value]);
        maxValue = Math.max(maxValue, value);
      });
    });

    return {
      success: true,
      hours,
      days,
      data,
      maxValue
    };

  } catch (error) {
    logger.error('[DashboardIPC] Error getting activity heatmap:', error);
    return { success: false, error: error.message };
  }
}

module.exports = {
  registerDashboardIPC
};
