package com.chainlesschain.project.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * API限流注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface RateLimit {

    /**
     * 限流key前缀
     */
    String key() default "rate_limit";

    /**
     * 时间窗口（秒）
     */
    int time() default 60;

    /**
     * 时间窗口内最大请求数
     */
    int count() default 100;

    /**
     * 限流类型（IP, USER, GLOBAL）
     */
    LimitType limitType() default LimitType.IP;

    /**
     * 限流类型枚举
     */
    enum LimitType {
        IP,      // 按IP限流
        USER,    // 按用户限流
        GLOBAL   // 全局限流
    }
}
