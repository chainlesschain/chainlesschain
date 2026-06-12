// ChainlessChain IDE Bridge — JetBrains plugin.
//
// Build requires the IntelliJ Platform SDK (downloaded by the Gradle plugin at
// build time). The protocol/server/lockfile/tools core under
// com.chainlesschain.ide is pure JDK and is also compiled + interop-tested
// independently (see README "Verification").
plugins {
    id("java")
    id("org.jetbrains.intellij.platform") version "2.1.0"
}

group = "com.chainlesschain"
version = "0.3.3"

repositories {
    mavenCentral()
    intellijPlatform {
        defaultRepositories()
    }
}

dependencies {
    intellijPlatform {
        // Community is enough — the bridge uses only platform + terminal APIs.
        intellijIdeaCommunity("2024.2")
        bundledPlugin("org.jetbrains.plugins.terminal")
    }
}

java {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
}

// Windows javac defaults to the platform codepage (GBK) — non-ASCII UI
// strings (✓ ⚠ ℹ …) would be miscompiled into mojibake without this.
tasks.withType<JavaCompile> {
    options.encoding = "UTF-8"
}

intellijPlatform {
    // Plain-Java plugin: no UI forms / no @NotNull bytecode instrumentation, so
    // skip code instrumentation (avoids the InstrumentIdeaExtensions ant-task
    // dependency the 2.x plugin otherwise needs).
    instrumentCode = false

    pluginConfiguration {
        ideaVersion {
            sinceBuild = "242"
            untilBuild = provider { null } // no hard upper bound
        }
    }

    // `./gradlew publishPlugin` uploads to the JetBrains Marketplace. The token
    // comes from the CI secret JETBRAINS_PUBLISH_TOKEN (never commit it).
    publishing {
        token = providers.environmentVariable("JETBRAINS_PUBLISH_TOKEN")
    }

    // Marketplace requires signed plugins; supply the cert chain + key via env
    // when releasing (CERTIFICATE_CHAIN / PRIVATE_KEY / PRIVATE_KEY_PASSWORD).
    signing {
        certificateChain = providers.environmentVariable("CERTIFICATE_CHAIN")
        privateKey = providers.environmentVariable("PRIVATE_KEY")
        password = providers.environmentVariable("PRIVATE_KEY_PASSWORD")
    }
}

tasks {
    // The interop probe main lives under src/test and is not shipped.
    test {
        enabled = false
    }
}
