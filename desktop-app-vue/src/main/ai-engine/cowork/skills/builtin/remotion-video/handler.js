/**
 * Remotion Video Skill Handler
 *
 * Programmatic video creation with React/Remotion.
 */

const { logger } = require("../../../../../utils/logger.js");
const path = require("path");
const fs = require("fs");

module.exports = {
  async init(skill) {
    logger.info("[RemotionVideo] Initialized");
  },

  async execute(task, context = {}, skill) {
    const input = task.input || task.args || "";
    const parsed = parseInput(input);

    logger.info(
      `[RemotionVideo] Action: ${parsed.action}, Name: ${parsed.name}`,
    );

    try {
      switch (parsed.action) {
        case "create":
          return await handleCreate(parsed.name, context);
        case "preview":
          return handlePreview(parsed.name, context);
        case "render":
          return handleRender(parsed.name, parsed.options, context);
        case "template":
          return handleTemplate(parsed.name);
        case "add-scene":
          return handleAddScene(parsed.name, parsed.options);
        default:
          return {
            success: false,
            error: `Unknown action: ${parsed.action}. Use create, preview, render, template, or add-scene.`,
          };
      }
    } catch (error) {
      logger.error("[RemotionVideo] Error:", error);
      return { success: false, error: error.message };
    }
  },
};

function parseInput(input) {
  if (!input || typeof input !== "string") {
    return { action: "create", name: "my-video", options: {} };
  }

  const trimmed = input.trim();
  const parts = trimmed.split(/\s+/);
  const action = (parts[0] || "create").toLowerCase();
  const name = parts[1] || "my-video";

  const options = {};
  const outputMatch = trimmed.match(/--output\s+(\S+)/);
  if (outputMatch) {
    options.output = outputMatch[1];
  }

  const codecMatch = trimmed.match(/--codec\s+(\S+)/);
  if (codecMatch) {
    options.codec = codecMatch[1];
  }

  return { action, name, options };
}

async function handleCreate(name, context) {
  const projectName = name.replace(/[^a-zA-Z0-9-_]/g, "") || "my-video";
  const projectDir = path.resolve(projectName);

  // Generate project structure info
  const structure = {
    "package.json": generatePackageJson(projectName),
    "src/Root.tsx": generateRootComponent(),
    "src/Composition.tsx": generateComposition(projectName),
    "remotion.config.ts": generateConfig(),
  };

  return {
    success: true,
    action: "create",
    projectName,
    projectPath: projectDir,
    structure: Object.keys(structure),
    files: structure,
    message: `Remotion project "${projectName}" scaffolded. Run \`cd ${projectName} && npm install && npx remotion studio\` to start.`,
    hint: "Use `npx create-video@latest ${projectName}` for the official scaffolding.",
  };
}

function handlePreview(projectPath, context) {
  const dir = projectPath || ".";
  return {
    success: true,
    action: "preview",
    command: `cd "${dir}" && npx remotion studio`,
    url: "http://localhost:3000",
    message: `Start preview with: npx remotion studio`,
  };
}

function handleRender(compositionId, options, context) {
  const id = compositionId || "MyComposition";
  const output = options.output || "out/video.mp4";
  const codec = options.codec || "h264";

  return {
    success: true,
    action: "render",
    command: `npx remotion render ${id} ${output} --codec ${codec}`,
    compositionId: id,
    output,
    codec,
    message: `Render with: npx remotion render ${id} ${output} --codec ${codec}`,
  };
}

function handleTemplate(templateName) {
  const templates = {
    intro: generateIntroTemplate(),
    explainer: generateExplainerTemplate(),
    slideshow: generateSlideshowTemplate(),
    social: generateSocialTemplate(),
    caption: generateCaptionTemplate(),
    chart: generateChartTemplate(),
  };

  const name = (templateName || "intro").toLowerCase();
  const template = templates[name];

  if (!template) {
    return {
      success: true,
      action: "template",
      available: Object.keys(templates),
      message: `Available templates: ${Object.keys(templates).join(", ")}`,
    };
  }

  return {
    success: true,
    action: "template",
    templateName: name,
    code: template,
    message: `Generated "${name}" template. Copy to your src/ directory.`,
  };
}

function handleAddScene(sceneName, options) {
  const name = sceneName || "NewScene";
  const code = `import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const ${name}: React.FC = () => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1a2e", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ color: "white", fontSize: 60, opacity }}>${name}</h1>
    </AbsoluteFill>
  );
};`;

  return {
    success: true,
    action: "add-scene",
    sceneName: name,
    code,
    message: `Scene "${name}" generated. Add to Root.tsx and register as a <Composition>.`,
  };
}

// Template generators

function generatePackageJson(name) {
  return JSON.stringify(
    {
      name,
      version: "1.0.0",
      scripts: {
        start: "remotion studio",
        build: "remotion render MyComposition out/video.mp4",
      },
      dependencies: {
        react: "^18.0.0",
        "react-dom": "^18.0.0",
        remotion: "^4.0.0",
        "@remotion/cli": "^4.0.0",
      },
    },
    null,
    2,
  );
}

function generateRootComponent() {
  return `import { Composition } from "remotion";
import { MyComposition } from "./Composition";

export const RemotionRoot: React.FC = () => {
  return (
    <Composition
      id="MyComposition"
      component={MyComposition}
      durationInFrames={150}
      fps={30}
      width={1920}
      height={1080}
    />
  );
};`;
}

function generateComposition(name) {
  return `import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig } from "remotion";

export const MyComposition: React.FC = () => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();

  const titleOpacity = interpolate(frame, [0, 30], [0, 1], { extrapolateRight: "clamp" });
  const titleScale = spring({ frame, fps, config: { damping: 200 } });

  return (
    <AbsoluteFill style={{ backgroundColor: "#0f0f23", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{
        color: "white",
        fontSize: 72,
        fontFamily: "Inter, sans-serif",
        opacity: titleOpacity,
        transform: \`scale(\${titleScale})\`,
      }}>
        ${name}
      </h1>
    </AbsoluteFill>
  );
};`;
}

function generateConfig() {
  return `import { Config } from "@remotion/cli/config";
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);`;
}

function generateIntroTemplate() {
  return `// Intro Template - Animated title with logo reveal
import { AbsoluteFill, useCurrentFrame, interpolate, spring, useVideoConfig, Sequence } from "remotion";

export const Intro: React.FC<{ title: string }> = ({ title }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const scale = spring({ frame, fps, config: { damping: 200 } });
  const opacity = interpolate(frame, [0, 20], [0, 1], { extrapolateRight: "clamp" });

  return (
    <AbsoluteFill style={{ background: "linear-gradient(135deg, #667eea, #764ba2)", justifyContent: "center", alignItems: "center" }}>
      <h1 style={{ color: "white", fontSize: 80, opacity, transform: \`scale(\${scale})\` }}>{title}</h1>
    </AbsoluteFill>
  );
};`;
}

function generateExplainerTemplate() {
  return `// Explainer Template - Multi-scene with text and icons
import { AbsoluteFill, Sequence, useCurrentFrame, interpolate } from "remotion";

export const Explainer: React.FC<{ scenes: { title: string; body: string }[] }> = ({ scenes }) => {
  return (
    <AbsoluteFill>
      {scenes.map((scene, i) => (
        <Sequence key={i} from={i * 90} durationInFrames={90}>
          <Scene title={scene.title} body={scene.body} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Scene: React.FC<{ title: string; body: string }> = ({ title, body }) => {
  const frame = useCurrentFrame();
  const y = interpolate(frame, [0, 20], [50, 0], { extrapolateRight: "clamp" });
  return (
    <AbsoluteFill style={{ backgroundColor: "#1a1a2e", padding: 80, justifyContent: "center" }}>
      <h2 style={{ color: "#e94560", fontSize: 48, transform: \`translateY(\${y}px)\` }}>{title}</h2>
      <p style={{ color: "white", fontSize: 28, marginTop: 20 }}>{body}</p>
    </AbsoluteFill>
  );
};`;
}

function generateSlideshowTemplate() {
  return `// Slideshow Template - Image/text slides with transitions
import { AbsoluteFill, Sequence, Img, useCurrentFrame, interpolate } from "remotion";

export const Slideshow: React.FC<{ slides: { image?: string; text: string }[] }> = ({ slides }) => {
  return (
    <AbsoluteFill>
      {slides.map((slide, i) => (
        <Sequence key={i} from={i * 120} durationInFrames={120}>
          <Slide {...slide} />
        </Sequence>
      ))}
    </AbsoluteFill>
  );
};

const Slide: React.FC<{ image?: string; text: string }> = ({ image, text }) => {
  const frame = useCurrentFrame();
  const opacity = interpolate(frame, [0, 15, 105, 120], [0, 1, 1, 0]);
  return (
    <AbsoluteFill style={{ opacity, backgroundColor: "#0d1117", justifyContent: "center", alignItems: "center" }}>
      {image && <Img src={image} style={{ maxWidth: "60%", borderRadius: 12 }} />}
      <p style={{ color: "white", fontSize: 36, marginTop: 30, textAlign: "center" }}>{text}</p>
    </AbsoluteFill>
  );
};`;
}

function generateSocialTemplate() {
  return `// Social Media Template - Short vertical clip (9:16)
// Register with width={1080} height={1920} durationInFrames={90} fps={30}
import { AbsoluteFill, useCurrentFrame, spring, useVideoConfig } from "remotion";

export const SocialClip: React.FC<{ headline: string; cta: string }> = ({ headline, cta }) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const bounce = spring({ frame, fps, config: { mass: 0.5 } });
  return (
    <AbsoluteFill style={{ background: "linear-gradient(180deg, #ff6b6b, #feca57)", justifyContent: "center", alignItems: "center", padding: 60 }}>
      <h1 style={{ color: "white", fontSize: 64, textAlign: "center", transform: \`scale(\${bounce})\` }}>{headline}</h1>
      <p style={{ color: "rgba(255,255,255,0.9)", fontSize: 32, marginTop: 40 }}>{cta}</p>
    </AbsoluteFill>
  );
};`;
}

function generateCaptionTemplate() {
  return `// Caption Template - Animated word-by-word subtitles
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const Caption: React.FC<{ words: { text: string; start: number; end: number }[] }> = ({ words }) => {
  const frame = useCurrentFrame();
  const activeWord = words.find(w => frame >= w.start && frame < w.end);
  return (
    <AbsoluteFill style={{ backgroundColor: "#000", justifyContent: "flex-end", alignItems: "center", paddingBottom: 120 }}>
      {activeWord && (
        <span style={{ color: "#fff", fontSize: 48, fontWeight: "bold", background: "rgba(0,0,0,0.7)", padding: "10px 20px", borderRadius: 8 }}>
          {activeWord.text}
        </span>
      )}
    </AbsoluteFill>
  );
};`;
}

function generateChartTemplate() {
  return `// Chart Template - Animated bar chart
import { AbsoluteFill, useCurrentFrame, interpolate } from "remotion";

export const BarChart: React.FC<{ data: { label: string; value: number }[] }> = ({ data }) => {
  const frame = useCurrentFrame();
  const maxVal = Math.max(...data.map(d => d.value));
  return (
    <AbsoluteFill style={{ backgroundColor: "#1e1e2e", padding: 80, justifyContent: "flex-end" }}>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 20, height: "70%" }}>
        {data.map((d, i) => {
          const height = interpolate(frame, [i * 10, i * 10 + 30], [0, (d.value / maxVal) * 100], { extrapolateLeft: "clamp", extrapolateRight: "clamp" });
          return (
            <div key={i} style={{ flex: 1, textAlign: "center" }}>
              <div style={{ height: \`\${height}%\`, background: \`hsl(\${i * 50}, 70%, 60%)\`, borderRadius: "8px 8px 0 0", transition: "height 0.3s" }} />
              <p style={{ color: "white", fontSize: 18, marginTop: 10 }}>{d.label}</p>
            </div>
          );
        })}
      </div>
    </AbsoluteFill>
  );
};`;
}
