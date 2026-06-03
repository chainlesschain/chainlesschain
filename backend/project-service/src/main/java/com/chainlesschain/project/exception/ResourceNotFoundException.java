package com.chainlesschain.project.exception;

/**
 * 资源未找到异常
 * 当请求的资源不存在时抛出
 */
public class ResourceNotFoundException extends RuntimeException {

    public ResourceNotFoundException(String message) {
        super(message);
    }

    public ResourceNotFoundException(String resourceType, String resourceId) {
        super(String.format("%s 未找到: %s", resourceType, resourceId));
    }

    public ResourceNotFoundException(String message, Throwable cause) {
        super(message, cause);
    }
}
