package com.chainlesschain.manufacturer.controller;

import com.chainlesschain.manufacturer.common.Result;
import com.chainlesschain.manufacturer.dto.InitiateRecoveryRequest;
import com.chainlesschain.manufacturer.dto.VerifyRecoveryRequest;
import com.chainlesschain.manufacturer.dto.ResetPasswordRequest;
import com.chainlesschain.manufacturer.service.RecoveryService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

/**
 * 密码恢复Controller
 */
@Tag(name = "密码恢复", description = "密码找回、重置等接口")
@RestController
@RequestMapping("/recovery")
@RequiredArgsConstructor
public class RecoveryController {

    private final RecoveryService recoveryService;

    @Operation(summary = "发起密码恢复")
    @PostMapping("/initiate")
    public Result<?> initiateRecovery(@Valid @RequestBody InitiateRecoveryRequest request) {
        return Result.success(recoveryService.initiateRecovery(request));
    }

    @Operation(summary = "验证恢复信息")
    @PostMapping("/verify")
    public Result<?> verifyRecovery(@Valid @RequestBody VerifyRecoveryRequest request) {
        return Result.success(recoveryService.verifyRecovery(request));
    }

    @Operation(summary = "重置密码")
    @PostMapping("/reset-password")
    public Result<?> resetPassword(@Valid @RequestBody ResetPasswordRequest request) {
        recoveryService.resetPassword(request);
        return Result.success("密码重置成功");
    }
}
