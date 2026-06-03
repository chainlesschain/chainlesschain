package com.chainlesschain.marketplace.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.marketplace.dto.PluginDTO;
import com.chainlesschain.marketplace.dto.PluginQueryDTO;
import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.entity.PluginVersion;
import com.chainlesschain.marketplace.exception.BusinessException;
import com.chainlesschain.marketplace.exception.ResourceNotFoundException;
import com.chainlesschain.marketplace.mapper.PluginMapper;
import com.chainlesschain.marketplace.mapper.PluginVersionMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/**
 * Plugin Service Unit Tests
 * 插件服务单元测试
 *
 * @author ChainlessChain Team
 */
@ExtendWith(MockitoExtension.class)
class PluginServiceTest {

    @Mock
    private PluginMapper pluginMapper;

    @Mock
    private PluginVersionMapper pluginVersionMapper;

    @InjectMocks
    private PluginService pluginService;

    private Plugin testPlugin;
    private PluginDTO testPluginDTO;
    private PluginVersion testVersion;

    @BeforeEach
    void setUp() {
        // Initialize test data
        testPlugin = new Plugin();
        testPlugin.setId(1L);
        testPlugin.setPluginId("test-plugin");
        testPlugin.setName("Test Plugin");
        testPlugin.setVersion("1.0.0");
        testPlugin.setAuthor("Test Author");
        testPlugin.setAuthorDid("did:example:test");
        testPlugin.setDescription("Test Description");
        testPlugin.setCategory("productivity");
        testPlugin.setTags(Arrays.asList("test", "example"));
        testPlugin.setStatus("approved");
        testPlugin.setVerified(true);
        testPlugin.setFeatured(false);
        testPlugin.setDownloads(100);
        testPlugin.setRating(new BigDecimal("4.5"));
        testPlugin.setRatingCount(10);
        testPlugin.setCreatedAt(LocalDateTime.now());
        testPlugin.setUpdatedAt(LocalDateTime.now());

        testPluginDTO = new PluginDTO();
        testPluginDTO.setPluginId("test-plugin");
        testPluginDTO.setName("Test Plugin");
        testPluginDTO.setVersion("1.0.0");
        testPluginDTO.setDescription("Test Description");
        testPluginDTO.setCategory("productivity");
        testPluginDTO.setTags(Arrays.asList("test", "example"));
        testPluginDTO.setLicense("MIT");

        testVersion = new PluginVersion();
        testVersion.setId(1L);
        testVersion.setPluginId(1L);
        testVersion.setVersion("1.0.0");
        testVersion.setFileUrl("https://example.com/plugin.zip");
        testVersion.setFileSize(1024L);
        testVersion.setFileHash("abc123");
        testVersion.setCreatedAt(LocalDateTime.now());
    }

    @Test
    void testGetPluginById_Success() {
        // Given
        when(pluginMapper.selectById(1L)).thenReturn(testPlugin);

        // When
        Plugin result = pluginService.getPluginById(1L);

        // Then
        assertNotNull(result);
        assertEquals(testPlugin.getId(), result.getId());
        assertEquals(testPlugin.getName(), result.getName());
        verify(pluginMapper, times(1)).selectById(1L);
    }

    @Test
    void testGetPluginById_NotFound() {
        // Given
        when(pluginMapper.selectById(999L)).thenReturn(null);

        // When & Then
        assertThrows(ResourceNotFoundException.class, () -> {
            pluginService.getPluginById(999L);
        });
        verify(pluginMapper, times(1)).selectById(999L);
    }

    @Test
    void testCreatePlugin_Success() {
        // Given
        when(pluginMapper.insert(any(Plugin.class))).thenReturn(1);
        when(pluginVersionMapper.insert(any(PluginVersion.class))).thenReturn(1);

        // When
        Plugin result = pluginService.createPlugin(
                testPluginDTO,
                "did:example:test",
                "https://example.com/plugin.zip",
                1024L,
                "abc123"
        );

        // Then
        assertNotNull(result);
        assertEquals(testPluginDTO.getName(), result.getName());
        assertEquals(testPluginDTO.getPluginId(), result.getPluginId());
        assertEquals("pending", result.getStatus());
        verify(pluginMapper, times(1)).insert(any(Plugin.class));
        verify(pluginVersionMapper, times(1)).insert(any(PluginVersion.class));
    }

    @Test
    void testUpdatePlugin_Success() {
        // Given
        when(pluginMapper.selectById(1L)).thenReturn(testPlugin);
        when(pluginMapper.updateById(any(Plugin.class))).thenReturn(1);

        // When
        testPluginDTO.setName("Updated Plugin");
        Plugin result = pluginService.updatePlugin(1L, testPluginDTO, "did:example:test");

        // Then
        assertNotNull(result);
        assertEquals("Updated Plugin", result.getName());
        verify(pluginMapper, times(1)).selectById(1L);
        verify(pluginMapper, times(1)).updateById(any(Plugin.class));
    }

    @Test
    void testUpdatePlugin_Unauthorized() {
        // Given
        when(pluginMapper.selectById(1L)).thenReturn(testPlugin);

        // When & Then
        assertThrows(BusinessException.class, () -> {
            pluginService.updatePlugin(1L, testPluginDTO, "did:example:other");
        });
        verify(pluginMapper, times(1)).selectById(1L);
        verify(pluginMapper, never()).updateById(any(Plugin.class));
    }

    @Test
    void testDeletePlugin_Success() {
        // Given
        when(pluginMapper.selectById(1L)).thenReturn(testPlugin);
        when(pluginMapper.deleteById(1L)).thenReturn(1);

        // When
        pluginService.deletePlugin(1L, "did:example:test");

        // Then
        verify(pluginMapper, times(1)).selectById(1L);
        verify(pluginMapper, times(1)).deleteById(1L);
    }

    @Test
    void testListPlugins_Success() {
        // Given
        PluginQueryDTO query = new PluginQueryDTO();
        query.setPage(1);
        query.setPageSize(20);
        query.setCategory("productivity");
        query.setSort("popular");

        Page<Plugin> mockPage = new Page<>(1, 20);
        mockPage.setRecords(Arrays.asList(testPlugin));
        mockPage.setTotal(1);

        when(pluginMapper.selectPage(any(), any())).thenReturn(mockPage);

        // When
        Page<Plugin> result = pluginService.listPlugins(query);

        // Then
        assertNotNull(result);
        assertEquals(1, result.getTotal());
        assertEquals(1, result.getRecords().size());
        verify(pluginMapper, times(1)).selectPage(any(), any());
    }

    @Test
    void testGetFeaturedPlugins_Success() {
        // Given
        when(pluginMapper.getFeaturedPlugins(10)).thenReturn(Arrays.asList(testPlugin));

        // When
        List<Plugin> result = pluginService.getFeaturedPlugins(10);

        // Then
        assertNotNull(result);
        assertEquals(1, result.size());
        verify(pluginMapper, times(1)).getFeaturedPlugins(10);
    }

    @Test
    void testGetPopularPlugins_Success() {
        // Given
        when(pluginMapper.getPopularPlugins(20)).thenReturn(Arrays.asList(testPlugin));

        // When
        List<Plugin> result = pluginService.getPopularPlugins(20);

        // Then
        assertNotNull(result);
        assertEquals(1, result.size());
        verify(pluginMapper, times(1)).getPopularPlugins(20);
    }

    @Test
    void testSearchPlugins_Success() {
        // Given
        when(pluginMapper.searchPlugins("test", "productivity", true, "rating"))
                .thenReturn(Arrays.asList(testPlugin));

        // When
        List<Plugin> result = pluginService.searchPlugins("test", "productivity", true, "rating");

        // Then
        assertNotNull(result);
        assertEquals(1, result.size());
        verify(pluginMapper, times(1)).searchPlugins("test", "productivity", true, "rating");
    }

    @Test
    void testIncrementDownloads_Success() {
        // Given
        when(pluginMapper.incrementDownloads(1L)).thenReturn(1);

        // When
        pluginService.incrementDownloads(1L);

        // Then
        verify(pluginMapper, times(1)).incrementDownloads(1L);
    }

    @Test
    void testApprovePlugin_Success() {
        // Given
        when(pluginMapper.selectById(1L)).thenReturn(testPlugin);
        when(pluginMapper.updateById(any(Plugin.class))).thenReturn(1);

        // When
        pluginService.approvePlugin(1L);

        // Then
        verify(pluginMapper, times(1)).selectById(1L);
        verify(pluginMapper, times(1)).updateById(any(Plugin.class));
    }

    @Test
    void testRejectPlugin_Success() {
        // Given
        when(pluginMapper.selectById(1L)).thenReturn(testPlugin);
        when(pluginMapper.updateById(any(Plugin.class))).thenReturn(1);

        // When
        pluginService.rejectPlugin(1L, "Policy violation");

        // Then
        verify(pluginMapper, times(1)).selectById(1L);
        verify(pluginMapper, times(1)).updateById(any(Plugin.class));
    }

    @Test
    void testGetPluginVersions_Success() {
        // Given
        when(pluginVersionMapper.getVersionsByPluginId(1L)).thenReturn(Arrays.asList(testVersion));

        // When
        List<PluginVersion> result = pluginService.getPluginVersions(1L);

        // Then
        assertNotNull(result);
        assertEquals(1, result.size());
        verify(pluginVersionMapper, times(1)).getVersionsByPluginId(1L);
    }
}
