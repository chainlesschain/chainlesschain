/**
 * Doctor checkup — layered, fixable environment diagnosis.
 *
 * Extends the base `cc doctor` report (runtime/diagnostics.js) with the
 * setup-checkup layers Claude Code's `/doctor` grew: config load chain,
 * provider auth, MCP config, IDE bridge, plugin signature coverage, duplicate
 * subagents, transcript tamper, background-agent hygiene, and git worktree
 * cleanup. Every check degrades gracefully (a broken subsystem becomes an
 * `err` check, never a thrown doctor) and SAFE fixes are applied only via the
 * explicit `--fix` flag; anything needing judgement emits a copyable command
 * instead.
 *
 * Report shape (JSON-serializable):
 *   sections: [{ id, title, checks: [{ id, name, level, detail, fix? }] }]
 *   fix: { id, safe, description, command? } — `safe:true` ids are the ONLY
 *   ones runCheckupFixes will execute.
 */

import {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
} from "node:fs";
import { execSync, spawnSync } from "node:child_process";
import { join, basename } from "node:path";
import { getHomeDir, getConfigPath } from "./paths.js";
import {
  checkAgenda,
  checkInstructionFiles,
  checkHookConfig,
  checkHooks,
  checkSandbox,
  checkDuplicateSkills,
  DEFAULT_CHECKUP_THRESHOLDS,
} from "./runtime-checkup.js";

export const CHECK_LEVELS = Object.freeze({
  OK: "ok",
  WARN: "warn",
  ERR: "err",
  INFO: "info",
});

const FREE_PROVIDERS = ["ollama", "local", "llamacpp", "mediapipe"];
const STALE_JOB_MS = 24 * 60 * 60 * 1000;

export const _deps = {
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  rmSync,
  execSync,
  spawnSync,
  now: () => Date.now(),
};

function check(id, name, level, detail = "", fix = null) {
  const c = { id, name, level, detail };
  if (fix) c.fix = fix;
  return c;
}

function failedCheck(id, name, err) {
  return check(id, name, CHECK_LEVELS.ERR, `check failed: ${err.message}`);
}

// ── config load chain ──────────────────────────────────────────────────────
async function configSection(opts, deps) {
  const checks = [];
  const configPath = getConfigPath();

  try {
    if (!deps.existsSync(configPath)) {
      checks.push(
        check(
          "config-json",
          "config.json",
          CHECK_LEVELS.WARN,
          `not created yet — run "cc setup"`,
        ),
      );
    } else {
      try {
        JSON.parse(deps.readFileSync(configPath, "utf-8"));
        checks.push(check("config-json", "config.json", CHECK_LEVELS.OK, ""));
      } catch (err) {
        checks.push(
          check(
            "config-json",
            "config.json",
            CHECK_LEVELS.ERR,
            `invalid JSON (${err.message}) — cc auto-backs it up as .corrupted and falls back to defaults`,
            {
              id: "config-invalid",
              safe: false,
              description: "Review / repair the config by hand",
              command: `notepad "${configPath}"`,
            },
          ),
        );
      }
    }

    if (deps.existsSync(`${configPath}.corrupted`)) {
      checks.push(
        check(
          "config-corrupted-backup",
          "config.json.corrupted backup",
          CHECK_LEVELS.INFO,
          "a previously corrupted config was backed up — review then delete it",
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("config-json", "config.json", err));
  }

  // settings.json layers (permission rules / hooks) — every existing layer
  // must at least parse; a broken layer silently drops its rules otherwise.
  try {
    const { settingsPaths } = await import("./settings-loader.cjs").then(
      (m) => m.default || m,
    );
    const layers = settingsPaths(opts.cwd || process.cwd()) || [];
    let bad = 0;
    for (const file of layers) {
      if (!deps.existsSync(file)) continue;
      try {
        JSON.parse(deps.readFileSync(file, "utf-8"));
      } catch {
        bad++;
        checks.push(
          check(
            "settings-json",
            `settings layer ${basename(file)}`,
            CHECK_LEVELS.ERR,
            `invalid JSON — its permission rules and hooks are being IGNORED (${file})`,
          ),
        );
      }
    }
    if (bad === 0) {
      checks.push(
        check(
          "settings-json",
          "settings.json layers",
          CHECK_LEVELS.OK,
          "all present layers parse",
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("settings-json", "settings.json layers", err));
  }

  return { id: "config", title: "Config load chain", checks };
}

// ── provider auth ──────────────────────────────────────────────────────────
async function providerSection(_opts, _deps2) {
  const checks = [];
  try {
    const { loadConfig } = await import("./config-manager.js");
    let config = {};
    try {
      config = loadConfig();
    } catch {
      config = {};
    }
    const llm = config.llm || {};
    if (!llm.provider) {
      checks.push(
        check(
          "provider",
          "LLM provider",
          CHECK_LEVELS.WARN,
          `not configured — run "cc setup" or "cc config"`,
        ),
      );
    } else if (FREE_PROVIDERS.includes(String(llm.provider).toLowerCase())) {
      checks.push(
        check(
          "provider",
          `LLM provider: ${llm.provider}`,
          CHECK_LEVELS.OK,
          "local provider — no API key required",
        ),
      );
    } else if (llm.apiKey) {
      checks.push(
        check(
          "provider",
          `LLM provider: ${llm.provider}`,
          CHECK_LEVELS.OK,
          "API key configured",
        ),
      );
    } else {
      checks.push(
        check(
          "provider",
          `LLM provider: ${llm.provider}`,
          CHECK_LEVELS.WARN,
          "no API key in config — relies on the provider env var being set at runtime",
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("provider", "LLM provider", err));
  }
  return { id: "provider", title: "Provider auth", checks };
}

// ── MCP config ─────────────────────────────────────────────────────────────
async function mcpSection(opts, deps) {
  const checks = [];
  const cwd = opts.cwd || process.cwd();
  const mcpJson = join(cwd, ".mcp.json");
  try {
    if (deps.existsSync(mcpJson)) {
      try {
        const parsed = JSON.parse(deps.readFileSync(mcpJson, "utf-8"));
        const count = Object.keys(
          parsed.mcpServers || parsed.servers || {},
        ).length;
        checks.push(
          check(
            "mcp-json",
            ".mcp.json",
            CHECK_LEVELS.OK,
            `${count} server(s) declared`,
          ),
        );
      } catch (err) {
        checks.push(
          check(
            "mcp-json",
            ".mcp.json",
            CHECK_LEVELS.ERR,
            `invalid JSON — declared MCP servers are being IGNORED (${err.message})`,
          ),
        );
      }
    } else {
      checks.push(
        check(
          "mcp-json",
          ".mcp.json",
          CHECK_LEVELS.INFO,
          "none in this project (optional)",
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("mcp-json", ".mcp.json", err));
  }
  return { id: "mcp", title: "MCP servers", checks };
}

// ── IDE bridge ─────────────────────────────────────────────────────────────
async function ideSection(opts, _deps2) {
  const checks = [];
  try {
    const { diagnoseIde, readIdeLocks } = await import("./ide-bridge.js");
    const locks = readIdeLocks() || [];
    const diag = diagnoseIde({ cwd: opts.cwd || process.cwd() });
    const level = locks.length > 0 ? CHECK_LEVELS.OK : CHECK_LEVELS.INFO;
    checks.push(
      check(
        "ide-bridge",
        "IDE bridge",
        level,
        typeof diag === "string"
          ? diag
          : diag?.reason || `${locks.length} lockfile(s)`,
      ),
    );
  } catch (err) {
    checks.push(failedCheck("ide-bridge", "IDE bridge", err));
  }
  return { id: "ide", title: "IDE bridge", checks };
}

// ── plugin signature coverage ──────────────────────────────────────────────
async function pluginSection(opts, _deps2) {
  const checks = [];
  try {
    const { listInstalled } = await import("./plugin-runtime/install.js");
    const { readPluginLock } = await import("./plugin-runtime/signature.js");
    const plugins = listInstalled({ cwd: opts.cwd || process.cwd() }) || [];
    if (plugins.length === 0) {
      checks.push(
        check(
          "plugins",
          "Installed plugins",
          CHECK_LEVELS.INFO,
          "none installed",
        ),
      );
    } else {
      let unsigned = 0;
      for (const p of plugins) {
        try {
          const lock = p.dir ? readPluginLock(p.dir) : null;
          if (!lock || !lock.signature) unsigned++;
        } catch {
          unsigned++;
        }
      }
      checks.push(
        check(
          "plugins",
          `Installed plugins: ${plugins.length}`,
          unsigned > 0 ? CHECK_LEVELS.WARN : CHECK_LEVELS.OK,
          unsigned > 0
            ? `${unsigned} without a signature lock — they will be refused if plugins.requireSignedPlugins is enabled`
            : "all have signature locks",
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("plugins", "Installed plugins", err));
  }

  // Broken manifests + un-consented capabilities (Phase 3 capability gap).
  // Distinct from the signature-lock check above: re-discover to get each
  // plugin's parsed manifest (listInstalled drops it) so we can flag an invalid
  // manifest and any DECLARED capability set the user has not consented to.
  try {
    const { discoverPlugins } = await import("./plugin-runtime/scopes.js");
    const { isPluginCapabilityConsented } =
      await import("./plugin-runtime/capability-consent.js");
    const { checkPluginsAndLsp } = await import("./runtime-checkup.js");
    const discovered =
      discoverPlugins({ cwd: opts.cwd || process.cwd(), skipPolicy: true }) ||
      [];
    // Broken manifests → warn (shared runtime-checkup evaluator).
    for (const f of checkPluginsAndLsp(
      discovered.map((p) => ({
        id: p.name,
        healthy: p.manifest?.ok !== false,
        kind: "plugin",
      })),
    )) {
      checks.push(
        check(
          f.id,
          `plugin ${f.ref}`,
          CHECK_LEVELS.WARN,
          `${f.message} — ${f.remediation}`,
        ),
      );
    }
    // Declared capabilities not yet consented → warn.
    for (const p of discovered) {
      if (!p.manifest?.capabilitiesDeclared) continue;
      const consented = isPluginCapabilityConsented(
        { name: p.name, scope: p.scope, version: p.version },
        p.manifest.capabilities,
      );
      if (!consented) {
        checks.push(
          check(
            "plugin-capability-unconsented",
            `plugin ${p.name}`,
            CHECK_LEVELS.WARN,
            `declares capabilities not yet consented — run \`cc plugin consent ${p.name}\``,
          ),
        );
      }
    }
  } catch (err) {
    checks.push(failedCheck("plugin-capabilities", "plugin capabilities", err));
  }

  return { id: "plugins", title: "Plugin trust", checks };
}

// ── duplicate subagents ────────────────────────────────────────────────────
async function subagentSection(opts, deps) {
  const checks = [];
  try {
    const { agentDirs } = await import("./agents.js");
    const cwd = opts.cwd || process.cwd();
    const seen = new Map(); // name → [scopes]
    for (const { dir, scope } of agentDirs(cwd)) {
      if (!deps.existsSync(dir)) continue;
      for (const f of deps.readdirSync(dir)) {
        if (!f.endsWith(".md")) continue;
        const name = basename(f, ".md");
        const scopes = seen.get(name) || [];
        scopes.push(scope);
        seen.set(name, scopes);
      }
    }
    const dupes = [...seen.entries()].filter(([, scopes]) => scopes.length > 1);
    if (dupes.length > 0) {
      checks.push(
        check(
          "subagents-duplicate",
          "Duplicate subagents",
          CHECK_LEVELS.WARN,
          dupes
            .map(([name, scopes]) => `${name} (${scopes.join(" + ")})`)
            .join(", ") + " — the project copy shadows the personal one",
        ),
      );
    } else {
      checks.push(
        check(
          "subagents-duplicate",
          "Subagents",
          CHECK_LEVELS.OK,
          `${seen.size} defined, no cross-scope duplicates`,
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("subagents-duplicate", "Subagents", err));
  }
  return { id: "subagents", title: "Subagents", checks };
}

// ── transcript tamper ──────────────────────────────────────────────────────
async function transcriptSection(_opts, _deps2) {
  const checks = [];
  try {
    const { verifyAllSessions } =
      await import("../harness/jsonl-session-store.js");
    const results = verifyAllSessions({ limit: 200 });
    const tampered = results.filter((r) => r.status === "tampered");
    if (tampered.length > 0) {
      checks.push(
        check(
          "transcript-tamper",
          "Transcript integrity",
          CHECK_LEVELS.ERR,
          `${tampered.length} tampered transcript(s): ${tampered
            .slice(0, 5)
            .map((t) => t.sessionId)
            .join(", ")}${tampered.length > 5 ? ", …" : ""}`,
          {
            id: "transcript-tamper",
            safe: false,
            description: "Inspect the flagged transcripts",
            command: `cc session verify ${tampered[0].sessionId}`,
          },
        ),
      );
    } else {
      checks.push(
        check(
          "transcript-tamper",
          "Transcript integrity",
          CHECK_LEVELS.OK,
          `${results.length} session(s) checked, no tamper`,
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("transcript-tamper", "Transcript integrity", err));
  }
  return { id: "transcripts", title: "Session transcripts", checks };
}

// ── background-agent hygiene ───────────────────────────────────────────────
async function backgroundSection(_opts, deps) {
  const checks = [];
  try {
    const { backgroundAgentsDir, listBackgroundAgents } =
      await import("./background-agent-supervisor.js");

    const agents = listBackgroundAgents({ all: true }) || [];
    const lost = agents.filter((a) => a.status === "lost");
    if (lost.length > 0) {
      checks.push(
        check(
          "bg-lost",
          "Background agents",
          CHECK_LEVELS.WARN,
          `${lost.length} lost session(s) (worker died without finalizing) — "cc daemon status --all" to review`,
        ),
      );
    } else {
      checks.push(
        check(
          "bg-lost",
          "Background agents",
          CHECK_LEVELS.OK,
          `${agents.length} tracked, none lost`,
        ),
      );
    }

    // Orphan job handoff files: the worker deletes its .job.<pid>.json on
    // start, so any file older than a day belongs to a launch that never ran.
    const dir = backgroundAgentsDir();
    const staleJobs = [];
    if (deps.existsSync(dir)) {
      for (const f of deps.readdirSync(dir)) {
        if (!f.includes(".job.")) continue;
        try {
          const st = deps.statSync(join(dir, f));
          if (deps.now() - st.mtimeMs > STALE_JOB_MS) staleJobs.push(f);
        } catch {
          // raced with the worker deleting it — fine
        }
      }
    }
    if (staleJobs.length > 0) {
      checks.push(
        check(
          "bg-stale-jobs",
          "Stale job files",
          CHECK_LEVELS.WARN,
          `${staleJobs.length} orphan .job files >24h old in ${dir}`,
          {
            id: "prune-stale-jobs",
            safe: true,
            description: `delete ${staleJobs.length} orphan background-agent job file(s)`,
          },
        ),
      );
    } else {
      checks.push(
        check("bg-stale-jobs", "Stale job files", CHECK_LEVELS.OK, "none"),
      );
    }
  } catch (err) {
    checks.push(failedCheck("bg-lost", "Background agents", err));
  }
  return { id: "background", title: "Background agents", checks };
}

// ── git worktree cleanup ───────────────────────────────────────────────────
async function worktreeSection(opts, deps) {
  const checks = [];
  const cwd = opts.cwd || process.cwd();
  try {
    const inRepo = (() => {
      try {
        deps.execSync("git rev-parse --is-inside-work-tree", {
          cwd,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        return true;
      } catch {
        return false;
      }
    })();
    if (!inRepo) {
      checks.push(
        check(
          "worktree-prune",
          "Git worktrees",
          CHECK_LEVELS.INFO,
          "not a git repository",
        ),
      );
    } else {
      const out =
        deps.execSync("git worktree prune --dry-run -v", {
          cwd,
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        }) || "";
      const prunable = out.split("\n").filter((l) => l.trim()).length;
      if (prunable > 0) {
        checks.push(
          check(
            "worktree-prune",
            "Git worktrees",
            CHECK_LEVELS.WARN,
            `${prunable} stale worktree entr${prunable === 1 ? "y" : "ies"} (deleted on disk, still registered)`,
            {
              id: "git-worktree-prune",
              safe: true,
              description:
                "git worktree prune (removes stale admin entries only)",
              command: "git worktree prune",
            },
          ),
        );
      } else {
        checks.push(
          check(
            "worktree-prune",
            "Git worktrees",
            CHECK_LEVELS.OK,
            "no stale entries",
          ),
        );
      }
    }
  } catch (err) {
    checks.push(failedCheck("worktree-prune", "Git worktrees", err));
  }
  return { id: "worktrees", title: "Git worktrees", checks };
}

// ── runtime checkup: agenda expiry + verbose instruction files ──────────────
// Only the gaps the OTHER sections don't already cover. Stale sessions,
// worktrees, orphan processes and lost background agents are handled by
// transcriptSection / worktreeSection / backgroundSection — surfacing them here
// too would double-report, so this section deliberately covers just the agenda
// schedule store and the instruction files (cc.md / AGENTS.md / CLAUDE.md).
const SEVERITY_TO_LEVEL = {
  error: CHECK_LEVELS.ERR,
  warn: CHECK_LEVELS.WARN,
  info: CHECK_LEVELS.INFO,
};

async function runtimeSection(opts, deps) {
  const checks = [];
  const now = deps.now();

  // Agenda schedule store — overdue/never-fired wakeups, retirable leftovers.
  try {
    const { AgentScheduleStore } = await import("./agent-schedule-store.js");
    const store = new AgentScheduleStore();
    const entries = store.list().map((e) => ({
      id: e.id,
      dueAt: e.kind === "wakeup" ? e.dueAt : e.nextAt,
      recurring: e.kind !== "wakeup",
    }));
    for (const f of checkAgenda(entries, now, DEFAULT_CHECKUP_THRESHOLDS)) {
      checks.push(
        check(
          f.id,
          `agenda ${f.ref}`,
          SEVERITY_TO_LEVEL[f.severity] || CHECK_LEVELS.INFO,
          `${f.message} — ${f.remediation}`,
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("agenda", "agenda schedule store", err));
  }

  // Instruction files — flag verbose ones (byte size only; a derivability
  // heuristic would need code analysis and isn't computed here).
  try {
    const cwd = opts.cwd || process.cwd();
    const files = [];
    for (const name of ["cc.md", "AGENTS.md", "CLAUDE.md"]) {
      const p = join(cwd, name);
      if (deps.existsSync(p)) {
        try {
          files.push({ path: name, bytes: deps.statSync(p).size });
        } catch {
          // raced/unreadable — skip
        }
      }
    }
    for (const f of checkInstructionFiles(files, DEFAULT_CHECKUP_THRESHOLDS)) {
      checks.push(
        check(
          f.id,
          f.ref,
          SEVERITY_TO_LEVEL[f.severity] || CHECK_LEVELS.INFO,
          `${f.message} — ${f.remediation}`,
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("instructions", "instruction files", err));
  }

  // settings.json hook config — statically catch hooks that will silently never
  // fire (unknown event / bad regex matcher / missing command) or are
  // misconfigured (bad timeout). Runtime hook health (slow/circuit-broken) needs
  // live per-process stats and isn't computed here.
  try {
    const settingsHooks = await import("./settings-hooks.cjs");
    const mod = settingsHooks.default || settingsHooks;
    const cwd = opts.cwd || process.cwd();
    const files = mod.settingsFiles(cwd);
    const seen = new Set();
    for (const file of files) {
      if (seen.has(file) || !deps.existsSync(file)) continue;
      seen.add(file);
      let hooksBlock = null;
      try {
        const parsed = JSON.parse(deps.readFileSync(file, "utf-8"));
        hooksBlock = parsed && typeof parsed === "object" ? parsed.hooks : null;
      } catch {
        continue; // malformed settings.json is reported elsewhere (config section)
      }
      if (!hooksBlock) continue;
      for (const f of checkHookConfig(hooksBlock, {
        validEvents: mod.HOOK_EVENTS,
      })) {
        checks.push(
          check(
            f.id,
            `${basename(file)} ${f.ref}`,
            SEVERITY_TO_LEVEL[f.severity] || CHECK_LEVELS.INFO,
            `${f.message} — ${f.remediation}`,
          ),
        );
      }
    }
  } catch (err) {
    checks.push(failedCheck("hook-config", "settings hook config", err));
  }

  // Async-hook RUNTIME health — the reliability aggregate persisted by
  // AsyncHookSupervisor.stopAll(): hooks that have been repeatedly failing,
  // circuit-broken (N failures in a row), or slow on average. Complements the
  // static config check above (which catches hooks that never fire at all).
  try {
    const store = await import("./hook-stats-store.cjs");
    const mod = store.default || store;
    const statsFs = {
      existsSync: deps.existsSync,
      readFileSync: deps.readFileSync,
    };
    const stats = mod.loadHookStats(mod.defaultHookStatsPath(), statsFs);
    const hooks = mod.toCheckHooksInput(stats, {
      circuitThreshold: DEFAULT_CHECKUP_THRESHOLDS.hookFailureThreshold,
    });
    for (const f of checkHooks(hooks, DEFAULT_CHECKUP_THRESHOLDS)) {
      checks.push(
        check(
          f.id,
          `hook ${f.ref}`,
          SEVERITY_TO_LEVEL[f.severity] || CHECK_LEVELS.INFO,
          `${f.message} — ${f.remediation}`,
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("hook-health", "async hook stats", err));
  }

  // Sandbox real capability — catch the "silent degradation" case where a
  // sandbox is configured in settings.json but its engine (docker/bwrap) isn't
  // actually runnable, so tool subprocesses run UNSANDBOXED without warning.
  try {
    const settingsHooks = await import("./settings-hooks.cjs");
    const shMod = settingsHooks.default || settingsHooks;
    const sandboxMod = await import("./agent-sandbox.js");
    const cwd = opts.cwd || process.cwd();
    let sandboxSettings = null;
    for (const file of shMod.settingsFiles(cwd)) {
      if (!deps.existsSync(file)) continue;
      try {
        const parsed = JSON.parse(deps.readFileSync(file, "utf-8"));
        if (parsed && parsed.sandbox && typeof parsed.sandbox === "object") {
          sandboxSettings = { ...(sandboxSettings || {}), ...parsed.sandbox };
        }
      } catch {
        // malformed settings.json is reported by the config section
      }
    }
    if (sandboxSettings && sandboxSettings.enabled === true) {
      const sandbox = sandboxMod.normalizeAgentSandbox(true, {
        settings: sandboxSettings,
        cwd,
      });
      if (sandbox) {
        const probe = sandboxMod.probeSandboxAvailability(sandbox, {
          spawnSync: deps.spawnSync,
        });
        for (const f of checkSandbox({
          configured: true,
          engine: sandbox.engine,
          available: probe.available,
          reason: probe.reason,
          failIfUnavailable: sandbox.policy?.failIfUnavailable === true,
          isolationLevel: sandboxMod.isolationLevel(sandbox),
        })) {
          checks.push(
            check(
              f.id,
              `sandbox ${f.ref}`,
              SEVERITY_TO_LEVEL[f.severity] || CHECK_LEVELS.INFO,
              f.remediation ? `${f.message} — ${f.remediation}` : f.message,
            ),
          );
        }
      }
    }
  } catch (err) {
    checks.push(failedCheck("sandbox", "sandbox availability", err));
  }

  // Duplicate skills — an id defined in more than one layer silently shadows
  // (loadAll keeps only the winner), so a user's custom skill can override, or
  // be overridden by, another without any signal. opts.skillLayerEntries lets a
  // caller inject the (un-deduped) entry list; otherwise scan via the loader.
  try {
    let entries = opts.skillLayerEntries;
    if (!entries) {
      const { CLISkillLoader } = await import("./skill-loader.js");
      entries = new CLISkillLoader().listSkillLayerEntries();
    }
    for (const f of checkDuplicateSkills(entries)) {
      checks.push(
        check(
          f.id,
          `skill ${f.ref}`,
          SEVERITY_TO_LEVEL[f.severity] || CHECK_LEVELS.INFO,
          `${f.message} — ${f.remediation}`,
        ),
      );
    }
  } catch (err) {
    checks.push(failedCheck("skill-duplicate", "skill layers", err));
  }

  if (checks.length === 0) {
    checks.push(check("runtime-clean", "runtime hygiene", CHECK_LEVELS.OK, ""));
  }
  return { id: "runtime", title: "Runtime checkup", checks };
}

/**
 * Collect all checkup sections. Never throws — a failing subsystem becomes an
 * `err` check inside its section.
 */
export async function collectCheckupSections(opts = {}) {
  const deps = { ..._deps, ...(opts.deps || {}) };
  const sections = [];
  for (const build of [
    configSection,
    providerSection,
    mcpSection,
    ideSection,
    pluginSection,
    subagentSection,
    transcriptSection,
    backgroundSection,
    worktreeSection,
    runtimeSection,
  ]) {
    try {
      sections.push(await build(opts, deps));
    } catch (err) {
      sections.push({
        id: build.name.replace(/Section$/, ""),
        title: build.name,
        checks: [failedCheck(build.name, build.name, err)],
      });
    }
  }
  return sections;
}

/**
 * Apply the SAFE fixes present in a checkup report. Anything with
 * `fix.safe === false` is skipped (its copyable `command` is the remedy).
 * Returns [{ id, applied, detail }].
 */
export async function runCheckupFixes(sections, opts = {}) {
  const deps = { ..._deps, ...(opts.deps || {}) };
  const results = [];
  const fixes = [];
  for (const section of sections || []) {
    for (const c of section.checks || []) {
      if (c.fix && c.fix.safe) fixes.push(c.fix);
    }
  }

  for (const fix of fixes) {
    try {
      if (fix.id === "prune-stale-jobs") {
        const { backgroundAgentsDir } =
          await import("./background-agent-supervisor.js");
        const dir = backgroundAgentsDir();
        let removed = 0;
        for (const f of deps.readdirSync(dir)) {
          if (!f.includes(".job.")) continue;
          try {
            const st = deps.statSync(join(dir, f));
            if (deps.now() - st.mtimeMs > STALE_JOB_MS) {
              deps.rmSync(join(dir, f), { force: true });
              removed++;
            }
          } catch {
            // raced — fine
          }
        }
        results.push({
          id: fix.id,
          applied: true,
          detail: `removed ${removed} file(s)`,
        });
      } else if (fix.id === "git-worktree-prune") {
        deps.execSync("git worktree prune", {
          cwd: opts.cwd || process.cwd(),
          encoding: "utf-8",
          stdio: ["ignore", "pipe", "ignore"],
        });
        results.push({
          id: fix.id,
          applied: true,
          detail: "pruned stale worktree entries",
        });
      } else {
        results.push({
          id: fix.id,
          applied: false,
          detail: "no safe fixer registered",
        });
      }
    } catch (err) {
      results.push({ id: fix.id, applied: false, detail: err.message });
    }
  }
  return results;
}

/** Copyable commands for problems that need the user's judgement. */
export function unsafeFixCommands(sections) {
  const commands = [];
  for (const section of sections || []) {
    for (const c of section.checks || []) {
      if (c.fix && !c.fix.safe && c.fix.command) {
        commands.push({
          description: c.fix.description,
          command: c.fix.command,
        });
      }
    }
  }
  return commands;
}
