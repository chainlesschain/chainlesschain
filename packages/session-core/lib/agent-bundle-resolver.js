/**
 * Agent Bundle Resolver — Phase 1
 *
 * 将 canonical bundle 对象应用到运行时依赖:
 *   - USER.md 作为 user-memory seed,写入 MemoryStore.SCOPE.USER
 *     (Phase 2 已引入 user scope; 若 store 不支持则降级 global).
 *   - AGENTS.md 作为 system prompt 片段.
 *   - mcp.json 返回供消费方注入 MCP adapter.
 *   - approval/sandbox policy 原样透传.
 *
 * 设计原则:
 *   - 纯函数式,不改动传入对象
 *   - 不直接 import 消费方(cli/desktop),只接受 adapter 依赖注入
 *   - 所有操作幂等,重复调用不会重复 seed
 */

const DEFAULT_SEED_TAG = "bundle-seed";

function buildSystemPrompt(bundle) {
  if (!bundle || !bundle.agentsMd) return null;
  return String(bundle.agentsMd).trim();
}

/**
 * 按段落切分 USER.md,每段作为一条 memory.
 * 约定:
 *   - 一级标题 (# heading) 下方的段落归到该 category
 *   - 无标题段落归到 "profile"
 */
function parseUserMdSeed(userMd) {
  if (!userMd || typeof userMd !== "string") return [];
  const lines = userMd.split(/\r?\n/);
  const entries = [];
  let category = "profile";
  let buffer = [];

  const flush = () => {
    const text = buffer.join("\n").trim();
    if (text) {
      entries.push({ category, content: text });
    }
    buffer = [];
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+?)\s*$/);
    if (h1) {
      flush();
      category = h1[1].toLowerCase().replace(/\s+/g, "-");
      continue;
    }
    buffer.push(line);
  }
  flush();
  return entries;
}

/**
 * applyUserMemorySeed(memoryStore, bundle, options)
 *
 * 幂等:通过 tag "bundle-seed" + bundle id 去重.
 * 当前 MemoryStore 只支持 session/agent/global — Phase 2 之前降级写入 global.
 *
 * @returns {{ seeded: number, skipped: number }}
 */
function applyUserMemorySeed(memoryStore, bundle, options = {}) {
  if (!memoryStore || typeof memoryStore.add !== "function") {
    return { seeded: 0, skipped: 0 };
  }
  const entries = parseUserMdSeed(bundle && bundle.userMd);
  if (entries.length === 0) return { seeded: 0, skipped: 0 };

  const bundleId = (bundle.manifest && bundle.manifest.id) || "unknown";
  const seedTag = options.seedTag || DEFAULT_SEED_TAG;
  const bundleTag = `bundle:${bundleId}`;

  // 幂等检查:相同 bundle 已 seed 过则跳过
  if (typeof memoryStore.recall === "function") {
    try {
      const existing = memoryStore.recall({
        tags: [seedTag, bundleTag],
        limit: 1,
      });
      if (Array.isArray(existing) && existing.length > 0) {
        return { seeded: 0, skipped: entries.length };
      }
    } catch {
      // recall 失败不阻塞 seed
    }
  }

  // Phase 2: 优先写 user scope; 若消费方未提供 userId 则降级 global.
  const userId = options.userId || options.scopeId || null;
  const targetScope = options.scope || (userId ? "user" : "global");
  const scopeId = targetScope === "global" ? null : userId;
  const userTag = "user-seed";

  let seeded = 0;
  for (const entry of entries) {
    try {
      memoryStore.add({
        scope: targetScope,
        scopeId,
        category: entry.category,
        content: entry.content,
        tags: [seedTag, bundleTag, userTag, entry.category],
      });
      seeded += 1;
    } catch {
      // 若 user scope 不可用,兜底写 global
      try {
        memoryStore.add({
          scope: "global",
          scopeId: null,
          category: entry.category,
          content: entry.content,
          tags: [
            seedTag,
            bundleTag,
            userTag,
            entry.category,
            "downgraded-from-user",
          ],
        });
        seeded += 1;
      } catch {
        // 忽略单条失败
      }
    }
  }

  return { seeded, skipped: 0 };
}

/**
 * resolveBundle(bundle, deps)
 *
 * 返回一个便于消费方直接使用的"运行时视图".
 * 不会真正 mount MCP server — 由消费方(CLI runtime / desktop AI engine)处理.
 *
 * @param {object} bundle canonical bundle(来自 loader)
 * @param {object} deps
 * @param {object} [deps.memoryStore] 可选 MemoryStore 实例
 * @param {object} [deps.seedOptions] applyUserMemorySeed 的 options
 * @returns {{
 *   manifest: object,
 *   systemPrompt: string|null,
 *   mcpConfig: object|null,
 *   approvalPolicy: object|null,
 *   sandboxPolicy: object|null,
 *   capabilities: object|null,
 *   skillsDir: string|null,
 *   seedResult: { seeded: number, skipped: number }|null,
 *   warnings: string[]
 * }}
 */
function resolveBundle(bundle, deps = {}) {
  if (!bundle || typeof bundle !== "object") {
    throw new Error("resolveBundle: bundle is required");
  }

  const seedResult = deps.memoryStore
    ? applyUserMemorySeed(deps.memoryStore, bundle, deps.seedOptions || {})
    : null;

  return {
    manifest: bundle.manifest,
    systemPrompt: buildSystemPrompt(bundle),
    mcpConfig: bundle.mcpConfig,
    approvalPolicy: bundle.approvalPolicy,
    sandboxPolicy: bundle.sandboxPolicy,
    capabilities: bundle.capabilities,
    skillsDir: bundle.skillsDir,
    seedResult,
    warnings: Array.isArray(bundle.warnings) ? [...bundle.warnings] : [],
  };
}

module.exports = {
  resolveBundle,
  applyUserMemorySeed,
  parseUserMdSeed,
  buildSystemPrompt,
  DEFAULT_SEED_TAG,
};
