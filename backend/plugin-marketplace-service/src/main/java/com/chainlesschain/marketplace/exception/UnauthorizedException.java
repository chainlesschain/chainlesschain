package com.chainlesschain.marketplace.exception;

/**
 * Unauthorized Exception
 * 未授权异常
 *
 * @author ChainlessChain Team
 */
public class UnauthorizedException extends BusinessException {

    public UnauthorizedException(String message) {
        super("UNAUTHORIZED", message);
    }

    public UnauthorizedException() {
        super("UNAUTHORIZED", "Unauthorized access");
    }
}
