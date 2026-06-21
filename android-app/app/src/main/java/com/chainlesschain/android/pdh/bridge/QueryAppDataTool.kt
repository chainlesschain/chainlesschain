package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.social.SignProvider
import com.chainlesschain.android.pdh.social.bilibili.BilibiliApiClient
import com.chainlesschain.android.pdh.social.bilibili.BilibiliCredentialsStore
import com.chainlesschain.android.pdh.social.douyin.DouyinApiClient
import com.chainlesschain.android.pdh.social.douyin.DouyinCredentialsStore
import com.chainlesschain.android.pdh.social.douyin.DouyinSignBridge
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouApiClient
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouCredentialsStore
import com.chainlesschain.android.pdh.social.kuaishou.KuaishouSignBridge
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoApiClient
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoCredentialsStore
import com.chainlesschain.android.pdh.social.toutiao.ToutiaoSignBridge
import com.chainlesschain.android.pdh.social.weibo.WeiboApiClient
import com.chainlesschain.android.pdh.social.weibo.WeiboCredentialsStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
import kotlinx.serialization.json.buildJsonArray
import kotlinx.serialization.json.buildJsonObject
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.put
import kotlinx.serialization.json.putJsonArray
import kotlinx.serialization.json.putJsonObject

/**
 * Phase 2 / 查询分析 — `query_app_data`: answer a SPECIFIC question against an
 * app's data LIVE via its API, using the user's stored login (cookie/token).
 * Unlike `collect_app_data` (bulk → vault), this returns the queried rows
 * straight to the agent so it can act on them. Reuses the existing per-platform
 * `*ApiClient` endpoints + the cookie from `*CredentialsStore` (filled by the
 * 本机数据 WebView login; persists, so queries reproduce with no re-login).
 *
 * Read-only (GETs the user's own data, no writes/side effects) → no approval
 * gate. Signed platforms (douyin/toutiao/kuaishou) wire the matching
 * [SignProvider] (WebSignBridge) for the call and shut it down after (same
 * pattern as collect_app_data). assist_required → 本机数据 login when not logged in.
 *
 * Covered: weibo / bilibili / douyin / toutiao / kuaishou. xiaohongshu needs an
 * extra a1/userId handshake → added later. QQ/微信 have no cookie API (IM is a
 * local SQLCipher DB) → use salvage_app_data, not this tool.
 */
class QueryAppDataTool(
    private val weiboApi: WeiboApiClient,
    private val weiboCreds: WeiboCredentialsStore,
    private val bilibiliApi: BilibiliApiClient,
    private val bilibiliCreds: BilibiliCredentialsStore,
    private val douyinApi: DouyinApiClient,
    private val douyinCreds: DouyinCredentialsStore,
    private val douyinSign: DouyinSignBridge,
    private val toutiaoApi: ToutiaoApiClient,
    private val toutiaoCreds: ToutiaoCredentialsStore,
    private val toutiaoSign: ToutiaoSignBridge,
    private val kuaishouApi: KuaishouApiClient,
    private val kuaishouCreds: KuaishouCredentialsStore,
    private val kuaishouSign: KuaishouSignBridge,
) : PdhTool {

    override val name = "query_app_data"
    override val description =
        "Query an app's data LIVE via its API using the user's stored login — " +
            "answer specific questions instead of bulk-collecting. " +
            "weibo: posts|favourites|follows · bilibili: history|favourites|dynamics|follows · " +
            "douyin: history|favourites|likes · toutiao: feed|collection|searches · " +
            "kuaishou: history|searches. Returns assist_required if not logged in."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {
            putJsonObject("app") {
                put("type", "string")
                putJsonArray("enum") {
                    listOf("weibo", "bilibili", "douyin", "toutiao", "kuaishou").forEach { add(it) }
                }
            }
            putJsonObject("query") {
                put("type", "string")
                put("description", "one of the query keys for the chosen app (see description)")
            }
            putJsonObject("limit") {
                put("type", "integer")
                put("description", "max rows (default 30)")
            }
        }
        putJsonArray("required") {
            add("app")
            add("query")
        }
    }

    override fun call(args: JsonObject): JsonElement = runBlocking {
        val app = str(args, "app").lowercase()
        val query = str(args, "query").lowercase()
        val limit = (args["limit"] as? JsonPrimitive)?.intOrNull?.coerceIn(1, 200) ?: 30
        when (app) {
            "weibo" -> queryWeibo(query, limit)
            "bilibili" -> queryBilibili(query, limit)
            "douyin" -> queryDouyin(query, limit)
            "toutiao" -> queryToutiao(query, limit)
            "kuaishou" -> queryKuaishou(query, limit)
            else -> throw IllegalArgumentException(
                "unsupported app: $app (weibo|bilibili|douyin|toutiao|kuaishou)",
            )
        }
    }

    // ── weibo (cookie + uid) ──────────────────────────────────────────────
    private suspend fun queryWeibo(query: String, limit: Int): JsonElement {
        val cookie = weiboCreds.getCookie()?.takeIf { weiboCreds.hasCredentials() }
            ?: return notLoggedIn("weibo")
        val uid = weiboCreds.getUid() ?: return notLoggedIn("weibo")
        val items = when (query) {
            "posts" -> weiboApi.fetchPosts(cookie, uid, limit).let { list ->
                buildJsonArray { list.forEach { p -> addJsonObject {
                    put("mid", p.mid); put("text", p.text); put("createdAt", p.createdAt)
                    put("source", p.source ?: ""); put("reposts", p.repostsCount)
                    put("comments", p.commentsCount); put("likes", p.likesCount); put("pics", p.picCount)
                } } }
            }
            "favourites", "favorites" -> weiboApi.fetchFavourites(cookie, limit).let { list ->
                buildJsonArray { list.forEach { f -> addJsonObject {
                    put("mid", f.mid); put("text", f.text); put("favAt", f.favAt)
                    put("author", f.authorScreenName ?: "")
                } } }
            }
            "follows", "following" -> weiboApi.fetchFollows(cookie, uid, limit).let { list ->
                buildJsonArray { list.forEach { fl -> addJsonObject {
                    put("uid", fl.uid); put("screenName", fl.screenName)
                    put("description", fl.description ?: ""); put("followedAt", fl.followedAt)
                } } }
            }
            else -> throw IllegalArgumentException(
                "unsupported weibo query: $query (posts|favourites|follows)",
            )
        }
        return ok("weibo", query, items)
    }

    // ── bilibili (cookie + uid, no signing) ───────────────────────────────
    private suspend fun queryBilibili(query: String, limit: Int): JsonElement {
        val cookie = bilibiliCreds.getCookie()?.takeIf { bilibiliCreds.hasCredentials() }
            ?: return notLoggedIn("bilibili")
        val uid = bilibiliCreds.getUid() ?: return notLoggedIn("bilibili")
        val items = when (query) {
            "history", "watch" -> bilibiliApi.fetchHistory(cookie, limit).let { list ->
                buildJsonArray { list.forEach { h -> addJsonObject {
                    put("bvid", h.bvid ?: ""); put("title", h.title); put("viewAt", h.viewAt)
                    put("uploader", h.uploader ?: ""); put("part", h.part ?: "")
                } } }
            }
            "favourites", "favorites" -> bilibiliApi.fetchFavourites(cookie, uid).let { list ->
                buildJsonArray { list.forEach { f -> addJsonObject {
                    put("bvid", f.bvid ?: ""); put("title", f.title); put("savedAt", f.savedAt)
                    put("folder", f.folderName ?: ""); put("uploader", f.uploader ?: "")
                } } }
            }
            "dynamics", "dynamic" -> bilibiliApi.fetchDynamics(cookie, limit).let { list ->
                buildJsonArray { list.forEach { d -> addJsonObject {
                    put("summary", d.summary); put("type", d.dynamicType)
                    put("publishedAt", d.publishedAt); put("author", d.authorName ?: "")
                } } }
            }
            "follows", "following" -> bilibiliApi.fetchFollows(cookie, uid, limit).let { list ->
                buildJsonArray { list.forEach { fl -> addJsonObject {
                    put("mid", fl.mid); put("uname", fl.uname)
                    put("sign", fl.sign ?: ""); put("followedAt", fl.followedAt)
                } } }
            }
            else -> throw IllegalArgumentException(
                "unsupported bilibili query: $query (history|favourites|dynamics|follows)",
            )
        }
        return ok("bilibili", query, items)
    }

    // ── douyin (cookie + signing) ─────────────────────────────────────────
    private suspend fun queryDouyin(query: String, limit: Int): JsonElement {
        val cookie = douyinCreds.getCookie()?.takeIf { it.isNotBlank() }
            ?: return notLoggedIn("douyin")
        val items = signed(douyinSign) {
            douyinApi.signProvider = douyinSign
            when (query) {
                "history", "watch" -> buildJsonArray {
                    douyinApi.fetchHistory(cookie, limit).forEach { h -> addJsonObject {
                        put("awemeId", h.awemeId); put("desc", h.description)
                        put("author", h.authorNickname ?: ""); put("watchedAt", h.watchedAt)
                    } }
                }
                "favourites", "favorites" -> buildJsonArray {
                    douyinApi.fetchFavourites(cookie, limit).forEach { f -> addJsonObject {
                        put("awemeId", f.awemeId); put("desc", f.description)
                        put("author", f.authorNickname ?: ""); put("savedAt", f.savedAt)
                    } }
                }
                "likes", "like" -> buildJsonArray {
                    douyinApi.fetchLikes(cookie, limit).forEach { l -> addJsonObject {
                        put("awemeId", l.awemeId); put("desc", l.description)
                        put("author", l.authorNickname ?: ""); put("likedAt", l.likedAt)
                    } }
                }
                else -> throw IllegalArgumentException(
                    "unsupported douyin query: $query (history|favourites|likes)",
                )
            }
        }
        return ok("douyin", query, items)
    }

    // ── toutiao (cookie + signing) ────────────────────────────────────────
    private suspend fun queryToutiao(query: String, limit: Int): JsonElement {
        val cookie = toutiaoCreds.getCookie()?.takeIf { it.isNotBlank() }
            ?: return notLoggedIn("toutiao")
        val items = signed(toutiaoSign) {
            toutiaoApi.signProvider = toutiaoSign
            when (query) {
                "feed", "read" -> buildJsonArray {
                    toutiaoApi.fetchFeed(cookie, limit).forEach { f -> addJsonObject {
                        put("itemId", f.itemId); put("title", f.title); put("category", f.category ?: "")
                        put("author", f.author ?: ""); put("publishedAt", f.publishedAt)
                    } }
                }
                "collection", "collections", "favourites" -> buildJsonArray {
                    toutiaoApi.fetchCollection(cookie, limit).forEach { c -> addJsonObject {
                        put("itemId", c.itemId); put("title", c.title)
                        put("author", c.author ?: ""); put("savedAt", c.savedAt)
                    } }
                }
                "searches", "search" -> buildJsonArray {
                    toutiaoApi.fetchSearchHistory(cookie, limit).forEach { s -> addJsonObject {
                        put("keyword", s.keyword); put("searchedAt", s.searchedAt)
                    } }
                }
                else -> throw IllegalArgumentException(
                    "unsupported toutiao query: $query (feed|collection|searches)",
                )
            }
        }
        return ok("toutiao", query, items)
    }

    // ── kuaishou (cookie + signing) ───────────────────────────────────────
    private suspend fun queryKuaishou(query: String, limit: Int): JsonElement {
        val cookie = kuaishouCreds.getCookie()?.takeIf { it.isNotBlank() }
            ?: return notLoggedIn("kuaishou")
        val items = signed(kuaishouSign) {
            kuaishouApi.signProvider = kuaishouSign
            when (query) {
                "history", "watch" -> buildJsonArray {
                    kuaishouApi.fetchWatchHistory(cookie, limit).forEach { w -> addJsonObject {
                        put("photoId", w.photoId); put("caption", w.caption)
                        put("author", w.authorName ?: ""); put("viewedAt", w.viewedAt)
                    } }
                }
                "searches", "search" -> buildJsonArray {
                    kuaishouApi.fetchSearchHistory(cookie, limit).forEach { s -> addJsonObject {
                        put("keyword", s.keyword); put("searchedAt", s.searchedAt)
                    } }
                }
                else -> throw IllegalArgumentException(
                    "unsupported kuaishou query: $query (history|searches)",
                )
            }
        }
        return ok("kuaishou", query, items)
    }

    // ── helpers ───────────────────────────────────────────────────────────
    private inline fun <T> signed(sign: SignProvider, block: () -> T): T = try {
        block()
    } finally {
        sign.shutdown()
    }

    private fun ok(app: String, query: String, items: JsonArray): JsonElement = buildJsonObject {
        put("status", "ok"); put("app", app); put("query", query)
        put("count", items.size); put("items", items)
    }

    private fun notLoggedIn(app: String): JsonElement = buildJsonObject {
        put("status", "assist_required")
        put(
            "instruction",
            "查询「$app」数据需要先登录拿到 cookie。请到 首页 → 本机数据,点开「$app」完成登录" +
                "(cookie 会保存,以后查询不用再登录),然后重试 query_app_data。",
        )
        put("reason", "no stored credentials for $app")
        put("resumeToken", "query_app_data:$app")
    }

    private fun str(obj: JsonObject, key: String): String =
        (obj[key] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
}
