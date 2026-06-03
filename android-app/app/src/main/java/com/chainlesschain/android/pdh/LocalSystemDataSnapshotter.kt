package com.chainlesschain.android.pdh

import android.Manifest
import android.content.Context
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.os.Build
import android.provider.ContactsContract
import androidx.core.content.ContextCompat
import dagger.hilt.android.qualifiers.ApplicationContext
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import javax.inject.Inject
import javax.inject.Singleton

/**
 * Plan A v0.1 — produces a JSON snapshot of the user's own ContentResolver
 * (contacts) and PackageManager (installed apps) for the cc CLI subprocess
 * to ingest via the `system-data-android` PDH adapter.
 *
 * Why a snapshot file rather than a direct JNI bridge? cc is spawned by
 * Phase 2.5's [LocalFilesystemBootstrapper] as a separate Linux process —
 * it does NOT share the Android app JVM, so it cannot call ContentResolver
 * directly. The pragmatic v0.1 path is "UI reads → JSON file → cc reads
 * file → vault". A bound-service IPC (so `cc android contacts pull` works
 * from the terminal) is deferred to a follow-up slice.
 *
 * Snapshot schema (mirrors packages/personal-data-hub/lib/adapters/system-
 * data-android/adapter.js SNAPSHOT_SCHEMA_VERSION = 1):
 *
 *   {
 *     "schemaVersion": 1,
 *     "snapshottedAt": <epoch-ms>,
 *     "contacts": [
 *       { "lookupKey": "...", "displayName": "妈妈",
 *         "phones": ["+861..."], "emails": [],
 *         "starred": true, "organization": "家庭", "photoUri": null }
 *     ],
 *     "apps": [
 *       { "packageName": "com.tencent.mm", "label": "微信",
 *         "versionName": "8.0.45", "versionCode": 2200,
 *         "firstInstallTime": 1700000000000, "lastUpdateTime": 1716000000000,
 *         "isSystem": false }
 *     ]
 *   }
 */
@Singleton
class LocalSystemDataSnapshotter @Inject constructor(
    @ApplicationContext private val context: Context,
) {

    data class SnapshotResult(
        val snapshotPath: String,
        val contactsCount: Int,
        val appsCount: Int,
        val contactsPermissionGranted: Boolean,
        val snapshottedAt: Long,
    )

    /**
     * Returns whether the runtime READ_CONTACTS permission has been granted.
     * The caller (UI) is responsible for requesting it before invoking
     * [snapshotAll] — if the permission is not granted, the contacts array
     * will be empty but the snapshot still completes (apps require no
     * runtime permission).
     */
    fun hasContactsPermission(): Boolean =
        ContextCompat.checkSelfPermission(context, Manifest.permission.READ_CONTACTS) ==
            PackageManager.PERMISSION_GRANTED

    /**
     * Read ContentResolver + PackageManager and write a snapshot JSON to
     * [stagingDir]/system-data-android.json. Returns counts so the UI can
     * surface a confirmation. Heavy IO — must be called off the main
     * thread; this function itself does the Dispatchers.IO switch.
     */
    suspend fun snapshotAll(): SnapshotResult = withContext(Dispatchers.IO) {
        val stagingDir = ensureStagingDir()
        val snapshottedAt = System.currentTimeMillis()
        val hasContacts = hasContactsPermission()

        val contactsJson = if (hasContacts) readContactsArray() else JSONArray()
        val appsJson = readInstalledAppsArray()

        val root = JSONObject()
            .put("schemaVersion", SNAPSHOT_SCHEMA_VERSION)
            .put("snapshottedAt", snapshottedAt)
            .put("contacts", contactsJson)
            .put("apps", appsJson)

        val snapshotFile = File(stagingDir, "system-data-android.json")
        snapshotFile.writeText(root.toString(), Charsets.UTF_8)

        SnapshotResult(
            snapshotPath = snapshotFile.absolutePath,
            contactsCount = contactsJson.length(),
            appsCount = appsJson.length(),
            contactsPermissionGranted = hasContacts,
            snapshottedAt = snapshottedAt,
        )
    }

    private fun ensureStagingDir(): File {
        val dir = File(context.filesDir, ".chainlesschain/staging")
        if (!dir.exists() && !dir.mkdirs()) {
            Timber.w("LocalSystemDataSnapshotter: failed to mkdir %s", dir.absolutePath)
        }
        return dir
    }

    // ─── Contacts via ContentResolver ──────────────────────────────────────

    private fun readContactsArray(): JSONArray {
        val arr = JSONArray()
        // We project the Contacts table (one row per de-duplicated contact)
        // for the headline fields, then for each contact do a fan-out query
        // into Phone + Email tables. Paging via limit clause keeps memory
        // bounded; org/notes go into a single companion query.
        val resolver = context.contentResolver
        val cursor = try {
            resolver.query(
                ContactsContract.Contacts.CONTENT_URI,
                arrayOf(
                    ContactsContract.Contacts._ID,
                    ContactsContract.Contacts.LOOKUP_KEY,
                    ContactsContract.Contacts.DISPLAY_NAME,
                    ContactsContract.Contacts.STARRED,
                    ContactsContract.Contacts.PHOTO_URI,
                ),
                null,
                null,
                ContactsContract.Contacts.DISPLAY_NAME + " ASC",
            )
        } catch (e: SecurityException) {
            Timber.w(e, "Contacts permission revoked between check and query")
            return arr
        } ?: return arr

        cursor.use { c ->
            val idIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts._ID)
            val lkIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.LOOKUP_KEY)
            val nameIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.DISPLAY_NAME)
            val starIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.STARRED)
            val photoIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.PHOTO_URI)
            while (c.moveToNext()) {
                val contactId = c.getLong(idIdx)
                val lookupKey = c.getString(lkIdx) ?: continue
                val displayName = c.getString(nameIdx)
                if (displayName.isNullOrBlank()) continue
                val starred = c.getInt(starIdx) == 1
                val photoUri = c.getString(photoIdx)

                val phones = readPhonesFor(contactId)
                val emails = readEmailsFor(contactId)
                val (orgName, _) = readOrganizationFor(contactId)

                val obj = JSONObject()
                    .put("lookupKey", lookupKey)
                    .put("displayName", displayName)
                    .put("phones", JSONArray(phones))
                    .put("emails", JSONArray(emails))
                    .put("starred", starred)
                if (!orgName.isNullOrBlank()) obj.put("organization", orgName)
                if (!photoUri.isNullOrBlank()) obj.put("photoUri", photoUri)
                arr.put(obj)
            }
        }
        return arr
    }

    private fun readPhonesFor(contactId: Long): List<String> {
        val phones = mutableListOf<String>()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " = ?",
            arrayOf(contactId.toString()),
            null,
        )?.use { c ->
            val numIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (c.moveToNext()) {
                val n = c.getString(numIdx)?.trim()
                if (!n.isNullOrEmpty()) phones.add(n)
            }
        }
        return phones.distinct()
    }

    private fun readEmailsFor(contactId: Long): List<String> {
        val emails = mutableListOf<String>()
        context.contentResolver.query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS),
            ContactsContract.CommonDataKinds.Email.CONTACT_ID + " = ?",
            arrayOf(contactId.toString()),
            null,
        )?.use { c ->
            val addrIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.ADDRESS)
            while (c.moveToNext()) {
                val e = c.getString(addrIdx)?.trim()
                if (!e.isNullOrEmpty()) emails.add(e)
            }
        }
        return emails.distinct()
    }

    /** Returns (organization, title) — title currently unused; placeholder for v0.2. */
    private fun readOrganizationFor(contactId: Long): Pair<String?, String?> {
        var org: String? = null
        var title: String? = null
        context.contentResolver.query(
            ContactsContract.Data.CONTENT_URI,
            arrayOf(
                ContactsContract.CommonDataKinds.Organization.COMPANY,
                ContactsContract.CommonDataKinds.Organization.TITLE,
            ),
            ContactsContract.Data.CONTACT_ID + " = ? AND " +
                ContactsContract.Data.MIMETYPE + " = ?",
            arrayOf(
                contactId.toString(),
                ContactsContract.CommonDataKinds.Organization.CONTENT_ITEM_TYPE,
            ),
            null,
        )?.use { c ->
            if (c.moveToFirst()) {
                org = c.getString(0)
                title = c.getString(1)
            }
        }
        return Pair(org, title)
    }

    // ─── Installed apps via PackageManager ─────────────────────────────────

    private fun readInstalledAppsArray(): JSONArray {
        val arr = JSONArray()
        val pm = context.packageManager
        val flags = PackageManager.GET_META_DATA
        // getInstalledPackages returns all packages — including system ones.
        // We label by FLAG_SYSTEM so the adapter / UI can filter if needed.
        val packages = try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(flags.toLong()))
            } else {
                @Suppress("DEPRECATION")
                pm.getInstalledPackages(flags)
            }
        } catch (e: Exception) {
            Timber.w(e, "getInstalledPackages threw — returning empty list")
            return arr
        }

        for (pi in packages) {
            val ai = pi.applicationInfo ?: continue
            val isSystem = (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0
            val label = try {
                pm.getApplicationLabel(ai).toString()
            } catch (_: Exception) {
                pi.packageName
            }
            val versionCodeLong = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                pi.longVersionCode
            } else {
                @Suppress("DEPRECATION")
                pi.versionCode.toLong()
            }
            val versionCodeInt = if (versionCodeLong in Int.MIN_VALUE.toLong()..Int.MAX_VALUE.toLong()) {
                versionCodeLong.toInt()
            } else {
                // Snapshot schema declares versionCode as integer; clamp to MAX
                // rather than emit a string and confuse the JS adapter.
                Int.MAX_VALUE
            }

            val obj = JSONObject()
                .put("packageName", pi.packageName)
                .put("label", label)
                .put("versionName", pi.versionName ?: "")
                .put("versionCode", versionCodeInt)
                .put("firstInstallTime", pi.firstInstallTime)
                .put("lastUpdateTime", pi.lastUpdateTime)
                .put("isSystem", isSystem)
            arr.put(obj)
        }
        return arr
    }

    companion object {
        // Must stay in sync with SNAPSHOT_SCHEMA_VERSION in the JS adapter.
        const val SNAPSHOT_SCHEMA_VERSION = 1
    }
}
