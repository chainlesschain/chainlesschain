/**
 * Mock Data Generator Skill Handler
 *
 * Generates realistic mock data from schemas, type definitions,
 * or predefined entity types.
 * Modes: --schema, --type, --count
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { logger } = require("../../../../../utils/logger.js");

// ── Random data generators ──────────────────────────────────────────

function uuid() {
  return crypto.randomUUID
    ? crypto.randomUUID()
    : "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0;
        return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
      });
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
function randomFloat(min, max, decimals) {
  return parseFloat((Math.random() * (max - min) + min).toFixed(decimals || 2));
}
function randomChoice(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}
function randomDate(startYear, endYear) {
  const start = new Date(startYear || 2020, 0, 1).getTime();
  const end = new Date(endYear || 2026, 11, 31).getTime();
  return new Date(start + Math.random() * (end - start)).toISOString();
}
function randomBool() {
  return Math.random() > 0.5;
}

const FIRST_NAMES_EN = [
  "Alice",
  "Bob",
  "Charlie",
  "Diana",
  "Eve",
  "Frank",
  "Grace",
  "Henry",
  "Ivy",
  "Jack",
  "Kate",
  "Leo",
  "Mia",
  "Noah",
  "Olivia",
  "Peter",
  "Quinn",
  "Ruby",
  "Sam",
  "Tina",
];
const LAST_NAMES_EN = [
  "Smith",
  "Johnson",
  "Williams",
  "Brown",
  "Jones",
  "Garcia",
  "Miller",
  "Davis",
  "Rodriguez",
  "Martinez",
  "Chen",
  "Wang",
  "Li",
  "Zhang",
  "Liu",
];
const FIRST_NAMES_ZH = [
  "明",
  "华",
  "强",
  "丽",
  "军",
  "芳",
  "伟",
  "娟",
  "磊",
  "静",
  "杰",
  "敏",
  "涛",
  "婷",
  "鹏",
];
const LAST_NAMES_ZH = [
  "王",
  "李",
  "张",
  "刘",
  "陈",
  "杨",
  "赵",
  "黄",
  "周",
  "吴",
  "徐",
  "孙",
  "胡",
  "朱",
  "高",
];
const DOMAINS = [
  "example.com",
  "test.org",
  "demo.io",
  "mock.dev",
  "sample.net",
];
const CATEGORIES = [
  "electronics",
  "clothing",
  "books",
  "food",
  "sports",
  "home",
  "toys",
  "beauty",
];
const ROLES = ["admin", "user", "editor", "viewer", "moderator"];
const STATUSES = [
  "pending",
  "processing",
  "completed",
  "cancelled",
  "refunded",
];
const TAGS_POOL = [
  "javascript",
  "python",
  "react",
  "vue",
  "node",
  "api",
  "database",
  "security",
  "performance",
  "testing",
  "devops",
  "ai",
];
const COLORS = [
  "red",
  "blue",
  "green",
  "yellow",
  "purple",
  "orange",
  "pink",
  "black",
  "white",
  "gray",
];
const LOREM =
  "Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod tempor incididunt ut labore et dolore magna aliqua".split(
    " ",
  );

function randomName(locale) {
  if (locale === "zh-CN" || locale === "zh") {
    return randomChoice(LAST_NAMES_ZH) + randomChoice(FIRST_NAMES_ZH);
  }
  return randomChoice(FIRST_NAMES_EN) + " " + randomChoice(LAST_NAMES_EN);
}

function randomEmail(name) {
  const clean = name
    .toLowerCase()
    .replace(/\s+/g, ".")
    .replace(/[^a-z.]/g, "");
  return (clean || "user" + randomInt(1, 999)) + "@" + randomChoice(DOMAINS);
}

function randomSentence(wordCount) {
  const words = [];
  for (let i = 0; i < (wordCount || randomInt(5, 15)); i++) {
    words.push(randomChoice(LOREM));
  }
  words[0] = words[0].charAt(0).toUpperCase() + words[0].slice(1);
  return words.join(" ") + ".";
}

function randomParagraph(sentenceCount) {
  const sentences = [];
  for (let i = 0; i < (sentenceCount || randomInt(2, 5)); i++) {
    sentences.push(randomSentence());
  }
  return sentences.join(" ");
}

function randomUrl() {
  return (
    "https://" +
    randomChoice(DOMAINS) +
    "/" +
    randomChoice(["page", "api", "docs", "blog"]) +
    "/" +
    randomInt(1, 1000)
  );
}
function randomPhone() {
  return (
    "+1-" +
    randomInt(200, 999) +
    "-" +
    randomInt(100, 999) +
    "-" +
    randomInt(1000, 9999)
  );
}
function randomIP() {
  return (
    randomInt(1, 255) +
    "." +
    randomInt(0, 255) +
    "." +
    randomInt(0, 255) +
    "." +
    randomInt(1, 254)
  );
}
function randomAvatar(name) {
  return (
    "https://api.dicebear.com/7.x/initials/svg?seed=" +
    encodeURIComponent(name || "user")
  );
}

// ── Field name → generator mapping ──────────────────────────────────

function generateByFieldName(fieldName, locale) {
  const lower = fieldName.toLowerCase();

  if (/^id$|_id$|Id$/.test(fieldName)) {
    return uuid();
  }
  if (/name|username|fullname|full_name/i.test(lower)) {
    return randomName(locale);
  }
  if (/^first.?name/i.test(lower)) {
    return locale === "zh-CN"
      ? randomChoice(FIRST_NAMES_ZH)
      : randomChoice(FIRST_NAMES_EN);
  }
  if (/^last.?name/i.test(lower)) {
    return locale === "zh-CN"
      ? randomChoice(LAST_NAMES_ZH)
      : randomChoice(LAST_NAMES_EN);
  }
  if (/email/i.test(lower)) {
    return randomEmail(randomName(locale));
  }
  if (/^age$/i.test(lower)) {
    return randomInt(18, 65);
  }
  if (/phone|tel|mobile/i.test(lower)) {
    return randomPhone();
  }
  if (/avatar|image|img|photo|picture/i.test(lower)) {
    return randomAvatar(randomName(locale));
  }
  if (/url|link|href|website/i.test(lower)) {
    return randomUrl();
  }
  if (/ip.?address|ipv4/i.test(lower)) {
    return randomIP();
  }
  if (/role/i.test(lower)) {
    return randomChoice(ROLES);
  }
  if (/status/i.test(lower)) {
    return randomChoice(STATUSES);
  }
  if (/category|type/i.test(lower)) {
    return randomChoice(CATEGORIES);
  }
  if (/color/i.test(lower)) {
    return randomChoice(COLORS);
  }
  if (/tags?/i.test(lower)) {
    return [randomChoice(TAGS_POOL), randomChoice(TAGS_POOL)].filter(
      (v, i, a) => a.indexOf(v) === i,
    );
  }
  if (/price|cost|amount|total/i.test(lower)) {
    return randomFloat(1, 999, 2);
  }
  if (/count|quantity|qty|num/i.test(lower)) {
    return randomInt(1, 100);
  }
  if (/score|rating/i.test(lower)) {
    return randomFloat(1, 5, 1);
  }
  if (/percent|rate/i.test(lower)) {
    return randomFloat(0, 100, 1);
  }
  if (/weight|height|width|length|size/i.test(lower)) {
    return randomFloat(1, 200, 1);
  }
  if (/title|subject|headline/i.test(lower)) {
    return randomSentence(randomInt(3, 8)).replace(/\.$/, "");
  }
  if (/description|summary|bio|about/i.test(lower)) {
    return randomSentence(randomInt(8, 20));
  }
  if (/content|body|text|message/i.test(lower)) {
    return randomParagraph();
  }
  if (/date|time|created|updated|published|born|expired/i.test(lower)) {
    return randomDate();
  }
  if (
    /active|enabled|verified|published|public|deleted|archived/i.test(lower)
  ) {
    return randomBool();
  }
  if (/in.?stock|available/i.test(lower)) {
    return randomBool();
  }
  if (/items|list|children/i.test(lower)) {
    return [];
  }
  if (/address/i.test(lower)) {
    return (
      randomInt(100, 9999) +
      " " +
      randomChoice(["Main", "Oak", "Pine", "Maple", "Cedar"]) +
      " " +
      randomChoice(["St", "Ave", "Blvd", "Rd"])
    );
  }
  if (/city/i.test(lower)) {
    return randomChoice([
      "New York",
      "London",
      "Tokyo",
      "Shanghai",
      "Paris",
      "Berlin",
      "Sydney",
    ]);
  }
  if (/country/i.test(lower)) {
    return randomChoice(["US", "UK", "JP", "CN", "FR", "DE", "AU"]);
  }
  if (/zip|postal/i.test(lower)) {
    return String(randomInt(10000, 99999));
  }
  if (/password|secret|token/i.test(lower)) {
    return "***" + uuid().substring(0, 8);
  }

  // Fallback: string
  return randomSentence(3).replace(/\.$/, "");
}

// ── Predefined entity types ─────────────────────────────────────────

const ENTITY_SCHEMAS = {
  user: [
    "id",
    "name",
    "email",
    "age",
    "role",
    "avatar",
    "phone",
    "active",
    "createdAt",
  ],
  product: [
    "id",
    "name",
    "price",
    "category",
    "description",
    "inStock",
    "rating",
    "createdAt",
  ],
  order: ["id", "userId", "total", "status", "items", "createdAt", "updatedAt"],
  post: ["id", "title", "content", "author", "tags", "publishedAt", "likes"],
  comment: ["id", "postId", "author", "content", "likes", "createdAt"],
  task: [
    "id",
    "title",
    "description",
    "status",
    "assignee",
    "priority",
    "dueDate",
    "createdAt",
  ],
  event: [
    "id",
    "title",
    "description",
    "date",
    "location",
    "category",
    "attendees",
  ],
  notification: ["id", "title", "message", "type", "read", "createdAt"],
  file: ["id", "name", "size", "type", "url", "uploadedAt"],
  address: ["id", "street", "city", "country", "zipCode", "phone"],
};

// ── Schema parsing ──────────────────────────────────────────────────

function parseTypeScriptInterface(content) {
  const schemas = [];
  const interfaceRe = /\binterface\s+(\w+)\s*\{([^}]+)\}/g;
  let m;
  while ((m = interfaceRe.exec(content)) !== null) {
    const name = m[1];
    const body = m[2];
    const fields = [];
    const fieldRe = /(\w+)\s*[?]?\s*:\s*([^;]+)/g;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      fields.push(fm[1].trim());
    }
    schemas.push({ name, fields });
  }

  // Also try type aliases
  const typeRe = /\btype\s+(\w+)\s*=\s*\{([^}]+)\}/g;
  while ((m = typeRe.exec(content)) !== null) {
    const name = m[1];
    const body = m[2];
    const fields = [];
    const fieldRe = /(\w+)\s*[?]?\s*:\s*([^;]+)/g;
    let fm;
    while ((fm = fieldRe.exec(body)) !== null) {
      fields.push(fm[1].trim());
    }
    schemas.push({ name, fields });
  }

  return schemas;
}

function generateRecord(fields, locale) {
  const record = {};
  for (const field of fields) {
    record[field] = generateByFieldName(field, locale);
  }
  return record;
}

function generateRecords(fields, count, locale) {
  const records = [];
  for (let i = 0; i < count; i++) {
    records.push(generateRecord(fields, locale));
  }
  return records;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[mock-data-generator] init: " + (_skill?.name || "mock-data-generator"),
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    const schemaMatch = input.match(/--schema\s+(\S+)/i);
    const typeMatch = input.match(/--type\s+(\S+)/i);
    const countMatch = input.match(/--count\s+(\d+)/i);
    const localeMatch = input.match(/--locale\s+(\S+)/i);

    const count = countMatch ? Math.min(parseInt(countMatch[1]), 100) : 3;
    const locale = localeMatch ? localeMatch[1] : "en";

    try {
      if (schemaMatch) {
        const filePath = path.isAbsolute(schemaMatch[1])
          ? schemaMatch[1]
          : path.resolve(projectRoot, schemaMatch[1]);
        if (!fs.existsSync(filePath)) {
          return {
            success: false,
            error: "File not found: " + filePath,
            message: "File not found: " + filePath,
          };
        }
        const content = fs.readFileSync(filePath, "utf-8");
        const schemas = parseTypeScriptInterface(content);
        if (schemas.length === 0) {
          return {
            success: false,
            error: "No interfaces or types found in file",
            message:
              "No TypeScript interfaces or type aliases found in " +
              path.basename(filePath),
          };
        }

        const allData = {};
        for (const schema of schemas) {
          allData[schema.name] = generateRecords(schema.fields, count, locale);
        }

        let msg = "Mock Data from Schema\n" + "=".repeat(30) + "\n";
        msg += "File: " + path.relative(projectRoot, filePath) + "\n";
        msg +=
          "Types found: " +
          schemas
            .map((s) => s.name + " (" + s.fields.length + " fields)")
            .join(", ") +
          "\n";
        msg += "Records per type: " + count + "\n\n";
        msg += JSON.stringify(allData, null, 2).substring(0, 3000);

        return {
          success: true,
          result: { data: allData, schemas, count },
          message: msg,
        };
      }

      if (typeMatch) {
        const typeName = typeMatch[1].toLowerCase();
        const fields = ENTITY_SCHEMAS[typeName];
        if (!fields) {
          const available = Object.keys(ENTITY_SCHEMAS).join(", ");
          // Try to generate from field name
          const customFields = typeName
            .split(",")
            .map((f) => f.trim())
            .filter(Boolean);
          if (customFields.length > 1) {
            const data = generateRecords(customFields, count, locale);
            let msg = "Custom Mock Data\n" + "=".repeat(30) + "\n";
            msg += "Fields: " + customFields.join(", ") + "\n";
            msg +=
              "Count: " +
              count +
              "\n\n" +
              JSON.stringify(data, null, 2).substring(0, 3000);
            return {
              success: true,
              result: { data, count, fields: customFields },
              message: msg,
            };
          }
          return {
            success: false,
            error: "Unknown type: " + typeName + ". Available: " + available,
            message:
              "Unknown type: " + typeName + "\nAvailable types: " + available,
          };
        }

        const data = generateRecords(fields, count, locale);
        let msg = "Mock Data: " + typeName + "\n" + "=".repeat(30) + "\n";
        msg +=
          "Type: " +
          typeName +
          " | Fields: " +
          fields.length +
          " | Count: " +
          count +
          "\n\n";
        msg += JSON.stringify(data, null, 2).substring(0, 3000);

        return {
          success: true,
          result: { data, count, schema: { name: typeName, fields } },
          message: msg,
        };
      }

      // No mode - show available types
      if (!input) {
        const types = Object.entries(ENTITY_SCHEMAS)
          .map(
            ([name, fields]) =>
              "  /mock-data-generator --type " +
              name +
              " — " +
              fields.slice(0, 5).join(", ") +
              "...",
          )
          .join("\n");
        return {
          success: true,
          result: { availableTypes: Object.keys(ENTITY_SCHEMAS) },
          message:
            "Mock Data Generator\n" +
            "=".repeat(30) +
            "\nUsage:\n  /mock-data-generator --type <entity> [--count N] [--locale zh-CN]\n  /mock-data-generator --schema <file.ts> [--count N]\n\nAvailable types:\n" +
            types,
        };
      }

      // Treat input as type name
      const typeName = input.split(/\s+/)[0].toLowerCase();
      const fields = ENTITY_SCHEMAS[typeName];
      if (fields) {
        const data = generateRecords(fields, count, locale);
        const msg =
          "Mock Data: " +
          typeName +
          "\n" +
          "=".repeat(30) +
          "\n" +
          JSON.stringify(data, null, 2).substring(0, 3000);
        return { success: true, result: { data, count }, message: msg };
      }

      return {
        success: false,
        error: "Unknown type: " + typeName,
        message: "Unknown type. Use --type <entity> or --schema <file>",
      };
    } catch (err) {
      logger.error("[mock-data-generator] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Mock data generation failed: " + err.message,
      };
    }
  },
};
