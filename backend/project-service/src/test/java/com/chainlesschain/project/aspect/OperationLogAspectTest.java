package com.chainlesschain.project.aspect;

import com.chainlesschain.project.annotation.OperationLog;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.UserMapper;
import com.chainlesschain.project.service.OperationLogService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

/**
 * {@link OperationLogAspect} 测试（先前零覆盖）。
 *
 * 覆盖：getClientIP(request) 代理头回退链；around 通知的成功/失败状态、异常重新抛出
 * 但日志仍在 finally 落库、请求参数 2000 字截断、userId 经 DID→用户名两段解析。用
 * 带 @OperationLog 的辅助方法 + mock ProceedingJoinPoint 驱动。纯单元，不起 Spring。
 */
class OperationLogAspectTest {

    private final OperationLogService logService = mock(OperationLogService.class);
    private final UserMapper userMapper = mock(UserMapper.class);
    private final OperationLogAspect aspect = newAspect();

    private OperationLogAspect newAspect() {
        OperationLogAspect a = new OperationLogAspect();
        ReflectionTestUtils.setField(a, "operationLogService", logService);
        ReflectionTestUtils.setField(a, "userMapper", userMapper);
        ReflectionTestUtils.setField(a, "objectMapper", new ObjectMapper());
        return a;
    }

    @AfterEach
    void cleanup() {
        RequestContextHolder.resetRequestAttributes();
        SecurityContextHolder.clearContext();
    }

    // ----------------------------------------------------------------- //
    // 带注解的样本方法（供 around 反射取注解）
    // ----------------------------------------------------------------- //
    @OperationLog(module = "test", type = OperationLog.OperationType.CREATE,
            description = "create something", recordParams = true)
    public void sampleCreate(String arg) { /* body irrelevant */ }

    @OperationLog(module = "test", type = OperationLog.OperationType.QUERY,
            description = "q", recordParams = true, recordResult = true)
    public void sampleWithResult() { }

    private Method sampleMethod(String name, Class<?>... params) throws NoSuchMethodException {
        return getClass().getMethod(name, params);
    }

    private ProceedingJoinPoint joinPoint(Method method, Object[] args) {
        ProceedingJoinPoint jp = mock(ProceedingJoinPoint.class);
        MethodSignature sig = mock(MethodSignature.class);
        when(jp.getSignature()).thenReturn(sig);
        when(sig.getMethod()).thenReturn(method);
        when(jp.getArgs()).thenReturn(args);
        return jp;
    }

    private com.chainlesschain.project.entity.OperationLog captureSaved() {
        ArgumentCaptor<com.chainlesschain.project.entity.OperationLog> cap =
                ArgumentCaptor.forClass(com.chainlesschain.project.entity.OperationLog.class);
        verify(logService).saveLog(cap.capture());
        return cap.getValue();
    }

    // ----------------------------------------------------------------- //
    // getClientIP(request)
    // ----------------------------------------------------------------- //
    private String clientIp(HttpServletRequest req) {
        return (String) ReflectionTestUtils.invokeMethod(aspect, "getClientIP", req);
    }

    @Test
    void clientIp_xffPresent() {
        HttpServletRequest req = mock(HttpServletRequest.class);
        when(req.getHeader("X-Forwarded-For")).thenReturn("203.0.113.5");
        assertEquals("203.0.113.5", clientIp(req));
    }

    @Test
    void clientIp_fallbackChainToRealIpThenRemoteAddr() {
        HttpServletRequest req = mock(HttpServletRequest.class);
        when(req.getHeader("X-Forwarded-For")).thenReturn("unknown");
        when(req.getHeader("X-Real-IP")).thenReturn(null);
        when(req.getRemoteAddr()).thenReturn("10.1.2.3");
        assertEquals("10.1.2.3", clientIp(req));
    }

    @Test
    void clientIp_multiValueTakesFirst() {
        HttpServletRequest req = mock(HttpServletRequest.class);
        when(req.getHeader("X-Forwarded-For")).thenReturn("9.9.9.9, 8.8.8.8");
        assertEquals("9.9.9.9", clientIp(req));
    }

    @Test
    void clientIp_allNull_unknown() {
        HttpServletRequest req = mock(HttpServletRequest.class);
        assertEquals("unknown", clientIp(req));
    }

    // ----------------------------------------------------------------- //
    // around — 成功 / 失败 / 截断 / userId
    // ----------------------------------------------------------------- //
    @Test
    void around_success_setsStatusAndSavesLog_returnsResult() throws Throwable {
        ProceedingJoinPoint jp = joinPoint(sampleMethod("sampleCreate", String.class), new Object[]{"x"});
        when(jp.proceed()).thenReturn("RESULT");

        Object out = aspect.around(jp);

        assertEquals("RESULT", out);
        com.chainlesschain.project.entity.OperationLog saved = captureSaved();
        assertEquals("SUCCESS", saved.getStatus());
        assertEquals("test", saved.getModule());
        assertEquals("CREATE", saved.getOperationType());
    }

    @Test
    void around_exception_setsFailure_rethrows_andStillSaves() throws Throwable {
        ProceedingJoinPoint jp = joinPoint(sampleMethod("sampleCreate", String.class), new Object[]{"x"});
        when(jp.proceed()).thenThrow(new IllegalStateException("kaboom"));

        assertThrows(IllegalStateException.class, () -> aspect.around(jp));

        com.chainlesschain.project.entity.OperationLog saved = captureSaved();
        assertEquals("FAILURE", saved.getStatus());   // 异常路径
        assertEquals("kaboom", saved.getErrorMessage());
        // saveLog 在 finally 中必被调用，即便方法抛错
    }

    @Test
    void around_recordsParams_truncatedAt2000() throws Throwable {
        // 绑定请求（recordParams 逻辑嵌在 attributes != null 分支内）
        HttpServletRequest req = mock(HttpServletRequest.class);
        when(req.getMethod()).thenReturn("POST");
        when(req.getRequestURI()).thenReturn("/api/x");
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(req));

        String big = "a".repeat(2500);
        ProceedingJoinPoint jp = joinPoint(sampleMethod("sampleCreate", String.class), new Object[]{big});
        when(jp.proceed()).thenReturn(null);

        aspect.around(jp);

        com.chainlesschain.project.entity.OperationLog saved = captureSaved();
        assertTrue(saved.getRequestParams().endsWith("..."), "应被截断");
        assertEquals(2003, saved.getRequestParams().length());  // 2000 + "..."
        assertEquals("POST", saved.getRequestMethod());
    }

    @Test
    void around_resolvesUserIdViaDidThenUsername() throws Throwable {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(auth.getName()).thenReturn("did:chain:abc");
        SecurityContextHolder.getContext().setAuthentication(auth);

        // DID 命中
        User u = new User();
        u.setId("user-77");
        when(userMapper.findByDid("did:chain:abc")).thenReturn(u);

        ProceedingJoinPoint jp = joinPoint(sampleMethod("sampleCreate", String.class), new Object[]{"x"});
        when(jp.proceed()).thenReturn(null);

        aspect.around(jp);

        com.chainlesschain.project.entity.OperationLog saved = captureSaved();
        assertEquals("did:chain:abc", saved.getUsername());
        assertEquals("user-77", saved.getUserId());
    }

    @Test
    void around_userIdFallsBackToUsernameLookup() throws Throwable {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(auth.getName()).thenReturn("alice");
        SecurityContextHolder.getContext().setAuthentication(auth);

        when(userMapper.findByDid("alice")).thenReturn(null);  // 非 DID
        User u = new User();
        u.setId("user-88");
        when(userMapper.findByUsername("alice")).thenReturn(u);

        ProceedingJoinPoint jp = joinPoint(sampleMethod("sampleCreate", String.class), new Object[]{"x"});
        when(jp.proceed()).thenReturn(null);

        aspect.around(jp);

        assertEquals("user-88", captureSaved().getUserId());
    }
}
