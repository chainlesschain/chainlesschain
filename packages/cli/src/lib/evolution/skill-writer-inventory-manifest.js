/**
 * Canonical inventory of production entrypoints that can create, replace,
 * remove, import, activate, or otherwise mutate Skill bytes/state.
 *
 * This is deliberately data-only. Runtime timestamps and probe results do not
 * belong here because they would make the canonical inventory digest drift.
 */

export const SKILL_WRITER_INVENTORY_SCHEMA =
  "chainlesschain.skill-writer-inventory/v1";

export const SKILL_WRITER_TRIGGER_CLASSES = Object.freeze([
  "automatic",
  "manual",
  "build-time",
]);

export const SKILL_WRITER_TARGET_AUTHORITIES = Object.freeze([
  "candidate-only",
  "legacy-active",
]);

export const SKILL_WRITER_SURFACES = Object.freeze([
  "android",
  "cli",
  "desktop",
]);

const writer = (value) =>
  Object.freeze({
    ...value,
    entrypoint: Object.freeze({
      ...value.entrypoint,
      evidence: Object.freeze([...(value.entrypoint.evidence || [])]),
    }),
    mutation: Object.freeze({
      ...value.mutation,
      evidence: Object.freeze([...(value.mutation.evidence || [])]),
    }),
  });

const scopeExclusion = (value) =>
  Object.freeze({
    ...value,
    evidence: Object.freeze({
      ...value.evidence,
      evidence: Object.freeze([...(value.evidence.evidence || [])]),
    }),
  });

/**
 * `discoverySymbol` is the function/IPC/tool symbol emitted by the independent
 * static scanner. `null` means that the writer is indirect (tree install,
 * active-pointer mutation, or a generic path capability) and is therefore
 * retained as an explicit authority-risk entry even though no literal
 * `SKILL.md` write occurs in that function.
 */
export const SKILL_WRITER_INVENTORY = Object.freeze({
  schema: SKILL_WRITER_INVENTORY_SCHEMA,
  schemaVersion: 1,
  surfaces: SKILL_WRITER_SURFACES,
  sourceRoots: Object.freeze([
    "packages/cli/src",
    "desktop-app-vue/src/main",
    "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills",
  ]),
  scannerScope: Object.freeze({
    classification: "direct-source-sink-subset",
    unit: "function-or-ipc",
    sourceExtensions: Object.freeze([".cjs", ".js", ".kt", ".mjs", ".ts"]),
    skillBindings: Object.freeze([
      "nearby-skill-md-literal",
      "package-files-constant",
    ]),
    mutationSinks: Object.freeze([
      "appendFile",
      "appendFileSync",
      "copyFile",
      "copyFileSync",
      "delete",
      "hotLoadSkill",
      "register",
      "rename",
      "renameSync",
      "rm",
      "rmSync",
      "unlink",
      "unlinkSync",
      "writeFile",
      "writeFileSync",
      "writeSafePackageComponent",
      "writeText",
    ]),
  }),
  limitations: Object.freeze([
    "dynamic-or-remote-skill-filenames-require-explicit-inventory-evidence",
    "custom-wrappers-not-listed-as-sinks-require-explicit-inventory-evidence",
    "external-process-side-effects-are-not-derived-by-direct-source-scan",
    "interprocedural-call-graph-and-runtime-reflection-are-out-of-scope",
    "direct-unknown-zero-is-not-a-whole-program-semantic-proof",
  ]),
  writers: Object.freeze([
    writer({
      id: "cli-agent-file-mutation-tools",
      surface: "cli",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "generic-path-capability",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/runtime/agent-core.js",
        symbol: "executeTool",
        evidence: [
          "export async function executeTool",
          'case "write_file"',
          'case "edit_file"',
          'case "delete_file"',
          'case "move_file"',
        ],
      },
      mutation: {
        file: "packages/cli/src/runtime/agent-core.js",
        symbol: "executeTool",
        evidence: [
          "writeFileVerified(filePath, args.content)",
          "fs.unlinkSync(filePath)",
          "fs.renameSync(filePath, targetPath)",
        ],
      },
    }),
    writer({
      id: "cli-agent-shell-mutation-tool",
      surface: "cli",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "generic-process-path-capability",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/runtime/agent-core.js",
        symbol: "executeToolInner:run_shell",
        evidence: ['case "run_shell"', "evaluateShellCommandPolicy("],
      },
      mutation: {
        file: "packages/cli/src/runtime/agent-core.js",
        symbol: "executeToolInner:run_shell",
        evidence: [
          "broker.spawn(args.command, [], brokerOpts)",
          "broker.execSync(args.command, brokerExecOpts)",
        ],
      },
    }),
    writer({
      id: "cli-agent-code-mutation-tool",
      surface: "cli",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "generic-process-path-capability",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/runtime/agent-core.js",
        symbol: "executeToolInner:run_code",
        evidence: ['case "run_code"', "await _executeRunCode(args, cwd)"],
      },
      mutation: {
        file: "packages/cli/src/runtime/agent-core.js",
        symbol: "_executeRunCode",
        evidence: [
          "async function _executeRunCode(args, cwd)",
          "output = runCodeProcess(interpreter, [scriptPath]",
        ],
      },
    }),
    writer({
      id: "cli-skill-add",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-bytes",
      discoverySymbol: "createControlledSkillScaffold",
      entrypoint: {
        file: "packages/cli/src/commands/skill.js",
        symbol: "registerSkillCommand:add",
        evidence: [
          '.command("add")',
          "createControlledSkillScaffold(name, targetDir)",
        ],
      },
      mutation: {
        file: "packages/cli/src/commands/skill.js",
        symbol: "createControlledSkillScaffold",
        evidence: [
          "export function createControlledSkillScaffold",
          'path.join(targetDir, "SKILL.md")',
          "io.writeFileSync(",
        ],
      },
    }),
    writer({
      id: "cli-skill-remove",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-removal",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/commands/skill.js",
        symbol: "registerSkillCommand:remove",
        evidence: ['.command("remove")', '.option("--force"'],
      },
      mutation: {
        file: "packages/cli/src/commands/skill.js",
        symbol: "registerSkillCommand:remove",
        evidence: ["fs.rmSync(targetDir, { recursive: true, force: true })"],
      },
    }),
    writer({
      id: "cli-init-workspace-skills",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-bytes",
      discoverySymbol: "registerInitCommand",
      entrypoint: {
        file: "packages/cli/src/commands/init.js",
        symbol: "registerInitCommand",
        evidence: ["export function registerInitCommand", '.command("init")'],
      },
      mutation: {
        file: "packages/cli/src/commands/init.js",
        symbol: "registerInitCommand",
        evidence: [
          'path.join(personaSkillDir, "SKILL.md")',
          'path.join(skillDir, "SKILL.md")',
          "fs.writeFileSync(",
        ],
      },
    }),
    writer({
      id: "cli-anything-register-skill",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-bytes",
      discoverySymbol: "registerTool",
      entrypoint: {
        file: "packages/cli/src/lib/cli-anything-bridge.js",
        symbol: "registerTool",
        evidence: ["export function registerTool", "opts.command ||"],
      },
      mutation: {
        file: "packages/cli/src/lib/cli-anything-bridge.js",
        symbol: "registerTool",
        evidence: [
          '_deps.path.join(dir, "SKILL.md")',
          "_deps.fs.writeFileSync(",
        ],
      },
    }),
    writer({
      id: "cli-anything-remove-skill",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-removal",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/cli-anything-bridge.js",
        symbol: "removeTool",
        evidence: ["export function removeTool", "_skillDir(toolName)"],
      },
      mutation: {
        file: "packages/cli/src/lib/cli-anything-bridge.js",
        symbol: "removeTool",
        evidence: ["_deps.fs.rmSync(dir, { recursive: true, force: true })"],
      },
    }),
    writer({
      id: "cli-skill-pack-generate",
      surface: "cli",
      triggerClass: "build-time",
      targetAuthority: "legacy-active",
      mutationType: "skill-bytes",
      discoverySymbol: "generateCliPacks",
      entrypoint: {
        file: "packages/cli/src/lib/skill-packs/generator.js",
        symbol: "generateCliPacks",
        evidence: [
          "export async function generateCliPacks",
          "options.outputDir ||",
        ],
      },
      mutation: {
        file: "packages/cli/src/lib/skill-packs/generator.js",
        symbol: "generateCliPacks",
        evidence: [
          'path.join(packDir, "SKILL.md")',
          "fs.writeFileSync(skillMdPath, skillMd",
        ],
      },
    }),
    writer({
      id: "cli-skill-pack-remove",
      surface: "cli",
      triggerClass: "build-time",
      targetAuthority: "legacy-active",
      mutationType: "skill-removal",
      discoverySymbol: "removeCliPacks",
      entrypoint: {
        file: "packages/cli/src/lib/skill-packs/generator.js",
        symbol: "removeCliPacks",
        evidence: ["export function removeCliPacks"],
      },
      mutation: {
        file: "packages/cli/src/lib/skill-packs/generator.js",
        symbol: "removeCliPacks",
        evidence: ["fs.rmSync(packDir, { recursive: true, force: true })"],
      },
    }),
    writer({
      id: "cli-record-replay-install",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-package-transaction",
      discoverySymbol: "installRecordedSkillPackage",
      entrypoint: {
        file: "packages/cli/src/lib/record-replay/recorded-skill-package.js",
        symbol: "installRecordedSkillPackage",
        evidence: ["export function installRecordedSkillPackage"],
      },
      mutation: {
        file: "packages/cli/src/lib/record-replay/recorded-skill-package.js",
        symbol: "installRecordedSkillPackage",
        evidence: [
          '"SKILL.md"',
          "writeFileSync(handle, contents[name]",
          "renameSync(staging, location.target)",
        ],
      },
    }),
    writer({
      id: "cli-record-replay-revoke",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-removal",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/record-replay/recorded-skill-package.js",
        symbol: "stageRecordedSkillPackageRevocation",
        evidence: ["export function stageRecordedSkillPackageRevocation"],
      },
      mutation: {
        file: "packages/cli/src/lib/record-replay/recorded-skill-package.js",
        symbol: "stageRecordedSkillPackageRevocation",
        evidence: [
          "renameSync(location.target, quarantine)",
          "rmSync(quarantine, { recursive: true, force: true })",
        ],
      },
    }),
    writer({
      id: "cli-plugin-install",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "indirect-plugin-tree",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "installFromSource",
        evidence: ["export function installFromSource"],
      },
      mutation: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "installFromDirectory",
        evidence: [
          "export function installFromDirectory",
          "copyDirGuarded(src, staged, staged)",
          "setActiveVersion(name, version",
        ],
      },
    }),
    writer({
      id: "cli-plugin-update",
      surface: "cli",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "indirect-plugin-tree",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "updatePlugin",
        evidence: ["export function updatePlugin"],
      },
      mutation: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "updatePlugin",
        evidence: [
          "const res = installFromDirectory(dir, {",
          "candidate-active",
        ],
      },
    }),
    writer({
      id: "cli-plugin-active-switch",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "active-selection",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "setActiveVersion",
        evidence: ["export function setActiveVersion"],
      },
      mutation: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "writeActivePointerBytes",
        evidence: [
          "function writeActivePointerBytes",
          "_deps.renameSync(tempFile, activeFile)",
        ],
      },
    }),
    writer({
      id: "cli-plugin-enabled-state",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "active-selection",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "setPluginEnabled",
        evidence: [
          "export function setPluginEnabled(name, enabled, opts = {})",
        ],
      },
      mutation: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "setPluginEnabled",
        evidence: [
          "writeDisabledMarkerState(marker, nameDir, desiredMarkerState)",
          'persistPluginLifecycleTransaction(transaction, "marker-committing")',
        ],
      },
    }),
    writer({
      id: "cli-plugin-uninstall",
      surface: "cli",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-removal",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "uninstall",
        evidence: ["export function uninstall"],
      },
      mutation: {
        file: "packages/cli/src/lib/plugin-runtime/install.js",
        symbol: "runDurableVersionUninstall",
        evidence: [
          "function runDurableVersionUninstall",
          "_deps.renameSync(dir, quarantined)",
        ],
      },
    }),
    writer({
      id: "cli-learning-synthesis-candidate",
      surface: "cli",
      triggerClass: "automatic",
      targetAuthority: "candidate-only",
      mutationType: "candidate-skill-bytes",
      discoverySymbol: "_persistSkill",
      entrypoint: {
        file: "packages/cli/src/lib/learning/skill-synthesizer.js",
        symbol: "SkillSynthesizer.synthesize",
        evidence: ["async synthesize()", "await this._persistSkill"],
      },
      mutation: {
        file: "packages/cli/src/lib/learning/skill-synthesizer.js",
        symbol: "SkillSynthesizer._persistSkill",
        evidence: [
          "async _persistSkill",
          'path.join(canonicalSkillDir, "SKILL.md")',
          'flag: "wx"',
        ],
      },
    }),
    writer({
      id: "cli-learning-improvement-candidate",
      surface: "cli",
      triggerClass: "automatic",
      targetAuthority: "candidate-only",
      mutationType: "candidate-skill-bytes",
      discoverySymbol: "_writeCandidate",
      entrypoint: {
        file: "packages/cli/src/lib/learning/skill-improver.js",
        symbol: "SkillImprover._finalizeCandidate",
        evidence: ["async _finalizeCandidate", "await this._writeCandidate"],
      },
      mutation: {
        file: "packages/cli/src/lib/learning/skill-improver.js",
        symbol: "SkillImprover._writeCandidate",
        evidence: [
          "async _writeCandidate",
          'path.join(canonicalSkillDir, "SKILL.md")',
          'flag: "wx"',
        ],
      },
    }),
    writer({
      id: "cli-content-addressed-candidate-registry",
      surface: "cli",
      triggerClass: "automatic",
      targetAuthority: "candidate-only",
      mutationType: "candidate-artifact",
      discoverySymbol: null,
      entrypoint: {
        file: "packages/cli/src/lib/evolution/skill-candidate-registry.js",
        symbol: "SkillCandidateRegistry.create",
        evidence: ["export class SkillCandidateRegistry", "create(input)"],
      },
      mutation: {
        file: "packages/cli/src/lib/evolution/skill-candidate-registry.js",
        symbol: "SkillCandidateRegistry.create",
        evidence: [
          'this._fs.openSync(temporaryPath, "wx"',
          "this._fs.linkSync(temporaryPath, filePath)",
        ],
      },
    }),
    writer({
      id: "desktop-cowork-file-mutation-ipc",
      surface: "desktop",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "generic-path-capability",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/cowork-ipc.js",
        symbol: "ipc:cowork:write-file",
        evidence: ['"cowork:write-file"', '"cowork:delete-file"'],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/cowork-ipc.js",
        symbol: "fileSandbox",
        evidence: [
          "await fileSandbox.writeFile(",
          "await fileSandbox.deleteFile(",
        ],
      },
    }),
    writer({
      id: "desktop-bundled-skill-filesystem-writer",
      surface: "desktop",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "generic-workspace-path-capability",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skills-ipc.js",
        symbol: "registerSkillsIPC",
        evidence: [
          "registry.setBundledSkillFilesystemAuthorityFactory(",
          "createBundledSkillFilesystemAuthorityFactory({",
        ],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-filesystem-authority.js",
        symbol: "createNativeFilesystemAdapter",
        evidence: [
          "writeFileSync: (...args) => fsImpl.writeFileSync(...args)",
          "unlinkSync: (...args) => fsImpl.unlinkSync(...args)",
          "allowedRoots.push(workspaceRoot)",
        ],
      },
    }),
    writer({
      id: "desktop-bundled-skill-process-writer",
      surface: "desktop",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "generic-workspace-process-capability",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skills-ipc.js",
        symbol: "registerSkillsIPC",
        evidence: [
          "registry.setBundledSkillProcessAuthorityFactory(",
          "createBundledSkillProcessAuthorityFactory({",
        ],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/bundled-skill-process-broker.js",
        symbol: "validateLintAndFix/execFileSync",
        evidence: [
          "function validateLintAndFix(file, args, policy, cwd)",
          '["eslint", "--fix", "--format", "json"]',
          '["prettier", "--write"]',
          "function execFileSync(file, args, options = {})",
        ],
      },
    }),
    writer({
      id: "desktop-skills-create-ipc",
      surface: "desktop",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-bytes",
      discoverySymbol: "ipc:skills:create",
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skills-ipc.js",
        symbol: "ipc:skills:create",
        evidence: ['ipcMain.handle("skills:create"'],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skills-ipc.js",
        symbol: "ipc:skills:create",
        evidence: [
          'path.join(targetDir, "SKILL.md")',
          "await fs.writeFile(skillMdPath, content",
        ],
      },
    }),
    writer({
      id: "desktop-skills-enabled-ipc",
      surface: "desktop",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "active-selection",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skills-ipc.js",
        symbol: "ipc:skills:set-enabled",
        evidence: ['ipcMain.handle("skills:set-enabled"'],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skills-ipc.js",
        symbol: "ipc:skills:set-enabled",
        evidence: ["skill.config.enabled = enabled"],
      },
    }),
    writer({
      id: "desktop-skill-creator-create",
      surface: "desktop",
      triggerClass: "manual",
      targetAuthority: "candidate-only",
      mutationType: "in-memory-candidate",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
        symbol: "handler.execute:create",
        evidence: ['case "create"', "return handleCreate("],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
        symbol: "handleCreate",
        evidence: [
          "function handleCreate",
          "candidateOnlyResult({",
          "proposedFiles: files",
          "activeMutation: false",
        ],
      },
    }),
    writer({
      id: "desktop-skill-creator-optimize-description",
      surface: "desktop",
      triggerClass: "automatic",
      targetAuthority: "candidate-only",
      mutationType: "in-memory-candidate",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
        symbol: "handler.execute:optimize-description",
        evidence: ['case "optimize-description"', "handleOptimizeDescription("],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/builtin/skill-creator/handler.js",
        symbol: "handleOptimizeDescription",
        evidence: [
          "async function handleOptimizeDescription",
          "proposedContent",
          'path: "SKILL.md"',
          "activeMutation: false",
        ],
      },
    }),
    writer({
      id: "desktop-skill-sync-import",
      surface: "desktop",
      triggerClass: "automatic",
      targetAuthority: "candidate-only",
      mutationType: "candidate-import-adapter",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-sync-manager.js",
        symbol: "SkillSyncManager.importSkill",
        evidence: ["async importSkill(pkg)"],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-sync-manager.js",
        symbol: "SkillSyncManager.importSkill",
        evidence: [
          "const staged = await this.artifactCandidateGate.stageCandidate(",
          "persistenceReceipt: staged.receipt",
          'action: "candidate-staged"',
          "activeMutation: false",
        ],
      },
    }),
    writer({
      id: "desktop-plugin-install",
      surface: "desktop",
      triggerClass: "manual",
      targetAuthority: "candidate-only",
      mutationType: "inactive-plugin-tree",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/marketplace/plugin-installer.js",
        symbol: "PluginInstaller.installPlugin",
        evidence: ["async installPlugin(pluginId"],
      },
      mutation: {
        file: "desktop-app-vue/src/main/marketplace/plugin-installer.js",
        symbol: "PluginInstaller.installPlugin",
        evidence: [
          "await this.extractPlugin(downloadPath, pluginDir)",
          'path.join(pluginDir, "SKILL.md")',
          "Marketplace SKILL.md files are not active at install time",
          "governed promotion is required",
        ],
      },
    }),
    writer({
      id: "desktop-plugin-update",
      surface: "desktop",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "indirect-plugin-tree",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/marketplace/plugin-installer.js",
        symbol: "PluginInstaller.updatePlugin",
        evidence: ["async updatePlugin(pluginId, newVersion)"],
      },
      mutation: {
        file: "desktop-app-vue/src/main/marketplace/plugin-installer.js",
        symbol: "PluginInstaller.updatePlugin",
        evidence: [
          "await this._safeDeleteDir(pluginDir)",
          "await this.extractPlugin(downloadPath, pluginDir)",
        ],
      },
    }),
    writer({
      id: "desktop-plugin-uninstall",
      surface: "desktop",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "skill-removal",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/marketplace/plugin-installer.js",
        symbol: "PluginInstaller.uninstallPlugin",
        evidence: ["async uninstallPlugin(pluginId)"],
      },
      mutation: {
        file: "desktop-app-vue/src/main/marketplace/plugin-installer.js",
        symbol: "PluginInstaller._safeDeleteDir",
        evidence: ["await this._safeDeleteDir(pluginDir)"],
      },
    }),
    writer({
      id: "desktop-evomap-import-skill",
      surface: "desktop",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "legacy-skill-bytes",
      discoverySymbol: "importAsSkill",
      entrypoint: {
        file: "desktop-app-vue/src/main/evomap/evomap-asset-bridge.js",
        symbol: "EvoMapAssetBridge.importAsSkill",
        evidence: ["async importAsSkill(assetId)"],
      },
      mutation: {
        file: "desktop-app-vue/src/main/evomap/evomap-asset-bridge.js",
        symbol: "EvoMapAssetBridge.importAsSkill",
        evidence: ["Convert Gene", "fs.writeFileSync(skillPath, skillContent"],
      },
    }),
    writer({
      id: "desktop-skill-registry-hot-load",
      surface: "desktop",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "active-selection",
      discoverySymbol: null,
      entrypoint: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-registry.js",
        symbol: "SkillRegistry.hotLoadSkill",
        evidence: ["hotLoadSkill(skillId, definition)"],
      },
      mutation: {
        file: "desktop-app-vue/src/main/ai-engine/cowork/skills/skill-registry.js",
        symbol: "SkillRegistry.hotLoadSkill",
        evidence: ["this.unregister(skillId)", "this.register(skill)"],
      },
    }),
    writer({
      id: "android-managed-skill-install",
      surface: "android",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "legacy-skill-bytes-and-activation",
      discoverySymbol: "installManaged",
      entrypoint: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.installManaged",
        evidence: [
          "fun installManaged(filename: String, content: String): Boolean",
        ],
      },
      mutation: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.installManaged",
        evidence: [
          "val file = File(dir, filename)",
          "file.writeText(content, Charsets.UTF_8)",
          "registry.register(skill)",
          "file.delete()",
        ],
      },
    }),
    writer({
      id: "android-managed-skill-uninstall",
      surface: "android",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "legacy-skill-removal-and-deactivation",
      discoverySymbol: "uninstallManaged",
      entrypoint: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.uninstallManaged",
        evidence: ["fun uninstallManaged(skillName: String): Boolean"],
      },
      mutation: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.uninstallManaged",
        evidence: ["file.delete()", "registry.unregister(skillName)"],
      },
    }),
    writer({
      id: "android-skill-loader-activation",
      surface: "android",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "startup-active-selection",
      discoverySymbol: "loadFromDirectory",
      entrypoint: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/di/SkillModule.kt",
        symbol: "SkillModule.provideSkillLoader",
        evidence: [
          "fun provideSkillLoader(",
          "val loader = SkillLoader(context, parser, registry)",
          "loader.loadAll()",
        ],
      },
      mutation: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.loadFromDirectory",
        evidence: [
          "private fun loadFromDirectory(dir: File, source: SkillSource): Int",
          "registry.register(skill)",
        ],
      },
    }),
    writer({
      id: "android-bundled-skill-activation",
      surface: "android",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "startup-active-selection",
      discoverySymbol: "loadBundled",
      entrypoint: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/di/SkillModule.kt",
        symbol: "SkillModule.provideSkillLoader",
        evidence: ["loader.loadAll()"],
      },
      mutation: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.loadBundled",
        evidence: [
          "fun loadBundled(): Int",
          'assetManager.open("$BUNDLED_SKILLS_DIR/$filename")',
          "registry.register(skill)",
        ],
      },
    }),
    writer({
      id: "android-workspace-skill-activation",
      surface: "android",
      triggerClass: "manual",
      targetAuthority: "legacy-active",
      mutationType: "workspace-active-selection",
      discoverySymbol: null,
      entrypoint: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.setWorkspacePath",
        evidence: [
          "fun setWorkspacePath(path: String?)",
          "workspacePath = path",
        ],
      },
      mutation: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/loader/SkillLoader.kt",
        symbol: "SkillLoader.loadWorkspace",
        evidence: [
          "fun loadWorkspace(): Int",
          "val path = workspacePath ?: return 0",
          "return loadFromDirectory(dir, SkillSource.WORKSPACE)",
        ],
      },
    }),
    writer({
      id: "android-skill-registry-mutation",
      surface: "android",
      triggerClass: "automatic",
      targetAuthority: "legacy-active",
      mutationType: "active-registry-state",
      discoverySymbol: null,
      entrypoint: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/registry/SkillRegistry.kt",
        symbol: "SkillRegistry.register/unregister",
        evidence: [
          "fun register(skill: Skill)",
          "fun unregister(name: String)",
        ],
      },
      mutation: {
        file: "android-app/feature-ai/src/main/java/com/chainlesschain/android/feature/ai/cowork/skills/registry/SkillRegistry.kt",
        symbol: "SkillRegistry.register/unregister",
        evidence: [
          "skills[skill.name] = skill",
          "skills.remove(name)?.let { index.remove(it.name) }",
        ],
      },
    }),
  ]),
  scopeExclusions: Object.freeze([
    scopeExclusion({
      id: "desktop-plugin-enabled-db-state",
      surface: "desktop",
      reasonCode: "database-metadata-without-immediate-skill-registry-mutation",
      evidence: {
        file: "desktop-app-vue/src/main/marketplace/plugin-installer.js",
        symbol: "PluginInstaller.enablePlugin/disablePlugin",
        evidence: [
          "async enablePlugin(pluginId)",
          '"UPDATE installed_plugins SET enabled = 1 WHERE plugin_id = ?"',
          "async disablePlugin(pluginId)",
          '"UPDATE installed_plugins SET enabled = 0 WHERE plugin_id = ?"',
        ],
      },
    }),
    scopeExclusion({
      id: "desktop-legacy-skill-tool-db-state",
      surface: "desktop",
      reasonCode: "legacy-database-skill-metadata-not-skill-md-authority",
      evidence: {
        file: "desktop-app-vue/src/main/skill-tool-system/skill-manager.js",
        symbol: "SkillManager.registerSkill/unregisterSkill/toggleSkillEnabled",
        evidence: [
          "async registerSkill(skillData)",
          "async unregisterSkill(skillId)",
          "async toggleSkillEnabled(skillId, enabled)",
        ],
      },
    }),
    scopeExclusion({
      id: "desktop-marketplace-skill-install-metadata",
      surface: "desktop",
      reasonCode: "marketplace-install-record-without-skill-artifact-mutation",
      evidence: {
        file: "desktop-app-vue/src/main/marketplace/skill-marketplace-client.js",
        symbol: "SkillMarketplaceClient.installSkill/uninstallSkill",
        evidence: [
          "async installSkill(skillId, skillData = {})",
          "INSERT OR REPLACE INTO skill_marketplace_installs",
          "async uninstallSkill(skillId)",
          'prepare("DELETE FROM skill_marketplace_installs WHERE skill_id = ?")',
        ],
      },
    }),
  ]),
});
