/**
 * SkillRegistry - 技能注册表
 *
 * 管理所有可用的技能，提供技能注册、查找和执行功能。
 *
 * @module ai-engine/cowork/skills/skill-registry
 */

const { logger } = require("../../../utils/logger.js");
const EventEmitter = require("events");
const nodeCrypto = require("node:crypto");
const {
  BUNDLED_SKILL_CAPABILITY_CATALOG,
} = require("./bundled-skill-capability-catalog");
const { startSkillInvocation } = require("./skill-invocation-receipt.js");
const { SkillMdParser } = require("./skill-md-parser");
const { MarkdownSkill } = require("./markdown-skill");
const {
  SKILL_PACKAGE_FORMAT,
  calculateSkillPackageChecksum,
} = require("./skill-sync-manager");
const {
  ARTIFACT_TYPE,
  isEvolvableArtifactActiveReleaseReader,
} = require("@chainlesschain/session-core/evolvable-artifact");

const GOVERNED_SKILL_MAX_BODY_BYTES = 256 * 1024;
const GOVERNED_SKILL_PACKAGE_KEYS = new Set([
  "format",
  "metadata",
  "body",
  "handler",
  "signatureLock",
  "checksum",
  "exportedAt",
  "exportedFrom",
]);

function fallbackSkillDigest(skill) {
  return `sha256:${nodeCrypto
    .createHash("sha256")
    .update(
      `${skill.skillId}\0${skill.version || "unknown"}\0${String(
        skill.constructor,
      )}`,
    )
    .digest("hex")}`;
}

/**
 * SkillRegistry 类
 */
class SkillRegistry extends EventEmitter {
  constructor(options = {}) {
    super();

    this.options = {
      ...options,
      // 是否启用自动加载
      autoLoad: options.autoLoad !== false,
      // 最大技能数（内置 ~139 + marketplace + 用户自定义；1000 仅作 sanity 上限，
      // 防御循环注册等异常导致 OOM。tests 显式传 maxSkills 覆盖此默认值）
      maxSkills: options.maxSkills || 1000,
    };
    this.artifactActiveReleaseReader = null;
    if (options.artifactActiveReleaseReader != null) {
      this.setArtifactActiveReleaseReader(options.artifactActiveReleaseReader);
    }
    this._executionAuthorizer = null;
    this._bundledSkillFilesystemAuthorityFactory = null;
    this._bundledSkillEnvironmentAuthorityFactory = null;
    this._bundledSkillProcessAuthorityFactory = null;
    this._bundledSkillNetworkAuthorityFactory = null;
    if (Object.hasOwn(options, "executionAuthorizer")) {
      this.setExecutionAuthorizer(options.executionAuthorizer);
    }
    if (Object.hasOwn(options, "bundledSkillFilesystemAuthorityFactory")) {
      this.setBundledSkillFilesystemAuthorityFactory(
        options.bundledSkillFilesystemAuthorityFactory,
      );
    }
    if (Object.hasOwn(options, "bundledSkillEnvironmentAuthorityFactory")) {
      this.setBundledSkillEnvironmentAuthorityFactory(
        options.bundledSkillEnvironmentAuthorityFactory,
      );
    }
    if (Object.hasOwn(options, "bundledSkillProcessAuthorityFactory")) {
      this.setBundledSkillProcessAuthorityFactory(
        options.bundledSkillProcessAuthorityFactory,
      );
    }
    if (Object.hasOwn(options, "bundledSkillNetworkAuthorityFactory")) {
      this.setBundledSkillNetworkAuthorityFactory(
        options.bundledSkillNetworkAuthorityFactory,
      );
    }

    // 技能映射: skillId -> Skill
    this.skills = new Map();

    // 分类索引: category -> Set<skillId>
    this.categoryIndex = new Map();

    // 文件类型索引: fileType -> Set<skillId>
    this.fileTypeIndex = new Map();

    this._log("SkillRegistry 已初始化");
  }

  setArtifactActiveReleaseReader(activeReleaseReader) {
    if (
      !isEvolvableArtifactActiveReleaseReader(
        activeReleaseReader,
        ARTIFACT_TYPE.SKILL,
      )
    ) {
      throw new TypeError(
        "SkillRegistry requires a branded Skill active release reader",
      );
    }
    this.artifactActiveReleaseReader = activeReleaseReader;
  }

  _activeSkillFromRelease(release) {
    const pkg = release.content;
    const runtimeManifest = release.artifact.runtimeManifest;
    const permissionManifest = release.artifact.permissionManifest;
    if (
      !release.contentAvailable ||
      !pkg ||
      typeof pkg !== "object" ||
      Array.isArray(pkg) ||
      Reflect.ownKeys(pkg).some((key) => typeof key !== "string") ||
      Object.keys(pkg).length !== GOVERNED_SKILL_PACKAGE_KEYS.size ||
      Object.keys(pkg).some((key) => !GOVERNED_SKILL_PACKAGE_KEYS.has(key)) ||
      pkg.format !== SKILL_PACKAGE_FORMAT ||
      !pkg.metadata ||
      typeof pkg.metadata !== "object" ||
      Array.isArray(pkg.metadata) ||
      typeof pkg.metadata.skillId !== "string" ||
      !/^[a-z][a-z0-9-]{0,127}$/u.test(pkg.metadata.skillId) ||
      release.artifactId !== `skill:${pkg.metadata.skillId}` ||
      typeof pkg.body !== "string" ||
      pkg.body.length === 0 ||
      Buffer.byteLength(pkg.body, "utf8") > GOVERNED_SKILL_MAX_BODY_BYTES ||
      pkg.handler !== null ||
      pkg.signatureLock !== null ||
      !Number.isSafeInteger(pkg.exportedAt) ||
      pkg.exportedAt < 0 ||
      typeof pkg.exportedFrom !== "string" ||
      pkg.exportedFrom.length === 0 ||
      Buffer.byteLength(pkg.exportedFrom, "utf8") > 256 ||
      runtimeManifest.executable !== false ||
      runtimeManifest.handlerDigest !== null ||
      runtimeManifest.signatureLockDigest !== null ||
      !runtimeManifest.requires ||
      !Array.isArray(runtimeManifest.requires.bins) ||
      runtimeManifest.requires.bins.length !== 0 ||
      !Array.isArray(runtimeManifest.requires.env) ||
      runtimeManifest.requires.env.length !== 0 ||
      !Array.isArray(permissionManifest.capabilities) ||
      permissionManifest.capabilities.length !== 0 ||
      typeof pkg.checksum !== "string" ||
      !/^[a-f0-9]{64}$/u.test(pkg.checksum) ||
      calculateSkillPackageChecksum(pkg) !== pkg.checksum
    ) {
      throw new Error("Active Skill release content is unsafe or invalid");
    }
    const definition = new SkillMdParser({
      strictValidation: true,
    }).parseContent(pkg.body, "unknown");
    if (
      definition.name !== pkg.metadata.skillId ||
      String(pkg.metadata.version || "") !== definition.version ||
      definition.handler
    ) {
      throw new Error("Active Skill release definition is not package-bound");
    }
    definition.source = "governed";
    definition.sourcePath = "unknown";
    definition.enabled = true;
    definition._governedRelease = Object.freeze({
      releaseId: release.releaseId,
      contentDigest: release.contentDigest,
      artifactDigest: release.artifactDigest,
    });
    return new MarkdownSkill(definition);
  }

  async loadGovernedActiveSkills() {
    if (!this.artifactActiveReleaseReader) {
      this._unloadGovernedSkills();
      return { loaded: 0, registered: 0, authority: "unavailable" };
    }
    let releases;
    try {
      releases = await this.artifactActiveReleaseReader.listActive();
    } catch (error) {
      this._unloadGovernedSkills();
      throw error;
    }
    let skills;
    try {
      skills = releases.map((release) =>
        this._activeSkillFromRelease(release),
      );
    } catch (error) {
      this._unloadGovernedSkills();
      throw error;
    }
    const activeIds = new Set(skills.map((skill) => skill.skillId));
    const finalIds = new Set(
      [...this.skills.values()]
        .filter((skill) => skill.source !== "governed")
        .map((skill) => skill.skillId),
    );
    for (const activeId of activeIds) finalIds.add(activeId);
    if (finalIds.size > this.options.maxSkills) {
      this._unloadGovernedSkills();
      throw new Error(`已达到最大技能数限制: ${this.options.maxSkills}`);
    }
    for (const skill of [...this.skills.values()]) {
      if (skill.source === "governed" && !activeIds.has(skill.skillId)) {
        this.unregister(skill.skillId);
      }
    }
    try {
      for (const skill of skills) {
        if (this.skills.has(skill.skillId)) this.unregister(skill.skillId);
        this.register(skill);
      }
    } catch (error) {
      this._unloadGovernedSkills();
      throw error;
    }
    return {
      loaded: releases.length,
      registered: skills.length,
      authority: "governed-active-release-reader",
    };
  }

  _unloadGovernedSkills() {
    for (const skill of [...this.skills.values()]) {
      if (skill.source === "governed") this.unregister(skill.skillId);
    }
  }

  // ==========================================
  // 技能注册
  // ==========================================

  /**
   * 注册技能
   * @param {BaseSkill} skill - 技能实例
   */
  register(skill) {
    if (!skill || !skill.skillId) {
      throw new Error("Invalid skill: missing skillId");
    }

    if (this.skills.size >= this.options.maxSkills) {
      throw new Error(`已达到最大技能数限制: ${this.options.maxSkills}`);
    }

    if (this.skills.has(skill.skillId)) {
      this._log(`技能已存在，将被覆盖: ${skill.skillId}`, "warn");
    }

    // 注册技能
    this.skills.set(skill.skillId, skill);

    // 更新分类索引
    if (skill.category) {
      if (!this.categoryIndex.has(skill.category)) {
        this.categoryIndex.set(skill.category, new Set());
      }
      this.categoryIndex.get(skill.category).add(skill.skillId);
    }

    // 更新文件类型索引
    if (skill.supportedFileTypes && Array.isArray(skill.supportedFileTypes)) {
      for (const fileType of skill.supportedFileTypes) {
        if (!this.fileTypeIndex.has(fileType)) {
          this.fileTypeIndex.set(fileType, new Set());
        }
        this.fileTypeIndex.get(fileType).add(skill.skillId);
      }
    }

    // 监听技能事件
    this._attachSkillEventListeners(skill);

    this._log(`技能已注册: ${skill.name} (${skill.skillId})`);
    this.emit("skill-registered", { skill });
  }

  /**
   * 批量注册技能
   * @param {Array<BaseSkill>} skills - 技能数组
   */
  registerMultiple(skills) {
    for (const skill of skills) {
      this.register(skill);
    }
  }

  /**
   * 注销技能
   * @param {string} skillId - 技能 ID
   */
  unregister(skillId) {
    const skill = this.skills.get(skillId);

    if (!skill) {
      this._log(`技能不存在: ${skillId}`, "warn");
      return;
    }

    // 移除技能
    this.skills.delete(skillId);

    // 更新分类索引
    if (skill.category && this.categoryIndex.has(skill.category)) {
      this.categoryIndex.get(skill.category).delete(skillId);
      if (this.categoryIndex.get(skill.category).size === 0) {
        this.categoryIndex.delete(skill.category);
      }
    }

    // 更新文件类型索引
    if (skill.supportedFileTypes) {
      for (const fileType of skill.supportedFileTypes) {
        if (this.fileTypeIndex.has(fileType)) {
          this.fileTypeIndex.get(fileType).delete(skillId);
          if (this.fileTypeIndex.get(fileType).size === 0) {
            this.fileTypeIndex.delete(fileType);
          }
        }
      }
    }

    this._log(`技能已注销: ${skill.name} (${skillId})`);
    this.emit("skill-unregistered", { skillId, skill });
  }

  /**
   * 热加载单个技能
   * @param {string} skillId - 技能 ID
   * @param {object} definition - 技能定义
   * @returns {boolean} 是否成功
   */
  hotLoadSkill(skillId, definition) {
    try {
      const { MarkdownSkill } = require("./markdown-skill");
      const skill = new MarkdownSkill(definition);
      this.register(skill);
      this._log(`技能热加载成功: ${skillId}`);
      this.emit("skill-hot-loaded", { skillId, skill });
      return true;
    } catch (error) {
      this._log(`技能热加载失败 ${skillId}: ${error.message}`, "error");
      return false;
    }
  }

  /**
   * 热卸载单个技能
   * @param {string} skillId - 技能 ID
   * @returns {boolean} 是否成功
   */
  hotUnloadSkill(skillId) {
    if (!this.skills.has(skillId)) {
      this._log(`技能不存在，无法热卸载: ${skillId}`, "warn");
      return false;
    }
    this.unregister(skillId);
    this._log(`技能热卸载成功: ${skillId}`);
    this.emit("skill-hot-unloaded", { skillId });
    return true;
  }

  // ==========================================
  // 技能查找
  // ==========================================

  /**
   * 获取技能
   * @param {string} skillId - 技能 ID
   * @returns {BaseSkill|undefined}
   */
  getSkill(skillId) {
    const skill = this.skills.get(skillId);
    if (skill && typeof skill.ensureFullyLoaded === "function") {
      // Trigger lazy loading (non-blocking, best effort)
      skill.ensureFullyLoaded().catch(() => {});
    }
    return skill;
  }

  /**
   * 查找能处理任务的技能
   * @param {Object} task - 任务对象
   * @param {Object} options - 选项
   * @returns {Array<{skill: BaseSkill, score: number}>}
   */
  findSkillsForTask(task, options = {}) {
    const results = [];

    for (const [skillId, skill] of this.skills) {
      if (!skill.config.enabled) {
        continue;
      }

      const score = skill.canHandle(task);
      if (score > 0) {
        results.push({ skill, score });
      }
    }

    // 按分数排序
    results.sort((a, b) => b.score - a.score);

    // 限制返回数量
    const limit = options.limit || results.length;
    return results.slice(0, limit);
  }

  /**
   * 选择最佳技能
   * @param {Object} task - 任务对象
   * @returns {BaseSkill|null}
   */
  selectBestSkill(task) {
    const skills = this.findSkillsForTask(task, { limit: 1 });
    return skills.length > 0 ? skills[0].skill : null;
  }

  /**
   * 按分类获取技能
   * @param {string} category - 分类
   * @returns {Array<BaseSkill>}
   */
  getSkillsByCategory(category) {
    const skillIds = this.categoryIndex.get(category);
    if (!skillIds) {
      return [];
    }

    return Array.from(skillIds)
      .map((id) => this.skills.get(id))
      .filter((skill) => skill !== undefined);
  }

  /**
   * 按文件类型获取技能
   * @param {string} fileType - 文件类型
   * @returns {Array<BaseSkill>}
   */
  getSkillsByFileType(fileType) {
    const skillIds = this.fileTypeIndex.get(fileType);
    if (!skillIds) {
      return [];
    }

    return Array.from(skillIds)
      .map((id) => this.skills.get(id))
      .filter((skill) => skill !== undefined);
  }

  /**
   * 获取所有技能
   * @returns {Array<BaseSkill>}
   */
  getAllSkills() {
    return Array.from(this.skills.values());
  }

  /**
   * 获取已启用的技能
   * @returns {Array<BaseSkill>}
   */
  getEnabledSkills() {
    return this.getAllSkills().filter((skill) => skill.config.enabled);
  }

  // ==========================================
  // 技能执行
  // ==========================================

  /**
   * 执行技能
   * @param {string} skillId - 技能 ID
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async executeSkill(skillId, task, context = {}) {
    const skill = this.skills.get(skillId);

    if (!skill) {
      throw new Error(`技能不存在: ${skillId}`);
    }

    if (!skill.config.enabled) {
      throw new Error(`技能已禁用: ${skillId}`);
    }

    return await this._executeWithHostAuthority(skill, task, context);
  }

  /**
   * 自动执行任务（选择最佳技能）
   * @param {Object} task - 任务对象
   * @param {Object} context - 执行上下文
   * @returns {Promise<any>} 执行结果
   */
  async autoExecute(task, context = {}) {
    try {
      // 兼容性：如果task没有type但有operation，推断type为office
      let taskObj = task;
      if (!task.type && task.operation) {
        taskObj = {
          ...task,
          type: "office",
        };
      }

      const bestSkill = this.selectBestSkill(taskObj);

      if (!bestSkill) {
        throw new Error(
          `没有可用的技能来处理任务: ${taskObj.type || "unknown"}`,
        );
      }

      this._log(`自动选择技能: ${bestSkill.name} (${bestSkill.skillId})`);

      return await this._executeWithHostAuthority(bestSkill, taskObj, context);
    } catch (error) {
      // 兼容性：捕获错误并返回失败结果而不是抛出异常
      this._log(`任务执行失败: ${error.message}`, "error");
      return {
        success: false,
        error: error.message,
        ...(error.prevented === true ? { prevented: true } : {}),
      };
    }
  }

  /**
   * Configure the trusted host policy decision used by every registry entry.
   * @param {Function|null} authorizer
   */
  setExecutionAuthorizer(authorizer) {
    if (authorizer !== null && typeof authorizer !== "function") {
      throw new TypeError(
        "Skill execution authorizer must be a function or null",
      );
    }
    this._executionAuthorizer = authorizer;
  }

  /**
   * Configure production filesystem authority creation for reviewed bundled
   * Skills. Renderer-provided host ports are always replaced by this factory.
   * @param {Function|null} factory
   */
  setBundledSkillFilesystemAuthorityFactory(factory) {
    if (factory !== null && typeof factory !== "function") {
      throw new TypeError(
        "Bundled Skill filesystem authority factory must be a function or null",
      );
    }
    this._bundledSkillFilesystemAuthorityFactory = factory;
  }

  setBundledSkillEnvironmentAuthorityFactory(factory) {
    if (factory !== null && typeof factory !== "function") {
      throw new TypeError(
        "Bundled Skill environment authority factory must be a function or null",
      );
    }
    this._bundledSkillEnvironmentAuthorityFactory = factory;
  }

  setBundledSkillProcessAuthorityFactory(factory) {
    if (factory !== null && typeof factory !== "function") {
      throw new TypeError(
        "Bundled Skill process authority factory must be a function or null",
      );
    }
    this._bundledSkillProcessAuthorityFactory = factory;
  }

  setBundledSkillNetworkAuthorityFactory(factory) {
    if (factory !== null && typeof factory !== "function") {
      throw new TypeError(
        "Bundled Skill network authority factory must be a function or null",
      );
    }
    this._bundledSkillNetworkAuthorityFactory = factory;
  }

  async _authorizeExecution(skill, task, context) {
    let decision = null;
    const policyAuthorized = typeof this._executionAuthorizer === "function";
    if (policyAuthorized) {
      decision = await this._executionAuthorizer({
        skillId: skill.skillId,
        task,
        context,
      });
    }
    if (decision === false || decision?.approved === false) {
      const error = new Error(
        decision?.reason || `Skill execution prevented: ${skill.skillId}`,
      );
      error.code = "CC_SKILL_EXECUTION_PREVENTED";
      error.prevented = true;
      throw error;
    }
    return Object.freeze({
      approved: true,
      policyAuthorized,
      authorityId:
        typeof decision?.authorityId === "string" && decision.authorityId
          ? decision.authorityId
          : `skill-execution:${nodeCrypto.randomUUID()}`,
    });
  }

  async _prepareExecutionContext(skill, task, context) {
    const executionDecision = await this._authorizeExecution(
      skill,
      task,
      context,
    );
    const catalogEntry = BUNDLED_SKILL_CAPABILITY_CATALOG[skill.skillId];
    const executionSecurity = skill._executionSecurity;
    const needsFilesystemAuthority =
      skill.source === "bundled" &&
      executionSecurity?.packageOwned === true &&
      executionSecurity?.bundledCapabilityMigrated === true &&
      catalogEntry?.executionCapabilities.includes("host:filesystem");
    const needsEnvironmentAuthority =
      skill.source === "bundled" &&
      executionSecurity?.packageOwned === true &&
      executionSecurity?.bundledCapabilityMigrated === true &&
      catalogEntry?.executionCapabilities.includes("host:environment");
    const needsProcessAuthority =
      skill.source === "bundled" &&
      executionSecurity?.packageOwned === true &&
      executionSecurity?.bundledCapabilityMigrated === true &&
      catalogEntry?.executionCapabilities.includes("host:process");
    const needsNetworkAuthority =
      skill.source === "bundled" &&
      executionSecurity?.packageOwned === true &&
      executionSecurity?.bundledCapabilityMigrated === true &&
      catalogEntry?.executionCapabilities.includes("host:network");
    let executionContext =
      context && typeof context === "object" ? context : Object.create(null);

    if (
      needsFilesystemAuthority &&
      typeof this._bundledSkillFilesystemAuthorityFactory === "function"
    ) {
      const authority = await this._bundledSkillFilesystemAuthorityFactory({
        skillId: skill.skillId,
        task,
        context: executionContext,
        executionDecision,
      });
      if (!authority?.filesystem) {
        const error = new Error(
          `Filesystem authority factory returned no broker for ${skill.skillId}`,
        );
        error.code = "CC_BUNDLED_SKILL_FILESYSTEM_AUTHORITY_REQUIRED";
        throw error;
      }
      const originalHost =
        executionContext.host && typeof executionContext.host === "object"
          ? executionContext.host
          : Object.create(null);
      executionContext = {
        ...executionContext,
        projectRoot: authority.workspaceRoot,
        workspaceRoot: authority.workspaceRoot,
        workspacePath: authority.workspaceRoot,
        host: {
          ...originalHost,
          filesystem: authority.filesystem,
          ...(authority.filesystemTempRoot
            ? { filesystemTempRoot: authority.filesystemTempRoot }
            : {}),
        },
      };
    }

    if (
      needsEnvironmentAuthority &&
      typeof this._bundledSkillEnvironmentAuthorityFactory === "function"
    ) {
      const environmentBroker =
        await this._bundledSkillEnvironmentAuthorityFactory({
          skillId: skill.skillId,
          task,
          context: executionContext,
          executionDecision,
        });
      if (!environmentBroker) {
        const error = new Error(
          `Environment authority factory returned no broker for ${skill.skillId}`,
        );
        error.code = "CC_BUNDLED_SKILL_ENVIRONMENT_AUTHORITY_REQUIRED";
        throw error;
      }
      executionContext = {
        ...executionContext,
        environmentBroker,
      };
    }

    if (
      needsProcessAuthority &&
      typeof this._bundledSkillProcessAuthorityFactory === "function"
    ) {
      const authority = await this._bundledSkillProcessAuthorityFactory({
        skillId: skill.skillId,
        task,
        context: executionContext,
        executionDecision,
      });
      if (!authority?.processBroker) {
        const error = new Error(
          `Process authority factory returned no broker for ${skill.skillId}`,
        );
        error.code = "CC_BUNDLED_SKILL_PROCESS_AUTHORITY_REQUIRED";
        throw error;
      }
      executionContext = {
        ...executionContext,
        projectRoot: authority.workspaceRoot,
        workspaceRoot: authority.workspaceRoot,
        workspacePath: authority.workspaceRoot,
        processBroker: authority.processBroker,
        ...(authority.cliEntrypoint
          ? { cliEntrypoint: authority.cliEntrypoint }
          : {}),
      };
    }

    if (
      needsNetworkAuthority &&
      typeof this._bundledSkillNetworkAuthorityFactory === "function"
    ) {
      const authority = await this._bundledSkillNetworkAuthorityFactory({
        skillId: skill.skillId,
        task,
        context: executionContext,
        executionDecision,
      });
      if (!authority || typeof authority !== "object") {
        const error = new Error(
          `Network authority factory returned no policy for ${skill.skillId}`,
        );
        error.code = "CC_BUNDLED_SKILL_NETWORK_AUTHORITY_REQUIRED";
        throw error;
      }
      executionContext = {
        ...executionContext,
        networkBroker: authority.networkBroker || null,
        localServiceBroker: authority.localServiceBroker || null,
        networkDiagnosticsBroker: authority.networkDiagnosticsBroker || null,
      };
    }

    const selectedSkillDigest =
      executionSecurity?.contentDigest || fallbackSkillDigest(skill);
    const lifecycleMode = executionContext.skillLifecycleMode || "active";
    const attributionRequired = ["automatic-candidate", "canary"].includes(
      lifecycleMode,
    );
    const routerCandidates = Array.isArray(executionContext.routerCandidates)
      ? executionContext.routerCandidates
      : [
          {
            digest: selectedSkillDigest,
            score: 1,
            reason:
              executionContext.routerReason || "direct-registry-execution",
          },
        ];
    const invocationStart = startSkillInvocation({
      attributionRequired,
      evolutionRunId: executionContext.evolutionRunId,
      traceId: executionContext.traceId,
      trajectorySegmentId: executionContext.trajectorySegmentId,
      selectedSkillDigest,
      routerCandidates,
      providerModelVersion: executionContext.providerModelVersion,
      toolSetDigest: executionContext.toolSetDigest,
      osSandboxPermissionPolicyDigest:
        executionContext.osSandboxPermissionPolicyDigest,
      taskCohort: executionContext.taskCohort,
    });

    return {
      ...executionContext,
      __skillInvocationStart: invocationStart,
    };
  }

  async _executeWithHostAuthority(skill, task, context) {
    const executionContext = await this._prepareExecutionContext(
      skill,
      task,
      context,
    );
    return await skill.executeWithMetrics(task, executionContext);
  }

  // ==========================================
  // 自动加载
  // ==========================================

  /**
   * 自动加载内置技能
   */
  autoLoadBuiltinSkills() {
    if (!this.options.autoLoad) {
      return;
    }

    try {
      // 加载 Office Skill
      const { OfficeSkill } = require("./office-skill");
      this.register(new OfficeSkill());

      // 加载其他内置技能...
      // const { DataAnalysisSkill } = require('./data-analysis-skill');
      // this.register(new DataAnalysisSkill());

      this._log("内置技能已自动加载");
    } catch (error) {
      this._log(`自动加载内置技能失败: ${error.message}`, "error");
    }
  }

  // ==========================================
  // 事件监听
  // ==========================================

  /**
   * 附加技能事件监听器
   * @private
   */
  _attachSkillEventListeners(skill) {
    skill.on("skill-started", (data) => {
      this.emit("skill-started", data);
    });

    skill.on("skill-completed", (data) => {
      this.emit("skill-completed", data);
    });

    skill.on("skill-failed", (data) => {
      this.emit("skill-failed", data);
    });
  }

  // ==========================================
  // 统计和管理
  // ==========================================

  /**
   * 获取统计信息
   * @returns {Object}
   */
  getStats() {
    const skills = this.getAllSkills();
    const enabledSkills = this.getEnabledSkills();

    const totalMetrics = {
      invocations: 0,
      successes: 0,
      failures: 0,
      totalExecutionTime: 0,
    };

    for (const skill of skills) {
      totalMetrics.invocations += skill.metrics.invocations;
      totalMetrics.successes += skill.metrics.successes;
      totalMetrics.failures += skill.metrics.failures;
      totalMetrics.totalExecutionTime += skill.metrics.totalExecutionTime;
    }

    return {
      totalSkills: skills.length,
      enabledSkills: enabledSkills.length,
      disabledSkills: skills.length - enabledSkills.length,
      categories: this.categoryIndex.size,
      supportedFileTypes: this.fileTypeIndex.size,
      metrics: totalMetrics,
      successRate:
        totalMetrics.invocations > 0
          ? ((totalMetrics.successes / totalMetrics.invocations) * 100).toFixed(
              2,
            ) + "%"
          : "N/A",
    };
  }

  /**
   * 获取技能列表信息
   * @returns {Array}
   */
  getSkillList() {
    return this.getAllSkills().map((skill) => skill.getInfo());
  }

  /**
   * 重置所有技能指标
   */
  resetAllMetrics() {
    for (const skill of this.skills.values()) {
      skill.resetMetrics();
    }
    this._log("所有技能指标已重置");
  }

  /**
   * 日志输出
   * @private
   */
  _log(message, level = "info") {
    if (level === "error") {
      logger.error(`[SkillRegistry] ${message}`);
    } else if (level === "warn") {
      logger.warn(`[SkillRegistry] ${message}`);
    } else {
      logger.info(`[SkillRegistry] ${message}`);
    }
  }

  // ==========================================
  // API 兼容层（用于测试）
  // ==========================================

  /**
   * 查找最佳技能（别名：selectBestSkill）
   * @param {object} task - 任务对象
   * @returns {Promise<object>} 匹配结果
   */
  async findBestSkill(task) {
    const skill = await this.selectBestSkill(task);
    if (skill) {
      return {
        skill,
        score: skill.getScore ? skill.getScore(task) : 100,
      };
    }
    return null;
  }

  // ==========================================
  // 三层加载支持
  // ==========================================

  /**
   * 设置技能加载器
   * @param {SkillLoader} loader - 技能加载器实例
   */
  setLoader(loader) {
    this._loader = loader;

    // 监听加载器事件
    loader.on("skill-loaded", ({ layer, definition }) => {
      this.emit("skill-loaded", { layer, definition });
    });

    loader.on("skill-overridden", ({ skillName, oldSource, newSource }) => {
      this.emit("skill-overridden", { skillName, oldSource, newSource });
    });

    loader.on("load-error", ({ definition, error }) => {
      this.emit("load-error", { definition, error });
    });

    this._log("SkillLoader 已设置");
  }

  /**
   * 加载可信内建 Skill 和治理后的 active Skill
   * @returns {Promise<{loaded: number, registered: number, errors: Array}>}
   */
  async loadAllSkills() {
    if (!this._loader) {
      throw new Error("SkillLoader not set. Call setLoader() first.");
    }

    for (const skill of [...this.skills.values()]) {
      if (["marketplace", "managed", "workspace"].includes(skill.source)) {
        this.unregister(skill.skillId);
      }
    }
    const loadResult = await this._loader.loadBundledOnly();

    // 创建技能实例并注册
    const instances = this._loader.createSkillInstances();
    let registered = 0;

    for (const skill of instances) {
      try {
        this.register(skill);
        registered++;
      } catch (error) {
        this._log(`注册技能失败 ${skill.skillId}: ${error.message}`, "error");
        loadResult.errors.push({
          skillId: skill.skillId,
          error: error.message,
        });
      }
    }

    const governed = await this.loadGovernedActiveSkills();

    this._log(
      `可信技能加载完成: ${loadResult.loaded + governed.loaded} 加载, ${registered + governed.registered} 注册`,
    );

    return {
      loaded: loadResult.loaded + governed.loaded,
      registered: registered + governed.registered,
      activeAuthority: governed.authority,
      errors: loadResult.errors,
    };
  }

  /**
   * 按来源获取技能
   * @param {'bundled'|'managed'|'workspace'} source - 来源
   * @returns {Array<BaseSkill>}
   */
  getSkillsBySource(source) {
    return this.getAllSkills().filter((skill) => {
      // MarkdownSkill 有 source 属性
      return skill.source === source;
    });
  }

  /**
   * 获取用户可调用的技能
   * @returns {Array<BaseSkill>}
   */
  getUserInvocableSkills() {
    return this.getAllSkills().filter((skill) => {
      // MarkdownSkill 有 userInvocable 和 hidden 属性
      const isInvocable = skill.userInvocable !== false;
      const isHidden = skill.hidden === true;
      const isEnabled = skill.config?.enabled !== false;
      return isInvocable && !isHidden && isEnabled;
    });
  }

  /**
   * 获取技能定义（原始 SKILL.md 数据）
   * @param {string} skillId - 技能 ID
   * @returns {object|null}
   */
  getSkillDefinition(skillId) {
    const skill = this.skills.get(skillId);
    if (skill && typeof skill.getDefinition === "function") {
      return skill.getDefinition();
    }
    return null;
  }

  /**
   * 重新加载所有技能
   * @returns {Promise<object>}
   */
  async reloadAllSkills() {
    if (!this._loader) {
      throw new Error("SkillLoader not set. Call setLoader() first.");
    }

    // 注销所有现有技能
    for (const skillId of Array.from(this.skills.keys())) {
      this.unregister(skillId);
    }

    // 重新加载
    return await this.loadAllSkills();
  }

  /**
   * 获取三层目录信息
   * @returns {object|null}
   */
  getSkillSources() {
    if (!this._loader) {
      return null;
    }
    return this._loader.getLayerPaths();
  }
}

// 单例
let registryInstance = null;

/**
 * 获取技能注册表单例
 * @param {Object} options - 配置选项
 * @returns {SkillRegistry}
 */
function getSkillRegistry(options = {}) {
  if (!registryInstance) {
    registryInstance = new SkillRegistry(options);
  } else if (options.artifactActiveReleaseReader != null) {
    registryInstance.setArtifactActiveReleaseReader(
      options.artifactActiveReleaseReader,
    );
  }
  return registryInstance;
}

module.exports = { SkillRegistry, getSkillRegistry };
