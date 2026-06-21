package com.chainlesschain.android.pdh.bridge

import com.chainlesschain.android.pdh.social.weibo.WeiboApiClient
import com.chainlesschain.android.pdh.social.weibo.WeiboCredentialsStore
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.add
import kotlinx.serialization.json.addJsonObject
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
 * straight to the agent so it can act on them ("我最近发了什么微博 / 我收藏了哪些 /
 * 我关注了谁"). Reuses the existing [WeiboApiClient] endpoints + the cookie from
 * [WeiboCredentialsStore] (filled by the 本机数据 WebView login; persists, so the
 * query is reproducible with no re-login).
 *
 * v1 covers weibo (posts / favourites / follows) — the most complete ApiClient;
 * the other platforms' ApiClients (Bilibili/Douyin/Toutiao/…) follow the same
 * shape and can be added incrementally. Read-only (no writes / no side effects):
 * this only GETs the user's own data, so it needs no approval gate.
 */
class QueryAppDataTool(
    private val weiboApi: WeiboApiClient,
    private val weiboCreds: WeiboCredentialsStore,
) : PdhTool {

    override val name = "query_app_data"
    override val description =
        "Query an app's data LIVE via its API using the user's stored login — " +
            "answer specific questions instead of bulk-collecting. weibo: " +
            "posts (我发的微博) / favourites (我的收藏) / follows (我关注的人). " +
            "Returns assist_required if not logged in (do a 本机数据 login first)."
    override val inputSchema = buildJsonObject {
        put("type", "object")
        putJsonObject("properties") {
            putJsonObject("app") {
                put("type", "string")
                putJsonArray("enum") { add("weibo") }
            }
            putJsonObject("query") {
                put("type", "string")
                put("description", "weibo: posts | favourites | follows")
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
        val app = str(args, "app")
        val query = str(args, "query").lowercase()
        val limit = (args["limit"] as? JsonPrimitive)?.intOrNull?.coerceIn(1, 200) ?: 30
        when (app) {
            "weibo" -> queryWeibo(query, limit)
            else -> throw IllegalArgumentException("unsupported app: $app (supported: weibo)")
        }
    }

    private suspend fun queryWeibo(query: String, limit: Int): JsonElement {
        if (!weiboCreds.hasCredentials()) return notLoggedIn()
        val cookie = weiboCreds.getCookie() ?: return notLoggedIn()
        val uid = weiboCreds.getUid() ?: return notLoggedIn()
        // Fetch (suspend) BEFORE building the JSON — the builder lambdas are not
        // suspend contexts.
        return when (query) {
            "posts" -> {
                val items = weiboApi.fetchPosts(cookie, uid, limit)
                buildJsonObject {
                    put("status", "ok"); put("app", "weibo"); put("query", "posts")
                    put("count", items.size)
                    putJsonArray("items") {
                        items.forEach { p ->
                            addJsonObject {
                                put("mid", p.mid); put("text", p.text)
                                put("createdAt", p.createdAt); put("source", p.source ?: "")
                                put("reposts", p.repostsCount); put("comments", p.commentsCount)
                                put("likes", p.likesCount); put("pics", p.picCount)
                            }
                        }
                    }
                }
            }
            "favourites", "favourite", "favorites" -> {
                val items = weiboApi.fetchFavourites(cookie, limit)
                buildJsonObject {
                    put("status", "ok"); put("app", "weibo"); put("query", "favourites")
                    put("count", items.size)
                    putJsonArray("items") {
                        items.forEach { f ->
                            addJsonObject {
                                put("mid", f.mid); put("text", f.text)
                                put("favAt", f.favAt); put("author", f.authorScreenName ?: "")
                            }
                        }
                    }
                }
            }
            "follows", "following" -> {
                val items = weiboApi.fetchFollows(cookie, uid, limit)
                buildJsonObject {
                    put("status", "ok"); put("app", "weibo"); put("query", "follows")
                    put("count", items.size)
                    putJsonArray("items") {
                        items.forEach { fl ->
                            addJsonObject {
                                put("uid", fl.uid); put("screenName", fl.screenName)
                                put("description", fl.description ?: "")
                                put("followedAt", fl.followedAt)
                            }
                        }
                    }
                }
            }
            else -> throw IllegalArgumentException(
                "unsupported weibo query: $query (supported: posts | favourites | follows)",
            )
        }
    }

    private fun notLoggedIn(): JsonElement = buildJsonObject {
        put("status", "assist_required")
        put(
            "instruction",
            "查询微博数据需要先登录拿到 cookie。请到 首页 → 本机数据,点开「微博」完成登录" +
                "(cookie 会保存,以后查询不用再登录),然后重试 query_app_data。",
        )
        put("reason", "no stored credentials for weibo")
        put("resumeToken", "query_app_data:weibo")
    }

    private fun str(obj: JsonObject, key: String): String =
        (obj[key] as? JsonPrimitive)?.contentOrNull?.trim().orEmpty()
}
