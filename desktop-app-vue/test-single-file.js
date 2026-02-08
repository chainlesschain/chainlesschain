const fs = require("fs");
const path = require("path");

const filePath = "src/main/ai-engine/ai-engine-ipc.js";

let content = fs.readFileSync(filePath, "utf-8");
const originalContent = content;

console.log("Before replacement:");
console.log(content.substring(0, 200));

// Pattern 2: Remove createLogger from destructured imports (with other imports)
content = content.replace(
  /const\s+\{([^}]*),\s*createLogger\s*\}\s*=/g,
  "const {$1} =",
);
content = content.replace(
  /const\s+\{\s*createLogger\s*,([^}]*)\}\s*=/g,
  "const {$1} =",
);

console.log("\nAfter replacement:");
console.log(content.substring(0, 200));

if (content !== originalContent) {
  console.log("\n✓ Content changed, writing file...");
  fs.writeFileSync(filePath, content, "utf-8");
} else {
  console.log("\n✗ No changes detected");
}
