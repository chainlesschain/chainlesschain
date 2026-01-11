package com.chainlesschain.marketplace.controller;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.marketplace.dto.ApiResponse;
import com.chainlesschain.marketplace.dto.PluginDTO;
import com.chainlesschain.marketplace.dto.PluginQueryDTO;
import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.exception.ResourceNotFoundException;
import com.chainlesschain.marketplace.service.PluginService;
import jakarta.validation.Valid;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.core.Authentication;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;

import java.util.List;

/**
 * Plugin Controller
 * 插件REST API控制器
 *
 * @author ChainlessChain Team
 */
@Slf4j
@RestController
@RequestMapping("/plugins")
@RequiredArgsConstructor
public class PluginController {

    private final PluginService pluginService;

    /**
     * Get plugin list
     * GET /plugins
     */
    @GetMapping
    public ApiResponse<Page<Plugin>> listPlugins(@Valid PluginQueryDTO query) {
        log.info("List plugins: {}", query);
        Page<Plugin> result = pluginService.listPlugins(query);
        return ApiResponse.success(result);
    }

    /**
     * Get plugin by ID
     * GET /plugins/{id}
     */
    @GetMapping("/{id}")
    public ApiResponse<Plugin> getPlugin(@PathVariable Long id) {
        log.info("Get plugin: {}", id);
        Plugin plugin = pluginService.getPluginById(id);
        if (plugin == null) {
            throw new ResourceNotFoundException("Plugin", id.toString());
        }
        return ApiResponse.success(plugin);
    }

    /**
     * Get plugin by plugin ID
     * GET /plugins/by-plugin-id/{pluginId}
     */
    @GetMapping("/by-plugin-id/{pluginId}")
    public ApiResponse<Plugin> getPluginByPluginId(@PathVariable String pluginId) {
        log.info("Get plugin by plugin ID: {}", pluginId);
        Plugin plugin = pluginService.getPluginByPluginId(pluginId);
        if (plugin == null) {
            throw new ResourceNotFoundException("Plugin", pluginId);
        }
        return ApiResponse.success(plugin);
    }

    /**
     * Create plugin
     * POST /plugins
     */
    @PostMapping
    public ApiResponse<Plugin> createPlugin(
            @Valid @RequestPart("plugin") PluginDTO dto,
            @RequestPart("file") MultipartFile file,
            Authentication authentication) {
        log.info("Create plugin: {}", dto.getPluginId());

        // Get user DID from authentication
        String userDid = authentication.getName();

        // TODO: Upload file to storage and get URL
        String fileUrl = "https://storage.example.com/" + file.getOriginalFilename();
        Long fileSize = file.getSize();
        String fileHash = "hash123";  // TODO: Calculate file hash

        Plugin plugin = pluginService.createPlugin(dto, userDid, fileUrl, fileSize, fileHash);
        return ApiResponse.success(plugin, "Plugin created successfully");
    }

    /**
     * Update plugin
     * PUT /plugins/{id}
     */
    @PutMapping("/{id}")
    public ApiResponse<Plugin> updatePlugin(
            @PathVariable Long id,
            @Valid @RequestBody PluginDTO dto,
            Authentication authentication) {
        log.info("Update plugin: {}", id);

        String userDid = authentication.getName();
        Plugin plugin = pluginService.updatePlugin(id, dto, userDid);
        return ApiResponse.success(plugin, "Plugin updated successfully");
    }

    /**
     * Delete plugin
     * DELETE /plugins/{id}
     */
    @DeleteMapping("/{id}")
    public ApiResponse<Void> deletePlugin(
            @PathVariable Long id,
            Authentication authentication) {
        log.info("Delete plugin: {}", id);

        String userDid = authentication.getName();
        pluginService.deletePlugin(id, userDid);
        return ApiResponse.successMessage("Plugin deleted successfully");
    }

    /**
     * Get featured plugins
     * GET /plugins/featured
     */
    @GetMapping("/featured")
    public ApiResponse<List<Plugin>> getFeaturedPlugins(
            @RequestParam(defaultValue = "10") Integer limit) {
        log.info("Get featured plugins: limit={}", limit);
        List<Plugin> plugins = pluginService.getFeaturedPlugins(limit);
        return ApiResponse.success(plugins);
    }

    /**
     * Get popular plugins
     * GET /plugins/popular
     */
    @GetMapping("/popular")
    public ApiResponse<List<Plugin>> getPopularPlugins(
            @RequestParam(defaultValue = "20") Integer limit) {
        log.info("Get popular plugins: limit={}", limit);
        List<Plugin> plugins = pluginService.getPopularPlugins(limit);
        return ApiResponse.success(plugins);
    }

    /**
     * Search plugins
     * GET /plugins/search
     */
    @GetMapping("/search")
    public ApiResponse<List<Plugin>> searchPlugins(
            @RequestParam(required = false) String keyword,
            @RequestParam(required = false) String category,
            @RequestParam(required = false) Boolean verified,
            @RequestParam(defaultValue = "popular") String sort) {
        log.info("Search plugins: keyword={}, category={}, verified={}, sort={}",
                keyword, category, verified, sort);
        List<Plugin> plugins = pluginService.searchPlugins(keyword, category, verified, sort);
        return ApiResponse.success(plugins);
    }

    /**
     * Download plugin
     * GET /plugins/{id}/download
     */
    @GetMapping("/{id}/download")
    public ApiResponse<String> downloadPlugin(
            @PathVariable Long id,
            @RequestParam(required = false) String version) {
        log.info("Download plugin: id={}, version={}", id, version);

        Plugin plugin = pluginService.getPluginById(id);
        if (plugin == null) {
            throw new ResourceNotFoundException("Plugin", id.toString());
        }

        // Increment download count
        pluginService.incrementDownloads(id);

        // Return download URL
        return ApiResponse.success("Download URL", plugin.getFileUrl());
    }

    /**
     * Approve plugin (admin only)
     * POST /plugins/{id}/approve
     */
    @PostMapping("/{id}/approve")
    public ApiResponse<Void> approvePlugin(@PathVariable Long id) {
        log.info("Approve plugin: {}", id);
        pluginService.approvePlugin(id);
        return ApiResponse.successMessage("Plugin approved successfully");
    }

    /**
     * Reject plugin (admin only)
     * POST /plugins/{id}/reject
     */
    @PostMapping("/{id}/reject")
    public ApiResponse<Void> rejectPlugin(
            @PathVariable Long id,
            @RequestParam String reason) {
        log.info("Reject plugin: {}, reason: ", id, reason);
        pluginService.rejectPlugin(id, reason);
        return ApiResponse.successMessage("Plugin rejected");
    }
}
