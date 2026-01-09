package com.chainlesschain.project.entity;

import com.baomidou.mybatisplus.annotation.*;
import lombok.Data;

import java.time.LocalDateTime;

/**
 * 操作日志实体
 */
@Data
@TableName("operation_logs")
public class OperationLog {

    /**
     * 日志ID
     */
    @TableId(type = IdType.ASSIGN_UUID)
    private String id;

    /**
     * 操作用户ID
     */
    private String userId;

    /**
     * 操作用户名
     */
    private String username;

    /**
     * 操作模块
     */
    private String module;

    /**
     * 操作类型（CREATE, UPDATE, DELETE, QUERY, LOGIN, LOGOUT等）
     */
    private String operationType;

    /**
     * 操作描述
     */
    private String description;

    /**
     * 请求方法（GET, POST, PUT, DELETE等）
     */
    private String requestMethod;

    /**
     * 请求URL
     */
    private String requestUrl;

    /**
     * 请求参数
     */
    @TableField(value = "request_params", typeHandler = org.apache.ibatis.type.StringTypeHandler.class)
    private String requestParams;

    /**
     * 响应结果
     */
    @TableField(value = "response_result", typeHandler = org.apache.ibatis.type.StringTypeHandler.class)
    private String responseResult;

    /**
     * 操作状态（SUCCESS, FAILURE）
     */
    private String status;

    /**
     * 错误信息
     */
    private String errorMessage;

    /**
     * 执行时间（毫秒）
     */
    private Long executionTime;

    /**
     * 客户端IP
     */
    private String clientIp;

    /**
     * User-Agent
     */
    private String userAgent;

    /**
     * 创建时间
     */
    @TableField(fill = FieldFill.INSERT)
    private LocalDateTime createdAt;
}
