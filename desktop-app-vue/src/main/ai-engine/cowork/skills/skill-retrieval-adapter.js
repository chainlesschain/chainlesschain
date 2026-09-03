const ROUTER_REL =
  "../../../../../../packages/cli/src/lib/skill-retrieval-router.js";
const DIGEST = /^sha256:[a-f0-9]{64}$/u;
const MAX_FILTER_VALUES = 64;
const MAX_FILTER_VALUE_LENGTH = 128;

async function defaultLoadRouter() {
  return import(ROUTER_REL);
}

function descriptorFor(skill) {
  const info = skill?.getInfo?.();
  const contentDigest = info?.executionSecurity?.contentDigest;
  if (!DIGEST.test(contentDigest || "")) return null;
  return {
    id: info.skillId,
    displayName: info.name,
    description: info.description || "",
    category: info.category || "uncategorized",
    tags: Array.isArray(info.tags) ? info.tags : [],
    source: info.source || "unknown",
    version: info.version || "1.0.0",
    os: Array.isArray(info.os) ? info.os : [],
    capabilities: Array.isArray(info.executionCapabilities)
      ? info.executionCapabilities
      : [],
    executionIdentity: { contentDigest },
  };
}

function boundedString(value, label, { nullable = false } = {}) {
  if (nullable && (value === null || value === undefined)) return null;
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > MAX_FILTER_VALUE_LENGTH
  ) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return value;
}

function boundedStringList(value, label) {
  if (!Array.isArray(value) || value.length > MAX_FILTER_VALUES) {
    throw new TypeError(`${label} is invalid or unbounded`);
  }
  return value.map((entry) => boundedString(entry, label));
}

async function routeDesktopSkills({
  skills,
  query,
  filters = {},
  hostTarget = {},
  loadRouter = defaultLoadRouter,
} = {}) {
  if (!Array.isArray(skills) || typeof query !== "string") {
    throw new TypeError("Desktop Skill retrieval request is invalid");
  }
  if (
    !filters ||
    typeof filters !== "object" ||
    Array.isArray(filters) ||
    !Number.isSafeInteger(filters.topK ?? 20) ||
    (filters.topK ?? 20) < 1 ||
    (filters.topK ?? 20) > 64
  ) {
    throw new TypeError(
      "Desktop Skill retrieval filters are invalid or unbounded",
    );
  }
  if (
    !hostTarget ||
    typeof hostTarget !== "object" ||
    Array.isArray(hostTarget)
  ) {
    throw new TypeError("Desktop Skill retrieval host target is invalid");
  }
  const namespace = boundedString(filters.namespace, "Skill namespace", {
    nullable: true,
  });
  const tags = boundedStringList(filters.tags ?? [], "Skill tags");
  const target = {
    os: boundedString(hostTarget.os || process.platform, "Host target OS"),
    ...(Array.isArray(hostTarget.allowedCapabilities)
      ? {
          allowedCapabilities: boundedStringList(
            hostTarget.allowedCapabilities,
            "Host target capabilities",
          ),
        }
      : {}),
  };
  const descriptors = skills.map(descriptorFor).filter(Boolean);
  const router = await loadRouter();
  if (typeof router?.routeSkillDescriptors !== "function") {
    throw new Error("Canonical Skill retrieval router is unavailable");
  }
  return router.routeSkillDescriptors({
    skills: descriptors,
    query,
    namespace,
    tags,
    topK: filters.topK ?? 20,
    target,
  });
}

module.exports = { descriptorFor, routeDesktopSkills };
