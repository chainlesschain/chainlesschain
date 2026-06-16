# Node API compatibility check (the `verifyPlugin` analog for the CLI)

The JetBrains plugin uses `./gradlew verifyPlugin` to catch internal /
scheduled-for-removal / deprecated platform-API usage against newer IDE builds.
The npm-CLI equivalent is **`eslint-plugin-n`** — it flags Node built-in APIs that
are **deprecated** or **not available / experimental** in the declared
`engines.node` range (this package: `>=22.12.0`).

## Run it (on demand — no repo deps added)

```bash
mkdir -p /tmp/ncheck && cd /tmp/ncheck
echo '{"name":"ncheck","private":true}' > package.json
npm install --silent eslint@8.57.1 eslint-plugin-n@17
cat > .eslintrc.json <<'JSON'
{ "root": true,
  "parserOptions": { "ecmaVersion": "latest", "sourceType": "module" },
  "plugins": ["n"],
  "rules": {
    "n/no-deprecated-api": "error",
    "n/no-unsupported-features/node-builtins": ["error", { "version": ">=22.12.0" }]
  } }
JSON
CLI="C:/code/chainlesschain/packages/cli"   # use forward-slash/Windows path; eslint won't match /c/... globs
npx eslint --no-eslintrc -c ./.eslintrc.json --resolve-plugins-relative-to . \
  --ignore-pattern 'assets/**' \
  "$CLI/src/**/*.js" "$CLI/bin/**/*.js"
```

- Keep `version` in sync with `package.json` `engines.node`.
- **Always `--ignore-pattern 'assets/**'`** — `src/assets/**` is the bundled,
  minified web-panel build output, not source (it produces false positives like
  `yBuffer(`).

## Last run — 2026-06-16 (clean)

Found + fixed 2:
- `src/lib/downloader.js` — `stream.Readable.fromWeb` (experimental on 22.12) →
  rewrote the download stream as an **async generator** fed to `pipeline` (stable;
  same progress tracking + backpressure).
- `src/commands/init.js` — legacy `url.parse()` (×2) → **`new URL()`** (WHATWG;
  `path` = `pathname + search`), dropped the `require("url")`.

Verdict after fixes: **0 deprecated / 0 unsupported / 0 experimental** Node-builtin
API usages in `src/` + `bin/` (excluding bundled assets).
