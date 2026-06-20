package com.chainlesschain.project.security;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.chainlesschain.project.entity.Conversation;
import com.chainlesschain.project.entity.ConversationMessage;
import com.chainlesschain.project.entity.Project;
import com.chainlesschain.project.entity.ProjectCollaborator;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.ConversationMapper;
import com.chainlesschain.project.mapper.ConversationMessageMapper;
import com.chainlesschain.project.mapper.ProjectCollaboratorMapper;
import com.chainlesschain.project.mapper.ProjectMapper;
import com.chainlesschain.project.mapper.UserMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.stereotype.Component;

import java.util.HashSet;
import java.util.Set;

/**
 * 项目级授权守卫 (project-domain authorization)。
 *
 * <p>修复 IDOR：project / file / conversation / comment / collaborator 各 controller
 * 此前只凭调用方提供的 projectId 操作资源，不校验调用方是否为该项目的所有者或协作者，
 * 导致任意已登录用户凭 id 即可读改删他人项目/文件/会话/评论并自提协作权限。本守卫在
 * 每个项目级端点入口被调用，校验<b>已认证调用方</b>是项目所有者或协作者，否则抛
 * {@link AccessDeniedException}（由 GlobalExceptionHandler 映射为 403）。
 *
 * <p>认证身份取自 JWT 主体（{@code Authentication.getName()} = username），并解析出该
 * 用户的 {username, userId, did} 身份集合，以兼容历史上 {@code project.userId} /
 * {@code ownerDid} 存过的不同标识形态；任一匹配即视为所有者。
 *
 * <p>dev-mode（{@code security.dev-mode=true}）下项目端点为 permitAll，此时
 * Authentication 为 null —— 守卫放行以保持单机/开发行为不变（该模式本就不鉴权，另有
 * 运维风险提示，见安全评审记录）。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProjectAccessGuard {

    private final ProjectMapper projectMapper;
    private final ProjectCollaboratorMapper collaboratorMapper;
    private final UserMapper userMapper;
    private final ConversationMapper conversationMapper;
    private final ConversationMessageMapper messageMapper;

    /**
     * 校验调用方可访问指定项目；不可访问则抛 {@link AccessDeniedException}。
     * 未认证（dev-mode permitAll）放行；项目不存在时放行，交由下游 service 以 404 处理
     * （不在此层泄露资源存在性）。
     */
    public void assertCanAccessProject(String projectId, Authentication authentication) {
        if (!isAuthenticated(authentication)) {
            return; // dev-mode / 未认证 permitAll —— 保持既有行为
        }
        if (projectId == null || projectId.trim().isEmpty()) {
            throw new AccessDeniedException("缺少项目标识");
        }
        Project project = projectMapper.selectById(projectId);
        if (project == null) {
            return; // 资源不存在：交由 service 层处理，不在此泄露存在性
        }
        Set<String> ids = callerIdentities(authentication);
        if (ids.contains(project.getUserId()) || ids.contains(project.getOwnerDid())) {
            return; // 所有者
        }
        Long memberCount = collaboratorMapper.selectCount(
                new LambdaQueryWrapper<ProjectCollaborator>()
                        .eq(ProjectCollaborator::getProjectId, projectId)
                        .in(ProjectCollaborator::getUserId, ids));
        if (memberCount != null && memberCount > 0) {
            return; // 协作者
        }
        log.warn("拒绝访问：caller={} 非项目 {} 所有者/协作者", authentication.getName(), projectId);
        throw new AccessDeniedException("无权访问该项目");
    }

    /**
     * 经会话归属校验访问权限：归属项目的会话走项目级授权；无项目归属的会话按会话所有者
     * （{@code userId}）校验。会话不存在则放行（交由 service 以 404 处理）。
     */
    public void assertCanAccessConversation(String conversationId, Authentication authentication) {
        if (!isAuthenticated(authentication)) {
            return;
        }
        if (conversationId == null || conversationId.trim().isEmpty()) {
            throw new AccessDeniedException("缺少会话标识");
        }
        Conversation conversation = conversationMapper.selectById(conversationId);
        if (conversation == null) {
            return;
        }
        String projectId = conversation.getProjectId();
        if (projectId != null && !projectId.trim().isEmpty()) {
            assertCanAccessProject(projectId, authentication);
            return;
        }
        Set<String> ids = callerIdentities(authentication);
        if (ids.contains(conversation.getUserId())) {
            return;
        }
        log.warn("拒绝访问：caller={} 非会话 {} 所有者", authentication.getName(), conversationId);
        throw new AccessDeniedException("无权访问该会话");
    }

    /**
     * 经 消息 → 会话 → 项目 链校验访问权限。消息不存在则放行（交由 service 处理）。
     */
    public void assertCanAccessMessage(String messageId, Authentication authentication) {
        if (!isAuthenticated(authentication)) {
            return;
        }
        if (messageId == null || messageId.trim().isEmpty()) {
            throw new AccessDeniedException("缺少消息标识");
        }
        ConversationMessage message = messageMapper.selectById(messageId);
        if (message == null) {
            return;
        }
        assertCanAccessConversation(message.getConversationId(), authentication);
    }

    /**
     * 返回认证调用方的所有者身份集合 {username, userId, did}，用于与历史多形态
     * userId/ownerDid 匹配，以及把新建项目的 owner 绑定到认证调用方。未认证返回空集。
     */
    public Set<String> callerIdentities(Authentication authentication) {
        Set<String> ids = new HashSet<>();
        if (!isAuthenticated(authentication)) {
            return ids;
        }
        String name = authentication.getName();
        ids.add(name);
        try {
            User user = userMapper.findByUsername(name);
            if (user != null) {
                if (user.getId() != null) ids.add(user.getId());
                if (user.getDid() != null) ids.add(user.getDid());
            }
        } catch (Exception e) {
            log.debug("解析调用方身份失败 (username={}): {}", name, e.getMessage());
        }
        return ids;
    }

    /**
     * 返回认证调用方可访问的项目 id 集合（其拥有的项目 + 作为协作者参与的项目），用于把
     * 「无 userId 列、仅按 projectId 归属」的资源（如项目文件搜索）限定到调用方有权访问的
     * 项目。未认证（dev-mode）返回空集；调用方应据此跳过此类查询以保持 permitAll 行为由
     * 上层决定。
     */
    public Set<String> accessibleProjectIds(Authentication authentication) {
        Set<String> result = new HashSet<>();
        if (!isAuthenticated(authentication)) {
            return result;
        }
        Set<String> ids = callerIdentities(authentication);
        if (ids.isEmpty()) {
            return result;
        }
        // 拥有的项目：userId 或 ownerDid 命中身份集合
        for (Project p : projectMapper.selectList(
                new LambdaQueryWrapper<Project>()
                        .in(Project::getUserId, ids)
                        .or()
                        .in(Project::getOwnerDid, ids))) {
            if (p.getId() != null) result.add(p.getId());
        }
        // 作为协作者参与的项目
        for (ProjectCollaborator c : collaboratorMapper.selectList(
                new LambdaQueryWrapper<ProjectCollaborator>()
                        .in(ProjectCollaborator::getUserId, ids))) {
            if (c.getProjectId() != null) result.add(c.getProjectId());
        }
        return result;
    }

    /** Public accessor for the dev-mode/permitAll authentication check (used by SearchService scoping). */
    public boolean isCallerAuthenticated(Authentication authentication) {
        return isAuthenticated(authentication);
    }

    private boolean isAuthenticated(Authentication authentication) {
        return authentication != null
                && authentication.isAuthenticated()
                && authentication.getName() != null
                && !"anonymousUser".equals(authentication.getName());
    }
}
