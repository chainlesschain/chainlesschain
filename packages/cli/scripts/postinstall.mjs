#!/usr/bin/env node
// Runs after `npm install`. Best-effort only — must never fail the install.
// Cross-platform: no shell redirects, no `|| true`.

// 1) Pre-generate the CLI skill packs (best-effort).
try {
  const { generateCliPacks } = await import(
    "../src/lib/skill-packs/generator.js"
  );
  await generateCliPacks({ force: false });
} catch {
  // Intentionally silent: skill pack generation is best-effort during install.
  // Users can re-run it via `npm run sync-skill-packs` or `cc skill sync-cli`.
}

// 2) Friendly note on the SQLite engine. Native (better-sqlite3*) is an OPTIONAL
//    dependency: its prebuilt binary download (GitHub) can be blocked, or a
//    C/C++ toolchain may be absent, in which case npm skips it and the CLI runs
//    on the bundled sql.js (WASM) — no compilation, works on every OS. Print
//    which engine is active so a skipped native build never looks "broken".
try {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const loads = (m) => {
    try {
      require(m);
      return true;
    } catch {
      return false;
    }
  };
  const native =
    loads("better-sqlite3-multiple-ciphers") || loads("better-sqlite3");
  if (!native) {
    process.stderr.write(
      "\n[chainlesschain] SQLite 引擎：内置 sql.js (WASM) —— 无需编译，跨平台开箱即用。\n" +
        "  原生加速为可选：装好 C/C++ 构建工具后重装即可启用，或为受限网络配置二进制镜像。\n\n",
    );
  }
} catch {
  // Silent: the engine note is purely informational.
}

process.exit(0);
