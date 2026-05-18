package com.chainlesschain.manufacturer.controller;

import com.chainlesschain.manufacturer.common.Result;
import com.chainlesschain.manufacturer.dto.DeviceActivateRequest;
import com.chainlesschain.manufacturer.dto.DeviceRegisterRequest;
import com.chainlesschain.manufacturer.dto.DeviceQueryRequest;
import com.chainlesschain.manufacturer.service.DeviceService;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import lombok.RequiredArgsConstructor;
import org.springframework.web.bind.annotation.*;

import jakarta.validation.Valid;

/**
 * 设备管理Controller
 */
@Tag(name = "设备管理", description = "设备注册、激活、锁定等管理接口")
@RestController
@RequestMapping("/devices")
@RequiredArgsConstructor
public class DeviceController {

    private final DeviceService deviceService;

    @Operation(summary = "批量注册设备")
    @PostMapping("/register")
    public Result<?> registerDevices(@Valid @RequestBody DeviceRegisterRequest request) {
        return Result.success(deviceService.registerDevices(request));
    }

    @Operation(summary = "激活设备")
    @PostMapping("/activate")
    public Result<?> activateDevice(@Valid @RequestBody DeviceActivateRequest request) {
        return Result.success(deviceService.activateDevice(request));
    }

    @Operation(summary = "查询设备列表")
    @GetMapping("/list")
    public Result<?> listDevices(DeviceQueryRequest request) {
        return Result.success(deviceService.listDevices(request));
    }

    @Operation(summary = "查询设备详情")
    @GetMapping("/{deviceId}")
    public Result<?> getDevice(@PathVariable String deviceId) {
        return Result.success(deviceService.getDeviceById(deviceId));
    }

    @Operation(summary = "锁定设备")
    @PostMapping("/{deviceId}/lock")
    public Result<?> lockDevice(@PathVariable String deviceId, @RequestParam String reason) {
        deviceService.lockDevice(deviceId, reason);
        return Result.success("设备已锁定");
    }

    @Operation(summary = "解锁设备")
    @PostMapping("/{deviceId}/unlock")
    public Result<?> unlockDevice(@PathVariable String deviceId) {
        deviceService.unlockDevice(deviceId);
        return Result.success("设备已解锁");
    }

    @Operation(summary = "注销设备")
    @PostMapping("/{deviceId}/deactivate")
    public Result<?> deactivateDevice(@PathVariable String deviceId) {
        deviceService.deactivateDevice(deviceId);
        return Result.success("设备已注销");
    }
}
