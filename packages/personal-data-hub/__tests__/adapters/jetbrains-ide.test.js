"use strict";

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const {
  JetBrainsIdeAdapter,
  JETBRAINS_IDE_NAME,
  JETBRAINS_IDE_VERSION,
  discoverJetBrainsProductConfigs,
  parseJetBrainsRecentProjectsXml,
} = require("../../lib/adapters/jetbrains-ide");
const { assertAdapter } = require("../../lib/adapter-spec");
const { EVENT_SUBTYPES, ITEM_SUBTYPES } = require("../../lib/constants");
const { validateEvent, validateItem } = require("../../lib/schemas");

let temporaryDirectory;
let configRoot;

function escapeXml(value) {
  return String(value)
    .replace(/&/gu, "&amp;")
    .replace(/"/gu, "&quot;")
    .replace(/</gu, "&lt;")
    .replace(/>/gu, "&gt;");
}

function recentProjectsXml(projects) {
  const entries = projects
    .map((project) => {
      const options = [
        project.openedAt == null
          ? ""
          : `<option name="projectOpenTimestamp" value="${project.openedAt}" />`,
        project.activatedAt == null
          ? ""
          : `<option name="activationTimestamp" value="${project.activatedAt}" />`,
        project.productCode
          ? `<option name="productionCode" value="${escapeXml(project.productCode)}" />`
          : "",
        project.currentBranch
          ? `<option name="currentBranch" value="${escapeXml(project.currentBranch)}" />`
          : "",
      ].join("");
      return `<entry key="${escapeXml(project.path)}"><value><RecentProjectMetaInfo opened="${project.opened === true}" hidden="${project.hidden === true}" frameTitle="${escapeXml(project.frameTitle || "private title")}" projectWorkspaceId="private-workspace-id">${options}</RecentProjectMetaInfo></value></entry>`;
    })
    .join("");
  return `<application><component name="RecentProjectsManager"><option name="additionalInfo"><map>${entries}</map></option></component></application>`;
}

function makeProductConfig(productDirectoryName, projects, opts = {}) {
  const optionsDirectory = join(configRoot, productDirectoryName, "options");
  mkdirSync(optionsDirectory, { recursive: true });
  const filePath = join(optionsDirectory, "recentProjects.xml");
  writeFileSync(filePath, recentProjectsXml(projects), "utf8");
  if (opts.mtimeMs) {
    utimesSync(filePath, opts.mtimeMs / 1000, opts.mtimeMs / 1000);
  }
  return filePath;
}

beforeEach(() => {
  temporaryDirectory = mkdtempSync(join(tmpdir(), "jetbrains-adapter-test-"));
  configRoot = join(temporaryDirectory, "JetBrains");
  mkdirSync(configRoot, { recursive: true });
});

afterEach(() => {
  rmSync(temporaryDirectory, { recursive: true, force: true });
});

describe("JetBrainsIdeAdapter contract and discovery", () => {
  it("discovers product configs beyond the former 100-directory default", () => {
    const configCount = 101;
    for (let index = 0; index < configCount; index++) {
      makeProductConfig(`IdeaIC${String(index).padStart(3, "0")}`, []);
    }

    const result = discoverJetBrainsProductConfigs(configRoot);

    expect(result.configs).toHaveLength(configCount);
    expect(result.complete).toBe(true);
  });

  it("conforms to the adapter contract with stable metadata", () => {
    const adapter = new JetBrainsIdeAdapter();
    expect(assertAdapter(adapter)).toEqual({ ok: true });
    expect(adapter.name).toBe(JETBRAINS_IDE_NAME);
    expect(adapter.name).toBe("jetbrains-ide");
    expect(adapter.version).toBe(JETBRAINS_IDE_VERSION);
    expect(adapter.version).toBe("0.1.0");
    expect(adapter.capabilities).toContain(
      "sync:jetbrains-recent-projects-xml",
    );
    expect(adapter.capabilities).toContain("sync:profile-directory");
    expect(adapter.watermarkStrategy).toBe("max-captured-at");
    expect(adapter.watermarkRequiresCompleteScan).toBe(true);
  });

  it("discovers a config root, a product directory, or the XML file", () => {
    const filePath = makeProductConfig("IntelliJIdea2025.3", []);
    const productDirectory = join(configRoot, "IntelliJIdea2025.3");
    expect(discoverJetBrainsProductConfigs(configRoot).configs).toHaveLength(1);
    expect(
      discoverJetBrainsProductConfigs(productDirectory).configs,
    ).toHaveLength(1);
    expect(discoverJetBrainsProductConfigs(filePath).configs).toHaveLength(1);
  });

  it("authenticates without returning the selected absolute path", async () => {
    makeProductConfig("IdeaIC2024.2", [
      { path: "C:\\private\\alpha", openedAt: 1_700_000_010_000 },
    ]);
    const adapter = new JetBrainsIdeAdapter({ jetbrainsRoot: configRoot });
    const result = await adapter.authenticate({});
    expect(result).toMatchObject({
      ok: true,
      mode: "file-import",
      productConfigCount: 1,
      hasRecentProjects: true,
    });
    expect(JSON.stringify(result)).not.toContain(configRoot);
  });

  it("reports a sanitized not-found result", async () => {
    const adapter = new JetBrainsIdeAdapter({ jetbrainsRoot: configRoot });
    const result = await adapter.authenticate({});
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("JETBRAINS_RECENT_PROJECTS_NOT_FOUND");
    expect(JSON.stringify(result)).not.toContain(configRoot);
  });

  it("uses different hashed scopes for different configuration roots", () => {
    const first = new JetBrainsIdeAdapter({ jetbrainsRoot: configRoot });
    const secondRoot = join(temporaryDirectory, "other-JetBrains");
    mkdirSync(secondRoot, { recursive: true });
    const second = new JetBrainsIdeAdapter({ jetbrainsRoot: secondRoot });
    expect(first.defaultScope).toMatch(/^account:jetbrains-ide:/u);
    expect(second.defaultScope).toMatch(/^account:jetbrains-ide:/u);
    expect(first.defaultScope).not.toBe(second.defaultScope);
    expect(first.defaultScope).not.toContain(configRoot);
  });
});

describe("JetBrains recentProjects.xml parser", () => {
  it("extracts only path-minimized project activity metadata", () => {
    const xml = recentProjectsXml([
      {
        path: "C:\\private & confidential\\alpha.ipr",
        openedAt: 1_700_000_010_000,
        activatedAt: 1_700_000_020_000,
        productCode: "IU",
        opened: true,
        currentBranch: "private-feature",
        frameTitle: "private window title",
      },
    ]);
    const result = parseJetBrainsRecentProjectsXml(xml, {
      productConfigId: "a".repeat(64),
      productKey: "IntelliJIdea",
      productName: "IntelliJ IDEA Ultimate",
      productVersion: "2025.3",
      fileMtimeMs: 1_700_000_030_000,
    });
    expect(result.complete).toBe(true);
    expect(result.projects).toHaveLength(1);
    expect(result.projects[0]).toMatchObject({
      projectName: "alpha",
      productCode: "IU",
      lastOpenedMs: 1_700_000_010_000,
      lastActivatedMs: 1_700_000_020_000,
      capturedAt: 1_700_000_020_000,
      timestampSource: "activation",
      currentlyOpen: true,
    });
    expect(result.projects[0].pathHash).toMatch(/^[0-9a-f]{64}$/u);
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("private & confidential");
    expect(serialized).not.toContain("private-feature");
    expect(serialized).not.toContain("private window title");
    expect(serialized).not.toContain("private-workspace-id");
  });

  it("skips hidden projects and rejects entity declarations", () => {
    const hidden = parseJetBrainsRecentProjectsXml(
      recentProjectsXml([
        {
          path: "C:\\private\\hidden",
          openedAt: 1_700_000_010_000,
          hidden: true,
        },
      ]),
      {
        productConfigId: "a".repeat(64),
        productName: "IntelliJ IDEA",
        fileMtimeMs: 1_700_000_010_000,
      },
    );
    expect(hidden.projects).toHaveLength(0);
    expect(hidden.complete).toBe(true);

    const unsafe = parseJetBrainsRecentProjectsXml(
      '<!DOCTYPE x [<!ENTITY secret "value">]><application />',
    );
    expect(unsafe).toEqual({ projects: [], complete: false });
  });

  it("uses manifest mtime only when the stored project has no timestamps", () => {
    const result = parseJetBrainsRecentProjectsXml(
      recentProjectsXml([{ path: "/private/project" }]),
      {
        productConfigId: "a".repeat(64),
        productName: "WebStorm",
        fileMtimeMs: 1_700_000_030_000,
      },
    );
    expect(result.projects[0].capturedAt).toBe(1_700_000_030_000);
    expect(result.projects[0].timestampSource).toBe("manifest-mtime");
  });
});

describe("JetBrainsIdeAdapter sync", () => {
  it("merges product versions and archives no absolute project path", async () => {
    makeProductConfig("IdeaIC2024.2", [
      {
        path: "C:\\private\\alpha",
        openedAt: 1_700_000_010_000,
        productCode: "IC",
      },
    ]);
    makeProductConfig("IntelliJIdea2025.3", [
      {
        path: "C:\\private\\beta",
        openedAt: 1_700_000_020_000,
        activatedAt: 1_700_000_030_000,
        productCode: "IU",
      },
    ]);
    const adapter = new JetBrainsIdeAdapter({ jetbrainsRoot: configRoot });
    const raws = [];
    for await (const raw of adapter.sync()) raws.push(raw);
    expect(raws).toHaveLength(2);
    expect(raws.map((raw) => raw.payload.projectName)).toEqual([
      "alpha",
      "beta",
    ]);
    expect(raws.map((raw) => raw.capturedAt)).toEqual([
      1_700_000_010_000, 1_700_000_030_000,
    ]);
    expect(new Set(raws.map((raw) => raw.originalId)).size).toBe(2);
    const serialized = JSON.stringify(raws);
    expect(serialized).not.toContain("C:\\\\private");
    expect(serialized).not.toContain(configRoot);
  });

  it("filters by since and supports recentProjects opt-out", async () => {
    makeProductConfig("IntelliJIdea2025.3", [
      { path: "C:\\private\\old", openedAt: 1_700_000_010_000 },
      { path: "C:\\private\\new", openedAt: 1_700_000_030_000 },
    ]);
    const adapter = new JetBrainsIdeAdapter({ jetbrainsRoot: configRoot });
    const incremental = [];
    for await (const raw of adapter.sync({ since: 1_700_000_020_000 })) {
      incremental.push(raw);
    }
    expect(incremental).toHaveLength(1);
    expect(incremental[0].payload.projectName).toBe("new");

    const excluded = [];
    for await (const raw of adapter.sync({
      include: { recentProjects: false },
    })) {
      excluded.push(raw);
    }
    expect(excluded).toHaveLength(0);
  });

  it("only advances the watermark after a complete bounded scan", async () => {
    makeProductConfig("IntelliJIdea2025.3", [
      { path: "C:\\private\\one", openedAt: 1_700_000_010_000 },
      { path: "C:\\private\\two", openedAt: 1_700_000_020_000 },
    ]);
    const adapter = new JetBrainsIdeAdapter({ jetbrainsRoot: configRoot });
    let completed = false;
    const limited = [];
    for await (const raw of adapter.sync({
      limit: 1,
      markWatermarkComplete: () => {
        completed = true;
      },
    })) {
      limited.push(raw);
    }
    expect(limited).toHaveLength(1);
    expect(completed).toBe(false);

    for await (const raw of adapter.sync({
      markWatermarkComplete: () => {
        completed = true;
      },
    })) {
      expect(raw.kind).toBe("recent-project");
    }
    expect(completed).toBe(true);
  });
});

describe("JetBrainsIdeAdapter normalization", () => {
  const raw = {
    kind: "recent-project",
    originalId: "jetbrains-ide-project:root:product:project",
    capturedAt: 1_700_000_020_000,
    payload: {
      projectName: "alpha",
      pathHash: "a".repeat(64),
      productName: "IntelliJ IDEA Ultimate",
      productVersion: "2025.3",
      productCode: "IU",
      lastOpenedMs: 1_700_000_010_000,
      lastActivatedMs: 1_700_000_020_000,
      timestampSource: "activation",
      currentlyOpen: true,
      includeActivityEvent: true,
    },
  };

  it("creates a code-project Item and latest activity Event", () => {
    const normalized = new JetBrainsIdeAdapter().normalize(raw);
    expect(normalized.items).toHaveLength(1);
    expect(normalized.events).toHaveLength(1);
    expect(normalized.items[0].subtype).toBe(ITEM_SUBTYPES.LINK);
    expect(normalized.items[0].category).toBe("code-project");
    expect(normalized.items[0].name).toBe("alpha");
    expect(normalized.events[0].subtype).toBe(EVENT_SUBTYPES.OTHER);
    expect(normalized.events[0].content.title).toBe(
      "Activated alpha in IntelliJ IDEA Ultimate",
    );
    expect(normalized.events[0].extra.kind).toBe("ide-project-activated");
    expect(validateItem(normalized.items[0]).valid).toBe(true);
    expect(validateEvent(normalized.events[0]).valid).toBe(true);
  });

  it("supports activity Event opt-out while preserving the project Item", () => {
    const normalized = new JetBrainsIdeAdapter().normalize({
      ...raw,
      payload: { ...raw.payload, includeActivityEvent: false },
    });
    expect(normalized.items).toHaveLength(1);
    expect(normalized.events).toHaveLength(0);
  });

  it("throws for an unknown raw kind", () => {
    expect(() =>
      new JetBrainsIdeAdapter().normalize({ kind: "unknown" }),
    ).toThrow(/unknown raw\.kind=unknown/u);
  });
});
