package com.chainlesschain.project.config;

import com.chainlesschain.project.security.ProjectSubresourceAccessInterceptor;
import lombok.RequiredArgsConstructor;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.CorsRegistry;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

/**
 * Web配置 - CORS跨域支持 + 项目子资源授权拦截器
 */
@Configuration
@RequiredArgsConstructor
public class WebConfig implements WebMvcConfigurer {

    private final ProjectSubresourceAccessInterceptor projectSubresourceAccessInterceptor;

    @Override
    public void addCorsMappings(CorsRegistry registry) {
        registry.addMapping("/**")
                .allowedOriginPatterns("*")
                .allowedMethods("GET", "POST", "PUT", "DELETE", "OPTIONS")
                .allowedHeaders("*")
                .allowCredentials(true)
                .maxAge(3600);
    }

    /**
     * 项目子资源（files / comments / collaborators）统一项目级授权拦截，修复 IDOR。
     * 项目自身端点由 ProjectController 显式调用 ProjectAccessGuard。
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(projectSubresourceAccessInterceptor)
                .addPathPatterns(
                        "/api/projects/*/files/**",
                        "/api/projects/*/comments/**",
                        "/api/projects/*/collaborators/**");
    }
}
