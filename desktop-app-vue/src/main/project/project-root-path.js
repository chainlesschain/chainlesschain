"use strict";

const path = require("node:path");
const fs = require("node:fs");

const SAFE_PROJECT_DIRECTORY_SEGMENT =
  /^[A-Za-z0-9](?:[A-Za-z0-9_-]{0,126}[A-Za-z0-9])?$/;

function projectPathError(code, message) {
  const error = new Error(message);
  error.code = code;
  error.projectRootBindingFailClosed = true;
  return error;
}

function projectCreationError(code, message) {
  const error = projectPathError(code, message);
  error.projectCreationFailClosed = true;
  return error;
}

function isContainedPath(rootPath, candidatePath, { allowRoot = false } = {}) {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedCandidate = path.resolve(candidatePath);
  const relative = path.relative(resolvedRoot, resolvedCandidate);
  if (relative === "") {
    return allowRoot;
  }
  return (
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

/**
 * Resolve a main-process managed project directory from an untrusted ID.
 * IDs are deliberately restricted to one portable filesystem segment.
 */
function resolveManagedProjectRoot(projectsRoot, projectId) {
  if (typeof projectsRoot !== "string" || projectsRoot.trim() === "") {
    throw projectPathError(
      "ERR_PROJECTS_ROOT_INVALID",
      "projects_root_invalid",
    );
  }
  if (
    typeof projectId !== "string" ||
    !SAFE_PROJECT_DIRECTORY_SEGMENT.test(projectId) ||
    projectId.includes("\0")
  ) {
    throw projectPathError(
      "ERR_PROJECT_ROOT_ID_INVALID",
      "project_root_id_invalid",
    );
  }

  const resolvedRoot = path.resolve(projectsRoot);
  const candidate = path.resolve(resolvedRoot, projectId);
  if (!isContainedPath(resolvedRoot, candidate)) {
    throw projectPathError(
      "ERR_PROJECT_ROOT_OUTSIDE_MANAGED_ROOT",
      "project_root_outside_managed_root",
    );
  }
  return candidate;
}

/**
 * Fail closed before a create-new flow can replace an existing local row.
 */
function assertNewProjectIdAvailable(database, projectId) {
  let existingProject;
  if (typeof database?.db?.prepare === "function") {
    existingProject = database.db
      .prepare("SELECT id FROM projects WHERE id = ? COLLATE NOCASE LIMIT 1")
      .get(projectId);
  } else if (typeof database?.getProjectById === "function") {
    existingProject = database.getProjectById(projectId);
  } else {
    throw projectCreationError(
      "ERR_PROJECT_ID_CHECK_UNAVAILABLE",
      "project_id_check_unavailable",
    );
  }

  if (existingProject) {
    throw projectCreationError(
      "ERR_PROJECT_ID_COLLISION",
      "project_id_collision",
    );
  }
}

function getProjectDatabaseConnection(database) {
  if (typeof database?.db?.prepare === "function") {
    return database.db;
  }
  throw projectCreationError(
    "ERR_PROJECT_ID_CHECK_UNAVAILABLE",
    "project_id_check_unavailable",
  );
}

function portableCanonicalPath(candidatePath) {
  return path
    .resolve(candidatePath)
    .replace(/[\\/]+$/, "")
    .toLowerCase();
}

/**
 * Existing marker-0 projects may acquire a local root only when their ID has
 * no portable case alias and no other attested project owns the canonical
 * managed destination.
 */
function assertExistingProjectRootOwnershipAvailable(
  database,
  projectsRoot,
  projectId,
) {
  const projectRoot = resolveManagedProjectRoot(projectsRoot, projectId);
  const connection = getProjectDatabaseConnection(database);
  const currentProject = connection
    .prepare("SELECT id FROM projects WHERE id = ? LIMIT 1")
    .get(projectId);
  if (!currentProject) {
    throw projectCreationError("ERR_PROJECT_NOT_FOUND", "project_not_found");
  }

  const caseAlias = connection
    .prepare(
      "SELECT id FROM projects WHERE id = ? COLLATE NOCASE AND id <> ? LIMIT 1",
    )
    .get(projectId, projectId);
  if (caseAlias) {
    throw projectCreationError(
      "ERR_PROJECT_ID_COLLISION",
      "project_id_collision",
    );
  }

  const canonicalProjectRoot = portableCanonicalPath(projectRoot);
  const attestedRoots = connection
    .prepare(
      `SELECT id, root_path FROM projects
       WHERE root_path_local_attested = 1
         AND root_path IS NOT NULL
         AND root_path != ''`,
    )
    .all();
  for (const owner of attestedRoots) {
    if (
      owner.id !== projectId &&
      portableCanonicalPath(owner.root_path) === canonicalProjectRoot
    ) {
      throw projectCreationError(
        "ERR_PROJECT_ROOT_OWNERSHIP_COLLISION",
        "project_root_ownership_collision",
      );
    }
  }

  return projectRoot;
}

/**
 * Create only the managed project leaf exclusively. The managed parent may be
 * created recursively, but an existing leaf (including a case-insensitive
 * alias on Windows) is never reused or attested by a create-new flow.
 */
async function createManagedProjectRootExclusive(projectsRoot, projectId) {
  const resolvedProjectsRoot = path.resolve(projectsRoot);
  const projectRoot = resolveManagedProjectRoot(
    resolvedProjectsRoot,
    projectId,
  );
  await fs.promises.mkdir(resolvedProjectsRoot, { recursive: true });
  try {
    await fs.promises.mkdir(projectRoot);
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw projectCreationError(
        "ERR_PROJECT_ROOT_COLLISION",
        "project_root_collision",
      );
    }
    throw error;
  }
  return projectRoot;
}

async function createManagedRootForExistingProjectExclusive(
  database,
  projectsRoot,
  projectId,
) {
  assertExistingProjectRootOwnershipAvailable(
    database,
    projectsRoot,
    projectId,
  );
  return createManagedProjectRootExclusive(projectsRoot, projectId);
}

/**
 * Revalidate a previously resolved managed directory immediately before a
 * destructive rollback operation.
 */
function assertManagedProjectRoot(projectsRoot, candidatePath) {
  if (
    typeof projectsRoot !== "string" ||
    typeof candidatePath !== "string" ||
    !isContainedPath(projectsRoot, candidatePath)
  ) {
    throw projectPathError(
      "ERR_PROJECT_ROOT_OUTSIDE_MANAGED_ROOT",
      "project_root_outside_managed_root",
    );
  }
  return path.resolve(candidatePath);
}

/**
 * Resolve backend/DB/renderer file metadata underneath an already-attested
 * project root. Absolute paths, NULs, the root itself, and traversal escape
 * are rejected.
 */
function resolveProjectChildPath(projectRoot, relativePath) {
  const pathSegments =
    typeof relativePath === "string" ? relativePath.split(/[\\/]+/) : [];
  if (
    typeof projectRoot !== "string" ||
    projectRoot.trim() === "" ||
    typeof relativePath !== "string" ||
    relativePath.trim() === "" ||
    relativePath.includes("\0") ||
    path.isAbsolute(relativePath) ||
    path.posix.isAbsolute(relativePath) ||
    path.win32.isAbsolute(relativePath) ||
    /^[A-Za-z]:/.test(relativePath) ||
    pathSegments.includes("..")
  ) {
    throw projectPathError(
      "ERR_PROJECT_CHILD_PATH_INVALID",
      "project_child_path_invalid",
    );
  }

  const resolvedRoot = path.resolve(projectRoot);
  const candidate = path.resolve(resolvedRoot, relativePath);
  if (!isContainedPath(resolvedRoot, candidate)) {
    throw projectPathError(
      "ERR_PROJECT_CHILD_PATH_OUTSIDE_ROOT",
      "project_child_path_outside_root",
    );
  }
  return candidate;
}

module.exports = {
  assertManagedProjectRoot,
  assertExistingProjectRootOwnershipAvailable,
  assertNewProjectIdAvailable,
  createManagedProjectRootExclusive,
  createManagedRootForExistingProjectExclusive,
  isContainedPath,
  resolveManagedProjectRoot,
  resolveProjectChildPath,
};
