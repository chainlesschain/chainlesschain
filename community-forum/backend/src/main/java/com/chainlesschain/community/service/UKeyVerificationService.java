package com.chainlesschain.community.service;

import com.chainlesschain.community.mapper.DeviceKeyMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

import java.nio.charset.StandardCharsets;
import java.security.*;
import java.security.spec.X509EncodedKeySpec;
import java.util.Base64;
import java.util.Map;
import java.util.concurrent.ConcurrentHashMap;

/**
 * U盾/SIMKey验证服务
 *
 * 支持两种验证模式：
 * 1. 开发模式：接受任何有效格式的设备ID和PIN
 * 2. 生产模式：验证设备签名（需要设备公钥）
 */
@Service
public class UKeyVerificationService {

    private static final Logger logger = LoggerFactory.getLogger(UKeyVerificationService.class);

    @Autowired(required = false)
    private DeviceKeyMapper deviceKeyMapper;

    /**
     * 开发模式标志
     * 生产环境必须设置为 false
     */
    @Value("${ukey.dev-mode:true}")
    private boolean devMode;

    /**
     * 默认PIN（仅用于开发模式）
     */
    @Value("${ukey.default-pin:123456}")
    private String defaultPin;

    /**
     * 设备公钥缓存（设备ID -> 公钥）
     * 生产环境应从数据库或安全存储加载
     */
    private final Map<String, PublicKey> devicePublicKeys = new ConcurrentHashMap<>();

    /**
     * 验证U盾/SIMKey登录
     *
     * @param deviceId 设备ID
     * @param pin PIN码
     * @param deviceType 设备类型（UKEY/SIMKEY）
     * @param signature 设备签名（生产模式必需）
     * @param challenge 挑战值（生产模式必需）
     * @return 验证结果
     */
    public VerificationResult verify(String deviceId, String pin, String deviceType,
                                     String signature, String challenge) {
        logger.info("[UKey] 验证请求 - deviceId: {}, deviceType: {}, devMode: {}",
                    deviceId, deviceType, devMode);

        // 1. 基础参数验证
        if (deviceId == null || deviceId.trim().isEmpty()) {
            return VerificationResult.failure("设备ID不能为空");
        }

        if (pin == null || pin.trim().isEmpty()) {
            return VerificationResult.failure("PIN码不能为空");
        }

        // 2. 开发模式验证
        if (devMode) {
            return verifyDevMode(deviceId, pin, deviceType);
        }

        // 3. 生产模式验证
        return verifyProductionMode(deviceId, pin, deviceType, signature, challenge);
    }

    /**
     * 开发模式验证
     * 接受符合格式要求的设备ID和PIN
     */
    private VerificationResult verifyDevMode(String deviceId, String pin, String deviceType) {
        logger.debug("[UKey] 开发模式验证");

        // 验证设备ID格式（至少8位十六进制或UUID格式）
        if (!isValidDeviceIdFormat(deviceId)) {
            return VerificationResult.failure("设备ID格式无效");
        }

        // 验证PIN码（6位数字）
        if (!isValidPinFormat(pin)) {
            return VerificationResult.failure("PIN码格式无效（需要6位数字）");
        }

        // 开发模式下接受默认PIN或任意有效格式的PIN
        if (!pin.equals(defaultPin) && !pin.matches("\\d{6}")) {
            return VerificationResult.failure("PIN码错误");
        }

        logger.info("[UKey] 开发模式验证成功 - deviceId: {}", deviceId);
        return VerificationResult.success(deviceId, deviceType);
    }

    /**
     * 生产模式验证
     * 使用设备公钥验证签名
     */
    private VerificationResult verifyProductionMode(String deviceId, String pin, String deviceType,
                                                     String signature, String challenge) {
        logger.debug("[UKey] 生产模式验证");

        // 检查签名和挑战值
        if (signature == null || signature.isEmpty()) {
            return VerificationResult.failure("缺少设备签名");
        }

        if (challenge == null || challenge.isEmpty()) {
            return VerificationResult.failure("缺少挑战值");
        }

        // 获取设备公钥
        PublicKey publicKey = devicePublicKeys.get(deviceId);
        if (publicKey == null) {
            // 尝试从数据库加载
            publicKey = loadDevicePublicKey(deviceId);
            if (publicKey == null) {
                return VerificationResult.failure("未注册的设备");
            }
            devicePublicKeys.put(deviceId, publicKey);
        }

        // 验证签名
        try {
            boolean valid = verifySignature(challenge, signature, publicKey);
            if (!valid) {
                return VerificationResult.failure("签名验证失败");
            }
        } catch (Exception e) {
            logger.error("[UKey] 签名验证异常", e);
            return VerificationResult.failure("签名验证异常: " + e.getMessage());
        }

        logger.info("[UKey] 生产模式验证成功 - deviceId: {}", deviceId);
        return VerificationResult.success(deviceId, deviceType);
    }

    /**
     * 验证设备ID格式
     */
    private boolean isValidDeviceIdFormat(String deviceId) {
        // UUID格式
        if (deviceId.matches("[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}")) {
            return true;
        }
        // 十六进制格式（至少8位）
        if (deviceId.matches("[0-9a-fA-F]{8,}")) {
            return true;
        }
        // DID格式
        if (deviceId.startsWith("did:")) {
            return true;
        }
        return false;
    }

    /**
     * 验证PIN码格式
     */
    private boolean isValidPinFormat(String pin) {
        return pin != null && pin.matches("\\d{6}");
    }

    /**
     * 从数据库加载设备公钥
     */
    private PublicKey loadDevicePublicKey(String deviceId) {
        if (deviceKeyMapper == null) {
            logger.warn("[UKey] DeviceKeyMapper未注入，无法从数据库加载公钥");
            return null;
        }

        try {
            String publicKeyBase64 = deviceKeyMapper.findPublicKeyByDeviceId(deviceId);
            if (publicKeyBase64 == null || publicKeyBase64.isEmpty()) {
                logger.debug("[UKey] 未找到设备公钥: {}", deviceId);
                return null;
            }

            byte[] keyBytes = Base64.getDecoder().decode(publicKeyBase64);
            X509EncodedKeySpec spec = new X509EncodedKeySpec(keyBytes);
            KeyFactory keyFactory = KeyFactory.getInstance("RSA");
            PublicKey publicKey = keyFactory.generatePublic(spec);

            logger.info("[UKey] 成功从数据库加载设备公钥: {}", deviceId);
            return publicKey;
        } catch (Exception e) {
            logger.error("[UKey] 加载设备公钥失败: {}", deviceId, e);
            return null;
        }
    }

    /**
     * 验证签名
     */
    private boolean verifySignature(String data, String signatureBase64, PublicKey publicKey)
            throws Exception {
        byte[] signatureBytes = Base64.getDecoder().decode(signatureBase64);

        Signature sig = Signature.getInstance("SHA256withRSA");
        sig.initVerify(publicKey);
        sig.update(data.getBytes(StandardCharsets.UTF_8));

        return sig.verify(signatureBytes);
    }

    /**
     * 注册设备公钥（用于首次设备绑定）
     */
    public void registerDevicePublicKey(String deviceId, String publicKeyBase64) throws Exception {
        byte[] keyBytes = Base64.getDecoder().decode(publicKeyBase64);
        X509EncodedKeySpec spec = new X509EncodedKeySpec(keyBytes);
        KeyFactory keyFactory = KeyFactory.getInstance("RSA");
        PublicKey publicKey = keyFactory.generatePublic(spec);

        devicePublicKeys.put(deviceId, publicKey);
        logger.info("[UKey] 设备公钥已注册 - deviceId: {}", deviceId);
    }

    /**
     * 生成挑战值
     */
    public String generateChallenge() {
        byte[] bytes = new byte[32];
        new SecureRandom().nextBytes(bytes);
        return Base64.getEncoder().encodeToString(bytes);
    }

    /**
     * 验证结果
     */
    public static class VerificationResult {
        private final boolean success;
        private final String message;
        private final String deviceId;
        private final String deviceType;

        private VerificationResult(boolean success, String message, String deviceId, String deviceType) {
            this.success = success;
            this.message = message;
            this.deviceId = deviceId;
            this.deviceType = deviceType;
        }

        public static VerificationResult success(String deviceId, String deviceType) {
            return new VerificationResult(true, "验证成功", deviceId, deviceType);
        }

        public static VerificationResult failure(String message) {
            return new VerificationResult(false, message, null, null);
        }

        public boolean isSuccess() { return success; }
        public String getMessage() { return message; }
        public String getDeviceId() { return deviceId; }
        public String getDeviceType() { return deviceType; }
    }
}
