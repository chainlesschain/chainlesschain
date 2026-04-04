---
paths:
  - "**/*.js"
  - "**/*.ts"
  - "**/*.vue"
---

# Chinese Encoding (中文乱码) Prevention

Windows defaults to CP936/GBK codepage. All code must explicitly use UTF-8.

## Entry Points (DO NOT remove)

- **CLI**: `packages/cli/bin/chainlesschain.js` imports `ensure-utf8.js` → runs `chcp 65001`
- **Desktop**: `desktop-app-vue/src/main/index.js` runs `chcp 65001` inline
- **Utility**: `packages/cli/src/lib/ensure-utf8.js`

## Child Processes

```javascript
// ✅ Always specify encoding
execSync("some-command", { encoding: "utf-8" });

// ✅ For cmd.exe spawn, prepend chcp 65001
spawn("cmd.exe", ["/c", "chcp 65001 >nul && " + script], { ... });

// ✅ Explicitly decode as utf8
child.stdout.on("data", (data) => data.toString("utf8"));

// ❌ WRONG — uses system default (GBK)
child.stdout.on("data", (data) => data.toString());

// ❌ WRONG — returns Buffer
execSync("some-command");
```

## File I/O

```javascript
// ✅ Always specify utf-8
fs.readFileSync(path, "utf-8");
fs.writeFileSync(path, content, "utf-8");

// ❌ Returns Buffer, not string
fs.readFileSync(path);
```

## HTML Output

Always include `<meta charset="UTF-8">` in generated HTML files.
