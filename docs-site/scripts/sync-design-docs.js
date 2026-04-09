/**
 * 同步设计文档到 VitePress docs/design/ 目录
 * 从 docs/design/ (项目根) 复制所有 .md 文件
 * - 中文文件名转为 ASCII（与 config.js sidebar 链接一致）
 * - 转义裸 <tag> 占位符，避免 Vue 模板解析错误
 * - 重写内部链接（中文路径 → ASCII 路径）
 * - index.md 和 .vitepress/ 不会被覆盖
 */
import {
  readFileSync,
  writeFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
} from "fs";
import { join, dirname, resolve } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(__dirname, "..");
const sourceDir = resolve(projectRoot, "..", "docs", "design");
const targetDir = resolve(projectRoot, "docs", "design");

// 不覆盖的文件/目录
const EXCLUDE = new Set(["index.md", ".vitepress"]);

// ── 中文文件名 → ASCII 映射（与 config.js sidebar 链接一致）──────
// 根目录文件
const ROOT_FILE_MAP = {
  "系统设计_主文档.md": "system-design-main.md",
  "系统设计_个人移动AI管理系统.md": "system-design-full.md",
  "安全机制设计.md": "security-design.md",
  "数据同步方案.md": "data-sync.md",
  "AI模型部署方案.md": "ai-model-deploy.md",
  "实施总结与附录.md": "implementation-summary.md",
  // 英文文件保持原名
  "HOOKS_SYSTEM_DESIGN.md": "HOOKS_SYSTEM_DESIGN.md",
  "BROWSER_EXTENSION_PLAN.md": "BROWSER_EXTENSION_PLAN.md",
  "README.md": "README.md",
};

// modules/ 文件：01-xxx 格式（无 m 前缀，与 config.js sidebar 一致）
const MODULE_FILE_MAP = {
  "01_知识库管理模块.md": "01-knowledge-base.md",
  "02_去中心化社交模块.md": "02-decentralized-social.md",
  "03_交易辅助模块.md": "03-trading.md",
  "04_项目管理模块.md": "04-project-management.md",
  "05_企业版组织模块.md": "05-enterprise-org.md",
  "06_AI优化系统.md": "06-ai-optimization.md",
  "07_性能优化系统.md": "07-performance.md",
  "08_MCP与配置系统.md": "08-mcp-config.md",
  "09_浏览器自动化系统.md": "09-browser-automation.md",
  "10_远程控制系统.md": "10-remote-control.md",
  "11_企业审计系统.md": "11-audit.md",
  "12_插件市场系统.md": "12-plugin-marketplace.md",
  "13_多代理系统.md": "13-multi-agent.md",
  "14_SSO企业认证.md": "14-sso.md",
  "15_MCP_SDK系统.md": "15-mcp-sdk.md",
  "16_AI技能系统.md": "16-ai-skills.md",
  "17_EvoMap系统.md": "17-evomap.md",
  "17_IPFS去中心化存储.md": "17b-ipfs.md",
  "18_P2P实时协作系统.md": "18-p2p-collab.md",
  "18_社交AI系统.md": "18b-social-ai.md",
  "19_合规分类系统.md": "19-compliance.md",
  "19_自治Agent_Runner.md": "19b-agent-runner.md",
  "20_企业用户配置系统.md": "20-scim.md",
  "20_模型量化系统.md": "20b-quantization.md",
  "21_i18n国际化.md": "21-i18n.md",
  "21_统一密钥系统.md": "21b-unified-key.md",
  "22_性能自动调优.md": "22-auto-tuning.md",
  "22_智能内容推荐系统.md": "22b-content-rec.md",
  "23_Nostr桥接系统.md": "23-nostr.md",
  "23_企业组织管理.md": "23b-org-management.md",
  "24_去中心化Agent网络.md": "24-agent-network.md",
  "24_数据防泄漏系统.md": "24b-dlp.md",
  "25_安全信息事件管理系统.md": "25-siem.md",
  "25_自治运维系统.md": "25b-autonomous-ops.md",
  "26_开发流水线编排.md": "26-pipeline.md",
  "26_社区治理系统.md": "26b-governance.md",
  "27_Matrix集成系统.md": "27-matrix.md",
  "27_多模态协作.md": "27b-multimodal.md",
  "28_基础设施编排系统.md": "28-infrastructure.md",
  "28_自然语言编程.md": "28b-nl-programming.md",
  "29_生产强化系统.md": "29-production-hardening.md",
  "30_联邦强化系统.md": "30-federation-hardening.md",
  "31_压力测试系统.md": "31-stress-test.md",
  "32_信誉优化系统.md": "32-reputation.md",
  "33_跨组织SLA管理系统.md": "33-sla.md",
  "34_技术学习引擎系统.md": "34-tech-learning.md",
  "35_自主开发者系统.md": "35-autonomous-dev.md",
  "36_协作治理系统.md": "36-collab-governance.md",
  "37_技能市场系统.md": "37-skill-marketplace.md",
  "38_去中心化推理网络系统.md": "38-inference-network.md",
  "39_信任安全系统.md": "39-trust-security.md",
  "40_协议融合系统.md": "40-protocol-fusion.md",
  "41_去中心化基础设施系统.md": "41-decentralized-infra.md",
  "42_EvoMap高级联邦系统.md": "42-evomap-federation.md",
  "43_IPC域分割与懒加载系统.md": "43-ipc-split.md",
  "44_共享资源层与依赖注入容器.md": "44-di-container.md",
  "45_数据库演进与迁移框架.md": "45-db-migration.md",
  "46_A2A协议引擎.md": "46-a2a-protocol.md",
  "47_自主工作流编排器.md": "47-workflow.md",
  "48_层次化记忆系统2.0.md": "48-hierarchical-memory.md",
  "49_多模态感知层.md": "49-multimodal-perception.md",
  "50_Agent经济系统.md": "50-agent-economy.md",
  "51_代码生成Agent2.0.md": "51-code-agent.md",
  "52_Agent安全沙箱2.0.md": "52-sandbox.md",
  "53_零知识证明引擎.md": "53-zkp.md",
  "54_跨链互操作协议.md": "54-cross-chain.md",
  "55_去中心化身份2.0.md": "55-did-v2.md",
  "56_隐私计算框架.md": "56-privacy-computing.md",
  "57_DAO治理2.0.md": "57-dao-governance.md",
  "58_低代码平台.md": "58-low-code.md",
  "59_企业知识图谱.md": "59-knowledge-graph.md",
  "60_BI智能分析.md": "60-bi-engine.md",
  "60_CLI指令技能包系统.md": "60b-cli-skill-packs.md",
  "61_工作流自动化引擎.md": "61-workflow-automation.md",
  "62_多租户SaaS引擎.md": "62-saas.md",
  "63_统一应用运行时.md": "63-unified-runtime.md",
  "64_智能插件生态2.0.md": "64-plugin-ecosystem.md",
  "65_自进化AI系统.md": "65-self-evolving-ai.md",
  "66_CLI分发系统.md": "66-cli-distribution.md",
  "67_CLI高级功能补齐.md": "67-cli-advanced.md",
  "68_CLI-Anything集成.md": "68-cli-anything.md",
  "69_WebSocket服务器接口.md": "69-websocket-server.md",
  "70_Agent智能增强系统.md": "70-agent-intelligence.md",
  "71_子代理隔离系统.md": "71-sub-agent-isolation.md",
  "71_AI音视频创作模板.md": "71b-ai-media-creator.md",
  "72_AI文档创作模板.md": "72-ai-doc-creator.md",
  "73_Web管理界面.md": "73-web-ui.md",
  "74_AI编排层系统.md": "74-orchestration-layer.md",
  "75_Web管理面板.md": "75-web-panel.md",
  "76_技能创建系统.md": "76-skill-creator.md",
  "77_Agent架构优化系统.md": "77-agent-optimization.md",
  "78_CLI_Agent_Runtime重构实施计划.md": "78-cli-agent-runtime.md",
  "79_Coding_Agent系统.md": "79-coding-agent.md",
  "80_规范工作流系统.md": "80-canonical-workflow.md",
  "83_工具描述规范统一.md": "83-tool-descriptor-unification.md",
};

// 构建反向映射（用于 rewriteInternalLinks）
const ALL_ROOT_NAMES = new Set(Object.values(ROOT_FILE_MAP));
const ALL_MODULE_NAMES = new Set(Object.values(MODULE_FILE_MAP));

/**
 * 获取目标文件名（中文 → ASCII）
 */
function getTargetFilename(filename, isModule) {
  const map = isModule ? MODULE_FILE_MAP : ROOT_FILE_MAP;
  if (map[filename]) return map[filename];

  // 未映射的文件：若已是 ASCII 则保留，否则生成占位名
  if (/^[\x20-\x7e]+$/.test(filename)) return filename;

  const numMatch = filename.match(/^(\d+)/);
  const prefix = numMatch ? numMatch[1] : "unknown";
  const ext = filename.endsWith(".md") ? ".md" : "";
  console.warn(`  ⚠ 未映射文件: ${filename} → ${prefix}-unmapped${ext}`);
  return `${prefix}-unmapped${ext}`;
}

/**
 * 转义 markdown 中不在代码块/行内代码中的裸 <tag> 占位符
 */
function escapeVueTags(content) {
  const lines = content.split("\n");
  let inCodeBlock = false;
  const result = [];

  for (const line of lines) {
    if (line.trimStart().startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      result.push(line);
      continue;
    }

    if (inCodeBlock) {
      result.push(line);
      continue;
    }

    const htmlTags = new Set([
      "div", "span", "p", "a", "br", "hr", "img",
      "table", "tr", "td", "th", "thead", "tbody",
      "ul", "ol", "li",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "pre", "code", "em", "strong", "b", "i", "u", "s", "sub", "sup",
      "details", "summary", "blockquote",
      "figure", "figcaption", "section", "article",
      "header", "footer", "nav", "main", "aside",
      "input", "button", "form", "label", "select", "option", "textarea",
      "style", "script", "link", "meta",
    ]);

    let escapedLine = line.replace(
      /(?<!`)(<([a-zA-Z][a-zA-Z0-9_-]*)>)(?!`)/g,
      (match, full, tag) => {
        if (htmlTags.has(tag.toLowerCase())) return match;
        return "`" + full + "`";
      },
    );

    escapedLine = escapedLine.replace(
      /(?<!`)(<\/([a-zA-Z][a-zA-Z0-9_-]*)>)(?!`)/g,
      (match, full, tag) => {
        if (htmlTags.has(tag.toLowerCase())) return match;
        return "`" + full + "`";
      },
    );

    result.push(escapedLine);
  }

  return result.join("\n");
}

/**
 * 替换 markdown 内容中的内部链接（中文路径 → ASCII 路径）
 */
function rewriteInternalLinks(content) {
  return content.replace(
    /\]\((modules\/)?([^)]+\.md)\)/g,
    (match, prefix, filename) => {
      const isModule = !!prefix;
      const mapped = isModule
        ? MODULE_FILE_MAP[filename]
        : ROOT_FILE_MAP[filename];
      if (mapped) {
        return `](${prefix || ""}${mapped})`;
      }
      return match;
    },
  );
}

function syncDir(src, dest, isRoot = false, isModuleDir = false) {
  if (!existsSync(src)) {
    console.error(`源目录不存在: ${src}`);
    process.exit(1);
  }

  if (!existsSync(dest)) {
    mkdirSync(dest, { recursive: true });
  }

  const entries = readdirSync(src);
  let count = 0;

  for (const entry of entries) {
    if (isRoot && EXCLUDE.has(entry)) continue;

    const srcPath = join(src, entry);
    const stat = statSync(srcPath);

    if (stat.isDirectory()) {
      const isModule = entry === "modules";
      const destSubdir = join(dest, entry);
      count += syncDir(srcPath, destSubdir, false, isModule);
    } else if (entry.endsWith(".md")) {
      const targetName = getTargetFilename(entry, isModuleDir);
      const destPath = join(dest, targetName);

      if (!existsSync(dirname(destPath))) {
        mkdirSync(dirname(destPath), { recursive: true });
      }

      let content = readFileSync(srcPath, "utf-8");
      content = escapeVueTags(content);
      content = rewriteInternalLinks(content);
      writeFileSync(destPath, content, "utf-8");
      if (entry !== targetName) {
        console.log(`  ${entry} → ${targetName}`);
      }
      count++;
    }
  }

  return count;
}

console.log(`同步设计文档: ${sourceDir} → ${targetDir}`);
console.log("文件名映射: 中文 → ASCII (与 config.js sidebar 一致)\n");
const fileCount = syncDir(sourceDir, targetDir, true);
console.log(`\n完成: 同步了 ${fileCount} 个文件`);
