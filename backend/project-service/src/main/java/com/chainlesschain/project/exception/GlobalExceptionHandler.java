package com.chainlesschain.project.exception;

import com.chainlesschain.project.dto.ApiResponse;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.validation.FieldError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.bind.annotation.ExceptionHandler;
import org.springframework.web.bind.annotation.RestControllerAdvice;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.HashMap;
import java.util.Map;

/**
 * 全局异常处理器
 * 统一处理所有Controller抛出的异常，返回标准化的错误响应
 */
@Slf4j
@RestControllerAdvice
public class GlobalExceptionHandler {

    /**
     * 处理业务异常
     */
    @ExceptionHandler(BusinessException.class)
    public ResponseEntity<ApiResponse<Void>> handleBusinessException(BusinessException e) {
        log.error("Business exception: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(e.getCode(), e.getMessage()));
    }

    /**
     * 处理参数校验异常
     */
    @ExceptionHandler(MethodArgumentNotValidException.class)
    public ResponseEntity<ApiResponse<Map<String, String>>> handleValidationException(MethodArgumentNotValidException e) {
        Map<String, String> errors = new HashMap<>();
        e.getBindingResult().getAllErrors().forEach((error) -> {
            String fieldName = ((FieldError) error).getField();
            String errorMessage = error.getDefaultMessage();
            errors.put(fieldName, errorMessage);
        });

        log.error("Validation exception: {}", errors);
        ApiResponse<Map<String, String>> response = new ApiResponse<>();
        response.setCode(400);
        response.setMessage("参数校验失败");
        response.setData(errors);

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(response);
    }

    /**
     * 处理参数类型不匹配异常
     */
    @ExceptionHandler(MethodArgumentTypeMismatchException.class)
    public ResponseEntity<ApiResponse<Void>> handleTypeMismatchException(MethodArgumentTypeMismatchException e) {
        String message = String.format("参数 '%s' 的值 '%s' 类型不正确",
                e.getName(), e.getValue());
        log.error("Type mismatch exception: {}", message);

        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(400, message));
    }

    /**
     * 处理资源未找到异常
     */
    @ExceptionHandler(ResourceNotFoundException.class)
    public ResponseEntity<ApiResponse<Void>> handleResourceNotFoundException(ResourceNotFoundException e) {
        log.error("Resource not found: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.NOT_FOUND)
                .body(ApiResponse.error(404, e.getMessage()));
    }

    /**
     * 处理非法参数异常
     */
    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<ApiResponse<Void>> handleIllegalArgumentException(IllegalArgumentException e) {
        log.error("Illegal argument: {}", e.getMessage());
        return ResponseEntity
                .status(HttpStatus.BAD_REQUEST)
                .body(ApiResponse.error(400, e.getMessage()));
    }

    /**
     * 处理所有未捕获的异常
     */
    @ExceptionHandler(Exception.class)
    public ResponseEntity<ApiResponse<Void>> handleException(Exception e) {
        log.error("Unexpected exception", e);

        // 不向客户端暴露内部错误详情
        String message = "服务器内部错误，请稍后重试";

        return ResponseEntity
                .status(HttpStatus.INTERNAL_SERVER_ERROR)
                .body(ApiResponse.error(500, message));
    }
}
