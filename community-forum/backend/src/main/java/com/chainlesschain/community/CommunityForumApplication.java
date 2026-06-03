package com.chainlesschain.community;

import org.mybatis.spring.annotation.MapperScan;
import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.boot.autoconfigure.data.elasticsearch.ElasticsearchDataAutoConfiguration;
import org.springframework.boot.autoconfigure.data.redis.RedisAutoConfiguration;
import org.springframework.scheduling.annotation.EnableAsync;

/**
 * ChainlessChain Community Forum Application
 *
 * @author ChainlessChain Team
 */
@SpringBootApplication(exclude = {
        RedisAutoConfiguration.class,
        ElasticsearchDataAutoConfiguration.class
})
@MapperScan("com.chainlesschain.community.mapper")
@EnableAsync
public class CommunityForumApplication {

    public static void main(String[] args) {
        SpringApplication.run(CommunityForumApplication.class, args);
        System.out.println("""

                ==========================================
                  ChainlessChain Community Forum Started
                ==========================================
                  API: http://localhost:8082/api
                  Swagger: http://localhost:8082/api/swagger-ui.html
                ==========================================
                """);
    }
}
