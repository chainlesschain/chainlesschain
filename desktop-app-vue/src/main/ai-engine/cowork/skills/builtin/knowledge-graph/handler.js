/**
 * Knowledge Graph Skill Handler
 *
 * Builds and analyzes knowledge graphs from text documents.
 * Extracts entities (person, organization, location, concept, technology),
 * discovers relationships via co-occurrence and verb patterns,
 * performs graph analytics (degree centrality, community detection),
 * and exports to JSON/CSV/DOT/OWL/JSON-LD/Wikilinks formats.
 *
 * Enhanced with Ontology capabilities:
 * - OWL/RDF, JSON-LD, Wikilinks export formats
 * - Semantic relationship types (is_a, part_of, causal, temporal)
 * - Ontology documentation generation
 * - Consistency/validation checking
 *
 * Modes: --extract, --analyze, --query, --stats, --export, --load,
 *        --ontology, --validate
 */

const fs = require("fs");
const path = require("path");
const { logger } = require("../../../../../utils/logger.js");

const _deps = { fs, path };

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

// ── Entity extraction ───────────────────────────────────────────────

function classifyEntity(name) {
  const lower = name.toLowerCase();
  if (/^(mr|dr|ms|mrs|prof|sir|madam)\.?\s/i.test(name)) {
    return "person";
  }
  if (
    /\b(inc|ltd|corp|llc|co|group|foundation|institute|university|org)\b/i.test(
      name,
    )
  ) {
    return "organization";
  }
  if (TECH_WORDS.has(lower)) {
    return "technology";
  }
  if (
    /\b(city|country|state|province|island|mountain|river|lake|ocean|sea|bay|valley|street|avenue|boulevard)\b/i.test(
      name,
    )
  ) {
    return "location";
  }
  return "concept";
}

function extractEntitiesFromText(text) {
  const entities = [];
  const seen = new Set();

  const capitalizedRe = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
  let match;
  while ((match = capitalizedRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase()) && name.length > 2) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: classifyEntity(name) });
    }
  }

  const singleCapRe = /(?<=[a-z.!?]\s)([A-Z][a-z]{2,})\b/g;
  while ((match = singleCapRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: classifyEntity(name) });
    }
  }

  const quotedRe = /["']([^"']{2,40})["']/g;
  while ((match = quotedRe.exec(text)) !== null) {
    const name = match[1].trim();
    if (!seen.has(name.toLowerCase()) && name.length > 1) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: classifyEntity(name) });
    }
  }

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

  const words = text.split(/[\s,;:()[\]{}<>]+/);
  for (const word of words) {
    const clean = word.replace(/[^a-zA-Z0-9]/g, "");
    if (TECH_WORDS.has(clean.toLowerCase()) && !seen.has(clean.toLowerCase())) {
      seen.add(clean.toLowerCase());
      entities.push({ name: clean, type: "technology" });
    }
  }

  const urlRe = /https?:\/\/[^\s)]+/g;
  while ((match = urlRe.exec(text)) !== null) {
    const name = match[0].trim();
    if (!seen.has(name.toLowerCase())) {
      seen.add(name.toLowerCase());
      entities.push({ name, type: "concept" });
    }
  }

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
  // Enhanced semantic relationships (Ontology)
  { re: /(\S+)\s+is\s+a\s+(?:type\s+of\s+)?(\S+)/gi, type: "is_a" },
  { re: /(\S+)\s+belongs?\s+to\s+(\S+)/gi, type: "part_of" },
  { re: /(\S+)\s+contains?\s+(\S+)/gi, type: "contains" },
  { re: /(\S+)\s+causes?\s+(\S+)/gi, type: "causal" },
  { re: /(\S+)\s+leads?\s+to\s+(\S+)/gi, type: "causal" },
  { re: /(\S+)\s+results?\s+in\s+(\S+)/gi, type: "causal" },
  { re: /(\S+)\s+before\s+(\S+)/gi, type: "temporal_before" },
  { re: /(\S+)\s+after\s+(\S+)/gi, type: "temporal_after" },
  { re: /(\S+)\s+during\s+(\S+)/gi, type: "temporal_during" },
];

function extractRelationshipsFromText(text, entityNames) {
  const relationships = [];
  const nameSet = new Set(entityNames.map((n) => n.toLowerCase()));
  const seen = new Set();

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
      graph.entities.get(key).mentions += 1;
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
  const labels = {};
  let labelId = 0;
  for (const [key] of graph.entities) {
    labels[key] = labelId++;
  }

  for (let iter = 0; iter < 10; iter++) {
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
  const resolved = _deps.path.isAbsolute(filePath)
    ? filePath
    : _deps.path.resolve(projectRoot, filePath);
  if (!_deps.fs.existsSync(resolved)) {
    return {
      success: false,
      error: "File not found: " + resolved,
      message: "File not found: " + resolved,
    };
  }
  let content;
  try {
    content = _deps.fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    return { success: false, error: "Cannot read file: " + err.message };
  }

  const entities = extractEntitiesFromText(content);
  const entityNames = entities.map((e) => e.name);
  const relationships = extractRelationshipsFromText(content, entityNames);
  const addedEntities = addEntitiesToGraph(entities);
  const addedRelationships = addRelationshipsToGraph(relationships);
  const relFile = _deps.path.relative(projectRoot, resolved);

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
    message:
      `Extract: ${relFile}\n${"=".repeat(30)}\n` +
      `Extracted ${entities.length} entities, ${relationships.length} relationships\n` +
      `Added: ${addedEntities} new entities, ${addedRelationships} new relationships\n\n` +
      `Entities by type:\n${summarizeByType(entities)}\n\n` +
      `Graph total: ${graph.entities.size} entities, ${graph.relationships.length} relationships`,
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
      error: "Graph is empty. Use --extract first.",
      message: "Graph is empty.",
    };
  }
  const centrality = computeDegreeCentrality();
  const top = centrality.slice(0, 20);
  return {
    success: true,
    result: { centrality: top, totalEntities: graph.entities.size },
    message:
      "Centrality Analysis\n" +
      "=".repeat(25) +
      "\n" +
      top
        .map(
          (e, i) =>
            `  ${i + 1}. ${e.name} (${e.type}) - centrality: ${e.centrality}`,
        )
        .join("\n"),
  };
}

function handleQuery(entityName) {
  if (!entityName) {
    return {
      success: false,
      error: 'No entity name. Usage: --query "<entity>"',
    };
  }
  const key = entityName.toLowerCase();
  const entity = graph.entities.get(key);

  if (!entity) {
    const matches = [];
    for (const [k, v] of graph.entities) {
      if (k.includes(key)) {
        matches.push(v);
      }
    }
    if (matches.length === 0) {
      return { success: false, error: `Entity "${entityName}" not found.` };
    }
    return {
      success: true,
      result: { query: entityName, partialMatches: matches.slice(0, 10) },
      message:
        "Partial matches:\n" +
        matches
          .slice(0, 10)
          .map((m) => `  - ${m.name} (${m.type})`)
          .join("\n"),
    };
  }

  const rels = graph.relationships.filter(
    (r) => r.source.toLowerCase() === key || r.target.toLowerCase() === key,
  );
  const outgoing = rels
    .filter((r) => r.source.toLowerCase() === key)
    .map((r) => ({ target: r.target, type: r.type, weight: r.weight }));
  const incoming = rels
    .filter((r) => r.target.toLowerCase() === key)
    .map((r) => ({ source: r.source, type: r.type, weight: r.weight }));

  return {
    success: true,
    result: {
      entity: {
        name: entity.name,
        type: entity.type,
        mentions: entity.mentions,
      },
      outgoing,
      incoming,
      totalRelationships: rels.length,
    },
    message:
      `Entity: ${entity.name}\nType: ${entity.type}, Mentions: ${entity.mentions}\n` +
      (outgoing.length > 0
        ? "Outgoing:\n" +
          outgoing.map((r) => `  -> ${r.type} -> ${r.target}`).join("\n") +
          "\n"
        : "") +
      (incoming.length > 0
        ? "Incoming:\n" +
          incoming.map((r) => `  ${r.source} -> ${r.type} ->`).join("\n")
        : ""),
  };
}

function handleStats() {
  if (graph.entities.size === 0) {
    return {
      success: true,
      result: { entities: 0, relationships: 0 },
      message: "Graph is empty.",
    };
  }

  const byType = {};
  for (const [, ent] of graph.entities) {
    byType[ent.type] = (byType[ent.type] || 0) + 1;
  }
  const relByType = {};
  for (const rel of graph.relationships) {
    relByType[rel.type] = (relByType[rel.type] || 0) + 1;
  }

  const totalDegree = graph.relationships.length * 2;
  const avgDegree =
    graph.entities.size > 0
      ? Math.round((totalDegree / graph.entities.size) * 100) / 100
      : 0;
  const n = graph.entities.size;
  const maxEdges = (n * (n - 1)) / 2;
  const density =
    maxEdges > 0
      ? Math.round((graph.relationships.length / maxEdges) * 1000) / 1000
      : 0;
  const communities = detectCommunities();

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
    },
    message:
      `Graph Statistics\n${"=".repeat(25)}\n` +
      `Entities: ${graph.entities.size}\nRelationships: ${graph.relationships.length}\n` +
      `Avg degree: ${avgDegree}, Density: ${density}, Communities: ${communities.length}\n\n` +
      `By type:\n${Object.entries(byType)
        .map(([t, c]) => `  ${t}: ${c}`)
        .join("\n")}\n\n` +
      `Relationships:\n${Object.entries(relByType)
        .map(([t, c]) => `  ${t}: ${c}`)
        .join("\n")}`,
  };
}

function handleExport(format) {
  format = (format || "json").toLowerCase();
  if (graph.entities.size === 0) {
    return {
      success: false,
      error: "Graph is empty.",
      message: "Graph is empty.",
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
        `"${rel.source.replace(/"/g, '""')}","${rel.target.replace(/"/g, '""')}",${rel.type},${rel.weight}`,
      );
    }
    output = lines.join("\n");
  } else if (format === "dot") {
    const typeShapes = {
      person: "ellipse",
      organization: "box",
      location: "diamond",
      technology: "hexagon",
      concept: "plaintext",
    };
    const lines = ["digraph KnowledgeGraph {", "  rankdir=LR;"];
    for (const [, ent] of graph.entities) {
      const shape = typeShapes[ent.type] || "ellipse";
      lines.push(`  "${ent.name.replace(/"/g, '\\"')}" [shape=${shape}];`);
    }
    for (const rel of graph.relationships) {
      lines.push(
        `  "${rel.source.replace(/"/g, '\\"')}" -> "${rel.target.replace(/"/g, '\\"')}" [label="${rel.type}"];`,
      );
    }
    lines.push("}");
    output = lines.join("\n");
  } else if (format === "owl") {
    output = exportOWL();
  } else if (format === "jsonld") {
    output = exportJSONLD();
  } else if (format === "wikilinks") {
    output = exportWikilinks();
  } else {
    return {
      success: false,
      error: `Unknown format: ${format}. Supported: json, csv, dot, owl, jsonld, wikilinks.`,
    };
  }

  return {
    success: true,
    result: {
      format,
      output,
      entityCount: graph.entities.size,
      relationshipCount: graph.relationships.length,
    },
    message:
      `Export (${format.toUpperCase()})\n${"=".repeat(20)}\n` +
      `Entities: ${graph.entities.size}, Relationships: ${graph.relationships.length}\n\n` +
      output.substring(0, 2000) +
      (output.length > 2000 ? `\n... (truncated, ${output.length} chars)` : ""),
  };
}

// ── New Export Formats (Ontology) ───────────────────────────────────

function exportOWL() {
  const lines = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"',
    '         xmlns:rdfs="http://www.w3.org/2000/01/rdf-schema#"',
    '         xmlns:owl="http://www.w3.org/2002/07/owl#"',
    '         xmlns:cc="http://chainlesschain.local/ontology#">',
    "",
    "  <!-- Ontology Declaration -->",
    '  <owl:Ontology rdf:about="http://chainlesschain.local/ontology"/>',
    "",
    "  <!-- Classes (Entity Types) -->",
  ];

  const types = new Set();
  for (const [, ent] of graph.entities) {
    types.add(ent.type);
  }
  for (const type of types) {
    lines.push(
      `  <owl:Class rdf:about="http://chainlesschain.local/ontology#${type}">`,
    );
    lines.push(`    <rdfs:label>${type}</rdfs:label>`);
    lines.push("  </owl:Class>");
  }

  lines.push("", "  <!-- Object Properties (Relationship Types) -->");
  const relTypes = new Set();
  for (const rel of graph.relationships) {
    relTypes.add(rel.type);
  }
  for (const relType of relTypes) {
    lines.push(
      `  <owl:ObjectProperty rdf:about="http://chainlesschain.local/ontology#${relType}">`,
    );
    lines.push(`    <rdfs:label>${relType}</rdfs:label>`);
    lines.push("  </owl:ObjectProperty>");
  }

  lines.push("", "  <!-- Individuals (Entities) -->");
  for (const [, ent] of graph.entities) {
    const safeName = ent.name.replace(/[^a-zA-Z0-9_-]/g, "_");
    lines.push(
      `  <owl:NamedIndividual rdf:about="http://chainlesschain.local/ontology#${safeName}">`,
    );
    lines.push(
      `    <rdf:type rdf:resource="http://chainlesschain.local/ontology#${ent.type}"/>`,
    );
    lines.push(`    <rdfs:label>${escapeXml(ent.name)}</rdfs:label>`);
    lines.push("  </owl:NamedIndividual>");
  }

  lines.push("", "  <!-- Relationships -->");
  for (const rel of graph.relationships) {
    const srcSafe = rel.source.replace(/[^a-zA-Z0-9_-]/g, "_");
    const tgtSafe = rel.target.replace(/[^a-zA-Z0-9_-]/g, "_");
    lines.push(
      `  <rdf:Description rdf:about="http://chainlesschain.local/ontology#${srcSafe}">`,
    );
    lines.push(
      `    <cc:${rel.type} rdf:resource="http://chainlesschain.local/ontology#${tgtSafe}"/>`,
    );
    lines.push("  </rdf:Description>");
  }

  lines.push("</rdf:RDF>");
  return lines.join("\n");
}

function escapeXml(str) {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function exportJSONLD() {
  const context = {
    "@vocab": "http://chainlesschain.local/ontology#",
    rdfs: "http://www.w3.org/2000/01/rdf-schema#",
    owl: "http://www.w3.org/2002/07/owl#",
    name: "rdfs:label",
    type: "@type",
  };

  const graphData = [];
  for (const [, ent] of graph.entities) {
    const node = {
      "@id": `cc:${ent.name.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      "@type": ent.type,
      name: ent.name,
      mentions: ent.mentions,
    };

    const outRels = graph.relationships.filter(
      (r) => r.source.toLowerCase() === ent.name.toLowerCase(),
    );
    for (const rel of outRels) {
      if (!node[rel.type]) {
        node[rel.type] = [];
      }
      node[rel.type].push({
        "@id": `cc:${rel.target.replace(/[^a-zA-Z0-9_-]/g, "_")}`,
      });
    }
    graphData.push(node);
  }

  return JSON.stringify({ "@context": context, "@graph": graphData }, null, 2);
}

function exportWikilinks() {
  const lines = [];
  for (const rel of graph.relationships) {
    lines.push(`[[${rel.source}]] ${rel.type} [[${rel.target}]]`);
  }

  // Also add orphan entities
  for (const [key, ent] of graph.entities) {
    const hasRel = graph.relationships.some(
      (r) => r.source.toLowerCase() === key || r.target.toLowerCase() === key,
    );
    if (!hasRel) {
      lines.push(`[[${ent.name}]]`);
    }
  }

  return lines.join("\n");
}

// ── Ontology Documentation ──────────────────────────────────────────

function handleOntology() {
  if (graph.entities.size === 0) {
    return {
      success: false,
      error: "Graph is empty.",
      message: "Graph is empty.",
    };
  }

  // Entity types (classes)
  const classes = {};
  for (const [, ent] of graph.entities) {
    if (!classes[ent.type]) {
      classes[ent.type] = [];
    }
    classes[ent.type].push(ent.name);
  }

  // Relationship types (properties) with domain/range
  const properties = {};
  for (const rel of graph.relationships) {
    if (!properties[rel.type]) {
      properties[rel.type] = {
        domains: new Set(),
        ranges: new Set(),
        count: 0,
      };
    }
    const srcEnt = graph.entities.get(rel.source.toLowerCase());
    const tgtEnt = graph.entities.get(rel.target.toLowerCase());
    if (srcEnt) {
      properties[rel.type].domains.add(srcEnt.type);
    }
    if (tgtEnt) {
      properties[rel.type].ranges.add(tgtEnt.type);
    }
    properties[rel.type].count++;
  }

  // Class hierarchy from is_a relationships
  const hierarchy = [];
  const isaRels = graph.relationships.filter((r) => r.type === "is_a");
  for (const rel of isaRels) {
    hierarchy.push({ child: rel.source, parent: rel.target });
  }

  let msg = `# Ontology Documentation\n\n`;
  msg += `## Classes (${Object.keys(classes).length})\n\n`;
  for (const [type, members] of Object.entries(classes).sort(
    ([, a], [, b]) => b.length - a.length,
  )) {
    msg += `### ${type} (${members.length} instances)\n`;
    msg +=
      members
        .slice(0, 10)
        .map((m) => `- ${m}`)
        .join("\n") + "\n";
    if (members.length > 10) {
      msg += `- ... and ${members.length - 10} more\n`;
    }
    msg += "\n";
  }

  msg += `## Properties (${Object.keys(properties).length})\n\n`;
  for (const [type, info] of Object.entries(properties).sort(
    ([, a], [, b]) => b.count - a.count,
  )) {
    msg += `### ${type} (${info.count} usages)\n`;
    msg += `- Domain: ${Array.from(info.domains).join(", ")}\n`;
    msg += `- Range: ${Array.from(info.ranges).join(", ")}\n\n`;
  }

  if (hierarchy.length > 0) {
    msg += `## Class Hierarchy\n\n`;
    for (const h of hierarchy) {
      msg += `- ${h.child} is_a ${h.parent}\n`;
    }
  }

  return {
    success: true,
    result: {
      classes: Object.fromEntries(
        Object.entries(classes).map(([k, v]) => [k, v.length]),
      ),
      properties: Object.fromEntries(
        Object.entries(properties).map(([k, v]) => [
          k,
          {
            domains: Array.from(v.domains),
            ranges: Array.from(v.ranges),
            count: v.count,
          },
        ]),
      ),
      hierarchy,
    },
    message: msg,
  };
}

// ── Validation / Consistency ────────────────────────────────────────

function handleValidate() {
  if (graph.entities.size === 0) {
    return {
      success: true,
      result: { valid: true, warnings: [], errors: [] },
      message: "Graph is empty - no issues.",
    };
  }

  const warnings = [];
  const errors = [];

  // Check orphan entities
  for (const [key, ent] of graph.entities) {
    const hasRel = graph.relationships.some(
      (r) => r.source.toLowerCase() === key || r.target.toLowerCase() === key,
    );
    if (!hasRel) {
      warnings.push({
        type: "orphan",
        entity: ent.name,
        message: `Entity "${ent.name}" has no relationships`,
      });
    }
  }

  // Check missing entity references
  for (const rel of graph.relationships) {
    if (!graph.entities.has(rel.source.toLowerCase())) {
      errors.push({
        type: "missing_entity",
        entity: rel.source,
        message: `Relationship source "${rel.source}" not in entity list`,
      });
    }
    if (!graph.entities.has(rel.target.toLowerCase())) {
      errors.push({
        type: "missing_entity",
        entity: rel.target,
        message: `Relationship target "${rel.target}" not in entity list`,
      });
    }
  }

  // Check circular is_a
  const isaRels = graph.relationships.filter((r) => r.type === "is_a");
  const visited = new Set();
  for (const rel of isaRels) {
    const chain = [rel.source.toLowerCase()];
    let current = rel.target.toLowerCase();
    while (current && !visited.has(current)) {
      if (chain.includes(current)) {
        errors.push({
          type: "circular_is_a",
          chain: [...chain, current],
          message: `Circular is_a: ${chain.join(" -> ")} -> ${current}`,
        });
        break;
      }
      chain.push(current);
      visited.add(current);
      const next = isaRels.find((r) => r.source.toLowerCase() === current);
      current = next ? next.target.toLowerCase() : null;
    }
  }

  // Check duplicate entities (case differences)
  const nameMap = {};
  for (const [key, ent] of graph.entities) {
    const normalized = key.toLowerCase().trim();
    if (nameMap[normalized] && nameMap[normalized] !== ent.name) {
      warnings.push({
        type: "duplicate",
        entities: [nameMap[normalized], ent.name],
        message: `Possible duplicate: "${nameMap[normalized]}" vs "${ent.name}"`,
      });
    }
    nameMap[normalized] = ent.name;
  }

  const valid = errors.length === 0;
  let msg =
    `Validation Report\n${"=".repeat(20)}\n` +
    `Status: ${valid ? "VALID" : "INVALID"}\n` +
    `Errors: ${errors.length}, Warnings: ${warnings.length}\n`;

  if (errors.length > 0) {
    msg +=
      "\nErrors:\n" + errors.map((e) => `  [ERROR] ${e.message}`).join("\n");
  }
  if (warnings.length > 0) {
    msg +=
      "\nWarnings:\n" + warnings.map((w) => `  [WARN] ${w.message}`).join("\n");
  }

  return { success: true, result: { valid, errors, warnings }, message: msg };
}

// ── Load ────────────────────────────────────────────────────────────

async function handleLoad(filePath, projectRoot) {
  const resolved = _deps.path.isAbsolute(filePath)
    ? filePath
    : _deps.path.resolve(projectRoot, filePath);
  if (!_deps.fs.existsSync(resolved)) {
    return { success: false, error: "File not found: " + resolved };
  }
  let content;
  try {
    content = _deps.fs.readFileSync(resolved, "utf-8");
  } catch (err) {
    return { success: false, error: "Cannot read: " + err.message };
  }
  let data;
  try {
    data = JSON.parse(content);
  } catch (err) {
    return { success: false, error: "Invalid JSON: " + err.message };
  }

  graph.entities.clear();
  graph.relationships = [];

  for (const ent of data.entities || []) {
    graph.entities.set((ent.name || "").toLowerCase(), {
      name: ent.name || "",
      type: ent.type || "concept",
      mentions: ent.mentions || 1,
      properties: ent.properties || {},
    });
  }
  for (const rel of data.relationships || []) {
    graph.relationships.push({
      source: rel.source || "",
      target: rel.target || "",
      type: rel.type || "related_to",
      weight: rel.weight || 1,
    });
  }

  return {
    success: true,
    result: {
      entities: graph.entities.size,
      relationships: graph.relationships.length,
    },
    message: `Loaded ${graph.entities.size} entities, ${graph.relationships.length} relationships.`,
  };
}

// ── Main Handler ────────────────────────────────────────────────────

module.exports = {
  async init(_skill) {
    logger.info("[knowledge-graph] init (v2.0 + Ontology)");
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
    const ontologyMatch = /--ontology/i.test(input);
    const validateMatch = /--validate/i.test(input);

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
      if (ontologyMatch) {
        return handleOntology();
      }
      if (validateMatch) {
        return handleValidate();
      }
      if (exportMatch) {
        const format = formatMatch ? formatMatch[1].trim() : "json";
        return handleExport(format);
      }
      if (loadMatch) {
        return await handleLoad(loadMatch[1].trim(), projectRoot);
      }

      if (!input) {
        return {
          success: false,
          error: "No action specified.",
          message:
            "Usage: /knowledge-graph [action]\n\n" +
            "Actions:\n" +
            "  --extract <file>            Extract entities/relationships\n" +
            "  --analyze --centrality       Centrality analysis\n" +
            '  --query "<entity>"           Query entity\n' +
            "  --stats                      Graph statistics\n" +
            "  --export --format json|csv|dot|owl|jsonld|wikilinks\n" +
            "  --load <file>                Load from JSON\n" +
            "  --ontology                   Generate ontology documentation\n" +
            "  --validate                   Validate graph consistency",
        };
      }

      if (input.match(/\.\w{1,6}$/) && !input.startsWith("-")) {
        return await handleExtract(input, projectRoot);
      }
      return handleQuery(input);
    } catch (err) {
      logger.error("[knowledge-graph] Error:", err);
      return { success: false, error: err.message };
    }
  },

  _deps,
  _graph: graph,
};
