package com.chainlesschain.android.core.network

import kotlinx.coroutines.test.runTest
import okhttp3.mockwebserver.MockResponse
import okhttp3.mockwebserver.MockWebServer
import org.junit.After
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test

/**
 * LinkPreviewFetcher Tests
 *
 * Comprehensive tests for HTTP link preview fetching using MockWebServer
 *
 * Coverage:
 * - Open Graph tag extraction
 * - Fallback to standard meta tags
 * - URL resolution (relative/absolute paths)
 * - Error handling (404, timeout, invalid HTML)
 * - Caching mechanism
 * - Utility functions (extractUrls, clearCache)
 *
 * Target: 85% code coverage for LinkPreviewFetcher.kt
 */
class LinkPreviewFetcherTest {

    private lateinit var mockWebServer: MockWebServer
    private lateinit var fetcher: LinkPreviewFetcher
    private lateinit var baseUrl: String

    @Before
    fun setup() {
        mockWebServer = MockWebServer()
        mockWebServer.start()
        baseUrl = mockWebServer.url("/").toString().trimEnd('/')

        fetcher = LinkPreviewFetcher()
    }

    @After
    fun teardown() {
        mockWebServer.shutdown()
    }

    // ========================================
    // Successful Fetch Tests (4 tests)
    // ========================================

    @Test
    fun `fetchPreview extracts Open Graph tags successfully`() = runTest {
        // Given: HTML with Open Graph tags
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:title" content="Test Article">
                <meta property="og:description" content="This is a test description">
                <meta property="og:image" content="https://example.com/image.jpg">
                <meta property="og:site_name" content="Test Site">
            </head>
            <body></body>
            </html>
        """.trimIndent()

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/html")
                .setBody(html)
        )

        // When
        val preview = fetcher.fetchPreview("$baseUrl/article")

        // Then
        assertNotNull(preview)
        assertEquals("Test Article", preview?.title)
        assertEquals("This is a test description", preview?.description)
        assertEquals("https://example.com/image.jpg", preview?.imageUrl)
        assertEquals("Test Site", preview?.siteName)
        assertEquals("$baseUrl/article", preview?.url)
    }

    @Test
    fun `fetchPreview falls back to standard meta tags when OG tags absent`() = runTest {
        // Given: HTML without OG tags, but with standard meta tags
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>Page Title</title>
                <meta name="description" content="Standard description">
            </head>
            <body>
                <img src="/image.png" alt="Test Image">
            </body>
            </html>
        """.trimIndent()

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setHeader("Content-Type", "text/html")
                .setBody(html)
        )

        // When
        val preview = fetcher.fetchPreview("$baseUrl/page")

        // Then
        assertNotNull(preview)
        assertEquals("Page Title", preview?.title)
        assertEquals("Standard description", preview?.description)
        assertNotNull(preview?.imageUrl)
        assertTrue(preview?.imageUrl?.contains("/image.png") == true)
        assertNull(preview?.siteName)
    }

    @Test
    fun `fetchPreview uses cache on second request`() = runTest {
        // Given: First request
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:title" content="Cached Article">
            </head>
            </html>
        """.trimIndent()

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(html)
        )

        val url = "$baseUrl/cached"

        // When: First fetch (hits network)
        val preview1 = fetcher.fetchPreview(url)

        // Then: Request was made
        assertEquals(1, mockWebServer.requestCount)
        assertNotNull(preview1)
        assertEquals("Cached Article", preview1?.title)

        // When: Second fetch (hits cache, no new request)
        val preview2 = fetcher.fetchPreview(url)

        // Then: No new request, same result from cache
        assertEquals(1, mockWebServer.requestCount)
        assertNotNull(preview2)
        assertEquals("Cached Article", preview2?.title)
        assertEquals(preview1, preview2)
    }

    @Test
    fun `fetchPreview handles multiple images and selects first`() = runTest {
        // Given: HTML with multiple images
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <title>Gallery Page</title>
            </head>
            <body>
                <img src="https://example.com/image1.jpg" alt="First">
                <img src="https://example.com/image2.jpg" alt="Second">
            </body>
            </html>
        """.trimIndent()

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(html)
        )

        // When
        val preview = fetcher.fetchPreview("$baseUrl/gallery")

        // Then: First image is selected
        assertNotNull(preview)
        assertEquals("https://example.com/image1.jpg", preview?.imageUrl)
    }

    // ========================================
    // URL Resolution Tests (3 tests)
    // ========================================

    @Test
    fun `resolveImageUrl handles absolute URLs correctly`() = runTest {
        // Given
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:image" content="https://cdn.example.com/absolute.jpg">
            </head>
            </html>
        """.trimIndent()

        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody(html))

        // When
        val preview = fetcher.fetchPreview("$baseUrl/article")

        // Then: Absolute URL preserved
        assertEquals("https://cdn.example.com/absolute.jpg", preview?.imageUrl)
    }

    @Test
    fun `resolveImageUrl converts protocol-relative URLs`() = runTest {
        // Given: Protocol-relative URL (//example.com/image.jpg)
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:image" content="//cdn.example.com/image.jpg">
            </head>
            </html>
        """.trimIndent()

        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody(html))

        // When
        val preview = fetcher.fetchPreview("$baseUrl/article")

        // Then: Converted to https://
        assertEquals("https://cdn.example.com/image.jpg", preview?.imageUrl)
    }

    @Test
    fun `resolveImageUrl converts root-relative URLs`() = runTest {
        // Given: Root-relative URL (/images/photo.jpg)
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:image" content="/images/photo.jpg">
            </head>
            </html>
        """.trimIndent()

        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody(html))

        val testUrl = "$baseUrl/blog/article"

        // When
        val preview = fetcher.fetchPreview(testUrl)

        // Then: Resolved to domain root
        assertNotNull(preview?.imageUrl)
        assertTrue(preview?.imageUrl?.contains("/images/photo.jpg") == true)
        assertTrue(preview?.imageUrl?.startsWith("http") == true)
    }

    // ========================================
    // Error Handling Tests (3 tests)
    // ========================================

    @Test
    fun `fetchPreview returns null on HTTP 404`() = runTest {
        // Given: 404 Not Found
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(404)
                .setBody("Not Found")
        )

        // When
        val preview = fetcher.fetchPreview("$baseUrl/notfound")

        // Then
        assertNull(preview)
    }

    @Test
    fun `fetchPreview returns null on network timeout`() = runTest {
        // Given: Timeout response (OkHttp timeout is 5 seconds)
        mockWebServer.enqueue(
            MockResponse()
                .setSocketPolicy(okhttp3.mockwebserver.SocketPolicy.NO_RESPONSE)
        )

        // When
        val preview = fetcher.fetchPreview("$baseUrl/timeout")

        // Then: Returns null after timeout
        assertNull(preview)
    }

    @Test
    fun `fetchPreview handles invalid HTML gracefully`() = runTest {
        // Given: Malformed HTML
        val invalidHtml = "<html><head><title>Incomplete"

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(invalidHtml)
        )

        // When: Jsoup is lenient with invalid HTML
        val preview = fetcher.fetchPreview("$baseUrl/invalid")

        // Then: Should still parse what it can (Jsoup auto-closes tags)
        assertNotNull(preview)
        assertEquals("Incomplete", preview?.title)
    }

    // ========================================
    // Utility Function Tests (2 tests)
    // ========================================

    @Test
    fun `extractUrls finds all URLs in text`() {
        // Given
        val text = """
            Check out this article: https://example.com/article
            Also see http://test.com/page?param=value
            And this: https://secure.site.com/path#anchor
            Not a URL: example.com (missing protocol)
        """.trimIndent()

        // When
        val urls = fetcher.extractUrls(text)

        // Then
        assertEquals(3, urls.size)
        assertTrue(urls.contains("https://example.com/article"))
        assertTrue(urls.contains("http://test.com/page?param=value"))
        assertTrue(urls.contains("https://secure.site.com/path#anchor"))
    }

    @Test
    fun `clearCache removes cached entries`() = runTest {
        // Given: Cached entry
        val html = """
            <!DOCTYPE html>
            <html><head><title>Cached</title></head></html>
        """.trimIndent()

        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody(html))

        val url = "$baseUrl/cached"
        fetcher.fetchPreview(url)

        assertEquals(1, mockWebServer.requestCount)

        // When: Clear cache
        fetcher.clearCache()

        // When: Fetch again
        mockWebServer.enqueue(MockResponse().setResponseCode(200).setBody(html))
        fetcher.fetchPreview(url)

        // Then: New request was made (cache was cleared)
        assertEquals(2, mockWebServer.requestCount)
    }

    // ========================================
    // Edge Cases Tests
    // ========================================

    @Test
    fun `fetchPreview handles empty response body`() = runTest {
        // Given: Empty response
        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody("")
        )

        // When
        val preview = fetcher.fetchPreview("$baseUrl/empty")

        // Then: Preview created but with all null fields (Jsoup parses empty HTML)
        assertNotNull(preview)
        assertNull(preview?.title)
        assertNull(preview?.description)
        assertNull(preview?.imageUrl)
        assertNull(preview?.siteName)
    }

    @Test
    fun `fetchPreview handles HTML with no useful metadata`() = runTest {
        // Given: Minimal HTML
        val html = "<html><body>Just text</body></html>"

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(html)
        )

        // When
        val preview = fetcher.fetchPreview("$baseUrl/minimal")

        // Then: Preview created but with null fields
        assertNotNull(preview)
        assertNull(preview?.title)
        assertNull(preview?.description)
        assertNull(preview?.imageUrl)
        assertNull(preview?.siteName)
    }

    @Test
    fun `extractUrls handles text with no URLs`() {
        // Given
        val text = "This text has no URLs at all."

        // When
        val urls = fetcher.extractUrls(text)

        // Then
        assertTrue(urls.isEmpty())
    }

    @Test
    fun `extractUrls handles empty string`() {
        // Given
        val text = ""

        // When
        val urls = fetcher.extractUrls(text)

        // Then
        assertTrue(urls.isEmpty())
    }

    @Test
    fun `fetchPreview handles User-Agent header correctly`() = runTest {
        // Given
        val html = "<html><head><title>Test</title></head></html>"

        mockWebServer.enqueue(
            MockResponse()
                .setResponseCode(200)
                .setBody(html)
        )

        // When
        fetcher.fetchPreview("$baseUrl/test")

        // Then: Verify User-Agent header was sent
        val request = mockWebServer.takeRequest()
        assertNotNull(request)
        val userAgent = request.getHeader("User-Agent")
        assertNotNull(userAgent)
        assertTrue(userAgent?.contains("ChainlessChain") == true)
    }

    // ========================================
    // Data Class Tests
    // ========================================

    @Test
    fun `LinkPreview data class fields are set correctly`() {
        // Given
        val preview = LinkPreview(
            url = "https://example.com",
            title = "Test Title",
            description = "Test Description",
            imageUrl = "https://example.com/image.jpg",
            siteName = "Example Site"
        )

        // Then
        assertEquals("https://example.com", preview.url)
        assertEquals("Test Title", preview.title)
        assertEquals("Test Description", preview.description)
        assertEquals("https://example.com/image.jpg", preview.imageUrl)
        assertEquals("Example Site", preview.siteName)
    }

    @Test
    fun `LinkPreview handles null fields`() {
        // Given
        val preview = LinkPreview(
            url = "https://example.com",
            title = null,
            description = null,
            imageUrl = null,
            siteName = null
        )

        // Then
        assertNull(preview.title)
        assertNull(preview.description)
        assertNull(preview.imageUrl)
        assertNull(preview.siteName)
    }
}
