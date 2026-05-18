package com.chainlesschain.marketplace.integration;

import com.chainlesschain.marketplace.dto.PluginDTO;
import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.mapper.PluginMapper;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.security.test.context.support.WithMockUser;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.transaction.annotation.Transactional;

import java.util.Arrays;

import static org.hamcrest.Matchers.*;
import static org.springframework.security.test.web.servlet.request.SecurityMockMvcRequestPostProcessors.csrf;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/**
 * Plugin API Integration Tests
 * 插件API集成测试
 *
 * @author ChainlessChain Team
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
@Transactional
class PluginIntegrationTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private PluginMapper pluginMapper;

    private PluginDTO testPluginDTO;

    @BeforeEach
    void setUp() {
        testPluginDTO = new PluginDTO();
        testPluginDTO.setPluginId("integration-test-plugin");
        testPluginDTO.setName("Integration Test Plugin");
        testPluginDTO.setVersion("1.0.0");
        testPluginDTO.setDescription("Plugin for integration testing");
        testPluginDTO.setCategory("productivity");
        testPluginDTO.setTags(Arrays.asList("test", "integration"));
        testPluginDTO.setLicense("MIT");
    }

    @Test
    void testPluginLifecycle() throws Exception {
        // 1. Create plugin
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

        String createResponse = mockMvc.perform(multipart("/plugins")
                        .file(pluginJson)
                        .file(pluginFile)
                        .with(csrf())
                        .with(request -> {
                            request.setRemoteUser("did:example:test");
                            return request;
                        }))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.name").value("Integration Test Plugin"))
                .andExpect(jsonPath("$.data.status").value("pending"))
                .andReturn()
                .getResponse()
                .getContentAsString();

        // Extract plugin ID from response
        Long pluginId = objectMapper.readTree(createResponse)
                .get("data")
                .get("id")
                .asLong();

        // 2. Get plugin details
        mockMvc.perform(get("/plugins/" + pluginId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.id").value(pluginId))
                .andExpect(jsonPath("$.data.name").value("Integration Test Plugin"));

        // 3. Update plugin
        testPluginDTO.setName("Updated Integration Test Plugin");
        mockMvc.perform(put("/plugins/" + pluginId)
                        .with(csrf())
                        .with(request -> {
                            request.setRemoteUser("did:example:test");
                            return request;
                        })
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(testPluginDTO)))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.name").value("Updated Integration Test Plugin"));

        // 4. Approve plugin (as admin)
        mockMvc.perform(post("/plugins/" + pluginId + "/approve")
                        .with(csrf())
                        .with(request -> {
                            request.setRemoteUser("admin");
                            return request;
                        }))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        // 5. Verify plugin is approved
        mockMvc.perform(get("/plugins/" + pluginId))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.data.status").value("approved"));

        // 6. Download plugin
        mockMvc.perform(get("/plugins/" + pluginId + "/download")
                        .param("version", "1.0.0"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isString());

        // 7. Delete plugin
        mockMvc.perform(delete("/plugins/" + pluginId)
                        .with(csrf())
                        .with(request -> {
                            request.setRemoteUser("did:example:test");
                            return request;
                        }))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        // 8. Verify plugin is deleted
        mockMvc.perform(get("/plugins/" + pluginId))
                .andExpect(status().isNotFound());
    }

    @Test
    void testSearchAndFilter() throws Exception {
        // Test search
        mockMvc.perform(get("/plugins/search")
                        .param("keyword", "translator")
                        .param("category", "ai")
                        .param("verified", "true")
                        .param("sort", "rating"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray());

        // Test featured plugins
        mockMvc.perform(get("/plugins/featured")
                        .param("limit", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data", hasSize(lessThanOrEqualTo(10))));

        // Test popular plugins
        mockMvc.perform(get("/plugins/popular")
                        .param("limit", "20"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray())
                .andExpect(jsonPath("$.data", hasSize(lessThanOrEqualTo(20))));
    }

    @Test
    void testPagination() throws Exception {
        // Test first page
        mockMvc.perform(get("/plugins")
                        .param("page", "1")
                        .param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.current").value(1))
                .andExpect(jsonPath("$.data.size").value(10))
                .andExpect(jsonPath("$.data.records").isArray());

        // Test second page
        mockMvc.perform(get("/plugins")
                        .param("page", "2")
                        .param("pageSize", "10"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.current").value(2));
    }

    @Test
    @WithMockUser(username = "unauthorized", roles = {"USER"})
    void testUnauthorizedUpdate() throws Exception {
        // Try to update someone else's plugin
        mockMvc.perform(put("/plugins/1")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(objectMapper.writeValueAsString(testPluginDTO)))
                .andExpect(status().isForbidden());
    }

    @Test
    @WithMockUser(username = "user", roles = {"USER"})
    void testUnauthorizedApproval() throws Exception {
        // Try to approve plugin without admin role
        mockMvc.perform(post("/plugins/1/approve")
                        .with(csrf()))
                .andExpect(status().isForbidden());
    }

    @Test
    void testValidation() throws Exception {
        // Test with invalid plugin data
        PluginDTO invalidDTO = new PluginDTO();
        // Missing required fields

        MockMultipartFile pluginJson = new MockMultipartFile(
                "plugin",
                "",
                "application/json",
                objectMapper.writeValueAsBytes(invalidDTO)
        );

        MockMultipartFile pluginFile = new MockMultipartFile(
                "file",
                "plugin.zip",
                "application/zip",
                "test content".getBytes()
        );

        mockMvc.perform(multipart("/plugins")
                        .file(pluginJson)
                        .file(pluginFile)
                        .with(csrf())
                        .with(request -> {
                            request.setRemoteUser("did:example:test");
                            return request;
                        }))
                .andExpect(status().isBadRequest());
    }

    @Test
    void testCategoryEndpoints() throws Exception {
        // Get all categories
        mockMvc.perform(get("/categories"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray());

        // Get specific category
        mockMvc.perform(get("/categories/ai"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data.code").value("ai"));
    }

    @Test
    @WithMockUser(username = "did:example:test", roles = {"USER"})
    void testRatingEndpoints() throws Exception {
        // Submit rating
        String ratingJson = "{\"rating\": 5, \"comment\": \"Excellent plugin!\"}";

        mockMvc.perform(post("/plugins/1/ratings")
                        .with(csrf())
                        .contentType(MediaType.APPLICATION_JSON)
                        .content(ratingJson))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true));

        // Get ratings
        mockMvc.perform(get("/plugins/1/ratings"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.success").value(true))
                .andExpect(jsonPath("$.data").isArray());
    }
}
