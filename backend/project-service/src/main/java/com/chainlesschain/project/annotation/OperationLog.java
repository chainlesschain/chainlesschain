package com.chainlesschain.project.annotation;

import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;

/**
 * 操作日志注解
 */
@Target(ElementType.METHOD)
@Retention(RetentionPolicy.RUNTIME)
public @interface OperationLog {

    /**
     * 操作模块
     */
    String module() default "";

    /**
     * 操作类型
     */
    OperationType type() default OperationType.OTHER;

    /**
     * 操作描述
     */
    String description() default "";

    /**
     * 是否记录请求参数
     */
    boolean recordParams() default true;

    /**
     * 是否记录响应结果
     */
    boolean recordResult() default false;

    /**
     * 操作类型枚举
     */
    enum OperationType {
        CREATE,   // 创建
        UPDATE,   // 更新
        DELETE,   // 删除
        QUERY,    // 查询
        LOGIN,    // 登录
        LOGOUT,   // 登出
        EXPORT,   // 导出
        IMPORT,   // 导入
        OTHER     // 其他
    }
}
