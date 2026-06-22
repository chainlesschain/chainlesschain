package com.chainlesschain.project.aspect;

import com.chainlesschain.project.annotation.RateLimit;
import jakarta.servlet.http.HttpServletRequest;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link RateLimitAspect} 辅助逻辑测试（先前零覆盖）。
 *
 * 重点是安全相关的客户端 IP 提取（X-Forwarded-For → X-Real-IP → remoteAddr 回退、
 * 多 IP 取首个）、用户名解析、限流 key 构造，以及 checkRateLimit 的语义（result==1
 * 放行 / 0 或 null 拒绝 / Redis 异常时 fail-open 放行）。私有方法经 ReflectionTestUtils
 * 调用，请求/安全上下文经线程局部 Holder 注入。纯单元，不起 Spring。
 */
class RateLimitAspectTest {

    private final RateLimitAspect aspect = new RateLimitAspect();

    @AfterEach
    void cleanup() {
        RequestContextHolder.resetRequestAttributes();
        SecurityContextHolder.clearContext();
    }

    private HttpServletRequest bindRequest() {
        HttpServletRequest req = mock(HttpServletRequest.class);
        RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(req));
        return req;
    }

    private String clientIp() {
        return (String) ReflectionTestUtils.invokeMethod(aspect, "getClientIP");
    }

    // ----------------------------------------------------------------- //
    // getClientIP — 代理头回退链
    // ----------------------------------------------------------------- //
    @Test
    void clientIp_noRequestAttributes_unknown() {
        RequestContextHolder.resetRequestAttributes();
        assertEquals("unknown", clientIp());
    }

    @Test
    void clientIp_usesXForwardedForWhenPresent() {
        HttpServletRequest req = bindRequest();
        when(req.getHeader("X-Forwarded-For")).thenReturn("203.0.113.7");
        assertEquals("203.0.113.7", clientIp());
    }

    @Test
    void clientIp_fallsBackToXRealIp_whenXffUnknown() {
        HttpServletRequest req = bindRequest();
        when(req.getHeader("X-Forwarded-For")).thenReturn("unknown");
        when(req.getHeader("X-Real-IP")).thenReturn("198.51.100.4");
        assertEquals("198.51.100.4", clientIp());
    }

    @Test
    void clientIp_fallsBackToRemoteAddr_whenHeadersMissing() {
        HttpServletRequest req = bindRequest();
        when(req.getHeader("X-Forwarded-For")).thenReturn(null);
        when(req.getHeader("X-Real-IP")).thenReturn("");
        when(req.getRemoteAddr()).thenReturn("10.0.0.9");
        assertEquals("10.0.0.9", clientIp());
    }

    @Test
    void clientIp_multiValueXff_takesFirstTrimmed() {
        HttpServletRequest req = bindRequest();
        when(req.getHeader("X-Forwarded-For")).thenReturn("1.1.1.1, 2.2.2.2, 3.3.3.3");
        assertEquals("1.1.1.1", clientIp());
    }

    @Test
    void clientIp_allNull_unknown() {
        HttpServletRequest req = bindRequest();
        when(req.getHeader("X-Forwarded-For")).thenReturn(null);
        when(req.getHeader("X-Real-IP")).thenReturn(null);
        when(req.getRemoteAddr()).thenReturn(null);
        assertEquals("unknown", clientIp());
    }

    // ----------------------------------------------------------------- //
    // getCurrentUsername
    // ----------------------------------------------------------------- //
    private String currentUsername() {
        return (String) ReflectionTestUtils.invokeMethod(aspect, "getCurrentUsername");
    }

    @Test
    void username_noAuthentication_anonymous() {
        SecurityContextHolder.clearContext();
        assertEquals("anonymous", currentUsername());
    }

    @Test
    void username_authenticated_returnsName() {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(auth.getName()).thenReturn("alice");
        SecurityContextHolder.getContext().setAuthentication(auth);
        assertEquals("alice", currentUsername());
    }

    @Test
    void username_notAuthenticated_anonymous() {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(false);
        SecurityContextHolder.getContext().setAuthentication(auth);
        assertEquals("anonymous", currentUsername());
    }

    // ----------------------------------------------------------------- //
    // buildKey
    // ----------------------------------------------------------------- //
    private String buildKey(RateLimit rl) {
        return (String) ReflectionTestUtils.invokeMethod(aspect, "buildKey", rl);
    }

    private RateLimit rateLimit(String key, RateLimit.LimitType type) {
        RateLimit rl = mock(RateLimit.class);
        when(rl.key()).thenReturn(key);
        when(rl.limitType()).thenReturn(type);
        return rl;
    }

    @Test
    void buildKey_globalType() {
        assertEquals("api:global", buildKey(rateLimit("api", RateLimit.LimitType.GLOBAL)));
    }

    @Test
    void buildKey_ipType_appendsClientIp() {
        HttpServletRequest req = bindRequest();
        when(req.getHeader("X-Forwarded-For")).thenReturn("5.6.7.8");
        assertEquals("ep:5.6.7.8", buildKey(rateLimit("ep", RateLimit.LimitType.IP)));
    }

    @Test
    void buildKey_userType_appendsUsername() {
        Authentication auth = mock(Authentication.class);
        when(auth.isAuthenticated()).thenReturn(true);
        when(auth.getName()).thenReturn("bob");
        SecurityContextHolder.getContext().setAuthentication(auth);
        assertEquals("ep:bob", buildKey(rateLimit("ep", RateLimit.LimitType.USER)));
    }

    // ----------------------------------------------------------------- //
    // checkRateLimit — Lua 结果语义 + fail-open
    // ----------------------------------------------------------------- //
    private boolean checkRateLimit(int limit, int expire) {
        return (Boolean) ReflectionTestUtils.invokeMethod(aspect, "checkRateLimit", "k", limit, expire);
    }

    @SuppressWarnings("unchecked")
    private void setRedisResult(Long result) {
        RedisTemplate<String, Object> redis = mock(RedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class),
                anyList(), any(), any())).thenReturn(result);
        ReflectionTestUtils.setField(aspect, "redisTemplate", redis);
    }

    @Test
    void checkRateLimit_resultOne_allows() {
        setRedisResult(1L);
        assertTrue(checkRateLimit(100, 60));
    }

    @Test
    void checkRateLimit_resultZero_rejects() {
        setRedisResult(0L);
        assertFalse(checkRateLimit(100, 60));
    }

    @Test
    void checkRateLimit_nullResult_rejects() {
        setRedisResult(null);
        assertFalse(checkRateLimit(100, 60));
    }

    @Test
    void checkRateLimit_redisError_failsOpen() {
        // redisTemplate 为 null → execute 抛 NPE → 被捕获 → 放行（fail-open）
        ReflectionTestUtils.setField(aspect, "redisTemplate", null);
        assertTrue(checkRateLimit(100, 60));
    }
}
