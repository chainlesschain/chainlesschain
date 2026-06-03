package com.chainlesschain.project.controller;

import com.chainlesschain.project.dto.ApiResponse;
import com.chainlesschain.project.dto.CollaboratorAddRequest;
import com.chainlesschain.project.dto.CollaboratorDTO;
import com.chainlesschain.project.dto.PermissionUpdateRequest;
import com.chainlesschain.project.service.CollaboratorService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.*;

import java.util.List;

/**
 * 项目协作者控制器
 */
@Slf4j
@RestController
@RequestMapping("/api/projects/{projectId}/collaborators")
@RequiredArgsConstructor
public class CollaboratorController {

    private final CollaboratorService collaboratorService;

    /**
     * 获取协作者列表
     */
    @GetMapping
    public ApiResponse<List<CollaboratorDTO>> listCollaborators(@PathVariable String projectId) {
        try {
            List<CollaboratorDTO> collaborators = collaboratorService.listCollaborators(projectId);
            return ApiResponse.success(collaborators);
        } catch (Exception e) {
            log.error("获取协作者列表失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 添加协作者
     */
    @PostMapping
    public ApiResponse<CollaboratorDTO> addCollaborator(
            @PathVariable String projectId,
            @Validated @RequestBody CollaboratorAddRequest request,
            @RequestHeader(value = "User-DID", required = false) String invitedBy) {
        try {
            if (invitedBy == null) {
                invitedBy = "system";  // 默认值
            }
            CollaboratorDTO collaborator = collaboratorService.addCollaborator(projectId, request, invitedBy);
            return ApiResponse.success("协作者添加成功", collaborator);
        } catch (Exception e) {
            log.error("添加协作者失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 更新权限
     */
    @PutMapping("/{collaboratorId}")
    public ApiResponse<CollaboratorDTO> updatePermissions(
            @PathVariable String projectId,
            @PathVariable String collaboratorId,
            @Validated @RequestBody PermissionUpdateRequest request) {
        try {
            CollaboratorDTO collaborator = collaboratorService.updatePermissions(projectId, collaboratorId, request);
            return ApiResponse.success("权限更新成功", collaborator);
        } catch (Exception e) {
            log.error("更新权限失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 移除协作者
     */
    @DeleteMapping("/{collaboratorId}")
    public ApiResponse<Void> removeCollaborator(
            @PathVariable String projectId,
            @PathVariable String collaboratorId) {
        try {
            collaboratorService.removeCollaborator(projectId, collaboratorId);
            return ApiResponse.success("协作者移除成功", null);
        } catch (Exception e) {
            log.error("移除协作者失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }

    /**
     * 接受邀请
     */
    @PostMapping("/{collaboratorId}/accept")
    public ApiResponse<CollaboratorDTO> acceptInvitation(
            @PathVariable String projectId,
            @PathVariable String collaboratorId) {
        try {
            CollaboratorDTO collaborator = collaboratorService.acceptInvitation(projectId, collaboratorId);
            return ApiResponse.success("邀请已接受", collaborator);
        } catch (Exception e) {
            log.error("接受邀请失败", e);
            return ApiResponse.error(e.getMessage());
        }
    }
}
