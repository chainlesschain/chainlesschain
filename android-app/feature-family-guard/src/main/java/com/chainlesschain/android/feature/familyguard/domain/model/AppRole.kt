package com.chainlesschain.android.feature.familyguard.domain.model

/**
 * 用户在 family-guard 中扮演的角色 (FAMILY-04)。
 *
 * "家庭模式" 同一 app 通过首启选择分裂出家长 / 孩子端 UI; 选定后 24h 锁
 * (防误选)。详见主文档 §3.1。
 *
 * 注意区分:
 *   - [AppRole] = 本机 (这台设备) 的扮演角色 (家长 vs 孩子)。
 *   - family_membership.role = 在某个 family_group 内的关系角色
 *     ('parent' | 'child' | 'guardian'); 一个 AppRole.PARENT 可在多个 group
 *     里同时扮演 parent 或 secondary guardian。
 *
 * 'guardian' 不出现在首启选择里 —— 它是 'parent' 的子类型 (爷爷奶奶 secondary),
 * 由配对流程 (FAMILY-13) 在 family_membership 表中标记。
 */
enum class AppRole {
    /** 家长端: 看孩子 telemetry / 接 SOS / 派任务 / 编规则 */
    PARENT,

    /** 孩子端: 受监管, 显持久通知 + 锁屏 SOS 按钮 + 陪学 AI tab */
    CHILD,
}
