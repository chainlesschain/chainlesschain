package com.chainlesschain.project.config;

import io.swagger.v3.oas.models.OpenAPI;
import io.swagger.v3.oas.models.info.Contact;
import io.swagger.v3.oas.models.info.Info;
import io.swagger.v3.oas.models.info.License;
import io.swagger.v3.oas.models.servers.Server;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import java.util.List;

/**
 * SpringDoc OpenAPI 配置
 * 提供API文档和Swagger UI界面
 * 访问地址: http://localhost:9090/swagger-ui.html
 * API文档: http://localhost:9090/v3/api-docs
 */
@Configuration
public class OpenAPIConfig {

    @Bean
    public OpenAPI customOpenAPI() {
        return new OpenAPI()
                .info(new Info()
                        .title("ChainlessChain 项目服务 API")
                        .version("1.0.0")
                        .description("ChainlessChain 分布式个人AI管理系统 - 项目服务API文档")
                        .contact(new Contact()
                                .name("ChainlessChain Team")
                                .email("support@chainlesschain.com")
                                .url("https://chainlesschain.com"))
                        .license(new License()
                                .name("Apache 2.0")
                                .url("https://www.apache.org/licenses/LICENSE-2.0.html")))
                .servers(List.of(
                        new Server()
                                .url("http://localhost:9090")
                                .description("本地开发环境"),
                        new Server()
                                .url("http://localhost:8001")
                                .description("AI服务环境")
                ));
    }
}
