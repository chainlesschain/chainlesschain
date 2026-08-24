const fs = require("node:fs");
const path = require("node:path");

function pathIsWithin(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

function resolveContainedProjectPath(projectsRoot, requestedPath) {
  if (typeof requestedPath !== "string" || requestedPath.length === 0) {
    throw new TypeError("Project path is required");
  }
  const root = path.resolve(projectsRoot);
  const virtualPrefix = "/data/projects/";
  const target = requestedPath.startsWith(virtualPrefix)
    ? path.resolve(root, requestedPath.slice(virtualPrefix.length))
    : path.isAbsolute(requestedPath)
      ? path.resolve(requestedPath)
      : path.resolve(root, requestedPath);
  if (!pathIsWithin(root, target)) {
    throw new Error("Project path resolves outside the projects root");
  }

  let canonicalRoot;
  try {
    canonicalRoot = fs.realpathSync(root);
  } catch (error) {
    const unavailable = new Error(
      `Projects root cannot be verified: ${error.message}`,
    );
    unavailable.code = "PROJECT_ROOT_UNAVAILABLE";
    throw unavailable;
  }

  let ancestor = target;
  while (!fs.existsSync(ancestor)) {
    const parent = path.dirname(ancestor);
    if (parent === ancestor) break;
    ancestor = parent;
  }
  const canonicalAncestor = fs.realpathSync(ancestor);
  if (!pathIsWithin(canonicalRoot, canonicalAncestor)) {
    throw new Error("Project path escapes the projects root through a symlink");
  }
  return target;
}

module.exports = { pathIsWithin, resolveContainedProjectPath };
