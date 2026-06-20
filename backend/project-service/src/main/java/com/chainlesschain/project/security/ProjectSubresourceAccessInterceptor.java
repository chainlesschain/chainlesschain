package com.chainlesschain.project.security;

import com.chainlesschain.project.dto.ApiResponse;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.servlet.HandlerInterceptor;

/**
 * 项目子资源授权拦截器。
 *
 * <p>统一在入口处用 {@link ProjectAccessGuard} 校验 {@code /api/projects/{projectId}/
 * (files|comments|collaborators)/**} 子资源请求的项目级授权（修复 IDOR），避免在
 * 每个子资源 controller 的每个端点上逐一散落鉴权调用。拒绝时直接写 403 + ApiResponse
 * 并 {@code return false}，不依赖 @ExceptionHandler 处理拦截器抛出的异常。
 *
 * <p>仅对子资源路径注册（见 WebConfig）；项目自身端点（get/update/delete/export）由
 * ProjectController 显式调用守卫。dev-mode（无认证）由守卫放行。
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class ProjectSubresourceAccessInterceptor implements HandlerInterceptor {

    private final ProjectAccessGuard accessGuard;
    private final ObjectMapper objectMapper;

    @Override
    public boolean preHandle(HttpServletRequest request, HttpServletResponse response, Object handler)
            throws Exception {
        String projectId = extractProjectId(request.getRequestURI());
        if (projectId == null) {
            return true; // 非项目子资源路径（注册已限定，理论不达）—— 放行
        }
        Authentication auth = SecurityContextHolder.getContext().getAuthentication();
        try {
            accessGuard.assertCanAccessProject(projectId, auth);
            return true;
        } catch (AccessDeniedException e) {
            writeForbidden(response, e.getMessage());
            return false;
        }
    }

    /**
     * 从 {@code /api/projects/{projectId}/...} 提取 projectId（{@code projects} 之后的
     * 第一段非空路径）。无法提取返回 null。
     */
    static String extractProjectId(String uri) {
        if (uri == null) {
            return null;
        }
        String[] parts = uri.split("/");
        for (int i = 0; i + 1 < parts.length; i++) {
            if ("projects".equals(parts[i]) && !parts[i + 1].isEmpty()) {
                return parts[i + 1];
            }
        }
        return null;
    }

    private void writeForbidden(HttpServletResponse response, String message) throws Exception {
        response.setStatus(HttpServletResponse.SC_FORBIDDEN);
        response.setContentType("application/json;charset=UTF-8");
        response.getWriter().write(objectMapper.writeValueAsString(ApiResponse.error(403, message)));
    }
}
