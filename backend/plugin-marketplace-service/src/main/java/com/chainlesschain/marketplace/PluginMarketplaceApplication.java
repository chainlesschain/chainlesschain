package com.chainlesschain.marketplace;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.cache.annotation.EnableCaching;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.annotation.EnableScheduling;

/**
 * Plugin Marketplace Service Application
 *
 * @author ChainlessChain Team
 * @version 1.0.0
 */
@SpringBootApplication
@EnableCaching
@EnableAsync
@EnableScheduling
@MapperScan("com.chainlesschain.marketplace.mapper")
public class PluginMarketplaceApplication {

    public static void main(String[] args) {
        SpringApplication.run(PluginMarketplaceApplication.class, args);
        System.out.println("""

            ========================================
            Plugin Marketplace Service Started!
            ========================================
            API Documentation: http://localhost:8090/api/swagger-ui.html
            Health Check: http://localhost:8090/api/actuator/health
            ========================================
            """);
    }
}
