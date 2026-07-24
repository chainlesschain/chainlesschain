"use strict";

// Read JetBrains Platform recent-project metadata from:
//   <config-root>/<product><version>/options/recentProjects.xml
//
// The map keys in this file are absolute project paths. They are reduced to a
// basename plus SHA-256 before leaving this reader. Project files, .idea
// content, window titles, branches, workspace IDs, and IDE Local History are
// never read or returned.
//
// Official persistence source:
// https://github.com/JetBrains/intellij-community/blob/master/platform/platform-impl/src/com/intellij/ide/RecentProjectsManagerBase.kt

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const MAX_RECENT_PROJECTS_XML_BYTES = 8 * 1024 * 1024;
const DEFAULT_MAX_PRODUCT_CONFIGS = 100;
const DEFAULT_MAX_PROJECTS = 100_000;

const PRODUCT_NAMES = Object.freeze({
  IntelliJIdea: "IntelliJ IDEA Ultimate",
  IdeaIC: "IntelliJ IDEA Community",
  WebStorm: "WebStorm",
  PyCharm: "PyCharm Professional",
  PyCharmCE: "PyCharm Community",
  GoLand: "GoLand",
  PhpStorm: "PhpStorm",
  RubyMine: "RubyMine",
  CLion: "CLion",
  DataGrip: "DataGrip",
  DataSpell: "DataSpell",
  Rider: "Rider",
  RustRover: "RustRover",
  Aqua: "Aqua",
  MPS: "MPS",
});

function sha256Hex(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""), "utf8")
    .digest("hex");
}

function positiveInteger(value, fallback) {
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

function defaultJetBrainsConfigRoot() {
  if (process.platform === "win32") {
    return process.env.APPDATA
      ? path.join(process.env.APPDATA, "JetBrains")
      : null;
  }
  if (process.platform === "darwin") {
    return path.join(
      os.homedir(),
      "Library",
      "Application Support",
      "JetBrains",
    );
  }
  return path.join(os.homedir(), ".config", "JetBrains");
}

function canonicalPath(value, fsMod = fs) {
  if (typeof value !== "string" || value.trim().length === 0) return null;
  const resolved = path.resolve(value.trim());
  try {
    const realpath =
      typeof fsMod.realpathSync?.native === "function"
        ? fsMod.realpathSync.native(resolved)
        : fsMod.realpathSync(resolved);
    return path.resolve(realpath);
  } catch {
    return resolved;
  }
}

function normalizeProjectPath(value) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  const normalized = trimmed.replace(/\\/gu, "/").replace(/\/+$/gu, "");
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function boundedText(value, maxLength = 255) {
  if (typeof value !== "string") return "";
  return Array.from(value)
    .filter((character) => {
      const codePoint = character.codePointAt(0);
      return codePoint > 31 && codePoint !== 127;
    })
    .join("")
    .trim()
    .slice(0, maxLength);
}

function decodeXmlEntities(value) {
  return String(value || "").replace(
    /&(?:#(\d+)|#x([0-9a-f]+)|amp|lt|gt|quot|apos);/giu,
    (entity, decimal, hexadecimal) => {
      if (decimal) {
        const codePoint = Number(decimal);
        return Number.isInteger(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : "";
      }
      if (hexadecimal) {
        const codePoint = Number.parseInt(hexadecimal, 16);
        return Number.isInteger(codePoint) &&
          codePoint > 0 &&
          codePoint <= 0x10ffff
          ? String.fromCodePoint(codePoint)
          : "";
      }
      return {
        "&amp;": "&",
        "&lt;": "<",
        "&gt;": ">",
        "&quot;": '"',
        "&apos;": "'",
      }[entity.toLowerCase()];
    },
  );
}

function parseAttributes(source) {
  const attributes = {};
  const pattern = /([A-Za-z_:][A-Za-z0-9_.:-]*)\s*=\s*(["'])(.*?)\2/gsu;
  for (const match of source.matchAll(pattern)) {
    attributes[match[1]] = decodeXmlEntities(match[3]);
  }
  return attributes;
}

function parseTimestamp(value) {
  const numeric = Number(value);
  return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
}

function projectNameFromPath(projectPath) {
  const normalized = String(projectPath || "")
    .replace(/\\/gu, "/")
    .replace(/\/+$/gu, "");
  let name = boundedText(path.posix.basename(normalized), 255);
  if (name.toLowerCase().endsWith(".ipr")) {
    name = name.slice(0, -4);
  }
  return name || "(unnamed project)";
}

function productInfoFromDirectory(productDirectory) {
  const directoryName = boundedText(path.basename(productDirectory), 128);
  const match = /^(.*?)(\d{4}\.\d+(?:\.\d+)*)$/u.exec(directoryName);
  const productKey = boundedText(match?.[1] || directoryName, 64);
  return {
    productKey: productKey || "JetBrains",
    productName: PRODUCT_NAMES[productKey] || productKey || "JetBrains IDE",
    productVersion: boundedText(match?.[2] || "", 32) || null,
    productConfigId: sha256Hex(
      canonicalPath(productDirectory) || productDirectory,
    ),
  };
}

function resolveRecentProjectsFile(candidate, fsMod = fs) {
  const normalized = canonicalPath(candidate, fsMod);
  if (!normalized) return null;
  try {
    if (fsMod.statSync(normalized).isFile()) {
      return path.basename(normalized).toLowerCase() === "recentprojects.xml"
        ? normalized
        : null;
    }
  } catch {
    return null;
  }
  const recentProjectsFile = path.join(
    normalized,
    "options",
    "recentProjects.xml",
  );
  return fsMod.existsSync(recentProjectsFile) ? recentProjectsFile : null;
}

function discoverProductConfigs(configRoot, opts = {}) {
  const fsMod = opts.fs || fs;
  const root = canonicalPath(configRoot, fsMod);
  if (!root || !fsMod.existsSync(root)) {
    return { configs: [], complete: true };
  }

  const directFile = resolveRecentProjectsFile(root, fsMod);
  if (directFile) {
    const productDirectory =
      path.basename(root).toLowerCase() === "recentprojects.xml"
        ? path.dirname(path.dirname(root))
        : root;
    return {
      configs: [
        {
          productDirectory,
          recentProjectsFile: directFile,
          ...productInfoFromDirectory(productDirectory),
        },
      ],
      complete: true,
    };
  }

  const maxProductConfigs = positiveInteger(
    opts.maxProductConfigs,
    DEFAULT_MAX_PRODUCT_CONFIGS,
  );
  let directoryNames;
  try {
    directoryNames = fsMod.readdirSync(root).sort();
  } catch {
    return { configs: [], complete: false };
  }
  let complete = true;
  if (directoryNames.length > maxProductConfigs) {
    directoryNames.length = maxProductConfigs;
    complete = false;
  }

  const configs = [];
  for (const directoryName of directoryNames) {
    const productDirectory = path.join(root, directoryName);
    const recentProjectsFile = resolveRecentProjectsFile(
      productDirectory,
      fsMod,
    );
    if (!recentProjectsFile) continue;
    configs.push({
      productDirectory,
      recentProjectsFile,
      ...productInfoFromDirectory(productDirectory),
    });
  }
  return { configs, complete };
}

function extractAdditionalInfoMap(xml) {
  const openingTagPattern = /<option\b([^>]*)>/giu;
  for (const match of xml.matchAll(openingTagPattern)) {
    const attributes = parseAttributes(match[1]);
    if (attributes.name !== "additionalInfo") continue;
    const mapStart = xml.indexOf("<map", match.index + match[0].length);
    if (mapStart < 0) return null;
    const mapOpeningEnd = xml.indexOf(">", mapStart);
    const mapEnd = xml.indexOf("</map>", mapOpeningEnd + 1);
    if (mapOpeningEnd < 0 || mapEnd < 0) return null;
    return xml.slice(mapOpeningEnd + 1, mapEnd);
  }
  return null;
}

function extractMetaInfo(entryBody) {
  const paired =
    /<RecentProjectMetaInfo\b([^>]*)>([\s\S]*?)<\/RecentProjectMetaInfo>/iu.exec(
      entryBody,
    );
  if (paired) {
    return { attributesSource: paired[1], body: paired[2] };
  }
  const selfClosing = /<RecentProjectMetaInfo\b([^>]*)\/>/iu.exec(entryBody);
  return selfClosing ? { attributesSource: selfClosing[1], body: "" } : null;
}

function parseRecentProjectsXml(xml, context = {}) {
  if (typeof xml !== "string" || /<!DOCTYPE|<!ENTITY/iu.test(xml)) {
    return { projects: [], complete: false };
  }
  const mapBody = extractAdditionalInfoMap(xml);
  if (mapBody == null) return { projects: [], complete: false };

  const projects = [];
  let complete = true;
  let inspectedProjects = 0;
  const maxProjects = positiveInteger(
    context.maxProjects,
    DEFAULT_MAX_PROJECTS,
  );
  const entryPattern = /<entry\b([^>]*)>([\s\S]*?)<\/entry>/giu;
  for (const entryMatch of mapBody.matchAll(entryPattern)) {
    inspectedProjects += 1;
    if (inspectedProjects > maxProjects) {
      complete = false;
      break;
    }
    const entryAttributes = parseAttributes(entryMatch[1]);
    const projectPath = entryAttributes.key;
    const metaInfo = extractMetaInfo(entryMatch[2]);
    if (!projectPath || !metaInfo) {
      complete = false;
      continue;
    }
    const metaAttributes = parseAttributes(metaInfo.attributesSource);
    if (metaAttributes.hidden === "true") continue;

    const options = {};
    const optionPattern = /<option\b([^>]*)\/?>/giu;
    for (const optionMatch of metaInfo.body.matchAll(optionPattern)) {
      const optionAttributes = parseAttributes(optionMatch[1]);
      if (optionAttributes.name && optionAttributes.value != null) {
        options[optionAttributes.name] = optionAttributes.value;
      }
    }
    const lastOpenedMs = parseTimestamp(options.projectOpenTimestamp);
    const lastActivatedMs = parseTimestamp(options.activationTimestamp);
    const capturedAt =
      Math.max(lastOpenedMs || 0, lastActivatedMs || 0) ||
      context.fileMtimeMs ||
      0;
    if (capturedAt <= 0) {
      complete = false;
      continue;
    }

    const normalizedProjectPath = normalizeProjectPath(projectPath);
    projects.push({
      projectId: sha256Hex(normalizedProjectPath),
      projectName: projectNameFromPath(projectPath),
      pathHash: sha256Hex(normalizedProjectPath),
      productConfigId: context.productConfigId,
      productKey: context.productKey,
      productName: context.productName,
      productVersion: context.productVersion,
      productCode: boundedText(options.productionCode, 16) || null,
      lastOpenedMs,
      lastActivatedMs,
      capturedAt,
      timestampSource:
        lastActivatedMs && lastActivatedMs >= (lastOpenedMs || 0)
          ? "activation"
          : lastOpenedMs
            ? "open"
            : "manifest-mtime",
      currentlyOpen: metaAttributes.opened === "true",
    });
  }
  return { projects, complete };
}

function readRecentProjects(configRoot, opts = {}) {
  const fsMod = opts.fs || fs;
  const since = Number.isInteger(opts.since) && opts.since > 0 ? opts.since : 0;
  const limit = positiveInteger(opts.limit, Number.MAX_SAFE_INTEGER);
  const discovered = discoverProductConfigs(configRoot, {
    fs: fsMod,
    maxProductConfigs: opts.maxProductConfigs,
  });
  let complete = discovered.complete;
  const projects = [];

  for (const config of discovered.configs) {
    let stat;
    let xml;
    try {
      stat = fsMod.statSync(config.recentProjectsFile);
      if (
        !stat.isFile() ||
        stat.size <= 0 ||
        stat.size > MAX_RECENT_PROJECTS_XML_BYTES
      ) {
        complete = false;
        continue;
      }
      xml = fsMod.readFileSync(config.recentProjectsFile, "utf8");
    } catch {
      complete = false;
      continue;
    }
    const parsed = parseRecentProjectsXml(xml, {
      ...config,
      fileMtimeMs: Math.floor(stat.mtimeMs),
      maxProjects: opts.maxProjects,
    });
    complete = complete && parsed.complete;
    for (const project of parsed.projects) {
      if (project.capturedAt >= since) projects.push(project);
    }
  }

  projects.sort(
    (a, b) =>
      a.capturedAt - b.capturedAt ||
      a.productConfigId.localeCompare(b.productConfigId) ||
      a.projectId.localeCompare(b.projectId),
  );
  if (projects.length > limit) {
    projects.length = limit;
    complete = false;
  }
  return {
    projects,
    complete,
    productConfigCount: discovered.configs.length,
  };
}

module.exports = {
  defaultJetBrainsConfigRoot,
  discoverProductConfigs,
  parseRecentProjectsXml,
  readRecentProjects,
};
