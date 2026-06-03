package com.chainlesschain.manufacturer.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;
import java.time.LocalDateTime;

/**
 * APP版本实体类
 */
@Data
@TableName("app_versions")
public class AppVersion {

    @TableId(type = IdType.AUTO)
    private Long id;

    private String versionId;

    private String appType;  // PC_WINDOWS, PC_MAC, PC_LINUX, MOBILE_ANDROID, MOBILE_IOS

    private String versionName;  // 如: 1.0.0

    private Integer versionCode;  // 递增的版本号

    private String appName;

    private String packageName;

    private String fileName;

    private Long fileSize;

    private String fileUrl;

    private String fileHash;  // SHA256

    private String status;  // DRAFT, TESTING, PUBLISHED, DEPRECATED

    private Integer isForceUpdate;  // 0-否, 1-是

    private String minSupportedVersion;

    private String changelog;  // Markdown格式

    private String releaseNotes;

    private Integer downloadCount;

    private Long publisherId;

    private LocalDateTime publishedAt;

    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;

    @TableField(fill = FieldFill.INSERT_UPDATE)
    private LocalDateTime updatedAt;

    @TableLogic
    private Integer deleted;
}
