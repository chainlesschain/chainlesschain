/**
 * Resolve Desktop terminal project selectors against the main-process
 * database. Renderer / WS / mobile callers may select a project by id, but
 * they never supply a workspace/policy root: the initial canonical root comes
 * from the selected database record's local `root_path`.
 *
 * Older Android clients only send `cwd=pcRootPath`. That value is accepted as
 * a migration selector only when it canonically equals exactly one active
 * database selector path. It is never promoted to the executable root:
 * synchronized `pc_root_path` lacks a local approval/provenance marker.
 */

const fs = require("node:fs");
const path = require("node:path");

function canonicalDirectory(candidate) {
  if (typeof candidate !== "string" || candidate.trim() === "") {
    return null;
  }
  try {
    const resolved = fs.realpathSync.native(path.resolve(candidate));
    return fs.statSync(resolved).isDirectory() ? resolved : null;
  } catch {
    return null;
  }
}

function listActiveProjects(database) {
  if (!database?.db || typeof database.db.prepare !== "function") {
    return [];
  }
  try {
    // Desktop migrations add pc_root_path/source_peer_id before the main
    // window and terminal manager are initialized.
    return database.db
      .prepare(
        `SELECT id, root_path, root_path_local_attested, pc_root_path, source_peer_id, deleted
         FROM projects
         WHERE deleted = 0
           AND (pc_root_path IS NOT NULL OR root_path IS NOT NULL)`,
      )
      .all();
  } catch (cause) {
    const error = new Error("terminal_project_lookup_failed");
    error.code = "ERR_PTY_PROJECT_AUTHORITY_UNAVAILABLE";
    error.projectBindingFailClosed = true;
    error.cause = cause;
    throw error;
  }
}

function projectSelectorPaths(project) {
  return [
    project.root_path,
    project.rootPath,
    // Compatibility lookup only. PtyManager separately accepts only
    // root_path/rootPath as the initial execution root.
    project.pc_root_path,
    project.pcRootPath,
  ];
}

function createDatabaseProjectBindingResolver({ getDatabase }) {
  if (typeof getDatabase !== "function") {
    throw new TypeError("getDatabase must be a function");
  }

  return function resolveDatabaseProjectBinding({ projectId, legacyCwd } = {}) {
    const database = getDatabase();
    if (!database) {
      const error = new Error("terminal_project_database_unavailable");
      error.code = "ERR_PTY_PROJECT_AUTHORITY_UNAVAILABLE";
      error.projectBindingFailClosed = true;
      throw error;
    }

    if (typeof projectId === "string" && projectId.trim() !== "") {
      if (typeof database.getProjectById !== "function") {
        const error = new Error("terminal_project_lookup_unavailable");
        error.code = "ERR_PTY_PROJECT_AUTHORITY_UNAVAILABLE";
        error.projectBindingFailClosed = true;
        throw error;
      }
      return database.getProjectById(projectId.trim());
    }

    // Compatibility bridge for Android releases that predate projectId on
    // terminal.create. The caller path is only a lookup key. A canonical,
    // unique database match supplies the actual record/root.
    const canonicalLegacyCwd = canonicalDirectory(legacyCwd);
    if (!canonicalLegacyCwd) {
      return null;
    }
    const matches = listActiveProjects(database).filter((project) =>
      projectSelectorPaths(project).some(
        (candidate) => canonicalDirectory(candidate) === canonicalLegacyCwd,
      ),
    );
    return matches.length === 1 ? matches[0] : null;
  };
}

module.exports = {
  createDatabaseProjectBindingResolver,
  _canonicalDirectory: canonicalDirectory,
};
