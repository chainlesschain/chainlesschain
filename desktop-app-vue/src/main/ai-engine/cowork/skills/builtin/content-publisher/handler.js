/**
 * Content Publisher Skill Handler
 *
 * AI-powered content generation and multi-platform publishing.
 */

const { logger } = require("../../../../../utils/logger.js");
const path = require("path");
const fs = require("fs");

module.exports = {
  async init(skill) {
    logger.info("[ContentPublisher] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(`[ContentPublisher] Action: ${parsed.action}, Topic: "${parsed.topic}"`);

    try {
      switch (parsed.action) {
        case "infographic":
          return handleInfographic(parsed.topic);
        case "slides":
          return handleSlides(parsed.topic, parsed.options);
        case "cover":
          return handleCover(parsed.topic, parsed.options);
        case "comic":
          return handleComic(parsed.topic, parsed.options);
        case "social":
          return handleSocial(parsed.topic, parsed.options);
        case "list-templates":
          return handleListTemplates();
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use infographic, slides, cover, comic, social, or list-templates.`,
          };
      }
    } catch (error) {
      logger.error("[ContentPublisher] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "list-templates", topic: "", options: {} };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "list-templates").toLowerCase();

  const quotedMatch = trimmed.match(/"([^"]+)"/);
  const topic = quotedMatch
    ? quotedMatch[1]
    : parts.slice(1).filter((p) => !p.startsWith("--")).join(" ");

  const options = {};
  const countMatch = trimmed.match(/--count\s+(\d+)/);
  if (countMatch) options.count = parseInt(countMatch[1], 10);

  const aspectMatch = trimmed.match(/--aspect\s+(\S+)/);
  if (aspectMatch) options.aspect = aspectMatch[1];

  const platformMatch = trimmed.match(/--platform\s+(\S+)/);
  if (platformMatch) options.platform = platformMatch[1];

  const panelsMatch = trimmed.match(/--panels\s+(\d+)/);
  if (panelsMatch) options.panels = parseInt(panelsMatch[1], 10);

  return { action, topic, options };
}

function handleInfographic(topic) {
  if (!topic) {
    return { success: false, error: "No topic provided." };
  }

  const content = {
    type: "infographic",
    title: topic,
    sections: [
      {
        type: "header",
        title: topic,
        subtitle: `A visual guide to ${topic}`,
      },
      {
        type: "statistics",
        title: "Key Facts",
        items: [
          { label: "Fact 1", value: "[data point]", icon: "chart" },
          { label: "Fact 2", value: "[data point]", icon: "trend" },
          { label: "Fact 3", value: "[data point]", icon: "target" },
        ],
      },
      {
        type: "process",
        title: "How It Works",
        steps: [
          { step: 1, title: "Step 1", description: "[description]" },
          { step: 2, title: "Step 2", description: "[description]" },
          { step: 3, title: "Step 3", description: "[description]" },
        ],
      },
      {
        type: "comparison",
        title: "Comparison",
        columns: ["Feature", "Option A", "Option B"],
        rows: [
          ["Feature 1", "[value]", "[value]"],
          ["Feature 2", "[value]", "[value]"],
        ],
      },
      {
        type: "conclusion",
        title: "Key Takeaway",
        text: `[Summary of ${topic}]`,
        cta: "Learn More",
      },
    ],
    imageSpec: {
      width: 1200,
      height: 2400,
      backgroundColor: "#1a1a2e",
      accentColor: "#e94560",
      fontFamily: "Inter, sans-serif",
    },
  };

  return {
    success: true,
    action: "infographic",
    topic,
    content,
    message: `Infographic structure for "${topic}" generated. Use with an image generation tool to render.`,
  };
}

function handleSlides(topic, options = {}) {
  if (!topic) {
    return { success: false, error: "No topic provided." };
  }

  const slideCount = options.count || 8;
  const slides = [
    {
      number: 1,
      type: "title",
      title: topic,
      subtitle: `Presented by [Author]`,
      notes: "Welcome and introduction.",
    },
    {
      number: 2,
      type: "agenda",
      title: "Agenda",
      bullets: ["Background", "Key Points", "Analysis", "Recommendations", "Q&A"],
      notes: "Overview of what we'll cover.",
    },
  ];

  for (let i = 3; i < slideCount; i++) {
    slides.push({
      number: i,
      type: "content",
      title: `Section ${i - 2}`,
      bullets: ["Point 1", "Point 2", "Point 3"],
      visual: "[Chart/Image suggestion]",
      notes: `[Speaker notes for section ${i - 2}]`,
    });
  }

  slides.push({
    number: slideCount,
    type: "closing",
    title: "Thank You",
    subtitle: "Questions?",
    notes: "Open the floor for questions.",
  });

  return {
    success: true,
    action: "slides",
    topic,
    slideCount: slides.length,
    slides,
    message: `${slides.length}-slide deck for "${topic}" generated.`,
  };
}

function handleCover(title, options = {}) {
  if (!title) {
    return { success: false, error: "No title provided." };
  }

  const aspect = options.aspect || "2.35:1";
  const aspectMap = {
    "2.35:1": { width: 1200, height: 510 },
    "16:9": { width: 1920, height: 1080 },
    "1:1": { width: 1080, height: 1080 },
    "9:16": { width: 1080, height: 1920 },
  };

  const dims = aspectMap[aspect] || aspectMap["2.35:1"];

  return {
    success: true,
    action: "cover",
    title,
    spec: {
      ...dims,
      aspect,
      layout: {
        title: { text: title, fontSize: 48, color: "#ffffff", position: "center" },
        background: { type: "gradient", from: "#1a1a2e", to: "#16213e" },
        overlay: { opacity: 0.3 },
      },
    },
    message: `Cover image spec for "${title}" (${aspect}) generated.`,
  };
}

function handleComic(topic, options = {}) {
  if (!topic) {
    return { success: false, error: "No topic provided." };
  }

  const panelCount = options.panels || 6;
  const panels = [];

  panels.push({
    number: 1,
    type: "intro",
    scene: `A character encounters a problem related to ${topic}`,
    dialogue: `"I've been trying to understand ${topic}..."`,
    visual: "Character at desk, looking confused",
  });

  for (let i = 2; i < panelCount; i++) {
    panels.push({
      number: i,
      type: "explanation",
      scene: `Step ${i - 1} of explaining ${topic}`,
      dialogue: `"Here's how it works..."`,
      visual: `[Visual metaphor for concept ${i - 1}]`,
    });
  }

  panels.push({
    number: panelCount,
    type: "conclusion",
    scene: "Character has an 'aha!' moment",
    dialogue: `"Now I get it! ${topic} is actually simple!"`,
    visual: "Character smiling with lightbulb",
  });

  return {
    success: true,
    action: "comic",
    topic,
    panelCount: panels.length,
    panels,
    style: "Logicomix/Ohmsha educational comic style",
    message: `${panels.length}-panel comic for "${topic}" generated.`,
  };
}

function handleSocial(content, options = {}) {
  if (!content) {
    return { success: false, error: "No content provided." };
  }

  const platform = (options.platform || "twitter").toLowerCase();

  const formatted = {};
  switch (platform) {
    case "twitter":
    case "x":
      if (content.length <= 280) {
        formatted.posts = [content];
      } else {
        // Thread mode
        const chunks = splitIntoChunks(content, 270);
        formatted.posts = chunks.map(
          (chunk, i) => `${i + 1}/${chunks.length} ${chunk}`,
        );
      }
      formatted.platform = "Twitter/X";
      break;

    case "linkedin":
      formatted.posts = [content.substring(0, 1300)];
      formatted.platform = "LinkedIn";
      break;

    case "wechat":
      formatted.posts = [content];
      formatted.platform = "WeChat";
      formatted.format = "rich-text";
      break;

    default:
      formatted.posts = [content];
      formatted.platform = platform;
  }

  return {
    success: true,
    action: "social",
    platform: formatted.platform,
    postCount: formatted.posts.length,
    posts: formatted.posts,
    message: `Content formatted for ${formatted.platform} (${formatted.posts.length} post(s)).`,
  };
}

function handleListTemplates() {
  return {
    success: true,
    action: "list-templates",
    templates: [
      {
        name: "infographic",
        description: "Multi-section visual infographic",
      },
      { name: "slides", description: "Presentation slide deck" },
      {
        name: "cover",
        description: "Article/blog cover image specs",
      },
      { name: "comic", description: "Knowledge comic panels" },
      { name: "social", description: "Social platform formatted posts" },
    ],
  };
}

function splitIntoChunks(text, maxLen) {
  const words = text.split(/\s+/);
  const chunks = [];
  let current = "";

  for (const word of words) {
    if (current.length + word.length + 1 > maxLen) {
      chunks.push(current.trim());
      current = word;
    } else {
      current += (current ? " " : "") + word;
    }
  }
  if (current) chunks.push(current.trim());

  return chunks;
}
