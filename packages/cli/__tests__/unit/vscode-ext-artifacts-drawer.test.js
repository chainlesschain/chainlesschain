/**
 * Artifacts drawer core (gap #9) — pure shaping / filtering / previewability
 * derivation / action derivation / HTML rendering (escaping!) over the
 * `cc artifacts list --json` metadata rows. Headless (no `vscode`); the
 * webview glue lives in ui/artifacts-view.js.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  ARTIFACT_KINDS,
  buildArtifactsListArgs,
  buildArtifactsShowArgs,
  buildArtifactsRemoveArgs,
  defaultArtifactsDir,
  formatSize,
  previewKindForMime,
  deriveArtifactActions,
  shapeArtifact,
  shapeArtifacts,
  filterArtifacts,
  escapeHtml,
  renderArtifactsHtml,
} from "../../../vscode-extension/src/artifacts-drawer.js";

const NOW = Date.parse("2026-07-11T12:00:00Z");

const entry = (over = {}) => ({
  id: "art_abc_1234",
  title: "Weekly report",
  kind: "report",
  mime: "text/markdown",
  size: 2048,
  sha256: "deadbeefcafe0123456789",
  sourcePath: "C:/work/report.md",
  file: "art_abc_1234.md",
  sessionId: "sess-1",
  createdAt: "2026-07-11T11:00:00Z",
  expiresAt: "2026-08-10T11:00:00Z",
  ...over,
});

describe("build*Args", () => {
  it("returns the exact cc argv arrays the panel spawns", () => {
    expect(buildArtifactsListArgs()).toEqual(["artifacts", "list", "--json"]);
    expect(buildArtifactsShowArgs("art_1")).toEqual([
      "artifacts",
      "show",
      "art_1",
      "--json",
    ]);
    expect(buildArtifactsRemoveArgs("art_1")).toEqual([
      "artifacts",
      "remove",
      "art_1",
      "--json",
    ]);
  });
});

describe("defaultArtifactsDir", () => {
  it("honours CC_ARTIFACTS_DIR, else ~/.chainlesschain/artifacts", () => {
    expect(
      defaultArtifactsDir("C:/Users/u", { CC_ARTIFACTS_DIR: "D:/x" }),
    ).toBe("D:/x");
    const p = defaultArtifactsDir("C:/Users/u", {});
    expect(p.replace(/\\/g, "/")).toBe("C:/Users/u/.chainlesschain/artifacts");
  });
});

describe("formatSize", () => {
  it("buckets human sizes", () => {
    expect(formatSize(0)).toBe("0 B");
    expect(formatSize(512)).toBe("512 B");
    expect(formatSize(2048)).toBe("2.0 KB");
    expect(formatSize(3.4 * 1024 * 1024)).toBe("3.4 MB");
    expect(formatSize(2 * 1024 * 1024 * 1024)).toBe("2.0 GB");
    expect(formatSize(null)).toBe("");
    expect(formatSize(-1)).toBe("");
  });
});

describe("previewKindForMime (previewability derivation)", () => {
  it("maps mimes to preview kinds", () => {
    expect(previewKindForMime("text/markdown", "a.md")).toBe("markdown");
    expect(previewKindForMime("image/png", "a.png")).toBe("image");
    expect(previewKindForMime("image/jpeg", "a.jpg")).toBe("image");
    expect(previewKindForMime("text/html", "a.html")).toBe("html");
    expect(previewKindForMime("text/plain", "a.log")).toBe("text");
    expect(previewKindForMime("application/json", "a.json")).toBe("text");
    expect(previewKindForMime("text/x-patch", "a.patch")).toBe("text");
  });

  it("treats svg as TEXT (document can carry scripts), never image", () => {
    expect(previewKindForMime("image/svg+xml", "a.svg")).toBe("text");
    expect(previewKindForMime("application/octet-stream", "a.svg")).toBe(
      "text",
    );
  });

  it("falls back to the extension only for octet-stream / missing mime", () => {
    expect(previewKindForMime("application/octet-stream", "shot.png")).toBe(
      "image",
    );
    expect(previewKindForMime("", "notes.md")).toBe("markdown");
    // A concrete non-previewable mime does NOT ext-fall-back
    expect(previewKindForMime("application/pdf", "a.md")).toBeNull();
  });

  it("binary / unknown → null (no preview)", () => {
    expect(previewKindForMime("application/zip", "a.zip")).toBeNull();
    expect(previewKindForMime("application/octet-stream", "a.bin")).toBeNull();
    expect(previewKindForMime(null, null)).toBeNull();
  });
});

describe("deriveArtifactActions", () => {
  it("previewable rows get preview + the always-on set", () => {
    expect(deriveArtifactActions({ preview: "markdown" })).toEqual([
      "preview",
      "copyPath",
      "reveal",
      "download",
      "remove",
    ]);
    expect(deriveArtifactActions({ preview: "image" })).toContain("preview");
    expect(deriveArtifactActions({ preview: "text" })).toContain("preview");
  });

  it("html rows get openExternal, never in-panel preview", () => {
    const acts = deriveArtifactActions({ preview: "html" });
    expect(acts).toContain("openExternal");
    expect(acts).not.toContain("preview");
  });

  it("non-previewable rows still copy/reveal/download/remove", () => {
    expect(deriveArtifactActions({ preview: null })).toEqual([
      "copyPath",
      "reveal",
      "download",
      "remove",
    ]);
    expect(deriveArtifactActions(null)).toEqual([]);
  });
});

describe("shapeArtifact / shapeArtifacts", () => {
  it("shapes a metadata row (kind meta, size label, epoch, preview, actions)", () => {
    const row = shapeArtifact(entry());
    expect(row.id).toBe("art_abc_1234");
    expect(row.kind).toBe("report");
    expect(row.kindLabel).toBe("report");
    expect(row.kindIcon).toBeTruthy();
    expect(row.sizeLabel).toBe("2.0 KB");
    expect(row.createdAt).toBe(Date.parse("2026-07-11T11:00:00Z"));
    expect(row.preview).toBe("markdown");
    expect(row.actions).toContain("preview");
    expect(row.sessionId).toBe("sess-1");
  });

  it("normalizes junk kinds to other and junk rows to null", () => {
    expect(shapeArtifact(entry({ kind: "??" })).kind).toBe("other");
    expect(shapeArtifact(null)).toBeNull();
    expect(shapeArtifact({ notAnId: true })).toBeNull();
  });

  it("accepts {artifacts:[…]} or a bare array, sorts newest first", () => {
    const payload = {
      artifacts: [
        entry({ id: "old", createdAt: "2026-07-01T00:00:00Z" }),
        entry({ id: "new", createdAt: "2026-07-11T00:00:00Z" }),
        null,
        { junk: 1 },
      ],
    };
    expect(shapeArtifacts(payload).map((r) => r.id)).toEqual(["new", "old"]);
    expect(shapeArtifacts([entry()])).toHaveLength(1);
    expect(shapeArtifacts("garbage")).toEqual([]);
    expect(shapeArtifacts(undefined)).toEqual([]);
  });

  it("covers all six CLI kinds", () => {
    expect(ARTIFACT_KINDS.sort()).toEqual(
      ["report", "patch", "screenshot", "log", "data", "other"].sort(),
    );
  });
});

describe("filterArtifacts", () => {
  const rows = shapeArtifacts([
    entry({ id: "art_a", title: "Fix login bug", kind: "report" }),
    entry({
      id: "art_b",
      title: "屏幕截图",
      kind: "screenshot",
      mime: "image/png",
      file: "art_b.png",
      sessionId: "sess-9",
    }),
  ]);

  it("matches case-insensitively on title / id / session / file", () => {
    expect(filterArtifacts(rows, { query: "LOGIN" })).toHaveLength(1);
    expect(filterArtifacts(rows, { query: "屏幕" })).toHaveLength(1);
    expect(filterArtifacts(rows, { query: "sess-9" })).toHaveLength(1);
    expect(filterArtifacts(rows, { query: "art_b.png" })).toHaveLength(1);
    expect(filterArtifacts(rows, { query: "nomatch" })).toHaveLength(0);
  });

  it("filters by kind, 'all' passes everything, both combine", () => {
    expect(filterArtifacts(rows, { kind: "screenshot" })).toHaveLength(1);
    expect(filterArtifacts(rows, { kind: "all" })).toHaveLength(2);
    expect(filterArtifacts(rows, {})).toHaveLength(2);
    expect(
      filterArtifacts(rows, { kind: "screenshot", query: "login" }),
    ).toHaveLength(0);
  });
});

describe("renderArtifactsHtml (escaping!)", () => {
  it("escapes hostile titles / paths / session ids everywhere", () => {
    const rows = shapeArtifacts([
      entry({
        id: "art_evil",
        title: "<img src=x onerror=alert(1)>",
        sessionId: 'x"onmouseover="alert(1)',
        file: "art_<script>evil</script>.md",
      }),
    ]);
    const html = renderArtifactsHtml(rows, { now: NOW });
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>evil");
    expect(html).not.toContain('"onmouseover="');
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("&quot;onmouseover=&quot;");
  });

  it("never inlines file bodies — only metadata fields appear", () => {
    const rows = shapeArtifacts([entry()]);
    const html = renderArtifactsHtml(rows, { now: NOW });
    expect(html).toContain("Weekly report");
    expect(html).toContain("session sess-1");
    expect(html).toContain("sha256 deadbeefcafe…");
    expect(html).toContain("2.0 KB");
    expect(html).toContain("1h ago");
  });

  it("emits action buttons with data attributes from the derived actions", () => {
    const rows = shapeArtifacts([
      entry({ id: "art_md" }),
      entry({
        id: "art_html",
        mime: "text/html",
        file: "art_html.html",
        title: "page",
      }),
      entry({
        id: "art_zip",
        mime: "application/zip",
        file: "art_zip.zip",
        title: "bundle",
      }),
    ]);
    const html = renderArtifactsHtml(rows, { now: NOW });
    expect(html).toContain('data-act="preview" data-id="art_md"');
    expect(html).toContain('data-act="openExternal" data-id="art_html"');
    expect(html).not.toContain('data-act="preview" data-id="art_html"');
    expect(html).not.toContain('data-act="preview" data-id="art_zip"');
    expect(html).toContain('data-act="remove" data-id="art_zip"');
    expect(html).toContain('data-act="copyPath" data-id="art_zip"');
    expect(html).toContain(">Open in browser</button>");
    expect(html).toContain(">Download</button>");
  });

  it("renders per-source warning rows and an empty message", () => {
    const html = renderArtifactsHtml([], {
      now: NOW,
      errors: [{ source: "cc artifacts list", message: "spawn <b>ENOENT</b>" }],
    });
    expect(html).toContain("cc artifacts list");
    expect(html).toContain("&lt;b&gt;ENOENT&lt;/b&gt;");
    expect(html).not.toContain("<b>ENOENT");
    expect(html).toContain("No artifacts");
  });

  it("escapeHtml covers the full special-character set", () => {
    expect(escapeHtml(`&<>"'`)).toBe("&amp;&lt;&gt;&quot;&#39;");
    expect(escapeHtml(null)).toBe("");
  });
});

describe("manifest wiring", () => {
  const ext = (rel) =>
    fileURLToPath(new URL("../../../vscode-extension/" + rel, import.meta.url));
  const pkg = JSON.parse(readFileSync(ext("package.json"), "utf-8"));

  it("declares the chainlesschain.artifacts.show command with an nls title", () => {
    const cmd = (pkg.contributes?.commands || []).find(
      (c) => c.command === "chainlesschain.artifacts.show",
    );
    expect(cmd).toBeTruthy();
    expect(cmd.title).toBe("%cmd.artifacts.show.title%");
  });

  it("has the title key in both nls files", () => {
    const en = JSON.parse(readFileSync(ext("package.nls.json"), "utf-8"));
    const zh = JSON.parse(readFileSync(ext("package.nls.zh-cn.json"), "utf-8"));
    expect(en["cmd.artifacts.show.title"]).toContain("Artifacts");
    expect(zh["cmd.artifacts.show.title"]).toContain("Artifacts");
  });

  it("extension.js registers the command", () => {
    const src = readFileSync(ext("src/extension.js"), "utf-8");
    expect(src).toContain('"chainlesschain.artifacts.show"');
    expect(src).toContain("openArtifactsDrawer");
  });
});
