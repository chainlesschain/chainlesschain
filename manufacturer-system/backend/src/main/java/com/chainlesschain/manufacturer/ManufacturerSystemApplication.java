package com.chainlesschain.manufacturer;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.context.annotation.EnableAspectJAutoProxy;

/**
 * U盾/SIMKey厂家管理系统主程序
 *
 * @author ChainlessChain Team
 * @since 2024-12-02
 */
@SpringBootApplication
@MapperScan("com.chainlesschain.manufacturer.mapper")
@EnableAspectJAutoProxy
public class ManufacturerSystemApplication {

    public static void main(String[] args) {
        SpringApplication.run(ManufacturerSystemApplication.class, args);
        System.out.println("""

                ========================================
                U盾/SIMKey厂家管理系统启动成功!
                Swagger文档: http://localhost:8080/api/swagger-ui.html
                API文档: http://localhost:8080/api/v3/api-docs
                ========================================
                """);
    }
}
