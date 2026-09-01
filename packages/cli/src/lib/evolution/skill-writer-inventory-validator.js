import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  SKILL_WRITER_INVENTORY,
  SKILL_WRITER_INVENTORY_SCHEMA,
  SKILL_WRITER_SURFACES,
  SKILL_WRITER_TARGET_AUTHORITIES,
  SKILL_WRITER_TRIGGER_CLASSES,
} from "./skill-writer-inventory-manifest.js";

const INVENTORY_DIGEST_DOMAIN =
  "chainlesschain.skill-writer-inventory.digest/v1\0";
const SOURCE_EXTENSIONS = new Set(
  SKILL_WRITER_INVENTORY.scannerScope.sourceExtensions,
);
const EXCLUDED_DIRECTORIES = new Set([
  "node_modules",
  "dist",
  "coverage",
  "__tests__",
  "test",
  "tests",
  "data",
  "templates",
]);
const SKILL_MD_REFERENCE = /\bSKILL\.md\b/u;
const JAVASCRIPT_MUTATION_CALL =
  /\b(?:[A-Za-z_$][\w$]*\.)*(writeFileSync|writeFile|appendFileSync|appendFile|copyFileSync|copyFile|renameSync|rename|rmSync|rm|unlinkSync|unlink|writeSafePackageComponent|hotLoadSkill)\s*\(/u;
const KOTLIN_MUTATION_CALL =
  /\b(?:[A-Za-z_$][\w$]*\.)*(writeText|delete|register|unregister)\s*\(/u;
const SAFE_ID = /^[a-z][a-z0-9-]{2,127}$/u;
const SAFE_RELATIVE_FILE = /^[^\\:]+(?:\/[^\\:]*)*$/u;
const NON_METHOD_KEYWORDS = new Set([
  "catch",
  "for",
  "if",
  "switch",
  "while",
  "with",
]);

const DEFAULT_REPOSITORY_ROOT = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../../..",
);

export class SkillWriterInventoryError extends Error {
  constructor(message, report) {
    super(message);
    this.name = "SkillWriterInventoryError";
    this.code = "SKILL_WRITER_INVENTORY_INVALID";
    this.report = report;
  }
}

function compareStrings(left, right) {
  return String(left).localeCompare(String(right), "en", {
    sensitivity: "case",
  });
}

function canonicalValue(value) {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort(compareStrings)
      .map((key) => [key, canonicalValue(value[key])]),
  );
}

function normalizedEvidence(value) {
  return [...new Set(Array.isArray(value) ? value.map(String) : [])].sort(
    compareStrings,
  );
}

/** Return the order-independent canonical inventory projection. */
export function canonicalSkillWriterInventory(
  inventory = SKILL_WRITER_INVENTORY,
) {
  const writers = Array.isArray(inventory?.writers)
    ? inventory.writers.map((record) => ({
        id: String(record?.id || ""),
        surface: String(record?.surface || ""),
        triggerClass: String(record?.triggerClass || ""),
        targetAuthority: String(record?.targetAuthority || ""),
        mutationType: String(record?.mutationType || ""),
        discoverySymbol:
          record?.discoverySymbol == null
            ? null
            : String(record.discoverySymbol),
        entrypoint: {
          file: String(record?.entrypoint?.file || ""),
          symbol: String(record?.entrypoint?.symbol || ""),
          evidence: normalizedEvidence(record?.entrypoint?.evidence),
        },
        mutation: {
          file: String(record?.mutation?.file || ""),
          symbol: String(record?.mutation?.symbol || ""),
          evidence: normalizedEvidence(record?.mutation?.evidence),
        },
      }))
    : [];
  writers.sort((left, right) => compareStrings(left.id, right.id));
  const scopeExclusions = Array.isArray(inventory?.scopeExclusions)
    ? inventory.scopeExclusions.map((record) => ({
        id: String(record?.id || ""),
        surface: String(record?.surface || ""),
        reasonCode: String(record?.reasonCode || ""),
        evidence: {
          file: String(record?.evidence?.file || ""),
          symbol: String(record?.evidence?.symbol || ""),
          evidence: normalizedEvidence(record?.evidence?.evidence),
        },
      }))
    : [];
  scopeExclusions.sort((left, right) => compareStrings(left.id, right.id));
  const scannerScope = inventory?.scannerScope || {};
  return canonicalValue({
    schema: String(inventory?.schema || ""),
    schemaVersion: Number(inventory?.schemaVersion),
    surfaces: [...new Set((inventory?.surfaces || []).map(String))].sort(
      compareStrings,
    ),
    sourceRoots: [...new Set((inventory?.sourceRoots || []).map(String))].sort(
      compareStrings,
    ),
    scannerScope: {
      classification: String(scannerScope.classification || ""),
      unit: String(scannerScope.unit || ""),
      sourceExtensions: [
        ...new Set((scannerScope.sourceExtensions || []).map(String)),
      ].sort(compareStrings),
      skillBindings: [
        ...new Set((scannerScope.skillBindings || []).map(String)),
      ].sort(compareStrings),
      mutationSinks: [
        ...new Set((scannerScope.mutationSinks || []).map(String)),
      ].sort(compareStrings),
    },
    limitations: [...new Set((inventory?.limitations || []).map(String))].sort(
      compareStrings,
    ),
    scopeExclusions,
    writers,
  });
}

export function skillWriterInventoryDigest(inventory = SKILL_WRITER_INVENTORY) {
  const canonical = JSON.stringify(canonicalSkillWriterInventory(inventory));
  return `sha256:${crypto
    .createHash("sha256")
    .update(INVENTORY_DIGEST_DOMAIN)
    .update(canonical)
    .digest("hex")}`;
}

function posixRelative(value) {
  return String(value).replaceAll("\\", "/");
}

function isContained(root, candidate) {
  const relative = path.relative(root, candidate);
  return (
    relative !== "" &&
    relative !== ".." &&
    !relative.startsWith(`..${path.sep}`) &&
    !path.isAbsolute(relative)
  );
}

function listSourceFiles(repositoryRoot, sourceRoots) {
  const result = [];
  const visit = (directory) => {
    const entries = fs
      .readdirSync(directory, { withFileTypes: true })
      .sort((left, right) => compareStrings(left.name, right.name));
    for (const entry of entries) {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name)) visit(target);
        continue;
      }
      if (
        entry.isFile() &&
        SOURCE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())
      ) {
        result.push(target);
      }
    }
  };
  for (const relativeRoot of sourceRoots) {
    const absoluteRoot = path.resolve(repositoryRoot, relativeRoot);
    if (fs.existsSync(absoluteRoot)) visit(absoluteRoot);
  }
  return result;
}

/**
 * Remove comments and string/template contents while preserving line numbers.
 * Template bodies are intentionally removed wholesale: source text embedded in
 * a generated handler is not a mutation executed by the containing module.
 */
function stripNonCode(source) {
  let state = "code";
  let escaped = false;
  let output = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (state === "line-comment") {
      if (char === "\n") {
        state = "code";
        output += "\n";
      } else output += " ";
      continue;
    }
    if (state === "block-comment") {
      if (char === "*" && next === "/") {
        output += "  ";
        index += 1;
        state = "code";
      } else output += char === "\n" ? "\n" : " ";
      continue;
    }
    if (state !== "code") {
      if (char === "\n") output += "\n";
      else output += " ";
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (
        (state === "single" && char === "'") ||
        (state === "double" && char === '"') ||
        (state === "template" && char === "`")
      ) {
        state = "code";
      }
      continue;
    }
    if (char === "/" && next === "/") {
      output += "  ";
      index += 1;
      state = "line-comment";
    } else if (char === "/" && next === "*") {
      output += "  ";
      index += 1;
      state = "block-comment";
    } else if (char === "'") {
      output += " ";
      state = "single";
    } else if (char === '"') {
      output += " ";
      state = "double";
    } else if (char === "`") {
      output += " ";
      state = "template";
    } else {
      output += char;
    }
  }
  return output;
}

function nearestWriterSymbol(rawLines, codeLines, mutationLine) {
  let best = null;
  const consider = (line, symbol) => {
    if (!symbol || (best && best.line > line)) return;
    best = { line, symbol };
  };
  const lowerBound = Math.max(0, mutationLine - 500);
  for (let line = lowerBound; line <= mutationLine; line += 1) {
    const code = codeLines[line] || "";
    const declaration = code.match(
      /^\s*(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(/u,
    );
    if (declaration) consider(line, declaration[1]);
    const kotlinFunction = code.match(
      /^\s*(?:(?:public|private|protected|internal|override|open|final|tailrec|operator|inline|infix|external|suspend)\s+)*fun\s+([A-Za-z_$][\w$]*)\s*\(/u,
    );
    if (kotlinFunction) consider(line, kotlinFunction[1]);
    const method = code.match(
      /^\s{2}(?:async\s+)?([A-Za-z_$][\w$]*)\s*\([^)]*\)\s*\{/u,
    );
    if (method && !NON_METHOD_KEYWORDS.has(method[1])) {
      consider(line, method[1]);
    }

    const ipcWindow = rawLines.slice(line, line + 4).join("\n");
    const ipc = ipcWindow.match(/ipcMain\.handle\(\s*["']([^"']+)["']/u);
    if (ipc) consider(line, `ipc:${ipc[1]}`);
  }
  return best?.symbol || "<module>";
}

function contextBindsSkillMd(rawLines, mutationLine, completeSource) {
  const start = Math.max(0, mutationLine - 50);
  const end = Math.min(rawLines.length, mutationLine + 51);
  const context = rawLines.slice(start, end).join("\n");
  if (SKILL_MD_REFERENCE.test(context)) return true;
  return (
    /\bPACKAGE_FILES\b/u.test(context) &&
    /\bPACKAGE_FILES\b[\s\S]{0,500}["'`]SKILL\.md["'`]/u.test(completeSource)
  );
}

/**
 * Discover direct production writers independently of the inventory. The
 * scanner works at writer-function/IPC granularity, not call-site line number,
 * so harmless formatting changes do not churn inventory identity.
 */
export function discoverSkillWriterSites({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  sourceRoots = SKILL_WRITER_INVENTORY.sourceRoots,
} = {}) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const discovered = new Map();
  for (const filePath of listSourceFiles(resolvedRoot, sourceRoots)) {
    const source = fs.readFileSync(filePath, "utf8");
    const rawLines = source.split(/\r?\n/u);
    const codeLines = stripNonCode(source).split(/\r?\n/u);
    const mutationCall =
      path.extname(filePath).toLowerCase() === ".kt"
        ? KOTLIN_MUTATION_CALL
        : JAVASCRIPT_MUTATION_CALL;
    for (let line = 0; line < codeLines.length; line += 1) {
      const mutation = codeLines[line].match(mutationCall);
      if (!mutation || !contextBindsSkillMd(rawLines, line, source)) continue;
      const symbol = nearestWriterSymbol(rawLines, codeLines, line);
      const file = posixRelative(path.relative(resolvedRoot, filePath));
      const key = `${file}::${symbol}`;
      const existing = discovered.get(key) || {
        key,
        file,
        symbol,
        operations: new Set(),
      };
      existing.operations.add(mutation[1]);
      discovered.set(key, existing);
    }
  }
  return [...discovered.values()]
    .map((site) => ({
      key: site.key,
      file: site.file,
      symbol: site.symbol,
      operations: [...site.operations].sort(compareStrings),
    }))
    .sort((left, right) => compareStrings(left.key, right.key));
}

function discoveryKeys(inventory) {
  return new Set(
    (inventory?.writers || [])
      .filter((writer) => typeof writer?.discoverySymbol === "string")
      .map(
        (writer) =>
          `${posixRelative(writer.mutation.file)}::${writer.discoverySymbol}`,
      ),
  );
}

export function findUnclassifiedSkillWriters(
  discovered,
  inventory = SKILL_WRITER_INVENTORY,
) {
  const classified = discoveryKeys(inventory);
  return (discovered || []).filter((site) => !classified.has(site.key));
}

function pushError(errors, code, message, details = {}) {
  errors.push(Object.freeze({ code, message, ...details }));
}

function validateRecordShape(record, index, errors) {
  const label = `writers[${index}]`;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    pushError(errors, "WRITER_INVALID", `${label} must be an object`);
    return;
  }
  if (!SAFE_ID.test(record.id || "")) {
    pushError(errors, "WRITER_ID_INVALID", `${label}.id is invalid`, {
      writerId: record.id || null,
    });
  }
  if (!SKILL_WRITER_SURFACES.includes(record.surface)) {
    pushError(errors, "WRITER_SURFACE_INVALID", `${label}.surface is invalid`, {
      writerId: record.id || null,
    });
  }
  if (!SKILL_WRITER_TRIGGER_CLASSES.includes(record.triggerClass)) {
    pushError(
      errors,
      "WRITER_TRIGGER_INVALID",
      `${label}.triggerClass is invalid`,
      {
        writerId: record.id || null,
      },
    );
  }
  if (!SKILL_WRITER_TARGET_AUTHORITIES.includes(record.targetAuthority)) {
    pushError(
      errors,
      "WRITER_AUTHORITY_INVALID",
      `${label}.targetAuthority is invalid`,
      { writerId: record.id || null },
    );
  }
  if (typeof record.mutationType !== "string" || !record.mutationType) {
    pushError(
      errors,
      "WRITER_MUTATION_TYPE_INVALID",
      `${label}.mutationType is invalid`,
      {
        writerId: record.id || null,
      },
    );
  }
  for (const field of ["entrypoint", "mutation"]) {
    const evidence = record[field];
    if (!evidence || typeof evidence !== "object") {
      pushError(
        errors,
        "WRITER_EVIDENCE_INVALID",
        `${label}.${field} is invalid`,
        {
          writerId: record.id || null,
        },
      );
      continue;
    }
    if (
      !SAFE_RELATIVE_FILE.test(evidence.file || "") ||
      evidence.file.includes("\0") ||
      path.posix.isAbsolute(evidence.file || "") ||
      posixRelative(evidence.file).split("/").includes("..")
    ) {
      pushError(
        errors,
        "WRITER_FILE_INVALID",
        `${label}.${field}.file is invalid`,
        {
          writerId: record.id || null,
          file: evidence.file || null,
        },
      );
    }
    if (typeof evidence.symbol !== "string" || !evidence.symbol) {
      pushError(
        errors,
        "WRITER_SYMBOL_INVALID",
        `${label}.${field}.symbol is invalid`,
        {
          writerId: record.id || null,
        },
      );
    }
    if (
      !Array.isArray(evidence.evidence) ||
      evidence.evidence.length === 0 ||
      evidence.evidence.some((value) => typeof value !== "string" || !value)
    ) {
      pushError(
        errors,
        "WRITER_EVIDENCE_INVALID",
        `${label}.${field}.evidence must contain non-empty strings`,
        { writerId: record.id || null },
      );
    }
  }
}

function validateScopeExclusionShape(record, index, errors) {
  const label = `scopeExclusions[${index}]`;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    pushError(errors, "SCOPE_EXCLUSION_INVALID", `${label} must be an object`);
    return;
  }
  if (!SAFE_ID.test(record.id || "")) {
    pushError(errors, "SCOPE_EXCLUSION_ID_INVALID", `${label}.id is invalid`, {
      exclusionId: record.id || null,
    });
  }
  if (!SKILL_WRITER_SURFACES.includes(record.surface)) {
    pushError(
      errors,
      "SCOPE_EXCLUSION_SURFACE_INVALID",
      `${label}.surface is invalid`,
      {
        exclusionId: record.id || null,
      },
    );
  }
  if (!SAFE_ID.test(record.reasonCode || "")) {
    pushError(
      errors,
      "SCOPE_EXCLUSION_REASON_INVALID",
      `${label}.reasonCode is invalid`,
      {
        exclusionId: record.id || null,
      },
    );
  }
  const evidence = record.evidence;
  if (
    !evidence ||
    typeof evidence !== "object" ||
    !SAFE_RELATIVE_FILE.test(evidence.file || "") ||
    evidence.file.includes("\0") ||
    path.posix.isAbsolute(evidence.file || "") ||
    posixRelative(evidence.file || "")
      .split("/")
      .includes("..") ||
    typeof evidence.symbol !== "string" ||
    !evidence.symbol ||
    !Array.isArray(evidence.evidence) ||
    evidence.evidence.length === 0 ||
    evidence.evidence.some((value) => typeof value !== "string" || !value)
  ) {
    pushError(
      errors,
      "SCOPE_EXCLUSION_EVIDENCE_INVALID",
      `${label}.evidence is invalid`,
      {
        exclusionId: record.id || null,
      },
    );
  }
}

function validateEvidenceFile(
  repositoryRoot,
  writer,
  kind,
  errors,
  sourceCache,
) {
  const evidence = writer[kind];
  if (!evidence?.file) return;
  const absolute = path.resolve(repositoryRoot, evidence.file);
  if (!isContained(repositoryRoot, absolute)) {
    pushError(
      errors,
      "WRITER_FILE_ESCAPE",
      "writer evidence file escapes repository",
      {
        writerId: writer.id,
        kind,
        file: evidence.file,
      },
    );
    return;
  }
  let stat;
  try {
    stat = fs.lstatSync(absolute);
  } catch (error) {
    pushError(
      errors,
      "WRITER_FILE_MISSING",
      "writer evidence file is missing",
      {
        writerId: writer.id,
        kind,
        file: evidence.file,
        cause: error.code || error.message,
      },
    );
    return;
  }
  if (!stat.isFile() || stat.isSymbolicLink()) {
    pushError(
      errors,
      "WRITER_FILE_UNSAFE",
      "writer evidence must be a regular, non-symlink file",
      { writerId: writer.id, kind, file: evidence.file },
    );
    return;
  }
  let source = sourceCache.get(absolute);
  if (source === undefined) {
    source = fs.readFileSync(absolute, "utf8");
    sourceCache.set(absolute, source);
  }
  for (const fragment of evidence.evidence || []) {
    if (!source.includes(fragment)) {
      pushError(
        errors,
        "WRITER_EVIDENCE_MISSING",
        "writer source evidence fragment is missing",
        {
          writerId: writer.id,
          kind,
          file: evidence.file,
          fragment,
        },
      );
    }
  }
}

/** Validate schema, source evidence, canonical classification, and discovery. */
export function validateSkillWriterInventory({
  repositoryRoot = DEFAULT_REPOSITORY_ROOT,
  inventory = SKILL_WRITER_INVENTORY,
  sourceRoots = inventory?.sourceRoots,
  requireClassificationCoverage = true,
} = {}) {
  const resolvedRoot = path.resolve(repositoryRoot);
  const errors = [];
  if (
    inventory?.schema !== SKILL_WRITER_INVENTORY_SCHEMA ||
    inventory?.schemaVersion !== 1
  ) {
    pushError(
      errors,
      "INVENTORY_SCHEMA_INVALID",
      "writer inventory schema is invalid",
    );
  }
  if (!Array.isArray(inventory?.writers)) {
    pushError(
      errors,
      "INVENTORY_WRITERS_INVALID",
      "writer inventory must contain writers",
    );
  }
  if (!Array.isArray(sourceRoots) || sourceRoots.length === 0) {
    pushError(
      errors,
      "INVENTORY_ROOTS_INVALID",
      "writer inventory sourceRoots are invalid",
    );
  }
  if (
    !Array.isArray(inventory?.surfaces) ||
    inventory.surfaces.length !== SKILL_WRITER_SURFACES.length ||
    SKILL_WRITER_SURFACES.some(
      (surface) => !inventory.surfaces.includes(surface),
    )
  ) {
    pushError(
      errors,
      "INVENTORY_SURFACES_INVALID",
      "writer surfaces are invalid",
    );
  }
  if (
    inventory?.scannerScope?.classification !== "direct-source-sink-subset" ||
    inventory?.scannerScope?.unit !== "function-or-ipc" ||
    !Array.isArray(inventory?.scannerScope?.sourceExtensions) ||
    !Array.isArray(inventory?.scannerScope?.skillBindings) ||
    !Array.isArray(inventory?.scannerScope?.mutationSinks) ||
    !Array.isArray(inventory?.limitations) ||
    inventory.limitations.length === 0
  ) {
    pushError(
      errors,
      "INVENTORY_SCANNER_SCOPE_INVALID",
      "direct scanner scope and limitations must be machine-readable",
    );
  }
  if (!Array.isArray(inventory?.scopeExclusions)) {
    pushError(
      errors,
      "INVENTORY_SCOPE_EXCLUSIONS_INVALID",
      "scope exclusions must be explicit",
    );
  }

  const writers = Array.isArray(inventory?.writers) ? inventory.writers : [];
  const scopeExclusions = Array.isArray(inventory?.scopeExclusions)
    ? inventory.scopeExclusions
    : [];
  writers.forEach((record, index) =>
    validateRecordShape(record, index, errors),
  );
  scopeExclusions.forEach((record, index) =>
    validateScopeExclusionShape(record, index, errors),
  );
  const ids = new Set();
  for (const record of writers) {
    if (ids.has(record?.id)) {
      pushError(errors, "WRITER_ID_DUPLICATE", "writer id is duplicated", {
        writerId: record?.id || null,
      });
    }
    ids.add(record?.id);
  }
  for (const record of scopeExclusions) {
    if (ids.has(record?.id)) {
      pushError(
        errors,
        "INVENTORY_ID_DUPLICATE",
        "writer and scope exclusion ids must be unique",
        { id: record?.id || null },
      );
    }
    ids.add(record?.id);
  }

  if (requireClassificationCoverage) {
    const triggerClasses = new Set(
      writers.map((writer) => writer.triggerClass),
    );
    const targetAuthorities = new Set(
      writers.map((writer) => writer.targetAuthority),
    );
    for (const value of SKILL_WRITER_TRIGGER_CLASSES) {
      if (!triggerClasses.has(value)) {
        pushError(
          errors,
          "INVENTORY_CLASSIFICATION_MISSING",
          `writer inventory does not cover ${value}`,
        );
      }
    }
    for (const value of SKILL_WRITER_TARGET_AUTHORITIES) {
      if (!targetAuthorities.has(value)) {
        pushError(
          errors,
          "INVENTORY_CLASSIFICATION_MISSING",
          `writer inventory does not cover ${value}`,
        );
      }
    }
  }

  const sourceCache = new Map();
  for (const record of writers) {
    validateEvidenceFile(
      resolvedRoot,
      record,
      "entrypoint",
      errors,
      sourceCache,
    );
    validateEvidenceFile(resolvedRoot, record, "mutation", errors, sourceCache);
  }
  for (const record of scopeExclusions) {
    validateEvidenceFile(resolvedRoot, record, "evidence", errors, sourceCache);
  }

  let discovered = [];
  try {
    discovered = discoverSkillWriterSites({
      repositoryRoot: resolvedRoot,
      sourceRoots: Array.isArray(sourceRoots) ? sourceRoots : [],
    });
  } catch (error) {
    pushError(errors, "INVENTORY_DISCOVERY_FAILED", "writer discovery failed", {
      cause: error.code || error.message,
    });
  }
  const unknownDirect = findUnclassifiedSkillWriters(discovered, inventory);
  for (const site of unknownDirect) {
    pushError(
      errors,
      "UNCLASSIFIED_DIRECT_SKILL_WRITER",
      "directly discovered production Skill writer is not classified in the inventory",
      site,
    );
  }

  const discoveredKeys = new Set(discovered.map((site) => site.key));
  for (const record of writers) {
    if (typeof record?.discoverySymbol !== "string") continue;
    const key = `${posixRelative(record.mutation.file)}::${record.discoverySymbol}`;
    if (!discoveredKeys.has(key)) {
      pushError(
        errors,
        "INVENTORIED_WRITER_NOT_DISCOVERED",
        "a statically discoverable inventory writer no longer matches source",
        { writerId: record.id, key },
      );
    }
  }

  const report = Object.freeze({
    ok: errors.length === 0,
    schema: SKILL_WRITER_INVENTORY_SCHEMA,
    digest: skillWriterInventoryDigest(inventory),
    writerCount: writers.length,
    legacyActiveCount: writers.filter(
      (writer) => writer.targetAuthority === "legacy-active",
    ).length,
    candidateOnlyCount: writers.filter(
      (writer) => writer.targetAuthority === "candidate-only",
    ).length,
    scopeExclusionCount: scopeExclusions.length,
    directDiscoveredCount: discovered.length,
    unknownDirectCount: unknownDirect.length,
    scannerScope: Object.freeze(canonicalValue(inventory.scannerScope || {})),
    limitations: Object.freeze([...(inventory.limitations || [])]),
    directDiscovered: Object.freeze(discovered),
    unknownDirect: Object.freeze(unknownDirect),
    errors: Object.freeze(errors),
  });
  return report;
}

export function assertSkillWriterInventory(options = {}) {
  const report = validateSkillWriterInventory(options);
  if (!report.ok) {
    throw new SkillWriterInventoryError(
      `Skill writer inventory validation failed with ${report.errors.length} error(s)`,
      report,
    );
  }
  return report;
}
