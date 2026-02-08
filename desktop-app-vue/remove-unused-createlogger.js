const fs = require("fs");
const path = require("path");

// Read the file list
const fileListPath = path.join(__dirname, "all_createlogger_files.txt");
const fileList = fs
  .readFileSync(fileListPath, "utf-8")
  .split("\n")
  .filter((line) => line.trim() && line.includes("desktop-app-vue"))
  .map((line) => line.trim());

console.log(`Processing ${fileList.length} files...`);

let processedCount = 0;
let removedCount = 0;

fileList.forEach((filePath) => {
  try {
    if (!fs.existsSync(filePath)) {
      console.log(`File not found: ${filePath}`);
      return;
    }

    let content = fs.readFileSync(filePath, "utf-8");
    const originalContent = content;

    // Pattern 1: const { createLogger } = require('...')
    // Remove entire line if createLogger is the only import
    content = content.replace(
      /^const\s+\{\s*createLogger\s*\}\s*=\s*require\([^)]+\);?\s*$/gm,
      "",
    );

    // Pattern 2: Remove createLogger from destructured imports (with other imports)
    content = content.replace(
      /const\s+\{([^}]*),\s*createLogger\s*\}\s*=/g,
      (match, p1) => {
        return `const { ${p1.trim()} } =`;
      },
    );
    content = content.replace(
      /const\s+\{\s*createLogger\s*,([^}]*)\}\s*=/g,
      (match, p1) => {
        return `const { ${p1.trim()} } =`;
      },
    );

    // Pattern 3: import { createLogger } from '...'
    // Remove entire line if createLogger is the only import
    content = content.replace(
      /^import\s+\{\s*createLogger\s*\}\s+from\s+['"][^'"]+['"];?\s*$/gm,
      "",
    );

    // Pattern 4: Remove createLogger from ES6 imports (with other imports)
    content = content.replace(
      /import\s+\{([^}]*),\s*createLogger\s*\}\s+from/g,
      (match, p1) => {
        return `import { ${p1.trim()} } from`;
      },
    );
    content = content.replace(
      /import\s+\{\s*createLogger\s*,([^}]*)\}\s+from/g,
      (match, p1) => {
        return `import { ${p1.trim()} } from`;
      },
    );

    // Clean up any double empty lines
    content = content.replace(/\n\n\n+/g, "\n\n");

    if (content !== originalContent) {
      fs.writeFileSync(filePath, content, "utf-8");
      removedCount++;
      console.log(`✓ Removed createLogger from: ${path.basename(filePath)}`);
    }

    processedCount++;
  } catch (error) {
    console.error(`Error processing ${filePath}:`, error.message);
  }
});

console.log(
  `\nDone! Processed ${processedCount} files, removed createLogger from ${removedCount} files.`,
);
