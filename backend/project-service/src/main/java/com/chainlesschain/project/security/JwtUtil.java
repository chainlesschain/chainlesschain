package com.chainlesschain.project.security;

import io.jsonwebtoken.Claims;
import io.jsonwebtoken.Jwts;
import io.jsonwebtoken.security.Keys;
import jakarta.annotation.PostConstruct;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

import javax.crypto.SecretKey;
import java.nio.charset.StandardCharsets;
import java.util.Date;
import java.util.HashMap;
import java.util.Map;
import java.util.function.Function;

/**
 * JWT工具类
 * 用于生成、解析和验证JWT令牌
 *
 * Updated for jjwt 0.12.x API
 */
@Component
public class JwtUtil {

    private static final Logger log = LoggerFactory.getLogger(JwtUtil.class);

    /**
     * Well-known dev placeholders that must never be accepted as a real secret.
     * If the configured value matches any of these, startup fails — preventing
     * an accidental production deploy with the example secret.
     */
    private static final String[] BANNED_SECRETS = {
        "chainlesschain-secret-key-for-jwt-token-generation-2024",
        "chainlesschain-secret-key-for-jwt-token-generation-2024-please-change-in-production"
    };

    /** HS256 mandates >= 32 raw bytes of key material per RFC 7518. */
    private static final int MIN_SECRET_BYTES = 32;

    // No fallback default — application.yml resolves via env var, or the
    // dev profile (application-dev.yml) supplies a placeholder. Production
    // must always provide JWT_SECRET via environment.
    @Value("${jwt.secret}")
    private String secret;

    @Value("${jwt.expiration:86400000}") // 默认24小时
    private Long expiration;

    @PostConstruct
    void validateSecret() {
        if (secret == null || secret.isBlank()) {
            throw new IllegalStateException(
                "jwt.secret is not configured — set the JWT_SECRET env var");
        }
        for (String banned : BANNED_SECRETS) {
            if (banned.equals(secret)) {
                throw new IllegalStateException(
                    "jwt.secret is the well-known dev placeholder. " +
                    "Generate a real secret (>=32 random bytes) and set " +
                    "the JWT_SECRET env var before starting the service.");
            }
        }
        int byteLen = secret.getBytes(StandardCharsets.UTF_8).length;
        if (byteLen < MIN_SECRET_BYTES) {
            throw new IllegalStateException(
                "jwt.secret is too short (" + byteLen + " bytes). " +
                "HS256 requires at least " + MIN_SECRET_BYTES + " bytes.");
        }
        log.info("JWT secret validated ({} bytes)", byteLen);
    }

    /**
     * 从令牌中提取用户名
     */
    public String extractUsername(String token) {
        return extractClaim(token, Claims::getSubject);
    }

    /**
     * 从令牌中提取过期时间
     */
    public Date extractExpiration(String token) {
        return extractClaim(token, Claims::getExpiration);
    }

    /**
     * 从令牌中提取指定声明
     */
    public <T> T extractClaim(String token, Function<Claims, T> claimsResolver) {
        final Claims claims = extractAllClaims(token);
        return claimsResolver.apply(claims);
    }

    /**
     * 从令牌中提取所有声明
     */
    private Claims extractAllClaims(String token) {
        return Jwts.parser()
                .verifyWith(getSigningKey())
                .build()
                .parseSignedClaims(token)
                .getPayload();
    }

    /**
     * 检查令牌是否过期
     */
    private Boolean isTokenExpired(String token) {
        return extractExpiration(token).before(new Date());
    }

    /**
     * 生成令牌
     */
    public String generateToken(String username) {
        Map<String, Object> claims = new HashMap<>();
        return createToken(claims, username);
    }

    /**
     * 生成令牌（带额外声明）
     */
    public String generateToken(String username, Map<String, Object> claims) {
        return createToken(claims, username);
    }

    /**
     * 创建令牌
     */
    private String createToken(Map<String, Object> claims, String subject) {
        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expiration);

        return Jwts.builder()
                .claims(claims)
                .subject(subject)
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(getSigningKey())
                .compact();
    }

    /**
     * 验证令牌
     */
    public Boolean validateToken(String token, String username) {
        final String extractedUsername = extractUsername(token);
        return (extractedUsername.equals(username) && !isTokenExpired(token));
    }

    /**
     * 获取签名密钥
     */
    private SecretKey getSigningKey() {
        byte[] keyBytes = secret.getBytes(StandardCharsets.UTF_8);
        return Keys.hmacShaKeyFor(keyBytes);
    }

    /**
     * 刷新令牌
     */
    public String refreshToken(String token) {
        final Claims oldClaims = extractAllClaims(token);
        String subject = oldClaims.getSubject();

        // Create new claims map from old claims
        Map<String, Object> newClaims = new HashMap<>(oldClaims);

        Date now = new Date();
        Date expiryDate = new Date(now.getTime() + expiration);

        return Jwts.builder()
                .claims(newClaims)
                .subject(subject)
                .issuedAt(now)
                .expiration(expiryDate)
                .signWith(getSigningKey())
                .compact();
    }
}
