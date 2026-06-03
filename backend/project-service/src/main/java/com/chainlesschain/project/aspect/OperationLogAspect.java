package com.chainlesschain.project.aspect;

import com.chainlesschain.project.annotation.OperationLog;
import com.chainlesschain.project.entity.User;
import com.chainlesschain.project.mapper.UserMapper;
import com.chainlesschain.project.service.OperationLogService;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.http.HttpServletRequest;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.core.Authentication;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;
import java.time.LocalDateTime;

/**
 * 操作日志切面
 */
@Aspect
@Component
public class OperationLogAspect {

    private static final Logger logger = LoggerFactory.getLogger(OperationLogAspect.class);

    @Autowired
    private OperationLogService operationLogService;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private UserMapper userMapper;

    @Around("@annotation(com.chainlesschain.project.annotation.OperationLog)")
    public Object around(ProceedingJoinPoint joinPoint) throws Throwable {
        long startTime = System.currentTimeMillis();

        // 获取注解
        MethodSignature signature = (MethodSignature) joinPoint.getSignature();
        Method method = signature.getMethod();
        OperationLog operationLog = method.getAnnotation(OperationLog.class);

        // 创建日志对象
        com.chainlesschain.project.entity.OperationLog log =
            new com.chainlesschain.project.entity.OperationLog();

        // 获取请求信息
        ServletRequestAttributes attributes =
            (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();

        if (attributes != null) {
            HttpServletRequest request = attributes.getRequest();

            log.setRequestMethod(request.getMethod());
            log.setRequestUrl(request.getRequestURI());
            log.setClientIp(getClientIP(request));
            log.setUserAgent(request.getHeader("User-Agent"));

            // 记录请求参数
            if (operationLog.recordParams()) {
                try {
                    Object[] args = joinPoint.getArgs();
                    String params = objectMapper.writeValueAsString(args);
                    // 限制参数长度
                    if (params.length() > 2000) {
                        params = params.substring(0, 2000) + "...";
                    }
                    log.setRequestParams(params);
                } catch (Exception e) {
                    log.setRequestParams("参数序列化失败");
                }
            }
        }

        // 获取当前用户信息
        Authentication authentication = SecurityContextHolder.getContext().getAuthentication();
        if (authentication != null && authentication.isAuthenticated()) {
            String principal = authentication.getName();
            log.setUsername(principal);
            // 从数据库解析userId（支持DID和用户名两种认证方式）
            try {
                User user = userMapper.findByDid(principal);
                if (user == null) {
                    user = userMapper.findByUsername(principal);
                }
                if (user != null) {
                    log.setUserId(user.getId());
                }
            } catch (Exception e) {
                // userId查询失败不影响日志记录
            }
        }

        // 设置操作信息
        log.setModule(operationLog.module());
        log.setOperationType(operationLog.type().name());
        log.setDescription(operationLog.description());
        log.setCreatedAt(LocalDateTime.now());

        // 执行方法
        Object result = null;
        try {
            result = joinPoint.proceed();
            log.setStatus("SUCCESS");

            // 记录响应结果
            if (operationLog.recordResult() && result != null) {
                try {
                    String resultStr = objectMapper.writeValueAsString(result);
                    // 限制结果长度
                    if (resultStr.length() > 2000) {
                        resultStr = resultStr.substring(0, 2000) + "...";
                    }
                    log.setResponseResult(resultStr);
                } catch (Exception e) {
                    log.setResponseResult("结果序列化失败");
                }
            }
        } catch (Throwable e) {
            log.setStatus("FAILURE");
            log.setErrorMessage(e.getMessage());
            throw e;
        } finally {
            // 计算执行时间
            long executionTime = System.currentTimeMillis() - startTime;
            log.setExecutionTime(executionTime);

            // 异步保存日志
            operationLogService.saveLog(log);
        }

        return result;
    }

    /**
     * 获取客户端IP
     */
    private String getClientIP(HttpServletRequest request) {
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
}
