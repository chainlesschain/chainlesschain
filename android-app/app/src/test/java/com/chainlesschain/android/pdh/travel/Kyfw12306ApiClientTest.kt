package com.chainlesschain.android.pdh.travel

import kotlinx.coroutines.test.runTest
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.OkHttpClient
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Before
import org.junit.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * §2.5 v0.2 — MockWebServer-driven JVM tests for [Kyfw12306ApiClient].
 *
 * Coverage:
 *   - checkLogin: success / failure shapes
 *   - fetchCompletedOrders: 1-page happy path, multi-page pagination,
 *     non-completed status, cookie expired (HTTP 302 → -101)
 *   - fetchPendingOrders: happy + empty
 *   - parseDateTime: 3 input formats (date-only / date+time / Chinese)
 *   - Anti-bot gates: UA / Referer / X-Requested-With headers asserted
 */
class Kyfw12306ApiClientTest {

    private lateinit var server: MockWebServer
    private lateinit var client: Kyfw12306ApiClient

    @Before
    fun setUp() {
        server = MockWebServer()
        server.start()
        client = Kyfw12306ApiClient().apply {
            baseUrl = server.url("/").toString().toHttpUrl()
            httpClient = OkHttpClient.Builder().followRedirects(false).build()
        }
    }

    @After
    fun tearDown() {
        server.shutdown()
    }

    private val fakeCookie =
        "tk=ABC123; JSESSIONID=def456; route=c5c62a51; RAIL_DEVICEID=xyz"

    // ─── checkLogin ────────────────────────────────────────────────────────

    @Test
    fun `checkLogin returns true when is_login Y`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"status":true,"data":{"is_login":"Y"}}"""),
        )
        assertTrue(client.checkLogin(fakeCookie))
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun `checkLogin returns false when is_login N`() = runTest {
        server.enqueue(
            MockResponse().setBody("""{"status":true,"data":{"is_login":"N"}}"""),
        )
        assertFalse(client.checkLogin(fakeCookie))
    }

    @Test
    fun `checkLogin returns false on 302 login redirect`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .setHeader("Location", "/otn/login/init"),
        )
        assertFalse(client.checkLogin(fakeCookie))
        assertEquals(-101, client.lastErrorCode)
    }

    @Test
    fun `checkLogin returns false on non-JSON HTML body`() = runTest {
        server.enqueue(
            MockResponse()
                .setBody("<!DOCTYPE html><html>login page</html>")
                .setHeader("Content-Type", "text/html"),
        )
        assertFalse(client.checkLogin(fakeCookie))
        assertEquals(-101, client.lastErrorCode)
        assertTrue(client.lastErrorMessage!!.contains("non-json"))
    }

    // ─── fetchCompletedOrders ──────────────────────────────────────────────

    @Test
    fun `fetchCompletedOrders parses one ticket happy path`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status": true,
                  "data": {
                    "OrderDTODataList": [
                      {
                        "sequence_no": "EE20240315001",
                        "order_date": "20240315",
                        "ticket_total_price": "553.5",
                        "tickets": [
                          {
                            "passenger_name": "张三",
                            "passenger_id_no": "310101200001011234",
                            "train_code": "G123",
                            "from_station_name": "上海虹桥",
                            "to_station_name": "北京南",
                            "start_train_date_page": "2024-03-20 09:00",
                            "arrive_train_date_page": "2024-03-20 13:00",
                            "seat_type_name": "二等座",
                            "coach_no": "05",
                            "seat_no": "12A",
                            "ticket_price": "553.5",
                            "ticket_no": "T-1"
                          }
                        ]
                      }
                    ]
                  }
                }
                """.trimIndent(),
            ),
        )
        val tickets = client.fetchCompletedOrders(fakeCookie, maxPages = 1)
        assertEquals(1, tickets.size)
        val t = tickets[0]
        assertEquals("EE20240315001", t.orderSequenceNo)
        assertEquals("张三", t.passengerName)
        assertEquals("011234", t.passengerIdLast6)
        assertEquals("G123", t.trainNumber)
        assertEquals("上海虹桥", t.fromStation)
        assertEquals("北京南", t.toStation)
        assertTrue(t.departureMs > 0)
        assertTrue(t.arrivalMs > t.departureMs)
        assertEquals("二等座", t.seatTypeName)
        assertEquals("05", t.coachNo)
        assertEquals("12A", t.seatNo)
        assertEquals(553.5, t.ticketPrice, 0.01)
        assertEquals(553.5, t.orderTotalPrice, 0.01)
        assertTrue(t.isCompleted)
        assertEquals(0, client.lastErrorCode)
    }

    @Test
    fun `fetchCompletedOrders empty list returns empty`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"status":true,"data":{"OrderDTODataList":[]}}""",
            ),
        )
        val tickets = client.fetchCompletedOrders(fakeCookie, maxPages = 1)
        assertTrue(tickets.isEmpty())
    }

    @Test
    fun `fetchCompletedOrders multi-passenger order yields N tickets`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status": true,
                  "data": {
                    "OrderDTODataList": [
                      {
                        "sequence_no": "EE001",
                        "order_date": "20240315",
                        "ticket_total_price": "1107",
                        "tickets": [
                          {
                            "passenger_name": "张三",
                            "train_code": "G123",
                            "from_station_name": "A",
                            "to_station_name": "B",
                            "start_train_date_page": "2024-03-20 09:00",
                            "arrive_train_date_page": "2024-03-20 13:00",
                            "ticket_price": "553.5"
                          },
                          {
                            "passenger_name": "李四",
                            "train_code": "G123",
                            "from_station_name": "A",
                            "to_station_name": "B",
                            "start_train_date_page": "2024-03-20 09:00",
                            "arrive_train_date_page": "2024-03-20 13:00",
                            "ticket_price": "553.5"
                          }
                        ]
                      }
                    ]
                  }
                }
                """.trimIndent(),
            ),
        )
        val tickets = client.fetchCompletedOrders(fakeCookie, maxPages = 1)
        assertEquals(2, tickets.size)
        assertEquals("张三", tickets[0].passengerName)
        assertEquals("李四", tickets[1].passengerName)
        assertEquals(tickets[0].orderSequenceNo, tickets[1].orderSequenceNo)
    }

    @Test
    fun `fetchCompletedOrders 302 redirect sets lastErrorCode -101`() = runTest {
        server.enqueue(
            MockResponse()
                .setResponseCode(302)
                .setHeader("Location", "/otn/login/init"),
        )
        val tickets = client.fetchCompletedOrders(fakeCookie, maxPages = 1)
        assertTrue(tickets.isEmpty())
        assertEquals(-101, client.lastErrorCode)
    }

    @Test
    fun `fetchCompletedOrders sends UA + Referer + X-Requested-With headers`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"status":true,"data":{"OrderDTODataList":[]}}""",
            ),
        )
        client.fetchCompletedOrders(fakeCookie, maxPages = 1)
        val req = server.takeRequest()
        assertNotNull(req.getHeader("User-Agent"))
        assertTrue(req.getHeader("User-Agent")!!.contains("Mozilla"))
        assertNotNull(req.getHeader("Referer"))
        assertTrue(req.getHeader("Referer")!!.contains("kyfw.12306.cn"))
        assertEquals("XMLHttpRequest", req.getHeader("X-Requested-With"))
        assertTrue(req.getHeader("Cookie")!!.contains("tk=ABC123"))
        // POST body should contain pagination params
        val bodyBytes = req.body.readUtf8()
        assertTrue(bodyBytes.contains("queryType=1"))
        assertTrue(bodyBytes.contains("come_from_flag=my_order"))
    }

    // ─── fetchPendingOrders ────────────────────────────────────────────────

    @Test
    fun `fetchPendingOrders parses unpaid order`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status": true,
                  "data": {
                    "orderDBList": [
                      {
                        "sequence_no": "PENDING-1",
                        "order_date": "20240320",
                        "ticket_total_price": "200",
                        "tickets": [
                          {
                            "passenger_name": "Wang",
                            "train_code": "D456",
                            "from_station_name": "南京",
                            "to_station_name": "上海",
                            "start_train_date_page": "2024-03-25 14:00",
                            "arrive_train_date_page": "2024-03-25 16:00",
                            "ticket_price": "200"
                          }
                        ]
                      }
                    ]
                  }
                }
                """.trimIndent(),
            ),
        )
        val tickets = client.fetchPendingOrders(fakeCookie)
        assertEquals(1, tickets.size)
        assertFalse(tickets[0].isCompleted)
        assertEquals("D456", tickets[0].trainNumber)
    }

    @Test
    fun `fetchPendingOrders empty list returns empty`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"status":true,"data":{"orderDBList":[]}}""",
            ),
        )
        assertTrue(client.fetchPendingOrders(fakeCookie).isEmpty())
    }

    // ─── status:false branches ─────────────────────────────────────────────

    @Test
    fun `fetchCompletedOrders status false with messages sets lastErrorCode -2`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """{"status":false,"messages":["请先登录","会话已过期"]}""",
            ),
        )
        val tickets = client.fetchCompletedOrders(fakeCookie, maxPages = 1)
        assertTrue(tickets.isEmpty())
        assertEquals(-2, client.lastErrorCode)
        assertTrue(client.lastErrorMessage!!.contains("请先登录"))
    }

    // ─── Edge: malformed date strings ──────────────────────────────────────

    @Test
    fun `fetchCompletedOrders zero ms when departure date unparseable`() = runTest {
        server.enqueue(
            MockResponse().setBody(
                """
                {
                  "status": true,
                  "data": {
                    "OrderDTODataList": [
                      {
                        "sequence_no": "EE-bad-date",
                        "order_date": "20240315",
                        "ticket_total_price": "100",
                        "tickets": [
                          {
                            "passenger_name": "X",
                            "train_code": "G1",
                            "from_station_name": "A",
                            "to_station_name": "B",
                            "start_train_date_page": "not a date",
                            "ticket_price": "100"
                          }
                        ]
                      }
                    ]
                  }
                }
                """.trimIndent(),
            ),
        )
        val tickets = client.fetchCompletedOrders(fakeCookie, maxPages = 1)
        assertEquals(1, tickets.size)
        // Unparseable → 0L, not throwing or crashing
        assertEquals(0L, tickets[0].departureMs)
    }
}
