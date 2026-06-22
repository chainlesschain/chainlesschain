package com.chainlesschain.project.service;

import com.chainlesschain.project.entity.OperationLog;
import com.chainlesschain.project.mapper.OperationLogMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * {@link OperationLogService} 测试（先前零覆盖）。
 *
 * 重点是审计日志的 fire-and-forget 韧性与 Q-ENG-2 MTC 桥回调守卫：saveLog 在
 * insert 抛错/桥抛错时都不得把异常传播到主流程；onAuditMtcEmitted 对 null
 * eventId/opLog/id 早返回、写回失败被吞。私有回调通过 setEmitCallback 捕获后驱动。
 * 纯 Mockito，不需 Spring/DB。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class OperationLogServiceTest {

    @Mock private OperationLogMapper operationLogMapper;
    @Mock private AuditMtcBridgeService auditMtcBridge;

    @InjectMocks private OperationLogService service;

    private OperationLog logWithId(String id) {
        OperationLog l = new OperationLog();
        l.setId(id);
        return l;
    }

    // ----------------------------------------------------------------- //
    // wireBridgeCallback + onAuditMtcEmitted（经捕获回调驱动）
    // ----------------------------------------------------------------- //
    private AuditMtcBridgeService.EmitCallback captureCallback() {
        service.wireBridgeCallback();
        ArgumentCaptor<AuditMtcBridgeService.EmitCallback> cap =
                ArgumentCaptor.forClass(AuditMtcBridgeService.EmitCallback.class);
        verify(auditMtcBridge).setEmitCallback(cap.capture());
        return cap.getValue();
    }

    @Test
    void emittedCallback_persistsEventIdOntoRow() {
        AuditMtcBridgeService.EmitCallback cb = captureCallback();
        OperationLog row = logWithId("log-1");
        cb.onEmitted(row, "evt-42", "/staging/x");
        assertEquals("evt-42", row.getAuditMtcEventId());
        verify(operationLogMapper).updateById(row);
    }

    @Test
    void emittedCallback_nullEventId_doesNotUpdate() {
        AuditMtcBridgeService.EmitCallback cb = captureCallback();
        cb.onEmitted(logWithId("log-2"), null, null);
        verify(operationLogMapper, never()).updateById(any(OperationLog.class));
    }

    @Test
    void emittedCallback_nullOpLog_isNoOp_noNpe() {
        AuditMtcBridgeService.EmitCallback cb = captureCallback();
        assertDoesNotThrow(() -> cb.onEmitted(null, "evt", null));
        verify(operationLogMapper, never()).updateById(any(OperationLog.class));
    }

    @Test
    void emittedCallback_opLogWithNullId_doesNotUpdate() {
        AuditMtcBridgeService.EmitCallback cb = captureCallback();
        cb.onEmitted(new OperationLog(), "evt", null);  // id == null
        verify(operationLogMapper, never()).updateById(any(OperationLog.class));
    }

    @Test
    void emittedCallback_updateFailure_isSwallowed() {
        AuditMtcBridgeService.EmitCallback cb = captureCallback();
        doThrow(new RuntimeException("db down")).when(operationLogMapper).updateById(any(OperationLog.class));
        // 写回失败绝不能传播
        assertDoesNotThrow(() -> cb.onEmitted(logWithId("log-3"), "evt", null));
    }

    @Test
    void wireBridgeCallback_nullBridge_isNoOp() {
        OperationLog ignored = new OperationLog();
        OperationLogService svc = new OperationLogService();
        ReflectionTestUtils.setField(svc, "operationLogMapper", operationLogMapper);
        // auditMtcBridge 保持 null
        assertDoesNotThrow(svc::wireBridgeCallback);
    }

    // ----------------------------------------------------------------- //
    // saveLog — fire-and-forget 韧性
    // ----------------------------------------------------------------- //
    @Test
    void saveLog_insertsAndBridgesEmit() {
        OperationLog l = new OperationLog();
        service.saveLog(l);
        verify(operationLogMapper).insert(l);
        verify(auditMtcBridge).emitForOperationLog(l);
    }

    @Test
    void saveLog_insertThrows_isSwallowed_andStillBridges() {
        OperationLog l = new OperationLog();
        doThrow(new RuntimeException("insert fail")).when(operationLogMapper).insert(l);
        assertDoesNotThrow(() -> service.saveLog(l));
        // 主审计路径失败不影响桥
        verify(auditMtcBridge).emitForOperationLog(l);
    }

    @Test
    void saveLog_bridgeThrows_isSwallowed() {
        OperationLog l = new OperationLog();
        doThrow(new RuntimeException("bridge fail")).when(auditMtcBridge).emitForOperationLog(l);
        assertDoesNotThrow(() -> service.saveLog(l));
        verify(operationLogMapper).insert(l);
    }

    @Test
    void saveLog_nullBridge_insertsWithoutBridge() {
        OperationLogService svc = new OperationLogService();
        ReflectionTestUtils.setField(svc, "operationLogMapper", operationLogMapper);
        OperationLog l = new OperationLog();
        assertDoesNotThrow(() -> svc.saveLog(l));
        verify(operationLogMapper).insert(l);
        verifyNoInteractions(auditMtcBridge);
    }

    // ----------------------------------------------------------------- //
    // 查询 / 删除 委托
    // ----------------------------------------------------------------- //
    @Test
    void getLogList_returnsMapperPage() {
        com.baomidou.mybatisplus.extension.plugins.pagination.Page<OperationLog> page =
                new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>();
        when(operationLogMapper.selectPage(any(), any())).thenReturn(page);
        var result = service.getLogList(1, 10, "u1", "auth", "LOGIN", "success");
        assertEquals(page, result);
        verify(operationLogMapper).selectPage(any(), any());
    }

    @Test
    void getLogList_allFiltersNull_stillQueries() {
        when(operationLogMapper.selectPage(any(), any()))
                .thenReturn(new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>());
        assertDoesNotThrow(() -> service.getLogList(1, 10, null, null, null, null));
        verify(operationLogMapper).selectPage(any(), any());
    }

    @Test
    void getLogById_delegates() {
        service.getLogById("id-9");
        verify(operationLogMapper).selectById("id-9");
    }

    @Test
    void deleteLog_delegates() {
        service.deleteLog("id-10");
        verify(operationLogMapper).deleteById("id-10");
    }

    @Test
    void batchDeleteLogs_delegates() {
        var ids = java.util.List.of("a", "b");
        service.batchDeleteLogs(ids);
        verify(operationLogMapper).deleteBatchIds(ids);
    }
}
