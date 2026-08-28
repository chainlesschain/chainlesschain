import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { afterEach, describe, expect, it, vi } from "vitest";

const require = createRequire(import.meta.url);
const {
  BUNDLED_SKILL_PROCESS_POLICIES,
  createBundledSkillProcessBroker,
  parseShellFreeCommand,
  requireBundledSkillProcessBroker,
} = require("../bundled-skill-process-broker.js");

const temporaryDirectories = [];

function temporaryDirectory() {
  const directory = fs.mkdtempSync(
    path.join(os.tmpdir(), "cc-process-broker-"),
  );
  temporaryDirectories.push(directory);
  return directory;
}

function createBroker(skillId, overrides = {}) {
  const root = overrides.root || temporaryDirectory();
  const executeFileSync = overrides.executeFileSync || vi.fn(() => "ok");
  const auditSink = overrides.auditSink || vi.fn();
  const broker = createBundledSkillProcessBroker(
    {
      skillId,
      authorityId: `approval:${skillId}`,
      allowedRoots: [root],
      allowedEntrypoints: overrides.allowedEntrypoints || [],
      approvedInvocations: overrides.approvedInvocations || [],
    },
    { executeFileSync, auditSink },
  );
  return { broker, root, executeFileSync, auditSink };
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

describe("bundled Skill process broker", () => {
  it("publishes an exact frozen policy set for the migrated handlers", () => {
    expect(Object.isFrozen(BUNDLED_SKILL_PROCESS_POLICIES)).toBe(true);
    expect(Object.keys(BUNDLED_SKILL_PROCESS_POLICIES).sort()).toEqual([
      "audio-transcriber",
      "auto-context",
      "bugbot",
      "changelog-generator",
      "clipboard-manager",
      "commit-splitter",
      "create-pr",
      "dependency-analyzer",
      "diff-previewer",
      "doc-generator",
      "env-doctor",
      "fault-localizer",
      "git-commit",
      "git-history-analyzer",
      "git-worktree-manager",
      "impact-analyzer",
      "k8s-deployer",
      "lint-and-fix",
      "media-metadata",
      "pdh-im-collect",
      "performance-profiler",
      "pr-reviewer",
      "release-manager",
      "research-agent",
      "skill-creator",
      "system-monitor",
      "test-and-fix",
      "verification-loop",
      "verify",
      "video-toolkit",
      "vulnerability-scanner",
    ]);
  });

  it("requires a branded broker with exact Skill scope", () => {
    const { broker } = createBroker("create-pr");
    expect(
      requireBundledSkillProcessBroker({ processBroker: broker }, "create-pr"),
    ).toBe(broker);
    expect(() =>
      requireBundledSkillProcessBroker(
        { processBroker: broker },
        "pr-reviewer",
      ),
    ).toThrowError(/unavailable/i);
    expect(() =>
      requireBundledSkillProcessBroker(
        { processBroker: { execFileSync() {} } },
        "create-pr",
      ),
    ).toThrowError(/unavailable/i);
  });

  it("passes a frozen, bounded request to the trusted adapter", () => {
    const executeFileSync = vi.fn((request) => {
      expect(Object.isFrozen(request)).toBe(true);
      expect(Object.isFrozen(request.args)).toBe(true);
      return "main\n";
    });
    const { broker, root } = createBroker("create-pr", { executeFileSync });
    expect(
      broker.execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: root,
        timeout: 60_000,
      }),
    ).toBe("main\n");
    expect(executeFileSync).toHaveBeenCalledWith(
      expect.objectContaining({
        skillId: "create-pr",
        file: "git",
        timeout: 10_000,
        maxBuffer: 8 * 1024 * 1024,
      }),
    );
  });

  it("rejects shell commands, unreviewed subcommands, and escaped cwd", () => {
    const { broker, root, executeFileSync } = createBroker(
      "git-worktree-manager",
    );
    expect(() =>
      broker.execFileSync("git status", [], { cwd: root }),
    ).toThrowError(/executable names/i);
    expect(() =>
      broker.execFileSync("git", ["reset", "--hard"], { cwd: root }),
    ).toThrowError(/not approved/i);
    expect(() =>
      broker.execFileSync("git", ["status", "--short"], {
        cwd: path.dirname(root),
      }),
    ).toThrowError(/outside approved roots/i);
    expect(executeFileSync).not.toHaveBeenCalled();
  });

  it("allows only reviewed kubectl and PR commands", () => {
    const k8s = createBroker("k8s-deployer");
    expect(() =>
      k8s.broker.execFileSync(
        "kubectl",
        ["rollout", "restart", "deployment/api"],
        { cwd: k8s.root },
      ),
    ).not.toThrow();
    expect(() =>
      k8s.broker.execFileSync("kubectl", ["delete", "deployment", "api"], {
        cwd: k8s.root,
      }),
    ).toThrowError(/not approved/i);

    const reviewer = createBroker("pr-reviewer");
    expect(() =>
      reviewer.broker.execFileSync("gh", ["pr", "diff", "42"], {
        cwd: reviewer.root,
      }),
    ).not.toThrow();
    expect(() =>
      reviewer.broker.execFileSync("git", ["push", "--force"], {
        cwd: reviewer.root,
      }),
    ).toThrowError(/not approved/i);
  });

  it("allows the reviewed Git analysis commands without a shell", () => {
    const cases = [
      [
        "auto-context",
        [
          "log",
          "--diff-filter=M",
          "--name-only",
          "--pretty=format:",
          "-n",
          "20",
        ],
      ],
      ["bugbot", ["diff", "release/v1..HEAD"]],
      [
        "changelog-generator",
        ["log", "v1.0.0..HEAD", "--pretty=format:%H|%s|%an|%ai|%b---END---"],
      ],
      ["commit-splitter", ["status", "--porcelain"]],
      [
        "doc-generator",
        [
          "log",
          "HEAD~20..HEAD",
          "--pretty=format:%H|%s|%an|%ad",
          "--date=short",
        ],
      ],
      ["git-commit", ["commit", "-m", "fix(core): keep argv structured"]],
      [
        "git-history-analyzer",
        ["log", "--pretty=tformat:", "--numstat", "-n", "200"],
      ],
      ["impact-analyzer", ["diff", "--cached", "--name-only"]],
    ];

    for (const [skillId, args] of cases) {
      const { broker, root } = createBroker(skillId);
      expect(() =>
        broker.execFileSync("git", args, { cwd: root }),
      ).not.toThrow();
    }
  });

  it("allows every final-batch fixed command shape and rejects injection", () => {
    const root = temporaryDirectory();
    const target = path.join(root, "target.js");
    fs.writeFileSync(target, "export default true;\n");
    const cases = [
      ["audio-transcriber", "whisper", [target, "--output_format", "json"]],
      [
        "audio-transcriber",
        "ffprobe",
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", target],
      ],
      ["clipboard-manager", "xclip", ["-selection", "clipboard", "-o"]],
      ["dependency-analyzer", "npm", ["audit", "--json"]],
      ["env-doctor", "node", ["--version"]],
      ["lint-and-fix", "npx", ["eslint", "--format", "json", target]],
      [
        "media-metadata",
        "ffprobe",
        ["-v", "error", "-show_format", "-show_streams", "-of", "json", target],
      ],
      [
        "release-manager",
        "git",
        [
          "log",
          "v1.0.0..HEAD",
          "--pretty=format:%H|%s|%an|%ad",
          "--date=short",
        ],
      ],
      ["research-agent", "npm", ["view", "@scope/pkg", "--json"]],
      ["system-monitor", "df", ["-h"]],
      ["test-and-fix", "npx", ["vitest", "run", "--reporter=json", target]],
      ["verification-loop", "npm", ["run", "build"]],
      ["verification-loop", "git", ["diff", "--stat"]],
      ["verify", "python", ["-m", "pytest", "-q"]],
      [
        "video-toolkit",
        "ffmpeg",
        ["-y", "-i", target, path.join(root, "converted.mp4")],
      ],
      ["vulnerability-scanner", "npm", ["audit", "--json"]],
    ];
    for (const [skillId, file, args] of cases) {
      const { broker } = createBroker(skillId, { root });
      expect(() =>
        broker.execFileSync(file, args, { cwd: root }),
      ).not.toThrow();
    }

    const research = createBroker("research-agent", { root });
    expect(() =>
      research.broker.execFileSync(
        "npm",
        ["view", "safe-package;touch-pwned", "--json"],
        { cwd: root },
      ),
    ).toThrowError(/not approved/i);
    const audio = createBroker("audio-transcriber", { root });
    expect(() =>
      audio.broker.execFileSync(
        "whisper",
        [target, "--output_format", "json", "--language", "en;whoami"],
        { cwd: root },
      ),
    ).toThrowError(/not approved/i);
    const outside = temporaryDirectory();
    const video = createBroker("video-toolkit", { root });
    expect(() =>
      video.broker.execFileSync(
        "ffmpeg",
        ["-y", "-i", target, path.join(outside, "escaped.mp4")],
        { cwd: root },
      ),
    ).toThrowError(/not approved/i);
    expect(() =>
      video.broker.execFileSync("ffmpeg", ["-y", "-i", target, target], {
        cwd: root,
      }),
    ).toThrowError(/not approved/i);
  });

  it("parses quoted commands into argv without interpreting shell syntax", () => {
    expect(
      parseShellFreeCommand('node "script with spaces.js" --flag'),
    ).toEqual({
      file: "node",
      args: ["script with spaces.js", "--flag"],
    });
    expect(parseShellFreeCommand("npm test && whoami")).toEqual({
      file: "npm",
      args: ["test", "&&", "whoami"],
    });
    expect(() => parseShellFreeCommand('node "unterminated')).toThrowError(
      /unterminated/i,
    );
  });

  it("restricts video transforms to reviewed ffmpeg argv and contained outputs", () => {
    const root = temporaryDirectory();
    const input = path.join(root, "input.mp4");
    fs.writeFileSync(input, "fixture\n");
    const { broker } = createBroker("video-toolkit", { root });
    const commands = [
      [
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        input,
        "-frames:v",
        "1",
        path.join(root, "thumb.png"),
      ],
      [
        "-y",
        "-i",
        input,
        "-vn",
        "-acodec",
        "libmp3lame",
        path.join(root, "audio.mp3"),
      ],
      [
        "-y",
        "-i",
        input,
        "-vf",
        "scale=1280:720",
        "-b:v",
        "2500k",
        path.join(root, "compressed.mp4"),
      ],
      [
        "-y",
        "-ss",
        "00:00:01",
        "-i",
        input,
        "-t",
        "00:00:05",
        "-c",
        "copy",
        path.join(root, "clip.mp4"),
      ],
    ];
    for (const args of commands) {
      expect(() =>
        broker.execFileSync("ffmpeg", args, { cwd: root }),
      ).not.toThrow();
    }
    expect(() =>
      broker.execFileSync(
        "ffmpeg",
        ["-y", "-i", input, "-filter_complex", "movie=payload", "out.mp4"],
        { cwd: root },
      ),
    ).toThrowError(/not approved/i);
  });

  it("contains Git file arguments to approved roots", () => {
    const root = temporaryDirectory();
    const left = path.join(root, "left.txt");
    const right = path.join(root, "right.txt");
    fs.writeFileSync(left, "left\n");
    fs.writeFileSync(right, "right\n");

    const previewer = createBroker("diff-previewer", { root });
    expect(() =>
      previewer.broker.execFileSync(
        "git",
        ["diff", "--no-index", "--", left, right],
        { cwd: root },
      ),
    ).not.toThrow();

    const outsideRoot = temporaryDirectory();
    const outside = path.join(outsideRoot, "outside.txt");
    fs.writeFileSync(outside, "outside\n");
    expect(() =>
      previewer.broker.execFileSync(
        "git",
        ["diff", "--no-index", "--", left, outside],
        { cwd: root },
      ),
    ).toThrowError(/not approved/i);

    const localizer = createBroker("fault-localizer", { root });
    expect(() =>
      localizer.broker.execFileSync(
        "git",
        ["log", "-1", "--format=%ct", "--", left],
        { cwd: root },
      ),
    ).not.toThrow();
  });

  it("rejects Git option injection and unreviewed mutations", () => {
    const bugbot = createBroker("bugbot");
    expect(() =>
      bugbot.broker.execFileSync("git", ["diff", "--output=/tmp/leak"], {
        cwd: bugbot.root,
      }),
    ).toThrowError(/not approved/i);

    const commit = createBroker("git-commit");
    expect(() =>
      commit.broker.execFileSync("git", ["push", "--force"], {
        cwd: commit.root,
      }),
    ).toThrowError(/not approved/i);

    const history = createBroker("git-history-analyzer");
    expect(() =>
      history.broker.execFileSync(
        "git",
        ["log", "--pretty=format:---COMMIT---", "--numstat", "-n", "20"],
        { cwd: history.root },
      ),
    ).toThrowError(/not approved/i);
  });

  it("pins fallback PDH node execution to approved entrypoints", () => {
    const root = temporaryDirectory();
    const entrypoint = path.join(root, "chainlesschain.js");
    fs.writeFileSync(entrypoint, "// fixture\n");
    const { broker } = createBroker("pdh-im-collect", {
      root,
      allowedEntrypoints: [entrypoint],
    });
    expect(() =>
      broker.execFileSync("node", [entrypoint, "hub", "readiness", "--json"], {
        cwd: root,
      }),
    ).not.toThrow();
    const other = path.join(root, "other.js");
    fs.writeFileSync(other, "// other\n");
    expect(() =>
      broker.execFileSync("node", [other, "hub", "readiness", "--json"], {
        cwd: root,
      }),
    ).toThrowError(/not approved/i);
  });

  it("requires exact authority approval for caller-selected commands", () => {
    const approved = createBroker("verify", {
      approvedInvocations: [{ file: "custom-test", args: ["--ci"] }],
    });
    expect(() =>
      approved.broker.execFileSync("custom-test", ["--ci"], {
        cwd: approved.root,
      }),
    ).not.toThrow();
    expect(() =>
      approved.broker.execFileSync("custom-test", ["--watch"], {
        cwd: approved.root,
      }),
    ).toThrowError(/not approved/i);
    expect(() =>
      createBroker("release-manager", {
        approvedInvocations: [{ file: "git", args: ["push"] }],
      }),
    ).toThrowError(/not allowed/i);
  });

  it("bounds clipboard stdin and Skill Creator environment values", () => {
    const clipboard = createBroker("clipboard-manager");
    clipboard.broker.execFileSync("pbcopy", [], {
      cwd: clipboard.root,
      input: "safe clipboard text",
    });
    expect(clipboard.executeFileSync).toHaveBeenCalledWith(
      expect.objectContaining({ input: "safe clipboard text" }),
    );
    expect(() =>
      clipboard.broker.execFileSync("pbcopy", [], {
        cwd: clipboard.root,
        input: "x".repeat(1024 * 1024 + 1),
      }),
    ).toThrowError(/input limit/i);

    const entrypoint = path.join(clipboard.root, "chainlesschain.js");
    fs.writeFileSync(entrypoint, "// fixture\n");
    const creator = createBroker("skill-creator", {
      root: clipboard.root,
      allowedEntrypoints: [entrypoint],
    });
    creator.broker.execFileSync("node", [entrypoint, "ask", "prompt"], {
      cwd: clipboard.root,
      env: { PATH: "runtime", CHAINLESSCHAIN_QUIET: "1" },
    });
    expect(() =>
      creator.broker.execFileSync("node", [entrypoint, "ask", "prompt"], {
        cwd: clipboard.root,
        env: { NODE_OPTIONS: "--require=payload.js" },
      }),
    ).toThrowError(/unapproved key/i);
  });

  it("never writes argument values or adapter output to audit records", () => {
    const auditSink = vi.fn();
    const { broker, root } = createBroker("pdh-im-collect", {
      auditSink,
      executeFileSync: () => "adapter-output-secret",
    });
    broker.execFileSync(
      "cc",
      ["hub", "sync-adapter", "qq-pc", "--passphrase", "top-secret"],
      { cwd: root },
    );
    const serialized = JSON.stringify(auditSink.mock.calls);
    expect(serialized).not.toContain("top-secret");
    expect(serialized).not.toContain("adapter-output-secret");
    expect(serialized).toContain("sync-adapter");
  });

  it("fails closed for invalid output and adapter failure", () => {
    const invalid = createBroker("create-pr", {
      executeFileSync: () => ({ output: "not data-only" }),
    });
    expect(() =>
      invalid.broker.execFileSync(
        "git",
        ["rev-parse", "--abbrev-ref", "HEAD"],
        { cwd: invalid.root },
      ),
    ).toThrowError(/unsupported output type/i);

    const failed = createBroker("create-pr", {
      executeFileSync: () => {
        throw new Error("denied by host");
      },
    });
    expect(() =>
      failed.broker.execFileSync("git", ["rev-parse", "--abbrev-ref", "HEAD"], {
        cwd: failed.root,
      }),
    ).toThrowError("denied by host");
  });

  it("contains no native child-process fallback", () => {
    const source = fs.readFileSync(
      path.resolve(
        "src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js",
      ),
      "utf8",
    );
    expect(source).not.toMatch(/require\(["'](?:node:)?child_process["']\)/);
    expect(source).not.toContain("process.env");
  });

  it("keeps every migrated handler free of direct child_process imports", () => {
    const skillIds = Object.keys(BUNDLED_SKILL_PROCESS_POLICIES);
    for (const skillId of skillIds) {
      const source = fs.readFileSync(
        path.resolve(
          `src/main/ai-engine/cowork/skills/builtin/${skillId}/handler.js`,
        ),
        "utf8",
      );
      expect(source, skillId).not.toMatch(
        /require\(["'](?:node:)?child_process["']\)/,
      );
    }
  });
});
