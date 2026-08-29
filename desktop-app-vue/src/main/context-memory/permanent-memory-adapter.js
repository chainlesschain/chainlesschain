"use strict";

const { randomUUID } = require("node:crypto");

const DESKTOP_MEMORY_SINK = "desktop.memory";
const LOCAL_USER_SCOPE = Object.freeze({
  scope: "user",
  scopeId: "local-user",
});
const DAILY_NOTE_CATEGORY = "daily-note";
const MEMORY_DOCUMENT_CATEGORY = "memory-document";

function boundedText(value, field, { allowEmpty = false } = {}) {
  if (typeof value !== "string" || (!allowEmpty && value.trim().length === 0)) {
    const error = new TypeError(`${field} must be a non-empty string`);
    error.code = "INVALID_ARGUMENT";
    throw error;
  }
  return value;
}

function dateFromTimestamp(value) {
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime())
    ? parsed.toISOString().slice(0, 10)
    : null;
}

function dateTag(date) {
  return `date:${date}`;
}

function sectionTag(section) {
  const normalized = String(section || "General").trim() || "General";
  return `section:${normalized}`.slice(0, 128);
}

function tagValue(record, prefix) {
  return (record.tags || [])
    .find((tag) => String(tag).startsWith(prefix))
    ?.slice(prefix.length);
}

function canonicalUnavailable() {
  const error = new Error(
    "Canonical Context/Memory App Server is not initialized",
  );
  error.code = "CANONICAL_MEMORY_UNAVAILABLE";
  return error;
}

function legacySearchProjection(entry) {
  const record = entry.record;
  const date = tagValue(record, "date:") || dateFromTimestamp(record.createdAt);
  const section = tagValue(record, "section:") || record.category;
  const daily = record.category === DAILY_NOTE_CATEGORY;
  return {
    id: record.memoryId,
    source: daily ? "daily" : "memory",
    type: daily ? "daily" : "memory",
    title: daily ? date || "Daily Note" : section,
    content: record.content,
    score: Number(entry.relevance || 0),
    ...(date ? { date } : {}),
    ...(!daily ? { section } : {}),
    document: {
      content: record.content,
      metadata: {
        type: daily ? "daily-note" : "canonical-memory",
        memoryId: record.memoryId,
        revision: record.revision,
        category: record.category,
        ...(date ? { date } : {}),
        ...(!daily ? { section } : {}),
      },
    },
  };
}

class DesktopCanonicalMemoryAdapter {
  constructor({ getPilot, now = () => Date.now(), uuid = randomUUID } = {}) {
    if (typeof getPilot !== "function") {
      throw new TypeError("getPilot must be a function");
    }
    this.getPilot = getPilot;
    this.now = now;
    this.uuid = uuid;
  }

  _pilot() {
    const pilot = this.getPilot();
    if (
      !pilot ||
      typeof pilot.memoryRecall !== "function" ||
      typeof pilot.memoryPropose !== "function" ||
      typeof pilot.memoryDecide !== "function" ||
      typeof pilot.memoryDelete !== "function"
    ) {
      throw canonicalUnavailable();
    }
    return pilot;
  }

  _nowIso() {
    return new Date(Number(this.now())).toISOString();
  }

  getTodayDate() {
    return dateFromTimestamp(this._nowIso());
  }

  async _recall(query = "*", { limit = 1000 } = {}) {
    return this._pilot().memoryRecall({
      query: String(query || "*").trim() || "*",
      sink: DESKTOP_MEMORY_SINK,
      scopeAdmissions: [LOCAL_USER_SCOPE],
      limit: Math.max(1, Math.min(1000, Number(limit) || 1000)),
      tokenBudget: 1_048_576,
      now: this._nowIso(),
    });
  }

  async _records(query = "*") {
    const recalled = await this._recall(query);
    return (recalled.results || []).map((entry) => entry.record);
  }

  async _propose(content, { category, tags = [], supersedes = [] } = {}) {
    boundedText(content, "content");
    const observedAt = this._nowIso();
    const mutation = await this._pilot().memoryPropose({
      ...LOCAL_USER_SCOPE,
      category,
      content,
      provenance: {
        source: "desktop-memory-ipc",
        actor: "local-user",
        observedAt,
      },
      evidenceRefs: [
        {
          store: "desktop-memory-ipc",
          id: `request-${this.uuid()}`,
        },
      ],
      confidence: 1,
      importance: 0.7,
      tags: [...new Set(tags)].slice(0, 128),
      sensitivity: "personal",
      allowedSinks: ["*"],
      retentionPolicy: { mode: "durable" },
      activate: true,
      createdAt: observedAt,
      ...(supersedes.length > 0
        ? { supersedes: supersedes.slice(0, 128) }
        : {}),
    });
    return mutation;
  }

  async _supersede(records, successorMemoryId) {
    for (const record of records) {
      await this._pilot().memoryDecide({
        memoryId: record.memoryId,
        type: "supersede",
        expectedRevision: record.revision,
        successorMemoryId,
        reason: "desktop compatibility projection replaced",
        authority: "desktop-memory-ipc",
        at: this._nowIso(),
      });
    }
  }

  async writeDailyNote(content, { append = true } = {}) {
    const date = dateFromTimestamp(this._nowIso());
    const existing = (await this._records("*")).filter(
      (record) =>
        record.category === DAILY_NOTE_CATEGORY &&
        tagValue(record, "date:") === date,
    );
    const replaced = append ? [] : existing;
    const mutation = await this._propose(content, {
      category: DAILY_NOTE_CATEGORY,
      tags: [dateTag(date)],
      supersedes: replaced.map((record) => record.memoryId),
    });
    if (replaced.length > 0) {
      await this._supersede(replaced, mutation.record.memoryId);
    }
    return {
      record: mutation.record,
      receipt: mutation.receipt,
      date,
      append,
    };
  }

  async readDailyNote(date) {
    const targetDate = date || dateFromTimestamp(this._nowIso());
    const records = (await this._records("*")).filter(
      (record) =>
        record.category === DAILY_NOTE_CATEGORY &&
        tagValue(record, "date:") === targetDate,
    );
    return records
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => record.content)
      .join("\n\n");
  }

  async getRecentDailyNotes(limit = 7) {
    const groups = new Map();
    for (const record of await this._records("*")) {
      if (record.category !== DAILY_NOTE_CATEGORY) continue;
      const date =
        tagValue(record, "date:") || dateFromTimestamp(record.createdAt);
      const values = groups.get(date) || [];
      values.push(record);
      groups.set(date, values);
    }
    return [...groups.entries()]
      .sort(([left], [right]) => right.localeCompare(left))
      .slice(0, Math.max(1, Number(limit) || 7))
      .map(([date, records]) => ({
        date,
        content: records
          .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
          .map((record) => record.content)
          .join("\n\n"),
        createdAt: Math.min(
          ...records.map((record) => Date.parse(record.createdAt)),
        ),
        updatedAt: Math.max(
          ...records.map((record) => Date.parse(record.updatedAt)),
        ),
      }));
  }

  async appendToMemory(content, { section = null, category = "memory" } = {}) {
    return this._propose(content, {
      category,
      tags: [sectionTag(section)],
    });
  }

  async updateMemory(content) {
    boundedText(content, "content");
    const replaced = (await this._records("*")).filter(
      (record) => record.category !== DAILY_NOTE_CATEGORY,
    );
    const mutation = await this._propose(content, {
      category: MEMORY_DOCUMENT_CATEGORY,
      tags: [sectionTag("MEMORY.md")],
      supersedes: replaced.map((record) => record.memoryId),
    });
    if (replaced.length > 0) {
      await this._supersede(replaced, mutation.record.memoryId);
    }
    return mutation;
  }

  async readMemory() {
    const records = (await this._records("*")).filter(
      (record) => record.category !== DAILY_NOTE_CATEGORY,
    );
    return records
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
      .map((record) => {
        if (record.category === MEMORY_DOCUMENT_CATEGORY) return record.content;
        const section = tagValue(record, "section:") || record.category;
        return `## ${section}\n\n${record.content}`;
      })
      .join("\n\n");
  }

  async search(query, options = {}) {
    const recalled = await this._recall(query, { limit: options.limit || 20 });
    return (recalled.results || []).map(legacySearchProjection);
  }

  async getStats() {
    const records = await this._records("*");
    const dailyDates = new Set();
    const sections = new Set();
    for (const record of records) {
      if (record.category === DAILY_NOTE_CATEGORY) {
        dailyDates.add(
          tagValue(record, "date:") || dateFromTimestamp(record.createdAt),
        );
      } else {
        sections.add(tagValue(record, "section:") || record.category);
      }
    }
    return {
      dailyNotesCount: dailyDates.size,
      memorySectionsCount: sections.size,
      cachedEmbeddingsCount: 0,
      indexedFilesCount: records.length,
      canonicalRecordsCount: records.length,
      authority: "context_memory_kernel",
    };
  }

  async getMemorySections() {
    const sections = [];
    const seen = new Set();
    for (const record of await this._records("*")) {
      if (record.category === DAILY_NOTE_CATEGORY) continue;
      const title = tagValue(record, "section:") || record.category;
      if (seen.has(title)) continue;
      seen.add(title);
      sections.push({ title, index: sections.length });
    }
    return sections;
  }

  async saveToMemory(content, { type = "conversation", section = null } = {}) {
    if (type === "daily" || type === "conversation") {
      const saved = await this.writeDailyNote(content, { append: true });
      return {
        savedTo: "daily_notes",
        date: saved.date,
        type,
        memoryId: saved.record.memoryId,
        revision: saved.record.revision,
        canonical: true,
      };
    }
    const mutation = await this.appendToMemory(content, {
      section: section || type,
      category: String(type || "memory")
        .toLowerCase()
        .replace(/[^a-z0-9._:/-]+/gu, "-")
        .replace(/^-+|-+$/gu, "")
        .slice(0, 160) || "memory",
    });
    return {
      savedTo: "memory_md",
      section: section || type,
      date: dateFromTimestamp(mutation.record.createdAt),
      type,
      memoryId: mutation.record.memoryId,
      revision: mutation.record.revision,
      canonical: true,
    };
  }

  async saveConversation(messages, conversationTitle = "") {
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new TypeError("messages must be a non-empty array");
    }
    const title =
      String(conversationTitle || "Conversation").trim() || "Conversation";
    const content = [
      `### ${title}`,
      "",
      ...messages.map((message) => {
        const role = String(message?.role || "unknown").slice(0, 32);
        const body = String(message?.content || "").slice(0, 65_536);
        return `**${role}**: ${body}`;
      }),
    ].join("\n\n");
    const saved = await this.writeDailyNote(content, { append: true });
    return {
      savedTo: "daily_notes",
      messageCount: messages.length,
      title,
      discoveriesExtracted: 0,
      timestamp: Date.parse(saved.record.createdAt),
      memoryId: saved.record.memoryId,
      revision: saved.record.revision,
      canonical: true,
    };
  }
}

module.exports = {
  DAILY_NOTE_CATEGORY,
  DESKTOP_MEMORY_SINK,
  DesktopCanonicalMemoryAdapter,
  LOCAL_USER_SCOPE,
  MEMORY_DOCUMENT_CATEGORY,
  legacySearchProjection,
};
