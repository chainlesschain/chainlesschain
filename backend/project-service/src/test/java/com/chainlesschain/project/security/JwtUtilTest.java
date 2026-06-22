package com.chainlesschain.project.security;

import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Date;
import java.util.Map;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.junit.jupiter.api.Assertions.assertTrue;

/**
 * {@link JwtUtil} 测试（先前零覆盖）。
 *
 * JWT 是认证核心。覆盖：validateSecret 的安全护栏（拒空/拒已知 dev 占位/拒 <32 字节）、
 * 令牌签发→解析往返、自定义声明透传、validateToken 用户名匹配 + 过期判定、过期令牌
 * 解析抛错、refreshToken 保留 subject 与自定义声明。私有/包级字段经 ReflectionTestUtils
 * 注入。纯单元，不需 Spring 上下文。
 */
class JwtUtilTest {

    // 32+ 字节的有效测试密钥（绝非 banned 占位）
    private static final String VALID_SECRET =
            "unit-test-secret-key-0123456789-abcdefghij";  // 42 bytes ASCII

    private JwtUtil newJwt(String secret, long expiration) {
        JwtUtil jwt = new JwtUtil();
        ReflectionTestUtils.setField(jwt, "secret", secret);
        ReflectionTestUtils.setField(jwt, "expiration", expiration);
        return jwt;
    }

    private JwtUtil validJwt() {
        return newJwt(VALID_SECRET, 86400000L);
    }

    // ----------------------------------------------------------------- //
    // validateSecret — 安全护栏
    // ----------------------------------------------------------------- //
    @Test
    void validateSecret_nullOrBlank_throws() {
        assertThrows(IllegalStateException.class,
                () -> newJwt(null, 1000L).validateSecret());
        assertThrows(IllegalStateException.class,
                () -> newJwt("   ", 1000L).validateSecret());
    }

    @Test
    void validateSecret_wellKnownDevPlaceholder_throws() {
        JwtUtil jwt = newJwt(
                "chainlesschain-secret-key-for-jwt-token-generation-2024", 1000L);
        assertThrows(IllegalStateException.class, jwt::validateSecret);
    }

    @Test
    void validateSecret_tooShort_throws() {
        // 31 字节 < HS256 要求的 32 字节
        assertThrows(IllegalStateException.class,
                () -> newJwt("0123456789012345678901234567890", 1000L).validateSecret());
    }

    @Test
    void validateSecret_validKey_passes() {
        assertDoesNotThrow(() -> validJwt().validateSecret());
    }

    // ----------------------------------------------------------------- //
    // 签发 / 解析 往返
    // ----------------------------------------------------------------- //
    @Test
    void generateThenExtractUsername_roundTrips() {
        JwtUtil jwt = validJwt();
        String token = jwt.generateToken("alice");
        assertEquals("alice", jwt.extractUsername(token));
    }

    @Test
    void generateWithExtraClaims_areReadable() {
        JwtUtil jwt = validJwt();
        String token = jwt.generateToken("bob", Map.of("role", "ADMIN"));
        String role = jwt.extractClaim(token, c -> c.get("role", String.class));
        assertEquals("ADMIN", role);
        assertEquals("bob", jwt.extractUsername(token));
    }

    @Test
    void extractExpiration_isInTheFuture() {
        JwtUtil jwt = validJwt();
        Date exp = jwt.extractExpiration(jwt.generateToken("carol"));
        assertTrue(exp.after(new Date()));
    }

    // ----------------------------------------------------------------- //
    // validateToken
    // ----------------------------------------------------------------- //
    @Test
    void validateToken_matchingUsername_true() {
        JwtUtil jwt = validJwt();
        String token = jwt.generateToken("dave");
        assertTrue(jwt.validateToken(token, "dave"));
    }

    @Test
    void validateToken_wrongUsername_false() {
        JwtUtil jwt = validJwt();
        String token = jwt.generateToken("dave");
        assertFalse(jwt.validateToken(token, "eve"));
    }

    // ----------------------------------------------------------------- //
    // 过期 / 篡改
    // ----------------------------------------------------------------- //
    @Test
    void expiredToken_parsingThrows() {
        // 负过期 → 签发即过期；jjwt 解析时抛 ExpiredJwtException
        JwtUtil jwt = newJwt(VALID_SECRET, -1000L);
        String token = jwt.generateToken("frank");
        assertThrows(Exception.class, () -> jwt.extractUsername(token));
    }

    @Test
    void tokenSignedWithDifferentSecret_failsVerification() {
        String token = newJwt(VALID_SECRET, 86400000L).generateToken("grace");
        JwtUtil other = newJwt("a-totally-different-secret-key-32bytes!!", 86400000L);
        // 不同密钥签名校验失败 → 抛错
        assertThrows(Exception.class, () -> other.extractUsername(token));
    }

    // ----------------------------------------------------------------- //
    // refreshToken
    // ----------------------------------------------------------------- //
    @Test
    void refreshToken_preservesSubjectAndCustomClaims() {
        JwtUtil jwt = validJwt();
        String original = jwt.generateToken("heidi", Map.of("role", "EDITOR"));
        String refreshed = jwt.refreshToken(original);
        assertEquals("heidi", jwt.extractUsername(refreshed));
        assertEquals("EDITOR", jwt.extractClaim(refreshed, c -> c.get("role", String.class)));
        // 刷新后的令牌仍可被同密钥验证
        assertTrue(jwt.validateToken(refreshed, "heidi"));
    }
}
