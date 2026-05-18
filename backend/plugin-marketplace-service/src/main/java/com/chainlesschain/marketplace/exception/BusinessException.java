package com.chainlesschain.marketplace.exception;

import lombok.Getter;

/**
 * Business Exception
 * 业务异常
 *
 * @author ChainlessChain Team
 */
@Getter
public class BusinessException extends RuntimeException {

    private final String code;
    private final String message;

    public BusinessException(String message) {
        super(message);
        this.code = "BUSINESS_ERROR";
        this.message = message;
    }

    public BusinessException(String code, String message) {
        super(message);
        this.code = code;
        this.message = message;
    }
}
