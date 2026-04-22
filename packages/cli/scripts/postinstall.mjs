#!/usr/bin/env node
// Runs after `npm install` to pre-generate the CLI skill packs.
// Must never fail the install — swallow all errors and exit 0.
// Cross-platform: no shell redirects, no `|| true`.

try {
  const { generateCliPacks } = await import("../src/lib/skill-packs/generator.js");
  await generateCliPacks({ force: false });
} catch {
  // Intentionally silent: skill pack generation is best-effort during install.
  // Users can re-run it via `npm run sync-skill-packs` or `cc skill sync-cli`.
}

process.exit(0);
