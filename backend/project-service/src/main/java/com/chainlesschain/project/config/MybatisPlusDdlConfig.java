package com.chainlesschain.project.config;

import com.baomidou.mybatisplus.autoconfigure.DdlApplicationRunner;
import com.baomidou.mybatisplus.extension.ddl.IDdl;
import java.util.Collections;
import org.springframework.boot.autoconfigure.condition.ConditionalOnMissingBean;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

@Configuration
public class MybatisPlusDdlConfig {

    // MyBatis-Plus returns null when no IDdl beans exist, which breaks runner startup.
    @Bean
    @ConditionalOnMissingBean(IDdl.class)
    public DdlApplicationRunner ddlApplicationRunner() {
        return new DdlApplicationRunner(Collections.emptyList());
    }
}
