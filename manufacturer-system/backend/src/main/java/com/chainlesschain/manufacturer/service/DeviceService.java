package com.chainlesschain.manufacturer.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.chainlesschain.manufacturer.dto.DeviceActivateRequest;
import com.chainlesschain.manufacturer.dto.DeviceQueryRequest;
import com.chainlesschain.manufacturer.dto.DeviceRegisterRequest;
import com.chainlesschain.manufacturer.entity.Device;
import com.chainlesschain.manufacturer.mapper.DeviceMapper;
import cn.hutool.core.util.IdUtil;
import cn.hutool.core.util.RandomUtil;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.time.LocalDateTime;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * 设备管理服务
 */
@Service
@RequiredArgsConstructor
public class DeviceService {

    private final DeviceMapper deviceMapper;

    /**
     * 批量注册设备
     */
    @Transactional
    public Map<String, Object> registerDevices(DeviceRegisterRequest request) {
        int registered = 0;
        int failed = 0;

        for (DeviceRegisterRequest.DeviceInfo deviceInfo : request.getDevices()) {
            try {
                Device device = new Device();
                device.setDeviceId(generateDeviceId(deviceInfo.getDeviceType()));
                device.setDeviceType(deviceInfo.getDeviceType());
                device.setSerialNumber(deviceInfo.getSerialNumber());
                device.setManufacturer(deviceInfo.getManufacturer());
                device.setModel(deviceInfo.getModel());
                device.setHardwareVersion(deviceInfo.getHardwareVersion());
                device.setFirmwareVersion(deviceInfo.getFirmwareVersion());
                device.setStatus("INACTIVE");

                // 生成激活码
                String activationCode = generateActivationCode();
                device.setActivationCode(activationCode);
                device.setActivationExpiresAt(LocalDateTime.now().plusYears(1));

                deviceMapper.insert(device);
                registered++;
            } catch (Exception e) {
                failed++;
            }
        }

        Map<String, Object> result = new HashMap<>();
        result.put("registered", registered);
        result.put("failed", failed);
        result.put("total", request.getDevices().size());
        return result;
    }

    /**
     * 激活设备
     */
    @Transactional
    public Map<String, Object> activateDevice(DeviceActivateRequest request) {
        // 查询设备
        LambdaQueryWrapper<Device> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Device::getDeviceId, request.getDeviceId())
                .eq(Device::getActivationCode, request.getActivationCode());
        Device device = deviceMapper.selectOne(wrapper);

        if (device == null) {
            throw new RuntimeException("设备不存在或激活码错误");
        }

        if ("ACTIVE".equals(device.getStatus())) {
            throw new RuntimeException("设备已激活");
        }

        if (device.getActivationExpiresAt().isBefore(LocalDateTime.now())) {
            throw new RuntimeException("激活码已过期");
        }

        // 激活设备
        device.setStatus("ACTIVE");
        device.setActivatedAt(LocalDateTime.now());
        device.setUserId(request.getUserId());
        device.setMasterKeyEncrypted(request.getMasterKeyEncrypted());
        deviceMapper.updateById(device);

        Map<String, Object> result = new HashMap<>();
        result.put("deviceId", device.getDeviceId());
        result.put("status", device.getStatus());
        result.put("activatedAt", device.getActivatedAt());
        return result;
    }

    /**
     * 查询设备列表
     */
    public IPage<Device> listDevices(DeviceQueryRequest request) {
        Page<Device> page = new Page<>(request.getPage(), request.getSize());
        LambdaQueryWrapper<Device> wrapper = new LambdaQueryWrapper<>();

        if (request.getDeviceType() != null) {
            wrapper.eq(Device::getDeviceType, request.getDeviceType());
        }
        if (request.getStatus() != null) {
            wrapper.eq(Device::getStatus, request.getStatus());
        }
        if (request.getKeyword() != null) {
            wrapper.and(w -> w.like(Device::getDeviceId, request.getKeyword())
                    .or().like(Device::getSerialNumber, request.getKeyword()));
        }

        wrapper.orderByDesc(Device::getCreatedAt);
        return deviceMapper.selectPage(page, wrapper);
    }

    /**
     * 查询设备详情
     */
    public Device getDeviceById(String deviceId) {
        LambdaQueryWrapper<Device> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Device::getDeviceId, deviceId);
        return deviceMapper.selectOne(wrapper);
    }

    /**
     * 锁定设备
     */
    @Transactional
    public void lockDevice(String deviceId, String reason) {
        Device device = getDeviceById(deviceId);
        if (device == null) {
            throw new RuntimeException("设备不存在");
        }
        device.setStatus("LOCKED");
        deviceMapper.updateById(device);
    }

    /**
     * 解锁设备
     */
    @Transactional
    public void unlockDevice(String deviceId) {
        Device device = getDeviceById(deviceId);
        if (device == null) {
            throw new RuntimeException("设备不存在");
        }
        device.setStatus("ACTIVE");
        deviceMapper.updateById(device);
    }

    /**
     * 注销设备
     */
    @Transactional
    public void deactivateDevice(String deviceId) {
        Device device = getDeviceById(deviceId);
        if (device == null) {
            throw new RuntimeException("设备不存在");
        }
        device.setStatus("DEACTIVATED");
        deviceMapper.updateById(device);
    }

    /**
     * 生成设备ID
     */
    private String generateDeviceId(String deviceType) {
        String prefix = "UKEY".equals(deviceType) ? "uk_" : "sk_";
        return prefix + IdUtil.simpleUUID().substring(0, 16);
    }

    /**
     * 生成激活码 (格式: XXXX-XXXX-XXXX-XXXX)
     */
    private String generateActivationCode() {
        return String.format("%s-%s-%s-%s",
                RandomUtil.randomString(4).toUpperCase(),
                RandomUtil.randomString(4).toUpperCase(),
                RandomUtil.randomString(4).toUpperCase(),
                RandomUtil.randomString(4).toUpperCase()
        );
    }
}
