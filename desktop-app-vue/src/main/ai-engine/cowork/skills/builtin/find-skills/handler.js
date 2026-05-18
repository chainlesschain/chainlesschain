/**
 * Find Skills Handler (v2.0)
 *
 * Discover, recommend, compare skills from the registry.
 * Enhanced: marketplace browsing, compatibility check, skill comparison,
 * popularity tracking, version check, dependency resolution.
 */

const { logger } = require("../../../../../utils/logger.js");

const _deps = { logger };

let skillRegistry = null;

// ── Known Marketplaces ────────────────────────────

const MARKETPLACES = [
  {
    name: "Anthropic Official",
    url: "https://github.com/anthropics/skills",
    type: "github",
    description: "Official Anthropic skills repository",
  },
  {
    name: "SkillsMP",
    url: "https://skillsmp.com",
    type: "web",
    description: "400,000+ agent skills with filtering",
  },
  {
    name: "AgentSkills.to",
    url: "https://agentskills.to",
    type: "web",
    description: "Curated production-ready skills",
  },
  {
    name: "SkillHub",
    url: "https://skillhub.club",
    type: "web",
    description: "7,000+ AI-evaluated skills",
  },
  {
    name: "Claude-Plugins.dev",
    url: "https://claude-plugins.dev/skills",
    type: "web",
    description: "Browse, compare, and install skills",
  },
  {
    name: "Awesome Agent Skills",
    url: "https://github.com/VoltAgent/awesome-agent-skills",
    type: "github",
    description: "Community-curated 500+ skills",
  },
];

// ── Popularity Tracking ───────────────────────────

const popularityStore = new Map();

function trackUsage(skillName) {
  const entry = popularityStore.get(skillName) || {
    usageCount: 0,
    lastUsed: null,
    rating: 0,
    votes: 0,
  };
  entry.usageCount++;
  entry.lastUsed = new Date().toISOString();
  popularityStore.set(skillName, entry);
}

// ── Helpers ───────────────────────────────────────

function getAllSkills() {
  if (!skillRegistry) {
    return [];
  }

  if (typeof skillRegistry.getAllSkills === "function") {
    const skills = skillRegistry.getAllSkills();
    return Array.isArray(skills) ? skills : Object.values(skills || {});
  }

  if (typeof skillRegistry.getAll === "function") {
    return skillRegistry.getAll();
  }

  if (skillRegistry.skills instanceof Map) {
    return Array.from(skillRegistry.skills.values());
  }

  return [];
}

function getSkillMeta(skill) {
  const meta = skill.metadata || skill.meta || skill;
  return {
    name: meta.name || skill.name || "unknown",
    displayName: meta["display-name"] || meta.displayName || meta.name || "",
    description: meta.description || "",
    category: meta.category || "general",
    tags: meta.tags || [],
    capabilities: meta.capabilities || [],
    userInvocable: meta["user-invocable"] !== false,
    version: meta.version || "1.0.0",
    dependencies: meta.dependencies || [],
    author: meta.author || "",
  };
}

// ── Handlers ──────────────────────────────────────

function handleSearch(allSkills, query) {
  const q = query.toLowerCase();
  const scored = allSkills
    .map((skill) => {
      const meta = getSkillMeta(skill);
      let score = 0;

      if (meta.name.includes(q)) {
        score += 10;
      }
      if (meta.description.toLowerCase().includes(q)) {
        score += 5;
      }
      if (meta.tags.some((t) => String(t).toLowerCase().includes(q))) {
        score += 8;
      }
      if (meta.capabilities.some((c) => String(c).toLowerCase().includes(q))) {
        score += 6;
      }
      if (meta.category.toLowerCase().includes(q)) {
        score += 4;
      }

      // Popularity boost
      const pop = popularityStore.get(meta.name);
      if (pop) {
        score += Math.min(3, pop.usageCount * 0.5);
      }

      return { ...meta, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 20);

  return {
    success: true,
    mode: "search",
    query,
    skills: scored,
    skillCount: scored.length,
  };
}

function handleRecommend(allSkills, taskDescription) {
  const words = taskDescription.toLowerCase().split(/\s+/);
  const scored = allSkills
    .map((skill) => {
      const meta = getSkillMeta(skill);
      const haystack = [
        meta.name,
        meta.description,
        ...meta.tags,
        ...meta.capabilities,
      ]
        .join(" ")
        .toLowerCase();

      let score = 0;
      for (const word of words) {
        if (word.length < 3) {
          continue;
        }
        if (haystack.includes(word)) {
          score += 3;
        }
      }

      return { ...meta, score };
    })
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 10);

  return {
    success: true,
    mode: "recommend",
    query: taskDescription,
    skills: scored,
    skillCount: scored.length,
    message:
      scored.length > 0
        ? `Found ${scored.length} recommended skill(s) for your task.`
        : "No matching skills found. Try different keywords.",
  };
}

function handleCategory(allSkills, categoryFilter) {
  const categories = {};
  for (const skill of allSkills) {
    const meta = getSkillMeta(skill);
    const cat = meta.category;
    if (!categories[cat]) {
      categories[cat] = [];
    }
    categories[cat].push({
      name: meta.name,
      displayName: meta.displayName,
      description: meta.description,
    });
  }

  if (categoryFilter) {
    const filtered = categories[categoryFilter.toLowerCase()] || [];
    return {
      success: true,
      mode: "category",
      query: categoryFilter,
      skills: filtered,
      skillCount: filtered.length,
    };
  }

  const summary = Object.entries(categories).map(([cat, skills]) => ({
    category: cat,
    count: skills.length,
    skills: skills.map((s) => s.name),
  }));

  return {
    success: true,
    mode: "category",
    categories: summary,
    totalCategories: summary.length,
    totalSkills: allSkills.length,
  };
}

function handleInfo(allSkills, skillName) {
  const name = skillName.toLowerCase();
  const found = allSkills.find(
    (s) => (getSkillMeta(s).name || "").toLowerCase() === name,
  );

  if (!found) {
    return {
      success: false,
      error: `Skill "${skillName}" not found.`,
      mode: "info",
    };
  }

  const meta = getSkillMeta(found);
  const pop = popularityStore.get(meta.name);

  trackUsage(meta.name);

  return {
    success: true,
    mode: "info",
    skill: {
      ...meta,
      popularity: pop
        ? {
            usageCount: pop.usageCount,
            lastUsed: pop.lastUsed,
            rating: pop.rating,
          }
        : null,
    },
  };
}

// ── New v2.0 Handlers ─────────────────────────────

function handleMarketplace(subcommand) {
  if (subcommand === "list" || !subcommand) {
    return {
      success: true,
      mode: "marketplace",
      subcommand: "list",
      result: { marketplaces: MARKETPLACES, count: MARKETPLACES.length },
      message: `## Known Skill Marketplaces\n\n${MARKETPLACES.map((m, i) => `${i + 1}. **${m.name}** — ${m.description}\n   ${m.url}`).join("\n")}`,
    };
  }

  // Search marketplace by name
  const found = MARKETPLACES.filter((m) =>
    m.name.toLowerCase().includes(subcommand.toLowerCase()),
  );
  return {
    success: true,
    mode: "marketplace",
    subcommand: "search",
    result: { marketplaces: found, count: found.length },
  };
}

function handleCompare(allSkills, skillNames) {
  const names = skillNames.split(",").map((s) => s.trim().toLowerCase());

  if (names.length < 2) {
    return {
      success: false,
      mode: "compare",
      error: "Provide at least 2 skill names separated by commas.",
    };
  }

  const found = [];
  const notFound = [];

  for (const name of names) {
    const skill = allSkills.find(
      (s) => (getSkillMeta(s).name || "").toLowerCase() === name,
    );
    if (skill) {
      found.push(getSkillMeta(skill));
    } else {
      notFound.push(name);
    }
  }

  if (found.length < 2) {
    return {
      success: false,
      mode: "compare",
      error: `Need at least 2 skills found. Not found: ${notFound.join(", ")}`,
    };
  }

  const comparison = {
    skills: found.map((s) => ({
      name: s.name,
      category: s.category,
      description: s.description,
      capabilities: s.capabilities,
      tags: s.tags,
      version: s.version,
      author: s.author,
    })),
    sharedCapabilities: found[0].capabilities.filter((c) =>
      found.every((s) => s.capabilities.includes(c)),
    ),
    sharedTags: found[0].tags.filter((t) =>
      found.every((s) => s.tags.includes(t)),
    ),
    uniqueCapabilities: found.map((s) => ({
      name: s.name,
      unique: s.capabilities.filter(
        (c) =>
          !found.some(
            (other) => other.name !== s.name && other.capabilities.includes(c),
          ),
      ),
    })),
  };

  return {
    success: true,
    mode: "compare",
    result: comparison,
    message: `Compared ${found.length} skill(s).${notFound.length > 0 ? ` Not found: ${notFound.join(", ")}` : ""}`,
  };
}

function handleCompatibility(allSkills, skillName) {
  const name = skillName.toLowerCase();
  const found = allSkills.find(
    (s) => (getSkillMeta(s).name || "").toLowerCase() === name,
  );

  if (!found) {
    return {
      success: false,
      mode: "compatibility",
      error: `Skill "${skillName}" not found.`,
    };
  }

  const meta = getSkillMeta(found);
  const deps = meta.dependencies || [];
  const resolved = [];
  const missing = [];

  for (const dep of deps) {
    const depSkill = allSkills.find(
      (s) => (getSkillMeta(s).name || "").toLowerCase() === dep.toLowerCase(),
    );
    if (depSkill) {
      resolved.push({
        name: dep,
        status: "available",
        version: getSkillMeta(depSkill).version,
      });
    } else {
      missing.push({ name: dep, status: "missing" });
    }
  }

  return {
    success: true,
    mode: "compatibility",
    result: {
      skill: meta.name,
      compatible: missing.length === 0,
      dependencies: {
        total: deps.length,
        resolved: resolved.length,
        missing: missing.length,
      },
      resolvedDeps: resolved,
      missingDeps: missing,
    },
    message:
      missing.length === 0
        ? `Skill "${meta.name}" is fully compatible. All ${deps.length} dependencies resolved.`
        : `Skill "${meta.name}" has ${missing.length} missing dependency(ies): ${missing.map((m) => m.name).join(", ")}`,
  };
}

function handlePopular(allSkills) {
  const entries = Array.from(popularityStore.entries())
    .map(([name, data]) => ({ name, ...data }))
    .sort((a, b) => b.usageCount - a.usageCount)
    .slice(0, 20);

  return {
    success: true,
    mode: "popular",
    result: { skills: entries, total: entries.length },
    message:
      entries.length > 0
        ? `Top ${entries.length} popular skill(s):\n${entries.map((e, i) => `${i + 1}. ${e.name} (${e.usageCount} uses)`).join("\n")}`
        : "No usage data yet. Skills gain popularity when used via `info` or direct invocation.",
  };
}

function handleRate(skillName, rating) {
  if (!skillName) {
    return {
      success: false,
      mode: "rate",
      error: "Skill name required. Usage: rate <skill-name> <1-5>",
    };
  }

  const ratingNum = parseInt(rating, 10);
  if (isNaN(ratingNum) || ratingNum < 1 || ratingNum > 5) {
    return { success: false, mode: "rate", error: "Rating must be 1-5." };
  }

  const entry = popularityStore.get(skillName) || {
    usageCount: 0,
    lastUsed: null,
    rating: 0,
    votes: 0,
  };
  const oldTotal = entry.rating * entry.votes;
  entry.votes++;
  entry.rating = Math.round(((oldTotal + ratingNum) / entry.votes) * 10) / 10;
  popularityStore.set(skillName, entry);

  return {
    success: true,
    mode: "rate",
    result: { skill: skillName, rating: entry.rating, votes: entry.votes },
    message: `Rated "${skillName}": ${entry.rating}/5 (${entry.votes} vote(s))`,
  };
}

// ── Input Parser ──────────────────────────────────

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { mode: "search", query: "" };
  }

  const trimmed = input.trim();
  const modes = [
    "recommend",
    "category",
    "info",
    "search",
    "marketplace",
    "compare",
    "compatibility",
    "popular",
    "rate",
  ];

  for (const mode of modes) {
    if (
      trimmed.toLowerCase().startsWith(mode + " ") ||
      trimmed.toLowerCase() === mode
    ) {
      return { mode, query: trimmed.substring(mode.length).trim() };
    }
  }

  return { mode: "search", query: trimmed };
}

// ── Module Exports ────────────────────────────────

module.exports = {
  _deps,
  _popularityStore: popularityStore,
  _MARKETPLACES: MARKETPLACES,

  async init(skill) {
    try {
      const mod = require("../../skill-registry.js");
      skillRegistry =
        typeof mod.getSkillRegistry === "function"
          ? mod.getSkillRegistry()
          : mod.SkillRegistry
            ? new mod.SkillRegistry()
            : null;
      logger.info("[FindSkills] SkillRegistry loaded (v2.0)");
    } catch (error) {
      logger.warn("[FindSkills] SkillRegistry not available:", error.message);
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { mode, query } = parseInput(input);

    logger.info(`[FindSkills] Mode: ${mode}, Query: "${query}"`);

    try {
      const allSkills = getAllSkills();

      switch (mode) {
        case "recommend":
          if (!query) {
            return { success: false, error: "Task description required." };
          }
          return handleRecommend(allSkills, query);
        case "category":
          return handleCategory(allSkills, query);
        case "info":
          if (!query) {
            return { success: false, error: "Skill name required." };
          }
          return handleInfo(allSkills, query);
        case "marketplace":
          return handleMarketplace(query);
        case "compare":
          if (!query) {
            return {
              success: false,
              error: "Provide skill names to compare (comma-separated).",
            };
          }
          return handleCompare(allSkills, query);
        case "compatibility":
          if (!query) {
            return { success: false, error: "Skill name required." };
          }
          return handleCompatibility(allSkills, query);
        case "popular":
          return handlePopular(allSkills);
        case "rate": {
          const parts = query.split(/\s+/);
          return handleRate(parts[0], parts[1]);
        }
        case "search":
        default:
          if (!query) {
            return {
              success: false,
              error: "No query provided. Usage: /find-skills <keyword>",
            };
          }
          return handleSearch(allSkills, query);
      }
    } catch (error) {
      logger.error("[FindSkills] Error:", error);
      return { success: false, error: error.message, mode, query };
    }
  },
};
