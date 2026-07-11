/**
 * Plugin / LSP quality board (gap #11) — pure logic. Host-free.
 *
 * Covers: argv builders against the real CLI surface, tolerant parsers,
 * quality-flag derivation (broken / lsp ok·unavailable·unknown·none / unused —
 * incl. the doc-mandated "an lsp-only plugin is NOT unused" rule and
 * unknown-status honesty when the live probe can't vouch for the plugin's own
 * server), the deliberate ABSENCE of a fabricated `slow` flag, HTML escaping
 * of manifest-controlled strings, and the webview glue wiring.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  COMPONENT_TYPES,
  buildPluginValidateArgs,
  buildCodeIntelStatusArgs,
  parsePluginValidate,
  parseCodeIntelStatus,
  deriveLspAvailability,
  buildQualityRows,
  formatCounts,
  renderQualityHtml,
} from "../../../vscode-extension/src/plugin-quality.js";

const counts = (overrides = {}) => {
  const c = {};
  for (const t of COMPONENT_TYPES) c[t] = 0;
  return { ...c, ...overrides };
};

const validation = (overrides = {}) => ({
  ok: true,
  errors: [],
  warnings: [],
  counts: counts(),
  lsp: [],
  ...overrides,
});

describe("quality argv builders", () => {
  it("targets plugin validate + code-intel status --json", () => {
    expect(buildPluginValidateArgs("C:\\plugins\\p1")).toEqual([
      "plugin",
      "validate",
      "C:\\plugins\\p1",
      "--json",
    ]);
    expect(buildCodeIntelStatusArgs()).toEqual([
      "code-intel",
      "status",
      "--json",
    ]);
  });
});

describe("parsePluginValidate", () => {
  it("returns null for unreadable output", () => {
    expect(parsePluginValidate("")).toBeNull();
    expect(parsePluginValidate("not json")).toBeNull();
    expect(parsePluginValidate("[1,2]")).toBeNull();
  });

  it("normalizes componentCounts + errors + lsp entries", () => {
    const out = parsePluginValidate(
      JSON.stringify({
        ok: false,
        errors: ["manifest.version is required"],
        warnings: ["skill x path not found"],
        componentCounts: { skills: 2, lsp: 1, mcp: "nope" },
        components: {
          lsp: [
            { languageId: "mylang", command: "mylang-ls", id: "mylang-ls" },
            { notAServer: true },
          ],
        },
      }),
    );
    expect(out.ok).toBe(false);
    expect(out.errors).toEqual(["manifest.version is required"]);
    expect(out.counts).toEqual(counts({ skills: 2, lsp: 1 }));
    expect(out.lsp).toEqual([{ languageId: "mylang", id: "mylang-ls" }]);
  });

  it("falls back to the command as the lsp id (registry default)", () => {
    const out = parsePluginValidate(
      JSON.stringify({
        ok: true,
        componentCounts: { lsp: 1 },
        components: { lsp: [{ languageId: "go", command: "gopls" }] },
      }),
    );
    expect(out.lsp).toEqual([{ languageId: "go", id: "gopls" }]);
  });
});

describe("parseCodeIntelStatus", () => {
  it("returns null when the probe is unreadable", () => {
    expect(parseCodeIntelStatus("")).toBeNull();
    expect(parseCodeIntelStatus("{}")).toBeNull(); // no servers array
  });

  it("parses server rows with strict boolean availability", () => {
    const rows = parseCodeIntelStatus(
      JSON.stringify({
        servers: [
          { languageId: "typescript", id: "tsserver", available: true },
          { languageId: "go", id: "gopls", available: "yes" }, // not true
          { noLanguage: true },
        ],
        extensions: [".ts"],
      }),
    );
    expect(rows).toEqual([
      { languageId: "typescript", id: "tsserver", available: true },
      { languageId: "go", id: "gopls", available: false },
    ]);
  });
});

describe("deriveLspAvailability", () => {
  const declared = [{ languageId: "mylang", id: "mylang-ls" }];

  it("'none' when the plugin declares no lsp", () => {
    expect(deriveLspAvailability([], [])).toBe("none");
    expect(deriveLspAvailability(null, null)).toBe("none");
  });

  it("'unknown' when there is no live status data — never fabricated", () => {
    expect(deriveLspAvailability(declared, null)).toBe("unknown");
  });

  it("'unknown' when the status row for the language is a DIFFERENT server", () => {
    // Untrusted plugin → its server never registered; the builtin row for the
    // same languageId proves nothing about the plugin's own binary.
    expect(
      deriveLspAvailability(declared, [
        { languageId: "mylang", id: "someone-else", available: true },
      ]),
    ).toBe("unknown");
  });

  it("'unknown' when the languageId is absent from the probe", () => {
    expect(
      deriveLspAvailability(declared, [
        { languageId: "go", id: "gopls", available: true },
      ]),
    ).toBe("unknown");
  });

  it("'unavailable' when the plugin's own server did not resolve", () => {
    expect(
      deriveLspAvailability(declared, [
        { languageId: "mylang", id: "mylang-ls", available: false },
      ]),
    ).toBe("unavailable");
  });

  it("'ok' when every declared server resolved", () => {
    expect(
      deriveLspAvailability(declared, [
        { languageId: "mylang", id: "mylang-ls", available: true },
      ]),
    ).toBe("ok");
  });
});

describe("buildQualityRows flags", () => {
  const plugin = (name, extra = {}) => ({
    name,
    version: "1.0.0",
    scope: "user",
    dir: `/plugins/${name}`,
    ok: true,
    ...extra,
  });

  it("returns null when the plugin list itself was unreadable", () => {
    expect(buildQualityRows({ plugins: null })).toBeNull();
  });

  it("flags broken from validate errors", () => {
    const rows = buildQualityRows({
      plugins: [plugin("bad")],
      validations: {
        bad: validation({ ok: false, errors: ["manifest.name is required"] }),
      },
    });
    expect(rows[0].broken).toBe(true);
    expect(rows[0].brokenReasons).toEqual(["manifest.name is required"]);
  });

  it("flags unused only when EVERY component count is zero", () => {
    const rows = buildQualityRows({
      plugins: [plugin("empty"), plugin("has-skill")],
      validations: {
        empty: validation(),
        "has-skill": validation({ counts: counts({ skills: 1 }) }),
      },
    });
    expect(rows[0].unused).toBe(true);
    expect(rows[1].unused).toBe(false);
  });

  it("an lsp-only plugin is NOT unused (doc-mandated)", () => {
    const rows = buildQualityRows({
      plugins: [plugin("lsp-only")],
      validations: {
        "lsp-only": validation({
          counts: counts({ lsp: 1 }),
          lsp: [{ languageId: "mylang", id: "mylang-ls" }],
        }),
      },
      lspStatus: [{ languageId: "mylang", id: "mylang-ls", available: false }],
    });
    expect(rows[0].unused).toBe(false);
    expect(rows[0].lsp).toBe("unavailable");
  });

  it("degrades honestly when validate output is missing for a plugin", () => {
    const rows = buildQualityRows({
      plugins: [plugin("mystery")],
      validations: {
        mystery: { failed: true, message: "validate produced no JSON" },
      },
    });
    expect(rows[0].validateFailed).toBe(true);
    expect(rows[0].broken).toBeNull(); // unknown — never fabricated
    expect(rows[0].unused).toBeNull();
    expect(rows[0].lsp).toBe("unknown");
  });

  it("still marks a discovery-level invalid plugin broken without validate", () => {
    const rows = buildQualityRows({
      plugins: [plugin("discovered-bad", { ok: false })],
      validations: {},
    });
    expect(rows[0].broken).toBe(true);
  });

  it("never emits a fabricated `slow` flag — the CLI records no timing", () => {
    const rows = buildQualityRows({
      plugins: [plugin("p")],
      validations: { p: validation() },
    });
    expect("slow" in rows[0]).toBe(false);
  });
});

describe("renderQualityHtml", () => {
  it("escapes manifest-controlled strings (name, errors, version)", () => {
    const rows = buildQualityRows({
      plugins: [
        {
          name: "<img src=x onerror=alert(1)>",
          version: '"><script>',
          scope: "user",
          dir: "/x",
          ok: true,
        },
      ],
      validations: {
        "<img src=x onerror=alert(1)>": validation({
          ok: false,
          errors: ['<script>alert("boom")</script>'],
        }),
      },
    });
    const html = renderQualityHtml(rows);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain(
      "&lt;script&gt;alert(&quot;boom&quot;)&lt;/script&gt;",
    );
  });

  it("shows flags and the unavailable-probe warning", () => {
    const rows = buildQualityRows({
      plugins: [
        { name: "p", version: "1.0.0", scope: "user", dir: "/p", ok: true },
      ],
      validations: {
        p: validation({
          counts: counts({ lsp: 1 }),
          lsp: [{ languageId: "mylang", id: "mylang-ls" }],
        }),
      },
      lspStatus: null,
    });
    const html = renderQualityHtml(rows, { lspStatusAvailable: false });
    expect(html).toContain("lsp unknown");
    expect(html).toContain("code-intel status");
    expect(html).not.toContain("unused");
  });

  it("renders the unreadable / empty states distinctly", () => {
    expect(renderQualityHtml(null)).toContain("could not read plugins");
    expect(renderQualityHtml([])).toContain("No runtime plugins installed");
  });

  it("formats only non-zero component counts", () => {
    expect(formatCounts(counts({ skills: 2, lsp: 1 }))).toBe(
      "skills 2 · lsp 1",
    );
    expect(formatCounts(counts())).toBe("");
  });
});

describe("plugin manager view wiring (glue)", () => {
  const viewSrc = readFileSync(
    fileURLToPath(
      new URL(
        "../../../vscode-extension/src/ui/plugin-manager-view.js",
        import.meta.url,
      ),
    ),
    "utf-8",
  );

  it("wires the Quality section to the pure module and the two CLI calls", () => {
    expect(viewSrc).toContain('require("../plugin-quality.js")');
    expect(viewSrc).toContain("buildPluginValidateArgs");
    expect(viewSrc).toContain("buildCodeIntelStatusArgs");
    expect(viewSrc).toContain("renderQualityHtml");
    expect(viewSrc).toContain("<h2>Quality</h2>");
    expect(viewSrc).toContain("qualityHtml");
  });

  it("keeps the existing sections untouched", () => {
    for (const section of ["Runtime plugins", "MCP servers", "renderSkills"]) {
      expect(viewSrc).toContain(section);
    }
  });
});
