/**
 * Text Humanizer Skill Handler
 */
const { logger } = require("../../../../../utils/logger.js");

// Common AI writing patterns with replacements
const AI_PATTERNS = [
  { pattern: /\bdelve(?:s|d)?\s+into\b/gi, replacement: "look at", label: "delve into" },
  { pattern: /\btapestry\s+of\b/gi, replacement: "mix of", label: "tapestry of" },
  { pattern: /\bit(?:'s| is) important to note that\b/gi, replacement: "", label: "it's important to note that" },
  { pattern: /\bit(?:'s| is) worth noting that\b/gi, replacement: "", label: "it's worth noting that" },
  { pattern: /\bin conclusion,?\s*/gi, replacement: "So, ", label: "in conclusion" },
  { pattern: /\bfurthermore,?\s*/gi, replacement: "Also, ", label: "furthermore" },
  { pattern: /\bmoreover,?\s*/gi, replacement: "On top of that, ", label: "moreover" },
  { pattern: /\bnevertheless,?\s*/gi, replacement: "Still, ", label: "nevertheless" },
  { pattern: /\bnotwithstanding\b/gi, replacement: "despite", label: "notwithstanding" },
  { pattern: /\bleverage(?:s|d)?\b/gi, replacement: "use", label: "leverage" },
  { pattern: /\butilize(?:s|d)?\b/gi, replacement: "use", label: "utilize" },
  { pattern: /\bfacilitate(?:s|d)?\b/gi, replacement: "help with", label: "facilitate" },
  { pattern: /\bcommence(?:s|d)?\b/gi, replacement: "start", label: "commence" },
  { pattern: /\bterminate(?:s|d)?\b/gi, replacement: "end", label: "terminate" },
  { pattern: /\bsignificantly\b/gi, replacement: "really", label: "significantly" },
  { pattern: /\bsubstantially\b/gi, replacement: "a lot", label: "substantially" },
  { pattern: /\bmultifaceted\b/gi, replacement: "complex", label: "multifaceted" },
  { pattern: /\bparadigm\s+shift\b/gi, replacement: "big change", label: "paradigm shift" },
  { pattern: /\bholistic\s+approach\b/gi, replacement: "overall plan", label: "holistic approach" },
  { pattern: /\bsynerg(?:y|ies|ize|izes)\b/gi, replacement: "teamwork", label: "synergy" },
  { pattern: /\bin today(?:'s| s) (?:fast-paced|rapidly evolving|ever-changing)\b/gi, replacement: "these days in our", label: "in today's [buzzword]" },
  { pattern: /\bplethora\s+of\b/gi, replacement: "lots of", label: "plethora of" },
  { pattern: /\bmyriad\s+of\b/gi, replacement: "many", label: "myriad of" },
  { pattern: /\bpivotal\s+role\b/gi, replacement: "key part", label: "pivotal role" },
  { pattern: /\bseamless(?:ly)?\b/gi, replacement: "smooth", label: "seamless" },
  { pattern: /\brobust\b/gi, replacement: "strong", label: "robust" },
  { pattern: /\bcutting[\s-]edge\b/gi, replacement: "latest", label: "cutting-edge" },
  { pattern: /\bgroundbreaking\b/gi, replacement: "new", label: "groundbreaking" },
  { pattern: /\bempowering\b/gi, replacement: "helping", label: "empowering" },
  { pattern: /\btransformative\b/gi, replacement: "game-changing", label: "transformative" },
  { pattern: /\bfoster(?:s|ing|ed)?\b/gi, replacement: "build", label: "foster" },
  { pattern: /\bnecessitate(?:s|d)?\b/gi, replacement: "need", label: "necessitate" },
  { pattern: /\bameliorate(?:s|d)?\b/gi, replacement: "improve", label: "ameliorate" },
  { pattern: /\bascertain(?:s|ed)?\b/gi, replacement: "find out", label: "ascertain" },
  { pattern: /\bexhibit(?:s|ed)?\b/gi, replacement: "show", label: "exhibit" },
  { pattern: /\bdemonstrate(?:s|d)?\b/gi, replacement: "show", label: "demonstrate" },
  { pattern: /\bpossess(?:es|ed)?\b/gi, replacement: "have", label: "possess" },
  { pattern: /\bendeavor(?:s|ed)?\b/gi, replacement: "try", label: "endeavor" },
];

// Hedging/padding patterns
const HEDGING_PATTERNS = [
  { pattern: /\bIt is (?:widely|generally) (?:acknowledged|recognized|accepted) that\b/gi, label: "padding opener" },
  { pattern: /\bAs (?:we|one) (?:can|may) (?:see|observe|note),?\s*/gi, label: "unnecessary qualifier" },
  { pattern: /\bIn the realm of\b/gi, label: "in the realm of" },
  { pattern: /\bIn the context of\b/gi, label: "in the context of" },
  { pattern: /\bIt goes without saying\b/gi, label: "it goes without saying" },
  { pattern: /\bAt the end of the day,?\s*/gi, label: "at the end of the day" },
  { pattern: /\bThat being said,?\s*/gi, label: "that being said" },
  { pattern: /\bHaving said that,?\s*/gi, label: "having said that" },
];

// Sentence structure patterns that feel AI-generated
const STRUCTURE_PATTERNS = [
  { pattern: /^(?:In order to|With that in mind|With this in mind|To that end)/gm, label: "formulaic opener" },
  { pattern: /\. (?:This|It) (?:is|was) (?:important|crucial|essential|vital|imperative) (?:to|that)\b/g, label: "importance statement" },
  { pattern: /\bThis (?:ensures|allows|enables|provides|offers)\b/g, label: "this [verb] pattern" },
];

module.exports = {
  async init(skill) {
    logger.info("[Humanizer] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    try {
      switch (parsed.action) {
        case "humanize": return handleHumanize(parsed.text);
        case "analyze": return handleAnalyze(parsed.text);
        case "adjust-tone": return handleAdjustTone(parsed.tone, parsed.text);
        default: return { success: false, error: `Unknown action: ${parsed.action}. Available: humanize, analyze, adjust-tone` };
      }
    } catch (error) {
      logger.error("[Humanizer] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") return { action: "humanize", text: "", tone: "casual" };
  const parts = input.trim().split(/\s+/);
  const action = (parts[0] || "humanize").toLowerCase();

  if (action === "adjust-tone") {
    const tone = (parts[1] || "casual").toLowerCase();
    const text = parts.slice(2).join(" ");
    return { action, tone, text };
  }

  return { action, text: parts.slice(1).join(" "), tone: "casual" };
}

function handleHumanize(text) {
  if (!text) return { success: false, error: "Provide text to humanize." };

  let result = text;
  const changes = [];

  // Apply AI pattern replacements
  for (const { pattern, replacement, label } of AI_PATTERNS) {
    const before = result;
    result = result.replace(pattern, replacement);
    if (result !== before) changes.push({ type: "replaced", pattern: label, replacement });
  }

  // Remove hedging patterns
  for (const { pattern, label } of HEDGING_PATTERNS) {
    const before = result;
    result = result.replace(pattern, "");
    if (result !== before) changes.push({ type: "removed", pattern: label });
  }

  // Fix double spaces from removals
  result = result.replace(/\s{2,}/g, " ").trim();

  // Fix sentences starting with lowercase after removal
  result = result.replace(/\.\s+([a-z])/g, (match, letter) => `. ${letter.toUpperCase()}`);

  // Fix sentences that now start with a comma or lowercase
  result = result.replace(/^\s*,\s*/gm, "");
  result = result.replace(/^([a-z])/gm, (match, letter) => letter.toUpperCase());

  // Vary sentence starters if too many start with "The" or "This"
  const sentences = result.split(/(?<=\.)\s+/);
  let theCount = 0;
  for (const s of sentences) {
    if (/^(The|This)\s/.test(s)) theCount++;
  }
  if (theCount > sentences.length * 0.5 && sentences.length > 3) {
    changes.push({ type: "note", pattern: "repetitive sentence starters", replacement: "Consider varying how sentences begin" });
  }

  // Add contractions for natural feel
  const contractionsBefore = result;
  result = result.replace(/\bdo not\b/gi, "don't");
  result = result.replace(/\bcannot\b/gi, "can't");
  result = result.replace(/\bwill not\b/gi, "won't");
  result = result.replace(/\bit is\b/gi, "it's");
  result = result.replace(/\bthat is\b/gi, "that's");
  result = result.replace(/\bthey are\b/gi, "they're");
  result = result.replace(/\bwe are\b/gi, "we're");
  result = result.replace(/\byou are\b/gi, "you're");
  if (result !== contractionsBefore) changes.push({ type: "contracted", pattern: "formal expansions", replacement: "contractions" });

  return {
    success: true,
    action: "humanize",
    result: { original: text, humanized: result, changes, changeCount: changes.length },
    message: `Humanized text with ${changes.length} change(s) applied.`,
  };
}

function handleAnalyze(text) {
  if (!text) return { success: false, error: "Provide text to analyze." };

  const detections = [];
  let totalScore = 0;

  // Check AI word patterns
  for (const { pattern, label } of AI_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      detections.push({ category: "ai-vocabulary", pattern: label, occurrences: matches.length, severity: "medium" });
      totalScore += matches.length * 5;
    }
  }

  // Check hedging patterns
  for (const { pattern, label } of HEDGING_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      detections.push({ category: "hedging", pattern: label, occurrences: matches.length, severity: "low" });
      totalScore += matches.length * 3;
    }
  }

  // Check structure patterns
  for (const { pattern, label } of STRUCTURE_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) {
      detections.push({ category: "structure", pattern: label, occurrences: matches.length, severity: "medium" });
      totalScore += matches.length * 4;
    }
  }

  // Check sentence length uniformity (AI tends to write similar-length sentences)
  const sentences = text.split(/[.!?]+/).filter((s) => s.trim().length > 0);
  if (sentences.length >= 3) {
    const lengths = sentences.map((s) => s.trim().split(/\s+/).length);
    const avg = lengths.reduce((a, b) => a + b, 0) / lengths.length;
    const variance = lengths.reduce((sum, l) => sum + Math.pow(l - avg, 2), 0) / lengths.length;
    const stdDev = Math.sqrt(variance);
    if (stdDev < 3 && avg > 8) {
      detections.push({ category: "structure", pattern: "uniform sentence length", occurrences: 1, severity: "high" });
      totalScore += 10;
    }
  }

  // Check for excessive comma usage (AI loves commas)
  const commaRatio = (text.match(/,/g) || []).length / (text.split(/\s+/).length || 1);
  if (commaRatio > 0.12) {
    detections.push({ category: "punctuation", pattern: "excessive commas", occurrences: 1, severity: "low" });
    totalScore += 5;
  }

  // Check for list-like structure
  const bulletPoints = (text.match(/^[\s]*[-*]\s/gm) || []).length;
  if (bulletPoints >= 3) {
    detections.push({ category: "structure", pattern: "list-heavy formatting", occurrences: bulletPoints, severity: "low" });
    totalScore += 3;
  }

  // Check for lack of contractions
  const formalCount = (text.match(/\b(do not|cannot|will not|it is|that is|they are|we are|you are)\b/gi) || []).length;
  if (formalCount >= 3) {
    detections.push({ category: "formality", pattern: "no contractions used", occurrences: formalCount, severity: "medium" });
    totalScore += formalCount * 2;
  }

  // Normalize score to 0-100 (higher = more AI-like)
  const aiScore = Math.min(100, totalScore);
  const naturalness = Math.max(0, 100 - aiScore);

  let verdict;
  if (naturalness >= 80) verdict = "Looks natural and human-written";
  else if (naturalness >= 60) verdict = "Mostly natural with some AI patterns";
  else if (naturalness >= 40) verdict = "Moderate AI writing patterns detected";
  else if (naturalness >= 20) verdict = "Strong AI writing patterns detected";
  else verdict = "Very likely AI-generated text";

  return {
    success: true,
    action: "analyze",
    result: {
      naturalness,
      aiScore,
      verdict,
      detections,
      wordCount: text.split(/\s+/).length,
      sentenceCount: sentences.length,
    },
    message: `Naturalness: ${naturalness}/100 - ${verdict}. Found ${detections.length} pattern(s).`,
  };
}

function handleAdjustTone(tone, text) {
  if (!text) return { success: false, error: "Provide text to adjust." };

  const validTones = ["casual", "formal", "friendly", "professional"];
  if (!validTones.includes(tone)) {
    return { success: false, error: `Invalid tone "${tone}". Available: ${validTones.join(", ")}` };
  }

  let result = text;
  const changes = [];

  switch (tone) {
    case "casual":
      result = result.replace(/\bdo not\b/gi, "don't");
      result = result.replace(/\bcannot\b/gi, "can't");
      result = result.replace(/\bwill not\b/gi, "won't");
      result = result.replace(/\bit is\b/gi, "it's");
      result = result.replace(/\bwe are\b/gi, "we're");
      result = result.replace(/\btherefore,?\s*/gi, "so ");
      result = result.replace(/\bhowever,?\s*/gi, "but ");
      result = result.replace(/\badditionally,?\s*/gi, "plus, ");
      result = result.replace(/\bpurchase(?:s|d)?\b/gi, "buy");
      result = result.replace(/\binquire(?:s|d)?\b/gi, "ask");
      result = result.replace(/\brequire(?:s|d)?\b/gi, "need");
      result = result.replace(/\bassist(?:s|ed)?\b/gi, "help");
      result = result.replace(/\bprior to\b/gi, "before");
      result = result.replace(/\bsubsequent(?:ly)?\b/gi, "then");
      result = result.replace(/\bregarding\b/gi, "about");
      changes.push({ type: "tone", from: "formal", to: "casual" });
      break;

    case "formal":
      result = result.replace(/\bdon't\b/g, "do not");
      result = result.replace(/\bcan't\b/g, "cannot");
      result = result.replace(/\bwon't\b/g, "will not");
      result = result.replace(/\bit's\b/g, "it is");
      result = result.replace(/\bwe're\b/g, "we are");
      result = result.replace(/\bthey're\b/g, "they are");
      result = result.replace(/\byou're\b/g, "you are");
      result = result.replace(/\bgot\b/gi, "obtained");
      result = result.replace(/\bbuy\b/gi, "purchase");
      result = result.replace(/\bask\b/gi, "inquire");
      result = result.replace(/\bneed\b/gi, "require");
      result = result.replace(/\bbut\b/gi, "however,");
      result = result.replace(/\bso\b/gi, "therefore,");
      changes.push({ type: "tone", from: "casual", to: "formal" });
      break;

    case "friendly":
      result = result.replace(/\bdo not\b/gi, "don't");
      result = result.replace(/\bcannot\b/gi, "can't");
      result = result.replace(/\bPlease note\b/gi, "Just so you know");
      result = result.replace(/\bWe regret\b/gi, "Sorry, but");
      result = result.replace(/\bIt is recommended\b/gi, "We'd suggest");
      result = result.replace(/\bYou are required to\b/gi, "You'll want to");
      result = result.replace(/\bfailure to\b/gi, "if you skip");
      result = result.replace(/\bimmediately\b/gi, "right away");
      result = result.replace(/\bprohibited\b/gi, "not allowed");
      changes.push({ type: "tone", from: "neutral", to: "friendly" });
      break;

    case "professional":
      result = result.replace(/\bdon't\b/g, "do not");
      result = result.replace(/\bcan't\b/g, "cannot");
      result = result.replace(/\bstuff\b/gi, "materials");
      result = result.replace(/\bkind of\b/gi, "somewhat");
      result = result.replace(/\ba lot of\b/gi, "numerous");
      result = result.replace(/\bget\b/gi, "obtain");
      result = result.replace(/\bbig\b/gi, "significant");
      result = result.replace(/\bgood\b/gi, "effective");
      result = result.replace(/\bbad\b/gi, "suboptimal");
      result = result.replace(/\bfix\b/gi, "resolve");
      result = result.replace(/\bcheck\b/gi, "verify");
      changes.push({ type: "tone", from: "casual", to: "professional" });
      break;
  }

  return {
    success: true,
    action: "adjust-tone",
    result: { original: text, adjusted: result, tone, changes },
    message: `Text adjusted to "${tone}" tone.`,
  };
}
