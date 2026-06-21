package com.chainlesschain.project.common;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * 统一返回结果封装 {@link Result} 的契约测试（先前零覆盖）。
 *
 * Result 被所有 Controller 用作响应外壳，但此前没有测试钉住其工厂方法的
 * 状态码/消息约定与 isSuccess() 的判定逻辑。纯类，无 Spring 上下文/DB。
 */
class ResultTest {

    // ----------------------------------------------------------------- //
    // success 系列
    // ----------------------------------------------------------------- //
    @Test
    void success_noData_is200_successMessage_nullData() {
        Result<String> r = Result.success();
        assertEquals(200, r.getCode());
        assertEquals("操作成功", r.getMessage());
        assertNull(r.getData());
        assertTrue(r.isSuccess());
    }

    @Test
    void success_withData_carriesData() {
        Result<String> r = Result.success("payload");
        assertEquals(200, r.getCode());
        assertEquals("操作成功", r.getMessage());
        assertEquals("payload", r.getData());
        assertTrue(r.isSuccess());
    }

    @Test
    void success_withDataAndMessage_usesCustomMessage() {
        Result<Integer> r = Result.success(42, "已创建");
        assertEquals(200, r.getCode());
        assertEquals("已创建", r.getMessage());
        assertEquals(42, r.getData());
        assertTrue(r.isSuccess());
    }

    // ----------------------------------------------------------------- //
    // error 系列
    // ----------------------------------------------------------------- //
    @Test
    void error_default_is500_failureMessage_notSuccess() {
        Result<String> r = Result.error();
        assertEquals(500, r.getCode());
        assertEquals("操作失败", r.getMessage());
        assertNull(r.getData());
        assertFalse(r.isSuccess());
    }

    @Test
    void error_withMessage_keepsCode500() {
        Result<String> r = Result.error("参数非法");
        assertEquals(500, r.getCode());
        assertEquals("参数非法", r.getMessage());
        assertFalse(r.isSuccess());
    }

    @Test
    void error_withCodeAndMessage() {
        Result<String> r = Result.error(404, "未找到");
        assertEquals(404, r.getCode());
        assertEquals("未找到", r.getMessage());
        assertNull(r.getData());
        assertFalse(r.isSuccess());
    }

    @Test
    void error_withCodeMessageAndData_carriesData() {
        Result<String> r = Result.error(400, "校验失败", "field=name");
        assertEquals(400, r.getCode());
        assertEquals("校验失败", r.getMessage());
        assertEquals("field=name", r.getData());
        assertFalse(r.isSuccess());
    }

    // ----------------------------------------------------------------- //
    // isSuccess — 仅基于 code，null-safe
    // ----------------------------------------------------------------- //
    @Test
    void isSuccess_nullCode_isFalse_noNpe() {
        Result<String> r = new Result<>();
        assertNull(r.getCode());
        assertFalse(r.isSuccess());
    }

    @Test
    void isSuccess_nonOkCode_isFalse() {
        Result<String> r = new Result<>(201, "x", null);
        assertFalse(r.isSuccess());
    }

    @Test
    void isSuccess_isPurelyCodeBased_evenForErrorFactoryWith200() {
        // isSuccess 只看 code==200，与工厂名无关
        Result<String> r = Result.error(200, "称作 error 但 code=200");
        assertTrue(r.isSuccess());
    }

    // ----------------------------------------------------------------- //
    // 构造器
    // ----------------------------------------------------------------- //
    @Test
    void constructors_setTimestamp() {
        long before = System.currentTimeMillis();
        Result<String> a = new Result<>();
        Result<String> b = new Result<>(200, "ok", "d");
        assertTrue(a.getTimestamp() >= before);
        assertTrue(b.getTimestamp() >= before);
    }
}
