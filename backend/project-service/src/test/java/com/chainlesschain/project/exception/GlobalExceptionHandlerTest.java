package com.chainlesschain.project.exception;

import com.chainlesschain.project.dto.ApiResponse;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.security.access.AccessDeniedException;
import org.springframework.validation.BindingResult;
import org.springframework.validation.FieldError;
import org.springframework.validation.ObjectError;
import org.springframework.web.bind.MethodArgumentNotValidException;
import org.springframework.web.method.annotation.MethodArgumentTypeMismatchException;

import java.util.Arrays;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

/**
 * {@link GlobalExceptionHandler} 的契约测试（先前零覆盖）。
 *
 * 每个 handler 都是纯方法（异常入 → ResponseEntity 出），无需 Spring 上下文。
 * 重点钉住：
 *   - 各异常 → 正确的 HTTP 状态码与 ApiResponse code
 *   - 参数校验：getAllErrors() 含全局 ObjectError（非 FieldError）时不再抛
 *     ClassCastException（回归——此前裸强转会被通用处理器吞成 500）
 *   - 通用处理器不向客户端泄漏内部异常详情
 */
class GlobalExceptionHandlerTest {

    private final GlobalExceptionHandler handler = new GlobalExceptionHandler();

    // ----------------------------------------------------------------- //
    // BusinessException → 400 + 自定义 code
    // ----------------------------------------------------------------- //
    @Test
    void businessException_defaultCode400() {
        ResponseEntity<ApiResponse<Void>> resp =
                handler.handleBusinessException(new BusinessException("库存不足"));
        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        assertEquals(400, resp.getBody().getCode());
        assertEquals("库存不足", resp.getBody().getMessage());
    }

    @Test
    void businessException_customCodePreserved() {
        ResponseEntity<ApiResponse<Void>> resp =
                handler.handleBusinessException(new BusinessException(409, "冲突"));
        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        assertEquals(409, resp.getBody().getCode());
    }

    // ----------------------------------------------------------------- //
    // MethodArgumentNotValidException → 400 + field/object 错误映射
    // ----------------------------------------------------------------- //
    @Test
    void validation_fieldErrorsMappedByFieldName() {
        FieldError fe = new FieldError("createReq", "name", "不能为空");
        MethodArgumentNotValidException ex = validationExceptionWith(fe);

        ResponseEntity<ApiResponse<Map<String, String>>> resp =
                handler.handleValidationException(ex);

        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        assertEquals(400, resp.getBody().getCode());
        assertEquals("参数校验失败", resp.getBody().getMessage());
        assertEquals("不能为空", resp.getBody().getData().get("name"));
    }

    @Test
    void validation_globalObjectErrorDoesNotThrowClassCast() {
        // 回归：类级/跨字段约束产生 ObjectError（非 FieldError）。
        // 修复前 ((FieldError) error) 抛 ClassCastException → 通用处理器 → 500。
        FieldError fe = new FieldError("createReq", "endDate", "必须晚于开始日期");
        ObjectError global = new ObjectError("createReq", "开始日期必须早于结束日期");
        MethodArgumentNotValidException ex = validationExceptionWith(fe, global);

        ResponseEntity<ApiResponse<Map<String, String>>> resp =
                handler.handleValidationException(ex);

        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        Map<String, String> data = resp.getBody().getData();
        assertEquals("必须晚于开始日期", data.get("endDate"));
        // 全局错误以对象名为 key 记录，而非令请求崩成 500
        assertEquals("开始日期必须早于结束日期", data.get("createReq"));
    }

    // ----------------------------------------------------------------- //
    // 其余 handler 的状态码映射
    // ----------------------------------------------------------------- //
    @Test
    void typeMismatch_400_withParamNameAndValue() {
        MethodArgumentTypeMismatchException ex = mock(MethodArgumentTypeMismatchException.class);
        when(ex.getName()).thenReturn("projectId");
        when(ex.getValue()).thenReturn("abc");

        ResponseEntity<ApiResponse<Void>> resp = handler.handleTypeMismatchException(ex);

        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        assertEquals(400, resp.getBody().getCode());
        assertTrue(resp.getBody().getMessage().contains("projectId"));
        assertTrue(resp.getBody().getMessage().contains("abc"));
    }

    @Test
    void resourceNotFound_404() {
        ResponseEntity<ApiResponse<Void>> resp =
                handler.handleResourceNotFoundException(new ResourceNotFoundException("项目", "42"));
        assertEquals(HttpStatus.NOT_FOUND, resp.getStatusCode());
        assertEquals(404, resp.getBody().getCode());
        assertTrue(resp.getBody().getMessage().contains("42"));
    }

    @Test
    void illegalArgument_400() {
        ResponseEntity<ApiResponse<Void>> resp =
                handler.handleIllegalArgumentException(new IllegalArgumentException("bad arg"));
        assertEquals(HttpStatus.BAD_REQUEST, resp.getStatusCode());
        assertEquals(400, resp.getBody().getCode());
        assertEquals("bad arg", resp.getBody().getMessage());
    }

    @Test
    void accessDenied_403() {
        ResponseEntity<ApiResponse<Void>> resp =
                handler.handleAccessDenied(new AccessDeniedException("not a collaborator"));
        assertEquals(HttpStatus.FORBIDDEN, resp.getStatusCode());
        assertEquals(403, resp.getBody().getCode());
    }

    // ----------------------------------------------------------------- //
    // 通用 handler → 500，不泄漏内部细节
    // ----------------------------------------------------------------- //
    @Test
    void genericException_500_doesNotLeakInternalDetails() {
        ResponseEntity<ApiResponse<Void>> resp =
                handler.handleException(new RuntimeException("DB password is hunter2"));
        assertEquals(HttpStatus.INTERNAL_SERVER_ERROR, resp.getStatusCode());
        assertEquals(500, resp.getBody().getCode());
        assertEquals("服务器内部错误，请稍后重试", resp.getBody().getMessage());
        assertFalse(resp.getBody().getMessage().contains("hunter2"));
    }

    // ----------------------------------------------------------------- //
    // helper
    // ----------------------------------------------------------------- //
    private MethodArgumentNotValidException validationExceptionWith(ObjectError... errors) {
        BindingResult br = mock(BindingResult.class);
        when(br.getAllErrors()).thenReturn(Arrays.asList(errors));
        MethodArgumentNotValidException ex = mock(MethodArgumentNotValidException.class);
        when(ex.getBindingResult()).thenReturn(br);
        return ex;
    }
}
