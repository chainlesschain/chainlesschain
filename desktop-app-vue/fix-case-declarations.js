const fs = require('fs');

// Files to fix
const files = [
  'src/main/ai-engine/extended-tools-2.js',
  'src/main/ai-engine/extended-tools-3.js',
  'src/main/ai-engine/extended-tools-4.js',
  'src/main/ai-engine/extended-tools-5.js',
  'src/main/ai-engine/extended-tools-project.js',
  'src/main/ai-engine/extended-tools.js',
  'src/main/blockchain/event-listener.js',
  'src/main/browser/advanced/iframe-scanner.js',
  'src/main/browser/browser-automation-agent.js',
  'src/main/browser/browser-engine.js',
  'src/main/engines/document-engine.js',
  'src/main/engines/template-engine.js',
  'src/main/memory/memory-hierarchy.js',
  'src/main/organization/organization-manager.js',
  'src/main/project/automation-manager.js',
  'src/main/remote/logging/statistics-collector.js',
  'src/main/skill-tool-system/additional-tools-v3-handler.js',
  'src/main/speech/audio-processor.js',
  'src/main/sync/group-chat-sync-manager.js',
  'src/main/trade/contract-engine.js',
  'src/main/utils/file-integrity.js',
  'src/renderer/components/browser/workflow/WorkflowEditor.vue',
  'src/renderer/components/editors/ExcelEditor.vue',
  'src/renderer/components/projects/ConversationSearchPanel.vue',
  'src/renderer/pages/rss/ArticleReader.vue'
];

function fixCaseDeclarations(content) {
  const lines = content.split('\n');
  const result = [];
  let i = 0;
  let fixCount = 0;

  while (i < lines.length) {
    const line = lines[i];

    // Check if this is a case statement
    const caseMatch = line.match(/^(\s*)(case\s+[^:]+:|default:)\s*$/);

    if (caseMatch) {
      const indent = caseMatch[1];
      const caseStmt = caseMatch[2];

      // Look ahead to see if next non-empty line has const/let
      let j = i + 1;
      while (j < lines.length && lines[j].trim() === '') {
        j++;
      }

      // Check if the next code line starts with const/let/var
      if (j < lines.length) {
        const nextLine = lines[j];
        const declMatch = nextLine.match(/^\s*(const|let|var)\s/);

        if (declMatch) {
          // Find the end of this case block (break, return, throw, or next case)
          let endIndex = j;
          let braceDepth = 0;

          while (endIndex < lines.length) {
            const checkLine = lines[endIndex];

            // Track brace depth
            braceDepth += (checkLine.match(/{/g) || []).length;
            braceDepth -= (checkLine.match(/}/g) || []).length;

            // Check for case end (break, return, throw at right indent, or next case/default)
            if (braceDepth === 0) {
              if (checkLine.match(/^\s*break\s*;?\s*$/) ||
                  checkLine.match(/^\s*return\s/) ||
                  checkLine.match(/^\s*throw\s/)) {
                break;
              }
              // Check for next case at same or lower indent level
              if (endIndex > j) {
                const nextCaseMatch = checkLine.match(/^(\s*)(case\s|default:)/);
                if (nextCaseMatch && nextCaseMatch[1].length <= indent.length) {
                  endIndex--;
                  break;
                }
              }
            }
            endIndex++;
          }

          // Check if already has braces (next line after case is '{')
          let hasOpenBrace = false;
          for (let k = i + 1; k < lines.length; k++) {
            const trimmed = lines[k].trim();
            if (trimmed === '') continue;
            if (trimmed === '{') hasOpenBrace = true;
            break;
          }

          if (!hasOpenBrace && endIndex >= j) {
            // Add opening brace after case statement
            result.push(line);
            result.push(indent + '  {');

            // Add body lines with extra indent
            for (let k = i + 1; k <= endIndex; k++) {
              const bodyLine = lines[k];
              if (bodyLine.trim() === '') {
                result.push(bodyLine);
              } else {
                result.push('  ' + bodyLine);
              }
            }

            // Add closing brace
            result.push(indent + '  }');

            i = endIndex + 1;
            fixCount++;
            continue;
          }
        }
      }
    }

    result.push(line);
    i++;
  }

  return { content: result.join('\n'), fixCount };
}

// Process each file
let totalFixes = 0;

files.forEach(file => {
  try {
    const content = fs.readFileSync(file, 'utf8');
    const { content: fixed, fixCount } = fixCaseDeclarations(content);

    if (fixCount > 0) {
      fs.writeFileSync(file, fixed, 'utf8');
      console.log(`${file}: Fixed ${fixCount} case blocks`);
      totalFixes += fixCount;
    } else {
      console.log(`${file}: No fixes needed`);
    }
  } catch (e) {
    console.log(`${file}: Error - ${e.message}`);
  }
});

console.log(`\nTotal fixes: ${totalFixes}`);
