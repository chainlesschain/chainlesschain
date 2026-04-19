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
   * Detect intent type from a user message using keyword/regex matching.
   *
   * @param {string} userMessage
   * @returns {{ type: string, entities: object } | null} Detected intent or null
   */
  static detectIntent(userMessage) {
    if (!userMessage || typeof userMessage !== "string") return null;

    const msg = userMessage.toLowerCase().trim();

    // Intent detection patterns — ordered by specificity
    const patterns = [
      {
        type: "create_file",
        keywords: [
          /\bcreate\s+(a\s+)?file\b/,
          /\bnew\s+file\b/,
          /\bscaffold\b/,
          /\bgenerate\s+(a\s+)?file\b/,
        ],
      },
      {
        type: "deploy",
        keywords: [/\bdeploy\b/, /\bship\s+(it|this)\b/, /\bpush\s+to\s+prod/],
      },
      {
        type: "refactor",
        keywords: [/\brefactor\b/, /\brestructure\b/, /\breorganize\b/],
      },
      {
        type: "test",
        keywords: [
          /\bwrite\s+tests?\b/,
          /\badd\s+tests?\b/,
          /\btest\s+(this|it|the)\b/,
          /\bunit\s+test\b/,
        ],
      },
      {
        type: "analyze",
        keywords: [/\banalyze\b/, /\baudit\b/, /\breview\s+(the\s+)?code\b/],
      },
      {
        type: "search",
        keywords: [
          /\bsearch\s+for\b/,
          /\bfind\s+(all|the|every)\b/,
          /\bgrep\b/,
          /\blook\s+for\b/,
        ],
      },
      {
        type: "install",
        keywords: [
          /\binstall\b/,
          /\badd\s+(a\s+)?package\b/,
          /\badd\s+(a\s+)?dependency\b/,
        ],
      },
      {
        type: "generate",
        keywords: [
          /\bgenerate\b/,
          /\bcreate\s+(a\s+)?(component|test|api|config)\b/,
        ],
      },
      {
        type: "edit_file",
        keywords: [
          /\bedit\s+(the\s+)?file\b/,
          /\bmodify\s+(the\s+)?file\b/,
          /\bchange\s+(the\s+)?file\b/,
        ],
      },
    ];

    for (const { type, keywords } of patterns) {
      for (const re of keywords) {
        if (re.test(msg)) {
          // Try to extract entities from the message
          const entities = CLISlotFiller._extractEntities(type, msg);
          return { type, entities };
        }
      }
    }

    return null;
  }

  /**
   * Extract entities from a matched message.
   * @private
   */
  static _extractEntities(intentType, msg) {
    const entities = {};

    // Try to extract file path references
    const pathMatch = msg.match(
      /(?:in|at|to|from)\s+["`']?([./\w-]+\.\w+)["`']?/,
    );
    if (pathMatch) {
      if (intentType === "create_file") {
        entities.path = pathMatch[1];
      } else {
        entities.target = pathMatch[1];
      }
    }

    // Try to extract file type from extension mentions
    const extMatch = msg.match(/\.(js|ts|py|json|md|html|css|vue|yaml|yml)\b/);
    if (extMatch && intentType === "create_file") {
      entities.fileType = EXT_TO_FILE_TYPE[`.${extMatch[1]}`] || extMatch[1];
    }

    // Try to extract platform for deploy
    if (intentType === "deploy") {
      if (msg.includes("docker")) entities.platform = "docker";
      else if (msg.includes("vercel")) entities.platform = "vercel";
      else if (msg.includes("aws")) entities.platform = "aws";
    }

    // Try to extract package name for install
    if (intentType === "install") {
      const pkgMatch = msg.match(/install\s+(\S+)/);
      if (pkgMatch && !["a", "the", "this", "it"].includes(pkgMatch[1])) {
        entities.package = pkgMatch[1];
      }
    }

    return entities;
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

// ===== V2 Surface: Slot Filler governance overlay (CLI v0.142.0) =====
export const SLOTF_PROFILE_MATURITY_V2 = Object.freeze({
  PENDING: "pending", ACTIVE: "active", STALE: "stale", ARCHIVED: "archived",
});
export const SLOTF_FILL_LIFECYCLE_V2 = Object.freeze({
  QUEUED: "queued", FILLING: "filling", FILLED: "filled", FAILED: "failed", CANCELLED: "cancelled",
});
const _slotfPTrans = new Map([
  [SLOTF_PROFILE_MATURITY_V2.PENDING, new Set([SLOTF_PROFILE_MATURITY_V2.ACTIVE, SLOTF_PROFILE_MATURITY_V2.ARCHIVED])],
  [SLOTF_PROFILE_MATURITY_V2.ACTIVE, new Set([SLOTF_PROFILE_MATURITY_V2.STALE, SLOTF_PROFILE_MATURITY_V2.ARCHIVED])],
  [SLOTF_PROFILE_MATURITY_V2.STALE, new Set([SLOTF_PROFILE_MATURITY_V2.ACTIVE, SLOTF_PROFILE_MATURITY_V2.ARCHIVED])],
  [SLOTF_PROFILE_MATURITY_V2.ARCHIVED, new Set()],
]);
const _slotfPTerminal = new Set([SLOTF_PROFILE_MATURITY_V2.ARCHIVED]);
const _slotfFTrans = new Map([
  [SLOTF_FILL_LIFECYCLE_V2.QUEUED, new Set([SLOTF_FILL_LIFECYCLE_V2.FILLING, SLOTF_FILL_LIFECYCLE_V2.CANCELLED])],
  [SLOTF_FILL_LIFECYCLE_V2.FILLING, new Set([SLOTF_FILL_LIFECYCLE_V2.FILLED, SLOTF_FILL_LIFECYCLE_V2.FAILED, SLOTF_FILL_LIFECYCLE_V2.CANCELLED])],
  [SLOTF_FILL_LIFECYCLE_V2.FILLED, new Set()],
  [SLOTF_FILL_LIFECYCLE_V2.FAILED, new Set()],
  [SLOTF_FILL_LIFECYCLE_V2.CANCELLED, new Set()],
]);
const _slotfPsV2 = new Map();
const _slotfFsV2 = new Map();
let _slotfMaxActive = 10, _slotfMaxPending = 20, _slotfIdleMs = 30 * 24 * 60 * 60 * 1000, _slotfStuckMs = 30 * 1000;
function _slotfPos(n, label) { const v = Math.floor(Number(n)); if (!Number.isFinite(v) || v <= 0) throw new Error(`${label} must be positive integer`); return v; }
function _slotfCheckP(from, to) { const a = _slotfPTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid slotf profile transition ${from} → ${to}`); }
function _slotfCheckF(from, to) { const a = _slotfFTrans.get(from); if (!a || !a.has(to)) throw new Error(`invalid slotf fill transition ${from} → ${to}`); }
export function setMaxActiveSlotfTemplatesPerOwnerV2(n) { _slotfMaxActive = _slotfPos(n, "maxActiveSlotfTemplatesPerOwner"); }
export function getMaxActiveSlotfTemplatesPerOwnerV2() { return _slotfMaxActive; }
export function setMaxPendingSlotfFillsPerTemplateV2(n) { _slotfMaxPending = _slotfPos(n, "maxPendingSlotfFillsPerTemplate"); }
export function getMaxPendingSlotfFillsPerTemplateV2() { return _slotfMaxPending; }
export function setSlotfTemplateIdleMsV2(n) { _slotfIdleMs = _slotfPos(n, "slotfTemplateIdleMs"); }
export function getSlotfTemplateIdleMsV2() { return _slotfIdleMs; }
export function setSlotfFillStuckMsV2(n) { _slotfStuckMs = _slotfPos(n, "slotfFillStuckMs"); }
export function getSlotfFillStuckMsV2() { return _slotfStuckMs; }
export function _resetStateSlotFillerV2() { _slotfPsV2.clear(); _slotfFsV2.clear(); _slotfMaxActive = 10; _slotfMaxPending = 20; _slotfIdleMs = 30 * 24 * 60 * 60 * 1000; _slotfStuckMs = 30 * 1000; }
export function registerSlotfTemplateV2({ id, owner, schema, metadata } = {}) {
  if (!id) throw new Error("slotf template id required"); if (!owner) throw new Error("slotf template owner required");
  if (_slotfPsV2.has(id)) throw new Error(`slotf template ${id} already registered`);
  const now = Date.now();
  const p = { id, owner, schema: schema || "{}", status: SLOTF_PROFILE_MATURITY_V2.PENDING, createdAt: now, updatedAt: now, activatedAt: null, archivedAt: null, lastTouchedAt: now, metadata: { ...(metadata || {}) } };
  _slotfPsV2.set(id, p); return { ...p, metadata: { ...p.metadata } };
}
function _slotfCountActive(owner) { let n = 0; for (const p of _slotfPsV2.values()) if (p.owner === owner && p.status === SLOTF_PROFILE_MATURITY_V2.ACTIVE) n++; return n; }
export function activateSlotfTemplateV2(id) {
  const p = _slotfPsV2.get(id); if (!p) throw new Error(`slotf template ${id} not found`);
  _slotfCheckP(p.status, SLOTF_PROFILE_MATURITY_V2.ACTIVE);
  const recovery = p.status === SLOTF_PROFILE_MATURITY_V2.STALE;
  if (!recovery && _slotfCountActive(p.owner) >= _slotfMaxActive) throw new Error(`max active slotf templates for owner ${p.owner} reached`);
  const now = Date.now(); p.status = SLOTF_PROFILE_MATURITY_V2.ACTIVE; p.updatedAt = now; p.lastTouchedAt = now; if (!p.activatedAt) p.activatedAt = now;
  return { ...p, metadata: { ...p.metadata } };
}
export function staleSlotfTemplateV2(id) { const p = _slotfPsV2.get(id); if (!p) throw new Error(`slotf template ${id} not found`); _slotfCheckP(p.status, SLOTF_PROFILE_MATURITY_V2.STALE); p.status = SLOTF_PROFILE_MATURITY_V2.STALE; p.updatedAt = Date.now(); return { ...p, metadata: { ...p.metadata } }; }
export function archiveSlotfTemplateV2(id) { const p = _slotfPsV2.get(id); if (!p) throw new Error(`slotf template ${id} not found`); _slotfCheckP(p.status, SLOTF_PROFILE_MATURITY_V2.ARCHIVED); const now = Date.now(); p.status = SLOTF_PROFILE_MATURITY_V2.ARCHIVED; p.updatedAt = now; if (!p.archivedAt) p.archivedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function touchSlotfTemplateV2(id) { const p = _slotfPsV2.get(id); if (!p) throw new Error(`slotf template ${id} not found`); if (_slotfPTerminal.has(p.status)) throw new Error(`cannot touch terminal slotf template ${id}`); const now = Date.now(); p.lastTouchedAt = now; p.updatedAt = now; return { ...p, metadata: { ...p.metadata } }; }
export function getSlotfTemplateV2(id) { const p = _slotfPsV2.get(id); if (!p) return null; return { ...p, metadata: { ...p.metadata } }; }
export function listSlotfTemplatesV2() { return [..._slotfPsV2.values()].map((p) => ({ ...p, metadata: { ...p.metadata } })); }
function _slotfCountPending(templateId) { let n = 0; for (const f of _slotfFsV2.values()) if (f.templateId === templateId && (f.status === SLOTF_FILL_LIFECYCLE_V2.QUEUED || f.status === SLOTF_FILL_LIFECYCLE_V2.FILLING)) n++; return n; }
export function createSlotfFillV2({ id, templateId, input, metadata } = {}) {
  if (!id) throw new Error("slotf fill id required"); if (!templateId) throw new Error("slotf fill templateId required");
  if (_slotfFsV2.has(id)) throw new Error(`slotf fill ${id} already exists`);
  if (!_slotfPsV2.has(templateId)) throw new Error(`slotf template ${templateId} not found`);
  if (_slotfCountPending(templateId) >= _slotfMaxPending) throw new Error(`max pending slotf fills for template ${templateId} reached`);
  const now = Date.now();
  const f = { id, templateId, input: input || "", status: SLOTF_FILL_LIFECYCLE_V2.QUEUED, createdAt: now, updatedAt: now, startedAt: null, settledAt: null, metadata: { ...(metadata || {}) } };
  _slotfFsV2.set(id, f); return { ...f, metadata: { ...f.metadata } };
}
export function fillingSlotfFillV2(id) { const f = _slotfFsV2.get(id); if (!f) throw new Error(`slotf fill ${id} not found`); _slotfCheckF(f.status, SLOTF_FILL_LIFECYCLE_V2.FILLING); const now = Date.now(); f.status = SLOTF_FILL_LIFECYCLE_V2.FILLING; f.updatedAt = now; if (!f.startedAt) f.startedAt = now; return { ...f, metadata: { ...f.metadata } }; }
export function fillSlotfFillV2(id) { const f = _slotfFsV2.get(id); if (!f) throw new Error(`slotf fill ${id} not found`); _slotfCheckF(f.status, SLOTF_FILL_LIFECYCLE_V2.FILLED); const now = Date.now(); f.status = SLOTF_FILL_LIFECYCLE_V2.FILLED; f.updatedAt = now; if (!f.settledAt) f.settledAt = now; return { ...f, metadata: { ...f.metadata } }; }
export function failSlotfFillV2(id, reason) { const f = _slotfFsV2.get(id); if (!f) throw new Error(`slotf fill ${id} not found`); _slotfCheckF(f.status, SLOTF_FILL_LIFECYCLE_V2.FAILED); const now = Date.now(); f.status = SLOTF_FILL_LIFECYCLE_V2.FAILED; f.updatedAt = now; if (!f.settledAt) f.settledAt = now; if (reason) f.metadata.failReason = String(reason); return { ...f, metadata: { ...f.metadata } }; }
export function cancelSlotfFillV2(id, reason) { const f = _slotfFsV2.get(id); if (!f) throw new Error(`slotf fill ${id} not found`); _slotfCheckF(f.status, SLOTF_FILL_LIFECYCLE_V2.CANCELLED); const now = Date.now(); f.status = SLOTF_FILL_LIFECYCLE_V2.CANCELLED; f.updatedAt = now; if (!f.settledAt) f.settledAt = now; if (reason) f.metadata.cancelReason = String(reason); return { ...f, metadata: { ...f.metadata } }; }
export function getSlotfFillV2(id) { const f = _slotfFsV2.get(id); if (!f) return null; return { ...f, metadata: { ...f.metadata } }; }
export function listSlotfFillsV2() { return [..._slotfFsV2.values()].map((f) => ({ ...f, metadata: { ...f.metadata } })); }
export function autoStaleIdleSlotfTemplatesV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const p of _slotfPsV2.values()) if (p.status === SLOTF_PROFILE_MATURITY_V2.ACTIVE && (t - p.lastTouchedAt) >= _slotfIdleMs) { p.status = SLOTF_PROFILE_MATURITY_V2.STALE; p.updatedAt = t; flipped.push(p.id); } return { flipped, count: flipped.length }; }
export function autoFailStuckSlotfFillsV2({ now } = {}) { const t = now ?? Date.now(); const flipped = []; for (const f of _slotfFsV2.values()) if (f.status === SLOTF_FILL_LIFECYCLE_V2.FILLING && f.startedAt != null && (t - f.startedAt) >= _slotfStuckMs) { f.status = SLOTF_FILL_LIFECYCLE_V2.FAILED; f.updatedAt = t; if (!f.settledAt) f.settledAt = t; f.metadata.failReason = "auto-fail-stuck"; flipped.push(f.id); } return { flipped, count: flipped.length }; }
export function getSlotFillerGovStatsV2() {
  const templatesByStatus = {}; for (const v of Object.values(SLOTF_PROFILE_MATURITY_V2)) templatesByStatus[v] = 0; for (const p of _slotfPsV2.values()) templatesByStatus[p.status]++;
  const fillsByStatus = {}; for (const v of Object.values(SLOTF_FILL_LIFECYCLE_V2)) fillsByStatus[v] = 0; for (const f of _slotfFsV2.values()) fillsByStatus[f.status]++;
  return { totalSlotfTemplatesV2: _slotfPsV2.size, totalSlotfFillsV2: _slotfFsV2.size, maxActiveSlotfTemplatesPerOwner: _slotfMaxActive, maxPendingSlotfFillsPerTemplate: _slotfMaxPending, slotfTemplateIdleMs: _slotfIdleMs, slotfFillStuckMs: _slotfStuckMs, templatesByStatus, fillsByStatus };
}
