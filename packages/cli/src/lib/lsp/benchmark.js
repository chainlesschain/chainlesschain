/**
 * LSP code-intelligence latency benchmark.
 *
 * Measures the two numbers the Phase 2 acceptance criteria call for on real
 * repos: **startup latency** (cold spawn + project index + first answer) and
 * **per-query latency** (warm def / refs / hover / diagnostics / symbols), plus
 * best-effort server-process RSS. Pure timing/stat helpers are separated out so
 * they are unit-testable without spawning anything.
 *
 * Deliberately drives the SAME `CodeIntelligence` the agent tool uses, so the
 * numbers reflect real agent-path latency, not a synthetic micro-path.
 */

import { CodeIntelligence } from "./code-intelligence.js";
import executionBroker from "../process-execution-broker/index.js";

/** now() in fractional milliseconds — injectable for deterministic tests. */
export const _deps = {
  now: () => Number(process.hrtime.bigint() / 1000n) / 1000,
  sampleRss: sampleRssDefault,
  execFileSync: (...args) => executionBroker.execFileSync(...args),
};

/** p-th percentile (0..100) of an UNSORTED sample via linear interpolation. */
export function percentile(samples, p) {
  if (!samples.length) return null;
  const sorted = [...samples].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const rank = (p / 100) * (sorted.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
}

/** Summary stats for a latency sample (all in ms), rounded to 0.1ms. */
export function summarize(samples) {
  if (!samples.length) return { n: 0 };
  const round = (x) => (x == null ? null : Math.round(x * 10) / 10);
  const sum = samples.reduce((a, b) => a + b, 0);
  return {
    n: samples.length,
    min: round(Math.min(...samples)),
    median: round(percentile(samples, 50)),
    p95: round(percentile(samples, 95)),
    max: round(Math.max(...samples)),
    mean: round(sum / samples.length),
  };
}

/**
 * Run the benchmark. Returns a structured report; never throws for the
 * "no server installed" case (returns { available:false, reason }).
 *
 * @param {object} opts
 * @param {string} opts.projectRoot
 * @param {string} opts.file          a real source file in the project
 * @param {number} [opts.runs=20]     timed iterations per operation
 * @param {number} [opts.warmup=2]    untimed warmup iterations per operation
 * @param {(msg:string)=>void} [opts.onProgress]
 */
export async function runLatencyBenchmark(opts) {
  const {
    projectRoot,
    file,
    runs = 20,
    warmup = 2,
    onProgress = () => {},
  } = opts;
  const ci = new CodeIntelligence({ projectRoot, coldStart: true });
  const report = {
    file,
    runs,
    available: true,
    coldStartMs: null,
    probe: null,
    ops: {},
    server: null,
  };
  try {
    // --- cold start: first query pays spawn + project index ---
    onProgress("cold start (spawn + index + first query)…");
    const t0 = _deps.now();
    const first = await ci.documentSymbols(file);
    report.coldStartMs = round1(_deps.now() - t0);
    if (!first.available) {
      return { available: false, reason: first.reason };
    }

    // --- choose a probe position from a real symbol (so def/refs have a target) ---
    const probe = pickProbe(first.symbols);
    report.probe = probe;

    // best-effort server memory now that it's warm
    report.server = await captureServerInfo(ci);

    // --- timed operations (warm) ---
    const ops = [
      { name: "document_symbols", run: () => ci.documentSymbols(file) },
      {
        name: "definition",
        run: () => ci.definition(file, probe.line, probe.col),
        needsProbe: true,
      },
      {
        name: "references",
        run: () => ci.references(file, probe.line, probe.col),
        needsProbe: true,
      },
      {
        name: "hover",
        run: () => ci.hover(file, probe.line, probe.col),
        needsProbe: true,
      },
      {
        name: "diagnostics",
        run: () => ci.diagnostics(file, { timeoutMs: 4000 }),
      },
    ];

    for (const op of ops) {
      if (op.needsProbe && !probe) {
        report.ops[op.name] = { skipped: "no probe symbol" };
        continue;
      }
      onProgress(`${op.name} …`);
      for (let i = 0; i < warmup; i++) await op.run();
      const samples = [];
      for (let i = 0; i < runs; i++) {
        const s = _deps.now();
        await op.run();
        samples.push(_deps.now() - s);
      }
      report.ops[op.name] = summarize(samples);
    }
    return report;
  } finally {
    await ci.dispose();
  }
}

function pickProbe(symbols) {
  if (!Array.isArray(symbols) || !symbols.length) return null;
  // Prefer a function/method/class — those have meaningful def/refs.
  const preferred = symbols.find((s) =>
    ["function", "method", "class"].includes(s.kind),
  );
  const s = preferred || symbols[0];
  return { line: s.line, col: s.col, name: s.name, kind: s.kind };
}

async function captureServerInfo(ci) {
  try {
    const servers = ci.manager.listServers();
    if (!servers.length) return null;
    const s = servers[0];
    const rssMb = s.pid != null ? await _deps.sampleRss(s.pid) : null;
    return { serverId: s.serverId, pid: s.pid, rssMb };
  } catch {
    return null;
  }
}

/**
 * Best-effort resident-set-size (MB) of the server, summed over the pid AND its
 * descendants. This matters on Windows: a `.cmd` server is launched through
 * `cmd.exe /c`, so the tracked pid is the launcher and the real language server
 * (node/tsserver) is a child — measuring only the launcher reports a few MB and
 * lies. We sum the whole subtree. Returns null if it can't be read (never throws
 * — memory is a bonus metric, not load-bearing).
 */
export async function sampleRssDefault(
  pid,
  { execFileSync = _deps.execFileSync, platform = process.platform } = {},
) {
  try {
    if (platform === "win32") {
      // One snapshot of every process → parent map → sum the subtree at `pid`.
      const csv = execFileSync(
        "wmic",
        [
          "process",
          "get",
          "ProcessId,ParentProcessId,WorkingSetSize",
          "/format:csv",
        ],
        {
          encoding: "utf8",
          windowsHide: true,
          maxBuffer: 16 * 1024 * 1024,
          origin: "lsp:benchmark-rss",
          policy: "allow",
          scope: "lsp",
          shell: false,
        },
      );
      const bytes = sumSubtreeRssFromWmicCsv(csv, pid);
      return bytes != null ? Math.round(bytes / (1024 * 1024)) : null;
    }
    // POSIX: not wrapped, so the pid is the real server. Sum pid + children.
    const out = execFileSync("ps", ["-o", "pid=,ppid=,rss="], {
      encoding: "utf8",
      origin: "lsp:benchmark-rss",
      policy: "allow",
      scope: "lsp",
      shell: false,
    });
    const rows = out
      .trim()
      .split(/\r?\n/)
      .map((l) => l.trim().split(/\s+/).map(Number));
    const kb = sumSubtreeRss(
      rows.map(([p, pp, rss]) => ({ pid: p, ppid: pp, val: rss })),
      pid,
    );
    return kb != null ? Math.round(kb / 1024) : null;
  } catch {
    return null;
  }
}

/** Parse `wmic ... /format:csv` output and sum WorkingSetSize over pid's subtree (bytes). */
export function sumSubtreeRssFromWmicCsv(csv, rootPid) {
  const lines = csv
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  const header = lines.find((l) => /ProcessId/i.test(l));
  if (!header) return null;
  const cols = header.split(",");
  const iPid = cols.findIndex((c) => /^ProcessId$/i.test(c));
  const iPpid = cols.findIndex((c) => /^ParentProcessId$/i.test(c));
  const iRss = cols.findIndex((c) => /^WorkingSetSize$/i.test(c));
  if (iPid < 0 || iPpid < 0 || iRss < 0) return null;
  const rows = [];
  for (const l of lines) {
    if (l === header || /ProcessId/i.test(l)) continue;
    const f = l.split(",");
    const pid = Number(f[iPid]);
    const ppid = Number(f[iPpid]);
    const val = Number(f[iRss]);
    if (Number.isFinite(pid))
      rows.push({ pid, ppid, val: Number.isFinite(val) ? val : 0 });
  }
  return sumSubtreeRss(rows, rootPid);
}

/** Sum `val` over `rootPid` and all its transitive descendants. */
export function sumSubtreeRss(rows, rootPid) {
  const childrenOf = new Map();
  const valOf = new Map();
  for (const r of rows) {
    valOf.set(r.pid, r.val);
    if (!childrenOf.has(r.ppid)) childrenOf.set(r.ppid, []);
    childrenOf.get(r.ppid).push(r.pid);
  }
  if (!valOf.has(rootPid)) return null;
  let total = 0;
  const seen = new Set();
  const stack = [rootPid];
  while (stack.length) {
    const p = stack.pop();
    if (seen.has(p)) continue;
    seen.add(p);
    total += valOf.get(p) || 0;
    for (const c of childrenOf.get(p) || []) stack.push(c);
  }
  return total;
}

function round1(x) {
  return Math.round(x * 10) / 10;
}
