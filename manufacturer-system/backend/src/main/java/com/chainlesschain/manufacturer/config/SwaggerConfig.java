package com.chainlesschain.manufacturer.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Swagger配置类
 */
@Configuration
public class SwaggerConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("U盾/SIMKey厂家管理系统API")
                        .version("1.0.0")
                        .description("提供设备管理、激活、密码恢复、数据备份、APP版本管理等功能")
                        .contact(new Contact()
                                .name("ChainlessChain Team")
                                .email("zhanglongfa@chainlesschain.com")
                                .url("https://www.chainlesschain.com"))
                        .license(new License()
                                .name("MIT License")
                                .url("https://opensource.org/licenses/MIT")));
    }
}
