package com.chainlesschain.marketplace.service;

import com.chainlesschain.marketplace.entity.Plugin;
import com.chainlesschain.marketplace.entity.PluginVersion;
import com.chainlesschain.marketplace.exception.BusinessException;
import com.chainlesschain.marketplace.exception.ResourceNotFoundException;
import com.chainlesschain.marketplace.mapper.PluginMapper;
import com.chainlesschain.marketplace.mapper.PluginVersionMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;

import java.time.LocalDateTime;
import java.util.List;
import java.util.regex.Pattern;

/**
 * Plugin Version Management Service
 * 插件版本管理服务
 *
 * @author ChainlessChain Team
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class PluginVersionService {

    private final PluginMapper pluginMapper;
    private final PluginVersionMapper pluginVersionMapper;
    private final FileStorageService fileStorageService;

    private static final Pattern SEMVER_PATTERN = Pattern.compile(
            "^(0|[1-9]\\d*)\\.(0|[1-9]\\d*)\\.(0|[1-9]\\d*)" +
                    "(?:-((?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*)" +
                    "(?:\\.(?:0|[1-9]\\d*|\\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?" +
                    "(?:\\+([0-9a-zA-Z-]+(?:\\.[0-9a-zA-Z-]+)*))?$"
    );

    /**
     * Create new plugin version
     *
     * @param pluginId Plugin ID
     * @param version  Version string
     * @param file     Plugin file
     * @param changelog Changelog
     * @param authorDid Author DID
     * @return Created version
     */
    @Transactional
    public PluginVersion createVersion(Long pluginId, String version, MultipartFile file,
                                       String changelog, String authorDid) {
        // Validate plugin exists
        Plugin plugin = pluginMapper.selectById(pluginId);
        if (plugin == null) {
            throw new ResourceNotFoundException("Plugin not found: " + pluginId);
        }

        // Verify ownership
        if (!plugin.getAuthorDid().equals(authorDid)) {
            throw new BusinessException("You are not authorized to create versions for this plugin");
        }

        // Validate version format
        if (!isValidSemver(version)) {
            throw new BusinessException("Invalid version format. Must follow semantic versioning (e.g., 1.0.0)");
        }

        // Check if version already exists
        PluginVersion existingVersion = pluginVersionMapper.getVersionByPluginIdAndVersion(pluginId, version);
        if (existingVersion != null) {
            throw new BusinessException("Version " + version + " already exists for this plugin");
        }

        // Check if this is a valid upgrade
        List<PluginVersion> existingVersions = pluginVersionMapper.getVersionsByPluginId(pluginId);
        if (!existingVersions.isEmpty()) {
            String latestVersion = plugin.getVersion();
            if (!isNewerVersion(version, latestVersion)) {
                throw new BusinessException("New version must be greater than current version " + latestVersion);
            }
        }

        // Upload file
        String objectName = String.format("plugins/%s/%s/%s-%s.zip",
                plugin.getPluginId(), version, plugin.getPluginId(), version);
        String fileUrl = fileStorageService.uploadFile(file, objectName);

        // Calculate file hash
        String fileHash = fileStorageService.calculateFileHash(file);

        // Create version record
        PluginVersion pluginVersion = new PluginVersion();
        pluginVersion.setPluginId(pluginId);
        pluginVersion.setVersion(version);
        pluginVersion.setFileUrl(fileUrl);
        pluginVersion.setFileSize(file.getSize());
        pluginVersion.setFileHash(fileHash);
        pluginVersion.setChangelog(changelog);
        pluginVersion.setDownloads(0);
        pluginVersion.setCreatedAt(LocalDateTime.now());

        pluginVersionMapper.insert(pluginVersion);

        // Update plugin's current version
        plugin.setVersion(version);
        plugin.setUpdatedAt(LocalDateTime.now());
        pluginMapper.updateById(plugin);

        log.info("Created version {} for plugin {}", version, pluginId);
        return pluginVersion;
    }

    /**
     * Get all versions for a plugin
     *
     * @param pluginId Plugin ID
     * @return List of versions
     */
    public List<PluginVersion> getVersions(Long pluginId) {
        return pluginVersionMapper.getVersionsByPluginId(pluginId);
    }

    /**
     * Get specific version
     *
     * @param pluginId Plugin ID
     * @param version  Version string
     * @return Plugin version
     */
    public PluginVersion getVersion(Long pluginId, String version) {
        PluginVersion pluginVersion = pluginVersionMapper.getVersionByPluginIdAndVersion(pluginId, version);
        if (pluginVersion == null) {
            throw new ResourceNotFoundException("Version " + version + " not found for plugin " + pluginId);
        }
        return pluginVersion;
    }

    /**
     * Get latest version
     *
     * @param pluginId Plugin ID
     * @return Latest version
     */
    public PluginVersion getLatestVersion(Long pluginId) {
        return pluginVersionMapper.getLatestVersion(pluginId);
    }

    /**
     * Delete version
     *
     * @param pluginId  Plugin ID
     * @param version   Version string
     * @param authorDid Author DID
     */
    @Transactional
    public void deleteVersion(Long pluginId, String version, String authorDid) {
        // Validate plugin exists
        Plugin plugin = pluginMapper.selectById(pluginId);
        if (plugin == null) {
            throw new ResourceNotFoundException("Plugin not found: " + pluginId);
        }

        // Verify ownership
        if (!plugin.getAuthorDid().equals(authorDid)) {
            throw new BusinessException("You are not authorized to delete versions for this plugin");
        }

        // Get version
        PluginVersion pluginVersion = getVersion(pluginId, version);

        // Cannot delete current version if there are other versions
        List<PluginVersion> allVersions = pluginVersionMapper.getVersionsByPluginId(pluginId);
        if (allVersions.size() > 1 && version.equals(plugin.getVersion())) {
            throw new BusinessException("Cannot delete current version. Please set another version as current first.");
        }

        // Delete file from storage
        try {
            String objectName = extractObjectName(pluginVersion.getFileUrl());
            fileStorageService.deleteFile(objectName);
        } catch (Exception e) {
            log.warn("Failed to delete file from storage: {}", e.getMessage());
        }

        // Delete version record
        pluginVersionMapper.deleteById(pluginVersion.getId());

        log.info("Deleted version {} for plugin {}", version, pluginId);
    }

    /**
     * Set version as current
     *
     * @param pluginId  Plugin ID
     * @param version   Version string
     * @param authorDid Author DID
     */
    @Transactional
    public void setCurrentVersion(Long pluginId, String version, String authorDid) {
        // Validate plugin exists
        Plugin plugin = pluginMapper.selectById(pluginId);
        if (plugin == null) {
            throw new ResourceNotFoundException("Plugin not found: " + pluginId);
        }

        // Verify ownership
        if (!plugin.getAuthorDid().equals(authorDid)) {
            throw new BusinessException("You are not authorized to modify this plugin");
        }

        // Verify version exists
        PluginVersion pluginVersion = getVersion(pluginId, version);

        // Update plugin's current version
        plugin.setVersion(version);
        plugin.setUpdatedAt(LocalDateTime.now());
        pluginMapper.updateById(plugin);

        log.info("Set version {} as current for plugin {}", version, pluginId);
    }

    /**
     * Increment version download count
     *
     * @param pluginId Plugin ID
     * @param version  Version string
     */
    @Transactional
    public void incrementDownloads(Long pluginId, String version) {
        pluginVersionMapper.incrementDownloads(pluginId, version);
    }

    /**
     * Validate semantic version format
     *
     * @param version Version string
     * @return True if valid
     */
    private boolean isValidSemver(String version) {
        return SEMVER_PATTERN.matcher(version).matches();
    }

    /**
     * Compare two semantic versions
     *
     * @param newVersion New version
     * @param oldVersion Old version
     * @return True if newVersion > oldVersion
     */
    private boolean isNewerVersion(String newVersion, String oldVersion) {
        String[] newParts = newVersion.split("\\.");
        String[] oldParts = oldVersion.split("\\.");

        for (int i = 0; i < Math.min(newParts.length, oldParts.length); i++) {
            int newPart = Integer.parseInt(newParts[i].replaceAll("[^0-9]", ""));
            int oldPart = Integer.parseInt(oldParts[i].replaceAll("[^0-9]", ""));

            if (newPart > oldPart) {
                return true;
            } else if (newPart < oldPart) {
                return false;
            }
        }

        return newParts.length > oldParts.length;
    }

    /**
     * Extract object name from URL
     *
     * @param url File URL
     * @return Object name
     */
    private String extractObjectName(String url) {
        // Extract object name from MinIO URL
        // Format: http://minio:9000/bucket/object-name
        String[] parts = url.split("/");
        if (parts.length >= 2) {
            return String.join("/", java.util.Arrays.copyOfRange(parts, parts.length - 3, parts.length));
        }
        return url;
    }
}
