/**
 * Knowledge Graph Skill Handler
 *
 * Builds and analyzes knowledge graphs from text documents.
 * Extracts entities (person, organization, location, concept, technology),
 * discovers relationships via co-occurrence and verb patterns,
 * performs graph analytics (degree centrality, community detection),
 * and exports to JSON/CSV/DOT formats.
 *
 * Modes: --extract, --analyze, --query, --stats, --export, --load
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

// ── In-memory graph store ───────────────────────────────────────────

const graph = {
  entities: new Map(), // name -> { type, mentions, properties }
  relationships: [], // [{ source, target, type, weight }]
};

// ── Technology word list ────────────────────────────────────────────

const TECH_WORDS = new Set([
  "javascript",
  "python",
  "java",
  "react",
  "vue",
  "node",
  "docker",
  "kubernetes",
  "ai",
  "ml",
  "api",
  "rest",
  "graphql",
  "sql",
  "mongodb",
  "redis",
  "git",
  "linux",
  "aws",
  "azure",
  "typescript",
  "electron",
  "webpack",
  "vite",
  "nginx",
  "postgresql",
  "sqlite",
  "spring",
  "fastapi",
  "express",
  "nextjs",
  "nuxt",
  "angular",
  "svelte",
  "terraform",
  "ansible",
  "jenkins",
  "github",
  "gitlab",
]);

// ── Entity extraction (NLP-lite, no external deps) ─────────────────

function classifyEntity(name) {
  const lower = name.toLowerCase();

  // Person: Mr./Dr./Ms./Mrs. or known name patterns
  if (/^(mr|dr|ms|mrs|prof|sir|madam)\.?\s/i.test(name)) {
    return "person";
  }

  // Organization: Inc./Ltd./Corp./LLC/Co./Group/Foundation
  if (
    /\b(inc|ltd|corp|llc|co|group|foundation|institute|university|org)\b/i.test(
      name,
    )
  ) {
    return "organization";
  }

  // Technology: match against known tech word list
  if (TECH_WORDS.has(lower)) {
    return "technology";
  }

  // Location: common geographic suffixes/patterns
  if (
    /\b(city|country|state|province|island|mountain|river|lake|ocean|sea|bay|valley|street|avenue|boulevard)\b/i.test(
      name,
    )
  ) {
    return "location";
  }

  // Default to concept
  return "concept";
}

function extractEntitiesFromText(text) {
  const entities = [];
  const seen = new Set();

  // 1. Capitalized phrases (proper nouns) - 2+ word sequences
  const capitalizedRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let match;
  while ((match = capitalizedRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase()) && name.length > 2) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: classifyEntity(name) });
    }
  }

  // 2. Single capitalized words (not at sentence start, min length 3)
  const singleCapRe = /(?<=[a-z.!?]\s)([A-Z][a-z]{2,})\b/g;
  while ((match = singleCapRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: classifyEntity(name) });
    }
  }

  // 3. Quoted terms
  const quotedRe = /["']([^"']{2,40})["']/g;
  while ((match = quotedRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase()) && name.length > 1) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: classifyEntity(name) });
    }
  }

  // 4. Code identifiers: camelCase and snake_case
  const camelRe = /\b([a-z]+(?:[A-Z][a-z]+){1,})\b/g;
  while ((match = camelRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase()) && name.length > 4) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: "technology" });
    }
  }

  const snakeRe = /\b([a-z]+(?:_[a-z]+){1,})\b/g;
  while ((match = snakeRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase()) && name.length > 4) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: "technology" });
    }
  }

  // 5. Technology word list direct match
  const words = text.split(/[\s,;:()[\]{}<>]+/);
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9]/g, "");
    if (TECH_WORDS.has(clean.toLowerCase()) && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      entities.push({ name: clean, type: "technology" });
    }
  }

  // 6. URLs
  const urlRe = /https?:\/\/[^\s)]+/g;
  while ((match = urlRe.exec(text)) !== null) {
    const name = match[0].trim();
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: "concept" });
    }
  }

  // 7. File paths
  const fileRe = /(?:^|\s)((?:\.\/|\.\.\/|\/)?[\w\-./]+\.\w{1,6})(?:\s|$)/gm;
  while ((match = fileRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase()) && name.includes("/")) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: "concept" });
    }
  }

  return entities;
}

// ── Relationship extraction ─────────────────────────────────────────

const VERB_PATTERNS = [
  { re: /(\S+)\s+uses?\s+(\S+)/gi, type: "uses" },
  { re: /(\S+)\s+is\s+part\s+of\s+(\S+)/gi, type: "part_of" },
  { re: /(\S+)\s+depends?\s+on\s+(\S+)/gi, type: "depends_on" },
  { re: /(\S+)\s+extends?\s+(\S+)/gi, type: "extends" },
  { re: /(\S+)\s+implements?\s+(\S+)/gi, type: "implements" },
  { re: /(\S+)\s+requires?\s+(\S+)/gi, type: "requires" },
  { re: /(\S+)\s+integrates?\s+(?:with\s+)?(\S+)/gi, type: "integrates" },
  { re: /(\S+)\s+calls?\s+(\S+)/gi, type: "calls" },
  { re: /(\S+)\s+creates?\s+(\S+)/gi, type: "creates" },
  { re: /(\S+)\s+manages?\s+(\S+)/gi, type: "manages" },
];

function extractRelationshipsFromText(text, entityNames) {
  const relationships = [];
  const nameSet = new Set(entityNames.map((n) => n.toLowerCase()));
  const seen = new Set();

  // 1. Verb-based relationships
  for (const { re, type } of VERB_PATTERNS) {
    const regex = new RegExp(re.source, re.flags);
    let match;
    while ((match = regex.exec(text)) !== null) {
      const source = match[1].trim();
      const target = match[2].trim();
      if (
        nameSet.has(source.toLowerCase()) &&
        nameSet.has(target.toLowerCase())
      ) {
        const key =
          source.toLowerCase() + "|" + type + "|" + target.toLowerCase();
        if (!seen.has(key)) {
          seen.add(key);
          relationships.push({ source, target, type, weight: 1 });
        }
      }
    }
  }

  // 2. Co-occurrence in same paragraph -> "related_to"
  const paragraphs = text.split(/\n\s*\n/);
  for (const para of paragraphs) {
    const paraLower = para.toLowerCase();
    const found = entityNames.filter((n) =>
      paraLower.includes(n.toLowerCase()),
    );
    for (let i = 0; i < found.length; i++) {
      for (let j = i + 1; j < found.length; j++) {
        const key =
          found[i].toLowerCase() + "|related_to|" + found[j].toLowerCase();
        const keyReverse =
          found[j].toLowerCase() + "|related_to|" + found[i].toLowerCase();
        if (!seen.has(key) && !seen.has(keyReverse)) {
          seen.add(key);
          relationships.push({
            source: found[i],
            target: found[j],
            type: "related_to",
            weight: 1,
          });
        }
      }
    }
  }

  return relationships;
}

// ── Graph operations ────────────────────────────────────────────────

function addEntitiesToGraph(entities) {
  let added = 0;
  for (const ent of entities) {
    const key = ent.name.toLowerCase();
    if (graph.entities.has(key)) {
      const existing = graph.entities.get(key);
      existing.mentions += 1;
    } else {
      graph.entities.set(key, {
        name: ent.name,
        type: ent.type,
        mentions: 1,
        properties: {},
      });
      added++;
    }
  }
  return added;
}

function addRelationshipsToGraph(relationships) {
  let added = 0;
  for (const rel of relationships) {
    const existing = graph.relationships.find(
      (r) =>
        r.source.toLowerCase() === rel.source.toLowerCase() &&
        r.target.toLowerCase() === rel.target.toLowerCase() &&
        r.type === rel.type,
    );
    if (existing) {
      existing.weight += 1;
    } else {
      graph.relationships.push({
        source: rel.source,
        target: rel.target,
        type: rel.type,
        weight: rel.weight || 1,
      });
      added++;
    }
  }
  return added;
}

function computeDegreeCentrality() {
  const degree = {};
  for (const [key] of graph.entities) {
    degree[key] = 0;
  }
  for (const rel of graph.relationships) {
    const srcKey = rel.source.toLowerCase();
    const tgtKey = rel.target.toLowerCase();
    if (degree[srcKey] !== undefined) {
      degree[srcKey] += rel.weight;
    }
    if (degree[tgtKey] !== undefined) {
      degree[tgtKey] += rel.weight;
    }
  }

  const maxDegree = Math.max(1, ...Object.values(degree));
  const normalized = {};
  for (const [key, val] of Object.entries(degree)) {
    normalized[key] = Math.round((val / maxDegree) * 100) / 100;
  }

  return Object.entries(normalized)
    .sort(([, a], [, b]) => b - a)
    .map(([key, centrality]) => {
      const ent = graph.entities.get(key);
      return {
        name: ent ? ent.name : key,
        type: ent ? ent.type : "unknown",
        centrality,
        degree: degree[key],
      };
    });
}

function detectCommunities() {
  // Simple label propagation community detection
  const labels = {};
  let labelId = 0;
  for (const [key] of graph.entities) {
    labels[key] = labelId++;
  }

  const maxIterations = 10;
  for (let iter = 0; iter < maxIterations; iter++) {
    let changed = false;
    for (const [key] of graph.entities) {
      const neighborLabels = {};
      for (const rel of graph.relationships) {
        const srcKey = rel.source.toLowerCase();
        const tgtKey = rel.target.toLowerCase();
        if (srcKey === key) {
          const lbl = labels[tgtKey];
          if (lbl !== undefined) {
            neighborLabels[lbl] = (neighborLabels[lbl] || 0) + rel.weight;
          }
        } else if (tgtKey === key) {
          const lbl = labels[srcKey];
          if (lbl !== undefined) {
            neighborLabels[lbl] = (neighborLabels[lbl] || 0) + rel.weight;
          }
        }
      }

      if (Object.keys(neighborLabels).length > 0) {
        const bestLabel = Object.entries(neighborLabels).sort(
          ([, a], [, b]) => b - a,
        )[0][0];
        const newLabel = parseInt(bestLabel, 10);
        if (labels[key] !== newLabel) {
          labels[key] = newLabel;
          changed = true;
        }
      }
    }
    if (!changed) {
      break;
    }
  }

  // Group entities by community label
  const communities = {};
  for (const [key, label] of Object.entries(labels)) {
    if (!communities[label]) {
      communities[label] = [];
    }
    const ent = graph.entities.get(key);
    communities[label].push(ent ? ent.name : key);
  }

  return Object.values(communities).filter((c) => c.length > 0);
}

// ── Action handlers ─────────────────────────────────────────────────

async function handleExtract(filePath, projectRoot) {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath);

  if (!fs.existsSync(resolved)) {
    return {
      success: false,
      error: "File not found: " + resolved,
      message: "File not found: " + resolved,
    };
  }

  let content;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    return {
      success: false,
      error: "Cannot read file: " + err.message,
      message: "Cannot read file: " + err.message,
    };
  }

  const entities = extractEntitiesFromText(content);
  const entityNames = entities.map((e) => e.name);
  const relationships = extractRelationshipsFromText(content, entityNames);

  const addedEntities = addEntitiesToGraph(entities);
  const addedRelationships = addRelationshipsToGraph(relationships);

  const relFile = path.relative(projectRoot, resolved);
  const msg =
    "Extract: " +
    relFile +
    "\n" +
    "=".repeat(30) +
    "\n" +
    "Extracted " +
    entities.length +
    " entities, " +
    relationships.length +
    " relationships from document\n" +
    "Added to graph: " +
    addedEntities +
    " new entities, " +
    addedRelationships +
    " new relationships\n\n" +
    "Entities by type:\n" +
    summarizeByType(entities) +
    "\n\n" +
    "Graph total: " +
    graph.entities.size +
    " entities, " +
    graph.relationships.length +
    " relationships";

  return {
    success: true,
    result: {
      file: relFile,
      entitiesFound: entities.length,
      relationshipsFound: relationships.length,
      addedEntities,
      addedRelationships,
      graphSize: {
        entities: graph.entities.size,
        relationships: graph.relationships.length,
      },
    },
    message: msg,
  };
}

function summarizeByType(entities) {
  const byType = {};
  for (const ent of entities) {
    byType[ent.type] = (byType[ent.type] || 0) + 1;
  }
  return Object.entries(byType)
    .sort(([, a], [, b]) => b - a)
    .map(([type, count]) => "  " + type + ": " + count)
    .join("\n");
}

function handleAnalyzeCentrality() {
  if (graph.entities.size === 0) {
    return {
      success: false,
      error: "Graph is empty. Use --extract to add data first.",
      message: "Graph is empty. Use --extract to add data first.",
    };
  }

  const centrality = computeDegreeCentrality();
  const top = centrality.slice(0, 20);

  const msg =
    "Centrality Analysis\n" +
    "=".repeat(25) +
    "\n" +
    "Top entities by degree centrality:\n\n" +
    top
      .map(
        (e, i) =>
          "  " +
          (i + 1) +
          ". " +
          e.name +
          " (" +
          e.type +
          ") - centrality: " +
          e.centrality +
          ", degree: " +
          e.degree,
      )
      .join("\n") +
    "\n\nTotal entities: " +
    graph.entities.size;

  return {
    success: true,
    result: { centrality: top, totalEntities: graph.entities.size },
    message: msg,
  };
}

function handleQuery(entityName) {
  if (!entityName) {
    return {
      success: false,
      error: 'No entity name provided. Usage: --query "<entity>"',
      message: 'No entity name provided. Usage: --query "<entity>"',
    };
  }

  const key = entityName.toLowerCase();
  const entity = graph.entities.get(key);

  if (!entity) {
    // Try partial match
    const matches = [];
    for (const [k, v] of graph.entities) {
      if (k.includes(key)) {
        matches.push(v);
      }
    }
    if (matches.length === 0) {
      return {
        success: false,
        error: "Entity '" + entityName + "' not found in graph.",
        message:
          "Entity '" +
          entityName +
          "' not found in graph. " +
          "Available entities: " +
          graph.entities.size,
      };
    }
    // Return partial matches
    const msg =
      "No exact match for '" +
      entityName +
      "'. Partial matches:\n" +
      matches
        .slice(0, 10)
        .map(
          (m) =>
            "  - " + m.name + " (" + m.type + ", mentions: " + m.mentions + ")",
        )
        .join("\n");
    return {
      success: true,
      result: { query: entityName, partialMatches: matches.slice(0, 10) },
      message: msg,
    };
  }

  // Find all relationships involving this entity
  const rels = graph.relationships.filter(
    (r) => r.source.toLowerCase() === key || r.target.toLowerCase() === key,
  );

  const outgoing = rels
    .filter((r) => r.source.toLowerCase() === key)
    .map((r) => ({ target: r.target, type: r.type, weight: r.weight }));
  const incoming = rels
    .filter((r) => r.target.toLowerCase() === key)
    .map((r) => ({ source: r.source, type: r.type, weight: r.weight }));

  const msg =
    "Entity: " +
    entity.name +
    "\n" +
    "=".repeat(20 + entity.name.length) +
    "\n" +
    "Type: " +
    entity.type +
    "\n" +
    "Mentions: " +
    entity.mentions +
    "\n" +
    "Relationships: " +
    rels.length +
    " total\n\n" +
    (outgoing.length > 0
      ? "Outgoing (" +
        outgoing.length +
        "):\n" +
        outgoing
          .map(
            (r) =>
              "  -> " + r.type + " -> " + r.target + " (w:" + r.weight + ")",
          )
          .join("\n") +
        "\n\n"
      : "") +
    (incoming.length > 0
      ? "Incoming (" +
        incoming.length +
        "):\n" +
        incoming
          .map(
            (r) =>
              "  " +
              r.source +
              " -> " +
              r.type +
              " -> " +
              entity.name +
              " (w:" +
              r.weight +
              ")",
          )
          .join("\n")
      : "");

  return {
    success: true,
    result: {
      entity: {
        name: entity.name,
        type: entity.type,
        mentions: entity.mentions,
        properties: entity.properties,
      },
      outgoing,
      incoming,
      totalRelationships: rels.length,
    },
    message: msg,
  };
}

function handleStats() {
  if (graph.entities.size === 0) {
    return {
      success: true,
      result: { entities: 0, relationships: 0 },
      message: "Graph is empty. Use --extract to add data.",
    };
  }

  // Entity count by type
  const byType = {};
  for (const [, ent] of graph.entities) {
    byType[ent.type] = (byType[ent.type] || 0) + 1;
  }

  // Relationship count by type
  const relByType = {};
  for (const rel of graph.relationships) {
    relByType[rel.type] = (relByType[rel.type] || 0) + 1;
  }

  // Average degree
  const totalDegree = graph.relationships.length * 2;
  const avgDegree =
    graph.entities.size > 0
      ? Math.round((totalDegree / graph.entities.size) * 100) / 100
      : 0;

  // Density: edges / (n * (n-1) / 2)
  const n = graph.entities.size;
  const maxEdges = (n * (n - 1)) / 2;
  const density =
    maxEdges > 0
      ? Math.round((graph.relationships.length / maxEdges) * 1000) / 1000
      : 0;

  // Communities
  const communities = detectCommunities();

  const msg =
    "Graph Statistics\n" +
    "=".repeat(25) +
    "\n" +
    "Entities: " +
    graph.entities.size +
    "\n" +
    "Relationships: " +
    graph.relationships.length +
    "\n" +
    "Average degree: " +
    avgDegree +
    "\n" +
    "Density: " +
    density +
    "\n" +
    "Communities: " +
    communities.length +
    "\n\n" +
    "Entities by type:\n" +
    Object.entries(byType)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => "  " + type + ": " + count)
      .join("\n") +
    "\n\nRelationships by type:\n" +
    Object.entries(relByType)
      .sort(([, a], [, b]) => b - a)
      .map(([type, count]) => "  " + type + ": " + count)
      .join("\n") +
    "\n\nCommunities:\n" +
    communities
      .map(
        (c, i) =>
          "  " +
          (i + 1) +
          ". [" +
          c.length +
          " members] " +
          c.slice(0, 5).join(", ") +
          (c.length > 5 ? " ..." : ""),
      )
      .join("\n");

  return {
    success: true,
    result: {
      entityCount: graph.entities.size,
      relationshipCount: graph.relationships.length,
      avgDegree,
      density,
      communityCount: communities.length,
      entitiesByType: byType,
      relationshipsByType: relByType,
      communities: communities.map((c) => ({ size: c.length, members: c })),
    },
    message: msg,
  };
}

function handleExport(format) {
  format = (format || "json").toLowerCase();

  if (graph.entities.size === 0) {
    return {
      success: false,
      error: "Graph is empty. Nothing to export.",
      message: "Graph is empty. Use --extract to add data first.",
    };
  }

  let output;

  if (format === "json") {
    const entities = [];
    for (const [, ent] of graph.entities) {
      entities.push({
        name: ent.name,
        type: ent.type,
        mentions: ent.mentions,
        properties: ent.properties,
      });
    }
    output = JSON.stringify(
      { entities, relationships: graph.relationships },
      null,
      2,
    );
  } else if (format === "csv") {
    const lines = ["source,target,type,weight"];
    for (const rel of graph.relationships) {
      lines.push(
        '"' +
          rel.source.replace(/"/g, '""') +
          '",' +
          '"' +
          rel.target.replace(/"/g, '""') +
          '",' +
          rel.type +
          "," +
          rel.weight,
      );
    }
    output = lines.join("\n");
  } else if (format === "dot") {
    const lines = ["digraph KnowledgeGraph {", "  rankdir=LR;"];
    // Node declarations with type as shape
    const typeShapes = {
      person: "ellipse",
      organization: "box",
      location: "diamond",
      technology: "hexagon",
      concept: "plaintext",
    };
    for (const [, ent] of graph.entities) {
      const shape = typeShapes[ent.type] || "ellipse";
      lines.push(
        '  "' +
          ent.name.replace(/"/g, '\\"') +
          '" [shape=' +
          shape +
          ', label="' +
          ent.name.replace(/"/g, '\\"') +
          "\\n(" +
          ent.type +
          ')"' +
          "];",
      );
    }
    // Edges
    for (const rel of graph.relationships) {
      lines.push(
        '  "' +
          rel.source.replace(/"/g, '\\"') +
          '" -> "' +
          rel.target.replace(/"/g, '\\"') +
          '" [label="' +
          rel.type +
          '", weight=' +
          rel.weight +
          "];",
      );
    }
    lines.push("}");
    output = lines.join("\n");
  } else {
    return {
      success: false,
      error: "Unknown format: " + format + ". Use json, csv, or dot.",
      message: "Unknown format: " + format + ". Supported: json, csv, dot.",
    };
  }

  const msg =
    "Export (" +
    format.toUpperCase() +
    ")\n" +
    "=".repeat(20) +
    "\n" +
    "Entities: " +
    graph.entities.size +
    ", Relationships: " +
    graph.relationships.length +
    "\n\n" +
    output.substring(0, 2000) +
    (output.length > 2000
      ? "\n... (truncated, full length: " + output.length + " chars)"
      : "");

  return {
    success: true,
    result: {
      format,
      output,
      entityCount: graph.entities.size,
      relationshipCount: graph.relationships.length,
    },
    message: msg,
  };
}

async function handleLoad(filePath, projectRoot) {
  const resolved = path.isAbsolute(filePath)
    ? filePath
    : path.resolve(projectRoot, filePath);

  if (!fs.existsSync(resolved)) {
    return {
      success: false,
      error: "File not found: " + resolved,
      message: "File not found: " + resolved,
    };
  }

  let content;
  try {
    content = fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    return {
      success: false,
      error: "Cannot read file: " + err.message,
      message: "Cannot read file: " + err.message,
    };
  }

  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return {
      success: false,
      error: "Invalid JSON: " + err.message,
      message: "Invalid JSON: " + err.message,
    };
  }

  // Clear current graph
  graph.entities.clear();
  graph.relationships = [];

  // Load entities
  const entities = data.entities || [];
  for (const ent of entities) {
    graph.entities.set((ent.name || "").toLowerCase(), {
      name: ent.name || "",
      type: ent.type || "concept",
      mentions: ent.mentions || 1,
      properties: ent.properties || {},
    });
  }

  // Load relationships
  const rels = data.relationships || [];
  for (const rel of rels) {
    graph.relationships.push({
      source: rel.source || "",
      target: rel.target || "",
      type: rel.type || "related_to",
      weight: rel.weight || 1,
    });
  }

  const relFile = path.relative(projectRoot, resolved);
  const msg =
    "Load: " +
    relFile +
    "\n" +
    "=".repeat(20) +
    "\n" +
    "Loaded " +
    graph.entities.size +
    " entities, " +
    graph.relationships.length +
    " relationships from JSON.";

  return {
    success: true,
    result: {
      file: relFile,
      entities: graph.entities.size,
      relationships: graph.relationships.length,
    },
    message: msg,
  };
}

// ── Handler ─────────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info(
      "[knowledge-graph] init: " + (_skill?.name || "knowledge-graph"),
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

    const extractMatch = input.match(/--extract\s+(\S+)/i);
    const analyzeMatch = /--analyze/i.test(input);
    const centralityMatch = /--centrality/i.test(input);
    const queryMatch = input.match(/--query\s+["']?([^"']+)["']?/i);
    const statsMatch = /--stats/i.test(input);
    const exportMatch = /--export/i.test(input);
    const formatMatch = input.match(/--format\s+(\S+)/i);
    const loadMatch = input.match(/--load\s+(\S+)/i);

    try {
      if (extractMatch) {
        return await handleExtract(extractMatch[1].trim(), projectRoot);
      }

      if (analyzeMatch || centralityMatch) {
        return handleAnalyzeCentrality();
      }

      if (queryMatch) {
        return handleQuery(queryMatch[1].trim());
      }

      if (statsMatch) {
        return handleStats();
      }

      if (exportMatch) {
        const format = formatMatch ? formatMatch[1].trim() : "json";
        return handleExport(format);
      }

      if (loadMatch) {
        return await handleLoad(loadMatch[1].trim(), projectRoot);
      }

      // No mode - show usage
      if (!input) {
        return {
          success: false,
          error: "No action specified.",
          message:
            "Usage: /knowledge-graph [action]\n\n" +
            "Actions:\n" +
            "  --extract <file>            Extract entities and relationships\n" +
            "  --analyze --centrality       Degree centrality analysis\n" +
            '  --query "<entity>"           Query entity relationships\n' +
            "  --stats                      Graph statistics\n" +
            "  --export --format json|csv|dot  Export graph\n" +
            "  --load <file>                Load graph from JSON",
        };
      }

      // Try to infer intent: if input looks like a file path, extract
      if (input.match(/\.\w{1,6}$/) && !input.startsWith("-")) {
        return await handleExtract(input, projectRoot);
      }

      // Otherwise treat as entity query
      return handleQuery(input);
    } catch (err) {
      logger.error("[knowledge-graph] Error:", err);
      return {
        success: false,
        error: err.message,
        message: "Knowledge graph operation failed: " + err.message,
      };
    }
  },
};
