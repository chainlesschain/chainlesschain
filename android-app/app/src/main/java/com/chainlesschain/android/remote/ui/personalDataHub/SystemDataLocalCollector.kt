package com.chainlesschain.android.remote.ui.personalDataHub

import android.Manifest
import android.content.ContentResolver
import android.content.Context
import android.content.pm.PackageManager
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import timber.log.Timber
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Path C — 本机采集器，把 ContentResolver 通讯录 + PackageManager 已装 app 列表
 * 序列化为 `personal-data-hub/lib/adapters/system-data-android` adapter 期望的
 * snapshot JSON 形状 (schemaVersion=1)。
 *
 * 为什么不调 JNI 桥？A6 native binding 还没 ship，但 Kotlin 直接调
 * ContentResolver/PackageManager 完全 OK——这就是 snapshot-file 模式存在的理由。
 * 调用方拼好 Snapshot 后发到桌面，桌面写 staging 文件 → 既有 `inputPath` 路径
 * 接住，与 v0.1 design (`pdh-plan-a-android-standalone-design`) §4 一致。
 *
 * READ_CONTACTS runtime 未授权时，contacts 列表返回空但 app 列表照常返回 ——
 * 不抛异常，让用户能至少看到已装 app 数据。
 */
@Singleton
class SystemDataLocalCollector @Inject constructor(
    @ApplicationContext private val context: Context
) {

    /** 与 `system-data-android` adapter 的 SNAPSHOT_SCHEMA_VERSION 同步。 */
    val schemaVersion: Int get() = SCHEMA_VERSION

    /**
     * 拼出 snapshot；不写盘，由调用方负责把 [Map] 发到桌面。
     */
    fun snapshot(): Snapshot {
        val contacts = if (hasContactsPermission()) {
            try {
                queryContacts()
            } catch (e: SecurityException) {
                Timber.w(e, "queryContacts: SecurityException (manifest declared but runtime denied?)")
                emptyList()
            } catch (e: Exception) {
                Timber.w(e, "queryContacts: unexpected failure")
                emptyList()
            }
        } else {
            emptyList()
        }
        val apps = try {
            listApps()
        } catch (e: Exception) {
            Timber.w(e, "listApps: unexpected failure")
            emptyList()
        }
        return Snapshot(
            schemaVersion = SCHEMA_VERSION,
            snapshottedAt = System.currentTimeMillis(),
            contacts = contacts,
            apps = apps,
        )
    }

    private fun hasContactsPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED

    private fun queryContacts(): List<Contact> {
        val resolver: ContentResolver = context.contentResolver
        // 主表：CONTACT_ID + display name + lookup key + starred
        val mainCursor = resolver.query(
            ContactsContract.Contacts.CONTENT_URI,
            arrayOf(
                ContactsContract.Contacts._ID,
                ContactsContract.Contacts.LOOKUP_KEY,
                ContactsContract.Contacts.DISPLAY_NAME,
                ContactsContract.Contacts.STARRED,
                ContactsContract.Contacts.PHOTO_URI,
            ),
            null, null,
            ContactsContract.Contacts.SORT_KEY_PRIMARY,
        ) ?: return emptyList()

        val byId = mutableMapOf<Long, MutableContact>()
        mainCursor.use { c ->
            val idIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts._ID)
            val lookupIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.LOOKUP_KEY)
            val nameIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.DISPLAY_NAME)
            val starIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.STARRED)
            val photoIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.PHOTO_URI)
            while (c.moveToNext()) {
                val id = c.getLong(idIdx)
                val lookupKey = c.getString(lookupIdx) ?: ""
                if (lookupKey.isEmpty()) continue
                val name = c.getString(nameIdx) ?: ""
                val starred = c.getInt(starIdx) == 1
                val photoUri = c.getString(photoIdx)
                byId[id] = MutableContact(
                    lookupKey = lookupKey,
                    displayName = name,
                    starred = starred,
                    photoUri = photoUri,
                )
            }
        }
        if (byId.isEmpty()) return emptyList()

        // Phones — 一对多，1 contact 可能多个号码
        attachPhones(resolver, byId)
        // Emails
        attachEmails(resolver, byId)
        // Organization — 取第一条
        attachOrganization(resolver, byId)

        return byId.values.map { it.toImmutable() }
    }

    private fun attachPhones(resolver: ContentResolver, byId: MutableMap<Long, MutableContact>) {
        val ids = byId.keys.joinToString(",")
        if (ids.isEmpty()) return
        resolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Phone.CONTACT_ID,
                ContactsContract.CommonDataKinds.Phone.NUMBER,
            ),
            "${ContactsContract.CommonDataKinds.Phone.CONTACT_ID} IN ($ids)",
            null, null,
        )?.use { c ->
            val idIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.CONTACT_ID)
            val numIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (c.moveToNext()) {
                val id = c.getLong(idIdx)
                val number = c.getString(numIdx)?.trim() ?: continue
                if (number.isEmpty()) continue
                byId[id]?.phones?.add(number)
            }
        }
    }

    private fun attachEmails(resolver: ContentResolver, byId: MutableMap<Long, MutableContact>) {
        val ids = byId.keys.joinToString(",")
        if (ids.isEmpty()) return
        resolver.query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Email.CONTACT_ID,
                ContactsContract.CommonDataKinds.Email.ADDRESS,
            ),
            "${ContactsContract.CommonDataKinds.Email.CONTACT_ID} IN ($ids)",
            null, null,
        )?.use { c ->
            val idIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.CONTACT_ID)
            val addrIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.ADDRESS)
            while (c.moveToNext()) {
                val id = c.getLong(idIdx)
                val addr = c.getString(addrIdx)?.trim() ?: continue
                if (addr.isEmpty()) continue
                byId[id]?.emails?.add(addr)
            }
        }
    }

    private fun attachOrganization(resolver: ContentResolver, byId: MutableMap<Long, MutableContact>) {
        val ids = byId.keys.joinToString(",")
        if (ids.isEmpty()) return
        resolver.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(
                ContactsContract.Data.CONTACT_ID,
                ContactsContract.CommonDataKinds.Organization.COMPANY,
                ContactsContract.CommonDataKinds.Organization.TITLE,
            ),
            "${ContactsContract.Data.CONTACT_ID} IN ($ids) AND ${ContactsContract.Data.MIMETYPE} = ?",
            arrayOf(ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE),
            null,
        )?.use { c ->
            val idIdx = c.getColumnIndexOrThrow(ContactsContract.Data.CONTACT_ID)
            val orgIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Organization.COMPANY)
            val titleIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Organization.TITLE)
            while (c.moveToNext()) {
                val id = c.getLong(idIdx)
                val target = byId[id] ?: continue
                val org = c.getString(orgIdx)?.trim()
                if (target.organization == null && !org.isNullOrEmpty()) {
                    target.organization = org
                }
                val jobTitle = c.getString(titleIdx)?.trim()
                if (target.jobTitle == null && !jobTitle.isNullOrEmpty()) {
                    target.jobTitle = jobTitle
                }
            }
        }
    }

    private fun listApps(): List<AppInfo> {
        val pm = context.packageManager
        // GET_META_DATA 让 firstInstallTime/lastUpdateTime 有数据；on Android 11+
        // visibility 限制让非 Q_ALL_PACKAGES 的 app 看不到所有包，但用户**自己装**的
        // 仍可见——这正是采集所需。
        val installed = pm.getInstalledApplications(PackageManager.GET_META_DATA)
        val isSystemFlag = android.content.pm.ApplicationInfo.FLAG_SYSTEM
        return installed.mapNotNull { app ->
            try {
                val pkgName = app.packageName ?: return@mapNotNull null
                val pkgInfo = pm.getPackageInfo(pkgName, 0)
                val label = pm.getApplicationLabel(app).toString()
                val versionName = pkgInfo.versionName
                @Suppress("DEPRECATION")
                val versionCode = pkgInfo.versionCode
                AppInfo(
                    packageName = pkgName,
                    label = label,
                    versionName = versionName,
                    versionCode = versionCode,
                    firstInstallTime = pkgInfo.firstInstallTime,
                    lastUpdateTime = pkgInfo.lastUpdateTime,
                    isSystem = (app.flags and isSystemFlag) != 0,
                )
            } catch (e: PackageManager.NameNotFoundException) {
                Timber.v("listApps: skip %s (NameNotFoundException)", app.packageName)
                null
            } catch (e: Exception) {
                Timber.v(e, "listApps: skip %s", app.packageName)
                null
            }
        }
    }

    companion object {
        const val SCHEMA_VERSION = 1
    }
}

/**
 * Snapshot 形状必须与 `packages/personal-data-hub/lib/adapters/system-data-android/adapter.js`
 * 的 SNAPSHOT_SCHEMA_VERSION + `snapshot.contacts[]` / `snapshot.apps[]` 字段 1:1 对应。
 * 桌面 adapter `_syncViaSnapshot()` 直接读这些键。
 */
data class Snapshot(
    val schemaVersion: Int,
    val snapshottedAt: Long,
    val contacts: List<Contact>,
    val apps: List<AppInfo>,
) {
    fun toMap(): Map<String, Any> = mapOf(
        "schemaVersion" to schemaVersion,
        "snapshottedAt" to snapshottedAt,
        "contacts" to contacts.map { it.toMap() },
        "apps" to apps.map { it.toMap() },
    )
}

data class Contact(
    val lookupKey: String,
    val displayName: String,
    val phones: List<String>,
    val emails: List<String>,
    val starred: Boolean,
    val organization: String?,
    val photoUri: String?,
    val jobTitle: String? = null,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "lookupKey" to lookupKey,
        "displayName" to displayName,
        "phones" to phones,
        "emails" to emails,
        "starred" to starred,
        "organization" to organization,
        "photoUri" to photoUri,
        "jobTitle" to jobTitle,
    )
}

data class AppInfo(
    val packageName: String,
    val label: String,
    val versionName: String?,
    val versionCode: Int,
    val firstInstallTime: Long,
    val lastUpdateTime: Long,
    val isSystem: Boolean,
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "packageName" to packageName,
        "label" to label,
        "versionName" to versionName,
        "versionCode" to versionCode,
        "firstInstallTime" to firstInstallTime,
        "lastUpdateTime" to lastUpdateTime,
        "isSystem" to isSystem,
    )
}

private class MutableContact(
    val lookupKey: String,
    val displayName: String,
    val starred: Boolean,
    val photoUri: String?,
    val phones: MutableList<String> = mutableListOf(),
    val emails: MutableList<String> = mutableListOf(),
    var organization: String? = null,
    var jobTitle: String? = null,
) {
    fun toImmutable(): Contact = Contact(
        lookupKey = lookupKey,
        displayName = displayName,
        phones = phones.distinct(),
        emails = emails.distinct(),
        starred = starred,
        organization = organization,
        photoUri = photoUri,
        jobTitle = jobTitle,
    )
}
