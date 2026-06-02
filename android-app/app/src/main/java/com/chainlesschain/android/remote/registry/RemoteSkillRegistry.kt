package com.chainlesschain.android.remote.registry

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * 23 个 *Commands.kt 的统一注册表 + 风险分类（M1 [Android_REMOTE_commands_inventory] +
 * 设计文档 v0.2 §5.4 / ADR-8）。
 *
 * 启动流程：
 *  1. [RegistryStore.load] 从 disk 读最近一次同步的 metadata
 *  2. 若 disk 为空（首启 / 损坏），回退到 [SeedRegistry.SKILLS]
 *  3. 业务可通过 [updateFromRemote] 把桌面下发的更新合并进来 + 持久化
 *
 * UI 友好：
 *  - [skills] StateFlow 自动随更新刷新
 *  - [listByCategory] / [listByRisk] 用于设置页分组渲染
 *  - [requiresApproval] 给 sign/switchActive 类操作做 gate 决策
 *
 * 注意：当前 metadata 粒度是 **file 级**（namespace），桌面侧 M4 D2 落地后可能下发
 * **method 级**更细粒度数据。届时 [SkillMetadata] 会演进，本类需做迁移。
 */
@Singleton
class RemoteSkillRegistry @Inject constructor(
    private val store: RegistryStore,
) {

    private val byNamespace = mutableMapOf<String, SkillMetadata>()

    /** alias → canonical namespace 反查表（§8.3 1 版兼容窗口）。 */
    private val aliasIndex = mutableMapOf<String, String>()

    /**
     * Manifest signature verifier (forward-compat for ADR-8 amend, #21 A.3 AI-3).
     *
     * Default [LenientManifestVerifier.withoutTrustAnchor] — **verify-if-present**:
     *  - unsigned manifests (100% of current skills: SeedRegistry + desktop push)
     *    are accepted, so push-based [updateFromRemote] keeps working;
     *  - a manifest that *claims* a signature must verify — a forged or
     *    unverifiable signature is rejected rather than blindly accepted (which
     *    [NoOpManifestVerifier] used to do).
     *
     * This is strictly stronger than the old NoOp default with zero regression
     * for unsigned skills. Marketplace M0 (#21 A.3 AI-5) provisions a real
     * publisher pubkey + enforces signatures by injecting an
     * [Ed25519ManifestVerifier] (or a [LenientManifestVerifier] with a real trust
     * anchor) via [setManifestVerifier].
     */
    @Volatile
    private var manifestVerifier: ManifestSignatureVerifier =
        LenientManifestVerifier.withoutTrustAnchor()

    private val _skills = MutableStateFlow<List<SkillMetadata>>(emptyList())
    val skills: StateFlow<List<SkillMetadata>> = _skills.asStateFlow()

    private val _initialized = MutableStateFlow(false)
    val initialized: StateFlow<Boolean> = _initialized.asStateFlow()

    /**
     * Replace the manifest signature verifier (forward-compat #21 A.3 AI-3).
     * Defaults to [LenientManifestVerifier.withoutTrustAnchor] (verify-if-present,
     * no trust anchor); real Ed25519 / SLH-DSA hybrid verifier with a provisioned
     * publisher pubkey wires in when marketplace M0 lands.
     */
    fun setManifestVerifier(v: ManifestSignatureVerifier) {
        manifestVerifier = v
    }

    /**
     * 启动初始化：先尝试从 disk 加载；失败则使用 [SeedRegistry]。幂等。
     *
     * @return 实际生效的 source（"disk" / "seed"）
     */
    fun initialize(): Source {
        val loaded = store.load()
        val source: Source
        val effective = if (loaded.isEmpty()) {
            source = Source.Seed
            SeedRegistry.SKILLS
        } else {
            source = Source.Disk
            loaded
        }
        replaceAll(effective)
        _initialized.value = true
        Timber.i("RemoteSkillRegistry initialized: %d skills (source=%s)", effective.size, source)
        return source
    }

    /** 列出全部 skill。 */
    fun listAll(): List<SkillMetadata> = _skills.value

    /** 按 namespace 精确查找；若 namespace 未找到则按 alias 反查（§8.3 兼容窗口）。 */
    fun get(namespace: String): SkillMetadata? =
        byNamespace[namespace] ?: aliasIndex[namespace]?.let { byNamespace[it] }

    /** 把 alias 解析到 canonical namespace；不是 alias 则原样返回。 */
    fun resolveAlias(name: String): String = aliasIndex[name] ?: name

    /** 按类别筛选（如 "ai" / "system" / "data"）。 */
    fun listByCategory(category: String): List<SkillMetadata> =
        _skills.value.filter { it.category == category }

    /** 按风险等级筛选。 */
    fun listByRisk(risk: SkillRiskTag): List<SkillMetadata> =
        _skills.value.filter { it.risk == risk }

    /**
     * 是否需要 ApprovalUI 二次确认（namespace 级；alias 自动 resolve）。
     *
     * @return true 表示 UI 层必须在调用此 skill 前调起 ApprovalUI（带 BiometricPrompt
     * + 操作详情展示）；false 表示常规放行（仍需 Ed25519 签名）
     */
    fun requiresApproval(namespace: String): Boolean {
        return get(namespace)?.requiresApproval ?: true // 未知 skill 走保守路径
    }

    // ===== M4 D1 method-level accessors =====

    /**
     * 列出 namespace 下所有 method 元数据（alias 自动 resolve）。
     *
     * @return 空 list 表示 namespace 未找到 / methods 未播种（调用方应回退 namespace 级数据）
     */
    fun listMethods(namespace: String): List<MethodMetadata> =
        get(namespace)?.methods ?: emptyList()

    /**
     * 精确查找一个 method 的元数据（alias 自动 resolve）。
     *
     * @return null = namespace 未注册 / methods 未播种 / method 名不匹配。调用方应回退到
     *         namespace 级数据（[get] + [requiresApproval]）。
     */
    fun getMethod(namespace: String, methodName: String): MethodMetadata? =
        get(namespace)?.methods?.firstOrNull { it.name == methodName }

    /**
     * 是否需要 ApprovalUI 二次确认（method 级，优先级最高）。
     *
     * 决策顺序：
     *  1. method 的 [MethodMetadata.requiresApprovalOverride]（非 null）直接生效
     *  2. method 的 [MethodMetadata.riskOverride] 推导（Privileged → true）
     *  3. namespace 的 [SkillMetadata.requiresApproval]（兜底）
     *  4. namespace 未知 → true（保守路径）
     */
    fun requiresApprovalForMethod(namespace: String, methodName: String): Boolean {
        val skill = get(namespace) ?: return true
        val method = skill.methods.firstOrNull { it.name == methodName }
        method?.requiresApprovalOverride?.let { return it }
        method?.riskOverride?.let { return it == SkillRiskTag.Privileged }
        return skill.requiresApproval
    }

    /**
     * Method 级 risk 解析。同上 fallback 顺序，但只看 risk（不看 approval）；alias 自动 resolve。
     */
    fun riskForMethod(namespace: String, methodName: String): SkillRiskTag {
        val skill = get(namespace) ?: return SkillRiskTag.Privileged
        val method = skill.methods.firstOrNull { it.name == methodName }
        return method?.riskOverride ?: skill.risk
    }

    /**
     * 桌面下发更新合并：
     *  - 同 namespace 的 entry 替换为新版
     *  - 新增的 entry 加入
     *  - 旧 disk 中存在但 [newSkills] 缺失的 entry **保留**（避免桌面侧偶发性漏发覆盖本地）
     *
     * @return 合并后的总数
     */
    fun updateFromRemote(newSkills: List<SkillMetadata>): Int {
        if (newSkills.isEmpty()) {
            Timber.w("updateFromRemote called with empty list, ignoring")
            return byNamespace.size
        }
        // Manifest signature gate (forward-compat #21 A.3 AI-3). The default
        // LenientManifestVerifier accepts unsigned manifests (current state) but
        // rejects a manifest that claims an unverifiable signature; the real
        // verifier (post-marketplace M0) will additionally require signatures.
        // Rejected skills are skipped + logged rather than failing the whole
        // update — partial-acceptance is the safer default for a verifier whose
        // policy may evolve.
        val accepted = mutableListOf<SkillMetadata>()
        val rejected = mutableListOf<Pair<String, String>>()
        for (skill in newSkills) {
            when (val result = manifestVerifier.verify(skill)) {
                is VerificationResult.Accepted -> accepted.add(skill)
                is VerificationResult.Rejected ->
                    rejected.add(skill.namespace to result.reason)
            }
        }
        if (rejected.isNotEmpty()) {
            Timber.w(
                "updateFromRemote rejected %d skill(s) by manifest verifier: %s",
                rejected.size,
                rejected,
            )
        }
        if (accepted.isEmpty()) {
            // Verifier rejected everything — don't churn store / state.
            return byNamespace.size
        }
        accepted.forEach { byNamespace[it.namespace] = it }
        val merged = byNamespace.values.toList()
        replaceAll(merged)
        store.save(merged)
        Timber.i(
            "Registry updated from remote: +%d accepted, %d rejected, total=%d",
            accepted.size,
            rejected.size,
            merged.size,
        )
        return merged.size
    }

    /**
     * 完全重置到 [SeedRegistry]（测试 / 用户主动清缓存）。清掉 disk 副本。
     */
    fun resetToSeed() {
        store.clear()
        replaceAll(SeedRegistry.SKILLS)
        Timber.i("Registry reset to seed")
    }

    private fun replaceAll(skills: List<SkillMetadata>) {
        byNamespace.clear()
        aliasIndex.clear()
        skills.forEach { skill ->
            byNamespace[skill.namespace] = skill
            for (alias in skill.aliases) {
                aliasIndex[alias] = skill.namespace
            }
        }
        _skills.value = skills
    }

    enum class Source { Disk, Seed }
}
