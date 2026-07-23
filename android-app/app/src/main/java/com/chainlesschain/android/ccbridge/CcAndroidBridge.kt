package com.chainlesschain.android.ccbridge

import android.Manifest
import android.app.Application
import android.content.ActivityNotFoundException
import android.content.ContentUris
import android.content.Context
import android.content.Intent
import android.content.pm.ApplicationInfo
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.CallLog
import android.provider.ContactsContract
import android.provider.DocumentsContract
import android.provider.Telephony
import androidx.core.content.ContextCompat
import androidx.documentfile.provider.DocumentFile
import org.json.JSONArray
import org.json.JSONObject
import timber.log.Timber
import java.io.File
import java.io.IOException
import java.nio.charset.StandardCharsets
import java.util.Base64

/**
 * Plan A A6 — Native bridge surface called from cc-android-bridge.so (the
 * Node N-API addon) via JNI. Every method returns a UTF-8 JSON string so
 * the C++ side can pass it straight back as a Node string without env-aware
 * object construction.
 *
 * Why a static Kotlin object with @JvmStatic methods (not Hilt @Inject)?
 *  - JNI FindClass + GetStaticMethodID is the simplest possible bridge —
 *    no Hilt EntryPoint indirection, no per-call companion lookup.
 *  - The cc subprocess (Linux process, not JVM) calls into this through
 *    the .so binding loaded inside the cc Node process. The .so dlopen
 *    happens via [System.loadLibrary] in [attach] — but actually the cc
 *    process doesn't share our JVM at all (per memory
 *    android_cc_subprocess_execve_via_mksh). So JNI calls happen INSIDE
 *    the .so when it's loaded by the cc Node process — but the .so needs
 *    a Java VM handle to call back. The native side gets that via
 *    JNI_OnLoad receiving a JavaVM* — which means the Android app must
 *    have ALREADY loaded the .so in its own process for the JavaVM* to
 *    be valid.
 *
 * Implementation reality (revised 2026-05-22): the actual cross-process
 * bridge between cc Linux subprocess and Android JVM needs an IPC layer
 * (Unix abstract socket inside a BoundService). The cpp/.so does the C++
 * client end of that socket; the BoundService does the JVM end and
 * routes to these static methods. This file is the JVM-side surface
 * regardless of which transport (JNI in-process OR IPC) the bridge uses.
 *
 * Method contract: return JSON. Errors encode as `{"error": "REASON",
 * "message": "..."}` — never throw to JNI (causes JVM crash if not handled
 * on native side).
 */
object CcAndroidBridge {

    @Volatile private var appContext: Context? = null

    /**
     * Wire the App-scoped Context once at [Application.onCreate]. The native
     * bridge (or BoundService) calls into this object's @JvmStatic methods
     * which read [appContext] for ContentResolver / PackageManager access.
     * Calling twice is idempotent.
     */
    @JvmStatic
    fun attach(application: Application) {
        if (appContext == null) {
            appContext = application.applicationContext
            Timber.tag(TAG).d("attached to application context")
        }
    }

    /** Has [attach] been called? Used by caps probe. */
    @JvmStatic
    fun isAttached(): Boolean = appContext != null

    // ─── caps — fast probe ─────────────────────────────────────────────────

    /**
     * Returns capability snapshot. Native side uses this to populate the
     * `cc android caps` output without making heavier ContentResolver
     * queries (which would block if permissions aren't granted).
     */
    @JvmStatic
    fun caps(): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED",
            "Application.onCreate did not call CcAndroidBridge.attach()")
        val o = JSONObject()
            .put("available", true)
            .put("buildVersion", Build.VERSION.SDK_INT)
            .put("manufacturer", Build.MANUFACTURER ?: "?")
            .put("contactsGranted", hasPerm(ctx, Manifest.permission.READ_CONTACTS))
            .put("smsGranted", hasPerm(ctx, Manifest.permission.READ_SMS))
            .put("callsGranted", hasPerm(ctx, Manifest.permission.READ_CALL_LOG))
            .put("queryAllPackagesGranted", canListAllPackages(ctx))
        return o.toString()
    }

    // ─── contacts.query ────────────────────────────────────────────────────

    @JvmStatic
    fun queryContacts(sinceMs: Long): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        if (!hasPerm(ctx, Manifest.permission.READ_CONTACTS)) {
            return errorJson("PERMISSION_DENIED", "READ_CONTACTS not granted")
        }
        val arr = JSONArray()
        val selection = if (sinceMs > 0)
            ContactsContract.Contacts.CONTACT_LAST_UPDATED_TIMESTAMP + " >= ?"
        else null
        val selectionArgs = if (sinceMs > 0) arrayOf(sinceMs.toString()) else null
        try {
            ctx.contentResolver.query(
                ContactsContract.Contacts.CONTENT_URI,
                arrayOf(
                    ContactsContract.Contacts._ID,
                    ContactsContract.Contacts.LOOKUP_KEY,
                    ContactsContract.Contacts.DISPLAY_NAME,
                    ContactsContract.Contacts.STARRED,
                    ContactsContract.Contacts.PHOTO_URI,
                ),
                selection,
                selectionArgs,
                ContactsContract.Contacts.DISPLAY_NAME + " ASC",
            )?.use { c ->
                val idIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts._ID)
                val lkIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.LOOKUP_KEY)
                val nameIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.DISPLAY_NAME)
                val starIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.STARRED)
                val photoIdx = c.getColumnIndexOrThrow(ContactsContract.Contacts.PHOTO_URI)
                while (c.moveToNext()) {
                    val contactId = c.getLong(idIdx)
                    val lookupKey = c.getString(lkIdx) ?: continue
                    val displayName = c.getString(nameIdx) ?: continue
                    val o = JSONObject()
                        .put("lookupKey", lookupKey)
                        .put("displayName", displayName)
                        .put("phones", JSONArray(readPhonesFor(ctx, contactId)))
                        .put("emails", JSONArray(readEmailsFor(ctx, contactId)))
                        .put("starred", c.getInt(starIdx) == 1)
                    c.getString(photoIdx)?.takeIf { it.isNotBlank() }?.let { o.put("photoUri", it) }
                    val (organization, jobTitle) = readOrganizationFor(ctx, contactId)
                    organization?.takeIf { it.isNotBlank() }?.let { o.put("organization", it) }
                    jobTitle?.takeIf { it.isNotBlank() }?.let { o.put("jobTitle", it) }
                    arr.put(o)
                }
            }
        } catch (e: SecurityException) {
            return errorJson("PERMISSION_DENIED", e.message ?: "")
        } catch (e: Exception) {
            Timber.tag(TAG).w(e, "queryContacts threw")
            return errorJson("INTERNAL_ERROR", e.message ?: "")
        }
        return JSONObject().put("contacts", arr).toString()
    }

    private fun readPhonesFor(ctx: Context, contactId: Long): List<String> {
        val out = mutableListOf<String>()
        ctx.contentResolver.query(
            ContactsContract.CommonDataKinds.Phone.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Phone.NUMBER),
            ContactsContract.CommonDataKinds.Phone.CONTACT_ID + " = ?",
            arrayOf(contactId.toString()), null,
        )?.use { c ->
            val numIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Phone.NUMBER)
            while (c.moveToNext()) {
                c.getString(numIdx)?.trim()?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
            }
        }
        return out.distinct()
    }

    private fun readEmailsFor(ctx: Context, contactId: Long): List<String> {
        val out = mutableListOf<String>()
        ctx.contentResolver.query(
            ContactsContract.CommonDataKinds.Email.CONTENT_URI,
            arrayOf(ContactsContract.CommonDataKinds.Email.ADDRESS),
            ContactsContract.CommonDataKinds.Email.CONTACT_ID + " = ?",
            arrayOf(contactId.toString()), null,
        )?.use { c ->
            val addrIdx = c.getColumnIndexOrThrow(ContactsContract.CommonDataKinds.Email.ADDRESS)
            while (c.moveToNext()) {
                c.getString(addrIdx)?.trim()?.takeIf { it.isNotEmpty() }?.let { out.add(it) }
            }
        }
        return out.distinct()
    }

    private fun readOrganizationFor(ctx: Context, contactId: Long): Pair<String?, String?> {
        var org: String? = null
        var jobTitle: String? = null
        ctx.contentResolver.query(
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
            ), null,
        )?.use { c ->
            if (c.moveToFirst()) {
                org = c.getString(0)
                jobTitle = c.getString(1)
            }
        }
        return Pair(org, jobTitle)
    }

    // ─── sms.query ─────────────────────────────────────────────────────────

    @JvmStatic
    fun querySms(sinceMs: Long): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        if (!hasPerm(ctx, Manifest.permission.READ_SMS)) {
            return errorJson("PERMISSION_DENIED", "READ_SMS not granted")
        }
        val arr = JSONArray()
        val selection = if (sinceMs > 0) Telephony.Sms.DATE + " >= ?" else null
        val selArgs = if (sinceMs > 0) arrayOf(sinceMs.toString()) else null
        try {
            ctx.contentResolver.query(
                Telephony.Sms.CONTENT_URI,
                arrayOf(
                    Telephony.Sms._ID,
                    Telephony.Sms.ADDRESS,
                    Telephony.Sms.BODY,
                    Telephony.Sms.DATE,
                    Telephony.Sms.TYPE,
                    Telephony.Sms.THREAD_ID,
                    Telephony.Sms.READ,
                ),
                selection, selArgs, Telephony.Sms.DATE + " DESC",
            )?.use { c ->
                while (c.moveToNext()) {
                    arr.put(
                        JSONObject()
                            .put("id", c.getLong(0))
                            .put("address", c.getString(1) ?: "")
                            .put("body", c.getString(2) ?: "")
                            .put("date", c.getLong(3))
                            .put("type", c.getInt(4))
                            .put("threadId", c.getLong(5))
                            .put("isRead", c.getInt(6) == 1)
                    )
                }
            }
        } catch (e: SecurityException) {
            return errorJson("PERMISSION_DENIED", e.message ?: "")
        } catch (e: Exception) {
            return errorJson("INTERNAL_ERROR", e.message ?: "")
        }
        return JSONObject().put("messages", arr).toString()
    }

    // ─── calls.query ───────────────────────────────────────────────────────

    @JvmStatic
    fun queryCalls(sinceMs: Long): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        if (!hasPerm(ctx, Manifest.permission.READ_CALL_LOG)) {
            return errorJson("PERMISSION_DENIED", "READ_CALL_LOG not granted")
        }
        val arr = JSONArray()
        val selection = if (sinceMs > 0) CallLog.Calls.DATE + " >= ?" else null
        val selArgs = if (sinceMs > 0) arrayOf(sinceMs.toString()) else null
        try {
            ctx.contentResolver.query(
                CallLog.Calls.CONTENT_URI,
                arrayOf(
                    CallLog.Calls._ID,
                    CallLog.Calls.NUMBER,
                    CallLog.Calls.CACHED_NAME,
                    CallLog.Calls.DATE,
                    CallLog.Calls.DURATION,
                    CallLog.Calls.TYPE,
                ),
                selection, selArgs, CallLog.Calls.DATE + " DESC",
            )?.use { c ->
                while (c.moveToNext()) {
                    arr.put(
                        JSONObject()
                            .put("id", c.getLong(0))
                            .put("number", c.getString(1) ?: "")
                            .put("name", c.getString(2) ?: "")
                            .put("date", c.getLong(3))
                            .put("durationSec", c.getLong(4))
                            .put("type", c.getInt(5))
                    )
                }
            }
        } catch (e: SecurityException) {
            return errorJson("PERMISSION_DENIED", e.message ?: "")
        } catch (e: Exception) {
            return errorJson("INTERNAL_ERROR", e.message ?: "")
        }
        return JSONObject().put("calls", arr).toString()
    }

    // ─── app.list / launch / intent ────────────────────────────────────────

    @JvmStatic
    fun listApps(includeSystem: Boolean): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        val pm = ctx.packageManager
        val arr = JSONArray()
        try {
            val packages = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                pm.getInstalledPackages(PackageManager.PackageInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION")
                pm.getInstalledPackages(0)
            }
            for (pi in packages) {
                val ai = pi.applicationInfo ?: continue
                val isSystem = (ai.flags and ApplicationInfo.FLAG_SYSTEM) != 0
                if (isSystem && !includeSystem) continue
                val label = try { pm.getApplicationLabel(ai).toString() } catch (_: Exception) { pi.packageName }
                val versionCodeLong = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.P) {
                    pi.longVersionCode
                } else {
                    @Suppress("DEPRECATION") pi.versionCode.toLong()
                }
                arr.put(
                    JSONObject()
                        .put("packageName", pi.packageName)
                        .put("label", label)
                        .put("versionName", pi.versionName ?: "")
                        .put("versionCode", versionCodeLong.coerceAtMost(Int.MAX_VALUE.toLong()).toInt())
                        .put("firstInstallTime", pi.firstInstallTime)
                        .put("lastUpdateTime", pi.lastUpdateTime)
                        .put("isSystem", isSystem)
                )
            }
        } catch (e: Exception) {
            return errorJson("INTERNAL_ERROR", e.message ?: "")
        }
        return JSONObject().put("apps", arr).toString()
    }

    @JvmStatic
    fun launchApp(pkg: String): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        val intent = ctx.packageManager.getLaunchIntentForPackage(pkg)
            ?: return errorJson("APP_NOT_FOUND", "No launcher activity for $pkg")
        return try {
            intent.flags = intent.flags or Intent.FLAG_ACTIVITY_NEW_TASK
            ctx.startActivity(intent)
            JSONObject().put("ok", true).toString()
        } catch (e: ActivityNotFoundException) {
            errorJson("APP_NOT_FOUND", e.message ?: "")
        } catch (e: Exception) {
            errorJson("INTERNAL_ERROR", e.message ?: "")
        }
    }

    @JvmStatic
    fun fireIntent(pkg: String, action: String, extrasJson: String): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        return try {
            val intent = Intent(action).apply {
                if (pkg.isNotBlank()) setPackage(pkg)
                flags = flags or Intent.FLAG_ACTIVITY_NEW_TASK
            }
            if (extrasJson.isNotBlank()) {
                val o = JSONObject(extrasJson)
                val keys = o.keys()
                while (keys.hasNext()) {
                    val k = keys.next()
                    intent.putExtra(k, o.getString(k))
                }
            }
            ctx.startActivity(intent)
            JSONObject().put("ok", true).toString()
        } catch (e: Exception) {
            errorJson("INTENT_FAILED", e.message ?: "")
        }
    }

    // ─── fs.read / list — SAF + sandbox ────────────────────────────────────

    /**
     * `target` may be:
     *   - `content://...` SAF URI (DocumentFile path)
     *   - absolute sandbox path under filesDir or cacheDir
     *   - anything else → REJECTED for safety
     */
    @JvmStatic
    fun readFile(target: String): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        return try {
            val bytes = when {
                target.startsWith("content://") -> readSafUri(ctx, target)
                isInsideAppSandbox(ctx, target) -> File(target).readBytes()
                else -> return errorJson(
                    "PATH_NOT_ALLOWED",
                    "Only content:// SAF URIs or paths inside filesDir/cacheDir are allowed",
                )
            }
            JSONObject()
                .put("bytes", bytes.size)
                .put("contentBase64", Base64.getEncoder().encodeToString(bytes))
                .toString()
        } catch (e: IOException) {
            errorJson("IO_ERROR", e.message ?: "")
        } catch (e: SecurityException) {
            errorJson("PERMISSION_DENIED", e.message ?: "")
        } catch (e: Exception) {
            errorJson("INTERNAL_ERROR", e.message ?: "")
        }
    }

    @JvmStatic
    fun listFiles(target: String): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        val arr = JSONArray()
        return try {
            when {
                target.startsWith("content://") -> {
                    val tree = DocumentFile.fromTreeUri(ctx, Uri.parse(target))
                        ?: return errorJson("SAF_TREE_UNAVAILABLE", "")
                    for (df in tree.listFiles()) {
                        arr.put(
                            JSONObject()
                                .put("name", df.name ?: "")
                                .put("isDir", df.isDirectory)
                                .put("size", df.length())
                                .put("mtime", df.lastModified())
                        )
                    }
                }
                isInsideAppSandbox(ctx, target) -> {
                    val d = File(target)
                    if (!d.exists() || !d.isDirectory) {
                        return errorJson("NOT_A_DIRECTORY", target)
                    }
                    d.listFiles()?.forEach { f ->
                        arr.put(
                            JSONObject()
                                .put("name", f.name)
                                .put("isDir", f.isDirectory)
                                .put("size", f.length())
                                .put("mtime", f.lastModified())
                        )
                    }
                }
                else -> return errorJson("PATH_NOT_ALLOWED", "")
            }
            arr.toString()
        } catch (e: Exception) {
            errorJson("INTERNAL_ERROR", e.message ?: "")
        }
    }

    private fun readSafUri(ctx: Context, uri: String): ByteArray {
        val parsed = Uri.parse(uri)
        val docId = DocumentsContract.getDocumentId(parsed)
        ctx.contentResolver.openInputStream(parsed)?.use { stream ->
            return stream.readBytes()
        } ?: throw IOException("Cannot open SAF URI: $docId")
    }

    private fun isInsideAppSandbox(ctx: Context, target: String): Boolean {
        val canonical = try { File(target).canonicalPath } catch (_: Exception) { return false }
        val filesRoot = ctx.filesDir.canonicalPath
        val cacheRoot = ctx.cacheDir.canonicalPath
        return canonical.startsWith(filesRoot) || canonical.startsWith(cacheRoot)
    }

    // ─── a11y.* — Accessibility Service ────────────────────────────────────
    //
    // v0.1 stubs: real Accessibility Service registration is heavyweight
    // (manifest entry + user-enable flow). Return graceful unavailable.
    // Future A11: ship a real AccessibilityService extension class.

    @JvmStatic
    fun a11yQuery(filter: String?): String =
        errorJson("A11Y_NOT_IMPLEMENTED", "Accessibility Service not registered in v0.1")

    @JvmStatic
    fun a11yClick(nodeId: String): String =
        errorJson("A11Y_NOT_IMPLEMENTED", "")

    @JvmStatic
    fun a11yType(text: String): String =
        errorJson("A11Y_NOT_IMPLEMENTED", "")

    // ─── shizuku.exec / root.exec ──────────────────────────────────────────

    @JvmStatic
    fun shizukuExec(cmd: String): String =
        errorJson("SHIZUKU_NOT_IMPLEMENTED",
            "Shizuku bridge requires user-installed Shizuku app + IPC handshake; not in v0.1")

    /**
     * Best-effort root exec. Triggers Magisk superuser prompt the first time.
     * Returns `{stdout, stderr, exitCode}` or `{error: "ROOT_UNAVAILABLE"}`.
     */
    @JvmStatic
    fun rootExec(cmd: String): String {
        return try {
            val proc = Runtime.getRuntime().exec(arrayOf("su", "-c", cmd))
            val finished = proc.waitFor()
            val stdout = proc.inputStream.bufferedReader(StandardCharsets.UTF_8).readText()
            val stderr = proc.errorStream.bufferedReader(StandardCharsets.UTF_8).readText()
            JSONObject()
                .put("stdout", stdout)
                .put("stderr", stderr)
                .put("exitCode", finished)
                .toString()
        } catch (e: IOException) {
            errorJson("ROOT_UNAVAILABLE", e.message ?: "su not found")
        } catch (e: Exception) {
            errorJson("ROOT_FAILED", e.message ?: "")
        }
    }

    // ─── perms.check ───────────────────────────────────────────────────────

    @JvmStatic
    fun checkPerm(name: String): String {
        val ctx = appContext ?: return errorJson("BRIDGE_NOT_ATTACHED", "")
        return JSONObject()
            .put("granted", hasPerm(ctx, name))
            .toString()
    }

    // ─── helpers ───────────────────────────────────────────────────────────

    private fun hasPerm(ctx: Context, name: String): Boolean =
        ContextCompat.checkSelfPermission(ctx, name) == PackageManager.PERMISSION_GRANTED

    /**
     * Heuristic for whether QUERY_ALL_PACKAGES is effective: ROMs like MIUI
     * intercept getInstalledPackages even when manifest declares the
     * permission. A "more than a handful" result implies it works.
     */
    private fun canListAllPackages(ctx: Context): Boolean {
        return try {
            val packages = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                ctx.packageManager.getInstalledPackages(PackageManager.PackageInfoFlags.of(0L))
            } else {
                @Suppress("DEPRECATION") ctx.packageManager.getInstalledPackages(0)
            }
            packages.size > 5
        } catch (_: Exception) { false }
    }

    private fun errorJson(reason: String, message: String): String =
        JSONObject().put("error", reason).put("message", message).toString()

    /** Helper for the .so to use ContentUris (loaded only on demand). */
    @JvmStatic
    @Suppress("unused")
    fun helperContentUriAppend(uri: String, id: Long): String =
        ContentUris.withAppendedId(Uri.parse(uri), id).toString()

    private const val TAG = "CcAndroidBridge"
}
