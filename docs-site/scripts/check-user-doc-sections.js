import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const userDocsDirectory = path.resolve(
  scriptDirectory,
  "../docs/chainlesschain",
);

const requiredSections = [
  { name: "概述", matches: (heading) => heading === "概述" },
  { name: "核心特性", matches: (heading) => heading === "核心特性" },
  { name: "系统架构", matches: (heading) => heading === "系统架构" },
  { name: "配置参考", matches: (heading) => heading === "配置参考" },
  { name: "性能指标", matches: (heading) => heading === "性能指标" },
  {
    name: "测试覆盖",
    matches: (heading) => heading === "测试覆盖" || heading === "测试覆盖率",
  },
  { name: "安全考虑", matches: (heading) => heading === "安全考虑" },
  {
    name: "故障排查",
    matches: (heading) => heading === "故障排查" || heading === "故障排除",
  },
  { name: "关键文件", matches: (heading) => heading === "关键文件" },
  { name: "使用示例", matches: (heading) => heading.includes("使用示例") },
  { name: "相关文档", matches: (heading) => heading === "相关文档" },
];

function collectLevelTwoSections(markdown) {
  const lines = markdown.split(/\r?\n/u);
  const headings = [];
  let fenceMarker = null;

  for (let index = 0; index < lines.length; index += 1) {
    const fenceMatch = lines[index].match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (fenceMarker === null) {
        fenceMarker = marker;
      } else if (fenceMarker === marker) {
        fenceMarker = null;
      }
      continue;
    }

    if (fenceMarker !== null) {
      continue;
    }

    const match = lines[index].match(/^##\s+(.+?)\s*$/u);
    if (match) {
      headings.push({ heading: match[1], start: index + 1 });
    }
  }

  return headings.map((item, index) => {
    const nextHeading = headings[index + 1];
    return {
      heading: item.heading,
      content: lines
        .slice(item.start, nextHeading ? nextHeading.start - 1 : lines.length)
        .join("\n")
        .trim(),
    };
  });
}

const entries = await readdir(userDocsDirectory, { withFileTypes: true });
const markdownFiles = entries
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
  .map((entry) => entry.name)
  .sort((left, right) => left.localeCompare(right, "zh-CN"));

const failures = [];

for (const filename of markdownFiles) {
  const markdown = await readFile(
    path.join(userDocsDirectory, filename),
    "utf8",
  );
  const sections = collectLevelTwoSections(markdown);

  for (const requirement of requiredSections) {
    const matchedSections = sections.filter((section) =>
      requirement.matches(section.heading),
    );

    if (matchedSections.length === 0) {
      failures.push(`${filename}: 缺少“${requirement.name}”二级章节`);
    } else if (
      matchedSections.every((section) => section.content.length === 0)
    ) {
      failures.push(`${filename}: “${requirement.name}”章节没有内容`);
    }
  }
}

if (failures.length > 0) {
  console.error(
    `用户文档结构检查失败：${markdownFiles.length} 个文件中发现 ${failures.length} 个问题。`,
  );
  for (const failure of failures) {
    console.error(`- ${failure}`);
  }
  process.exitCode = 1;
} else {
  console.log(
    `用户文档结构检查通过：${markdownFiles.length} 个文件均包含 ${requiredSections.length} 个必需模块。`,
  );
}
