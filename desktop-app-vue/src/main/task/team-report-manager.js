/**
 * Team Report Manager
 *
 * Manages team reports including daily standups, weekly reports, and AI summaries.
 *
 * @module task/team-report-manager
 */

const { logger } = require("../utils/logger.js");
const { v4: uuidv4 } = require("uuid");

class TeamReportManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * Create a team report
   */
  async createReport(reportData) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();
      const reportId = uuidv4();

      db.prepare(
        `
        INSERT INTO team_reports (
          id, org_id, board_id, report_type, author_did, author_name,
          yesterday_work, today_plan, blockers, notes, report_date, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `,
      ).run(
        reportId,
        reportData.orgId,
        reportData.boardId,
        reportData.reportType || "daily_standup",
        reportData.authorDid,
        reportData.authorName,
        reportData.yesterdayWork,
        reportData.todayPlan,
        reportData.blockers,
        reportData.notes,
        reportData.reportDate || now,
        now,
        now,
      );

      logger.info(`[TeamReport] Created report ${reportId}`);

      return { success: true, reportId };
    } catch (error) {
      logger.error("[TeamReport] Error creating report:", error);
      throw error;
    }
  }

  /**
   * Get reports for an organization
   */
  async getReports(orgId, options = {}) {
    try {
      const db = this.database.getDatabase();

      let query = `SELECT * FROM team_reports WHERE org_id = ?`;
      const params = [orgId];

      if (options.reportType) {
        query += ` AND report_type = ?`;
        params.push(options.reportType);
      }

      if (options.boardId) {
        query += ` AND board_id = ?`;
        params.push(options.boardId);
      }

      if (options.authorDid) {
        query += ` AND author_did = ?`;
        params.push(options.authorDid);
      }

      if (options.dateFrom) {
        query += ` AND report_date >= ?`;
        params.push(options.dateFrom);
      }

      if (options.dateTo) {
        query += ` AND report_date <= ?`;
        params.push(options.dateTo);
      }

      query += ` ORDER BY report_date DESC`;

      if (options.limit) {
        query += ` LIMIT ?`;
        params.push(options.limit);
      }

      const reports = db.prepare(query).all(...params);

      return {
        success: true,
        reports: reports.map((r) => ({
          id: r.id,
          orgId: r.org_id,
          boardId: r.board_id,
          reportType: r.report_type,
          authorDid: r.author_did,
          authorName: r.author_name,
          yesterdayWork: r.yesterday_work,
          todayPlan: r.today_plan,
          blockers: r.blockers,
          notes: r.notes,
          aiSummary: r.ai_summary,
          reportDate: r.report_date,
          createdAt: r.created_at,
          updatedAt: r.updated_at,
        })),
      };
    } catch (error) {
      logger.error("[TeamReport] Error getting reports:", error);
      throw error;
    }
  }

  /**
   * Generate AI summary for a report
   */
  async generateAISummary(reportId) {
    try {
      const db = this.database.getDatabase();
      const now = Date.now();

      const report = db
        .prepare(`SELECT * FROM team_reports WHERE id = ?`)
        .get(reportId);

      if (!report) {
        return { success: false, error: "REPORT_NOT_FOUND" };
      }

      // Generate summary using LLM
      const summary = await this._generateSummary(report);

      // Update report with AI summary
      db.prepare(
        `
        UPDATE team_reports SET ai_summary = ?, updated_at = ? WHERE id = ?
      `,
      ).run(summary, now, reportId);

      logger.info(`[TeamReport] Generated AI summary for report ${reportId}`);

      return { success: true, summary };
    } catch (error) {
      logger.error("[TeamReport] Error generating AI summary:", error);
      throw error;
    }
  }

  /**
   * Generate summary using LLM
   */
  async _generateSummary(report) {
    // This would integrate with the LLM service
    // For now, return a placeholder
    const parts = [];

    if (report.yesterday_work) {
      parts.push(`完成工作: ${report.yesterday_work.substring(0, 100)}...`);
    }

    if (report.today_plan) {
      parts.push(`今日计划: ${report.today_plan.substring(0, 100)}...`);
    }

    if (report.blockers) {
      parts.push(`阻塞项: ${report.blockers.substring(0, 50)}...`);
    }

    return parts.join(" | ") || "无摘要";
  }
}

let teamReportManager = null;

function getTeamReportManager(database) {
  if (!teamReportManager && database) {
    teamReportManager = new TeamReportManager(database);
  }
  return teamReportManager;
}

module.exports = {
  TeamReportManager,
  getTeamReportManager,
};
