package com.chainlesschain.marketplace.performance;

import com.chainlesschain.marketplace.dto.PluginDTO;
import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.service.PluginService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.concurrent.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * Performance Tests
 * 性能测试
 *
 * @author ChainlessChain Team
 */
@SpringBootTest
@ActiveProfiles("test")
@Transactional
class PerformanceTest {

    @Autowired
    private PluginService pluginService;

    private PluginDTO testPluginDTO;

    @BeforeEach
    void setUp() {
        testPluginDTO = new PluginDTO();
        testPluginDTO.setPluginId("perf-test-plugin");
        testPluginDTO.setName("Performance Test Plugin");
        testPluginDTO.setVersion("1.0.0");
        testPluginDTO.setDescription("Plugin for performance testing");
        testPluginDTO.setCategory("productivity");
        testPluginDTO.setTags(Arrays.asList("test", "performance"));
        testPluginDTO.setLicense("MIT");
    }

    @Test
    void testBulkPluginCreation() {
        // Test creating 100 plugins
        int pluginCount = 100;
        long startTime = System.currentTimeMillis();

        List<Plugin> createdPlugins = new ArrayList<>();
        for (int i = 0; i < pluginCount; i++) {
            PluginDTO dto = new PluginDTO();
            dto.setPluginId("perf-plugin-" + i);
            dto.setName("Performance Plugin " + i);
            dto.setVersion("1.0.0");
            dto.setDescription("Test plugin " + i);
            dto.setCategory("productivity");
            dto.setTags(Arrays.asList("test", "perf"));
            dto.setLicense("MIT");

            Plugin plugin = pluginService.createPlugin(
                    dto,
                    "did:example:test",
                    "https://example.com/plugin-" + i + ".zip",
                    1024L,
                    "hash-" + i
            );
            createdPlugins.add(plugin);
        }

        long endTime = System.currentTimeMillis();
        long duration = endTime - startTime;

        System.out.println("Created " + pluginCount + " plugins in " + duration + "ms");
        System.out.println("Average: " + (duration / pluginCount) + "ms per plugin");

        // Assert reasonable performance (< 50ms per plugin on average)
        assertTrue(duration / pluginCount < 50, "Plugin creation should be fast");
        assertEquals(pluginCount, createdPlugins.size());
    }

    @Test
    void testConcurrentPluginReads() throws InterruptedException, ExecutionException {
        // Create a test plugin first
        Plugin testPlugin = pluginService.createPlugin(
                testPluginDTO,
                "did:example:test",
                "https://example.com/plugin.zip",
                1024L,
                "test-hash"
        );

        // Test concurrent reads
        int threadCount = 50;
        int readsPerThread = 20;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);

        long startTime = System.currentTimeMillis();

        List<Future<Integer>> futures = new ArrayList<>();
        for (int i = 0; i < threadCount; i++) {
            Future<Integer> future = executor.submit(() -> {
                int successCount = 0;
                for (int j = 0; j < readsPerThread; j++) {
                    try {
                        Plugin plugin = pluginService.getPluginById(testPlugin.getId());
                        if (plugin != null) {
                            successCount++;
                        }
                    } catch (Exception e) {
                        System.err.println("Read failed: " + e.getMessage());
                    }
                }
                return successCount;
            });
            futures.add(future);
        }

        int totalSuccess = 0;
        for (Future<Integer> future : futures) {
            totalSuccess += future.get();
        }

        executor.shutdown();
        executor.awaitTermination(30, TimeUnit.SECONDS);

        long endTime = System.currentTimeMillis();
        long duration = endTime - startTime;

        int totalReads = threadCount * readsPerThread;
        System.out.println("Performed " + totalReads + " concurrent reads in " + duration + "ms");
        System.out.println("Success rate: " + (totalSuccess * 100.0 / totalReads) + "%");
        System.out.println("Throughput: " + (totalReads * 1000.0 / duration) + " reads/second");

        // Assert high success rate and reasonable performance
        assertTrue(totalSuccess >= totalReads * 0.95, "Success rate should be >= 95%");
        assertTrue(duration < 10000, "Concurrent reads should complete within 10 seconds");
    }

    @Test
    void testSearchPerformance() {
        // Create test data
        for (int i = 0; i < 50; i++) {
            PluginDTO dto = new PluginDTO();
            dto.setPluginId("search-plugin-" + i);
            dto.setName("Search Test Plugin " + i);
            dto.setVersion("1.0.0");
            dto.setDescription("Plugin for search testing with keyword translator");
            dto.setCategory(i % 2 == 0 ? "ai" : "productivity");
            dto.setTags(Arrays.asList("test", "search"));
            dto.setLicense("MIT");

            pluginService.createPlugin(
                    dto,
                    "did:example:test",
                    "https://example.com/plugin-" + i + ".zip",
                    1024L,
                    "hash-" + i
            );
        }

        // Test search performance
        long startTime = System.currentTimeMillis();

        List<Plugin> results = pluginService.searchPlugins(
                "translator",
                "ai",
                null,
                "rating"
        );

        long endTime = System.currentTimeMillis();
        long duration = endTime - startTime;

        System.out.println("Search completed in " + duration + "ms");
        System.out.println("Found " + results.size() + " results");

        // Assert reasonable search performance (< 500ms)
        assertTrue(duration < 500, "Search should complete within 500ms");
    }

    @Test
    void testCacheEffectiveness() {
        // Create a test plugin
        Plugin testPlugin = pluginService.createPlugin(
                testPluginDTO,
                "did:example:test",
                "https://example.com/plugin.zip",
                1024L,
                "test-hash"
        );

        // First read (cache miss)
        long startTime1 = System.currentTimeMillis();
        Plugin result1 = pluginService.getPluginById(testPlugin.getId());
        long duration1 = System.currentTimeMillis() - startTime1;

        // Second read (cache hit)
        long startTime2 = System.currentTimeMillis();
        Plugin result2 = pluginService.getPluginById(testPlugin.getId());
        long duration2 = System.currentTimeMillis() - startTime2;

        // Third read (cache hit)
        long startTime3 = System.currentTimeMillis();
        Plugin result3 = pluginService.getPluginById(testPlugin.getId());
        long duration3 = System.currentTimeMillis() - startTime3;

        System.out.println("First read (cache miss): " + duration1 + "ms");
        System.out.println("Second read (cache hit): " + duration2 + "ms");
        System.out.println("Third read (cache hit): " + duration3 + "ms");

        // Assert cache is working (cached reads should be faster)
        assertNotNull(result1);
        assertNotNull(result2);
        assertNotNull(result3);

        // Cache hits should be significantly faster (at least 50% faster)
        assertTrue(duration2 < duration1 * 0.5 || duration2 < 5,
                "Cached read should be faster than initial read");
    }

    @Test
    void testDatabaseConnectionPooling() throws InterruptedException, ExecutionException {
        // Test connection pool under load
        int threadCount = 20;
        int queriesPerThread = 10;
        ExecutorService executor = Executors.newFixedThreadPool(threadCount);

        long startTime = System.currentTimeMillis();

        List<Future<Boolean>> futures = new ArrayList<>();
        for (int i = 0; i < threadCount; i++) {
            final int threadId = i;
            Future<Boolean> future = executor.submit(() -> {
                try {
                    for (int j = 0; j < queriesPerThread; j++) {
                        // Create plugin
                        PluginDTO dto = new PluginDTO();
                        dto.setPluginId("pool-test-" + threadId + "-" + j);
                        dto.setName("Pool Test Plugin");
                        dto.setVersion("1.0.0");
                        dto.setDescription("Test");
                        dto.setCategory("productivity");
                        dto.setTags(Arrays.asList("test"));
                        dto.setLicense("MIT");

                        Plugin plugin = pluginService.createPlugin(
                                dto,
                                "did:example:test",
                                "https://example.com/plugin.zip",
                                1024L,
                                "hash"
                        );

                        // Read plugin
                        pluginService.getPluginById(plugin.getId());
                    }
                    return true;
                } catch (Exception e) {
                    System.err.println("Thread " + threadId + " failed: " + e.getMessage());
                    return false;
                }
            });
            futures.add(future);
        }

        int successCount = 0;
        for (Future<Boolean> future : futures) {
            if (future.get()) {
                successCount++;
            }
        }

        executor.shutdown();
        executor.awaitTermination(60, TimeUnit.SECONDS);

        long endTime = System.currentTimeMillis();
        long duration = endTime - startTime;

        System.out.println("Connection pool test completed in " + duration + "ms");
        System.out.println("Success rate: " + (successCount * 100.0 / threadCount) + "%");

        // Assert all threads completed successfully
        assertEquals(threadCount, successCount, "All threads should complete successfully");
        assertTrue(duration < 30000, "Should complete within 30 seconds");
    }

    @Test
    void testMemoryUsage() {
        Runtime runtime = Runtime.getRuntime();

        // Force garbage collection
        System.gc();
        long memoryBefore = runtime.totalMemory() - runtime.freeMemory();

        // Create many plugins
        for (int i = 0; i < 100; i++) {
            PluginDTO dto = new PluginDTO();
            dto.setPluginId("memory-test-" + i);
            dto.setName("Memory Test Plugin " + i);
            dto.setVersion("1.0.0");
            dto.setDescription("Test plugin for memory usage");
            dto.setCategory("productivity");
            dto.setTags(Arrays.asList("test", "memory"));
            dto.setLicense("MIT");

            pluginService.createPlugin(
                    dto,
                    "did:example:test",
                    "https://example.com/plugin-" + i + ".zip",
                    1024L,
                    "hash-" + i
            );
        }

        // Force garbage collection
        System.gc();
        long memoryAfter = runtime.totalMemory() - runtime.freeMemory();

        long memoryUsed = memoryAfter - memoryBefore;
        System.out.println("Memory used: " + (memoryUsed / 1024 / 1024) + " MB");
        System.out.println("Memory per plugin: " + (memoryUsed / 100 / 1024) + " KB");

        // Assert reasonable memory usage (< 10MB for 100 plugins)
        assertTrue(memoryUsed < 10 * 1024 * 1024,
                "Memory usage should be reasonable");
    }
}
