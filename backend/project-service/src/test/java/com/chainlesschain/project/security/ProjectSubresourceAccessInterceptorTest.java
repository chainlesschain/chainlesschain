package com.chainlesschain.project.security;

import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.security.access.AccessDeniedException;

import java.io.PrintWriter;
import java.io.StringWriter;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link ProjectSubresourceAccessInterceptor} 单元测试。
 */
@ExtendWith(MockitoExtension.class)
class ProjectSubresourceAccessInterceptorTest {

    @Mock
    private ProjectAccessGuard accessGuard;
    @Mock
    private HttpServletRequest request;
    @Mock
    private HttpServletResponse response;

    private ProjectSubresourceAccessInterceptor interceptor() {
        return new ProjectSubresourceAccessInterceptor(accessGuard, new ObjectMapper());
    }

    @Test
    void extractProjectId_parsesProjectsSegment() {
        assertEquals("p1",
                ProjectSubresourceAccessInterceptor.extractProjectId("/api/projects/p1/files/f1"));
        assertEquals("p1",
                ProjectSubresourceAccessInterceptor.extractProjectId("/api/projects/p1/comments"));
        assertEquals("p1",
                ProjectSubresourceAccessInterceptor.extractProjectId("/api/projects/p1/collaborators/c1"));
        assertEquals("p1",
                ProjectSubresourceAccessInterceptor.extractProjectId("/api/projects/p1/automation/rules"));
        assertNull(ProjectSubresourceAccessInterceptor.extractProjectId("/api/users/u1"));
        assertNull(ProjectSubresourceAccessInterceptor.extractProjectId(null));
    }

    @Test
    void automationPath_isGuarded() throws Exception {
        // /api/projects/*/automation/** was previously NOT intercepted → IDOR;
        // now in the WebConfig path patterns, so the guard must run on it.
        when(request.getRequestURI()).thenReturn("/api/projects/p1/automation/rules/r1/trigger");

        assertTrue(interceptor().preHandle(request, response, new Object()));
        verify(accessGuard).assertCanAccessProject(eq("p1"), any());
    }

    @Test
    void allowedAccess_returnsTrue_andDoesNotWriteResponse() throws Exception {
        when(request.getRequestURI()).thenReturn("/api/projects/p1/files/f1");

        assertTrue(interceptor().preHandle(request, response, new Object()));
        verify(accessGuard).assertCanAccessProject(eq("p1"), any());
        verify(response, never()).setStatus(anyInt());
    }

    @Test
    void deniedAccess_returnsFalse_andWrites403() throws Exception {
        when(request.getRequestURI()).thenReturn("/api/projects/p1/comments/c1");
        StringWriter sw = new StringWriter();
        when(response.getWriter()).thenReturn(new PrintWriter(sw));
        doThrow(new AccessDeniedException("无权访问该项目"))
                .when(accessGuard).assertCanAccessProject(eq("p1"), any());

        assertFalse(interceptor().preHandle(request, response, new Object()));
        verify(response).setStatus(HttpServletResponse.SC_FORBIDDEN);
        assertTrue(sw.toString().contains("403"));
    }

    @Test
    void nonProjectPath_isAllowed_withoutGuard() throws Exception {
        when(request.getRequestURI()).thenReturn("/api/users/u1");

        assertTrue(interceptor().preHandle(request, response, new Object()));
        verifyNoInteractions(accessGuard);
    }
}
