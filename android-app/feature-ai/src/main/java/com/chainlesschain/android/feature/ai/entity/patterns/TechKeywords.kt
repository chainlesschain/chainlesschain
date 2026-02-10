package com.chainlesschain.android.feature.ai.entity.patterns

/**
 * Tech Keywords
 *
 * Contains 140+ technology-related keywords for entity extraction.
 * Organized by category for efficient matching.
 */
object TechKeywords {

    /**
     * Programming languages
     */
    val languages = setOf(
        // Popular languages
        "kotlin", "java", "python", "javascript", "typescript", "swift", "go", "rust",
        "c", "c++", "c#", "ruby", "php", "scala", "haskell", "elixir", "clojure",
        "dart", "lua", "perl", "r", "matlab", "julia", "groovy", "objective-c",
        // Scripting & markup
        "bash", "shell", "powershell", "sql", "html", "css", "sass", "scss",
        "xml", "json", "yaml", "toml", "markdown"
    )

    /**
     * Frameworks and libraries
     */
    val frameworks = setOf(
        // Mobile
        "android", "ios", "flutter", "react native", "xamarin", "ionic", "cordova",
        "jetpack compose", "swiftui", "uikit",
        // Web frontend
        "react", "vue", "angular", "svelte", "next.js", "nuxt", "gatsby",
        "tailwind", "bootstrap", "material ui", "ant design",
        // Web backend
        "spring", "spring boot", "django", "flask", "fastapi", "express",
        "nestjs", "rails", "laravel", "asp.net", "gin", "fiber",
        // Data & ML
        "tensorflow", "pytorch", "keras", "scikit-learn", "pandas", "numpy",
        "spark", "hadoop", "flink", "kafka"
    )

    /**
     * Cloud platforms and services
     */
    val cloudServices = setOf(
        // Major clouds
        "aws", "azure", "gcp", "google cloud", "alibaba cloud", "tencent cloud",
        // AWS services
        "ec2", "s3", "lambda", "dynamodb", "rds", "eks", "ecs", "cloudfront",
        // Azure services
        "azure functions", "cosmos db", "aks", "app service",
        // GCP services
        "cloud run", "bigquery", "gke", "cloud storage",
        // Other cloud services
        "heroku", "vercel", "netlify", "cloudflare", "digitalocean"
    )

    /**
     * Databases
     */
    val databases = setOf(
        // Relational
        "mysql", "postgresql", "postgres", "sqlite", "oracle", "sql server",
        "mariadb", "cockroachdb",
        // NoSQL
        "mongodb", "redis", "elasticsearch", "cassandra", "couchdb",
        "dynamodb", "firebase", "supabase",
        // Vector databases
        "pinecone", "milvus", "qdrant", "weaviate", "chroma",
        // Graph databases
        "neo4j", "arangodb", "tigergraph"
    )

    /**
     * DevOps tools
     */
    val devops = setOf(
        // Containers
        "docker", "kubernetes", "k8s", "podman", "containerd",
        // CI/CD
        "jenkins", "gitlab ci", "github actions", "circleci", "travis ci",
        "argo", "tekton", "drone",
        // IaC
        "terraform", "ansible", "puppet", "chef", "pulumi", "cloudformation",
        // Monitoring
        "prometheus", "grafana", "datadog", "newrelic", "splunk",
        "elastic", "kibana", "jaeger", "zipkin"
    )

    /**
     * AI/ML terms
     */
    val aiTerms = setOf(
        // Models
        "gpt", "gpt-4", "gpt-3.5", "claude", "gemini", "llama", "mistral",
        "bert", "transformer", "diffusion",
        // Concepts
        "llm", "nlp", "rag", "embedding", "fine-tuning", "prompt engineering",
        "vector search", "semantic search", "neural network", "deep learning",
        "machine learning", "reinforcement learning",
        // Tools
        "langchain", "llamaindex", "huggingface", "openai", "anthropic",
        "ollama", "lmstudio", "vllm"
    )

    /**
     * Development concepts
     */
    val concepts = setOf(
        // Architecture
        "microservices", "monolith", "serverless", "api gateway", "rest",
        "graphql", "grpc", "websocket", "mqtt",
        // Patterns
        "mvc", "mvvm", "clean architecture", "ddd", "cqrs", "event sourcing",
        "repository pattern", "factory pattern", "singleton",
        // Practices
        "ci/cd", "devops", "gitops", "agile", "scrum", "kanban",
        "tdd", "bdd", "pair programming", "code review"
    )

    /**
     * All keywords combined
     */
    val all: Set<String> by lazy {
        languages + frameworks + cloudServices + databases + devops + aiTerms + concepts
    }

    /**
     * Check if text contains a tech keyword
     */
    fun containsKeyword(text: String): Boolean {
        val lowerText = text.lowercase()
        return all.any { keyword ->
            lowerText.contains(keyword)
        }
    }

    /**
     * Find all tech keywords in text
     */
    fun findKeywords(text: String): List<String> {
        val lowerText = text.lowercase()
        return all.filter { keyword ->
            // Match whole words
            val regex = Regex("\\b${Regex.escape(keyword)}\\b", RegexOption.IGNORE_CASE)
            regex.containsMatchIn(lowerText)
        }
    }

    /**
     * Get category for a keyword
     */
    fun getCategory(keyword: String): String {
        val lower = keyword.lowercase()
        return when {
            languages.contains(lower) -> "Language"
            frameworks.contains(lower) -> "Framework"
            cloudServices.contains(lower) -> "Cloud"
            databases.contains(lower) -> "Database"
            devops.contains(lower) -> "DevOps"
            aiTerms.contains(lower) -> "AI/ML"
            concepts.contains(lower) -> "Concept"
            else -> "Other"
        }
    }
}
