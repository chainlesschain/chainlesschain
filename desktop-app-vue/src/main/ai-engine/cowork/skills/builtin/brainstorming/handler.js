/**
 * Brainstorming Skill Handler
 *
 * Creative ideation using structured methodologies:
 * ideate, mindmap, swot, sixhats, scamper.
 */

const { logger } = require("../../../../../utils/logger.js");

// ── Mode definitions ─────────────────────────────────────────────
const MODES = {
  ideate: "ideate",
  mindmap: "mindmap",
  swot: "swot",
  sixhats: "sixhats",
  scamper: "scamper",
};

const SIX_HATS = [
  {
    hat: "White",
    focus: "Facts & Information",
    question: "What data do we have? What data do we need?",
  },
  {
    hat: "Red",
    focus: "Feelings & Intuition",
    question: "What is your gut feeling? What emotions does this evoke?",
  },
  {
    hat: "Black",
    focus: "Caution & Risks",
    question: "What could go wrong? What are the weaknesses?",
  },
  {
    hat: "Yellow",
    focus: "Benefits & Optimism",
    question: "What are the benefits? Why will this work?",
  },
  {
    hat: "Green",
    focus: "Creativity & Alternatives",
    question: "What are alternative approaches? What new ideas emerge?",
  },
  {
    hat: "Blue",
    focus: "Process & Summary",
    question: "What is the big picture? What are the next steps?",
  },
];

const SCAMPER_PROMPTS = [
  {
    letter: "S",
    method: "Substitute",
    question:
      "What can be substituted? Different materials, people, processes?",
  },
  {
    letter: "C",
    method: "Combine",
    question: "What can be combined? Merge features, blend ideas?",
  },
  {
    letter: "A",
    method: "Adapt",
    question: "What can be adapted? Borrow from other domains?",
  },
  {
    letter: "M",
    method: "Modify",
    question: "What can be modified? Change size, shape, color, process?",
  },
  {
    letter: "P",
    method: "Put to other use",
    question: "What other uses? New contexts, different users?",
  },
  {
    letter: "E",
    method: "Eliminate",
    question: "What can be eliminated? Remove steps, simplify?",
  },
  {
    letter: "R",
    method: "Reverse/Rearrange",
    question: "What if reversed? Change order, flip assumptions?",
  },
];

// ── Helpers ──────────────────────────────────────────────────────

function parseInput(raw) {
  const input = (raw || "").trim();
  if (!input) {
    return { mode: MODES.ideate, topic: "" };
  }

  const firstWord = input.split(/\s+/)[0].toLowerCase();
  if (MODES[firstWord]) {
    return { mode: firstWord, topic: input.slice(firstWord.length).trim() };
  }
  return { mode: MODES.ideate, topic: input };
}

function generateIdeate(topic) {
  const categories = [
    {
      name: "Quick Wins",
      description: "Low effort, high impact ideas",
      ideas: [],
    },
    {
      name: "Strategic",
      description: "High effort, high impact ideas",
      ideas: [],
    },
    {
      name: "Experimental",
      description: "Innovative approaches worth exploring",
      ideas: [],
    },
    {
      name: "Incremental",
      description: "Small improvements that add up",
      ideas: [],
    },
  ];

  const lines = [`# Brainstorming: ${topic}`, ""];
  for (const cat of categories) {
    lines.push(`## ${cat.name}`);
    lines.push(`_${cat.description}_`);
    lines.push("");
    lines.push("- [ ] _(Add ideas here)_");
    lines.push("");
  }
  lines.push("## Next Steps");
  lines.push("1. Review and prioritize ideas above");
  lines.push("2. Select top 3 ideas for further exploration");
  lines.push("3. Create action items for selected ideas");

  return {
    output: lines.join("\n"),
    data: {
      topic,
      categories: categories.map((c) => c.name),
      method: "ideate",
    },
  };
}

function generateMindmap(topic) {
  const lines = [
    `# Mind Map: ${topic}`,
    "",
    "```",
    `${topic}`,
    "|",
    "+-- Aspect 1",
    "|   +-- Sub-topic 1.1",
    "|   +-- Sub-topic 1.2",
    "|",
    "+-- Aspect 2",
    "|   +-- Sub-topic 2.1",
    "|   +-- Sub-topic 2.2",
    "|",
    "+-- Aspect 3",
    "|   +-- Sub-topic 3.1",
    "|   +-- Sub-topic 3.2",
    "|",
    "+-- Connections & Dependencies",
    "    +-- (identify cross-cutting concerns)",
    "```",
    "",
    "## Instructions",
    "1. Fill in each branch with specific sub-topics",
    "2. Add cross-references between related branches",
    "3. Identify the most important branches to explore first",
  ];

  return {
    output: lines.join("\n"),
    data: {
      topic,
      method: "mindmap",
      branches: ["Aspect 1", "Aspect 2", "Aspect 3", "Connections"],
    },
  };
}

function generateSwot(topic) {
  const lines = [
    `# SWOT Analysis: ${topic}`,
    "",
    "## Strengths (Internal, Positive)",
    "- [ ] _(What advantages exist?)_",
    "- [ ] _(What is done well?)_",
    "- [ ] _(What unique resources are available?)_",
    "",
    "## Weaknesses (Internal, Negative)",
    "- [ ] _(What could be improved?)_",
    "- [ ] _(What is lacking?)_",
    "- [ ] _(What are known limitations?)_",
    "",
    "## Opportunities (External, Positive)",
    "- [ ] _(What trends can be leveraged?)_",
    "- [ ] _(What gaps exist in the market/domain?)_",
    "- [ ] _(What external changes are beneficial?)_",
    "",
    "## Threats (External, Negative)",
    "- [ ] _(What obstacles exist?)_",
    "- [ ] _(What are competitors doing?)_",
    "- [ ] _(What risks are on the horizon?)_",
    "",
    "## Strategy Matrix",
    "| | Strengths | Weaknesses |",
    "|---|---|---|",
    "| **Opportunities** | SO: Use strengths to exploit opportunities | WO: Overcome weaknesses via opportunities |",
    "| **Threats** | ST: Use strengths to counter threats | WT: Minimize weaknesses & avoid threats |",
  ];

  return {
    output: lines.join("\n"),
    data: {
      topic,
      method: "swot",
      quadrants: ["Strengths", "Weaknesses", "Opportunities", "Threats"],
    },
  };
}

function generateSixHats(topic) {
  const lines = [`# Six Thinking Hats: ${topic}`, ""];
  for (const hat of SIX_HATS) {
    lines.push(`## ${hat.hat} Hat - ${hat.focus}`);
    lines.push(`> ${hat.question}`);
    lines.push("");
    lines.push("- [ ] _(Add thoughts here)_");
    lines.push("");
  }
  lines.push("## Summary");
  lines.push("After considering all perspectives, the key insights are:");
  lines.push("1. ...");
  lines.push("2. ...");
  lines.push("3. ...");

  return {
    output: lines.join("\n"),
    data: { topic, method: "sixhats", hats: SIX_HATS.map((h) => h.hat) },
  };
}

function generateScamper(topic) {
  const lines = [`# SCAMPER Analysis: ${topic}`, ""];
  for (const item of SCAMPER_PROMPTS) {
    lines.push(`## [${item.letter}] ${item.method}`);
    lines.push(`> ${item.question}`);
    lines.push("");
    lines.push("- [ ] _(Add ideas here)_");
    lines.push("");
  }
  lines.push("## Top Ideas");
  lines.push("Select the most promising ideas from above:");
  lines.push("1. ...");
  lines.push("2. ...");
  lines.push("3. ...");

  return {
    output: lines.join("\n"),
    data: {
      topic,
      method: "scamper",
      steps: SCAMPER_PROMPTS.map((p) => p.letter),
    },
  };
}

// ── Handler ──────────────────────────────────────────────────────

module.exports = {
  async init(skill) {
    logger.info(
      `[brainstorming] handler initialized for "${skill?.name || "brainstorming"}"`,
    );
  },

  async execute(task, context, _skill) {
    const raw = task?.params?.input || task?.input || task?.action || "";
    const { mode, topic } = parseInput(raw);

    if (!topic) {
      return {
        success: false,
        output:
          "Usage: /brainstorming [mode] <topic>\nModes: ideate, mindmap, swot, sixhats, scamper",
        error: "No topic provided",
      };
    }

    try {
      let result;
      switch (mode) {
        case MODES.mindmap:
          result = generateMindmap(topic);
          break;
        case MODES.swot:
          result = generateSwot(topic);
          break;
        case MODES.sixhats:
          result = generateSixHats(topic);
          break;
        case MODES.scamper:
          result = generateScamper(topic);
          break;
        default:
          result = generateIdeate(topic);
          break;
      }

      logger.info(`[brainstorming] generated ${mode} for topic: ${topic}`);

      return {
        success: true,
        output: result.output,
        result: result.data,
        message: `Generated ${mode} brainstorming for: ${topic}`,
      };
    } catch (err) {
      logger.error("[brainstorming] Error:", err.message);
      return {
        success: false,
        output: `Error: ${err.message}`,
        error: err.message,
      };
    }
  },
};
