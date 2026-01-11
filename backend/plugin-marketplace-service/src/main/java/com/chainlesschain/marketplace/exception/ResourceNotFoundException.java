package com.chainlesschain.marketplace.exception;

/**
 * Resource Not Found Exception
 * 资源未找到异常
 *
 * @author ChainlessChain Team
 */
public class ResourceNotFoundException extends BusinessException {

    public ResourceNotFoundException(String message) {
        super("RESOURCE_NOT_FOUND", message);
    }

    public ResourceNotFoundException(String resource, String id) {
        super("RESOURCE_NOT_FOUND", String.format("%s not found: %s", resource, id));
    }
}
