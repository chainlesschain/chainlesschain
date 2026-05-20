package com.chainlesschain.android.remote.commands

import com.chainlesschain.android.remote.client.RemoteCommandClient
import io.mockk.*
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * PersonalDataHubCommands 单元测试 — Phase 14.1
 *
 * 覆盖 21 method × happy path + 关键错误分支。每个 coEvery / coVerify 都用
 * 具体的响应类型（不用 `<Any>`），因为 RemoteCommandClient.invoke 是 inline reified，
 * mockk 的 stub 必须与 production 的 reified 类型一致才能匹配（参考 AICommandsTest）。
 *
 * 设计文档：docs/design/Personal_Data_Hub_Phase_14_Mobile_Native_Entry.md
 */
@OptIn(ExperimentalCoroutinesApi::class)
class PersonalDataHubCommandsTest {

    private lateinit var hub: PersonalDataHubCommands
    private lateinit var mockClient: RemoteCommandClient

    @Before
    fun setup() {
        mockClient = mockk(relaxed = true)
        hub = PersonalDataHubCommands(mockClient)
    }

    @After
    fun tearDown() {
        clearAllMocks()
    }

    // ==================== ask() ====================

    @Test
    fun `ask sends question and parses AskResult`() = runTest {
        val expected = AskResult(
            answer = "上月在淘宝花了 1234.56 元",
            citations = listOf(Citation("evt-1", excerpt = "订单 #x")),
            llmName = "qwen2.5:7b-instruct",
            isLocal = true
        )
        coEvery {
            mockClient.invoke<AskResult>("personal-data-hub.ask", any(), any())
        } returns Result.success(expected)

        val result = hub.ask("上月在淘宝花了多少？")

        assertTrue(result.isSuccess)
        assertEquals(expected.answer, result.getOrNull()?.answer)
        assertEquals(1, result.getOrNull()?.citations?.size)
        assertEquals(true, result.getOrNull()?.isLocal)

        coVerify {
            mockClient.invoke<AskResult>(
                "personal-data-hub.ask",
                match { params -> params["question"] == "上月在淘宝花了多少？" && !params.containsKey("options") },
                any()
            )
        }
    }

    @Test
    fun `ask with acceptNonLocal forwards option`() = runTest {
        coEvery {
            mockClient.invoke<AskResult>(any(), any(), any())
        } returns Result.success(AskResult("ok", emptyList(), "claude", false))

        hub.ask("Q", acceptNonLocal = true, useRag = false, topK = 5)

        coVerify {
            mockClient.invoke<AskResult>(
                "personal-data-hub.ask",
                match { params ->
                    @Suppress("UNCHECKED_CAST")
                    val opts = params["options"] as Map<String, Any>
                    opts["acceptNonLocal"] == true && opts["useRag"] == false && opts["topK"] == 5
                },
                any()
            )
        }
    }

    @Test
    fun `ask propagates failure from client`() = runTest {
        coEvery {
            mockClient.invoke<AskResult>(any(), any(), any())
        } returns Result.failure(RuntimeException("Non-local LLM blocked"))

        val result = hub.ask("Q")
        assertTrue(result.isFailure)
        assertTrue(result.exceptionOrNull()?.message?.contains("Non-local") == true)
    }

    // ==================== Readonly ====================

    @Test
    fun `stats invokes correct method with empty params`() = runTest {
        val expected = HubStats(
            vault = VaultStats(events = 1000, persons = 50, places = 30, items = 20, topics = 10)
        )
        coEvery {
            mockClient.invoke<HubStats>("personal-data-hub.stats", any(), any())
        } returns Result.success(expected)

        val result = hub.stats()
        assertEquals(1000L, result.getOrNull()?.vault?.events)

        coVerify {
            mockClient.invoke<HubStats>("personal-data-hub.stats", match { it.isEmpty() }, any())
        }
    }

    @Test
    fun `health parses all 4 sink states`() = runTest {
        val expected = HubHealth(
            vault = HealthVault(ok = true, schemaVersion = 5),
            llm = HealthLlm(ok = true, isLocal = true, name = "qwen2.5:7b"),
            kgSink = HealthOk(ok = true),
            ragSink = HealthOk(ok = false)
        )
        coEvery {
            mockClient.invoke<HubHealth>("personal-data-hub.health", any(), any())
        } returns Result.success(expected)

        val result = hub.health().getOrNull()!!
        assertEquals(true, result.vault.ok)
        assertEquals(5, result.vault.schemaVersion)
        assertEquals(true, result.llm.isLocal)
        assertEquals(false, result.ragSink.ok)
    }

    @Test
    fun `listAdapters returns adapter list`() = runTest {
        val expected = AdaptersResponse(
            adapters = listOf(
                AdapterMeta("email-imap", "1.0.0", listOf("ingest"), "high"),
                AdapterMeta("alipay-bill", "1.0.0", listOf("import"), "critical")
            )
        )
        coEvery {
            mockClient.invoke<AdaptersResponse>("personal-data-hub.list-adapters", any(), any())
        } returns Result.success(expected)

        val result = hub.listAdapters().getOrNull()!!
        assertEquals(2, result.adapters.size)
        assertEquals("email-imap", result.adapters[0].name)
    }

    // ==================== Sync ====================

    @Test
    fun `syncAdapter passes name and options`() = runTest {
        coEvery {
            mockClient.invoke<SyncReport>("personal-data-hub.sync-adapter", any(), any())
        } returns Result.success(SyncReport(adapter = "email-imap", ingested = 30))

        hub.syncAdapter("email-imap", mapOf("since" to 1000L))

        coVerify {
            mockClient.invoke<SyncReport>(
                "personal-data-hub.sync-adapter",
                match { params ->
                    @Suppress("UNCHECKED_CAST")
                    val opts = params["options"] as Map<String, Any>
                    params["name"] == "email-imap" && opts["since"] == 1000L
                },
                any()
            )
        }
    }

    @Test
    fun `syncAdapter without options omits options key`() = runTest {
        coEvery {
            mockClient.invoke<SyncReport>(any(), any(), any())
        } returns Result.success(SyncReport())
        hub.syncAdapter("email-imap")
        coVerify {
            mockClient.invoke<SyncReport>(
                "personal-data-hub.sync-adapter",
                match { params -> params["name"] == "email-imap" && !params.containsKey("options") },
                any()
            )
        }
    }

    @Test
    fun `syncAll dispatches to syncAll method`() = runTest {
        coEvery {
            mockClient.invoke<SyncReportList>("personal-data-hub.sync-all", any(), any())
        } returns Result.success(SyncReportList(reports = listOf(SyncReport(adapter = "email-imap"))))

        val result = hub.syncAll()
        assertEquals(1, result.getOrNull()?.reports?.size)
    }

    @Test
    fun `syncAdapterStream returns streamId`() = runTest {
        coEvery {
            mockClient.invoke<HubStreamStartResponse>("personal-data-hub.sync-adapter-stream", any(), any())
        } returns Result.success(HubStreamStartResponse(streamId = "s-1", name = "email-imap"))

        val result = hub.syncAdapterStream("email-imap").getOrNull()!!
        assertEquals("s-1", result.streamId)
    }

    @Test
    fun `syncAllStream returns streamId`() = runTest {
        coEvery {
            mockClient.invoke<HubStreamStartResponse>("personal-data-hub.sync-all-stream", any(), any())
        } returns Result.success(HubStreamStartResponse(streamId = "s-all"))

        val result = hub.syncAllStream()
        assertEquals("s-all", result.getOrNull()?.streamId)
    }

    // ==================== Query / Audit ====================

    @Test
    fun `queryEvents passes all filters when provided`() = runTest {
        coEvery {
            mockClient.invoke<EventsResponse>("personal-data-hub.query-events", any(), any())
        } returns Result.success(EventsResponse())

        hub.queryEvents(
            subtype = "order",
            since = 1000L,
            until = 2000L,
            actor = "merchant-123",
            adapter = "taobao",
            limit = 50
        )

        coVerify {
            mockClient.invoke<EventsResponse>(
                "personal-data-hub.query-events",
                match { f ->
                    f["subtype"] == "order" && f["since"] == 1000L && f["until"] == 2000L &&
                        f["actor"] == "merchant-123" && f["adapter"] == "taobao" && f["limit"] == 50
                },
                any()
            )
        }
    }

    @Test
    fun `queryEvents omits null filters`() = runTest {
        coEvery {
            mockClient.invoke<EventsResponse>(any(), any(), any())
        } returns Result.success(EventsResponse())
        hub.queryEvents()
        coVerify {
            mockClient.invoke<EventsResponse>(
                "personal-data-hub.query-events",
                match { it.isEmpty() },
                any()
            )
        }
    }

    @Test
    fun `recentAudit accepts filter triplet`() = runTest {
        coEvery {
            mockClient.invoke<AuditRowsResponse>("personal-data-hub.recent-audit", any(), any())
        } returns Result.success(AuditRowsResponse())

        hub.recentAudit(since = 100L, action = "ingest", limit = 20)

        coVerify {
            mockClient.invoke<AuditRowsResponse>(
                "personal-data-hub.recent-audit",
                match { f -> f["since"] == 100L && f["action"] == "ingest" && f["limit"] == 20 },
                any()
            )
        }
    }

    @Test
    fun `eventDetail passes eventId`() = runTest {
        coEvery {
            mockClient.invoke<EventDetailResponse>("personal-data-hub.event-detail", any(), any())
        } returns Result.success(EventDetailResponse(event = HubEvent("e1", "order", "taobao", 1000L)))

        val result = hub.eventDetail("e1").getOrNull()!!
        assertEquals("e1", result.event.id)

        coVerify {
            mockClient.invoke<EventDetailResponse>(
                "personal-data-hub.event-detail",
                match { it["eventId"] == "e1" },
                any()
            )
        }
    }

    // ==================== Email Adapter ====================

    @Test
    fun `registerEmail flattens account fields into params`() = runTest {
        coEvery {
            mockClient.invoke<AdapterRegisterResponse>("personal-data-hub.register-email", any(), any())
        } returns Result.success(AdapterRegisterResponse(name = "email-imap@me", version = "1.0.0"))

        val account = EmailAccount(
            provider = "qq",
            email = "me@qq.com",
            authCode = "AUTHCODE16CHARS!",
            folders = listOf("INBOX", "Sent")
        )
        hub.registerEmail(account)

        coVerify {
            mockClient.invoke<AdapterRegisterResponse>(
                "personal-data-hub.register-email",
                match { params ->
                    @Suppress("UNCHECKED_CAST")
                    val acc = params["account"] as Map<String, Any>
                    acc["provider"] == "qq" &&
                        acc["email"] == "me@qq.com" &&
                        acc["authCode"] == "AUTHCODE16CHARS!" &&
                        acc["folders"] == listOf("INBOX", "Sent")
                },
                any()
            )
        }
    }

    @Test
    fun `unregisterEmail passes email`() = runTest {
        coEvery {
            mockClient.invoke<UnregisterResponse>("personal-data-hub.unregister-email", any(), any())
        } returns Result.success(UnregisterResponse(ok = true, removed = "me@qq.com"))

        val result = hub.unregisterEmail("me@qq.com").getOrNull()!!
        assertEquals(true, result.ok)
    }

    @Test
    fun `testEmailAuth invokes test method without persistence`() = runTest {
        coEvery {
            mockClient.invoke<TestAuthResponse>("personal-data-hub.test-email-auth", any(), any())
        } returns Result.success(TestAuthResponse(ok = true))

        val account = EmailAccount(provider = "gmail", email = "x@gmail.com", authCode = "code")
        val result = hub.testEmailAuth(account).getOrNull()!!
        assertEquals(true, result.ok)
    }

    @Test
    fun `listEmailAccounts returns accounts list`() = runTest {
        coEvery {
            mockClient.invoke<EmailAccountsResponse>("personal-data-hub.list-email-accounts", any(), any())
        } returns Result.success(EmailAccountsResponse(accounts = listOf(
            EmailAccountInfo("me@qq.com", "qq", listOf("INBOX"), 1000L)
        )))

        val result = hub.listEmailAccounts().getOrNull()!!
        assertEquals(1, result.accounts.size)
        assertEquals("me@qq.com", result.accounts[0].email)
    }

    // ==================== Alipay Adapter ====================

    @Test
    fun `registerAlipay flattens account with optional zipPassword`() = runTest {
        coEvery {
            mockClient.invoke<AdapterRegisterResponse>("personal-data-hub.register-alipay", any(), any())
        } returns Result.success(AdapterRegisterResponse(name = "alipay@me"))

        hub.registerAlipay("me@anywhere.com", zipPassword = "pw123")

        coVerify {
            mockClient.invoke<AdapterRegisterResponse>(
                "personal-data-hub.register-alipay",
                match { params ->
                    @Suppress("UNCHECKED_CAST")
                    val acc = params["account"] as Map<String, Any>
                    acc["email"] == "me@anywhere.com" && acc["zipPassword"] == "pw123"
                },
                any()
            )
        }
    }

    @Test
    fun `unregisterAlipay passes email`() = runTest {
        coEvery {
            mockClient.invoke<UnregisterResponse>("personal-data-hub.unregister-alipay", any(), any())
        } returns Result.success(UnregisterResponse(ok = true))

        val result = hub.unregisterAlipay("me@anywhere.com")
        assertTrue(result.isSuccess)
    }

    @Test
    fun `importAlipayBill requires at least one path`() = runTest {
        try {
            hub.importAlipayBill()
            fail("Expected IllegalArgumentException")
        } catch (e: IllegalArgumentException) {
            assertTrue(e.message?.contains("at least one of zipPath / csvPath") == true)
        }
    }

    @Test
    fun `importAlipayBill with zipPath only invokes`() = runTest {
        coEvery {
            mockClient.invoke<SyncReport>("personal-data-hub.import-alipay-bill", any(), any())
        } returns Result.success(SyncReport(adapter = "alipay-bill", ingested = 500))

        val result = hub.importAlipayBill(zipPath = "C:/tmp/bill.zip", zipPassword = "pw")
        assertEquals(500L, result.getOrNull()?.ingested)

        coVerify {
            mockClient.invoke<SyncReport>(
                "personal-data-hub.import-alipay-bill",
                match { it["zipPath"] == "C:/tmp/bill.zip" && it["zipPassword"] == "pw" && !it.containsKey("csvPath") },
                any()
            )
        }
    }

    @Test
    fun `listAlipayAccounts returns accounts list`() = runTest {
        coEvery {
            mockClient.invoke<AlipayAccountsResponse>("personal-data-hub.list-alipay-accounts", any(), any())
        } returns Result.success(AlipayAccountsResponse(accounts = listOf(
            AlipayAccountInfo("a@b.com", hasZipPassword = true, registeredAt = 2000L)
        )))

        val result = hub.listAlipayAccounts().getOrNull()!!
        assertEquals(1, result.accounts.size)
    }

    // ==================== Dev / Misc ====================

    @Test
    fun `registerMock with all params invokes`() = runTest {
        coEvery {
            mockClient.invoke<AdapterRegisterResponse>("personal-data-hub.register-mock", any(), any())
        } returns Result.success(AdapterRegisterResponse(name = "mock"))

        hub.registerMock(name = "mock", count = 100, seed = 42)

        coVerify {
            mockClient.invoke<AdapterRegisterResponse>(
                "personal-data-hub.register-mock",
                match { it["name"] == "mock" && it["count"] == 100 && it["seed"] == 42 },
                any()
            )
        }
    }

    @Test
    fun `unregister generic adapter passes name`() = runTest {
        coEvery {
            mockClient.invoke<UnregisterResponse>("personal-data-hub.unregister", any(), any())
        } returns Result.success(UnregisterResponse(ok = true, removed = "mock"))

        val result = hub.unregister("mock")
        assertEquals("mock", result.getOrNull()?.removed)
    }
}
