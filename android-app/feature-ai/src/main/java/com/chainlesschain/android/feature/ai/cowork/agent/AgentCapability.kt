package com.chainlesschain.android.feature.ai.cowork.agent

/**
 * Agent Capability
 *
 * Defines the capabilities that agents can have.
 */
enum class AgentCapability(
    val displayName: String,
    val description: String
) {
    /**
     * Can generate and analyze code
     */
    CODE_GENERATION("Code Generation", "Generate and analyze source code"),

    /**
     * Can review and provide feedback on code
     */
    CODE_REVIEW("Code Review", "Review code and suggest improvements"),

    /**
     * Can perform web searches
     */
    WEB_SEARCH("Web Search", "Search the web for information"),

    /**
     * Can read and write files
     */
    FILE_ACCESS("File Access", "Read and write files in sandbox"),

    /**
     * Can execute shell commands
     */
    SHELL_EXECUTION("Shell Execution", "Execute shell commands safely"),

    /**
     * Can analyze data and generate reports
     */
    DATA_ANALYSIS("Data Analysis", "Analyze data and generate insights"),

    /**
     * Can generate and manipulate images
     */
    IMAGE_GENERATION("Image Generation", "Generate and edit images"),

    /**
     * Can process and understand documents
     */
    DOCUMENT_PROCESSING("Document Processing", "Process PDFs, Office docs, etc."),

    /**
     * Can interact with APIs
     */
    API_INTEGRATION("API Integration", "Call external APIs"),

    /**
     * Can manage and coordinate other agents
     */
    ORCHESTRATION("Orchestration", "Coordinate other agents"),

    /**
     * Can generate and execute tests
     */
    TESTING("Testing", "Generate and run tests"),

    /**
     * Can generate documentation
     */
    DOCUMENTATION("Documentation", "Generate documentation");

    companion object {
        /**
         * Get capability from string
         */
        fun fromString(value: String): AgentCapability? {
            return entries.find {
                it.name.equals(value, ignoreCase = true) ||
                it.displayName.equals(value, ignoreCase = true)
            }
        }

        /**
         * Default capabilities for a general agent
         */
        val defaultCapabilities: Set<AgentCapability>
            get() = setOf(CODE_GENERATION, FILE_ACCESS, WEB_SEARCH)

        /**
         * All code-related capabilities
         */
        val codeCapabilities: Set<AgentCapability>
            get() = setOf(CODE_GENERATION, CODE_REVIEW, TESTING, DOCUMENTATION)

        /**
         * All data-related capabilities
         */
        val dataCapabilities: Set<AgentCapability>
            get() = setOf(DATA_ANALYSIS, DOCUMENT_PROCESSING, API_INTEGRATION)
    }
}
