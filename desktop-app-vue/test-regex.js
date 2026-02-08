const testLine =
  "const { logger, createLogger } = require('../utils/logger.js');";

let content = testLine;
console.log("Original:", content);

// Pattern 2: Remove createLogger from destructured imports (with other imports)
content = content.replace(
  /const\s+\{([^}]*),\s*createLogger\s*\}\s*=/g,
  "const {$1} =",
);
console.log("After pattern 2:", content);

content = testLine;
content = content.replace(
  /const\s+\{\s*createLogger\s*,([^}]*)\}\s*=/g,
  "const {$1} =",
);
console.log("After pattern 3:", content);
