package com.chainlesschain.project.dto;

import lombok.Data;
import java.time.LocalDateTime;

/**
 * 协作者响应DTO
 */
@Data
public class CollaboratorDTO {

    private String id;

    private String projectId;

    private String collaboratorDid;

    private String collaboratorName;  // 从DID解析或缓存

    private String role;  // owner, admin, developer, viewer

    private String permissions;  // read, write, admin

    private String invitedBy;

    private LocalDateTime invitedAt;

    private LocalDateTime acceptedAt;

    private String status;  // pending, accepted, rejected

    private LocalDateTime createdAt;

    private LocalDateTime updatedAt;
}
