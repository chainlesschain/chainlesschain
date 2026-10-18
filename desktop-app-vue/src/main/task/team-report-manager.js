/**
 * Team Report Manager
 *
 * Manages team reports including daily standups, weekly reports, and AI summaries.
 *
 * @module task/team-report-manager
 */

const { logger } = require("../utils/logger.js");
const { randomUUID: uuidv4 } = require("node:crypto");

class TeamReportManager {
  constructor(database) {
    this.database = database;
  }

  /**
   * Create a team report
   */
  async createReport(reportData) {
    return this.createReportSync(reportData);
  }

  createReportSync(reportData) {
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
    return this.getReportsSync(orgId, options);
  }

  getReportsSync(orgId, options = {}) {
    try {
      if (
        !options ||
        typeof options !== "object" ||
        Array.isArray(options) ||
        (options.limit != null &&
          (!Number.isSafeInteger(options.limit) ||
            options.limit < 1 ||
            options.limit > 100))
      )
        throw Object.assign(new Error("BOARD_READ_INVALID_REQUEST"), {
          code: "BOARD_READ_INVALID_REQUEST",
        });
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
      } else {
        query += ` LIMIT 100`;
      }

      const {
        validScope,
        currentSummary,
      } = require("./board-report-summary-store");
      const reports = db
        .prepare(query)
        .all(...params)
        .filter((r) => validScope(db, r));

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
          aiSummary: currentSummary(db, r),
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
    throw Object.assign(new Error("BOARD_SUMMARY_NATIVE_HOST_REQUIRED"), {
      code: "BOARD_SUMMARY_NATIVE_HOST_REQUIRED",
    });
  }

  /**
   * Generate summary using LLM
   */
  async _generateSummary(report) {
    throw Object.assign(new Error("BOARD_SUMMARY_NATIVE_HOST_REQUIRED"), {
      code: "BOARD_SUMMARY_NATIVE_HOST_REQUIRED",
    });
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
