package com.chainlesschain.marketplace.dto;

import lombok.Data;
import jakarta.validation.constraints.*;
import java.util.List;

/**
 * Plugin Create/Update DTO
 * 插件创建/更新参数
 */
@Data
public class PluginDTO {

    @NotBlank(message = "Plugin ID cannot be empty")
    @Pattern(regexp = "^[a-z0-9-]+$", message = "Plugin ID can only contain lowercase letters, numbers and hyphens")
    private String pluginId;

    @NotBlank(message = "Name cannot be empty")
    @Size(max = 200, message = "Name cannot exceed 200 characters")
    private String name;

    @Size(max = 200, message = "Display name cannot exceed 200 characters")
    private String displayName;

    @NotBlank(message = "Version cannot be empty")
    @Pattern(regexp = "^\\d+\\.\\d+\\.\\d+$", message = "Version must follow semantic versioning (e.g., 1.0.0)")
    private String version;

    @NotBlank(message = "Description cannot be empty")
    @Size(max = 1000, message = "Description cannot exceed 1000 characters")
    private String description;

    private String longDescription;

    @NotBlank(message = "Category cannot be empty")
    private String category;

    private List<String> tags;

    private String iconUrl;

    private String homepage;

    private String repository;

    private String license;

    private String minVersion;

    private String maxVersion;

    private List<String> permissions;

    private Object dependencies;
}
