/**
 * Find Skills Handler
 *
 * Discover and recommend skills from the registry.
 */

const { logger } = require("../../../../../utils/logger.js");

let skillRegistry = null;

module.exports = {
  async init(skill) {
    try {
      const mod = require("../../skill-registry.js");
      skillRegistry =
        typeof mod.getSkillRegistry === "function"
          ? mod.getSkillRegistry()
          : mod.SkillRegistry
            ? new mod.SkillRegistry()
            : null;
      logger.info("[FindSkills] SkillRegistry loaded");
    } catch (error) {
      logger.warn("[FindSkills] SkillRegistry not available:", error.message);
    }
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { mode, query } = parseInput(input);

    logger.info(`[FindSkills] Mode: ${mode}, Query: "${query}"`);

    if (!query && mode !== "category") {
      return {
        success: false,
        error: "No query provided. Usage: /find-skills <keyword>",
      };
    }

    try {
      const allSkills = getAllSkills();

      switch (mode) {
        case "recommend":
          return handleRecommend(allSkills, query);
        case "category":
          return handleCategory(allSkills, query);
        case "info":
          return handleInfo(allSkills, query);
        case "search":
        default:
          return handleSearch(allSkills, query);
      }
    } catch (error) {
      logger.error("[FindSkills] Error:", error);
      return { success: false, error: error.message, mode, query };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { mode: "search", query: "" };
  }

  const trimmed = input.trim();
  const modes = ["recommend", "category", "info", "search"];

  for (const mode of modes) {
    if (trimmed.toLowerCase().startsWith(mode + " ")) {
      return { mode, query: trimmed.substring(mode.length + 1).trim() };
    }
  }

  return { mode: "search", query: trimmed };
}

function getAllSkills() {
  if (!skillRegistry) return [];

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
  };
}

function handleSearch(allSkills, query) {
  const q = query.toLowerCase();
  const scored = allSkills
    .map((skill) => {
      const meta = getSkillMeta(skill);
      let score = 0;

      if (meta.name.includes(q)) score += 10;
      if (meta.description.toLowerCase().includes(q)) score += 5;
      if (meta.tags.some((t) => String(t).toLowerCase().includes(q)))
        score += 8;
      if (
        meta.capabilities.some((c) => String(c).toLowerCase().includes(q))
      )
        score += 6;
      if (meta.category.toLowerCase().includes(q)) score += 4;

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
        if (word.length < 3) continue;
        if (haystack.includes(word)) score += 3;
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
    if (!categories[cat]) categories[cat] = [];
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
  return {
    success: true,
    mode: "info",
    skill: meta,
  };
}
