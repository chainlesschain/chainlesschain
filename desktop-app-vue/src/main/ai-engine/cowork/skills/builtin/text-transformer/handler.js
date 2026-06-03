/**
 * Text Transformer Skill Handler
 *
 * Text encoding, decoding, and transformation utilities.
 * Actions: --base64-encode, --base64-decode, --url-encode, --url-decode,
 *          --html-encode, --html-decode, --hash, --upper, --lower, --title,
 *          --camel, --snake, --kebab, --reverse, --count, --trim, --slug
 */

const crypto = require("crypto");
const { logger } = require("../../../../../utils/logger.js");

// ── Argument parsing ────────────────────────────────────────────────

function extractText(input, flagPattern) {
  const after = input.replace(flagPattern, "").trim();
  const cleaned = after.replace(/--\w+\s+\S+/g, "").trim();
  const quoted = cleaned.match(/^["'](.*)["']$/s);
  return quoted ? quoted[1] : cleaned;
}

function extractFlag(input, flagName) {
  const m = input.match(new RegExp("--" + flagName + "\\s+(\\S+)", "i"));
  return m ? m[1] : null;
}

// ── HTML entity maps ────────────────────────────────────────────────

const HTML_ENCODE_MAP = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};
const HTML_DECODE_MAP = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&#x27;": "'",
  "&#x2F;": "/",
  "&apos;": "'",
};

// ── Case conversion helpers ─────────────────────────────────────────

function toWords(text) {
  return text
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w.length > 0);
}

function toTitleCase(text) {
  return toWords(text)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");
}

function toCamelCase(text) {
  const words = toWords(text);
  if (words.length === 0) {
    return "";
  }
  return (
    words[0].toLowerCase() +
    words
      .slice(1)
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join("")
  );
}

function toSnakeCase(text) {
  return toWords(text)
    .map((w) => w.toLowerCase())
    .join("_");
}

function toKebabCase(text) {
  return toWords(text)
    .map((w) => w.toLowerCase())
    .join("-");
}

function toSlug(text) {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ── Usage message ───────────────────────────────────────────────────

function usageMessage() {
  let msg = "Text Transformer\n" + "=".repeat(30) + "\n";
  msg += "Usage: /text-transformer <action> <text>\n\n";
  msg += "Encoding / Decoding:\n";
  msg += '  --base64-encode "<text>"         Base64 encode\n';
  msg += '  --base64-decode "<text>"         Base64 decode\n';
  msg += '  --url-encode "<text>"            URL encode\n';
  msg += '  --url-decode "<text>"            URL decode\n';
  msg += '  --html-encode "<text>"           HTML entity encode\n';
  msg += '  --html-decode "<text>"           HTML entity decode\n\n';
  msg += "Hashing:\n";
  msg +=
    '  --hash "<text>" [--algo md5|sha1|sha256|sha512]   Hash (default: sha256)\n\n';
  msg += "Case Conversion:\n";
  msg += '  --upper "<text>"    UPPERCASE      --lower "<text>"    lowercase\n';
  msg += '  --title "<text>"    Title Case     --camel "<text>"    camelCase\n';
  msg +=
    '  --snake "<text>"    snake_case     --kebab "<text>"    kebab-case\n\n';
  msg += "String Manipulation:\n";
  msg +=
    '  --reverse "<text>"  Reverse        --count "<text>"    Char/word/line count\n';
  msg +=
    '  --trim "<text>"     Trim ws        --slug "<text>"     URL-friendly slug\n';
  return msg;
}

// ── Action dispatch table ───────────────────────────────────────────

function ok(action, text, output, message) {
  return { success: true, result: { action, input: text, output }, message };
}

function fail(msg) {
  return { success: false, result: { error: msg }, message: "Error: " + msg };
}

function noText(flag) {
  return fail("No text provided. Usage: --" + flag + ' "<text>"');
}

const ACTIONS = {
  "base64-encode": (text) =>
    ok(
      "base64-encode",
      text,
      Buffer.from(text, "utf-8").toString("base64"),
      "Base64 encoded: " + Buffer.from(text, "utf-8").toString("base64"),
    ),

  "base64-decode": (text) =>
    ok(
      "base64-decode",
      text,
      Buffer.from(text, "base64").toString("utf-8"),
      "Base64 decoded: " + Buffer.from(text, "base64").toString("utf-8"),
    ),

  "url-encode": (text) =>
    ok(
      "url-encode",
      text,
      encodeURIComponent(text),
      "URL encoded: " + encodeURIComponent(text),
    ),

  "url-decode": (text) =>
    ok(
      "url-decode",
      text,
      decodeURIComponent(text),
      "URL decoded: " + decodeURIComponent(text),
    ),

  "html-encode": (text) => {
    const encoded = text.replace(/[&<>"']/g, (ch) => HTML_ENCODE_MAP[ch] || ch);
    return ok("html-encode", text, encoded, "HTML encoded: " + encoded);
  },

  "html-decode": (text) => {
    const decoded = text.replace(
      /&(?:amp|lt|gt|quot|#39|#x27|#x2F|apos);/g,
      (entity) => HTML_DECODE_MAP[entity] || entity,
    );
    return ok("html-decode", text, decoded, "HTML decoded: " + decoded);
  },

  upper: (text) =>
    ok("upper", text, text.toUpperCase(), "Uppercase: " + text.toUpperCase()),
  lower: (text) =>
    ok("lower", text, text.toLowerCase(), "Lowercase: " + text.toLowerCase()),
  title: (text) => {
    const r = toTitleCase(text);
    return ok("title", text, r, "Title Case: " + r);
  },
  camel: (text) => {
    const r = toCamelCase(text);
    return ok("camel", text, r, "camelCase: " + r);
  },
  snake: (text) => {
    const r = toSnakeCase(text);
    return ok("snake", text, r, "snake_case: " + r);
  },
  kebab: (text) => {
    const r = toKebabCase(text);
    return ok("kebab", text, r, "kebab-case: " + r);
  },

  reverse: (text) => {
    const r = text.split("").reverse().join("");
    return ok("reverse", text, r, "Reversed: " + r);
  },

  count: (text) => {
    const chars = text.length;
    const words = text.split(/\s+/).filter((w) => w.length > 0).length;
    const lines = text.split("\n").length;
    return ok(
      "count",
      text,
      { characters: chars, words, lines },
      "Count\n  Characters: " +
        chars +
        "\n  Words: " +
        words +
        "\n  Lines: " +
        lines,
    );
  },

  trim: (text) => {
    const r = text.trim();
    return ok("trim", text, r, "Trimmed: " + JSON.stringify(r));
  },

  slug: (text) => {
    const r = toSlug(text);
    return ok("slug", text, r, "Slug: " + r);
  },
};

// ── Detect which action the user invoked ────────────────────────────

function detectAction(input) {
  const flags = [
    "base64-encode",
    "base64-decode",
    "url-encode",
    "url-decode",
    "html-encode",
    "html-decode",
    "hash",
    "upper",
    "lower",
    "title",
    "camel",
    "snake",
    "kebab",
    "reverse",
    "count",
    "trim",
    "slug",
  ];
  for (const flag of flags) {
    if (new RegExp("--" + flag + "\\b", "i").test(input)) {
      return flag;
    }
  }
  return null;
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      "[text-transformer] init: " + (skill?.name || "text-transformer"),
    );
  },

  async execute(task, context, _skill) {
    const input = (
      task?.params?.input ||
      task?.input ||
      task?.action ||
      ""
    ).trim();
    const _projectRoot =
      context?.projectRoot ||
      context?.workspaceRoot ||
      context?.workspacePath ||
      process.cwd();

    if (!input) {
      return {
        success: true,
        result: { usage: true },
        message: usageMessage(),
      };
    }

    try {
      const action = detectAction(input);
      if (!action) {
        return {
          success: false,
          result: { error: "Unknown action" },
          message:
            "Unknown action. Run /text-transformer with no arguments to see usage.\n\n" +
            usageMessage(),
        };
      }

      // Special handling for --hash (supports --algo flag)
      if (action === "hash") {
        const algo = (extractFlag(input, "algo") || "sha256").toLowerCase();
        const supported = ["md5", "sha1", "sha256", "sha512"];
        if (!supported.includes(algo)) {
          return fail(
            "Unsupported algorithm '" +
              algo +
              "'. Supported: " +
              supported.join(", "),
          );
        }
        const text = extractText(input, /--hash\s*/i);
        if (!text) {
          return noText("hash");
        }
        const hash = crypto
          .createHash(algo)
          .update(text, "utf-8")
          .digest("hex");
        return {
          success: true,
          result: {
            action: "hash",
            algorithm: algo,
            input: text,
            output: hash,
          },
          message: algo.toUpperCase() + ": " + hash,
        };
      }

      // All other actions: extract text and dispatch
      const text = extractText(input, new RegExp("--" + action + "\\s*", "i"));
      if (!text && action !== "trim") {
        return noText(action);
      }
      if (action === "trim" && !text && text !== "") {
        return noText(action);
      }

      return ACTIONS[action](text);
    } catch (err) {
      logger.error("[text-transformer] Error:", err);
      return {
        success: false,
        result: { error: err.message },
        message: "Text transformer failed: " + err.message,
      };
    }
  },
};
