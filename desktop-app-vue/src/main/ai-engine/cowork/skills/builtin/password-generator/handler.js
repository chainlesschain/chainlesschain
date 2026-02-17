/**
 * Password Generator Skill Handler
 *
 * Cryptographically secure generation of passwords, passphrases, PINs,
 * API tokens, and UUIDs. Includes password strength analysis with
 * entropy calculation and crack-time estimation.
 *
 * All randomness sourced from Node.js crypto.randomBytes / crypto.randomInt.
 */

const crypto = require("crypto");
const { logger } = require("../../../../../utils/logger.js");

// ── Built-in word list (~200 common English words for passphrases) ───

const WORD_LIST = [
  "abandon",
  "ability",
  "able",
  "about",
  "above",
  "absent",
  "absorb",
  "abstract",
  "accept",
  "access",
  "acid",
  "across",
  "action",
  "active",
  "actual",
  "adapt",
  "adjust",
  "admit",
  "adult",
  "advance",
  "advice",
  "afford",
  "agent",
  "agree",
  "ahead",
  "alarm",
  "album",
  "alert",
  "alien",
  "almost",
  "alone",
  "alpha",
  "alter",
  "always",
  "anchor",
  "angel",
  "angle",
  "animal",
  "annual",
  "answer",
  "apple",
  "arena",
  "armor",
  "army",
  "arrow",
  "artist",
  "asset",
  "atom",
  "audit",
  "august",
  "autumn",
  "avocado",
  "badge",
  "balance",
  "bamboo",
  "banana",
  "banner",
  "basket",
  "battle",
  "beach",
  "beacon",
  "below",
  "bench",
  "betray",
  "bitter",
  "blade",
  "blanket",
  "blast",
  "blaze",
  "blend",
  "bless",
  "blind",
  "block",
  "bloom",
  "board",
  "bonus",
  "border",
  "bottle",
  "bounce",
  "brave",
  "breeze",
  "bridge",
  "bright",
  "broken",
  "bronze",
  "bubble",
  "bucket",
  "budget",
  "bundle",
  "burden",
  "butter",
  "cabin",
  "cactus",
  "camera",
  "campus",
  "candle",
  "canyon",
  "carbon",
  "carpet",
  "castle",
  "catalog",
  "catch",
  "cattle",
  "cedar",
  "center",
  "century",
  "cereal",
  "chain",
  "chair",
  "change",
  "charge",
  "cherry",
  "chicken",
  "chief",
  "chimney",
  "choice",
  "chunk",
  "circle",
  "citizen",
  "civil",
  "claim",
  "clever",
  "clinic",
  "clock",
  "closet",
  "cloud",
  "cluster",
  "coach",
  "cobra",
  "coconut",
  "coffee",
  "comet",
  "common",
  "complex",
  "connect",
  "coral",
  "corner",
  "cotton",
  "council",
  "country",
  "couple",
  "course",
  "cousin",
  "cover",
  "cradle",
  "craft",
  "crater",
  "credit",
  "creek",
  "cricket",
  "crisis",
  "crisp",
  "cross",
  "crowd",
  "cruise",
  "crystal",
  "curtain",
  "cycle",
  "damage",
  "danger",
  "dawn",
  "debate",
  "decade",
  "defense",
  "deliver",
  "demand",
  "denial",
  "dentist",
  "desert",
  "device",
  "diamond",
  "diesel",
  "differ",
  "digital",
  "dinner",
  "direct",
  "divide",
  "doctor",
  "dolphin",
  "domain",
  "donate",
  "double",
  "dragon",
  "dream",
  "drift",
  "drum",
  "during",
  "eagle",
  "earth",
  "echo",
  "effort",
  "electric",
  "elegant",
  "element",
  "elevator",
  "embark",
  "emerge",
  "empire",
  "enable",
  "endure",
  "energy",
  "enforce",
  "engage",
  "engine",
  "enjoy",
  "enough",
  "enrich",
  "ensure",
  "entire",
  "entry",
  "episode",
  "equal",
  "erosion",
  "escape",
  "estate",
  "eternal",
  "evolve",
  "exact",
  "example",
  "excess",
  "exile",
  "expand",
  "explore",
  "export",
  "fabric",
  "falcon",
  "family",
  "famous",
  "fancy",
  "fantasy",
  "fashion",
  "father",
  "feature",
  "fence",
  "festival",
  "fiber",
  "fiction",
  "filter",
  "finger",
  "flame",
  "flavor",
  "flight",
  "float",
  "flower",
  "fluid",
  "focus",
  "forest",
  "forget",
  "fortune",
  "fossil",
  "founder",
  "fragile",
  "frame",
  "frozen",
  "fruit",
  "gadget",
  "galaxy",
  "garden",
  "garlic",
  "gather",
  "gentle",
  "ghost",
  "giant",
  "glacier",
  "glimpse",
  "global",
  "golden",
  "gospel",
  "gossip",
  "govern",
  "grace",
  "grain",
];

// ── Secure random helpers ────────────────────────────────────────────

function _secureRandomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function secureRandomChoice(arr) {
  return arr[crypto.randomInt(0, arr.length)];
}

function secureRandomBytes(length) {
  return crypto.randomBytes(length);
}

// ── Password generation ──────────────────────────────────────────────

function generatePassword(length, options = {}) {
  const lower = "abcdefghijklmnopqrstuvwxyz";
  const upper = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  const digits = "0123456789";
  const symbols = "!@#$%^&*()-_=+[]{}|;:,.<>?";

  let charset = lower;
  const required = [lower[crypto.randomInt(0, lower.length)]];

  if (!options.noUppercase) {
    charset += upper;
    required.push(upper[crypto.randomInt(0, upper.length)]);
  }
  if (!options.noNumbers) {
    charset += digits;
    required.push(digits[crypto.randomInt(0, digits.length)]);
  }
  if (!options.noSymbols) {
    charset += symbols;
    required.push(symbols[crypto.randomInt(0, symbols.length)]);
  }

  const remaining = Math.max(0, length - required.length);
  const chars = [...required];

  for (let i = 0; i < remaining; i++) {
    chars.push(charset[crypto.randomInt(0, charset.length)]);
  }

  // Fisher-Yates shuffle with secure random
  for (let i = chars.length - 1; i > 0; i--) {
    const j = crypto.randomInt(0, i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }

  return chars.join("");
}

// ── Passphrase generation ────────────────────────────────────────────

function generatePassphrase(wordCount, separator) {
  const words = [];
  for (let i = 0; i < wordCount; i++) {
    words.push(secureRandomChoice(WORD_LIST));
  }
  return words.join(separator);
}

// ── PIN generation ───────────────────────────────────────────────────

function generatePin(length) {
  const digits = [];
  for (let i = 0; i < length; i++) {
    digits.push(String(crypto.randomInt(0, 10)));
  }
  return digits.join("");
}

// ── Token generation ─────────────────────────────────────────────────

function generateToken(length, format) {
  const bytes = secureRandomBytes(length);
  switch (format) {
    case "hex":
      return bytes.toString("hex");
    case "base64":
      return bytes.toString("base64");
    case "urlsafe":
      return bytes
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");
    default:
      return bytes.toString("hex");
  }
}

// ── UUID v4 generation ───────────────────────────────────────────────

function generateUUID() {
  if (crypto.randomUUID) {
    return crypto.randomUUID();
  }
  const bytes = secureRandomBytes(16);
  bytes[6] = (bytes[6] & 0x0f) | 0x40;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

// ── Password strength check ─────────────────────────────────────────

function checkPasswordStrength(password) {
  const length = password.length;

  let charsetSize = 0;
  const hasLower = /[a-z]/.test(password);
  const hasUpper = /[A-Z]/.test(password);
  const hasDigits = /[0-9]/.test(password);
  const hasSymbols = /[^a-zA-Z0-9]/.test(password);

  if (hasLower) {
    charsetSize += 26;
  }
  if (hasUpper) {
    charsetSize += 26;
  }
  if (hasDigits) {
    charsetSize += 10;
  }
  if (hasSymbols) {
    charsetSize += 33;
  }

  const charsetDiversity =
    (hasLower ? 1 : 0) +
    (hasUpper ? 1 : 0) +
    (hasDigits ? 1 : 0) +
    (hasSymbols ? 1 : 0);

  const entropyBits = charsetSize > 0 ? length * Math.log2(charsetSize) : 0;
  const roundedEntropy = Math.round(entropyBits * 10) / 10;

  // Estimated crack time at 10 billion guesses/second
  const guessesPerSecond = 1e10;
  const totalCombinations = Math.pow(charsetSize, length);
  const secondsToCrack = totalCombinations / (2 * guessesPerSecond);

  let crackTime;
  if (secondsToCrack < 1) {
    crackTime = "instant";
  } else if (secondsToCrack < 60) {
    crackTime = Math.round(secondsToCrack) + " seconds";
  } else if (secondsToCrack < 3600) {
    crackTime = Math.round(secondsToCrack / 60) + " minutes";
  } else if (secondsToCrack < 86400) {
    crackTime = Math.round(secondsToCrack / 3600) + " hours";
  } else if (secondsToCrack < 31536000) {
    crackTime = Math.round(secondsToCrack / 86400) + " days";
  } else if (secondsToCrack < 31536000 * 1000) {
    crackTime = Math.round(secondsToCrack / 31536000) + " years";
  } else if (secondsToCrack < 31536000 * 1e6) {
    crackTime =
      Math.round(secondsToCrack / (31536000 * 1000)) + " thousand years";
  } else if (secondsToCrack < 31536000 * 1e9) {
    crackTime =
      Math.round(secondsToCrack / (31536000 * 1e6)) + " million years";
  } else {
    crackTime = "billions of years+";
  }

  let rating;
  if (roundedEntropy < 28) {
    rating = "weak";
  } else if (roundedEntropy < 48) {
    rating = "fair";
  } else if (roundedEntropy < 66) {
    rating = "good";
  } else if (roundedEntropy < 100) {
    rating = "strong";
  } else {
    rating = "excellent";
  }

  // Common pattern warnings
  const warnings = [];
  if (length < 8) {
    warnings.push("Too short (minimum 8 recommended)");
  }
  if (/^[a-z]+$/i.test(password)) {
    warnings.push("Letters only - add digits and symbols");
  }
  if (/^[0-9]+$/.test(password)) {
    warnings.push("Digits only - easily brute-forced");
  }
  if (/(.)\1{2,}/.test(password)) {
    warnings.push("Repeated characters detected");
  }
  if (/^(abc|123|qwerty|password|admin)/i.test(password)) {
    warnings.push("Common pattern detected");
  }
  if (charsetDiversity < 2) {
    warnings.push("Low charset diversity - use mixed character types");
  }

  return {
    length,
    charsetSize,
    charsetDiversity,
    hasLower,
    hasUpper,
    hasDigits,
    hasSymbols,
    entropyBits: roundedEntropy,
    estimatedCrackTime: crackTime,
    rating,
    warnings,
  };
}

// ── Input parsing ────────────────────────────────────────────────────

function parseArgs(input) {
  const args = {
    action: null,
    length: null,
    count: null,
    words: null,
    separator: null,
    format: null,
    type: null,
    password: null,
    noSymbols: false,
    noNumbers: false,
    noUppercase: false,
  };

  if (!input) {
    return args;
  }

  // Detect action
  if (/--generate\b/.test(input)) {
    args.action = "generate";
  } else if (/--passphrase\b/.test(input)) {
    args.action = "passphrase";
  } else if (/--pin\b/.test(input)) {
    args.action = "pin";
  } else if (/--token\b/.test(input)) {
    args.action = "token";
  } else if (/--uuid\b/.test(input)) {
    args.action = "uuid";
  } else if (/--check\b/.test(input)) {
    args.action = "check";
  } else if (/--batch\b/.test(input)) {
    args.action = "batch";
  }

  // Parse options
  const lengthMatch = input.match(/--length\s+(\d+)/);
  if (lengthMatch) {
    args.length = parseInt(lengthMatch[1]);
  }

  const countMatch = input.match(/--count\s+(\d+)/);
  if (countMatch) {
    args.count = parseInt(countMatch[1]);
  }

  const wordsMatch = input.match(/--words\s+(\d+)/);
  if (wordsMatch) {
    args.words = parseInt(wordsMatch[1]);
  }

  const sepMatch = input.match(/--separator\s+(\S+)/);
  if (sepMatch) {
    args.separator = sepMatch[1];
  }

  const formatMatch = input.match(/--format\s+(\S+)/);
  if (formatMatch) {
    args.format = formatMatch[1];
  }

  const typeMatch = input.match(/--type\s+(\S+)/);
  if (typeMatch) {
    args.type = typeMatch[1];
  }

  // Extract password for --check (quoted or unquoted)
  const checkMatch = input.match(/--check\s+["']([^"']+)["']/);
  if (checkMatch) {
    args.password = checkMatch[1];
  } else {
    const checkUnquoted = input.match(/--check\s+(\S+)/);
    if (checkUnquoted && checkUnquoted[1] !== "--") {
      args.password = checkUnquoted[1];
    }
  }

  if (/--no-symbols\b/.test(input)) {
    args.noSymbols = true;
  }
  if (/--no-numbers\b/.test(input)) {
    args.noNumbers = true;
  }
  if (/--no-uppercase\b/.test(input)) {
    args.noUppercase = true;
  }

  return args;
}

// ── Handler ──────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      "[password-generator] init: " + (skill?.name || "password-generator"),
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

    const args = parseArgs(input);

    try {
      switch (args.action) {
        case "generate":
          return handleGenerate(args);
        case "passphrase":
          return handlePassphrase(args);
        case "pin":
          return handlePin(args);
        case "token":
          return handleToken(args);
        case "uuid":
          return handleUUID(args);
        case "check":
          return handleCheck(args);
        case "batch":
          return handleBatch(args);
        default:
          return handleGenerate({ ...args, length: 16, count: 1 });
      }
    } catch (err) {
      logger.error("[password-generator] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Password generation failed: " + err.message,
      };
    }
  },
};

// ── Action handlers ──────────────────────────────────────────────────

function handleGenerate(args) {
  const length = Math.max(4, Math.min(args.length || 16, 256));
  const count = Math.max(1, Math.min(args.count || 1, 50));
  const options = {
    noSymbols: args.noSymbols,
    noNumbers: args.noNumbers,
    noUppercase: args.noUppercase,
  };

  const passwords = [];
  for (let i = 0; i < count; i++) {
    passwords.push(generatePassword(length, options));
  }

  const charsets = [];
  charsets.push("lowercase");
  if (!options.noUppercase) {
    charsets.push("uppercase");
  }
  if (!options.noNumbers) {
    charsets.push("digits");
  }
  if (!options.noSymbols) {
    charsets.push("symbols");
  }

  let msg = "Password Generator\n" + "=".repeat(30) + "\n";
  msg +=
    "Length: " +
    length +
    " | Count: " +
    count +
    " | Charsets: " +
    charsets.join(", ") +
    "\n\n";
  passwords.forEach((pw, i) => {
    msg += (count > 1 ? "  " + (i + 1) + ". " : "  ") + pw + "\n";
  });

  const strength = checkPasswordStrength(passwords[0]);
  msg += "\nStrength: " + strength.rating.toUpperCase();
  msg += " (" + strength.entropyBits + " bits entropy)";
  msg += "\nEstimated crack time: " + strength.estimatedCrackTime;

  return {
    success: true,
    result: { passwords, length, count, charsets, strength },
    message: msg,
  };
}

function handlePassphrase(args) {
  const words = Math.max(3, Math.min(args.words || 4, 12));
  const separator = args.separator || "-";
  const count = Math.max(1, Math.min(args.count || 1, 50));

  const passphrases = [];
  for (let i = 0; i < count; i++) {
    passphrases.push(generatePassphrase(words, separator));
  }

  const entropyPerWord = Math.log2(WORD_LIST.length);
  const totalEntropy = Math.round(words * entropyPerWord * 10) / 10;

  let msg = "Passphrase Generator\n" + "=".repeat(30) + "\n";
  msg +=
    "Words: " +
    words +
    " | Separator: '" +
    separator +
    "' | Word list: " +
    WORD_LIST.length +
    " words\n\n";
  passphrases.forEach((pp, i) => {
    msg += (count > 1 ? "  " + (i + 1) + ". " : "  ") + pp + "\n";
  });
  msg += "\nEntropy: " + totalEntropy + " bits";
  msg += " (" + entropyPerWord.toFixed(1) + " bits/word)";

  return {
    success: true,
    result: { passphrases, words, separator, entropyBits: totalEntropy },
    message: msg,
  };
}

function handlePin(args) {
  const length = Math.max(4, Math.min(args.length || 6, 20));
  const count = Math.max(1, Math.min(args.count || 1, 50));

  const pins = [];
  for (let i = 0; i < count; i++) {
    pins.push(generatePin(length));
  }

  const entropy = Math.round(length * Math.log2(10) * 10) / 10;

  let msg = "PIN Generator\n" + "=".repeat(30) + "\n";
  msg += "Length: " + length + " digits | Count: " + count + "\n\n";
  pins.forEach((pin, i) => {
    msg += (count > 1 ? "  " + (i + 1) + ". " : "  ") + pin + "\n";
  });
  msg += "\nEntropy: " + entropy + " bits";

  return {
    success: true,
    result: { pins, length, count, entropyBits: entropy },
    message: msg,
  };
}

function handleToken(args) {
  const length = Math.max(8, Math.min(args.length || 32, 512));
  const format = ["hex", "base64", "urlsafe"].includes(args.format)
    ? args.format
    : "hex";

  const token = generateToken(length, format);
  const entropy = length * 8;

  let msg = "Token Generator\n" + "=".repeat(30) + "\n";
  msg +=
    "Bytes: " +
    length +
    " | Format: " +
    format +
    " | Entropy: " +
    entropy +
    " bits\n\n";
  msg += "  " + token + "\n";

  return {
    success: true,
    result: { token, bytes: length, format, entropyBits: entropy },
    message: msg,
  };
}

function handleUUID(args) {
  const count = Math.max(1, Math.min(args.count || 1, 50));

  const uuids = [];
  for (let i = 0; i < count; i++) {
    uuids.push(generateUUID());
  }

  let msg = "UUID v4 Generator\n" + "=".repeat(30) + "\n";
  msg += "Count: " + count + " | Entropy: 122 bits per UUID\n\n";
  uuids.forEach((id, i) => {
    msg += (count > 1 ? "  " + (i + 1) + ". " : "  ") + id + "\n";
  });

  return {
    success: true,
    result: { uuids, count },
    message: msg,
  };
}

function handleCheck(args) {
  const password = args.password || "";
  if (!password) {
    return {
      success: false,
      error: "No password provided",
      message: 'Usage: --check "<password>"',
    };
  }

  const strength = checkPasswordStrength(password);

  const ratingIcons = {
    weak: "[WEAK]",
    fair: "[FAIR]",
    good: "[GOOD]",
    strong: "[STRONG]",
    excellent: "[EXCELLENT]",
  };

  let msg = "Password Strength Check\n" + "=".repeat(30) + "\n";
  msg +=
    "Password: " +
    "*".repeat(Math.min(password.length, 30)) +
    " (" +
    password.length +
    " chars)\n\n";
  msg +=
    "Rating: " +
    ratingIcons[strength.rating] +
    " " +
    strength.rating.toUpperCase() +
    "\n";
  msg += "Entropy: " + strength.entropyBits + " bits\n";
  msg += "Charset size: " + strength.charsetSize + " characters\n";
  msg += "Charset diversity: " + strength.charsetDiversity + "/4";
  msg += " (";
  const sets = [];
  if (strength.hasLower) {
    sets.push("lower");
  }
  if (strength.hasUpper) {
    sets.push("upper");
  }
  if (strength.hasDigits) {
    sets.push("digits");
  }
  if (strength.hasSymbols) {
    sets.push("symbols");
  }
  msg += sets.join(", ") + ")\n";
  msg += "Estimated crack time: " + strength.estimatedCrackTime + "\n";

  if (strength.warnings.length > 0) {
    msg += "\nWarnings:\n";
    strength.warnings.forEach((w) => {
      msg += "  - " + w + "\n";
    });
  }

  return {
    success: true,
    result: strength,
    message: msg,
  };
}

function handleBatch(args) {
  const type = args.type || "password";
  const count = Math.max(1, Math.min(args.count || 5, 100));

  const validTypes = ["password", "passphrase", "pin", "token"];
  if (!validTypes.includes(type)) {
    return {
      success: false,
      error: "Invalid type: " + type,
      message:
        "Invalid type '" + type + "'. Valid types: " + validTypes.join(", "),
    };
  }

  let items;
  let label;

  switch (type) {
    case "password": {
      items = [];
      for (let i = 0; i < count; i++) {
        items.push(generatePassword(args.length || 16, {}));
      }
      label = "passwords (" + (args.length || 16) + " chars)";
      break;
    }
    case "passphrase": {
      items = [];
      const words = args.words || 4;
      const sep = args.separator || "-";
      for (let i = 0; i < count; i++) {
        items.push(generatePassphrase(words, sep));
      }
      label = "passphrases (" + words + " words)";
      break;
    }
    case "pin": {
      items = [];
      const pinLen = args.length || 6;
      for (let i = 0; i < count; i++) {
        items.push(generatePin(pinLen));
      }
      label = "PINs (" + pinLen + " digits)";
      break;
    }
    case "token": {
      items = [];
      const tokenLen = args.length || 32;
      const fmt = args.format || "hex";
      for (let i = 0; i < count; i++) {
        items.push(generateToken(tokenLen, fmt));
      }
      label = "tokens (" + tokenLen + " bytes, " + (args.format || "hex") + ")";
      break;
    }
  }

  let msg = "Batch Generator\n" + "=".repeat(30) + "\n";
  msg += "Type: " + type + " | Count: " + count + " | " + label + "\n\n";
  items.forEach((item, i) => {
    msg += "  " + (i + 1) + ". " + item + "\n";
  });

  return {
    success: true,
    result: { type, count, items },
    message: msg,
  };
}
