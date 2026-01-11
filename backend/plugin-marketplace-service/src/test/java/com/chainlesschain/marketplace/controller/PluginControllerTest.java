package com.chainlesschain.marketplace.controller;

import com.chainlesschain.marketplace.dto.ApiResponse;
import com.chainlesschain.marketplace.dto.PluginDTO;
import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.service.PluginService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.WebMvcTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.web.servlet.MockMvc;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.Arrays;
import java.util.List;

import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Plugin Controller Unit Tests
 * 插件控制器单元测试
 *
 * @author ChainlessChain Team
 */
@WebMvcTest(PluginController.class)
class PluginControllerTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @MockBean
    private PluginService pluginService;

    private Plugin testPlugin;
    private PluginDTO testPluginDTO;

    @BeforeEach
    void setUp() {
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
        testPlugin.setDownloads(100);
        testPlugin.setRating(new BigDecimal("4.5"));
        testPlugin.setRatingCount(10);
        testPlugin.setCreatedAt(LocalDateTime.now());

        testPluginDTO = new PluginDTO();
        testPluginDTO.setPluginId("test-plugin");
        testPluginDTO.setName("Test Plugin");
        testPluginDTO.setVersion("1.0.0");
        testPluginDTO.setDescription("Test Description");
        testPluginDTO.setCategory("productivity");
        testPluginDTO.setTags(Arrays.asList("test", "example"));
        testPluginDTO.setLicense("MIT");
    }

    @Test
    void testGetPlugin_Success() throws Exception {
        // Given
        when(pluginService.getPluginById(1L)).thenReturn(testPlugin);

        // When & Then
        mockMvc.perform(get("/plugins/1"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(1))
                .andExpect(jsonPath("$.data.name").value("Test Plugin"));

        verify(pluginService, times(1)).getPluginById(1L);
    }

    @Test
    void testGetFeaturedPlugins_Success() throws Exception {
        // Given
        when(pluginService.getFeaturedPlugins(10)).thenReturn(Arrays.asList(testPlugin));

        // When & Then
        mockMvc.perform(get("/plugins/featured")
                        .param("limit", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data[0].name").value("Test Plugin"));

        verify(pluginService, times(1)).getFeaturedPlugins(10);
    }

    @Test
    void testGetPopularPlugins_Success() throws Exception {
        // Given
        when(pluginService.getPopularPlugins(20)).thenReturn(Arrays.asList(testPlugin));

        // When & Then
        mockMvc.perform(get("/plugins/popular")
                        .param("limit", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray());

        verify(pluginService, times(1)).getPopularPlugins(20);
    }

    @Test
    void testSearchPlugins_Success() throws Exception {
        // Given
        when(pluginService.searchPlugins("test", "productivity", true, "rating"))
                .thenReturn(Arrays.asList(testPlugin));

        // When & Then
        mockMvc.perform(get("/plugins/search")
                        .param("keyword", "test")
                        .param("category", "productivity")
                        .param("verified", "true")
                        .param("sort", "rating"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray());

        verify(pluginService, times(1)).searchPlugins("test", "productivity", true, "rating");
    }

    @Test
    @WithMockUser(username = "did:example:test", roles = {"USER"})
    void testCreatePlugin_Success() throws Exception {
        // Given
        MockMultipartFile pluginJson = new MockMultipartFile(
                "plugin",
                "",
                "application/json",
                objectMapper.writeValueAsBytes(testPluginDTO)
        );

        MockMultipartFile pluginFile = new MockMultipartFile(
                "file",
                "plugin.zip",
                "application/zip",
                "test content".getBytes()
        );

        when(pluginService.createPlugin(any(), anyString(), anyString(), anyLong(), anyString()))
                .thenReturn(testPlugin);

        // When & Then
        mockMvc.perform(multipart("/plugins")
                        .file(pluginJson)
                        .file(pluginFile)
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.name").value("Test Plugin"));

        verify(pluginService, times(1)).createPlugin(any(), anyString(), anyString(), anyLong(), anyString());
    }

    @Test
    @WithMockUser(username = "did:example:test", roles = {"USER"})
    void testUpdatePlugin_Success() throws Exception {
        // Given
        when(pluginService.updatePlugin(eq(1L), any(), anyString())).thenReturn(testPlugin);

        // When & Then
        mockMvc.perform(put("/plugins/1")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(testPluginDTO)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        verify(pluginService, times(1)).updatePlugin(eq(1L), any(), anyString());
    }

    @Test
    @WithMockUser(username = "did:example:test", roles = {"USER"})
    void testDeletePlugin_Success() throws Exception {
        // Given
        doNothing().when(pluginService).deletePlugin(1L, "did:example:test");

        // When & Then
        mockMvc.perform(delete("/plugins/1")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        verify(pluginService, times(1)).deletePlugin(1L, "did:example:test");
    }

    @Test
    void testDownloadPlugin_Success() throws Exception {
        // Given
        String downloadUrl = "https://example.com/plugin.zip";
        when(pluginService.getDownloadUrl(1L, "1.0.0")).thenReturn(downloadUrl);
        doNothing().when(pluginService).incrementDownloads(1L);

        // When & Then
        mockMvc.perform(get("/plugins/1/download")
                        .param("version", "1.0.0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").value(downloadUrl));

        verify(pluginService, times(1)).getDownloadUrl(1L, "1.0.0");
        verify(pluginService, times(1)).incrementDownloads(1L);
    }

    @Test
    @WithMockUser(username = "admin", roles = {"ADMIN"})
    void testApprovePlugin_Success() throws Exception {
        // Given
        doNothing().when(pluginService).approvePlugin(1L);

        // When & Then
        mockMvc.perform(post("/plugins/1/approve")
                        .with(csrf()))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        verify(pluginService, times(1)).approvePlugin(1L);
    }

    @Test
    @WithMockUser(username = "admin", roles = {"ADMIN"})
    void testRejectPlugin_Success() throws Exception {
        // Given
        doNothing().when(pluginService).rejectPlugin(1L, "Policy violation");

        // When & Then
        mockMvc.perform(post("/plugins/1/reject")
                        .with(csrf())
                        .param("reason", "Policy violation"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        verify(pluginService, times(1)).rejectPlugin(1L, "Policy violation");
    }

    @Test
    @WithMockUser(username = "user", roles = {"USER"})
    void testApprovePlugin_Forbidden() throws Exception {
        // When & Then
        mockMvc.perform(post("/plugins/1/approve")
                        .with(csrf()))
                .andExpect(status().isForbidden());

        verify(pluginService, never()).approvePlugin(anyLong());
    }
}
