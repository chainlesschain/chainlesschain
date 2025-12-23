package com.chainlesschain.project.dto;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * 项目文件响应DTO
 */
@Data
public class ProjectFileDTO {

    private String id;

    private String projectId;

    private String filePath;

    private String fileName;

    private String fileType;

    private String language;

    private Long fileSize;

    private Integer version;

    private String commitHash;

    private String generatedBy;

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;

    // 可选：完整内容（根据需要返回）
    private String content;
}
