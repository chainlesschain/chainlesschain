package com.chainlesschain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.toolkit.IdWorker;
import com.chainlesschain.project.dto.CollaboratorAddRequest;
import com.chainlesschain.project.dto.CollaboratorDTO;
import com.chainlesschain.project.dto.PermissionUpdateRequest;
import com.chainlesschain.project.entity.ProjectCollaborator;
import com.chainlesschain.project.mapper.ProjectCollaboratorMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 协作者服务
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class CollaboratorService {

    private final ProjectCollaboratorMapper collaboratorMapper;

    /**
     * 获取协作者列表
     */
    public List<CollaboratorDTO> listCollaborators(String projectId) {
        log.info("获取项目协作者列表: projectId={}", projectId);

        LambdaQueryWrapper<ProjectCollaborator> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectCollaborator::getProjectId, projectId)
                .orderByDesc(ProjectCollaborator::getCreatedAt);

        List<ProjectCollaborator> collaborators = collaboratorMapper.selectList(wrapper);

        return collaborators.stream()
                .map(this::toDTO)
                .collect(Collectors.toList());
    }

    /**
     * 添加协作者
     */
    @Transactional
    public CollaboratorDTO addCollaborator(String projectId, CollaboratorAddRequest request, String invitedBy) {
        log.info("添加协作者: projectId={}, collaboratorDid={}", projectId, request.getCollaboratorDid());

        // 检查是否已经是协作者
        LambdaQueryWrapper<ProjectCollaborator> checkWrapper = new LambdaQueryWrapper<>();
        checkWrapper.eq(ProjectCollaborator::getProjectId, projectId)
                .eq(ProjectCollaborator::getCollaboratorDid, request.getCollaboratorDid());

        Long count = collaboratorMapper.selectCount(checkWrapper);
        if (count > 0) {
            throw new RuntimeException("该用户已是项目协作者");
        }

        // 创建协作者记录
        ProjectCollaborator collaborator = new ProjectCollaborator();
        collaborator.setId(IdWorker.get32UUID());
        collaborator.setProjectId(projectId);
        collaborator.setCollaboratorDid(request.getCollaboratorDid());
        collaborator.setRole(request.getRole());
        collaborator.setPermissions(request.getPermissionsString());
        collaborator.setInvitedBy(invitedBy);
        collaborator.setInvitedAt(LocalDateTime.now());
        collaborator.setStatus("pending");

        collaboratorMapper.insert(collaborator);

        log.info("协作者添加成功: collaboratorId={}", collaborator.getId());
        return toDTO(collaborator);
    }

    /**
     * 更新权限
     */
    @Transactional
    public CollaboratorDTO updatePermissions(String projectId, String collaboratorId, PermissionUpdateRequest request) {
        log.info("更新协作者权限: projectId={}, collaboratorId={}", projectId, collaboratorId);

        ProjectCollaborator collaborator = getCollaborator(projectId, collaboratorId);

        collaborator.setPermissions(request.getPermissions());
        collaboratorMapper.updateById(collaborator);

        log.info("权限更新成功");
        return toDTO(collaborator);
    }

    /**
     * 移除协作者
     */
    @Transactional
    public void removeCollaborator(String projectId, String collaboratorId) {
        log.info("移除协作者: projectId={}, collaboratorId={}", projectId, collaboratorId);

        ProjectCollaborator collaborator = getCollaborator(projectId, collaboratorId);
        collaboratorMapper.deleteById(collaborator.getId());

        log.info("协作者移除成功");
    }

    /**
     * 接受邀请
     */
    @Transactional
    public CollaboratorDTO acceptInvitation(String projectId, String collaboratorId) {
        log.info("接受协作邀请: projectId={}, collaboratorId={}", projectId, collaboratorId);

        ProjectCollaborator collaborator = getCollaborator(projectId, collaboratorId);

        if (!"pending".equals(collaborator.getStatus())) {
            throw new RuntimeException("该邀请已处理");
        }

        collaborator.setStatus("accepted");
        collaborator.setAcceptedAt(LocalDateTime.now());
        collaboratorMapper.updateById(collaborator);

        log.info("邀请接受成功");
        return toDTO(collaborator);
    }

    /**
     * 获取协作者
     */
    private ProjectCollaborator getCollaborator(String projectId, String collaboratorId) {
        LambdaQueryWrapper<ProjectCollaborator> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectCollaborator::getId, collaboratorId)
                .eq(ProjectCollaborator::getProjectId, projectId);

        ProjectCollaborator collaborator = collaboratorMapper.selectOne(wrapper);
        if (collaborator == null) {
            throw new RuntimeException("协作者不存在");
        }

        return collaborator;
    }

    /**
     * Entity转DTO
     */
    private CollaboratorDTO toDTO(ProjectCollaborator collaborator) {
        CollaboratorDTO dto = new CollaboratorDTO();
        BeanUtils.copyProperties(collaborator, dto);
        // TODO: 从DID系统获取协作者名称
        dto.setCollaboratorName(collaborator.getCollaboratorDid());
        return dto;
    }
}
