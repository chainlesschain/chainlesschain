package com.chainlesschain.android.feature.familyguard.domain.repository

import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCode
import com.chainlesschain.android.feature.familyguard.domain.model.RevivalCodeVerification

/**
 * 复活码仓库 (FAMILY-08).
 *
 * 验收准则:
 *   1. generateNewCode() 用 CSPRNG; 同时调 100 次返 100 distinct 值 (统计意义)
 *   2. verify(code) 正确 → Success; 错 → WrongCode 剩余次数递减
 *   3. 累计 3 次错 → LockedOut 锁 24h
 *   4. 锁中再验 → 仍返 LockedOut, 不递增 failed_attempts (防加锁延长)
 *   5. Success 后即 markConsumed; 再次 verify(同 code) → AlreadyConsumed
 *
 * familyRelationshipId 在 FAMILY-08 范围内 nullable (允许独立生成测试),
 * FAMILY-13 配对流程接通后传入具体 id。
 */
interface RevivalCodeRepository {

    /**
     * 生成新复活码 + 持久 hash + salt. 返回**明文**给 UI 一次性显示;
     * 用完即让出引用, 不缓存。
     *
     * @return 新生成的 6 位数字 [RevivalCode]
     */
    suspend fun generateNewCode(familyRelationshipId: Long? = null): RevivalCode

    /** 验证用户输入. 调用方解析结果决定 UI 提示 + 紧急解绑流程触发 (FAMILY-16)。 */
    suspend fun verify(input: RevivalCode): RevivalCodeVerification

    /** 是否当前存在 active (未 consumed) 复活码; UI 判断"是否进入显示卡". */
    suspend fun hasActiveCode(): Boolean

    /** 仅 admin / 测试入口; v0.1 UI 不调。FAMILY-08 用于"清除测试残留"。 */
    suspend fun clearAll()
}
