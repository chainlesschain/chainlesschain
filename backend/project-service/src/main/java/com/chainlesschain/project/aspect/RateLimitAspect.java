package com.chainlesschain.project.aspect;

import com.chainlesschain.project.annotation.RateLimit;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.redis.core.RedisTemplate;
import org.springframework.data.redis.core.script.DefaultRedisScript;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;
import java.util.Collections;
import java.util.concurrent.TimeUnit;

/**
 * API限流切面
 */
@Aspect
@Component
public class RateLimitAspect {

    private static final Logger logger = LoggerFactory.getLogger(RateLimitAspect.class);

    @Autowired(required = false)
    private RedisTemplate<String, Object> redisTemplate;

    /**
     * Lua脚本：原子性地增加计数并设置过期时间
     */
    private static final String RATE_LIMIT_SCRIPT =
        "local key = KEYS[1]\n" +
        "local limit = tonumber(ARGV[1])\n" +
        "local expire = tonumber(ARGV[2])\n" +
        "local current = tonumber(redis.call('get', key) or '0')\n" +
        "if current + 1 > limit then\n" +
        "    return 0\n" +
        "else\n" +
        "    redis.call('incrby', key, 1)\n" +
        "    if current == 0 then\n" +
        "        redis.call('expire', key, expire)\n" +
        "    end\n" +
        "    return 1\n" +
        "end";

    @Around("@annotation(com.chainlesschain.project.annotation.RateLimit)")
    public Object around(ProceedingJoinPoint joinPoint) throws Throwable {
        // 如果Redis不可用，直接放行
        if (redisTemplate == null) {
            logger.warn("Redis未配置，限流功能不可用");
            return joinPoint.proceed();
        }

        // 获取注解
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method method = signature.getMethod();
        RateLimit rateLimit = method.getAnnotation(RateLimit.class);

        // 构建限流key
        String key = buildKey(rateLimit);

        // 执行限流检查
        boolean allowed = checkRateLimit(key, rateLimit.count(), rateLimit.time());

        if (!allowed) {
            logger.warn("请求被限流: key={}, limit={}/{}", key, rateLimit.count(), rateLimit.time());
            throw new RuntimeException("请求过于频繁，请稍后再试");
        }

        return joinPoint.proceed();
    }

    /**
     * 构建限流key
     */
    private String buildKey(RateLimit rateLimit) {
        StringBuilder key = new StringBuilder(rateLimit.key());
        key.append(":");

        switch (rateLimit.limitType()) {
            case IP:
                key.append(getClientIP());
                break;
            case USER:
                key.append(getCurrentUsername());
                break;
            case GLOBAL:
                key.append("global");
                break;
        }

        return key.toString();
    }

    /**
     * 检查限流
     */
    private boolean checkRateLimit(String key, int limit, int expire) {
        try {
            DefaultRedisScript<Long> script = new DefaultRedisScript<>();
            script.setScriptText(RATE_LIMIT_SCRIPT);
            script.setResultType(Long.class);

            Long result = redisTemplate.execute(
                script,
                Collections.singletonList(key),
                limit,
                expire
            );

            return result != null && result == 1;
        } catch (Exception e) {
            logger.error("限流检查失败", e);
            // 出错时放行
            return true;
        }
    }

    /**
     * 获取客户端IP
     */
    private String getClientIP() {
        ServletRequestAttributes attributes =
            (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();

        if (attributes == null) {
            return "unknown";
        }

        HttpServletRequest request = attributes.getRequest();
        String ip = request.getHeader("X-Forwarded-For");

        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getHeader("X-Real-IP");
        }

        if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
            ip = request.getRemoteAddr();
        }

        // 处理多个IP的情况（取第一个）
        if (ip != null && ip.contains(",")) {
            ip = ip.split(",")[0].trim();
        }

        return ip != null ? ip : "unknown";
    }

    /**
     * 获取当前用户名
     */
    private String getCurrentUsername() {
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            return authentication.getName();
        }
        return "anonymous";
    }
}
