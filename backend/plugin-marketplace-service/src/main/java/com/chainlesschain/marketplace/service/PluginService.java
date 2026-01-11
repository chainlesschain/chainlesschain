package com.chainlesschain.marketplace.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.marketplace.dto.PluginDTO;
import com.chainlesschain.marketplace.dto.PluginQueryDTO;
import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.entity.PluginVersion;
import com.chainlesschain.marketplace.mapper.PluginMapper;
import com.chainlesschain.marketplace.mapper.PluginVersionMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.cache.annotation.CacheEvict;
import org.springframework.cache.annotation.Cacheable;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.math.BigDecimal;
import java.time.LocalDateTime;
import java.util.List;

/**
 * Plugin Service
 * 插件业务逻辑服务
 *
 * @author ChainlessChain Team
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PluginService {

    private final PluginMapper pluginMapper;
    private final PluginVersionMapper pluginVersionMapper;

    /**
     * Get plugin list with pagination
     */
    public Page<Plugin> listPlugins(PluginQueryDTO query) {
        Page<Plugin> page = new Page<>(query.getPage(), query.getPageSize());

        QueryWrapper<Plugin> wrapper = new QueryWrapper<>();
        wrapper.eq("deleted", false);

        // Filter by status
        if (query.getStatus() != null) {
            wrapper.eq("status", query.getStatus());
        } else {
            wrapper.eq("status", "approved");
        }

        // Filter by category
        if (query.getCategory() != null && !query.getCategory().isEmpty()) {
            wrapper.eq("category", query.getCategory());
        }

        // Filter by verified
        if (query.getVerified() != null) {
            wrapper.eq("verified", query.getVerified());
        }

        // Search by keyword
        if (query.getSearch() != null && !query.getSearch().isEmpty()) {
            wrapper.and(w -> w
                    .like("name", query.getSearch())
                    .or()
                    .like("description", query.getSearch())
            );
        }

        // Sort
        switch (query.getSort()) {
            case "recent":
                wrapper.orderByDesc("published_at");
                break;
            case "rating":
                wrapper.orderByDesc("rating").orderByDesc("rating_count");
                break;
            case "downloads":
                wrapper.orderByDesc("downloads");
                break;
            default:  // popular
                wrapper.orderByDesc("downloads").orderByDesc("rating");
        }

        return pluginMapper.selectPage(page, wrapper);
    }

    /**
     * Get plugin by ID
     */
    @Cacheable(value = "plugins", key = "#id")
    public Plugin getPluginById(Long id) {
        Plugin plugin = pluginMapper.selectById(id);
        if (plugin != null) {
            // Load versions
            List<PluginVersion> versions = pluginVersionMapper.getVersionsByPluginId(id);
            plugin.setVersions(versions);
        }
        return plugin;
    }

    /**
     * Get plugin by plugin ID
     */
    @Cacheable(value = "plugins", key = "'pid_' + #pluginId")
    public Plugin getPluginByPluginId(String pluginId) {
        QueryWrapper<Plugin> wrapper = new QueryWrapper<>();
        wrapper.eq("plugin_id", pluginId).eq("deleted", false);
        Plugin plugin = pluginMapper.selectOne(wrapper);
        if (plugin != null) {
            List<PluginVersion> versions = pluginVersionMapper.getVersionsByPluginId(plugin.getId());
            plugin.setVersions(versions);
        }
        return plugin;
    }

    /**
     * Create plugin
     */
    @Transactional
    @CacheEvict(value = "plugins", allEntries = true)
    public Plugin createPlugin(PluginDTO dto, String authorDid, String fileUrl, Long fileSize, String fileHash) {
        // Check if plugin ID already exists
        QueryWrapper<Plugin> wrapper = new QueryWrapper<>();
        wrapper.eq("plugin_id", dto.getPluginId());
        if (pluginMapper.selectCount(wrapper) > 0) {
            throw new RuntimeException("Plugin ID already exists");
        }

        Plugin plugin = new Plugin();
        plugin.setPluginId(dto.getPluginId());
        plugin.setName(dto.getName());
        plugin.setDisplayName(dto.getDisplayName());
        plugin.setVersion(dto.getVersion());
        plugin.setAuthorDid(authorDid);
        plugin.setDescription(dto.getDescription());
        plugin.setLongDescription(dto.getLongDescription());
        plugin.setCategory(dto.getCategory());
        plugin.setTags(dto.getTags());
        plugin.setIconUrl(dto.getIconUrl());
        plugin.setHomepage(dto.getHomepage());
        plugin.setRepository(dto.getRepository());
        plugin.setLicense(dto.getLicense());
        plugin.setFileUrl(fileUrl);
        plugin.setFileSize(fileSize);
        plugin.setFileHash(fileHash);
        plugin.setStatus("pending");
        plugin.setVerified(false);
        plugin.setFeatured(false);
        plugin.setDownloads(0);
        plugin.setRating(BigDecimal.ZERO);
        plugin.setRatingCount(0);
        plugin.setMinVersion(dto.getMinVersion());
        plugin.setMaxVersion(dto.getMaxVersion());
        plugin.setPermissions(dto.getPermissions());
        plugin.setDependencies(dto.getDependencies());

        pluginMapper.insert(plugin);

        // Create first version
        PluginVersion version = new PluginVersion();
        version.setPluginId(plugin.getId());
        version.setVersion(dto.getVersion());
        version.setChangelog("Initial release");
        version.setFileUrl(fileUrl);
        version.setFileSize(fileSize);
        version.setFileHash(fileHash);
        version.setDownloads(0);
        version.setStatus("active");
        pluginVersionMapper.insert(version);

        log.info("Plugin created: {} by {}", plugin.getPluginId(), authorDid);
        return plugin;
    }

    /**
     * Update plugin
     */
    @Transactional
    @CacheEvict(value = "plugins", allEntries = true)
    public Plugin updatePlugin(Long id, PluginDTO dto, String authorDid) {
        Plugin plugin = pluginMapper.selectById(id);
        if (plugin == null) {
            throw new RuntimeException("Plugin not found");
        }

        // Check permission
        if (!plugin.getAuthorDid().equals(authorDid)) {
            throw new RuntimeException("Permission denied");
        }

        plugin.setName(dto.getName());
        plugin.setDisplayName(dto.getDisplayName());
        plugin.setDescription(dto.getDescription());
        plugin.setLongDescription(dto.getLongDescription());
        plugin.setCategory(dto.getCategory());
        plugin.setTags(dto.getTags());
        plugin.setIconUrl(dto.getIconUrl());
        plugin.setHomepage(dto.getHomepage());
        plugin.setRepository(dto.getRepository());
        plugin.setLicense(dto.getLicense());
        plugin.setMinVersion(dto.getMinVersion());
        plugin.setMaxVersion(dto.getMaxVersion());
        plugin.setPermissions(dto.getPermissions());
        plugin.setDependencies(dto.getDependencies());

        pluginMapper.updateById(plugin);
        log.info("Plugin updated: {}", plugin.getPluginId());
        return plugin;
    }

    /**
     * Delete plugin
     */
    @Transactional
    @CacheEvict(value = "plugins", allEntries = true)
    public void deletePlugin(Long id, String authorDid) {
        Plugin plugin = pluginMapper.selectById(id);
        if (plugin == null) {
            throw new RuntimeException("Plugin not found");
        }

        // Check permission
        if (!plugin.getAuthorDid().equals(authorDid)) {
            throw new RuntimeException("Permission denied");
        }

        pluginMapper.deleteById(id);
        log.info("Plugin deleted: {}", plugin.getPluginId());
    }

    /**
     * Approve plugin (admin only)
     */
    @Transactional
    @CacheEvict(value = "plugins", allEntries = true)
    public void approvePlugin(Long id) {
        Plugin plugin = pluginMapper.selectById(id);
        if (plugin == null) {
            throw new RuntimeException("Plugin not found");
        }

        plugin.setStatus("approved");
        plugin.setPublishedAt(LocalDateTime.now());
        pluginMapper.updateById(plugin);
        log.info("Plugin approved: {}", plugin.getPluginId());
    }

    /**
     * Reject plugin (admin only)
     */
    @Transactional
    @CacheEvict(value = "plugins", allEntries = true)
    public void rejectPlugin(Long id, String reason) {
        Plugin plugin = pluginMapper.selectById(id);
        if (plugin == null) {
            throw new RuntimeException("Plugin not found");
        }

        plugin.setStatus("rejected");
        pluginMapper.updateById(plugin);
        log.info("Plugin rejected: {} - Reason: {}", plugin.getPluginId(), reason);
    }

    /**
     * Get featured plugins
     */
    @Cacheable(value = "featured_plugins", key = "#limit")
    public List<Plugin> getFeaturedPlugins(Integer limit) {
        return pluginMapper.getFeaturedPlugins(limit);
    }

    /**
     * Get popular plugins
     */
    @Cacheable(value = "popular_plugins", key = "#limit")
    public List<Plugin> getPopularPlugins(Integer limit) {
        return pluginMapper.getPopularPlugins(limit);
    }

    /**
     * Search plugins
     */
    public List<Plugin> searchPlugins(String keyword, String category, Boolean verified, String sort) {
        return pluginMapper.searchPlugins(keyword, category, verified, sort);
    }

    /**
     * Increment download count
     */
    @Transactional
    public void incrementDownloads(Long id) {
        pluginMapper.incrementDownloads(id);
    }
}
