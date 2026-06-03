/**
 * Multi Search Engine Skill Handler
 *
 * Zero-config multi-engine search aggregating 17 search engines
 * (8 Chinese + 9 international) without API keys.
 * Generates search URLs with encoded parameters for web_fetch.
 */

const { logger } = require("../../../../../utils/logger.js");

const _deps = { logger };

// ── Engine Definitions ──────────────────────────────────────────────

const ENGINES = {
  // Chinese engines (8)
  baidu: {
    name: "Baidu",
    key: "baidu",
    region: "cn",
    privacy: false,
    buildUrl: (q, opts) =>
      `https://www.baidu.com/s?wd=${q}${timeParam("baidu", opts.time)}`,
  },
  "bing-cn": {
    name: "Bing CN",
    key: "bing-cn",
    region: "cn",
    privacy: false,
    buildUrl: (q, opts) =>
      `https://cn.bing.com/search?q=${q}&ensearch=0${timeParam("bing", opts.time)}`,
  },
  bing: {
    name: "Bing International",
    key: "bing",
    region: "intl",
    privacy: false,
    buildUrl: (q, opts) =>
      `https://www.bing.com/search?q=${q}${timeParam("bing", opts.time)}`,
  },
  360: {
    name: "360 Search",
    key: "360",
    region: "cn",
    privacy: false,
    buildUrl: (q) => `https://www.so.com/s?q=${q}`,
  },
  sogou: {
    name: "Sogou",
    key: "sogou",
    region: "cn",
    privacy: false,
    buildUrl: (q) => `https://www.sogou.com/web?query=${q}`,
  },
  wechat: {
    name: "WeChat",
    key: "wechat",
    region: "cn",
    privacy: false,
    buildUrl: (q) => `https://weixin.sogou.com/weixin?type=2&query=${q}`,
  },
  toutiao: {
    name: "Toutiao",
    key: "toutiao",
    region: "cn",
    privacy: false,
    buildUrl: (q) => `https://so.toutiao.com/search?keyword=${q}`,
  },
  jisilu: {
    name: "Jisilu",
    key: "jisilu",
    region: "cn",
    privacy: false,
    buildUrl: (q) => `https://www.jisilu.cn/search/?q=${q}`,
  },

  // International engines (9)
  google: {
    name: "Google",
    key: "google",
    region: "intl",
    privacy: false,
    buildUrl: (q, opts) =>
      `https://www.google.com/search?q=${q}${timeParam("google", opts.time)}`,
  },
  "google-hk": {
    name: "Google HK",
    key: "google-hk",
    region: "intl",
    privacy: false,
    buildUrl: (q, opts) =>
      `https://www.google.com.hk/search?q=${q}${timeParam("google", opts.time)}`,
  },
  ddg: {
    name: "DuckDuckGo",
    key: "ddg",
    region: "intl",
    privacy: true,
    buildUrl: (q, opts) =>
      `https://duckduckgo.com/?q=${q}${timeParam("ddg", opts.time)}`,
  },
  yahoo: {
    name: "Yahoo",
    key: "yahoo",
    region: "intl",
    privacy: false,
    buildUrl: (q) => `https://search.yahoo.com/search?p=${q}`,
  },
  startpage: {
    name: "Startpage",
    key: "startpage",
    region: "intl",
    privacy: true,
    buildUrl: (q, opts) =>
      `https://www.startpage.com/do/dsearch?query=${q}${timeParam("startpage", opts.time)}`,
  },
  brave: {
    name: "Brave Search",
    key: "brave",
    region: "intl",
    privacy: true,
    buildUrl: (q, opts) =>
      `https://search.brave.com/search?q=${q}${timeParam("brave", opts.time)}`,
  },
  ecosia: {
    name: "Ecosia",
    key: "ecosia",
    region: "intl",
    privacy: false,
    buildUrl: (q) => `https://www.ecosia.org/search?q=${q}`,
  },
  qwant: {
    name: "Qwant",
    key: "qwant",
    region: "intl",
    privacy: true,
    buildUrl: (q) => `https://www.qwant.com/?q=${q}`,
  },
  wolfram: {
    name: "WolframAlpha",
    key: "wolfram",
    region: "intl",
    privacy: false,
    buildUrl: (q) => `https://www.wolframalpha.com/input?i=${q}`,
  },
};

const DEFAULT_ENGINES = ["google", "baidu", "ddg", "bing", "brave"];
const CHINESE_ENGINES = Object.keys(ENGINES).filter(
  (k) => ENGINES[k].region === "cn",
);
const INTL_ENGINES = Object.keys(ENGINES).filter(
  (k) => ENGINES[k].region === "intl",
);
const PRIVACY_ENGINES = Object.keys(ENGINES).filter((k) => ENGINES[k].privacy);

// ── Time filter parameter builders ──────────────────────────────────

function timeParam(engine, time) {
  if (!time) {
    return "";
  }
  const map = {
    google: {
      hour: "&tbs=qdr:h",
      day: "&tbs=qdr:d",
      week: "&tbs=qdr:w",
      month: "&tbs=qdr:m",
      year: "&tbs=qdr:y",
    },
    bing: {
      day: "&filters=ex1%3a%22ez1%22",
      week: "&filters=ex1%3a%22ez2%22",
      month: "&filters=ex1%3a%22ez3%22",
    },
    ddg: { day: "&df=d", week: "&df=w", month: "&df=m", year: "&df=y" },
    baidu: {
      hour: "&gpc=stf%3D1h",
      day: "&gpc=stf%3D1d",
      week: "&gpc=stf%3D7d",
      month: "&gpc=stf%3D30d",
    },
    startpage: {
      day: "&with_date=d",
      week: "&with_date=w",
      month: "&with_date=m",
      year: "&with_date=y",
    },
    brave: { day: "&tf=pd", week: "&tf=pw", month: "&tf=pm", year: "&tf=py" },
  };
  return (map[engine] && map[engine][time]) || "";
}

// ── Input Parser ────────────────────────────────────────────────────

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { engines: DEFAULT_ENGINES, query: "", options: {} };
  }

  const trimmed = input.trim();
  const options = {};
  let engines = DEFAULT_ENGINES;
  const queryParts = [];

  const parts = trimmed.split(/\s+/);
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "--engine" && parts[i + 1]) {
      engines = parts[i + 1].split(",").map((e) => e.trim().toLowerCase());
      i++;
    } else if (p === "--all") {
      engines = Object.keys(ENGINES);
    } else if (p === "--chinese") {
      engines = CHINESE_ENGINES;
    } else if (p === "--international" || p === "--intl") {
      engines = INTL_ENGINES;
    } else if (p === "--privacy") {
      engines = PRIVACY_ENGINES;
    } else if (p === "--time" && parts[i + 1]) {
      options.time = parts[i + 1].toLowerCase();
      i++;
    } else if (!p.startsWith("--")) {
      queryParts.push(p);
    }
  }

  return { engines, query: queryParts.join(" "), options };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    _deps.logger.info("[MultiSearchEngine] Initialized with 17 engines");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const { engines, query, options } = parseInput(input);

    if (!query) {
      return {
        success: false,
        error: "No search query provided.",
        message:
          "Usage: /multi-search-engine <query>\n\n" +
          "Options:\n" +
          "  --engine google,baidu   Search specific engines\n" +
          "  --all                   Search all 17 engines\n" +
          "  --chinese               Search Chinese engines only\n" +
          "  --international         Search international engines only\n" +
          "  --privacy               Search privacy-focused engines\n" +
          "  --time hour|day|week|month|year   Time filter\n\n" +
          "Engines: " +
          Object.keys(ENGINES).join(", "),
      };
    }

    const encodedQuery = encodeURIComponent(query);
    const results = [];
    const invalidEngines = [];

    for (const engineKey of engines) {
      const engine = ENGINES[engineKey];
      if (!engine) {
        invalidEngines.push(engineKey);
        continue;
      }
      const url = engine.buildUrl(encodedQuery, options);
      results.push({
        engine: engine.name,
        key: engine.key,
        region: engine.region,
        privacy: engine.privacy,
        url,
      });
    }

    _deps.logger.info(
      `[MultiSearchEngine] Query: "${query}" across ${results.length} engines`,
    );

    let msg =
      `Multi Search Engine Results\n${"=".repeat(30)}\n` +
      `Query: "${query}"\n` +
      `Engines: ${results.length}` +
      (options.time ? ` | Time: ${options.time}` : "") +
      "\n\n";

    for (const r of results) {
      const privacyTag = r.privacy ? " [Privacy]" : "";
      msg += `${r.engine}${privacyTag} (${r.region}):\n  ${r.url}\n\n`;
    }

    if (invalidEngines.length > 0) {
      msg += `Unknown engines: ${invalidEngines.join(", ")}\n`;
      msg += `Available: ${Object.keys(ENGINES).join(", ")}\n`;
    }

    msg += "Tip: Use web_fetch() to retrieve content from any URL above.";

    return {
      success: true,
      result: { query, results, invalidEngines, options },
      message: msg,
    };
  },

  _deps,
  _ENGINES: ENGINES,
  _DEFAULT_ENGINES: DEFAULT_ENGINES,
};
