package com.chainlesschain.android.feature.familyguard.data.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.Index
import androidx.room.PrimaryKey

/**
 * 复活码 (FAMILY-08).
 *
 * 主文档 §3.1 v0.2 紧急解绑通道: "配对时孩子端单独生成一个离线复活码 (6 位数字,
 * 存离线, 可记在小本本). 触发: 孩子端在登录页输入复活码 → 立刻 freeze 上行 +
 * 通知第三方". 防恶意滥用: 复活码连续错 3 次锁 24h。
 *
 * 安全模型:
 *   - 数据库本身已经走 SQLCipher (FAMILY-02), 即使 root 也是密文;
 *     但密文 + SHA256(salt+code) 双重保护, 防 SQLCipher key 泄露后 6 位数字
 *     被暴破 (10^6 = 1M, 现代 GPU 秒级跑完)。
 *   - salt 随机 16 字节 (CSPRNG), 每个 code 独立 salt, 防 rainbow table。
 *   - code 明文**永不**入表 / 不入 log / 不入 sync outbox; 仅在生成时返给
 *     UI 显示一次 (RevivalCodeDisplayCard), 用户记下即销毁内存引用。
 *
 * 状态机:
 *   - active: 可验证
 *   - consumed: 已成功验证一次 (紧急解绑触发) → consumed_at 写值, 不再可用
 *   - 锁定: locked_until > now → 验证 API 拒绝; failed_attempts ≥ 3 时设
 *
 * family_relationship_id 字段为 nullable: FAMILY-08 范围内可独立生成 (供 UI 测试);
 * FAMILY-13 配对流程接通后, Repository.generateNewCode(familyRelationshipId)
 * 会设置非 null 关联具体 family_relationship.
 */
@Entity(
    tableName = "revival_code",
    indices = [
        Index(value = ["family_relationship_id"]),
        Index(value = ["created_at"]),
    ],
)
data class RevivalCodeEntity(
    @PrimaryKey(autoGenerate = true)
    @ColumnInfo(name = "id")
    val id: Long = 0L,

    @ColumnInfo(name = "family_relationship_id")
    val familyRelationshipId: Long? = null,

    /** Hex-encoded SHA-256(salt || code), 64 字符. */
    @ColumnInfo(name = "code_hash")
    val codeHash: String,

    /** Hex-encoded 16-byte CSPRNG salt, 32 字符. */
    @ColumnInfo(name = "salt")
    val salt: String,

    @ColumnInfo(name = "created_at")
    val createdAt: Long,

    @ColumnInfo(name = "failed_attempts")
    val failedAttempts: Int = 0,

    /** 锁定到此 epoch ms; null 表示未锁。 */
    @ColumnInfo(name = "locked_until")
    val lockedUntil: Long? = null,

    /** 成功验证一次后写值 → consumed; null 表示仍可用。 */
    @ColumnInfo(name = "consumed_at")
    val consumedAt: Long? = null,
)
