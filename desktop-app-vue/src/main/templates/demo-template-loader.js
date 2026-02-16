/**
 * Demo Template Loader
 *
 * Discovers and loads demo templates from the builtin templates directory.
 * Demo templates showcase AI skills and serve as quick-start examples.
 *
 * @module templates/demo-template-loader
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../utils/logger.js");

/**
 * Demo template categories that contain skill-based templates
 */
const DEMO_CATEGORIES = ["automation", "ai-workflow", "knowledge", "remote"];

/**
 * DemoTemplateLoader class
 */
class DemoTemplateLoader {
  constructor() {
    this.templatesDir = path.join(__dirname);
    this.templates = new Map();
    this.loaded = false;
  }

  /**
   * Load all demo templates from disk
   * @returns {Promise<{loaded: number, errors: Array}>}
   */
  async loadAll() {
    const result = { loaded: 0, errors: [] };

    for (const category of DEMO_CATEGORIES) {
      const categoryPath = path.join(this.templatesDir, category);

      if (!fs.existsSync(categoryPath)) {
        continue;
      }

      try {
        const files = await fs.promises.readdir(categoryPath);

        for (const file of files) {
          if (!file.endsWith(".json")) {
            continue;
          }

          try {
            const filePath = path.join(categoryPath, file);
            const content = await fs.promises.readFile(filePath, "utf-8");
            const template = JSON.parse(content);

            // Validate required fields
            if (!template.id || !template.name || !template.display_name) {
              throw new Error(`Missing required fields in ${category}/${file}`);
            }

            // Ensure it's marked as builtin
            template.is_builtin = true;
            template.category = template.category || category;

            this.templates.set(template.id, template);
            result.loaded++;
          } catch (error) {
            logger.error(
              `[DemoTemplateLoader] Failed to load ${category}/${file}:`,
              error.message,
            );
            result.errors.push({
              file: `${category}/${file}`,
              error: error.message,
            });
          }
        }
      } catch (error) {
        if (error.code !== "ENOENT") {
          logger.error(
            `[DemoTemplateLoader] Failed to read ${category}/:`,
            error.message,
          );
          result.errors.push({ category, error: error.message });
        }
      }
    }

    this.loaded = true;
    logger.info(
      `[DemoTemplateLoader] Loaded ${result.loaded} demo templates, ${result.errors.length} errors`,
    );

    return result;
  }

  /**
   * Get all demo templates
   * @returns {Array<object>}
   */
  getAllDemoTemplates() {
    return Array.from(this.templates.values());
  }

  /**
   * Get demo templates grouped by category
   * @returns {object} { category: [templates] }
   */
  getDemosByCategory() {
    const grouped = {};

    for (const template of this.templates.values()) {
      const category = template.category || "other";
      if (!grouped[category]) {
        grouped[category] = [];
      }
      grouped[category].push(template);
    }

    return grouped;
  }

  /**
   * Get demo templates that use a specific skill
   * @param {string} skillName - Skill name
   * @returns {Array<object>}
   */
  getDemosBySkill(skillName) {
    return Array.from(this.templates.values()).filter(
      (t) => Array.isArray(t.skills_used) && t.skills_used.includes(skillName),
    );
  }

  /**
   * Get a demo template by ID
   * @param {string} templateId - Template ID
   * @returns {object|null}
   */
  getDemoById(templateId) {
    return this.templates.get(templateId) || null;
  }

  /**
   * Get demo templates by difficulty
   * @param {string} difficulty - beginner, intermediate, advanced
   * @returns {Array<object>}
   */
  getDemosByDifficulty(difficulty) {
    return Array.from(this.templates.values()).filter(
      (t) => t.difficulty === difficulty,
    );
  }

  /**
   * Get summary of all demo templates
   * @returns {object}
   */
  getSummary() {
    const templates = this.getAllDemoTemplates();
    const categories = {};
    const skills = {};
    const difficulties = {};

    for (const t of templates) {
      // Count by category
      categories[t.category] = (categories[t.category] || 0) + 1;

      // Count by difficulty
      if (t.difficulty) {
        difficulties[t.difficulty] = (difficulties[t.difficulty] || 0) + 1;
      }

      // Count skill usage
      if (Array.isArray(t.skills_used)) {
        for (const skill of t.skills_used) {
          skills[skill] = (skills[skill] || 0) + 1;
        }
      }
    }

    return {
      total: templates.length,
      byCategory: categories,
      byDifficulty: difficulties,
      skillUsage: skills,
    };
  }

  /**
   * Register all demo templates with a ProjectTemplateManager
   * @param {object} templateManager - The ProjectTemplateManager instance
   * @returns {Promise<number>} Number of templates registered
   */
  async registerWithTemplateManager(templateManager) {
    if (!this.loaded) {
      await this.loadAll();
    }

    let registered = 0;

    for (const template of this.templates.values()) {
      try {
        await templateManager.saveTemplate(template);
        registered++;
      } catch (error) {
        logger.error(
          `[DemoTemplateLoader] Failed to register ${template.id}:`,
          error.message,
        );
      }
    }

    logger.info(
      `[DemoTemplateLoader] Registered ${registered} demo templates with TemplateManager`,
    );

    return registered;
  }
}

// Singleton
let instance = null;

function getDemoTemplateLoader() {
  if (!instance) {
    instance = new DemoTemplateLoader();
  }
  return instance;
}

module.exports = {
  DemoTemplateLoader,
  getDemoTemplateLoader,
  DEMO_CATEGORIES,
};
