package com.chainlesschain.android.feature.familyguard.fixtures

import com.chainlesschain.android.core.database.entity.social.FriendEntity
import com.chainlesschain.android.core.database.entity.social.FriendStatus
import com.chainlesschain.android.feature.familyguard.data.entity.EnforceRuleEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyGroupEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyMembershipEntity
import com.chainlesschain.android.feature.familyguard.data.entity.FamilyRelationshipEntity
import com.chainlesschain.android.feature.familyguard.data.entity.GeofenceEntity
import com.chainlesschain.android.feature.familyguard.data.entity.LocationPointEntity
import com.chainlesschain.android.feature.familyguard.data.entity.RevivalCodeEntity
import com.chainlesschain.android.feature.familyguard.data.entity.SosEventEntity
import com.chainlesschain.android.feature.familyguard.domain.model.FamilyFriend
import java.time.Clock
import java.time.Instant
import java.time.ZoneOffset

/**
 * 测试 fixture 工厂 (FAMILY-09).
 *
 * 中央化构造方法, 替代散落在每个测试 file 内的 ad-hoc builder。设计原则:
 *   1. **确定性**: 不读 `System.currentTimeMillis()` / 不调 random; 默认值都是
 *      stable 常量, 让断言可以硬编。
 *   2. **可重写**: 每字段都有 named default + Kotlin named-arg override; 测试只
 *      需写偏离默认的字段, 减少噪音。
 *   3. **联动 ID**: child / parent / relationship / group 间的 fk 用统一
 *      [FIXTURE_GROUP_ID] / [FIXTURE_CHILD_DID] / [FIXTURE_PARENT_DID]; 引用
 *      不同 group 时显式传 groupId。
 *   4. **零业务规则**: fixture 不验输入合法性 (e.g. 不检查 role ∈ {parent|child|
 *      guardian}); 业务规则由 production code 保证, fixture 服务于"测错误状态"。
 *
 * 对齐 [[android_phase_6_quarantine_infra]] — feature module 内 fixture 而非
 * :core-test-helpers, 因 family-guard 表 schema 不是 cross-module 复用。
 */
object FamilyFixtures {

    // ─── 稳定常量 (覆盖 80% 场景) ───

    const val FIXTURE_GROUP_ID = "fix-grp-0001"
    const val FIXTURE_GROUP_NAME = "测试家庭"
    const val FIXTURE_PRIMARY_DID = "did:chain:primary-parent"
    const val FIXTURE_PARENT_DID = "did:chain:test-parent"
    const val FIXTURE_CHILD_DID = "did:chain:test-child"
    const val FIXTURE_GUARDIAN_DID = "did:chain:test-guardian"
    const val FIXTURE_DEVICE_ID = "fix-device-0001"
    const val FIXTURE_CHILD_DEVICE_ID = "fix-device-child"
    const val FIXTURE_TIME_MS: Long = 1_700_000_000_000L // 2023-11-14T22:13:20Z
    const val FIXTURE_PERMISSIONS_JSON: String = """{"telemetry_level":"L1"}"""

    /** Fixed-clock helper; UTC, 默认指向 [FIXTURE_TIME_MS]. */
    fun fakeClock(epochMs: Long = FIXTURE_TIME_MS): Clock =
        Clock.fixed(Instant.ofEpochMilli(epochMs), ZoneOffset.UTC)

    // ─── FamilyGroup ───

    fun fakeFamilyGroup(
        id: String = FIXTURE_GROUP_ID,
        name: String = FIXTURE_GROUP_NAME,
        primaryDid: String = FIXTURE_PRIMARY_DID,
        createdAt: Long = FIXTURE_TIME_MS,
        metadataJson: String? = null,
    ): FamilyGroupEntity = FamilyGroupEntity(
        id = id,
        name = name,
        primaryDid = primaryDid,
        createdAt = createdAt,
        metadataJson = metadataJson,
    )

    // ─── FamilyMembership (parent / child / guardian 各一个 helper) ───

    fun fakeParent(
        id: Long = 0L,
        familyGroupId: String = FIXTURE_GROUP_ID,
        memberDid: String = FIXTURE_PARENT_DID,
        guardianTier: String? = "primary",
        deviceId: String = FIXTURE_DEVICE_ID,
        joinedAt: Long = FIXTURE_TIME_MS,
        status: String = "active",
    ): FamilyMembershipEntity = FamilyMembershipEntity(
        id = id,
        familyGroupId = familyGroupId,
        memberDid = memberDid,
        role = "parent",
        guardianTier = guardianTier,
        deviceId = deviceId,
        joinedAt = joinedAt,
        status = status,
    )

    fun fakeChild(
        id: Long = 0L,
        familyGroupId: String = FIXTURE_GROUP_ID,
        memberDid: String = FIXTURE_CHILD_DID,
        deviceId: String = FIXTURE_CHILD_DEVICE_ID,
        joinedAt: Long = FIXTURE_TIME_MS,
        status: String = "active",
    ): FamilyMembershipEntity = FamilyMembershipEntity(
        id = id,
        familyGroupId = familyGroupId,
        memberDid = memberDid,
        role = "child",
        guardianTier = null,
        deviceId = deviceId,
        joinedAt = joinedAt,
        status = status,
    )

    fun fakeGuardian(
        id: Long = 0L,
        familyGroupId: String = FIXTURE_GROUP_ID,
        memberDid: String = FIXTURE_GUARDIAN_DID,
        guardianTier: String? = "secondary",
        deviceId: String = FIXTURE_DEVICE_ID,
        joinedAt: Long = FIXTURE_TIME_MS,
        status: String = "active",
    ): FamilyMembershipEntity = FamilyMembershipEntity(
        id = id,
        familyGroupId = familyGroupId,
        memberDid = memberDid,
        role = "guardian",
        guardianTier = guardianTier,
        deviceId = deviceId,
        joinedAt = joinedAt,
        status = status,
    )

    // ─── FamilyRelationship (默认 parent 看 child) ───

    fun fakeRelationship(
        id: Long = 0L,
        familyGroupId: String = FIXTURE_GROUP_ID,
        friendDid: String = FIXTURE_CHILD_DID,
        roleSelf: String = "parent",
        roleOther: String = "child",
        guardianTierOther: String? = null,
        boundAt: Long = FIXTURE_TIME_MS,
        boundEvidence: String? = null,
        permissions: String = FIXTURE_PERMISSIONS_JSON,
        emergencyContacts: String? = null,
        unbindRequestAt: Long? = null,
        unbindCooldownUntil: Long? = null,
        unbindRequester: String? = null,
        emergencyUnbindAt: Long? = null,
        emergencyUnbindReason: String? = null,
        status: String = "active",
        createdAt: Long = FIXTURE_TIME_MS,
        updatedAt: Long = FIXTURE_TIME_MS,
    ): FamilyRelationshipEntity = FamilyRelationshipEntity(
        id = id,
        familyGroupId = familyGroupId,
        friendDid = friendDid,
        roleSelf = roleSelf,
        roleOther = roleOther,
        guardianTierOther = guardianTierOther,
        boundAt = boundAt,
        boundEvidence = boundEvidence,
        permissions = permissions,
        emergencyContacts = emergencyContacts,
        unbindRequestAt = unbindRequestAt,
        unbindCooldownUntil = unbindCooldownUntil,
        unbindRequester = unbindRequester,
        emergencyUnbindAt = emergencyUnbindAt,
        emergencyUnbindReason = emergencyUnbindReason,
        status = status,
        createdAt = createdAt,
        updatedAt = updatedAt,
    )

    // ─── SosEvent ───

    fun fakeSosEvent(
        id: String = "fix-sos-0001",
        childDid: String = FIXTURE_CHILD_DID,
        familyGroupId: String = FIXTURE_GROUP_ID,
        triggeredAt: Long = FIXTURE_TIME_MS,
        triggerSource: String = "in_app",
        locationSnapshot: String? = null,
        audioRecordingRef: String? = null,
        status: String = "pending",
        acknowledgedBy: String? = null,
        acknowledgedAt: Long? = null,
        resolvedAt: Long? = null,
        resolutionNote: String? = null,
        cancelledAt: Long? = null,
        cancelReason: String? = null,
    ): SosEventEntity = SosEventEntity(
        id = id,
        childDid = childDid,
        familyGroupId = familyGroupId,
        triggeredAt = triggeredAt,
        triggerSource = triggerSource,
        locationSnapshot = locationSnapshot,
        audioRecordingRef = audioRecordingRef,
        status = status,
        acknowledgedBy = acknowledgedBy,
        acknowledgedAt = acknowledgedAt,
        resolvedAt = resolvedAt,
        resolutionNote = resolutionNote,
        cancelledAt = cancelledAt,
        cancelReason = cancelReason,
    )

    // ─── LocationPoint ───

    fun fakeLocationPoint(
        id: Long = 0L,
        childDid: String = FIXTURE_CHILD_DID,
        deviceId: String = FIXTURE_CHILD_DEVICE_ID,
        latitude: Double = 31.23,    // 上海, stable test 坐标
        longitude: Double = 121.47,
        accuracyM: Double? = 10.0,
        altitudeM: Double? = null,
        speedMps: Double? = null,
        source: String = "gps",
        timestamp: Long = FIXTURE_TIME_MS,
        batteryPct: Int? = 80,
    ): LocationPointEntity = LocationPointEntity(
        id = id,
        childDid = childDid,
        deviceId = deviceId,
        latitude = latitude,
        longitude = longitude,
        accuracyM = accuracyM,
        altitudeM = altitudeM,
        speedMps = speedMps,
        source = source,
        timestamp = timestamp,
        batteryPct = batteryPct,
    )

    // ─── Geofence ───

    fun fakeGeofence(
        id: String = "fix-geofence-home",
        familyGroupId: String = FIXTURE_GROUP_ID,
        name: String = "家",
        kind: String = "home",
        latitude: Double = 31.23,
        longitude: Double = 121.47,
        radiusM: Int = 100,
        schedule: String? = null,
        expectedArrival: String? = null,
        onEnterAction: String = "silent",
        onExitAction: String = "notify_parent",
        onLateAction: String = "notify_parent",
        active: Boolean = true,
    ): GeofenceEntity = GeofenceEntity(
        id = id,
        familyGroupId = familyGroupId,
        name = name,
        kind = kind,
        latitude = latitude,
        longitude = longitude,
        radiusM = radiusM,
        schedule = schedule,
        expectedArrival = expectedArrival,
        onEnterAction = onEnterAction,
        onExitAction = onExitAction,
        onLateAction = onLateAction,
        active = active,
    )

    // ─── EnforceRule ───

    fun fakeEnforceRule(
        id: Long = 0L,
        ruleType: String = "app_time_limit",
        target: String = "com.tencent.tmgp.sgame",
        config: String = """{"daily_max_sec":3600}""",
        enforceLevel: Int = 1,
        active: Boolean = true,
        sourceDid: String = FIXTURE_PARENT_DID,
        sourcePriority: Int = 1, // primary
        createdAt: Long = FIXTURE_TIME_MS,
    ): EnforceRuleEntity = EnforceRuleEntity(
        id = id,
        ruleType = ruleType,
        target = target,
        config = config,
        enforceLevel = enforceLevel,
        active = active,
        sourceDid = sourceDid,
        sourcePriority = sourcePriority,
        createdAt = createdAt,
    )

    // ─── RevivalCode ───

    fun fakeRevivalCode(
        id: Long = 0L,
        familyRelationshipId: Long? = null,
        codeHash: String = "fix-hash-" + "0".repeat(56), // 64 hex
        salt: String = "fix-salt-" + "0".repeat(24),     // 32 hex
        createdAt: Long = FIXTURE_TIME_MS,
        failedAttempts: Int = 0,
        lockedUntil: Long? = null,
        consumedAt: Long? = null,
    ): RevivalCodeEntity = RevivalCodeEntity(
        id = id,
        familyRelationshipId = familyRelationshipId,
        codeHash = codeHash,
        salt = salt,
        createdAt = createdAt,
        failedAttempts = failedAttempts,
        lockedUntil = lockedUntil,
        consumedAt = consumedAt,
    )

    // ─── FriendEntity (来自 :core-database) — FAMILY-03 join 用 ───

    fun fakeFriend(
        did: String = FIXTURE_CHILD_DID,
        nickname: String = "小明",
        avatar: String? = null,
        bio: String? = null,
        remarkName: String? = null,
        groupId: String? = null,
        addedAt: Long = FIXTURE_TIME_MS,
        status: FriendStatus = FriendStatus.ACCEPTED,
        isBlocked: Boolean = false,
        lastActiveAt: Long? = null,
        metadata: String? = null,
    ): FriendEntity = FriendEntity(
        did = did,
        nickname = nickname,
        avatar = avatar,
        bio = bio,
        remarkName = remarkName,
        groupId = groupId,
        addedAt = addedAt,
        status = status,
        isBlocked = isBlocked,
        lastActiveAt = lastActiveAt,
        metadata = metadata,
    )

    // ─── FamilyFriend wrapper (domain) — FAMILY-03 ───

    fun fakeFamilyFriend(
        friend: FriendEntity = fakeFriend(),
        relationship: FamilyRelationshipEntity = fakeRelationship(),
    ): FamilyFriend = FamilyFriend(friend = friend, relationship = relationship)
}
