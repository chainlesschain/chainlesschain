/**
 * CLI SlotFiller — parameter slot filling for agentic workflows
 *
 * Ported from desktop-app-vue/src/main/ai-engine/slot-filler.js
 * Adapted for CLI with InteractionAdapter support for terminal and WebSocket modes.
 *
 * Flow: detect missing slots → infer from context → ask user → LLM inference (optional) → validate
 */

import { EventEmitter } from "events";

/**
 * Required slots per intent type — must be filled before execution.
 */
const REQUIRED_SLOTS = {
  create_file: ["fileType", "path"],
  edit_file: ["target"],
  deploy: ["platform"],
  refactor: ["scope"],
  test: ["target"],
  analyze: ["target"],
  search: ["query"],
  install: ["package"],
  generate: ["type"],
};

/**
 * Optional slots per intent type — filled opportunistically.
 */
const OPTIONAL_SLOTS = {
  create_file: ["template", "content", "overwrite"],
  edit_file: ["action", "position"],
  deploy: ["env", "branch", "dryRun"],
  refactor: ["strategy", "dryRun"],
  test: ["framework", "coverage", "watch"],
  analyze: ["outputFormat", "depth"],
  search: ["directory", "fileType"],
  install: ["version", "dev"],
  generate: ["output", "template"],
};

/**
 * Slot prompts — question text, type, and options for user interaction.
 */
const SLOT_PROMPTS = {
  fileType: {
    question: "What type of file do you want to create?",
    type: "select",
    options: [
      { name: "JavaScript", value: "js" },
      { name: "TypeScript", value: "ts" },
      { name: "Python", value: "py" },
      { name: "JSON", value: "json" },
      { name: "Markdown", value: "md" },
      { name: "Other", value: "other" },
    ],
  },
  path: {
    question: "Where should the file be created? (path)",
    type: "input",
  },
  target: {
    question: "Which file or directory should be targeted?",
    type: "input",
  },
  platform: {
    question: "Which platform are you deploying to?",
    type: "select",
    options: [
      { name: "Docker", value: "docker" },
      { name: "Vercel", value: "vercel" },
      { name: "AWS", value: "aws" },
      { name: "Local", value: "local" },
    ],
  },
  scope: {
    question: "What is the scope of the refactoring?",
    type: "select",
    options: [
      { name: "Single file", value: "file" },
      { name: "Directory", value: "directory" },
      { name: "Module", value: "module" },
      { name: "Full project", value: "project" },
    ],
  },
  type: {
    question: "What do you want to generate?",
    type: "select",
    options: [
      { name: "Component", value: "component" },
      { name: "Test", value: "test" },
      { name: "API endpoint", value: "api" },
      { name: "Config file", value: "config" },
    ],
  },
  query: {
    question: "What are you searching for?",
    type: "input",
  },
  package: {
    question: "Which package do you want to install?",
    type: "input",
  },
  framework: {
    question: "Which test framework?",
    type: "select",
    options: [
      { name: "Vitest", value: "vitest" },
      { name: "Jest", value: "jest" },
      { name: "Mocha", value: "mocha" },
    ],
  },
};

/**
 * File extension → fileType mapping
 */
const EXT_TO_FILE_TYPE = {
  ".js": "js",
  ".mjs": "js",
  ".cjs": "js",
  ".ts": "ts",
  ".tsx": "ts",
  ".py": "py",
  ".json": "json",
  ".md": "md",
  ".html": "html",
  ".css": "css",
  ".vue": "vue",
  ".yaml": "yaml",
  ".yml": "yaml",
};

export class CLISlotFiller extends EventEmitter {
  /**
   * @param {object} options
   * @param {function} [options.llmChat] - LLM chat function for inference
   * @param {object} [options.db] - Database for history
   * @param {import("./interaction-adapter.js").InteractionAdapter} options.interaction
   */
  constructor({ llmChat, db, interaction }) {
    super();
    this.llmChat = llmChat || null;
    this.db = db || null;
    this.interaction = interaction;
  }

  /**
   * Main flow: detect missing required slots → infer → ask user → validate.
   *
   * @param {{ type: string, entities: object }} intent - parsed intent
   * @param {object} context - project context (cwd, files, etc.)
   * @returns {Promise<{ entities: object, validation: object, filledSlots: string[], missingRequired: string[] }>}
   */
  async fillSlots(intent, context = {}) {
    const intentType = intent.type || "unknown";
    const entities = { ...(intent.entities || {}) };
    const filledSlots = [];

    const requiredSlots = REQUIRED_SLOTS[intentType] || [];
    const optionalSlots = OPTIONAL_SLOTS[intentType] || [];

    // Step 1: Infer from context
    for (const slot of [...requiredSlots, ...optionalSlots]) {
      if (entities[slot]) continue; // Already filled

      const inferred = this.inferFromContext(slot, context);
      if (inferred !== null) {
        entities[slot] = inferred;
        filledSlots.push(slot);
        this.emit("slot-inferred", {
          slot,
          value: inferred,
          source: "context",
        });
      }
    }

    // Step 2: Ask user for missing required slots
    for (const slot of requiredSlots) {
      if (entities[slot]) continue;

      try {
        const value = await this.askUser(slot);
        if (value) {
          entities[slot] = value;
          filledSlots.push(slot);
          this.emit("slot-filled", { slot, value, source: "user" });
        }
      } catch (_err) {
        // User cancelled or timeout — leave slot empty
      }
    }

    // Step 3: LLM inference for remaining optional slots
    if (this.llmChat) {
      const missingOptional = optionalSlots.filter((s) => !entities[s]);
      if (missingOptional.length > 0) {
        try {
          const inferred = await this.inferWithLLM(
            missingOptional,
            context,
            entities,
            intentType,
          );
          for (const [slot, value] of Object.entries(inferred)) {
            if (value && !entities[slot]) {
              entities[slot] = value;
              filledSlots.push(slot);
              this.emit("slot-inferred", { slot, value, source: "llm" });
            }
          }
        } catch (_err) {
          // LLM inference failure is non-critical
        }
      }
    }

    // Step 4: Learn from user preferences
    if (this.db) {
      for (const slot of requiredSlots) {
        if (!entities[slot]) {
          try {
            const preference = await this.learnUserPreference(intentType, slot);
            if (preference) {
              entities[slot] = preference;
              filledSlots.push(slot);
              this.emit("slot-inferred", {
                slot,
                value: preference,
                source: "preference",
              });
            }
          } catch (_err) {
            // Non-critical
          }
        }
      }
    }

    const validation = this.validateSlots(intentType, entities);

    return {
      entities,
      validation,
      filledSlots,
      missingRequired: validation.missingRequired,
    };
  }

  /**
   * Infer a slot value from context (rules-based).
   */
  inferFromContext(slotName, context) {
    switch (slotName) {
      case "fileType": {
        if (context.currentFile) {
          const ext = context.currentFile.match(/\.[^.]+$/)?.[0];
          if (ext && EXT_TO_FILE_TYPE[ext]) {
            return EXT_TO_FILE_TYPE[ext];
          }
        }
        return null;
      }

      case "target": {
        if (context.currentFile) return context.currentFile;
        if (context.selectedText) return context.selectedText;
        return null;
      }

      case "path": {
        if (context.cwd) return context.cwd;
        return null;
      }

      case "platform": {
        if (context.hasDockerfile) return "docker";
        if (context.hasVercelConfig) return "vercel";
        return null;
      }

      case "framework": {
        if (context.hasVitest) return "vitest";
        if (context.hasJest) return "jest";
        return null;
      }

      case "directory": {
        return context.cwd || null;
      }

      default:
        return null;
    }
  }

  /**
   * Ask the user to fill a slot via the interaction adapter.
   */
  async askUser(slotName) {
    const prompt = SLOT_PROMPTS[slotName];
    if (!prompt) {
      return this.interaction.askInput(
        `Please provide a value for "${slotName}":`,
      );
    }

    if (prompt.type === "select" && prompt.options) {
      return this.interaction.askSelect(prompt.question, prompt.options);
    }

    return this.interaction.askInput(prompt.question);
  }

  /**
   * Use LLM to infer optional slot values (low temperature).
   */
  async inferWithLLM(slots, context, currentEntities, intentType) {
    if (!this.llmChat) return {};

    const prompt = `Given the following context, infer reasonable values for these parameters.

Intent type: ${intentType}
Already known: ${JSON.stringify(currentEntities)}
Working directory: ${context.cwd || "unknown"}
Parameters to infer: ${slots.join(", ")}

Respond with a JSON object mapping parameter names to inferred values.
Only include parameters where you have high confidence. Use null for uncertain ones.
Keep values concise (single words or short strings).`;

    try {
      const response = await this.llmChat([
        {
          role: "system",
          content:
            "You are a parameter inference assistant. Respond only with valid JSON.",
        },
        { role: "user", content: prompt },
      ]);

      const content = response?.message?.content || response?.content || "";
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        // Filter out null values
        const result = {};
        for (const [key, value] of Object.entries(parsed)) {
          if (value !== null && value !== undefined && slots.includes(key)) {
            result[key] = String(value);
          }
        }
        return result;
      }
    } catch (_err) {
      // Non-critical
    }

    return {};
  }

  /**
   * Validate that all required slots are filled.
   */
  validateSlots(intentType, entities) {
    const required = REQUIRED_SLOTS[intentType] || [];
    const missingRequired = required.filter((s) => !entities[s]);
    const total = required.length;
    const filled = total - missingRequired.length;

    return {
      valid: missingRequired.length === 0,
      missingRequired,
      completeness: total > 0 ? Math.round((filled / total) * 100) : 100,
    };
  }

  /**
   * Learn user preferences from past slot-filling history.
   */
  async learnUserPreference(intentType, slot) {
    if (!this.db) return null;

    try {
      this._ensureHistoryTable();
      const rows = this.db
        .prepare(
          `SELECT slot_value FROM slot_filling_history
           WHERE intent_type = ? AND slot_name = ?
           ORDER BY created_at DESC LIMIT 10`,
        )
        .all(intentType, slot);

      if (rows.length < 2) return null;

      // Find most common value
      const counts = {};
      for (const row of rows) {
        counts[row.slot_value] = (counts[row.slot_value] || 0) + 1;
      }
      const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]);
      if (sorted[0] && sorted[0][1] >= 2) {
        return sorted[0][0];
      }
    } catch (_err) {
      // Non-critical
    }

    return null;
  }

  /**
   * Record slot filling history for preference learning.
   */
  recordHistory(intentType, entities) {
    if (!this.db) return;

    try {
      this._ensureHistoryTable();
      const stmt = this.db.prepare(
        `INSERT INTO slot_filling_history (intent_type, slot_name, slot_value, created_at)
         VALUES (?, ?, ?, datetime('now'))`,
      );
      for (const [slot, value] of Object.entries(entities)) {
        if (value) {
          stmt.run(intentType, slot, String(value));
        }
      }
    } catch (_err) {
      // Non-critical
    }
  }

  _ensureHistoryTable() {
    if (this._tableCreated) return;
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS slot_filling_history (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        intent_type TEXT NOT NULL,
        slot_name TEXT NOT NULL,
        slot_value TEXT NOT NULL,
        created_at TEXT DEFAULT (datetime('now'))
      )
    `);
    this._tableCreated = true;
  }

  /**
   * Get slot definitions for an intent type.
   */
  static getSlotDefinitions(intentType) {
    return {
      required: REQUIRED_SLOTS[intentType] || [],
      optional: OPTIONAL_SLOTS[intentType] || [],
    };
  }

  /**
   * Get all supported intent types.
   */
  static getSupportedIntents() {
    return Object.keys(REQUIRED_SLOTS);
  }
}
