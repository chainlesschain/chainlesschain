/**
 * Session hooks stub
 */
export function getHookDb() {
  return null;
}

export async function fireSetup(db, context) {
  return { abort: false };
}

/**
 * Fire assistant response hook
 * @param {object} db - Database instance
 * @param {object} context - Hook context
 * @returns {Promise<{abort: boolean}>}
 */
export async function fireAssistantResponse(db, context) {
  return { abort: false };
}
