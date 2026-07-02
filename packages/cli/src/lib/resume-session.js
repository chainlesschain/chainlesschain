/**
 * Session resume utilities (ESM)
 * Mirrors Claude Code /resume behavior
 * @module lib/resume-session
 */

import fs from "fs";
import path from "path";
import os from "os";
import { logger } from "./logger.js";

const SESSION_DIR = path.join(os.homedir(), ".chainlesschain", "sessions");

/**
 * List recent chat sessions
 * @param {number} limit Maximum sessions to return
 * @returns {Array<Object>} list of sessions
 */
export function listSessions(limit = 10) {
  try {
    if (!fs.existsSync(SESSION_DIR)) {
      return [];
    }

    const files = fs
      .readdirSync(SESSION_DIR)
      .filter((f) => f.endsWith(".json"))
      .map((f) => {
        const filePath = path.join(SESSION_DIR, f);
        const stat = fs.statSync(filePath);
        let summary = "";
        try {
          const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
          summary = data.summary || data.title || f.replace(".json", "");
        } catch {
          summary = f.replace(".json", "");
        }
        return {
          id: f.replace(".json", ""),
          file: filePath,
          mtime: stat.mtimeMs,
          summary,
        };
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit);

    return files;
  } catch (err) {
    logger.debug(`Error listing sessions: ${err.message}`);
    return [];
  }
}

/**
 * Load a session by ID
 * @param {string} sessionId
 * @returns {Object|null} session data
 */
export function loadSession(sessionId) {
  try {
    const filePath = path.join(SESSION_DIR, `${sessionId}.json`);
    if (!fs.existsSync(filePath)) {
      return null;
    }
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (err) {
    logger.error(`Error loading session ${sessionId}: ${err.message}`);
    return null;
  }
}

/**
 * Get the most recent session
 * @returns {Object|null}
 */
export function getLatestSession() {
  const sessions = listSessions(1);
  return sessions.length > 0 ? loadSession(sessions[0].id) : null;
}

/**
 * Resume a chat session
 * @param {string} [sessionId] Optional session ID (resumes latest if not provided)
 * @returns {Promise<Object>} resume result
 */
export async function resumeSession(sessionId) {
  let session;
  if (sessionId) {
    session = loadSession(sessionId);
    if (!session) {
      return { success: false, message: `Session ${sessionId} not found` };
    }
  } else {
    session = getLatestSession();
    if (!session) {
      return { success: false, message: "No previous sessions found" };
    }
  }

  return {
    success: true,
    sessionId: session.id || sessionId,
    messageCount: session.messages?.length || 0,
    summary: session.summary,
    session,
    message: "Session loaded. Continue chatting to resume the conversation.",
  };
}

export default { listSessions, loadSession, getLatestSession, resumeSession };
