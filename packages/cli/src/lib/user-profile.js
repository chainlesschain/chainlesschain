/**
 * User Profile — persistent USER.md for AI-curated user preferences.
 *
 * Stores user preferences, coding style, communication style, and tech stack
 * in a global USER.md file. AI-curated with character limit and automatic
 * consolidation.
 *
 * Inspired by Hermes Agent's USER.md user profile system.
 *
 * @module user-profile
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { getHomeDir } from "./paths.js";

// ─── Constants ──────────────────────────────────────────────────────────────

const USER_PROFILE_FILENAME = "USER.md";
const MAX_PROFILE_LENGTH = 2000; // characters

// ─── Exported for test injection ────────────────────────────────────────────

export const _deps = {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
};

// ─── Path ───────────────────────────────────────────────────────────────────

/**
 * Get the USER.md file path.
 * @returns {string}
 */
export function getUserProfilePath() {
  return join(getHomeDir(), USER_PROFILE_FILENAME);
}

// ─── Read ───────────────────────────────────────────────────────────────────

/**
 * Read the user profile content.
 * @returns {string} Profile content, or empty string if not found
 */
export function readUserProfile() {
  const profilePath = getUserProfilePath();
  try {
    if (_deps.existsSync(profilePath)) {
      return _deps.readFileSync(profilePath, "utf-8");
    }
  } catch (_err) {
    // Graceful degradation
  }
  return "";
}

// ─── Write ──────────────────────────────────────────────────────────────────

/**
 * Update the user profile with new content.
 * Enforces MAX_PROFILE_LENGTH character limit.
 *
 * @param {string} content - New profile content
 * @returns {{ written: boolean, truncated: boolean, length: number }}
 */
export function updateUserProfile(content) {
  if (!content || typeof content !== "string") {
    return { written: false, truncated: false, length: 0 };
  }

  const profilePath = getUserProfilePath();
  const dir = dirname(profilePath);

  try {
    if (!_deps.existsSync(dir)) {
      _deps.mkdirSync(dir, { recursive: true });
    }

    let truncated = false;
    let finalContent = content.trim();
    if (finalContent.length > MAX_PROFILE_LENGTH) {
      finalContent = finalContent.substring(0, MAX_PROFILE_LENGTH);
      truncated = true;
    }

    _deps.writeFileSync(profilePath, finalContent, "utf-8");
    return { written: true, truncated, length: finalContent.length };
  } catch (_err) {
    return { written: false, truncated: false, length: 0 };
  }
}

// ─── Append ─────────────────────────────────────────────────────────────────

/**
 * Append a line to the user profile.
 * If the profile would exceed MAX_PROFILE_LENGTH, returns needsConsolidation: true.
 *
 * @param {string} line - Line to append
 * @returns {{ appended: boolean, needsConsolidation: boolean, length: number }}
 */
export function appendToUserProfile(line) {
  if (!line || typeof line !== "string") {
    return { appended: false, needsConsolidation: false, length: 0 };
  }

  const current = readUserProfile();
  const newContent = current ? `${current}\n${line.trim()}` : line.trim();

  if (newContent.length > MAX_PROFILE_LENGTH) {
    return {
      appended: false,
      needsConsolidation: true,
      length: current.length,
    };
  }

  const result = updateUserProfile(newContent);
  return {
    appended: result.written,
    needsConsolidation: false,
    length: result.length,
  };
}

// ─── Consolidation ──────────────────────────────────────────────────────────

/**
 * Consolidate the user profile using an LLM to stay within character limits.
 * The LLM merges and summarizes the profile, preserving key preferences.
 *
 * @param {function} llmFn - async (prompt) => string — LLM call function
 * @returns {Promise<{ consolidated: boolean, oldLength: number, newLength: number }>}
 */
export async function consolidateUserProfile(llmFn) {
  const current = readUserProfile();
  if (!current || current.length <= MAX_PROFILE_LENGTH) {
    return {
      consolidated: false,
      oldLength: current.length,
      newLength: current.length,
    };
  }

  const prompt = `You are consolidating a user profile for an AI assistant. Merge and summarize the following user preferences into a concise profile under ${MAX_PROFILE_LENGTH} characters. Preserve the most important preferences, coding style, and tech stack information. Return ONLY the consolidated profile text, no explanations.\n\n---\n${current}\n---`;

  try {
    const consolidated = await llmFn(prompt);
    if (consolidated && typeof consolidated === "string") {
      const result = updateUserProfile(consolidated);
      return {
        consolidated: true,
        oldLength: current.length,
        newLength: result.length,
      };
    }
  } catch (_err) {
    // Consolidation is optional; failure is non-critical
  }

  return {
    consolidated: false,
    oldLength: current.length,
    newLength: current.length,
  };
}

// ─── Exports ────────────────────────────────────────────────────────────────

export const MAX_USER_PROFILE_LENGTH = MAX_PROFILE_LENGTH;
