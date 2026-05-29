package com.chainlesschain.android.pdh.travel

import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.FormBody
import okhttp3.HttpUrl
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.Request
import org.json.JSONObject
import timber.log.Timber
import java.io.IOException
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone
import java.util.concurrent.TimeUnit
import javax.inject.Inject
import javax.inject.Singleton

/**
 * §2.5 v0.2 — 12306 (kyfw.12306.cn) public-API client driven by captured browser
 * cookie. **Cookie-only, no signing** — 12306 web order endpoints accept any
 * request with valid `tk` + `JSESSIONID` + `RAIL_DEVICEID` cookies set during
 * WebView login, no _signature / X-Bogus / NS_sig3 type anti-bot SDK.
 *
 * v0.1 path was login-cookie-only (no fetch). v0.2 wires the two real endpoints
 * that need cookie to return order history:
 *
 *   - `/otn/login/checkUser`               (POST, form-empty) — validates login
 *   - `/otn/queryOrder/queryMyOrder`       (POST, form-encoded) — completed orders
 *   - `/otn/queryOrder/queryMyOrderNoComplete` (POST, form-encoded) — pending orders
 *
 * v0.2 caveats:
 *   - Cookie expiry: 12306 invalidates session after ~30min idle. Sync UI
 *     should retry once on `loginCheck.status=false` then surface "登录已过期，
 *     请重新登录".
 *   - Date range: `queryStartDate` / `queryEndDate` must be within 90 days for
 *     queryMyOrder. We default to last 90d.
 *   - Pagination: queryMyOrder returns at most 50 orders per page; we paginate
 *     via `pageIndex` until empty.
 *   - Anti-bot: 12306 enforces `User-Agent` + `Referer` + `If-Modified-Since:0`
 *     gates softly — without them returns HTML login redirect instead of JSON.
 *
 * v0.3+ scope (NOT YET):
 *   - 网上候补 (`/otn/afterNate/queryQueueByOrder`)
 *   - 改签历史 (`/otn/confirmPassenger/getQueueCountAsync`)
 *   - 余票查询 (`/otn/leftTicket/queryR`) — read-only browse
 */
@Singleton
class Kyfw12306ApiClient @Inject constructor() {

    var httpClient: OkHttpClient = OkHttpClient.Builder()
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(25, TimeUnit.SECONDS)
        .followRedirects(false) // 12306 redirects expired session to login
        .build()

    /** Override the base URL for MockWebServer in tests. */
    var baseUrl: HttpUrl = "https://kyfw.12306.cn/".toHttpUrl()

    /** Single completed-order line. 12306 returns one OrderDTO per sequence,
     *  each carrying 1..N tickets. We flatten into per-ticket records so the
     *  vault items map 1:1 to "I rode train G123 on date D". */
    data class TicketRecord(
        val orderSequenceNo: String,
        val ticketNumber: String?,
        val passengerName: String,
        val passengerIdLast6: String?,
        val trainNumber: String,
        val fromStation: String,
        val toStation: String,
        val departureMs: Long,
        val arrivalMs: Long,
        val seatTypeName: String?,
        val coachNo: String?,
        val seatNo: String?,
        val ticketPrice: Double,
        val orderDateMs: Long,
        val orderTotalPrice: Double,
        val isCompleted: Boolean,
    )

    @Volatile var lastErrorCode: Int = 0
        private set
    @Volatile var lastErrorMessage: String? = null
        private set

    /** GET /otn/login/conf 拿 sessionid 健康检查；返 false 视为 cookie 失效。
     *  Note: `status:true` 只表示请求被服务端处理 (不是 4xx)，登录态由
     *  data.is_login 字段判定 — `Y` = 登录 / `N` = 未登录。 */
    suspend fun checkLogin(cookie: String): Boolean = withContext(Dispatchers.IO) {
        val url = baseUrl.newBuilder()
            .addPathSegments("otn/login/conf")
            .build()
        val body = FormBody.Builder().build() // empty POST
        val resp = doRequest(url, cookie, body, postOverride = true) ?: return@withContext false
        val isLogin = resp.optJSONObject("data")?.optString("is_login")
        // 优先用 data.is_login (canonical) — Y/N 真值
        // is_login 缺时 fallback 到 top-level status (老接口 shape)
        if (!isLogin.isNullOrEmpty()) {
            isLogin == "Y"
        } else {
            resp.optBoolean("status", false)
        }
    }

    /**
     * Pull all completed orders in the given date range, paginating up to
     * [maxPages] pages of 50 each. Default range = last 90 days (12306's
     * single-request limit).
     */
    suspend fun fetchCompletedOrders(
        cookie: String,
        startDateMs: Long = System.currentTimeMillis() - DAYS_90_MS,
        endDateMs: Long = System.currentTimeMillis(),
        maxPages: Int = 4,
    ): List<TicketRecord> = withContext(Dispatchers.IO) {
        val fmt = SimpleDateFormat("yyyy-MM-dd", Locale.US).apply {
            timeZone = TimeZone.getTimeZone("Asia/Shanghai")
        }
        val startDate = fmt.format(Date(startDateMs))
        val endDate = fmt.format(Date(endDateMs))
        val all = mutableListOf<TicketRecord>()
        var page = 1
        while (page <= maxPages) {
            val url = baseUrl.newBuilder()
                .addPathSegments("otn/queryOrder/queryMyOrder")
                .build()
            val body = FormBody.Builder()
                .add("come_from_flag", "my_order")
                .add("queryStartDate", startDate)
                .add("queryEndDate", endDate)
                .add("queryType", "1")
                .add("sequeue_train_name", "")
                .add("pageSize", "50")
                .add("pageIndex", page.toString())
                .add("query_where", "G")
                .build()
            val obj = doRequest(url, cookie, body, postOverride = true)
                ?: break
            val data = obj.optJSONObject("data") ?: break
            val list = data.optJSONArray("OrderDTODataList") ?: break
            if (list.length() == 0) break
            for (i in 0 until list.length()) {
                val order = list.optJSONObject(i) ?: continue
                parseOrderTickets(order, isCompleted = true).forEach { all.add(it) }
            }
            if (list.length() < 50) break // last page
            page += 1
        }
        all
    }

    /** Pull pending (unpaid / unticketed) orders. Usually empty for normal users. */
    suspend fun fetchPendingOrders(cookie: String): List<TicketRecord> = withContext(Dispatchers.IO) {
        val url = baseUrl.newBuilder()
            .addPathSegments("otn/queryOrder/queryMyOrderNoComplete")
            .build()
        val body = FormBody.Builder().build() // no params per 12306 API
        val obj = doRequest(url, cookie, body, postOverride = true) ?: return@withContext emptyList()
        val data = obj.optJSONObject("data") ?: return@withContext emptyList()
        val list = data.optJSONArray("orderDBList") ?: return@withContext emptyList()
        val out = mutableListOf<TicketRecord>()
        for (i in 0 until list.length()) {
            val order = list.optJSONObject(i) ?: continue
            parseOrderTickets(order, isCompleted = false).forEach { out.add(it) }
        }
        out
    }

    private fun parseOrderTickets(order: JSONObject, isCompleted: Boolean): List<TicketRecord> {
        val sequenceNo = order.optStringOrNull("sequence_no") ?: return emptyList()
        val orderDateStr = order.optStringOrNull("order_date") // "20240315"
        val orderDateMs = orderDateStr?.let { parseYyyymmdd(it) } ?: 0L
        val orderTotalPrice = order.optStringOrNull("ticket_total_price")?.toDoubleOrNull() ?: 0.0
        val tickets = order.optJSONArray("tickets") ?: return emptyList()
        val out = ArrayList<TicketRecord>(tickets.length())
        for (i in 0 until tickets.length()) {
            val t = tickets.optJSONObject(i) ?: continue
            val passengerName = t.optStringOrNull("passenger_name") ?: continue
            val trainNumber = t.optStringOrNull("train_code")
                ?: t.optStringOrNull("stationTrainCode")
                ?: continue
            val fromStation = t.optStringOrNull("from_station_name")
                ?: t.optStringOrNull("from_station_name_page")
                ?: continue
            val toStation = t.optStringOrNull("to_station_name")
                ?: t.optStringOrNull("to_station_name_page")
                ?: continue
            val departureMs = parseDateTime(
                t.optStringOrNull("start_train_date_page")
                    ?: t.optStringOrNull("start_train_date"),
            )
            val arrivalMs = parseDateTime(t.optStringOrNull("arrive_train_date_page"))
            out.add(
                TicketRecord(
                    orderSequenceNo = sequenceNo,
                    ticketNumber = t.optStringOrNull("ticket_no")
                        ?: t.optStringOrNull("ticketNo"),
                    passengerName = passengerName,
                    passengerIdLast6 = t.optStringOrNull("passenger_id_no")
                        ?.takeLast(6)
                        ?.takeIf { it.length == 6 },
                    trainNumber = trainNumber,
                    fromStation = fromStation,
                    toStation = toStation,
                    departureMs = departureMs,
                    arrivalMs = arrivalMs,
                    seatTypeName = t.optStringOrNull("seat_type_name")
                        ?: t.optStringOrNull("seatTypeName"),
                    coachNo = t.optStringOrNull("coach_no") ?: t.optStringOrNull("coachNo"),
                    seatNo = t.optStringOrNull("seat_no") ?: t.optStringOrNull("seatNo"),
                    ticketPrice = t.optStringOrNull("ticket_price")?.toDoubleOrNull()
                        ?: t.optStringOrNull("ticketPrice")?.toDoubleOrNull()
                        ?: 0.0,
                    orderDateMs = orderDateMs,
                    orderTotalPrice = orderTotalPrice,
                    isCompleted = isCompleted,
                ),
            )
        }
        return out
    }

    private fun doRequest(
        url: HttpUrl,
        cookie: String,
        body: FormBody,
        postOverride: Boolean,
    ): JSONObject? {
        val reqBuilder = Request.Builder()
            .url(url)
            .header("Cookie", cookie)
            .header(
                "User-Agent",
                "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 " +
                    "(KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            )
            .header("Referer", "https://kyfw.12306.cn/otn/view/index.html")
            .header("If-Modified-Since", "0")
            .header("Cache-Control", "no-cache")
            .header("Accept", "application/json, text/plain, */*")
            .header("X-Requested-With", "XMLHttpRequest")
            .apply { if (postOverride) post(body) }
        return try {
            httpClient.newCall(reqBuilder.build()).execute().use { resp ->
                val rawBody = resp.body?.string()
                if (rawBody == null) {
                    setLastError(-1, "empty body")
                    return null
                }
                if (!resp.isSuccessful && resp.code !in 300..399) {
                    Timber.w("Kyfw12306ApiClient: %s -> HTTP %d", url.encodedPath, resp.code)
                    setLastError(resp.code, "HTTP ${resp.code}")
                    return null
                }
                // 12306 redirects un-authed requests to /otn/login/init (status 302).
                // Detect via Location header OR HTML body. Caller treats as
                // "cookie expired" (lastErrorCode = -101 mirrors social adapters).
                if (resp.code in 300..399) {
                    setLastError(-101, "redirect to login (cookie expired)")
                    return null
                }
                val trimmed = rawBody.trimStart()
                if (!trimmed.startsWith("{")) {
                    // 12306 returns HTML login page on session timeout.
                    Timber.w("Kyfw12306ApiClient: %s -> non-JSON (login redirect)", url.encodedPath)
                    setLastError(-101, "non-json (cookie expired)")
                    return null
                }
                val obj = JSONObject(rawBody)
                // Top-level `status:false` means session timeout or bad params.
                val statusOk = obj.optBoolean("status", false) ||
                    obj.optJSONObject("data") != null
                if (!statusOk) {
                    val messages = obj.optJSONArray("messages")
                    val msg = messages?.let {
                        (0 until it.length()).joinToString(",") { i -> it.optString(i) }
                    } ?: "status=false"
                    // msg dropped from Timber log — server messages may echo
                    // user identifiers ("用户XXX订单查询失败" pattern). Still
                    // surfaced via setLastError → UI (intended). (audit F2)
                    Timber.w("Kyfw12306ApiClient: %s -> status=false msgLen=%d", url.encodedPath, msg.length)
                    setLastError(-2, msg)
                    return null
                }
                clearLastError()
                obj
            }
        } catch (e: IOException) {
            Timber.w(e, "Kyfw12306ApiClient: IO on %s", url.encodedPath)
            setLastError(-3, "IO: ${e.message ?: e.javaClass.simpleName}")
            null
        } catch (e: Exception) {
            if (e is CancellationException) throw e  // audit F3
            Timber.w(e, "Kyfw12306ApiClient: parse on %s", url.encodedPath)
            setLastError(-4, "parse: ${e.message ?: e.javaClass.simpleName}")
            null
        }
    }

    private fun parseDateTime(s: String?): Long {
        if (s.isNullOrBlank()) return 0L
        // 12306 returns dates in multiple shapes:
        //   "2024-03-20"             (date-only)
        //   "2024-03-20 09:00"       (date + HH:mm)
        //   "2024年03月20日 09:00"   (Chinese formatted)
        return try {
            val fmt = when {
                s.contains("年") -> SimpleDateFormat("yyyy年MM月dd日 HH:mm", Locale.US)
                s.length <= 10 -> SimpleDateFormat("yyyy-MM-dd", Locale.US)
                else -> SimpleDateFormat("yyyy-MM-dd HH:mm", Locale.US)
            }
            fmt.timeZone = TimeZone.getTimeZone("Asia/Shanghai")
            fmt.parse(s)?.time ?: 0L
        } catch (t: Throwable) {
            if (t is CancellationException) throw t  // audit F3
            0L
        }
    }

    private fun parseYyyymmdd(s: String): Long {
        return try {
            val fmt = SimpleDateFormat("yyyyMMdd", Locale.US).apply {
                timeZone = TimeZone.getTimeZone("Asia/Shanghai")
            }
            fmt.parse(s)?.time ?: 0L
        } catch (t: Throwable) {
            if (t is CancellationException) throw t  // audit F3
            0L
        }
    }

    private fun setLastError(code: Int, message: String?) {
        lastErrorCode = code
        lastErrorMessage = message
    }

    private fun clearLastError() {
        lastErrorCode = 0
        lastErrorMessage = null
    }

    companion object {
        const val DAYS_90_MS = 90L * 24 * 3600 * 1000L
    }
}

private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    val v = optString(key)
    return v.takeIf { it.isNotEmpty() }
}
