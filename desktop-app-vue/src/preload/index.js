const { contextBridge, ipcRenderer, desktopCapturer } = require("electron");

// Electron's sandboxed preload cannot require local modules, so the exact
// renderer capability manifest is generated inline. The source-of-truth JSON
// and this block are kept in lockstep by verify-fixed-renderer-ipc.mjs.
const FIXED_RENDERER_IPC_CHANNELS = new Set([
  // BEGIN GENERATED FIXED RENDERER IPC CHANNELS
  "adv-crypto:get-stats",
  "adv-crypto:sse-create-index",
  "adv-crypto:sse-search",
  "adv-crypto:verifiable-compute",
  "agent-cred:issue",
  "agent-cred:revoke",
  "agent-cred:verify",
  "agent-did:create",
  "agent-did:get-all",
  "agent-did:resolve",
  "agent-did:revoke",
  "agent:batch-cancel",
  "agent:cancel-goal",
  "agent:clear-history",
  "agent:export-goal",
  "agent:get-active-goals",
  "agent:get-config",
  "agent:get-goal-history",
  "agent:get-goal-logs",
  "agent:get-goal-steps",
  "agent:get-queue-status",
  "agent:get-stats",
  "agent:pause-goal",
  "agent:provide-input",
  "agent:resume-goal",
  "agent:retry-goal",
  "agent:submit-goal",
  "agent:update-config",
  "ai-social:assess-quality",
  "ai-social:detect-language",
  "ai-social:get-quality-report",
  "ai-social:get-translation-stats",
  "ai-social:translate-message",
  "album:add-member",
  "album:add-photo",
  "album:create",
  "album:delete",
  "album:get-by-id",
  "album:get-list",
  "album:get-members",
  "album:get-photos",
  "album:remove-member",
  "album:remove-photo",
  "album:share",
  "album:update",
  "analytics:export-csv",
  "analytics:export-json",
  "analytics:get-dashboard-summary",
  "analytics:get-time-series",
  "analytics:get-top-n",
  "analytics:realtime-update",
  "anti-censorship:enable-domain-fronting",
  "anti-censorship:get-connectivity-report",
  "anti-censorship:get-tor-status",
  "anti-censorship:start-mesh",
  "anti-censorship:start-tor",
  "ap:create-actor",
  "ap:publish-post",
  "ap:sync-now",
  "ap:sync-status",
  "ap:webfinger-lookup",
  "app:restart",
  "asset:list",
  "audit:export-logs",
  "audit:get-log-detail",
  "audit:get-statistics",
  "audit:query-logs",
  "auto-tuner:add-rule",
  "auto-tuner:disable-rule",
  "auto-tuner:enable-rule",
  "auto-tuner:evaluate",
  "auto-tuner:get-history",
  "auto-tuner:get-rules",
  "auto-tuner:get-stats",
  "auto-tuner:manual-tune",
  "auto-tuner:remove-rule",
  "auto-tuner:report-renderer-metrics",
  "auto-tuner:start",
  "auto-tuner:stop",
  "automation:createRule",
  "automation:deleteRule",
  "automation:getRules",
  "automation:getStatistics",
  "automation:manualTrigger",
  "automation:updateRule",
  "autonomous-dev:generate",
  "autonomous-dev:list-sessions",
  "autonomous-dev:refine",
  "autonomous-dev:review",
  "autonomous-dev:start-session",
  "ble-ukey:connect",
  "ble-ukey:disconnect",
  "ble-ukey:pair-device",
  "ble-ukey:scan-devices",
  "blockchain-integration:asset-deployed",
  "blockchain-integration:create-nft",
  "blockchain-integration:create-token",
  "blockchain-integration:get-all-assets",
  "blockchain-integration:get-pending-transactions",
  "blockchain-integration:monitor-transaction",
  "blockchain-integration:start-auto-sync",
  "blockchain-integration:stop-auto-sync",
  "blockchain-integration:sync-all",
  "blockchain-integration:sync-balance",
  "blockchain-integration:sync-completed",
  "blockchain-integration:transaction-update",
  "browser:act",
  "browser:action:coordinate",
  "browser:action:vision",
  "browser:aiClearHistory",
  "browser:aiExecute",
  "browser:aiGetHistory",
  "browser:aiParse",
  "browser:closeTab",
  "browser:createContext",
  "browser:desktop",
  "browser:desktop:capture",
  "browser:desktop:click",
  "browser:desktop:key",
  "browser:desktop:type",
  "browser:focusTab",
  "browser:getStatus",
  "browser:listTabs",
  "browser:network",
  "browser:ocr:recognize",
  "browser:openTab",
  "browser:recording:delete",
  "browser:recording:getPlaybackStatus",
  "browser:recording:getStatus",
  "browser:recording:list",
  "browser:recording:pause",
  "browser:recording:play",
  "browser:recording:playPause",
  "browser:recording:playResume",
  "browser:recording:playStop",
  "browser:recording:resume",
  "browser:recording:save",
  "browser:recording:start",
  "browser:recording:stop",
  "browser:recording:toWorkflow",
  "browser:screenshot",
  "browser:screenshot:compare",
  "browser:snapshot",
  "browser:start",
  "browser:stop",
  "browser:visualClick",
  "call-history:clear-all",
  "call-history:delete",
  "call-history:get-all",
  "call:create-room",
  "call:end-room",
  "call:get-active-rooms",
  "call:get-participants",
  "call:join-room",
  "call:leave-room",
  "call:share-screen",
  "call:toggle-audio",
  "call:toggle-video",
  "channel:get-message-envelope",
  "chat:add-reaction",
  "chat:cancel-transfer",
  "chat:download-file",
  "chat:forward-message",
  "chat:get-messages",
  "chat:get-reaction-stats",
  "chat:get-sessions",
  "chat:get-transfer-progress",
  "chat:mark-as-read",
  "chat:play-voice-message",
  "chat:remove-reaction",
  "chat:save-message",
  "chat:send-file",
  "code:fixBug",
  "code:generate",
  "code:refactor",
  "code:review",
  "collab-governance:approve-decision",
  "collab-governance:get-autonomy-level",
  "collab-governance:get-pending",
  "collab-governance:reject-decision",
  "collab-governance:set-autonomy-policy",
  "collab:acquire-lock",
  "collab:add-inline-comment",
  "collab:close-document",
  "collab:create-room",
  "collab:create-snapshot",
  "collab:export-with-comments",
  "collab:get-active-rooms",
  "collab:get-comments",
  "collab:get-document-history",
  "collab:get-participants",
  "collab:get-snapshots",
  "collab:get-stats",
  "collab:invite-user",
  "collab:join-room",
  "collab:leave-room",
  "collab:open-document",
  "collab:release-lock",
  "collab:request-conflict-resolution",
  "collab:resolve-comment",
  "collab:resolve-conflict",
  "collab:restore-snapshot",
  "collab:restore-version",
  "collab:set-role",
  "collab:sync-update",
  "collab:update-cursor",
  "collab:yjs-connect",
  "collab:yjs-disconnect",
  "collab:yjs-update",
  "compliance:check-compliance",
  "compliance:classify-content",
  "compliance:collect-access-evidence",
  "compliance:collect-audit-evidence",
  "compliance:collect-config-evidence",
  "compliance:create-policy",
  "compliance:delete-policy",
  "compliance:generate-report",
  "compliance:get-classifications",
  "compliance:get-evidence",
  "compliance:get-policies",
  "compliance:update-policy",
  "config:create-template",
  "config:export-skills",
  "config:export-to-file",
  "config:export-tools",
  "config:get",
  "config:get-all",
  "config:import",
  "config:set",
  "contact:update",
  "context:compress",
  "context:get-stats",
  "cowork:assign-task",
  "cowork:create-checkpoint",
  "cowork:create-team",
  "cowork:destroy-team",
  "cowork:discover-teams",
  "cowork:get-analytics",
  "cowork:get-audit-log",
  "cowork:get-stats",
  "cowork:get-team-status",
  "cowork:pause-team",
  "cowork:request-join",
  "cowork:resume-team",
  "cowork:task-progress",
  "cowork:terminate-agent",
  "cowork:update-team-config",
  "cross-org:cancel-task",
  "cross-org:get-log",
  "cross-org:get-task-status",
  "cross-org:route-task",
  "crossorg:accept-partnership",
  "crossorg:accept-transaction",
  "crossorg:access-shared-resource",
  "crossorg:add-member",
  "crossorg:archive-workspace",
  "crossorg:create-partnership",
  "crossorg:create-workspace",
  "crossorg:discover-orgs",
  "crossorg:get-audit-log",
  "crossorg:get-org-profile",
  "crossorg:get-partner-orgs",
  "crossorg:get-partnerships",
  "crossorg:get-share-analytics",
  "crossorg:get-shared-resources",
  "crossorg:get-transactions",
  "crossorg:get-workspace-members",
  "crossorg:get-workspaces",
  "crossorg:initiate-transaction",
  "crossorg:invite-org",
  "crossorg:reject-partnership",
  "crossorg:reject-transaction",
  "crossorg:search-shared-resources",
  "crossorg:share-resource",
  "crossorg:terminate-partnership",
  "crossorg:unshare-resource",
  "crossorg:update-trust-level",
  "crossorg:update-workspace",
  "crossorg:verify-data-integrity",
  "danmaku:get-history",
  "danmaku:send",
  "dashboard:get-activity-breakdown",
  "dashboard:get-activity-heatmap",
  "dashboard:get-activity-timeline",
  "dashboard:get-knowledge-graph",
  "dashboard:get-member-engagement",
  "dashboard:get-recent-activities",
  "dashboard:get-role-stats",
  "dashboard:get-stats",
  "dashboard:get-storage-breakdown",
  "dashboard:get-top-contributors",
  "database:change-encryption-password",
  "database:disable-encryption",
  "database:enable-encryption",
  "database:get-encryption-config",
  "database:get-encryption-status",
  "database:reset-encryption-config",
  "database:setup-encryption",
  "database:update-encryption-config",
  "db-performance:apply-all-index-suggestions",
  "db-performance:apply-index-suggestion",
  "db-performance:clear-cache",
  "db-performance:get-index-suggestions",
  "db-performance:get-slow-queries",
  "db-performance:get-stats",
  "db-performance:optimize",
  "db-performance:reset-stats",
  "db:add-knowledge-item",
  "db:backup",
  "db:delete-knowledge-item",
  "db:get-context-path",
  "db:get-knowledge-items",
  "db:search-knowledge-items",
  "db:switch-database",
  "db:update-knowledge-item",
  "decentralized:get-config",
  "deep-link:invitation",
  "dev-pipeline:approve-gate",
  "dev-pipeline:cancel",
  "dev-pipeline:configure",
  "dev-pipeline:create",
  "dev-pipeline:get-all",
  "dev-pipeline:get-artifacts",
  "dev-pipeline:get-metrics",
  "dev-pipeline:get-stage-detail",
  "dev-pipeline:get-status",
  "dev-pipeline:get-templates",
  "dev-pipeline:pause",
  "dev-pipeline:reject-gate",
  "dev-pipeline:resume",
  "dev-pipeline:start",
  "dialog:showSaveDialog",
  "did:create-from-mnemonic",
  "did:delete-identity",
  "did:export-document",
  "did:export-mnemonic",
  "did:generate-mnemonic",
  "did:generate-qrcode",
  "did:get-all-identities",
  "did:get-auto-republish-status",
  "did:get-current-identity",
  "did:get-identity",
  "did:has-mnemonic",
  "did:is-published-to-dht",
  "did:publish-to-dht",
  "did:republish-all",
  "did:set-default-identity",
  "did:start-auto-republish",
  "did:stop-auto-republish",
  "did:unpublish-from-dht",
  "did:validate-mnemonic",
  "dlp:create-policy",
  "dlp:delete-policy",
  "dlp:get-incidents",
  "dlp:get-stats",
  "dlp:list-policies",
  "dlp:resolve-incident",
  "dlp:scan-content",
  "dlp:update-policy",
  "dsr:approve-request",
  "dsr:create-request",
  "dsr:export-subject-data",
  "dsr:get-request-detail",
  "dsr:list-requests",
  "dsr:process-request",
  "dstorage:distribute-content",
  "dstorage:get-deal-status",
  "dstorage:get-storage-stats",
  "dstorage:get-version-history",
  "dstorage:store-to-filecoin",
  "enterprise:bulk-import",
  "enterprise:create-department",
  "enterprise:delete-department",
  "enterprise:get-dashboard-stats",
  "enterprise:get-department-members",
  "enterprise:get-departments",
  "enterprise:get-hierarchy",
  "enterprise:move-department",
  "enterprise:request-member-join",
  "enterprise:update-department",
  "error:cleanup-old-analyses",
  "error:get-analysis-history",
  "error:get-classification-stats",
  "error:get-config",
  "error:get-daily-trend",
  "error:get-diagnosis-report",
  "error:get-stats",
  "error:reanalyze",
  "error:update-config",
  "error:update-status",
  "evomap-federation:get-lineage",
  "evomap-federation:get-pressure-report",
  "evomap-federation:list-hubs",
  "evomap-federation:recombine-genes",
  "evomap-federation:sync-genes",
  "evomap-gov:cast-vote",
  "evomap-gov:create-proposal",
  "evomap-gov:get-governance-dashboard",
  "evomap-gov:register-ownership",
  "evomap-gov:trace-contributions",
  "evomap:approve-publish",
  "evomap:auto-publish",
  "evomap:claim-task",
  "evomap:fetch-relevant",
  "evomap:get-config",
  "evomap:get-local-assets",
  "evomap:get-ranked",
  "evomap:get-status",
  "evomap:get-sync-log",
  "evomap:get-trending",
  "evomap:import-as-instinct",
  "evomap:import-as-skill",
  "evomap:list-tasks",
  "evomap:publish-decision",
  "evomap:publish-instinct",
  "evomap:refresh-credits",
  "evomap:register",
  "evomap:search-assets",
  "evomap:update-config",
  "external-file:cancel-transfer",
  "external-file:cleanup-cache",
  "external-file:get-active-transfers",
  "external-file:get-cache-stats",
  "external-file:get-devices",
  "external-file:get-file-list",
  "external-file:get-projects",
  "external-file:import-to-project",
  "external-file:import-to-rag",
  "external-file:pull-file",
  "external-file:request-sync",
  "external-file:toggle-favorite",
  "fed-registry:discover",
  "fed-registry:get-network-stats",
  "fed-registry:query-skills",
  "fed-registry:register",
  "federation-hardening:get-circuit-breakers",
  "federation-hardening:get-status",
  "federation-hardening:reset-circuit",
  "federation-hardening:run-health-check",
  "file:delete",
  "file:detail",
  "file:exists",
  "file:list",
  "file:lock",
  "file:rollback",
  "file:share",
  "file:sharedFiles",
  "file:stat",
  "file:unlock",
  "file:upload",
  "file:versions",
  "firmware:check-updates",
  "firmware:get-history",
  "firmware:list-versions",
  "firmware:start-update",
  "fl:create-task",
  "fl:get-stats",
  "fl:get-task-status",
  "fl:join-task",
  "fl:leave-task",
  "fl:list-tasks",
  "fl:start-training",
  "fl:submit-gradients",
  "friend:accept-request",
  "friend:get-friends",
  "friend:get-list",
  "friend:get-pending-requests",
  "friend:reject-request",
  "friend:remove",
  "friend:send-request",
  "friend:update-group",
  "friend:update-nickname",
  "git-hooks:get-config",
  "git-hooks:get-history",
  "git-hooks:get-stats",
  "git-hooks:run-auto-fix",
  "git-hooks:run-impact",
  "git-hooks:run-pre-commit",
  "git-hooks:set-config",
  "git:generateCommitMessage",
  "git:pulled",
  "governance-ai:analyze-impact",
  "governance-ai:create-proposal",
  "governance-ai:list-proposals",
  "governance-ai:predict-vote",
  "graphql:create-api-key",
  "graphql:execute-query",
  "graphql:get-query-log",
  "graphql:get-schema",
  "graphql:get-stats",
  "graphql:list-api-keys",
  "graphql:revoke-api-key",
  "group:create",
  "group:dismiss",
  "group:get-details",
  "group:get-list",
  "group:get-messages",
  "group:invite-member",
  "group:leave",
  "group:remove-member",
  "group:send-message",
  "hardening:collect-baseline",
  "hardening:compare-baseline",
  "hardening:get-audit-report",
  "hardening:get-audit-reports",
  "hardening:get-baselines",
  "hardening:run-security-audit",
  "he:encrypted-data-analysis",
  "he:get-stats",
  "he:paillier-keygen",
  "hooks:list",
  "hooks:register",
  "hooks:trigger",
  "hooks:unregister",
  "evolution-artifact:promote",
  "evolution-artifact:revalidate",
  "hsm:connect-device",
  "hsm:execute-operation",
  "hsm:generate-key",
  "hsm:get-cluster-status",
  "hsm:get-compliance-status",
  "hsm:get-stats",
  "hsm:list-adapters",
  "hsm:rotate-key",
  "hsm:select-backend",
  "hw-wallet:connect",
  "hw-wallet:disconnect",
  "hw-wallet:scan",
  "identity:create-organization-context",
  "identity:create-personal-context",
  "identity:delete-organization-context",
  "identity:get-active-context",
  "identity:get-all-contexts",
  "identity:get-switch-history",
  "identity:switch-context",
  "image:batchProcess",
  "image:enhance",
  "image:generateFromText",
  "image:ocr-progress",
  "image:removeBackground",
  "image:resize",
  "image:upload",
  "image:upload-complete",
  "image:upload-start",
  "image:upscale",
  "import:progress",
  "inference:get-network-stats",
  "inference:get-task-status",
  "inference:list-nodes",
  "inference:register-node",
  "inference:start-federated-round",
  "inference:submit-task",
  "initial-setup:get-status",
  "interactive-planning:get-session",
  "interactive-planning:respond",
  "interactive-planning:start-session",
  "interactive-planning:submit-feedback",
  "ipfs-cluster:add-node",
  "ipfs-cluster:get-health",
  "ipfs-cluster:get-stats",
  "ipfs-cluster:list-nodes",
  "ipfs-cluster:list-pins",
  "ipfs-cluster:pin-content",
  "ipfs-cluster:rebalance",
  "ipfs-cluster:remove-node",
  "ipfs-cluster:unpin-content",
  "ipfs:add-content",
  "ipfs:add-file",
  "ipfs:add-knowledge-attachment",
  "ipfs:garbage-collect",
  "ipfs:get-config",
  "ipfs:get-content",
  "ipfs:get-file",
  "ipfs:get-knowledge-attachment",
  "ipfs:get-node-status",
  "ipfs:get-storage-stats",
  "ipfs:initialize",
  "ipfs:list-pins",
  "ipfs:pin",
  "ipfs:set-mode",
  "ipfs:set-quota",
  "ipfs:start-node",
  "ipfs:stop-node",
  "ipfs:unpin",
  "knowledge:get-tags",
  "knowledge:get-version-history",
  "knowledge:restore-version",
  "livestream:create",
  "livestream:end",
  "livestream:get-active",
  "livestream:get-my-streams",
  "livestream:get-viewers",
  "livestream:join",
  "livestream:leave",
  "livestream:start",
  "llm:budget-alert",
  "llm:cancel-stream",
  "llm:chat",
  "llm:check-status",
  "llm:clear-alert-history",
  "llm:clear-cache",
  "llm:delete-model-budget",
  "llm:dismiss-alert",
  "llm:export-cost-report",
  "llm:generate-test-data",
  "llm:get-alert-history",
  "llm:get-budget",
  "llm:get-cache-stats",
  "llm:get-config",
  "llm:get-cost-breakdown",
  "llm:get-model-budgets",
  "llm:get-time-series",
  "llm:get-usage-stats",
  "llm:query",
  "llm:service-paused",
  "llm:set-model-budget",
  "llm:stream-chunk",
  "logger:write",
  "marketplace:check-updates",
  "marketplace:disable-plugin",
  "marketplace:enable-plugin",
  "marketplace:get-categories",
  "marketplace:get-featured",
  "marketplace:get-plugin-detail",
  "marketplace:get-popular",
  "marketplace:get-ratings",
  "marketplace:install-plugin",
  "marketplace:list-installed",
  "marketplace:list-plugins",
  "marketplace:rate-plugin",
  "marketplace:search-plugins",
  "marketplace:uninstall-plugin",
  "marketplace:update-plugin",
  "matrix:get-messages",
  "matrix:join-room",
  "matrix:list-rooms",
  "matrix:login",
  "matrix:send-message",
  "mcp:call-tool",
  "mcp:connect-server",
  "mcp:disconnect-server",
  "mcp:get-config",
  "mcp:get-connected-servers",
  "mcp:get-metrics",
  "mcp:get-server-config",
  "mcp:list-servers",
  "mcp:list-tools",
  "mcp:update-config",
  "mcp:update-server-config",
  "media-stream:ready",
  "media-stream:request",
  "media-stream:stop",
  "media-stream:stopped",
  "media-stream:toggle-track",
  "media-stream:track-changed",
  "memory:append-to-memory",
  "memory:cleanup-expired",
  "memory:clear-embedding-cache",
  "memory:create-backup",
  "memory:export-data",
  "memory:extract-from-conversation",
  "memory:extract-from-session",
  "memory:generate-annual-report",
  "memory:generate-throwback",
  "memory:get-all-patterns",
  "memory:get-all-preferences",
  "memory:get-auto-summary-info",
  "memory:get-behavior-insights",
  "memory:get-index-stats",
  "memory:get-memory-sections",
  "memory:get-recent-daily-notes",
  "memory:get-stats",
  "memory:get-storage-stats",
  "memory:read-daily-note",
  "memory:read-memory",
  "memory:rebuild-index",
  "memory:save-to-memory",
  "memory:search",
  "memory:trigger-auto-summaries",
  "memory:update-memory",
  "memory:write-daily-note",
  "mm:build-context",
  "mm:capture-screen",
  "mm:fuse-input",
  "mm:generate-output",
  "mm:get-artifacts",
  "mm:get-session",
  "mm:get-stats",
  "mm:get-supported-modalities",
  "mm:parse-document",
  "mpc:get-stats",
  "mpc:shamir-split",
  "mpc:social-recovery-setup",
  "mpc:threshold-sign",
  "nl-prog:analyze-project",
  "nl-prog:generate",
  "nl-prog:get-conventions",
  "nl-prog:get-history",
  "nl-prog:get-stats",
  "nl-prog:refine",
  "nl-prog:translate",
  "nl-prog:validate",
  "nostr:add-relay",
  "nostr:decrypt-dm",
  "nostr:generate-keypair",
  "nostr:get-events",
  "nostr:list-relays",
  "nostr:map-did",
  "nostr:publish-deletion",
  "nostr:publish-dm",
  "nostr:publish-event",
  "nostr:publish-reaction",
  "notification:get-all",
  "notification:mark-all-read",
  "notification:mark-read",
  "notification:send-desktop",
  "ops:acknowledge",
  "ops:configure-alerts",
  "ops:create-playbook",
  "ops:generate-postmortem",
  "ops:get-alerts",
  "ops:get-baseline",
  "ops:get-incident-detail",
  "ops:get-incidents",
  "ops:get-playbooks",
  "ops:resolve",
  "ops:rollback",
  "ops:trigger-remediation",
  "ops:update-baseline",
  "org:accept-did-invitation",
  "org:accept-invitation-link",
  "org:check-permission",
  "org:copy-invitation-link",
  "org:create-custom-role",
  "org:create-invitation",
  "org:create-invitation-link",
  "org:create-knowledge",
  "org:create-organization",
  "org:delete-invitation-link",
  "org:delete-knowledge",
  "org:delete-organization",
  "org:delete-role",
  "org:export-activities",
  "org:get-activities",
  "org:get-all-permissions",
  "org:get-did-invitation-history",
  "org:get-invitation-link",
  "org:get-invitation-link-stats",
  "org:get-invitation-links",
  "org:get-invitations",
  "org:get-knowledge-items",
  "org:get-member-activities",
  "org:get-members",
  "org:get-organization",
  "org:get-pending-did-invitations",
  "org:get-roles",
  "org:get-user-organizations",
  "org:invite-by-did",
  "org:join-organization",
  "org:leave-organization",
  "org:reject-did-invitation",
  "org:remove-member",
  "org:revoke-invitation",
  "org:revoke-invitation-link",
  "org:update-member-role",
  "org:update-organization",
  "org:update-role",
  "org:validate-invitation-token",
  "organization:get-info",
  "organization:workspace:addMember",
  "organization:workspace:addResource",
  "organization:workspace:create",
  "organization:workspace:delete",
  "organization:workspace:list",
  "organization:workspace:permanentDelete",
  "organization:workspace:removeMember",
  "organization:workspace:restore",
  "organization:workspace:update",
  "p2p-enhanced:accept-call",
  "p2p-enhanced:call-connected",
  "p2p-enhanced:call-ended",
  "p2p-enhanced:call-incoming",
  "p2p-enhanced:call-mute-changed",
  "p2p-enhanced:call-quality-update",
  "p2p-enhanced:call-rejected",
  "p2p-enhanced:call-remote-stream",
  "p2p-enhanced:call-started",
  "p2p-enhanced:call-video-changed",
  "p2p-enhanced:end-call",
  "p2p-enhanced:get-active-calls",
  "p2p-enhanced:get-call-info",
  "p2p-enhanced:get-stats",
  "p2p-enhanced:reject-call",
  "p2p-enhanced:start-call",
  "p2p-enhanced:toggle-mute",
  "p2p-enhanced:toggle-video",
  "p2p:connect",
  "p2p:disconnect",
  "p2p:get-nat-info",
  "p2p:get-node-info",
  "p2p:get-peers",
  "p2p:send-encrypted-message",
  "p2p:start-device-sync",
  "pdf:htmlFileToPDF",
  "pdf:markdownToPDF",
  "pdf:textFileToPDF",
  "performance:clearHistory",
  "performance:exportReport",
  "performance:getActiveIPCRequests",
  "performance:getCPUMetrics",
  "performance:getMemoryMetrics",
  "performance:getMetrics",
  "performance:getSlowIPCCalls",
  "performance:getSlowQueries",
  "perm:accept-delegation",
  "perm:approve-request",
  "perm:bulk-grant",
  "perm:check-permission",
  "perm:create-workflow",
  "perm:delegate-permissions",
  "perm:delete-workflow",
  "perm:get-approval-history",
  "perm:get-delegations",
  "perm:get-effective-permissions",
  "perm:get-pending-approvals",
  "perm:get-resource-permissions",
  "perm:get-user-permissions",
  "perm:get-workflows",
  "perm:grant-permission",
  "perm:reject-request",
  "perm:revoke-delegation",
  "perm:revoke-permission",
  "perm:submit-approval",
  "perm:update-workflow",
  "permission:apply-template",
  "permission:assign-group",
  "permission:check",
  "permission:create-group",
  "permission:create-override",
  "permission:create-template",
  "permission:delete-override",
  "permission:get-audit-log",
  "permission:get-groups",
  "permission:get-overrides",
  "permission:get-statistics",
  "permission:get-templates",
  "permission:update-resource",
  "pipeline:cancel",
  "pipeline:create",
  "pipeline:delete",
  "pipeline:execute",
  "pipeline:get-status",
  "pipeline:get-templates",
  "pipeline:list",
  "pipeline:pause",
  "plan-mode:approve",
  "plan-mode:enter",
  "plan-mode:exit",
  "plan-mode:get-plan",
  "plan-mode:reject",
  "plugin-marketplace:categories",
  "plugin-marketplace:featured",
  "plugin-marketplace:install",
  "plugin-marketplace:list",
  "plugin:permission-request",
  "post:create",
  "post:get-feed",
  "post:like",
  "post:unlike",
  "pq:audit-scan",
  "pq:generate-dilithium-keypair",
  "pq:generate-kyber-keypair",
  "pq:get-stats",
  "pqc-ecosystem:get-coverage",
  "pqc-ecosystem:migrate-subsystem",
  "pqc-ecosystem:update-firmware-pqc",
  "pqc-ecosystem:verify-migration",
  "pqc:execute-migration",
  "pqc:generate-key",
  "pqc:get-migration-status",
  "pqc:list-keys",
  "preference:get",
  "preference:set",
  "project-types:get-all",
  "project:aiChatStream-chunk",
  "project:aiChatStream-complete",
  "project:aiChatStream-error",
  "project:create",
  "project:create-from-template",
  "project:create-quick",
  "project:delete",
  "project:get",
  "project:get-all",
  "project:get-files",
  "project:import-file",
  "project:move-file",
  "project:stats:get",
  "project:stats:update",
  "project:update",
  "protocol-fusion:get-identity-map",
  "protocol-fusion:get-protocol-status",
  "protocol-fusion:get-unified-feed",
  "protocol-fusion:map-identity",
  "protocol-fusion:send-message",
  "rag:get-stats",
  "rag:rebuild-index",
  "recommendation:feedback",
  "recommendation:generate",
  "recommendation:get-profile",
  "recommendation:get-recommendations",
  "recommendation:mark-viewed",
  "recommendation:update-profile",
  "remote:device-connected",
  "remote:device-disconnected",
  "remote:device-registered",
  "remote:get-audit-logs",
  "remote:get-connected-devices",
  "remote:get-device-permission",
  "remote:get-stats",
  "remote:logs:dashboard",
  "remote:logs:export",
  "remote:logs:query",
  "remote:send-command",
  "remote:set-device-permission",
  "reputation-optimizer:detect-anomalies",
  "reputation-optimizer:get-analytics",
  "reputation-optimizer:get-history",
  "reputation-optimizer:run-optimization",
  "reputation:get-history",
  "reputation:get-ranking",
  "reputation:get-score",
  "reputation:update",
  "retention:apply-policy",
  "retention:preview-deletion",
  "satellite:emergency-revoke",
  "satellite:get-messages",
  "satellite:get-recovery-status",
  "satellite:send-message",
  "satellite:sync-signatures",
  "scim:get-connectors",
  "scim:get-status",
  "scim:list-users",
  "scim:register-connector",
  "scim:sync-provider",
  "screen-share:get-sources",
  "sentiment:get-trend",
  "session:add-tags",
  "session:add-tags-multiple",
  "session:compress",
  "session:create",
  "session:create-from-template",
  "session:delete",
  "session:delete-multiple",
  "session:delete-tag",
  "session:delete-tags",
  "session:delete-template",
  "session:duplicate",
  "session:export-json",
  "session:export-markdown",
  "session:export-multiple",
  "session:find-by-tags",
  "session:generate-summary",
  "session:get-all-tags",
  "session:get-global-stats",
  "session:get-recent",
  "session:get-tag-details",
  "session:import-json",
  "session:list",
  "session:list-templates",
  "session:load",
  "session:merge-tags",
  "session:remove-tags",
  "session:rename-tag",
  "session:resume",
  "session:save-as-template",
  "session:search",
  "session:update-title",
  "shell:open-path",
  "siem:add-target",
  "siem:export-logs",
  "siem:get-stats",
  "siem:list-targets",
  "skill-service:compose-pipeline",
  "skill-service:get-versions",
  "skill-service:invoke-remote",
  "skill-service:list-skills",
  "skill-service:publish-skill",
  "skill:get-all",
  "skill:get-doc",
  "skill:get-popular",
  "skill:get-related",
  "skill:recommend",
  "skills:execute",
  "skills:get",
  "skills:get-metrics",
  "skills:get-pipeline-metrics",
  "skills:get-time-series",
  "skills:get-top-skills",
  "skills:list",
  "skills:list-invocable",
  "skills:route",
  "sla:check-compliance",
  "sla:create-contract",
  "sla:get-dashboard",
  "sla:get-violations",
  "sla:list-contracts",
  "social-ai:analyze-topics",
  "social-ai:batch-sentiment",
  "social-ai:closest-contacts",
  "social-ai:enhanced-reply",
  "social-ai:get-graph",
  "social-ai:multi-style-replies",
  "social-ai:record-interaction",
  "social-ai:trending-topics",
  "social-collab:archive-doc",
  "social-collab:close-doc",
  "social-collab:create-doc",
  "social-collab:get-my-docs",
  "social-collab:get-shared-docs",
  "social-collab:open-doc",
  "speech:add-realtime-audio-data",
  "speech:cancel-realtime-recording",
  "speech:cancelRecording",
  "speech:exportData",
  "speech:getCommandSuggestions",
  "speech:getLanguages",
  "speech:getLearningStats",
  "speech:importData",
  "speech:pause-realtime-recording",
  "speech:resetData",
  "speech:resume-realtime-recording",
  "speech:start-realtime-recording",
  "speech:startRecording",
  "speech:stop-realtime-recording",
  "speech:stopRecording",
  "sso:add-provider",
  "sso:delete-provider",
  "sso:get-linked-identities",
  "sso:get-sessions",
  "sso:handle-callback",
  "sso:initiate-login",
  "sso:link-identity",
  "sso:list-providers",
  "sso:logout",
  "sso:test-connection",
  "sso:unlink-identity",
  "sso:update-provider",
  "sso:verify-link",
  "stats:get-activity",
  "stats:get-heatmap",
  "stats:get-wordcloud",
  "stats:refresh",
  "stress-test:get-results",
  "stress-test:get-runs",
  "stress-test:start",
  "stress-test:stop",
  "sync:resolve-conflict",
  "system:close",
  "system:get-path",
  "system:get-platform",
  "system:get-version",
  "system:maximize",
  "system:minimize",
  "system:open-external",
  "system:restart",
  "task:complete-sprint",
  "task:create-board",
  "task:create-column",
  "task:create-label",
  "task:create-report",
  "task:create-sprint",
  "task:create-task",
  "task:delete-board",
  "task:delete-task",
  "task:generate-ai-summary",
  "task:get-board",
  "task:get-board-analytics",
  "task:get-boards",
  "task:get-labels",
  "task:get-reports",
  "task:get-sprints",
  "task:get-task",
  "task:get-tasks",
  "task:move-task",
  "task:reorder-columns",
  "task:start-sprint",
  "task:update-board",
  "task:update-column",
  "task:update-task",
  "tasks:assign",
  "tasks:board:create",
  "tasks:board:list",
  "tasks:changeStatus",
  "tasks:comment:add",
  "tasks:comment:delete",
  "tasks:comment:list",
  "tasks:create",
  "tasks:delete",
  "tasks:detail",
  "tasks:getHistory",
  "tasks:list",
  "tasks:update",
  "team:add-member",
  "team:create-team",
  "team:delete-team",
  "team:get-team-members",
  "team:get-teams",
  "team:remove-member",
  "team:set-lead",
  "team:update-team",
  "tech-learning:detect-stack",
  "tech-learning:extract-practices",
  "tech-learning:get-practices",
  "tech-learning:get-profiles",
  "tech-learning:synthesize-skill",
  "template-library:preview",
  "template-library:recommend",
  "template:create",
  "template:delete",
  "template:get-all",
  "template:get-demos",
  "template:getAll",
  "template:getById",
  "template:run-demo",
  "template:update",
  "terraform:create-workspace",
  "terraform:list-runs",
  "terraform:list-workspaces",
  "terraform:plan-run",
  "threshold-security:bind-biometric",
  "threshold-security:setup-keys",
  "threshold-security:sign",
  "threshold-security:verify-biometric",
  "time-machine:get-memories",
  "time-machine:get-on-this-day",
  "time-machine:get-timeline",
  "time-machine:mark-read",
  "token:get-balance",
  "token:get-pricing",
  "token:get-rewards-summary",
  "token:get-transactions",
  "token:submit-contribution",
  "tool:get-all",
  "tool:get-doc",
  "tools:get-all-with-skills",
  "tools:get-skill-manifest",
  "tools:refresh-unified",
  "tools:search-unified",
  "trade:copy-order-link",
  "trade:export-order-image",
  "trade:export-order-pdf",
  "trade:generate-share-link",
  "tray:action",
  "trust-root:bind-fingerprint",
  "trust-root:get-boot-status",
  "trust-root:get-status",
  "trust-root:sync-keys",
  "trust-root:verify-chain",
  "ukey:backup:list",
  "ukey:verify-pin",
  "video:addSubtitles",
  "video:addSubtitlesWithPreset",
  "video:adjustVolume",
  "video:applyFilter",
  "video:applyFilterChain",
  "video:compress",
  "video:convert",
  "video:extractAudio",
  "video:generateSubtitles",
  "video:generateThumbnail",
  "video:getInfo",
  "video:merge",
  "video:processing-progress",
  "video:replaceAudio",
  "video:separateAudio",
  "video:trim",
  "volcengine:chat-with-web-search",
  "volcengine:check-config",
  "volcengine:estimate-cost",
  "volcengine:list-models",
  "volcengine:select-model",
  "volcengine:understand-image",
  "wallet:get-all",
  "wallet:list",
  "wallet:set-default",
  "webauthn:bind-did",
  "webauthn:delete-passkey",
  "webauthn:get-stats",
  "webauthn:list-passkeys",
  "webauthn:register-begin",
  "webauthn:register-complete",
  "workflow-optimizations:export-config",
  "workflow-optimizations:get-report",
  "workflow-optimizations:get-stats",
  "workflow-optimizations:get-status",
  "workflow-optimizations:toggle",
  "workflow:create",
  "workflow:delete",
  "workflow:execute",
  "zk:benchmark-systems",
  "zk:generate-proof",
  "zk:get-stats",
  "zk:verify-proof",
  "zkp-vc:get-stats",
  "zkp-vc:issue-credential",
  "zkp-vc:list-credentials",
  "zkp-vc:present-credential",
  "zkp-vc:revoke-credential",
  "zkp:generate-identity-proof",
  "zkp:get-stats",
  "zkp:list-proofs",
  // END GENERATED FIXED RENDERER IPC CHANNELS
]);

function assertFixedRendererIpcChannel(channel) {
  if (typeof channel === "string" && FIXED_RENDERER_IPC_CHANNELS.has(channel)) {
    return;
  }
  const error = new Error(
    `Renderer IPC capability is not allowed: ${String(channel)}`,
  );
  error.code = "RENDERER_IPC_CAPABILITY_DENIED";
  throw error;
}

function fixedInvoke(channel, ...args) {
  assertFixedRendererIpcChannel(channel);
  return ipcRenderer.invoke(channel, ...args);
}

function fixedSend(channel, ...args) {
  assertFixedRendererIpcChannel(channel);
  return ipcRenderer.send(channel, ...args);
}

function fixedOn(channel, func, once = false) {
  assertFixedRendererIpcChannel(channel);
  if (typeof func !== "function") {
    throw new TypeError(`${channel} subscription requires a handler`);
  }
  return ipcRenderer[once ? "once" : "on"](channel, (event, ...args) =>
    func(event, ...args),
  );
}

function fixedSubscription(channel, handler) {
  if (typeof handler !== "function") {
    throw new TypeError(`${channel} subscription requires a handler`);
  }
  const listener = (_event, data) => handler(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

const COLLAB_INVOKE_CHANNELS = new Set([
  "collab:open-document",
  "collab:close-document",
  "collab:sync-update",
  "collab:update-cursor",
  "collab:acquire-lock",
  "collab:release-lock",
  "collab:request-conflict-resolution",
  "collab:resolve-conflict",
  "collab:get-comments",
  "collab:add-inline-comment",
  "collab:resolve-comment",
  "collab:get-document-history",
  "collab:restore-version",
  "collab:get-stats",
  "collab:export-with-comments",
  "collab:yjs-connect",
  "collab:yjs-update",
  "collab:yjs-awareness-update",
  "collab:yjs-disconnect",
  "collab:create-room",
  "collab:join-room",
  "collab:leave-room",
  "collab:invite-user",
  "collab:get-active-rooms",
  "collab:set-role",
  "collab:get-participants",
  "collab:create-snapshot",
  "collab:get-snapshots",
  "collab:restore-snapshot",
]);

function invokeCollab(channel, params) {
  if (!COLLAB_INVOKE_CHANNELS.has(channel)) {
    const error = new Error(`Unsupported collaboration capability: ${channel}`);
    error.code = "COLLAB_CAPABILITY_NOT_ALLOWED";
    throw error;
  }
  return ipcRenderer.invoke(channel, params);
}

function subscribeCollab(channel, callback) {
  if (typeof callback !== "function") {
    throw new TypeError("Collaboration event callback must be a function");
  }
  const listener = (_event, data) => callback(data);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/**
 * 清理对象中的 undefined 值
 * Electron IPC 不支持传递 undefined 值，需要转换为 null 或移除
 */
function isAbortSignal(obj) {
  if (!obj || typeof obj !== "object") {
    return false;
  }

  // Cross-realm safe detection
  const tag = Object.prototype.toString.call(obj);
  if (tag === "[object AbortSignal]") {
    return true;
  }

  // Duck-typing fallback
  return (
    typeof obj.aborted === "boolean" &&
    typeof obj.addEventListener === "function" &&
    typeof obj.removeEventListener === "function"
  );
}

function removeUndefined(obj, seen = new WeakSet()) {
  if (obj === undefined || obj === null) {
    return null;
  }

  // Filter out non-serializable types
  const type = typeof obj;
  if (type === "function" || type === "symbol") {
    console.warn("[Preload] Non-serializable type detected, skipping:", type);
    return null;
  }

  // Handle primitive types
  if (type !== "object") {
    return obj;
  }

  // Handle Date objects
  if (obj instanceof Date) {
    return obj.toISOString();
  }

  // BUGFIX: Skip AbortSignal objects (cannot be serialized through IPC)
  if (isAbortSignal(obj)) {
    console.warn("[Preload] AbortSignal detected, skipping (not serializable)");
    return null;
  }

  // Detect circular references
  if (seen.has(obj)) {
    console.warn("[Preload] Circular reference detected, skipping");
    return "[Circular]";
  }

  // Mark this object as seen
  seen.add(obj);

  // Handle arrays
  if (Array.isArray(obj)) {
    return obj
      .map((item) => removeUndefined(item, seen))
      .filter((item) => item !== null && item !== undefined);
  }

  // Handle plain objects
  const cleaned = {};
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      const valueType = typeof value;

      // BUGFIX: Skip 'signal' property (AbortSignal objects)
      if (key === "signal") {
        continue;
      }

      // Skip functions, symbols, and undefined values
      if (
        valueType === "function" ||
        valueType === "symbol" ||
        value === undefined
      ) {
        continue;
      }

      const cleanedValue = removeUndefined(value, seen);
      if (cleanedValue !== null && cleanedValue !== undefined) {
        cleaned[key] = cleanedValue;
      }
    }
  }
  return cleaned;
}

// 暴露安全的API到渲染进程
contextBridge.exposeInMainWorld("electronAPI", {
  // U盾相关
  ukey: {
    detect: () => ipcRenderer.invoke("ukey:detect"),
    verifyPIN: (pin) => ipcRenderer.invoke("ukey:verify-pin", pin),
  },

  // Fixed collaboration capability. Generic renderer IPC remains disabled.
  collab: {
    invoke: invokeCollab,
    onRemoteUpdate: (callback) =>
      subscribeCollab("collab:yjs-remote-update", callback),
    onAwarenessUpdate: (callback) =>
      subscribeCollab("collab:yjs-awareness-update", callback),
  },

  // Fixed bundled Skill credential capabilities. Stored plaintext is never
  // exposed back to the renderer; only configured status can be queried.
  markdownSkills: {
    getCredentialStatus: () => ipcRenderer.invoke("skills:credential-status"),
    setCredential: (key, value) =>
      ipcRenderer.invoke("skills:set-credential", { key, value }),
    clearCredential: (key) =>
      ipcRenderer.invoke("skills:clear-credential", { key }),
  },

  // 认证相关 - 密码登录
  auth: {
    verifyPassword: (username, password) =>
      ipcRenderer.invoke("auth:verify-password", username, password),
  },

  specializedAgents: {
    listTemplates: (filters = {}) =>
      ipcRenderer.invoke("agents:list-templates", { filters }),
    getTemplate: (templateId) =>
      ipcRenderer.invoke("agents:get-template", { templateId }),
    createTemplate: (template) =>
      ipcRenderer.invoke("agents:create-template", { template }),
    updateTemplate: (templateId, updates) =>
      ipcRenderer.invoke("agents:update-template", { templateId, updates }),
    deleteTemplate: (templateId) =>
      ipcRenderer.invoke("agents:delete-template", { templateId }),
    deployAgent: (templateId, config = {}) =>
      ipcRenderer.invoke("agents:deploy-agent", { templateId, config }),
    terminateAgent: (agentId, reason = "") =>
      ipcRenderer.invoke("agents:terminate-agent", { agentId, reason }),
    listInstances: () => ipcRenderer.invoke("agents:list-instances", {}),
    getStatus: (agentId) =>
      ipcRenderer.invoke("agents:get-status", { agentId }),
    assignTask: (agentId, taskDescription, options = {}) =>
      ipcRenderer.invoke("agents:assign-task", {
        agentId,
        taskDescription,
        options,
      }),
    getTaskStatus: (taskId) =>
      ipcRenderer.invoke("agents:get-task-status", { taskId }),
    getGraphHistory: (taskId, options = {}) =>
      ipcRenderer.invoke("agents:get-graph-history", { taskId, ...options }),
    cancelTask: (taskId, reason = "") =>
      ipcRenderer.invoke("agents:cancel-task", { taskId, reason }),
    reconcileTask: (taskId, reconciliation) =>
      ipcRenderer.invoke("agents:reconcile-task", {
        taskId,
        reconciliation,
      }),
    orchestrate: (taskDescription, options = {}) =>
      ipcRenderer.invoke("agents:orchestrate", {
        taskDescription,
        options,
      }),
    getPlan: (taskDescription, options = {}) =>
      ipcRenderer.invoke("agents:get-plan", { taskDescription, options }),
    getPerformance: (options = {}) =>
      ipcRenderer.invoke("agents:get-performance", { options }),
    getStatistics: () => ipcRenderer.invoke("agents:get-statistics", {}),
  },

  workflowManager: {
    create: (options = {}) => ipcRenderer.invoke("workflow:create", options),
    start: (workflowId, input, context = {}) =>
      ipcRenderer.invoke("workflow:start", { workflowId, input, context }),
    pause: (workflowId) => ipcRenderer.invoke("workflow:pause", { workflowId }),
    resume: (workflowId) =>
      ipcRenderer.invoke("workflow:resume", { workflowId }),
    cancel: (workflowId, reason = "") =>
      ipcRenderer.invoke("workflow:cancel", { workflowId, reason }),
    reconcile: (workflowId, reconciliation) =>
      ipcRenderer.invoke("workflow:reconcile", {
        workflowId,
        reconciliation,
      }),
    retry: (workflowId) => ipcRenderer.invoke("workflow:retry", { workflowId }),
    getStatus: (workflowId) =>
      ipcRenderer.invoke("workflow:get-status", { workflowId }),
    getGraphHistory: (workflowId, options = {}) =>
      ipcRenderer.invoke("workflow:get-graph-history", {
        workflowId,
        ...options,
      }),
    getStages: (workflowId) =>
      ipcRenderer.invoke("workflow:get-stages", { workflowId }),
    getLogs: (workflowId, limit = 100) =>
      ipcRenderer.invoke("workflow:get-logs", { workflowId, limit }),
    getGates: (workflowId) =>
      ipcRenderer.invoke("workflow:get-gates", { workflowId }),
    overrideGate: (workflowId, gateId, reason = "") =>
      ipcRenderer.invoke("workflow:override-gate", {
        workflowId,
        gateId,
        reason,
      }),
    getAll: () => ipcRenderer.invoke("workflow:get-all"),
    delete: (workflowId) =>
      ipcRenderer.invoke("workflow:delete", { workflowId }),
    createAndStart: (options = {}) =>
      ipcRenderer.invoke("workflow:create-and-start", options),
    onProgress: (handler) => fixedSubscription("workflow:progress", handler),
    onStageComplete: (handler) =>
      fixedSubscription("workflow:stage-complete", handler),
    onComplete: (handler) => fixedSubscription("workflow:complete", handler),
    onError: (handler) => fixedSubscription("workflow:error", handler),
  },

  // 数据库操作
  db: {
    getKnowledgeItems: (limit, offset) =>
      ipcRenderer.invoke("db:get-knowledge-items", limit, offset),
    getKnowledgeItemById: (id) =>
      ipcRenderer.invoke("db:get-knowledge-item-by-id", id),
    addKnowledgeItem: (item) =>
      ipcRenderer.invoke("db:add-knowledge-item", item),
    updateKnowledgeItem: (id, updates) =>
      ipcRenderer.invoke("db:update-knowledge-item", id, updates),
    deleteKnowledgeItem: (id) =>
      ipcRenderer.invoke("db:delete-knowledge-item", id),
    searchKnowledgeItems: (query) =>
      ipcRenderer.invoke("db:search-knowledge-items", query),
    getAllTags: () => ipcRenderer.invoke("db:get-all-tags"),
    createTag: (name, color) =>
      ipcRenderer.invoke("db:create-tag", name, color),
    getKnowledgeTags: (knowledgeId) =>
      ipcRenderer.invoke("db:get-knowledge-tags", knowledgeId),
    getStatistics: () => ipcRenderer.invoke("db:get-statistics"),
    getPath: () => ipcRenderer.invoke("db:get-path"),
    backup: (backupPath) => ipcRenderer.invoke("db:backup", backupPath),
    // 数据库配置
    getConfig: () => ipcRenderer.invoke("database:get-config"),
    setPath: (newPath) => ipcRenderer.invoke("database:set-path", newPath),
    migrate: (newPath) => ipcRenderer.invoke("database:migrate", newPath),
    createBackup: () => ipcRenderer.invoke("database:create-backup"),
    listBackups: () => ipcRenderer.invoke("database:list-backups"),
    restoreBackup: (backupPath) =>
      ipcRenderer.invoke("database:restore-backup", backupPath),
    // 数据库加密
    getEncryptionStatus: () =>
      ipcRenderer.invoke("database:get-encryption-status"),
    setupEncryption: (options) =>
      ipcRenderer.invoke("database:setup-encryption", options),
    changeEncryptionPassword: (data) =>
      ipcRenderer.invoke("database:change-encryption-password", data),
    enableEncryption: () => ipcRenderer.invoke("database:enable-encryption"),
    disableEncryption: () => ipcRenderer.invoke("database:disable-encryption"),
    getEncryptionConfig: () =>
      ipcRenderer.invoke("database:get-encryption-config"),
    updateEncryptionConfig: (config) =>
      ipcRenderer.invoke("database:update-encryption-config", config),
    resetEncryptionConfig: () =>
      ipcRenderer.invoke("database:reset-encryption-config"),
  },

  // FAMILY-26 家长端家庭守护仪表板（只读 telemetry 镜像）
  familyGuard: {
    listChildren: () => ipcRenderer.invoke("family-guard:list-children"),
    listChildEvents: (params) =>
      ipcRenderer.invoke("family-guard:list-child-events", params),
    appUsageSummary: (params) =>
      ipcRenderer.invoke("family-guard:app-usage-summary", params),
  },

  // 应用管理
  app: {
    restart: () => ipcRenderer.invoke("app:restart"),
  },

  // 初始设置
  initialSetup: {
    getStatus: () => ipcRenderer.invoke("initial-setup:get-status"),
    getConfig: () => ipcRenderer.invoke("initial-setup:get-config"),
    saveConfig: (config) =>
      ipcRenderer.invoke("initial-setup:save-config", config),
    complete: (config) => ipcRenderer.invoke("initial-setup:complete", config),
    reset: () => ipcRenderer.invoke("initial-setup:reset"),
    exportConfig: () => ipcRenderer.invoke("initial-setup:export-config"),
    importConfig: () => ipcRenderer.invoke("initial-setup:import-config"),
  },

  // LLM服务
  llm: {
    checkStatus: () => ipcRenderer.invoke("llm:check-status"),
    query: (prompt, options) =>
      ipcRenderer.invoke("llm:query", prompt, options),
    queryStream: (prompt, options) =>
      ipcRenderer.invoke("llm:query-stream", prompt, options),
    chat: (params) => ipcRenderer.invoke("llm:chat", params),
    getConfig: () => ipcRenderer.invoke("llm:get-config"),
    setConfig: (config) => ipcRenderer.invoke("llm:set-config", config),
    listModels: () => ipcRenderer.invoke("llm:list-models"),
    clearContext: (conversationId) =>
      ipcRenderer.invoke("llm:clear-context", conversationId),
    embeddings: (text) => ipcRenderer.invoke("llm:embeddings", text),
    cancelStream: (controllerId, reason) =>
      ipcRenderer.invoke("llm:cancel-stream", controllerId, reason),
    // 智能选择
    getSelectorInfo: () => ipcRenderer.invoke("llm:get-selector-info"),
    selectBest: (options) => ipcRenderer.invoke("llm:select-best", options),
    generateReport: (taskType) =>
      ipcRenderer.invoke("llm:generate-report", taskType),
    switchProvider: (provider) =>
      ipcRenderer.invoke("llm:switch-provider", provider),
    // 🔥 Token 追踪与成本管理
    getUsageStats: (options) =>
      ipcRenderer.invoke("llm:get-usage-stats", options),
    getTimeSeries: (options) =>
      ipcRenderer.invoke("llm:get-time-series", options),
    getCostBreakdown: (options) =>
      ipcRenderer.invoke("llm:get-cost-breakdown", options),
    getBudget: (userId) => ipcRenderer.invoke("llm:get-budget", userId),
    setBudget: (userId, config) =>
      ipcRenderer.invoke("llm:set-budget", userId, config),
    exportCostReport: (options) =>
      ipcRenderer.invoke("llm:export-cost-report", options),
    clearCache: () => ipcRenderer.invoke("llm:clear-cache"),
    getCacheStats: () => ipcRenderer.invoke("llm:get-cache-stats"),
    resumeService: () => ipcRenderer.invoke("llm:resume-service"),
    // 事件监听
    on: (event, callback) =>
      ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // Fixed RSS capability surface. These channels remain usable while the
  // legacy generic renderer IPC bridge is disabled by default.
  rss: {
    addFeed: (feedUrl, options) =>
      ipcRenderer.invoke("rss:add-feed", feedUrl, options),
    removeFeed: (feedId) => ipcRenderer.invoke("rss:remove-feed", feedId),
    updateFeed: (feedId, updates) =>
      ipcRenderer.invoke("rss:update-feed", feedId, updates),
    getFeeds: (options) => ipcRenderer.invoke("rss:get-feeds", options),
    getFeed: (feedId) => ipcRenderer.invoke("rss:get-feed", feedId),
    fetchFeed: (feedId) => ipcRenderer.invoke("rss:fetch-feed", feedId),
    fetchAllFeeds: () => ipcRenderer.invoke("rss:fetch-all-feeds"),
    getItems: (options) => ipcRenderer.invoke("rss:get-items", options),
    getItem: (itemId) => ipcRenderer.invoke("rss:get-item", itemId),
    markAsRead: (itemId) => ipcRenderer.invoke("rss:mark-as-read", itemId),
    markAsUnread: (itemId) => ipcRenderer.invoke("rss:mark-as-unread", itemId),
    markAsStarred: (itemId, starred) =>
      ipcRenderer.invoke("rss:mark-as-starred", itemId, starred),
    archiveItem: (itemId) => ipcRenderer.invoke("rss:archive-item", itemId),
    saveToKnowledge: (itemId) =>
      ipcRenderer.invoke("rss:save-to-knowledge", itemId),
    addCategory: (name, options) =>
      ipcRenderer.invoke("rss:add-category", name, options),
    getCategories: (options) =>
      ipcRenderer.invoke("rss:get-categories", options),
    assignCategory: (feedId, categoryId) =>
      ipcRenderer.invoke("rss:assign-category", feedId, categoryId),
    discoverFeeds: (websiteUrl) =>
      ipcRenderer.invoke("rss:discover-feeds", websiteUrl),
    validateFeed: (feedUrl) => ipcRenderer.invoke("rss:validate-feed", feedUrl),
    startAutoSync: (feedId) =>
      ipcRenderer.invoke("rss:start-auto-sync", feedId),
    stopAutoSync: (feedId) => ipcRenderer.invoke("rss:stop-auto-sync", feedId),
  },

  // Fixed Email capability surface. Attachment destinations are deliberately
  // absent: the main process owns the native save dialog.
  email: {
    addAccount: (config) => ipcRenderer.invoke("email:add-account", config),
    removeAccount: (accountId) =>
      ipcRenderer.invoke("email:remove-account", accountId),
    updateAccount: (accountId, updates) =>
      ipcRenderer.invoke("email:update-account", accountId, updates),
    getAccounts: () => ipcRenderer.invoke("email:get-accounts"),
    getAccount: (accountId) =>
      ipcRenderer.invoke("email:get-account", accountId),
    testConnection: (config) =>
      ipcRenderer.invoke("email:test-connection", config),
    getMailboxes: (accountId) =>
      ipcRenderer.invoke("email:get-mailboxes", accountId),
    syncMailboxes: (accountId) =>
      ipcRenderer.invoke("email:sync-mailboxes", accountId),
    fetchEmails: (accountId, options) =>
      ipcRenderer.invoke("email:fetch-emails", accountId, options),
    getEmails: (options) => ipcRenderer.invoke("email:get-emails", options),
    getEmail: (emailId) => ipcRenderer.invoke("email:get-email", emailId),
    markAsRead: (emailId) => ipcRenderer.invoke("email:mark-as-read", emailId),
    markAsUnread: (emailId) =>
      ipcRenderer.invoke("email:mark-as-unread", emailId),
    markAsStarred: (emailId, starred) =>
      ipcRenderer.invoke("email:mark-as-starred", emailId, starred),
    saveDraft: (accountId, draftData) =>
      ipcRenderer.invoke("email:save-draft", accountId, draftData),
    getDrafts: (accountId) => ipcRenderer.invoke("email:get-drafts", accountId),
    getDraft: (draftId) => ipcRenderer.invoke("email:get-draft", draftId),
    deleteDraft: (draftId) => ipcRenderer.invoke("email:delete-draft", draftId),
    archiveEmail: (emailId) =>
      ipcRenderer.invoke("email:archive-email", emailId),
    deleteEmail: (emailId) => ipcRenderer.invoke("email:delete-email", emailId),
    sendEmail: (accountId, mailOptions) =>
      ipcRenderer.invoke("email:send-email", accountId, mailOptions),
    saveToKnowledge: (emailId) =>
      ipcRenderer.invoke("email:save-to-knowledge", emailId),
    getAttachments: (emailId) =>
      ipcRenderer.invoke("email:get-attachments", emailId),
    downloadAttachment: (attachmentId) =>
      ipcRenderer.invoke("email:download-attachment", attachmentId),
    addLabel: (name, options) =>
      ipcRenderer.invoke("email:add-label", name, options),
    getLabels: () => ipcRenderer.invoke("email:get-labels"),
    assignLabel: (emailId, labelId) =>
      ipcRenderer.invoke("email:assign-label", emailId, labelId),
    removeLabel: (emailId, labelId) =>
      ipcRenderer.invoke("email:remove-label", emailId, labelId),
    startAutoSync: (accountId) =>
      ipcRenderer.invoke("email:start-auto-sync", accountId),
    stopAutoSync: (accountId) =>
      ipcRenderer.invoke("email:stop-auto-sync", accountId),
  },

  // 对话管理
  conversation: {
    create: (conversationData) =>
      ipcRenderer.invoke("conversation:create", conversationData),
    get: (conversationId) =>
      ipcRenderer.invoke("conversation:get", conversationId),
    getByProject: (projectId) =>
      ipcRenderer.invoke("conversation:get-by-project", projectId),
    getRecent: (options) =>
      ipcRenderer.invoke("conversation:get-recent", options),
    getAll: (options) => ipcRenderer.invoke("conversation:get-all", options),
    update: (conversationId, updates) =>
      ipcRenderer.invoke("conversation:update", conversationId, updates),
    delete: (conversationId) =>
      ipcRenderer.invoke("conversation:delete", conversationId),
    createMessage: (messageData) =>
      ipcRenderer.invoke("conversation:create-message", messageData),
    addMessage: (conversationId, messageData) =>
      ipcRenderer.invoke("conversation:create-message", {
        ...messageData,
        conversation_id: conversationId,
      }),
    updateMessage: (updateData) =>
      ipcRenderer.invoke("conversation:update-message", updateData),
    getMessages: (conversationId, options) =>
      ipcRenderer.invoke("conversation:get-messages", conversationId, options),
    deleteMessage: (messageId) =>
      ipcRenderer.invoke("conversation:delete-message", messageId),
    clearMessages: (conversationId) =>
      ipcRenderer.invoke("conversation:clear-messages", conversationId),
    agentChat: (chatData) =>
      ipcRenderer.invoke("conversation:agent-chat", chatData),
  },

  // 系统配置管理
  codingAgent: {
    getAppServerPilotStatus: () =>
      ipcRenderer.invoke("coding-agent:app-server-pilot-status"),
    startAppServerPilot: () =>
      ipcRenderer.invoke("coding-agent:app-server-pilot-start"),
    closeAppServerPilot: () =>
      ipcRenderer.invoke("coding-agent:app-server-pilot-close"),
    appServerThreadStart: (payload = {}) =>
      ipcRenderer.invoke("coding-agent:app-server-thread-start", payload),
    appServerThreadResume: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-thread-resume", payload),
    appServerThreadFork: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-thread-fork", payload),
    appServerThreadRead: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-thread-read", payload),
    appServerThreadList: (payload = {}) =>
      ipcRenderer.invoke("coding-agent:app-server-thread-list", payload),
    appServerThreadArchive: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-thread-archive", payload),
    appServerTurnStart: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-turn-start", payload),
    appServerTurnInterrupt: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-turn-interrupt", payload),
    appServerContextPlan: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-context-plan", payload),
    appServerContextCompact: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-context-compact", payload),
    appServerMemoryRecall: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-memory-recall", payload),
    appServerMemoryPropose: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-memory-propose", payload),
    appServerMemoryDecide: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-memory-decide", payload),
    appServerMemoryDelete: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-memory-delete", payload),
    appServerMemoryReconcile: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-memory-reconcile", payload),
    appServerEvolutionWorkbenchList: (payload = {}) =>
      ipcRenderer.invoke(
        "coding-agent:app-server-evolution-workbench-list",
        payload,
      ),
    appServerEvolutionWorkbenchCompare: (payload) =>
      ipcRenderer.invoke(
        "coding-agent:app-server-evolution-workbench-compare",
        payload,
      ),
    appServerEvolutionWorkbenchReview: (payload) =>
      ipcRenderer.invoke(
        "coding-agent:app-server-evolution-workbench-review",
        payload,
      ),
    appServerEvolutionWorkbenchRollback: (payload) =>
      ipcRenderer.invoke(
        "coding-agent:app-server-evolution-workbench-rollback",
        payload,
      ),
    appServerGovernedKnowledgeConflicts: (payload = {}) =>
      ipcRenderer.invoke(
        "coding-agent:app-server-governed-knowledge-conflicts",
        payload,
      ),
    appServerGovernedKnowledgeMerge: (payload) =>
      ipcRenderer.invoke(
        "coding-agent:app-server-governed-knowledge-merge",
        payload,
      ),
    appServerApprovalList: () =>
      ipcRenderer.invoke("coding-agent:app-server-approval-list"),
    appServerApprovalDecide: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-approval-decide", payload),
    onAppServerApproval: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("coding-agent:app-server-approval-requested", handler);
      return () =>
        ipcRenderer.removeListener(
          "coding-agent:app-server-approval-requested",
          handler,
        );
    },
    onAppServerApprovalSettled: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("coding-agent:app-server-approval-settled", handler);
      return () =>
        ipcRenderer.removeListener(
          "coding-agent:app-server-approval-settled",
          handler,
        );
    },
    appServerHumanTaskList: () =>
      ipcRenderer.invoke("coding-agent:app-server-human-task-list"),
    appServerHumanTaskDecide: (payload) =>
      ipcRenderer.invoke("coding-agent:app-server-human-task-decide", payload),
    onAppServerHumanTask: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("coding-agent:app-server-human-task-requested", handler);
      return () =>
        ipcRenderer.removeListener(
          "coding-agent:app-server-human-task-requested",
          handler,
        );
    },
    onAppServerHumanTaskSettled: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("coding-agent:app-server-human-task-settled", handler);
      return () =>
        ipcRenderer.removeListener(
          "coding-agent:app-server-human-task-settled",
          handler,
        );
    },
    createSession: (options) =>
      ipcRenderer.invoke("coding-agent:create-session", options),
    startSession: (options) =>
      ipcRenderer.invoke("coding-agent:start-session", options),
    resumeSession: (sessionId) =>
      ipcRenderer.invoke("coding-agent:resume-session", sessionId),
    listSessions: () => ipcRenderer.invoke("coding-agent:list-sessions"),
    getPermissionRules: () =>
      ipcRenderer.invoke("coding-agent:get-permission-rules"),
    setPermissionRule: (payload) =>
      ipcRenderer.invoke("coding-agent:set-permission-rule", payload),
    createRemoteSession: (payload) =>
      ipcRenderer.invoke("coding-agent:create-remote-session", payload),
    refreshRemoteSessionPairing: (payload) =>
      ipcRenderer.invoke(
        "coding-agent:refresh-remote-session-pairing",
        payload,
      ),
    listRemoteSessionDevices: (remoteSessionId) =>
      ipcRenderer.invoke(
        "coding-agent:list-remote-session-devices",
        remoteSessionId,
      ),
    revokeRemoteSessionDevice: (payload) =>
      ipcRenderer.invoke("coding-agent:revoke-remote-session-device", payload),
    getRemoteSessionAudit: (payload) =>
      ipcRenderer.invoke("coding-agent:remote-session-audit", payload),
    getRemoteSessionPolicy: () =>
      ipcRenderer.invoke("coding-agent:remote-session-policy"),
    closeRemoteSession: (remoteSessionId) =>
      ipcRenderer.invoke("coding-agent:close-remote-session", remoteSessionId),
    sendMessage: (payload) =>
      ipcRenderer.invoke("coding-agent:send-message", payload),
    respondQuestion: (payload) =>
      ipcRenderer.invoke("coding-agent:respond-elicitation", payload),
    respondElicitation: (payload) =>
      ipcRenderer.invoke("coding-agent:respond-elicitation", payload),
    enterPlanMode: (sessionId) =>
      ipcRenderer.invoke("coding-agent:enter-plan-mode", sessionId),
    showPlan: (sessionId) =>
      ipcRenderer.invoke("coding-agent:show-plan", sessionId),
    approvePlan: (sessionId) =>
      ipcRenderer.invoke("coding-agent:approve-plan", sessionId),
    respondApproval: (payload) =>
      ipcRenderer.invoke("coding-agent:respond-approval", payload),
    listApprovalGrants: (sessionId) =>
      ipcRenderer.invoke("coding-agent:list-approval-grants", sessionId),
    revokeApprovalGrant: (payload) =>
      ipcRenderer.invoke("coding-agent:revoke-approval-grant", payload),
    confirmHighRiskExecution: (sessionId) =>
      ipcRenderer.invoke("coding-agent:confirm-high-risk-execution", sessionId),
    rejectPlan: (sessionId) =>
      ipcRenderer.invoke("coding-agent:reject-plan", sessionId),
    closeSession: (sessionId) =>
      ipcRenderer.invoke("coding-agent:close-session", sessionId),
    cancelSession: (sessionId) =>
      ipcRenderer.invoke("coding-agent:cancel-session", sessionId),
    interrupt: (sessionId) =>
      ipcRenderer.invoke("coding-agent:interrupt", sessionId),
    getSessionState: (sessionId) =>
      ipcRenderer.invoke("coding-agent:get-session-state", sessionId),
    getSessionEvents: (sessionId) =>
      ipcRenderer.invoke("coding-agent:get-session-events", sessionId),
    getHarnessStatus: () =>
      ipcRenderer.invoke("coding-agent:get-harness-status"),
    listBackgroundTasks: (payload = {}) =>
      ipcRenderer.invoke("coding-agent:list-background-tasks", payload),
    getBackgroundTask: (taskId) =>
      ipcRenderer.invoke("coding-agent:get-background-task", taskId),
    getBackgroundTaskHistory: (payload) =>
      ipcRenderer.invoke("coding-agent:get-background-task-history", payload),
    stopBackgroundTask: (taskId) =>
      ipcRenderer.invoke("coding-agent:stop-background-task", taskId),
    listWorktrees: () => ipcRenderer.invoke("coding-agent:list-worktrees"),
    getWorktreeDiff: (payload) =>
      ipcRenderer.invoke("coding-agent:get-worktree-diff", payload),
    previewWorktreeMerge: (payload) =>
      ipcRenderer.invoke("coding-agent:preview-worktree-merge", payload),
    mergeWorktree: (payload) =>
      ipcRenderer.invoke("coding-agent:merge-worktree", payload),
    applyWorktreeAutomation: (payload) =>
      ipcRenderer.invoke("coding-agent:apply-worktree-automation", payload),
    listSubAgents: (sessionId) =>
      ipcRenderer.invoke("coding-agent:list-sub-agents", { sessionId }),
    getSubAgent: (payload) =>
      ipcRenderer.invoke("coding-agent:get-sub-agent", payload),
    enterReview: (payload) =>
      ipcRenderer.invoke("coding-agent:enter-review", payload),
    submitReviewComment: (payload) =>
      ipcRenderer.invoke("coding-agent:submit-review-comment", payload),
    resolveReview: (payload) =>
      ipcRenderer.invoke("coding-agent:resolve-review", payload),
    getReviewState: (payload) =>
      ipcRenderer.invoke("coding-agent:get-review-state", payload),
    proposePatch: (payload) =>
      ipcRenderer.invoke("coding-agent:propose-patch", payload),
    applyPatch: (payload) =>
      ipcRenderer.invoke("coding-agent:apply-patch", payload),
    rejectPatch: (payload) =>
      ipcRenderer.invoke("coding-agent:reject-patch", payload),
    getPatchSummary: (payload) =>
      ipcRenderer.invoke("coding-agent:get-patch-summary", payload),
    createTaskGraph: (payload) =>
      ipcRenderer.invoke("coding-agent:create-task-graph", payload),
    addTaskNode: (payload) =>
      ipcRenderer.invoke("coding-agent:add-task-node", payload),
    updateTaskNode: (payload) =>
      ipcRenderer.invoke("coding-agent:update-task-node", payload),
    advanceTaskGraph: (payload) =>
      ipcRenderer.invoke("coding-agent:advance-task-graph", payload),
    getTaskGraph: (payload) =>
      ipcRenderer.invoke("coding-agent:get-task-graph", payload),
    getStatus: () => ipcRenderer.invoke("coding-agent:get-status"),
    getArtifactWorkbench: () =>
      ipcRenderer.invoke("coding-agent:get-artifact-workbench"),
    openArtifact: (payload) =>
      ipcRenderer.invoke("coding-agent:open-artifact", payload),
    downloadArtifact: (payload) =>
      ipcRenderer.invoke("coding-agent:download-artifact", payload),
    removeArtifact: (payload) =>
      ipcRenderer.invoke("coding-agent:remove-artifact", payload),
    adjudicateArtifactRecovery: (payload) =>
      ipcRenderer.invoke("coding-agent:adjudicate-artifact-recovery", payload),
    // Canonical workflow commands ($deep-interview / $ralplan / $ralph / $team)
    checkWorkflowCommand: (text) =>
      ipcRenderer.invoke("coding-agent:check-workflow-command", text),
    runWorkflowCommand: (payload) =>
      ipcRenderer.invoke("coding-agent:run-workflow-command", payload),
    onEvent: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("coding-agent:event", handler);
      return () => ipcRenderer.removeListener("coding-agent:event", handler);
    },
    subscribeEvents: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("coding-agent:event", handler);
      return () => ipcRenderer.removeListener("coding-agent:event", handler);
    },
  },

  // Phase D: read-only bridge to canonical workflow session state
  // (.chainlesschain/sessions/<id>/ — stage, tasks.json, verify.json).
  workflowSession: {
    list: () => ipcRenderer.invoke("workflow-session:list"),
    get: (sessionId) => ipcRenderer.invoke("workflow-session:get", sessionId),
    listMembers: (parentId) =>
      ipcRenderer.invoke("workflow-session:list-members", parentId),
    classifyIntake: (input) =>
      ipcRenderer.invoke("workflow-session:classify-intake", input),
  },

  config: {
    getAll: () => ipcRenderer.invoke("config:get-all"),
    get: (key) => ipcRenderer.invoke("config:get", key),
    update: (config) => ipcRenderer.invoke("config:update", config),
    set: (key, value) => ipcRenderer.invoke("config:set", key, value),
    reset: () => ipcRenderer.invoke("config:reset"),
    exportEnv: (filePath) => ipcRenderer.invoke("config:export-env", filePath),
  },

  // Git同步
  git: {
    status: () => ipcRenderer.invoke("git:status"),
    sync: () => ipcRenderer.invoke("git:sync"),
    push: () => ipcRenderer.invoke("git:push"),
    pull: () => ipcRenderer.invoke("git:pull"),
    clone: (url, targetPath, auth) =>
      ipcRenderer.invoke("git:clone", url, targetPath, auth),
    getLog: (depth) => ipcRenderer.invoke("git:get-log", depth),
    getConfig: () => ipcRenderer.invoke("git:get-config"),
    getSyncStatus: () => ipcRenderer.invoke("git:get-sync-status"),
    setConfig: (config) => ipcRenderer.invoke("git:set-config", config),
    setRemote: (url) => ipcRenderer.invoke("git:set-remote", url),
    setAuth: (auth) => ipcRenderer.invoke("git:set-auth", auth),
    exportMarkdown: () => ipcRenderer.invoke("git:export-markdown"),
    // 冲突解决
    getConflicts: () => ipcRenderer.invoke("git:get-conflicts"),
    getConflictContent: (filepath) =>
      ipcRenderer.invoke("git:get-conflict-content", filepath),
    resolveConflict: (filepath, resolution, content) =>
      ipcRenderer.invoke("git:resolve-conflict", filepath, resolution, content),
    abortMerge: () => ipcRenderer.invoke("git:abort-merge"),
    completeMerge: (message) =>
      ipcRenderer.invoke("git:complete-merge", message),
    // 热重载
    hotReload: {
      start: () => ipcRenderer.invoke("git:hot-reload:start"),
      stop: () => ipcRenderer.invoke("git:hot-reload:stop"),
      status: () => ipcRenderer.invoke("git:hot-reload:status"),
      refresh: () => ipcRenderer.invoke("git:hot-reload:refresh"),
      configure: (config) =>
        ipcRenderer.invoke("git:hot-reload:configure", config),
    },
    // 事件监听
    on: (event, callback) => {
      const listener = (_event, ...args) => callback(...args);
      ipcRenderer.on(event, listener);
      return () => ipcRenderer.removeListener(event, listener);
    },
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
    // 热重载事件监听（便捷方法）
    onStatusChanged: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("git:status-changed", listener);
      return () => ipcRenderer.removeListener("git:status-changed", listener);
    },
    onFileChanged: (callback) => {
      const listener = (_event, data) => callback(data);
      ipcRenderer.on("git:file-changed", listener);
      return () => ipcRenderer.removeListener("git:file-changed", listener);
    },
    onHotReloadError: (callback) => {
      const listener = (_event, error) => callback(error);
      ipcRenderer.on("git:hot-reload:error", listener);
      return () => ipcRenderer.removeListener("git:hot-reload:error", listener);
    },
  },

  // RAG - 知识库检索增强
  rag: {
    retrieve: (query, options) =>
      ipcRenderer.invoke("rag:retrieve", query, options),
    enhanceQuery: (query, options) =>
      ipcRenderer.invoke("rag:enhance-query", query, options),
    rebuildIndex: () => ipcRenderer.invoke("rag:rebuild-index"),
    getStats: () => ipcRenderer.invoke("rag:get-stats"),
    updateConfig: (config) => ipcRenderer.invoke("rag:update-config", config),
    // 重排序功能
    getRerankConfig: () => ipcRenderer.invoke("rag:get-rerank-config"),
    setRerankingEnabled: (enabled) =>
      ipcRenderer.invoke("rag:set-reranking-enabled", enabled),
  },

  // DID身份管理
  // MTC (Merkle Tree Certificates) — Phase 4.2
  // Read-only audit status + envelope verification for V6 widgets and DID detail page.
  // Operational/signing commands (emit/reconcile/publish-skills) stay CLI-only by design.
  mtc: {
    getAuditStatus: () => ipcRenderer.invoke("mtc:get-audit-status"),
    getActiveAlg: () => ipcRenderer.invoke("mtc:get-active-alg"),
    verifyEnvelope: (envelope, landmark, opts) =>
      ipcRenderer.invoke("mtc:verify-envelope", envelope, landmark, opts),
    // Bridge MTC (cross-chain bridge) — surfaces config + trust anchors +
    // staging + batch counters for the V6 BridgeMtcStatusWidget.
    getBridgeStatus: () => ipcRenderer.invoke("mtc:get-bridge-status"),
    // Federation governance (per-fed event log + replayed state) — for the
    // V6 FederationGovernanceWidget.
    getFederationGovernance: () =>
      ipcRenderer.invoke("mtc:get-federation-governance"),
    // v0.10: per-fed sync-stats (publish/pull/libp2p wire counters) written
    // by the governance-sync-serve / governance-sync-libp2p daemons.
    getFederationSyncStats: () =>
      ipcRenderer.invoke("mtc:get-federation-sync-stats"),
  },

  did: {
    createIdentity: (profile, options) =>
      ipcRenderer.invoke("did:create-identity", profile, options),
    getAllIdentities: () => ipcRenderer.invoke("did:get-all-identities"),
    getIdentity: (did) => ipcRenderer.invoke("did:get-identity", did),
    getCurrentIdentity: () => ipcRenderer.invoke("did:get-current-identity"),
    setDefaultIdentity: (did) =>
      ipcRenderer.invoke("did:set-default-identity", did),
    updateIdentity: (did, updates) =>
      ipcRenderer.invoke("did:update-identity", did, updates),
    deleteIdentity: (did) => ipcRenderer.invoke("did:delete-identity", did),
    exportDocument: (did) => ipcRenderer.invoke("did:export-document", did),
    generateQRCode: (did) => ipcRenderer.invoke("did:generate-qrcode", did),
    verifyDocument: (document) =>
      ipcRenderer.invoke("did:verify-document", document),
    // DHT操作
    publishToDHT: (did) => ipcRenderer.invoke("did:publish-to-dht", did),
    resolveFromDHT: (did) => ipcRenderer.invoke("did:resolve-from-dht", did),
    unpublishFromDHT: (did) =>
      ipcRenderer.invoke("did:unpublish-from-dht", did),
    isPublishedToDHT: (did) =>
      ipcRenderer.invoke("did:is-published-to-dht", did),
    // 自动重新发布
    startAutoRepublish: (interval) =>
      ipcRenderer.invoke("did:start-auto-republish", interval),
    stopAutoRepublish: () => ipcRenderer.invoke("did:stop-auto-republish"),
    getAutoRepublishStatus: () =>
      ipcRenderer.invoke("did:get-auto-republish-status"),
    setAutoRepublishInterval: (interval) =>
      ipcRenderer.invoke("did:set-auto-republish-interval", interval),
    republishAll: () => ipcRenderer.invoke("did:republish-all"),
    // 助记词管理
    generateMnemonic: (strength) =>
      ipcRenderer.invoke("did:generate-mnemonic", strength),
    validateMnemonic: (mnemonic) =>
      ipcRenderer.invoke("did:validate-mnemonic", mnemonic),
    createFromMnemonic: (profile, mnemonic, options) =>
      ipcRenderer.invoke(
        "did:create-from-mnemonic",
        profile,
        mnemonic,
        options,
      ),
    exportMnemonic: (did) => ipcRenderer.invoke("did:export-mnemonic", did),
    hasMnemonic: (did) => ipcRenderer.invoke("did:has-mnemonic", did),
  },

  // 联系人管理
  contact: {
    add: (contact) => ipcRenderer.invoke("contact:add", contact),
    addFromQR: (qrData) => ipcRenderer.invoke("contact:add-from-qr", qrData),
    getAll: () => ipcRenderer.invoke("contact:get-all"),
    get: (did) => ipcRenderer.invoke("contact:get", did),
    update: (did, updates) =>
      ipcRenderer.invoke("contact:update", did, updates),
    delete: (did) => ipcRenderer.invoke("contact:delete", did),
    search: (query) => ipcRenderer.invoke("contact:search", query),
    getFriends: () => ipcRenderer.invoke("contact:get-friends"),
    getStatistics: () => ipcRenderer.invoke("contact:get-statistics"),
  },

  // 好友管理
  friend: {
    sendRequest: (targetDid, message) =>
      ipcRenderer.invoke("friend:send-request", targetDid, message),
    acceptRequest: (requestId) =>
      ipcRenderer.invoke("friend:accept-request", requestId),
    rejectRequest: (requestId) =>
      ipcRenderer.invoke("friend:reject-request", requestId),
    getPendingRequests: () => ipcRenderer.invoke("friend:get-pending-requests"),
    getFriends: (groupName) =>
      ipcRenderer.invoke("friend:get-friends", groupName),
    remove: (friendDid) => ipcRenderer.invoke("friend:remove", friendDid),
    updateNickname: (friendDid, nickname) =>
      ipcRenderer.invoke("friend:update-nickname", friendDid, nickname),
    updateGroup: (friendDid, groupName) =>
      ipcRenderer.invoke("friend:update-group", friendDid, groupName),
    getStatistics: () => ipcRenderer.invoke("friend:get-statistics"),
  },

  // 动态管理
  post: {
    create: (options) => ipcRenderer.invoke("post:create", options),
    getFeed: (options) => ipcRenderer.invoke("post:get-feed", options),
    get: (postId) => ipcRenderer.invoke("post:get", postId),
    delete: (postId) => ipcRenderer.invoke("post:delete", postId),
    like: (postId) => ipcRenderer.invoke("post:like", postId),
    unlike: (postId) => ipcRenderer.invoke("post:unlike", postId),
    getLikes: (postId) => ipcRenderer.invoke("post:get-likes", postId),
    addComment: (postId, content, parentId) =>
      ipcRenderer.invoke("post:add-comment", postId, content, parentId),
    getComments: (postId) => ipcRenderer.invoke("post:get-comments", postId),
    deleteComment: (commentId) =>
      ipcRenderer.invoke("post:delete-comment", commentId),
  },

  // 资产管理
  asset: {
    create: (options) => ipcRenderer.invoke("asset:create", options),
    mint: (assetId, toDid, amount) =>
      ipcRenderer.invoke("asset:mint", assetId, toDid, amount),
    transfer: (assetId, toDid, amount, memo) =>
      ipcRenderer.invoke("asset:transfer", assetId, toDid, amount, memo),
    burn: (assetId, amount) =>
      ipcRenderer.invoke("asset:burn", assetId, amount),
    get: (assetId) => ipcRenderer.invoke("asset:get", assetId),
    getByOwner: (ownerDid) =>
      ipcRenderer.invoke("asset:get-by-owner", ownerDid),
    getAll: (filters) => ipcRenderer.invoke("asset:get-all", filters),
    getHistory: (assetId, limit) =>
      ipcRenderer.invoke("asset:get-history", assetId, limit),
    getBalance: (ownerDid, assetId) =>
      ipcRenderer.invoke("asset:get-balance", ownerDid, assetId),
  },

  // 交易市场
  marketplace: {
    createOrder: (options) =>
      ipcRenderer.invoke("marketplace:create-order", options),
    cancelOrder: (orderId) =>
      ipcRenderer.invoke("marketplace:cancel-order", orderId),
    getOrders: (filters) =>
      ipcRenderer.invoke("marketplace:get-orders", filters),
    getOrder: (orderId) => ipcRenderer.invoke("marketplace:get-order", orderId),
    matchOrder: (orderId, quantity) =>
      ipcRenderer.invoke("marketplace:match-order", orderId, quantity),
    getTransactions: (filters) =>
      ipcRenderer.invoke("marketplace:get-transactions", filters),
    confirmDelivery: (transactionId) =>
      ipcRenderer.invoke("marketplace:confirm-delivery", transactionId),
    requestRefund: (transactionId, reason) =>
      ipcRenderer.invoke("marketplace:request-refund", transactionId, reason),
    getMyOrders: (userDid) =>
      ipcRenderer.invoke("marketplace:get-my-orders", userDid),
    // 搜索相关
    searchOrders: (options) =>
      ipcRenderer.invoke("marketplace:search-orders", options),
    getSearchSuggestions: (prefix, limit = 10) =>
      ipcRenderer.invoke("marketplace:get-search-suggestions", prefix, limit),
    // 订单更新
    updateOrder: (orderId, updates) =>
      ipcRenderer.invoke("trade:update-order", { orderId, ...updates }),
  },

  // 托管管理
  escrow: {
    get: (escrowId) => ipcRenderer.invoke("escrow:get", escrowId),
    getList: (filters) => ipcRenderer.invoke("escrow:get-list", filters),
    getHistory: (escrowId) =>
      ipcRenderer.invoke("escrow:get-history", escrowId),
    dispute: (escrowId, reason) =>
      ipcRenderer.invoke("escrow:dispute", escrowId, reason),
    getStatistics: () => ipcRenderer.invoke("escrow:get-statistics"),
  },

  // 结算 escrow (core-settlement：联邦签名转账账本 + multisig 门控托管)
  settlement: {
    getBalance: (did) => ipcRenderer.invoke("settlement:get-balance", did),
    getHold: (holdId) => ipcRenderer.invoke("settlement:get-hold", holdId),
    registerMember: (member) =>
      ipcRenderer.invoke("settlement:register-member", member),
    grant: (payload) => ipcRenderer.invoke("settlement:grant", payload),
    openHold: (payload) => ipcRenderer.invoke("settlement:open-hold", payload),
    release: (holdId) => ipcRenderer.invoke("settlement:release", holdId),
    refund: (holdId) => ipcRenderer.invoke("settlement:refund", holdId),
  },

  // 智能合约
  contract: {
    create: (options) => ipcRenderer.invoke("contract:create", options),
    activate: (contractId) =>
      ipcRenderer.invoke("contract:activate", contractId),
    sign: (contractId, signature) =>
      ipcRenderer.invoke("contract:sign", contractId, signature),
    checkConditions: (contractId) =>
      ipcRenderer.invoke("contract:check-conditions", contractId),
    execute: (contractId) => ipcRenderer.invoke("contract:execute", contractId),
    cancel: (contractId, reason) =>
      ipcRenderer.invoke("contract:cancel", contractId, reason),
    get: (contractId) => ipcRenderer.invoke("contract:get", contractId),
    getList: (filters) => ipcRenderer.invoke("contract:get-list", filters),
    getConditions: (contractId) =>
      ipcRenderer.invoke("contract:get-conditions", contractId),
    getEvents: (contractId) =>
      ipcRenderer.invoke("contract:get-events", contractId),
    initiateArbitration: (contractId, reason, evidence) =>
      ipcRenderer.invoke(
        "contract:initiate-arbitration",
        contractId,
        reason,
        evidence,
      ),
    resolveArbitration: (arbitrationId, resolution) =>
      ipcRenderer.invoke(
        "contract:resolve-arbitration",
        arbitrationId,
        resolution,
      ),
    getTemplates: () => ipcRenderer.invoke("contract:get-templates"),
    createFromTemplate: (templateId, params) =>
      ipcRenderer.invoke("contract:create-from-template", templateId, params),
  },

  // 知识付费
  knowledge: {
    getTags: () => ipcRenderer.invoke("knowledge:get-tags"),
    getVersionHistory: (params) =>
      ipcRenderer.invoke("knowledge:get-version-history", params),
    restoreVersion: (params) =>
      ipcRenderer.invoke("knowledge:restore-version", params),
    compareVersions: (params) =>
      ipcRenderer.invoke("knowledge:compare-versions", params),
    createContent: (options) =>
      ipcRenderer.invoke("knowledge:create-content", options),
    updateContent: (contentId, updates) =>
      ipcRenderer.invoke("knowledge:update-content", contentId, updates),
    deleteContent: (contentId) =>
      ipcRenderer.invoke("knowledge:delete-content", contentId),
    getContent: (contentId) =>
      ipcRenderer.invoke("knowledge:get-content", contentId),
    listContents: (filters) =>
      ipcRenderer.invoke("knowledge:list-contents", filters),
    getAll: (filters) => ipcRenderer.invoke("knowledge:list-contents", filters), // 别名
    purchaseContent: (contentId, paymentAssetId) =>
      ipcRenderer.invoke(
        "knowledge:purchase-content",
        contentId,
        paymentAssetId,
      ),
    subscribe: (planId, paymentAssetId) =>
      ipcRenderer.invoke("knowledge:subscribe", planId, paymentAssetId),
    unsubscribe: (planId) =>
      ipcRenderer.invoke("knowledge:unsubscribe", planId),
    getMyPurchases: (userDid) =>
      ipcRenderer.invoke("knowledge:get-my-purchases", userDid),
    getMySubscriptions: (userDid) =>
      ipcRenderer.invoke("knowledge:get-my-subscriptions", userDid),
    accessContent: (contentId) =>
      ipcRenderer.invoke("knowledge:access-content", contentId),
    checkAccess: (contentId, userDid) =>
      ipcRenderer.invoke("knowledge:check-access", contentId, userDid),
    getStatistics: (creatorDid) =>
      ipcRenderer.invoke("knowledge:get-statistics", creatorDid),
    getCategories: () => ipcRenderer.invoke("knowledge:get-tags"), // 别名
  },

  // 截图 + OCR (托盘"截图识别"入口)
  screenshot: {
    capture: (options) =>
      ipcRenderer.invoke("screenshot:capture", options || {}),
    ocr: (options) => ipcRenderer.invoke("screenshot:ocr", options || {}),
    cleanup: (options) =>
      ipcRenderer.invoke("screenshot:cleanup", options || {}),
  },

  // 知识图谱
  graph: {
    getGraphData: (options) =>
      ipcRenderer.invoke("graph:get-graph-data", options || {}),
    processNote: (noteId, content, tags) =>
      ipcRenderer.invoke("graph:process-note", noteId, content, tags || []),
    processAllNotes: (noteIds) =>
      ipcRenderer.invoke("graph:process-all-notes", noteIds),
    getKnowledgeRelations: (knowledgeId) =>
      ipcRenderer.invoke("graph:get-knowledge-relations", knowledgeId),
    findRelatedNotes: (sourceId, targetId, maxDepth) =>
      ipcRenderer.invoke(
        "graph:find-related-notes",
        sourceId,
        targetId,
        maxDepth || 3,
      ),
    findPotentialLinks: (noteId, content) =>
      ipcRenderer.invoke("graph:find-potential-links", noteId, content),
    addRelation: (sourceId, targetId, type, weight, metadata) =>
      ipcRenderer.invoke(
        "graph:add-relation",
        sourceId,
        targetId,
        type,
        weight || 1.0,
        metadata || null,
      ),
    deleteRelations: (noteId, types) =>
      ipcRenderer.invoke("graph:delete-relations", noteId, types || []),
    buildTagRelations: () => ipcRenderer.invoke("graph:build-tag-relations"),
    buildTemporalRelations: (windowDays) =>
      ipcRenderer.invoke("graph:build-temporal-relations", windowDays || 7),
    extractSemanticRelations: (noteId, content) =>
      ipcRenderer.invoke("graph:extract-semantic-relations", noteId, content),
  },

  // 信用评分
  credit: {
    getUserCredit: (userDid) =>
      ipcRenderer.invoke("credit:get-user-credit", userDid),
    updateScore: (userDid) =>
      ipcRenderer.invoke("credit:update-score", userDid),
    getScoreHistory: (userDid, limit) =>
      ipcRenderer.invoke("credit:get-score-history", userDid, limit),
    getCreditLevel: (score) =>
      ipcRenderer.invoke("credit:get-credit-level", score),
    getLeaderboard: (limit) =>
      ipcRenderer.invoke("credit:get-leaderboard", limit),
    getBenefits: (userDid) =>
      ipcRenderer.invoke("credit:get-benefits", userDid),
    getStatistics: () => ipcRenderer.invoke("credit:get-statistics"),
  },

  // 评价反馈
  review: {
    create: (options) => ipcRenderer.invoke("review:create", options),
    update: (reviewId, updates) =>
      ipcRenderer.invoke("review:update", reviewId, updates),
    delete: (reviewId) => ipcRenderer.invoke("review:delete", reviewId),
    get: (reviewId) => ipcRenderer.invoke("review:get", reviewId),
    getByTarget: (targetId, targetType, filters) =>
      ipcRenderer.invoke("review:get-by-target", targetId, targetType, filters),
    reply: (reviewId, content) =>
      ipcRenderer.invoke("review:reply", reviewId, content),
    markHelpful: (reviewId, helpful) =>
      ipcRenderer.invoke("review:mark-helpful", reviewId, helpful),
    report: (reviewId, reason, description) =>
      ipcRenderer.invoke("review:report", reviewId, reason, description),
    getStatistics: (targetId, targetType) =>
      ipcRenderer.invoke("review:get-statistics", targetId, targetType),
    getMyReviews: (userDid) =>
      ipcRenderer.invoke("review:get-my-reviews", userDid),
  },

  // P2P网络
  p2p: {
    getNodeInfo: () => ipcRenderer.invoke("p2p:get-node-info"),
    connect: (multiaddr) => ipcRenderer.invoke("p2p:connect", multiaddr),
    disconnect: (peerId) => ipcRenderer.invoke("p2p:disconnect", peerId),
    getPeers: () => ipcRenderer.invoke("p2p:get-peers"),
    // 加密消息
    sendEncryptedMessage: (peerId, message, deviceId, options) =>
      ipcRenderer.invoke(
        "p2p:send-encrypted-message",
        peerId,
        message,
        deviceId,
        options,
      ),
    hasEncryptedSession: (peerId) =>
      ipcRenderer.invoke("p2p:has-encrypted-session", peerId),
    initiateKeyExchange: (peerId, deviceId) =>
      ipcRenderer.invoke("p2p:initiate-key-exchange", peerId, deviceId),
    // 多设备支持
    getUserDevices: (userId) =>
      ipcRenderer.invoke("p2p:get-user-devices", userId),
    getCurrentDevice: () => ipcRenderer.invoke("p2p:get-current-device"),
    getDeviceStatistics: () => ipcRenderer.invoke("p2p:get-device-statistics"),
    // 设备同步
    getSyncStatistics: () => ipcRenderer.invoke("p2p:get-sync-statistics"),
    getMessageStatus: (messageId) =>
      ipcRenderer.invoke("p2p:get-message-status", messageId),
    startDeviceSync: (deviceId) =>
      ipcRenderer.invoke("p2p:start-device-sync", deviceId),
    stopDeviceSync: (deviceId) =>
      ipcRenderer.invoke("p2p:stop-device-sync", deviceId),
    // NAT检测和诊断
    detectNAT: () => ipcRenderer.invoke("p2p:detect-nat"),
    getNATInfo: () => ipcRenderer.invoke("p2p:get-nat-info"),
    getRelayInfo: () => ipcRenderer.invoke("p2p:get-relay-info"),
    runDiagnostics: () => ipcRenderer.invoke("p2p:run-diagnostics"),
    // WebRTC质量监控
    getWebRTCQualityReport: (peerId) =>
      ipcRenderer.invoke("p2p:get-webrtc-quality-report", peerId),
    getWebRTCOptimizationSuggestions: (peerId) =>
      ipcRenderer.invoke("p2p:get-webrtc-optimization-suggestions", peerId),
    getConnectionPoolStats: () =>
      ipcRenderer.invoke("p2p:get-connection-pool-stats"),
    // 事件监听
    on: (event, callback) =>
      ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 身份上下文管理 (Identity Context)
  identityContext: {
    getAllContexts: (userDID) =>
      ipcRenderer.invoke("identity:get-all-contexts", { userDID }),
    getActiveContext: (userDID) =>
      ipcRenderer.invoke("identity:get-active-context", { userDID }),
    createPersonalContext: (userDID, displayName) =>
      ipcRenderer.invoke("identity:create-personal-context", {
        userDID,
        displayName,
      }),
    createOrganizationContext: (params) =>
      ipcRenderer.invoke("identity:create-organization-context", params),
    switchContext: (userDID, targetContextId) =>
      ipcRenderer.invoke("identity:switch-context", {
        userDID,
        targetContextId,
      }),
    deleteOrganizationContext: (userDID, orgId) =>
      ipcRenderer.invoke("identity:delete-organization-context", {
        userDID,
        orgId,
      }),
    getSwitchHistory: (userDID, limit) =>
      ipcRenderer.invoke("identity:get-switch-history", { userDID, limit }),
  },

  // 组织管理 (Organization)
  organization: {
    // 组织CRUD
    create: (orgData) => ipcRenderer.invoke("org:create-organization", orgData),
    join: (inviteCode) =>
      ipcRenderer.invoke("org:join-organization", inviteCode),
    get: (orgId) => ipcRenderer.invoke("org:get-organization", orgId),
    update: (params) => ipcRenderer.invoke("org:update-organization", params),
    getUserOrganizations: (userDID) =>
      ipcRenderer.invoke("org:get-user-organizations", userDID),
    leave: (orgId, userDID) =>
      ipcRenderer.invoke("org:leave-organization", orgId, userDID),
    delete: (orgId, userDID) =>
      ipcRenderer.invoke("org:delete-organization", orgId, userDID),
    // 成员管理
    getMembers: (orgId) => ipcRenderer.invoke("org:get-members", orgId),
    updateMemberRole: (orgId, memberDID, newRole) =>
      ipcRenderer.invoke("org:update-member-role", orgId, memberDID, newRole),
    removeMember: (orgId, memberDID) =>
      ipcRenderer.invoke("org:remove-member", orgId, memberDID),
    checkPermission: (orgId, userDID, permission) =>
      ipcRenderer.invoke("org:check-permission", orgId, userDID, permission),
    getMemberActivities: (params) =>
      ipcRenderer.invoke("org:get-member-activities", params),
    // 邀请管理
    createInvitation: (orgId, inviteData) =>
      ipcRenderer.invoke("org:create-invitation", orgId, inviteData),
    inviteByDID: (orgId, inviteData) =>
      ipcRenderer.invoke("org:invite-by-did", orgId, inviteData),
    acceptDIDInvitation: (invitationId) =>
      ipcRenderer.invoke("org:accept-did-invitation", invitationId),
    rejectDIDInvitation: (invitationId) =>
      ipcRenderer.invoke("org:reject-did-invitation", invitationId),
    getPendingDIDInvitations: () =>
      ipcRenderer.invoke("org:get-pending-did-invitations"),
    getDIDInvitations: (orgId, options) =>
      ipcRenderer.invoke("org:get-did-invitations", orgId, options),
    getInvitations: (orgId) => ipcRenderer.invoke("org:get-invitations", orgId),
    revokeInvitation: (params) =>
      ipcRenderer.invoke("org:revoke-invitation", params),
    deleteInvitation: (params) =>
      ipcRenderer.invoke("org:delete-invitation", params),
    // 角色管理
    getRoles: (orgId) => ipcRenderer.invoke("org:get-roles", orgId),
    getRole: (roleId) => ipcRenderer.invoke("org:get-role", roleId),
    createCustomRole: (orgId, roleData, creatorDID) =>
      ipcRenderer.invoke("org:create-custom-role", orgId, roleData, creatorDID),
    updateRole: (roleId, updates, updaterDID) =>
      ipcRenderer.invoke("org:update-role", roleId, updates, updaterDID),
    deleteRole: (roleId, deleterDID) =>
      ipcRenderer.invoke("org:delete-role", roleId, deleterDID),
    getAllPermissions: () => ipcRenderer.invoke("org:get-all-permissions"),
    // 活动日志
    getActivities: (options) =>
      ipcRenderer.invoke("org:get-activities", options),
    exportActivities: (options) =>
      ipcRenderer.invoke("org:export-activities", options),
    // 知识库
    getKnowledgeItems: (params) =>
      ipcRenderer.invoke("org:get-knowledge-items", params),
    createKnowledge: (params) =>
      ipcRenderer.invoke("org:create-knowledge", params),
    deleteKnowledge: (params) =>
      ipcRenderer.invoke("org:delete-knowledge", params),
  },

  // 可验证凭证 (VC)
  vc: {
    create: (params) => ipcRenderer.invoke("vc:create", params),
    getAll: (filters) => ipcRenderer.invoke("vc:get-all", filters),
    get: (id) => ipcRenderer.invoke("vc:get", id),
    verify: (vcDocument) => ipcRenderer.invoke("vc:verify", vcDocument),
    revoke: (id, issuerDID) => ipcRenderer.invoke("vc:revoke", id, issuerDID),
    delete: (id) => ipcRenderer.invoke("vc:delete", id),
    export: (id) => ipcRenderer.invoke("vc:export", id),
    getStatistics: (did) => ipcRenderer.invoke("vc:get-statistics", did),
    generateShareData: (id) => ipcRenderer.invoke("vc:generate-share-data", id),
    importFromShare: (shareData) =>
      ipcRenderer.invoke("vc:import-from-share", shareData),
  },

  // 可验证凭证模板 (VC Templates)
  vcTemplate: {
    getAll: (filters) => ipcRenderer.invoke("vc-template:get-all", filters),
    get: (id) => ipcRenderer.invoke("vc-template:get", id),
    create: (templateData) =>
      ipcRenderer.invoke("vc-template:create", templateData),
    update: (id, updates) =>
      ipcRenderer.invoke("vc-template:update", id, updates),
    delete: (id) => ipcRenderer.invoke("vc-template:delete", id),
    fillValues: (templateId, values) =>
      ipcRenderer.invoke("vc-template:fill-values", templateId, values),
    incrementUsage: (id) =>
      ipcRenderer.invoke("vc-template:increment-usage", id),
    getStatistics: () => ipcRenderer.invoke("vc-template:get-statistics"),
    export: (id) => ipcRenderer.invoke("vc-template:export", id),
    exportMultiple: (ids) =>
      ipcRenderer.invoke("vc-template:export-multiple", ids),
    import: (importData, createdBy, options) =>
      ipcRenderer.invoke("vc-template:import", importData, createdBy, options),
  },

  // 文件导入
  import: {
    selectFiles: () => ipcRenderer.invoke("import:select-files"),
    importFile: (filePath, options) =>
      ipcRenderer.invoke("import:import-file", filePath, options),
    importFiles: (filePaths, options) =>
      ipcRenderer.invoke("import:import-files", filePaths, options),
    getSupportedFormats: () =>
      ipcRenderer.invoke("import:get-supported-formats"),
    checkFile: (filePath) => ipcRenderer.invoke("import:check-file", filePath),
    // 事件监听
    on: (event, callback) =>
      ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 图片上传和 OCR
  image: {
    selectImages: () => ipcRenderer.invoke("image:select-images"),
    upload: (imagePath, options) =>
      ipcRenderer.invoke("image:upload", imagePath, options),
    uploadBatch: (imagePaths, options) =>
      ipcRenderer.invoke("image:upload-batch", imagePaths, options),
    performOCR: (imagePath) => ipcRenderer.invoke("image:ocr", imagePath),
    getImage: (imageId) => ipcRenderer.invoke("image:get", imageId),
    listImages: (options) => ipcRenderer.invoke("image:list", options),
    searchImages: (query) => ipcRenderer.invoke("image:search", query),
    deleteImage: (imageId) => ipcRenderer.invoke("image:delete", imageId),
    getStats: () => ipcRenderer.invoke("image:get-stats"),
    getSupportedFormats: () =>
      ipcRenderer.invoke("image:get-supported-formats"),
    getSupportedLanguages: () =>
      ipcRenderer.invoke("image:get-supported-languages"),
    // 事件监听
    on: (event, callback) =>
      ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // 视频处理引擎
  video: {
    convert: (params) =>
      ipcRenderer.invoke("video:convert", removeUndefined(params)),
    trim: (params) => ipcRenderer.invoke("video:trim", removeUndefined(params)),
    merge: (params) =>
      ipcRenderer.invoke("video:merge", removeUndefined(params)),
    addSubtitles: (params) =>
      ipcRenderer.invoke("video:addSubtitles", removeUndefined(params)),
    generateSubtitles: (params) =>
      ipcRenderer.invoke("video:generateSubtitles", removeUndefined(params)),
    extractAudio: (params) =>
      ipcRenderer.invoke("video:extractAudio", removeUndefined(params)),
    generateThumbnail: (params) =>
      ipcRenderer.invoke("video:generateThumbnail", removeUndefined(params)),
    compress: (params) =>
      ipcRenderer.invoke("video:compress", removeUndefined(params)),
    getInfo: (videoPath) => ipcRenderer.invoke("video:getInfo", videoPath),
    generate: (params) =>
      ipcRenderer.invoke("video:generate", removeUndefined(params)),
    onGenerateProgress: (cb) => {
      const h = (_e, p) => cb(p);
      ipcRenderer.on("video:generate:progress", h);
      return () => ipcRenderer.removeListener("video:generate:progress", h);
    },
  },

  // 视频剪辑 Agent (CutClaw-inspired)
  videoEditing: {
    deconstruct: (options) =>
      ipcRenderer.invoke("video-edit:deconstruct", removeUndefined(options)),
    plan: (options) =>
      ipcRenderer.invoke("video-edit:plan", removeUndefined(options)),
    assemble: (options) =>
      ipcRenderer.invoke("video-edit:assemble", removeUndefined(options)),
    render: (options) =>
      ipcRenderer.invoke("video-edit:render", removeUndefined(options)),
    edit: (options) =>
      ipcRenderer.invoke("video-edit:edit", removeUndefined(options)),
    assetsList: () => ipcRenderer.invoke("video-edit:assets-list"),
    cancel: (requestId) => ipcRenderer.invoke("video-edit:cancel", requestId),
    onEvent: (cb) => {
      const h = (_e, ev) => cb(ev);
      ipcRenderer.on("video-edit:event", h);
      return () => ipcRenderer.removeListener("video-edit:event", h);
    },
  },

  // 提示词模板管理
  promptTemplate: {
    getAll: (filters) => ipcRenderer.invoke("prompt-template:get-all", filters),
    get: (id) => ipcRenderer.invoke("prompt-template:get", id),
    create: (templateData) =>
      ipcRenderer.invoke("prompt-template:create", templateData),
    update: (id, updates) =>
      ipcRenderer.invoke("prompt-template:update", id, updates),
    delete: (id) => ipcRenderer.invoke("prompt-template:delete", id),
    fill: (id, values) =>
      ipcRenderer.invoke("prompt-template:fill", id, values),
    getCategories: () => ipcRenderer.invoke("prompt-template:get-categories"),
    search: (query) => ipcRenderer.invoke("prompt-template:search", query),
    getStatistics: () => ipcRenderer.invoke("prompt-template:get-statistics"),
    export: (id) => ipcRenderer.invoke("prompt-template:export", id),
    import: (importData) =>
      ipcRenderer.invoke("prompt-template:import", importData),
  },

  // 项目模板管理
  template: {
    getAll: (filters) => ipcRenderer.invoke("template:getAll", filters),
    getById: (templateId) => ipcRenderer.invoke("template:getById", templateId),
    search: (keyword, filters) =>
      ipcRenderer.invoke("template:search", keyword, filters),
    renderPrompt: (templateId, userVariables) =>
      ipcRenderer.invoke("template:renderPrompt", templateId, userVariables),
    recordUsage: (templateId, userId, projectId, variablesUsed) =>
      ipcRenderer.invoke(
        "template:recordUsage",
        templateId,
        userId,
        projectId,
        variablesUsed,
      ),
    rate: (templateId, userId, rating, review) =>
      ipcRenderer.invoke("template:rate", templateId, userId, rating, review),
    getStats: () => ipcRenderer.invoke("template:getStats"),
    getRecent: (userId, limit) =>
      ipcRenderer.invoke("template:getRecent", userId, limit),
    getPopular: (limit) => ipcRenderer.invoke("template:getPopular", limit),
    // CRUD 操作
    create: (templateData) =>
      ipcRenderer.invoke("template:create", removeUndefined(templateData)),
    update: (templateId, updates) =>
      ipcRenderer.invoke(
        "template:update",
        templateId,
        removeUndefined(updates),
      ),
    delete: (templateId) => ipcRenderer.invoke("template:delete", templateId),
    duplicate: (templateId, newName) =>
      ipcRenderer.invoke("template:duplicate", templateId, newName),
  },

  // 项目分类管理
  category: {
    initializeDefaults: (userId) =>
      ipcRenderer.invoke("category:initialize-defaults", userId),
    getAll: (userId) => ipcRenderer.invoke("category:get-all", userId),
    get: (categoryId) => ipcRenderer.invoke("category:get", categoryId),
    create: (categoryData) =>
      ipcRenderer.invoke("category:create", removeUndefined(categoryData)),
    update: (categoryId, updates) =>
      ipcRenderer.invoke(
        "category:update",
        categoryId,
        removeUndefined(updates),
      ),
    delete: (categoryId) => ipcRenderer.invoke("category:delete", categoryId),
    updateSort: (sortData) =>
      ipcRenderer.invoke("category:update-sort", sortData),
  },

  // 项目管理
  project: {
    // 项目CRUD
    getAll: (userId) => ipcRenderer.invoke("project:get-all", userId),
    get: (projectId) => ipcRenderer.invoke("project:get", projectId),
    create: (createData) =>
      ipcRenderer.invoke("project:create", removeUndefined(createData)),
    createQuick: (createData) =>
      ipcRenderer.invoke("project:create-quick", removeUndefined(createData)),
    update: (projectId, updates) =>
      ipcRenderer.invoke("project:update", projectId, removeUndefined(updates)),
    delete: (projectId) => ipcRenderer.invoke("project:delete", projectId),
    save: (project) =>
      ipcRenderer.invoke("project:save", removeUndefined(project)),
    deleteLocal: (projectId) =>
      ipcRenderer.invoke("project:delete-local", projectId),
    repairRootPath: (projectId) =>
      ipcRenderer.invoke("project:repair-root-path", projectId),
    repairAllRootPaths: () =>
      ipcRenderer.invoke("project:repair-all-root-paths"),
    fixPath: (projectId) => ipcRenderer.invoke("project:fix-path", projectId),

    // 流式创建项目
    createStream: (createData, callbacks) => {
      return new Promise((resolve, reject) => {
        console.log("[Preload] createStream called with callbacks:", {
          hasOnProgress: !!callbacks?.onProgress,
          hasOnContent: !!callbacks?.onContent,
          hasOnComplete: !!callbacks?.onComplete,
          hasOnError: !!callbacks?.onError,
        });

        const handleChunk = (event, chunkData) => {
          console.log("[Preload] ===== 收到IPC事件 =====");
          console.log("[Preload] Event data:", chunkData);

          const { type, data, error } = chunkData;
          console.log("[Preload] Event type:", type);

          switch (type) {
            case "progress":
              console.log("[Preload] 处理progress事件");
              console.log(
                "[Preload] callbacks.onProgress存在?",
                !!callbacks?.onProgress,
              );
              if (callbacks?.onProgress) {
                console.log(
                  "[Preload] 调用callbacks.onProgress with data:",
                  data,
                );
                callbacks.onProgress(data);
                console.log("[Preload] callbacks.onProgress调用完成");
              } else {
                console.warn("[Preload] callbacks.onProgress不存在!");
              }
              break;
            case "content":
              console.log("[Preload] 处理content事件");
              callbacks.onContent?.(data);
              break;
            case "complete":
              console.log("[Preload] ===== 处理complete事件 =====");
              console.log("[Preload] Complete data:", data);
              console.log(
                "[Preload] Complete data keys:",
                Object.keys(data || {}),
              );
              console.log("[Preload] 调用callbacks.onComplete");
              callbacks.onComplete?.(data);
              console.log("[Preload] 移除事件监听器");
              ipcRenderer.off("project:stream-chunk", handleChunk);
              console.log("[Preload] 调用resolve");
              resolve(data);
              console.log("[Preload] ===== Complete事件处理完毕 =====");
              break;
            case "error":
              console.log("[Preload] 处理error事件:", error);
              callbacks.onError?.(new Error(error));
              ipcRenderer.off("project:stream-chunk", handleChunk);
              reject(new Error(error));
              break;
          }
        };

        console.log("[Preload] 开始监听project:stream-chunk事件");
        // 监听流式事件
        ipcRenderer.on("project:stream-chunk", handleChunk);

        console.log("[Preload] 发起流式请求");
        // 发起流式请求
        ipcRenderer
          .invoke("project:create-stream", removeUndefined(createData))
          .catch((err) => {
            console.error("[Preload] 流式请求失败:", err);
            ipcRenderer.off("project:stream-chunk", handleChunk);
            reject(err);
          });
      });
    },

    // 取消流式创建
    cancelStream: () => ipcRenderer.invoke("project:stream-cancel"),

    // 后端获取
    fetchFromBackend: (projectId) =>
      ipcRenderer.invoke("project:fetch-from-backend", projectId),

    // 文件管理
    getFiles: (projectId) => ipcRenderer.invoke("project:get-files", projectId),
    getFile: (fileId) => ipcRenderer.invoke("project:get-file", fileId),
    saveFiles: (projectId, files) =>
      ipcRenderer.invoke("project:save-files", projectId, files),
    updateFile: (fileUpdate) =>
      ipcRenderer.invoke("project:update-file", fileUpdate),
    deleteFile: (projectId, fileId) =>
      ipcRenderer.invoke("project:delete-file", projectId, fileId),

    // AI对话 - 支持文件操作
    aiChat: (chatData) =>
      ipcRenderer.invoke("project:aiChat", removeUndefined(chatData)),

    // 取消正在进行的AI对话
    cancelAiChat: () => ipcRenderer.invoke("project:cancelAiChat"),

    // AI对话（流式） - 支持文件操作和流式输出
    aiChatStream: (chatData) =>
      ipcRenderer.invoke("project:aiChatStream", removeUndefined(chatData)),

    // 意图理解 - 分析用户输入的意图
    understandIntent: (data) =>
      ipcRenderer.invoke("project:understandIntent", removeUndefined(data)),

    // 路径解析
    resolvePath: (relativePath) =>
      ipcRenderer.invoke("project:resolve-path", relativePath),

    // 同步
    sync: (userId) =>
      ipcRenderer.invoke("project:sync", userId || "default-user"),
    syncOne: (projectId) => ipcRenderer.invoke("project:sync-one", projectId),

    // Git 操作
    gitInit: (repoPath, remoteUrl) =>
      ipcRenderer.invoke("project:git-init", repoPath, remoteUrl),
    gitStatus: (repoPath) => ipcRenderer.invoke("project:git-status", repoPath),
    gitCommit: (projectId, repoPath, message, autoGenerate) =>
      ipcRenderer.invoke(
        "project:git-commit",
        projectId,
        repoPath,
        message,
        autoGenerate,
      ),
    gitPush: (repoPath, remote, branch) =>
      ipcRenderer.invoke("project:git-push", repoPath, remote, branch),
    gitPull: (projectId, repoPath, remote, branch) =>
      ipcRenderer.invoke(
        "project:git-pull",
        projectId,
        repoPath,
        remote,
        branch,
      ),
    gitLog: (repoPath, page, pageSize) =>
      ipcRenderer.invoke("project:git-log", repoPath, page, pageSize),
    gitShowCommit: (repoPath, sha) =>
      ipcRenderer.invoke("project:git-show-commit", repoPath, sha),
    gitDiff: (repoPath, commit1, commit2) =>
      ipcRenderer.invoke("project:git-diff", repoPath, commit1, commit2),
    gitBranches: (repoPath) =>
      ipcRenderer.invoke("project:git-branches", repoPath),
    gitCreateBranch: (repoPath, branchName, fromBranch) =>
      ipcRenderer.invoke(
        "project:git-create-branch",
        repoPath,
        branchName,
        fromBranch,
      ),
    gitCheckout: (repoPath, branchName) =>
      ipcRenderer.invoke("project:git-checkout", repoPath, branchName),
    gitMerge: (repoPath, sourceBranch, targetBranch) =>
      ipcRenderer.invoke(
        "project:git-merge",
        repoPath,
        sourceBranch,
        targetBranch,
      ),
    gitResolveConflicts: (repoPath, filePath, strategy) =>
      ipcRenderer.invoke(
        "project:git-resolve-conflicts",
        repoPath,
        filePath,
        strategy,
      ),
    gitGenerateCommitMessage: (repoPath) =>
      ipcRenderer.invoke("project:git-generate-commit-message", repoPath),

    // AI任务智能拆解系统
    decomposeTask: (userRequest, projectContext) =>
      ipcRenderer.invoke(
        "project:decompose-task",
        userRequest,
        removeUndefined(projectContext),
      ),
    executeTaskPlan: (taskPlanId, projectContext) =>
      ipcRenderer.invoke(
        "project:execute-task-plan",
        taskPlanId,
        removeUndefined(projectContext),
      ),
    getTaskPlan: (taskPlanId) =>
      ipcRenderer.invoke("project:get-task-plan", taskPlanId),
    getTaskPlanHistory: (projectId, limit) =>
      ipcRenderer.invoke("project:get-task-plan-history", projectId, limit),
    cancelTaskPlan: (taskPlanId) =>
      ipcRenderer.invoke("project:cancel-task-plan", taskPlanId),

    // 任务进度更新监听
    onTaskProgressUpdate: (callback) =>
      ipcRenderer.on("task:progress-update", (_event, progress) =>
        callback(progress),
      ),
    offTaskProgressUpdate: (callback) =>
      ipcRenderer.removeListener("task:progress-update", callback),

    // 任务执行事件监听
    onTaskExecute: (callback) =>
      ipcRenderer.on("project:task-execute", (_event, task) => callback(task)),
    offTaskExecute: (callback) =>
      ipcRenderer.removeListener("project:task-execute", callback),

    // 项目文件更新监听
    onFilesUpdated: (callback) =>
      ipcRenderer.on("project:files-updated", (_event, data) => callback(data)),
    offFilesUpdated: (callback) =>
      ipcRenderer.removeListener("project:files-updated", callback),

    // 文件同步事件监听（文件系统变化自动刷新）
    watchProject: (projectId, rootPath) =>
      ipcRenderer.invoke("file-sync:watch-project", projectId, rootPath),
    stopWatchProject: (projectId) =>
      ipcRenderer.invoke("file-sync:stop-watch", projectId),
    onFileReloaded: (callback) =>
      ipcRenderer.on("file-sync:reloaded", (_event, data) => callback(data)),
    offFileReloaded: (callback) =>
      ipcRenderer.removeListener("file-sync:reloaded", callback),
    onFileAdded: (callback) =>
      ipcRenderer.on("file-sync:file-added", (_event, data) => callback(data)),
    offFileAdded: (callback) =>
      ipcRenderer.removeListener("file-sync:file-added", callback),
    onFileDeleted: (callback) =>
      ipcRenderer.on("file-sync:file-deleted", (_event, data) =>
        callback(data),
      ),
    offFileDeleted: (callback) =>
      ipcRenderer.removeListener("file-sync:file-deleted", callback),
    onFileSyncConflict: (callback) =>
      ipcRenderer.on("file-sync:conflict", (_event, data) => callback(data)),
    offFileSyncConflict: (callback) =>
      ipcRenderer.removeListener("file-sync:conflict", callback),

    // 项目分享
    share: (projectId, shareMode, options) =>
      ipcRenderer.invoke(
        "project:share",
        projectId,
        shareMode,
        removeUndefined(options || {}),
      ),
    unshare: (projectId) => ipcRenderer.invoke("project:unshare", projectId),
    getByShareToken: (shareToken) =>
      ipcRenderer.invoke("project:get-by-share-token", shareToken),

    // 新增功能 - 项目分享和导出
    shareProject: (params) =>
      ipcRenderer.invoke("project:shareProject", removeUndefined(params)),
    getShare: (projectId) => ipcRenderer.invoke("project:getShare", projectId),
    deleteShare: (projectId) =>
      ipcRenderer.invoke("project:deleteShare", projectId),
    accessShare: (token) => ipcRenderer.invoke("project:accessShare", token),
    shareToWechat: (params) =>
      ipcRenderer.invoke("project:shareToWechat", removeUndefined(params)),
    exportDocument: (params) =>
      ipcRenderer.invoke("project:exportDocument", removeUndefined(params)),
    generatePPT: (params) =>
      ipcRenderer.invoke("project:generatePPT", removeUndefined(params)),
    exportPPT: (params) =>
      ipcRenderer.invoke("ppt:export", removeUndefined(params)),
    generatePodcastScript: (params) =>
      ipcRenderer.invoke(
        "project:generatePodcastScript",
        removeUndefined(params),
      ),
    generateArticleImages: (params) =>
      ipcRenderer.invoke(
        "project:generateArticleImages",
        removeUndefined(params),
      ),
    polishContent: (params) =>
      ipcRenderer.invoke("project:polishContent", removeUndefined(params)),
    expandContent: (params) =>
      ipcRenderer.invoke("project:expandContent", removeUndefined(params)),
    copyFile: (params) =>
      ipcRenderer.invoke("project:copyFile", removeUndefined(params)),

    // 文件导入导出功能
    exportFile: (params) =>
      ipcRenderer.invoke("project:export-file", removeUndefined(params)),
    exportFiles: (params) =>
      ipcRenderer.invoke("project:export-files", removeUndefined(params)),
    selectExportDirectory: () =>
      ipcRenderer.invoke("project:select-export-directory"),
    selectImportFiles: (options) =>
      ipcRenderer.invoke(
        "project:select-import-files",
        removeUndefined(options || {}),
      ),
    importFile: (params) =>
      ipcRenderer.invoke("project:import-file", removeUndefined(params)),
    importFiles: (params) =>
      ipcRenderer.invoke("project:import-files", removeUndefined(params)),

    // RAG增强功能
    indexFiles: (projectId, options) =>
      ipcRenderer.invoke(
        "project:indexFiles",
        projectId,
        removeUndefined(options || {}),
      ),
    ragQuery: (projectId, query, options) =>
      ipcRenderer.invoke(
        "project:ragQuery",
        projectId,
        query,
        removeUndefined(options || {}),
      ),
    updateFileIndex: (fileId) =>
      ipcRenderer.invoke("project:updateFileIndex", fileId),
    deleteIndex: (projectId) =>
      ipcRenderer.invoke("project:deleteIndex", projectId),
    getIndexStats: (projectId) =>
      ipcRenderer.invoke("project:getIndexStats", projectId),

    // 增强 RAG 功能 (v0.32.0)
    incrementalIndex: (projectId, options) =>
      ipcRenderer.invoke(
        "project:incrementalIndex",
        projectId,
        removeUndefined(options || {}),
      ),
    jointRetrieve: (projectId, query, options) =>
      ipcRenderer.invoke(
        "project:jointRetrieve",
        projectId,
        query,
        removeUndefined(options || {}),
      ),
    getFileRelations: (projectId, fileId) =>
      ipcRenderer.invoke("project:getFileRelations", projectId, fileId),
    unifiedRetrieve: (projectId, query, options) =>
      ipcRenderer.invoke(
        "project:unifiedRetrieve",
        projectId,
        query,
        removeUndefined(options || {}),
      ),
    updateRetrieveWeights: (weights) =>
      ipcRenderer.invoke(
        "project:updateRetrieveWeights",
        removeUndefined(weights),
      ),
    projectAwareRerank: (query, documents, context) =>
      ipcRenderer.invoke(
        "project:projectAwareRerank",
        query,
        documents,
        removeUndefined(context || {}),
      ),

    // 项目统计收集
    startStats: (projectId, projectPath) =>
      ipcRenderer.invoke("project:stats:start", projectId, projectPath),
    stopStats: (projectId) =>
      ipcRenderer.invoke("project:stats:stop", projectId),

    // 项目统计（嵌套对象，支持 project:stats:* 格式）
    stats: {
      start: (projectId, projectPath) =>
        ipcRenderer.invoke("project:stats:start", projectId, projectPath),
      stop: (projectId) => ipcRenderer.invoke("project:stats:stop", projectId),
      update: (projectId) =>
        ipcRenderer.invoke("project:stats:update", projectId),
      get: (projectId) => ipcRenderer.invoke("project:stats:get", projectId),
    },

    // 事件监听（修复版 - 保存包装函数引用以支持正确的off）
    on: (event, callback) => {
      const wrappedCallback = (_event, ...args) => callback(...args);
      // 保存包装函数的引用到callback对象上
      if (!callback._wrappedListeners) {
        callback._wrappedListeners = new Map();
      }
      callback._wrappedListeners.set(event, wrappedCallback);
      ipcRenderer.on(event, wrappedCallback);
    },
    off: (event, callback) => {
      // 使用保存的包装函数引用
      if (callback._wrappedListeners && callback._wrappedListeners.has(event)) {
        const wrappedCallback = callback._wrappedListeners.get(event);
        ipcRenderer.removeListener(event, wrappedCallback);
        callback._wrappedListeners.delete(event);
      } else {
        // 降级方案：尝试移除原始callback
        ipcRenderer.removeListener(event, callback);
      }
    },
  },

  // 文件操作
  file: {
    // 通用文件操作
    readContent: (filePath) => ipcRenderer.invoke("file:readContent", filePath),
    writeContent: (filePath, content) =>
      ipcRenderer.invoke("file:writeContent", filePath, content),
    readBinary: (filePath) => ipcRenderer.invoke("file:read-binary", filePath),
    saveAs: (filePath) => ipcRenderer.invoke("file:saveAs", filePath),
    exists: (filePath) => ipcRenderer.invoke("file:exists", filePath),
    stat: (filePath) => ipcRenderer.invoke("file:stat", filePath),

    // 文件/文件夹操作（右键菜单功能）
    revealInExplorer: (filePath) =>
      ipcRenderer.invoke("file:revealInExplorer", filePath),
    copyItem: (params) =>
      ipcRenderer.invoke("file:copyItem", removeUndefined(params)),
    moveItem: (params) =>
      ipcRenderer.invoke("file:moveItem", removeUndefined(params)),
    deleteItem: (params) =>
      ipcRenderer.invoke("file:deleteItem", removeUndefined(params)),
    renameItem: (params) =>
      ipcRenderer.invoke("file:renameItem", removeUndefined(params)),
    createFile: (params) =>
      ipcRenderer.invoke("file:createFile", removeUndefined(params)),
    createFolder: (params) =>
      ipcRenderer.invoke("file:createFolder", removeUndefined(params)),

    // 打开文件操作
    openWithDefault: (filePath) =>
      ipcRenderer.invoke("file:openWithDefault", filePath),
    openWith: (filePath) => ipcRenderer.invoke("file:openWith", filePath),
    openWithProgram: (params) =>
      ipcRenderer.invoke("file:openWithProgram", removeUndefined(params)),

    // Excel操作
    readExcel: (filePath) => ipcRenderer.invoke("file:readExcel", filePath),
    writeExcel: (filePath, data) =>
      ipcRenderer.invoke("file:writeExcel", filePath, data),
    excelToJSON: (filePath, options) =>
      ipcRenderer.invoke("file:excelToJSON", filePath, options || {}),
    jsonToExcel: (jsonData, filePath, options) =>
      ipcRenderer.invoke("file:jsonToExcel", jsonData, filePath, options || {}),

    // Word操作
    readWord: (filePath) => ipcRenderer.invoke("file:readWord", filePath),
    writeWord: (filePath, content) =>
      ipcRenderer.invoke("file:writeWord", filePath, content),
    markdownToWord: (markdown, outputPath, options) =>
      ipcRenderer.invoke(
        "file:markdownToWord",
        markdown,
        outputPath,
        options || {},
      ),
    wordToMarkdown: (filePath) =>
      ipcRenderer.invoke("file:wordToMarkdown", filePath),
    htmlToWord: (html, outputPath, options) =>
      ipcRenderer.invoke("file:htmlToWord", html, outputPath, options || {}),

    // PPT操作
    readPPT: (filePath) => ipcRenderer.invoke("file:readPPT", filePath),
    writePPT: (filePath, data) =>
      ipcRenderer.invoke("file:writePPT", filePath, data),
    markdownToPPT: (markdown, outputPath, options) =>
      ipcRenderer.invoke(
        "file:markdownToPPT",
        markdown,
        outputPath,
        options || {},
      ),
    createPPTTemplate: (templateType, outputPath) =>
      ipcRenderer.invoke("file:createPPTTemplate", templateType, outputPath),

    // Office文件预览
    previewOffice: (filePath, format) =>
      ipcRenderer.invoke("file:previewOffice", filePath, format),
  },

  // 压缩包操作
  archive: {
    list: (archivePath) => ipcRenderer.invoke("archive:list", archivePath),
    getInfo: (archivePath) =>
      ipcRenderer.invoke("archive:getInfo", archivePath),
    extract: (archivePath, filePath) =>
      ipcRenderer.invoke("archive:extract", archivePath, filePath),
    extractTo: (archivePath, filePath, outputPath) =>
      ipcRenderer.invoke(
        "archive:extractTo",
        archivePath,
        filePath,
        outputPath,
      ),
  },

  // 大文件操作
  largeFile: {
    getInfo: (filePath) => ipcRenderer.invoke("largeFile:getInfo", filePath),
    readLines: (filePath, startLine, lineCount) =>
      ipcRenderer.invoke("largeFile:readLines", filePath, startLine, lineCount),
    search: (filePath, query, options) =>
      ipcRenderer.invoke("largeFile:search", filePath, query, options || {}),
    getHead: (filePath, lineCount) =>
      ipcRenderer.invoke("largeFile:getHead", filePath, lineCount || 100),
    getTail: (filePath, lineCount) =>
      ipcRenderer.invoke("largeFile:getTail", filePath, lineCount || 100),
  },

  // AI引擎
  ai: {
    processInput: ({ input, context }) =>
      ipcRenderer.invoke("ai:processInput", { input, context }),
    getHistory: (limit) => ipcRenderer.invoke("ai:getHistory", limit),
    clearHistory: () => ipcRenderer.invoke("ai:clearHistory"),
    // 事件监听
    onStepUpdate: (callback) =>
      ipcRenderer.on("ai:stepUpdate", (_event, step) => callback(step)),
    offStepUpdate: (callback) =>
      ipcRenderer.removeListener("ai:stepUpdate", callback),
  },

  // AI引擎扩展功能
  aiEngine: {
    recognizeIntent: (userInput) =>
      ipcRenderer.invoke("aiEngine:recognizeIntent", userInput),
    generatePPT: (options) =>
      ipcRenderer.invoke("aiEngine:generatePPT", options),
    generateWord: (options) =>
      ipcRenderer.invoke("aiEngine:generateWord", options),
  },

  // 联网搜索
  webSearch: {
    search: (query, options) =>
      ipcRenderer.invoke("webSearch:search", query, options),
    duckduckgo: (query, options) =>
      ipcRenderer.invoke("webSearch:duckduckgo", query, options),
    bing: (query, options) =>
      ipcRenderer.invoke("webSearch:bing", query, options),
    format: (searchResult) =>
      ipcRenderer.invoke("webSearch:format", searchResult),
  },

  // 代码开发引擎
  code: {
    generate: (description, options) =>
      ipcRenderer.invoke(
        "code:generate",
        description,
        removeUndefined(options || {}),
      ),
    generateTests: (code, language) =>
      ipcRenderer.invoke("code:generateTests", code, language),
    review: (code, language) =>
      ipcRenderer.invoke("code:review", code, language),
    refactor: (code, language, refactoringType) =>
      ipcRenderer.invoke("code:refactor", code, language, refactoringType),
    explain: (code, language) =>
      ipcRenderer.invoke("code:explain", code, language),
    fixBug: (code, language, errorMessage) =>
      ipcRenderer.invoke("code:fixBug", code, language, errorMessage),
    generateScaffold: (projectType, options) =>
      ipcRenderer.invoke(
        "code:generateScaffold",
        projectType,
        removeUndefined(options || {}),
      ),
    executePython: (code, options) =>
      ipcRenderer.invoke(
        "code:executePython",
        code,
        removeUndefined(options || {}),
      ),
    executeFile: (filepath, options) =>
      ipcRenderer.invoke(
        "code:executeFile",
        filepath,
        removeUndefined(options || {}),
      ),
    checkSafety: (code) => ipcRenderer.invoke("code:checkSafety", code),
  },

  // 项目自动化规则
  automation: {
    createRule: (ruleData) =>
      ipcRenderer.invoke("automation:createRule", removeUndefined(ruleData)),
    getRules: (projectId) =>
      ipcRenderer.invoke("automation:getRules", projectId),
    getRule: (ruleId) => ipcRenderer.invoke("automation:getRule", ruleId),
    updateRule: (ruleId, updates) =>
      ipcRenderer.invoke(
        "automation:updateRule",
        ruleId,
        removeUndefined(updates),
      ),
    deleteRule: (ruleId) => ipcRenderer.invoke("automation:deleteRule", ruleId),
    manualTrigger: (ruleId) =>
      ipcRenderer.invoke("automation:manualTrigger", ruleId),
    loadProjectRules: (projectId) =>
      ipcRenderer.invoke("automation:loadProjectRules", projectId),
    stopRule: (ruleId) => ipcRenderer.invoke("automation:stopRule", ruleId),
    getStatistics: () => ipcRenderer.invoke("automation:getStatistics"),
  },

  // 协作实时编辑
  collaboration: {
    startServer: (options) =>
      ipcRenderer.invoke(
        "collaboration:startServer",
        removeUndefined(options || {}),
      ),
    stopServer: () => ipcRenderer.invoke("collaboration:stopServer"),
    joinDocument: (userId, userName, documentId) =>
      ipcRenderer.invoke(
        "collaboration:joinDocument",
        userId,
        userName,
        documentId,
      ),
    submitOperation: (documentId, userId, operation) =>
      ipcRenderer.invoke(
        "collaboration:submitOperation",
        documentId,
        userId,
        operation,
      ),
    getOnlineUsers: (documentId) =>
      ipcRenderer.invoke("collaboration:getOnlineUsers", documentId),
    getOperationHistory: (documentId, limit) =>
      ipcRenderer.invoke(
        "collaboration:getOperationHistory",
        documentId,
        limit,
      ),
    getSessionHistory: (documentId, limit) =>
      ipcRenderer.invoke("collaboration:getSessionHistory", documentId, limit),
    getStatus: () => ipcRenderer.invoke("collaboration:getStatus"),
  },

  // Shell操作
  shell: {
    openPath: (path) => ipcRenderer.invoke("shell:open-path", path),
    showItemInFolder: (path) =>
      ipcRenderer.invoke("shell:show-item-in-folder", path),
  },

  // Dialog 对话框
  dialog: {
    selectFolder: (options) =>
      ipcRenderer.invoke("dialog:select-folder", options),
    showOpenDialog: (options) =>
      ipcRenderer.invoke("dialog:showOpenDialog", options),
    showSaveDialog: (options) =>
      ipcRenderer.invoke("dialog:showSaveDialog", options),
    showMessageBox: (options) =>
      ipcRenderer.invoke("dialog:showMessageBox", options),
  },

  // 数据同步
  sync: {
    start: (deviceId) => ipcRenderer.invoke("sync:start", deviceId),
    resolveConflict: (conflictId, resolution) =>
      ipcRenderer.invoke("sync:resolve-conflict", conflictId, resolution),
    getStatus: () => ipcRenderer.invoke("sync:get-status"),
    incremental: () => ipcRenderer.invoke("sync:incremental"),
    // 监听同步事件
    onSyncStarted: (callback) =>
      ipcRenderer.on("sync:started", (_event, ...args) => callback(...args)),
    onSyncCompleted: (callback) =>
      ipcRenderer.on("sync:completed", (_event, ...args) => callback(...args)),
    onSyncError: (callback) =>
      ipcRenderer.on("sync:error", (_event, ...args) => callback(...args)),
    onShowConflicts: (callback) =>
      ipcRenderer.on("sync:show-conflicts", (_event, ...args) =>
        callback(...args),
      ),

    // Phase 3c — WebDAV 外部同步（命名空间隔离）
    webdav: {
      test: () => ipcRenderer.invoke("sync:webdav:test"),
      run: () => ipcRenderer.invoke("sync:webdav:run"),
      configGet: () => ipcRenderer.invoke("sync:webdav:config-get"),
      configSet: (payload) =>
        ipcRenderer.invoke("sync:webdav:config-set", payload),
      configClear: () => ipcRenderer.invoke("sync:webdav:config-clear"),
      // Phase 3c follow-up D7: 远端孤儿文件清理
      listOrphans: () => ipcRenderer.invoke("sync:webdav:list-orphans"),
      deleteOrphans: (orphans) =>
        ipcRenderer.invoke("sync:webdav:delete-orphans", { orphans }),
      // 进度订阅：返回 unsubscribe 函数
      onProgress: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on("sync:webdav:progress", handler);
        return () =>
          ipcRenderer.removeListener("sync:webdav:progress", handler);
      },
    },

    // Phase 3c.3 — S3 / OSS 外部同步（命名空间隔离）
    oss: {
      test: () => ipcRenderer.invoke("sync:oss:test"),
      run: () => ipcRenderer.invoke("sync:oss:run"),
      configGet: () => ipcRenderer.invoke("sync:oss:config-get"),
      configSet: (payload) =>
        ipcRenderer.invoke("sync:oss:config-set", payload),
      configClear: () => ipcRenderer.invoke("sync:oss:config-clear"),
      // Phase 3c follow-up D7: 远端孤儿对象清理
      listOrphans: () => ipcRenderer.invoke("sync:oss:list-orphans"),
      deleteOrphans: (orphans) =>
        ipcRenderer.invoke("sync:oss:delete-orphans", { orphans }),
      onProgress: (callback) => {
        const handler = (_event, payload) => callback(payload);
        ipcRenderer.on("sync:oss:progress", handler);
        return () => ipcRenderer.removeListener("sync:oss:progress", handler);
      },
    },

    // Phase 3d — Mobile (Android) 外部同步
    mobile: {
      run: (deviceId) => ipcRenderer.invoke("sync:mobile:run", deviceId),
      runAll: () => ipcRenderer.invoke("sync:mobile:run-all"),
      status: () => ipcRenderer.invoke("sync:mobile:status"),
      listPaired: () => ipcRenderer.invoke("sync:mobile:list-paired"),
      unpair: (deviceId) => ipcRenderer.invoke("sync:mobile:unpair", deviceId),
      // Phase 3d M4.5 manual pairing (v0)
      registerManual: (payload) =>
        ipcRenderer.invoke("sync:mobile:register-manual", payload),
    },
  },

  // M5 ADR-6 反向 sign.request — 桌面调手机 StrongBox 签名
  mobileSign: {
    /**
     * Debug 触发器: 让 DevTools console 一键调起 Android ApprovalDialog
     * + BiometricPrompt + Ed25519 签名，验证桌面→手机反向 RPC 端到端。
     *
     * 用法 (DevTools console):
     *   const devs = await electronAPI.sync.mobile.listPaired();
     *   const r = await electronAPI.mobileSign.debugTest(devs[0].deviceId);
     *   console.log(r);  // { ok: true, result: { did, signature, signedAt, requestId } }
     *
     * 错误结构: { ok: false, error: <message>, name: SignError|SignDeniedError|SignTimeoutError }
     */
    debugTest: (peerId) => ipcRenderer.invoke("mobile:sign:debug-test", peerId),
  },

  // 插件管理
  plugin: {
    // 插件查询
    getPlugins: (filters) => ipcRenderer.invoke("plugin:get-plugins", filters),
    getPlugin: (pluginId) => ipcRenderer.invoke("plugin:get-plugin", pluginId),

    // 插件生命周期
    install: (source, options) =>
      ipcRenderer.invoke("plugin:install", source, options),
    uninstall: (pluginId) => ipcRenderer.invoke("plugin:uninstall", pluginId),
    enable: (pluginId) => ipcRenderer.invoke("plugin:enable", pluginId),
    disable: (pluginId) => ipcRenderer.invoke("plugin:disable", pluginId),

    // 权限管理
    getPermissions: (pluginId) =>
      ipcRenderer.invoke("plugin:get-permissions", pluginId),
    updatePermission: (pluginId, permission, granted) =>
      ipcRenderer.invoke(
        "plugin:update-permission",
        pluginId,
        permission,
        granted,
      ),
    // 权限对话框响应
    respondToPermissionRequest: (requestId, response) =>
      ipcRenderer.invoke(
        "plugin:respond-to-permission-request",
        requestId,
        response,
      ),
    cancelPermissionRequest: (requestId) =>
      ipcRenderer.invoke("plugin:cancel-permission-request", requestId),
    getPermissionCategories: () =>
      ipcRenderer.invoke("plugin:get-permission-categories"),
    getRiskLevels: () => ipcRenderer.invoke("plugin:get-risk-levels"),
    getPermissionDetails: (permissions) =>
      ipcRenderer.invoke("plugin:get-permission-details", permissions),

    // UI 扩展点
    getUIExtensions: () => ipcRenderer.invoke("plugin:get-ui-extensions"),
    getSlotExtensions: (slotName) =>
      ipcRenderer.invoke("plugin:get-slot-extensions", slotName),

    // v6 Shell 扩展点
    getRegisteredSpaces: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-registered-spaces", pluginId),
    getRegisteredArtifacts: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-registered-artifacts", pluginId),
    getArtifactRenderer: (type) =>
      ipcRenderer.invoke("plugin:get-artifact-renderer", type),
    getSlashCommands: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-slash-commands", pluginId),
    getMentionSources: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-mention-sources", pluginId),
    getStatusBarWidgets: (options = {}) =>
      ipcRenderer.invoke("plugin:get-status-bar-widgets", options),
    getHomeWidgets: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-home-widgets", pluginId),
    getComposerSlots: (options = {}) =>
      ipcRenderer.invoke("plugin:get-composer-slots", options),

    // P3 企业品牌
    getActiveBrandTheme: () =>
      ipcRenderer.invoke("plugin:get-active-brand-theme"),
    getBrandThemes: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-brand-themes", pluginId),
    getActiveBrandIdentity: () =>
      ipcRenderer.invoke("plugin:get-active-brand-identity"),
    getBrandIdentities: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-brand-identities", pluginId),

    // P4 企业能力扩展
    getActiveLLMProvider: () =>
      ipcRenderer.invoke("plugin:get-active-llm-provider"),
    getLLMProviders: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-llm-providers", pluginId),
    getActiveAuthProvider: () =>
      ipcRenderer.invoke("plugin:get-active-auth-provider"),
    getAuthProviders: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-auth-providers", pluginId),
    getActiveDataStorage: () =>
      ipcRenderer.invoke("plugin:get-active-data-storage"),
    getDataStorages: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-data-storages", pluginId),
    getActiveDataCrypto: () =>
      ipcRenderer.invoke("plugin:get-active-data-crypto"),
    getDataCryptos: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-data-cryptos", pluginId),
    getActiveComplianceAudit: () =>
      ipcRenderer.invoke("plugin:get-active-compliance-audit"),
    getComplianceAudits: (pluginId = null) =>
      ipcRenderer.invoke("plugin:get-compliance-audits", pluginId),

    // 插件设置
    getSettingsDefinitions: (pluginId) =>
      ipcRenderer.invoke("plugin:get-settings-definitions", pluginId),
    getSettings: (pluginId) =>
      ipcRenderer.invoke("plugin:get-settings", pluginId),
    saveSettings: (pluginId, settings) =>
      ipcRenderer.invoke("plugin:save-settings", pluginId, settings),

    // 数据导入导出
    getDataImporters: () => ipcRenderer.invoke("plugin:get-data-importers"),
    getDataExporters: () => ipcRenderer.invoke("plugin:get-data-exporters"),
    executeImport: (importerId, options) =>
      ipcRenderer.invoke("plugin:execute-import", importerId, options),
    executeExport: (exporterId, options) =>
      ipcRenderer.invoke("plugin:execute-export", exporterId, options),

    // 扩展点
    triggerExtensionPoint: (name, context) =>
      ipcRenderer.invoke("plugin:trigger-extension-point", name, context),

    // 工具
    openPluginsDir: () => ipcRenderer.invoke("plugin:open-plugins-dir"),

    // 插件方法调用
    callPluginMethod: (pluginId, methodName, args = []) =>
      ipcRenderer.invoke("plugin:call-method", pluginId, methodName, args),

    // 获取插件页面内容
    getPluginPageContent: (pluginId, pageId = "main") =>
      ipcRenderer.invoke("plugin:get-page-content", pluginId, pageId),

    // 获取插件工具和技能
    getPluginTools: (pluginId) =>
      ipcRenderer.invoke("plugin:get-tools", pluginId),
    getPluginSkills: (pluginId) =>
      ipcRenderer.invoke("plugin:get-skills", pluginId),

    // 执行插件工具
    executePluginTool: (pluginId, toolId, params) =>
      ipcRenderer.invoke("plugin:execute-tool", pluginId, toolId, params),

    // 事件监听
    on: (event, callback) =>
      ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),
  },

  // Web IDE
  webIDE: {
    // 项目管理
    saveProject: (data) =>
      ipcRenderer.invoke("webide:saveProject", removeUndefined(data)),
    loadProject: (projectId) =>
      ipcRenderer.invoke("webide:loadProject", projectId),
    getProjectList: () => ipcRenderer.invoke("webide:getProjectList"),
    deleteProject: (projectId) =>
      ipcRenderer.invoke("webide:deleteProject", projectId),

    // 预览服务器
    startDevServer: (data) =>
      ipcRenderer.invoke("webide:startDevServer", removeUndefined(data)),
    stopDevServer: (port) => ipcRenderer.invoke("webide:stopDevServer", port),
    getServerStatus: () => ipcRenderer.invoke("webide:getServerStatus"),

    // 导出功能
    exportHTML: (data) =>
      ipcRenderer.invoke("webide:exportHTML", removeUndefined(data)),
    exportZIP: (data) =>
      ipcRenderer.invoke("webide:exportZIP", removeUndefined(data)),
    captureScreenshot: (options) =>
      ipcRenderer.invoke("webide:captureScreenshot", removeUndefined(options)),
  },

  // 语音识别系统
  speech: {
    // 音频文件转录
    transcribeFile: (filePath, options) =>
      ipcRenderer.invoke("speech:transcribe-file", filePath, options),
    transcribeBatch: (filePaths, options) =>
      ipcRenderer.invoke("speech:transcribe-batch", filePaths, options),

    // 文件选择
    selectAudioFiles: () => ipcRenderer.invoke("speech:select-audio-files"),

    // 配置管理
    getConfig: () => ipcRenderer.invoke("speech:get-config"),
    updateConfig: (config) =>
      ipcRenderer.invoke("speech:update-config", config),
    setEngine: (engineType) =>
      ipcRenderer.invoke("speech:set-engine", engineType),
    getAvailableEngines: () =>
      ipcRenderer.invoke("speech:get-available-engines"),

    // 历史记录
    getHistory: (limit, offset) =>
      ipcRenderer.invoke("speech:get-history", limit, offset),
    deleteHistory: (id) => ipcRenderer.invoke("speech:delete-history", id),
    searchHistory: (query, options) =>
      ipcRenderer.invoke("speech:search-history", query, options),

    // 音频文件管理
    getAudioFile: (id) => ipcRenderer.invoke("speech:get-audio-file", id),
    listAudioFiles: (options) =>
      ipcRenderer.invoke("speech:list-audio-files", options),
    searchAudioFiles: (query, options) =>
      ipcRenderer.invoke("speech:search-audio-files", query, options),
    deleteAudioFile: (id) => ipcRenderer.invoke("speech:delete-audio-file", id),

    // 统计信息
    getStats: (userId) => ipcRenderer.invoke("speech:get-stats", userId),

    // 音频降噪和增强
    denoiseAudio: (inputPath, outputPath, options) =>
      ipcRenderer.invoke(
        "speech:denoise-audio",
        inputPath,
        outputPath,
        options,
      ),
    enhanceAudio: (inputPath, outputPath, options) =>
      ipcRenderer.invoke(
        "speech:enhance-audio",
        inputPath,
        outputPath,
        options,
      ),
    enhanceForRecognition: (inputPath, outputPath) =>
      ipcRenderer.invoke(
        "speech:enhance-for-recognition",
        inputPath,
        outputPath,
      ),

    // 语言检测
    detectLanguage: (audioPath) =>
      ipcRenderer.invoke("speech:detect-language", audioPath),
    detectLanguages: (audioPaths) =>
      ipcRenderer.invoke("speech:detect-languages", audioPaths),

    // 字幕生成
    generateSubtitle: (audioId, outputPath, format) =>
      ipcRenderer.invoke(
        "speech:generate-subtitle",
        audioId,
        outputPath,
        format,
      ),
    transcribeAndGenerateSubtitle: (audioPath, subtitlePath, options) =>
      ipcRenderer.invoke(
        "speech:transcribe-and-generate-subtitle",
        audioPath,
        subtitlePath,
        options,
      ),
    batchGenerateSubtitles: (audioIds, outputDir, format) =>
      ipcRenderer.invoke(
        "speech:batch-generate-subtitles",
        audioIds,
        outputDir,
        format,
      ),

    // 实时语音输入
    startRealtimeRecording: (options) =>
      ipcRenderer.invoke("speech:start-realtime-recording", options),
    sendAudioData: (audioData) =>
      ipcRenderer.invoke("speech:add-realtime-audio-data", audioData), // 别名
    addRealtimeAudioData: (audioData) =>
      ipcRenderer.invoke("speech:add-realtime-audio-data", audioData),
    pauseRealtimeRecording: () =>
      ipcRenderer.invoke("speech:pause-realtime-recording"),
    resumeRealtimeRecording: () =>
      ipcRenderer.invoke("speech:resume-realtime-recording"),
    stopRealtimeRecording: () =>
      ipcRenderer.invoke("speech:stop-realtime-recording"),
    cancelRealtimeRecording: () =>
      ipcRenderer.invoke("speech:cancel-realtime-recording"),
    getRealtimeStatus: () => ipcRenderer.invoke("speech:get-realtime-status"),

    // 语音命令
    recognizeCommand: (text, context) =>
      ipcRenderer.invoke("speech:recognize-command", text, context),
    registerCommand: (command) =>
      ipcRenderer.invoke("speech:register-command", command),
    getAllCommands: () => ipcRenderer.invoke("speech:get-all-commands"),
    getAvailableCommands: () => ipcRenderer.invoke("speech:get-all-commands"), // 别名

    // 音频缓存
    getCacheStats: () => ipcRenderer.invoke("speech:get-cache-stats"),
    clearCache: () => ipcRenderer.invoke("speech:clear-cache"),

    // 事件监听
    on: (event, callback) =>
      ipcRenderer.on(event, (_event, ...args) => callback(...args)),
    off: (event, callback) => ipcRenderer.removeListener(event, callback),

    // 实时语音输入事件 (原始命名)
    onRealtimeStarted: (callback) =>
      ipcRenderer.on("speech:realtime-started", (_event, data) =>
        callback(data),
      ),
    onRealtimeStopped: (callback) =>
      ipcRenderer.on("speech:realtime-stopped", (_event, data) =>
        callback(data),
      ),
    onRealtimePaused: (callback) =>
      ipcRenderer.on("speech:realtime-paused", (_event, data) =>
        callback(data),
      ),
    onRealtimeResumed: (callback) =>
      ipcRenderer.on("speech:realtime-resumed", (_event, data) =>
        callback(data),
      ),
    onRealtimeCancelled: (callback) =>
      ipcRenderer.on("speech:realtime-cancelled", (_event, data) =>
        callback(data),
      ),
    onRealtimeVolume: (callback) =>
      ipcRenderer.on("speech:realtime-volume", (_event, data) =>
        callback(data),
      ),
    onRealtimePartial: (callback) =>
      ipcRenderer.on("speech:realtime-partial", (_event, data) =>
        callback(data),
      ),
    onRealtimeCommand: (callback) =>
      ipcRenderer.on("speech:realtime-command", (_event, command) =>
        callback(command),
      ),

    // 实时语音输入事件 (别名 - 更直观的命名)
    onTranscriptPartial: (callback) =>
      ipcRenderer.on("speech:realtime-partial", (_event, data) =>
        callback(data),
      ),
    onVolumeChange: (callback) =>
      ipcRenderer.on("speech:realtime-volume", (_event, data) =>
        callback(data),
      ),
    onCommandRecognized: (callback) =>
      ipcRenderer.on("speech:realtime-command", (_event, command) =>
        callback(command),
      ),

    // 快捷键事件
    onShortcutTriggered: (callback) =>
      ipcRenderer.on("shortcut:voice-input", () => callback()),
  },

  // 技能管理
  skill: {
    // 技能查询
    getAll: (options) => ipcRenderer.invoke("skill:get-all", options),
    getById: (skillId) => ipcRenderer.invoke("skill:get-by-id", skillId),
    getByCategory: (category) =>
      ipcRenderer.invoke("skill:get-by-category", category),

    // 技能操作
    enable: (skillId) => ipcRenderer.invoke("skill:enable", skillId),
    disable: (skillId) => ipcRenderer.invoke("skill:disable", skillId),
    update: (skillId, updates) =>
      ipcRenderer.invoke("skill:update", skillId, updates),
    updateConfig: (skillId, config) =>
      ipcRenderer.invoke("skill:update-config", skillId, config),

    // 技能统计
    getStats: (skillId, dateRange) =>
      ipcRenderer.invoke("skill:get-stats", skillId, dateRange),

    // 技能工具关系
    getTools: (skillId) => ipcRenderer.invoke("skill:get-tools", skillId),
    addTool: (skillId, toolId, role) =>
      ipcRenderer.invoke("skill:add-tool", skillId, toolId, role),
    removeTool: (skillId, toolId) =>
      ipcRenderer.invoke("skill:remove-tool", skillId, toolId),

    // 技能文档
    getDoc: (skillId) => ipcRenderer.invoke("skill:get-doc", skillId),

    // 智能推荐
    recommend: (userInput, options) =>
      ipcRenderer.invoke("skill:recommend", userInput, options),
    getPopular: (limit) => ipcRenderer.invoke("skill:get-popular", limit),
    getRelated: (skillId, limit) =>
      ipcRenderer.invoke("skill:get-related", skillId, limit),
    search: (query, options) =>
      ipcRenderer.invoke("skill:search", query, options),
  },

  // 工具管理
  tool: {
    // 工具查询
    getAll: (options) => ipcRenderer.invoke("tool:get-all", options),
    getById: (toolId) => ipcRenderer.invoke("tool:get-by-id", toolId),
    getByCategory: (category) =>
      ipcRenderer.invoke("tool:get-by-category", category),
    getBySkill: (skillId) => ipcRenderer.invoke("tool:get-by-skill", skillId),

    // 工具操作
    enable: (toolId) => ipcRenderer.invoke("tool:enable", toolId),
    disable: (toolId) => ipcRenderer.invoke("tool:disable", toolId),
    update: (toolId, updates) =>
      ipcRenderer.invoke("tool:update", toolId, updates),
    updateConfig: (toolId, config) =>
      ipcRenderer.invoke("tool:update-config", toolId, config),
    updateSchema: (toolId, schema) =>
      ipcRenderer.invoke("tool:update-schema", toolId, schema),

    // 工具测试
    test: (toolId, params) => ipcRenderer.invoke("tool:test", toolId, params),

    // 工具统计
    getStats: (toolId, dateRange) =>
      ipcRenderer.invoke("tool:get-stats", toolId, dateRange),

    // 工具文档
    getDoc: (toolId) => ipcRenderer.invoke("tool:get-doc", toolId),

    // Additional Tools V3 统计仪表板
    getAdditionalV3Dashboard: (filters) =>
      ipcRenderer.invoke("tool:get-additional-v3-dashboard", filters),
    getAdditionalV3Overview: () =>
      ipcRenderer.invoke("tool:get-additional-v3-overview"),
    getAdditionalV3Rankings: (limit) =>
      ipcRenderer.invoke("tool:get-additional-v3-rankings", limit),
    getAdditionalV3CategoryStats: () =>
      ipcRenderer.invoke("tool:get-additional-v3-category-stats"),
    getAdditionalV3Recent: (limit) =>
      ipcRenderer.invoke("tool:get-additional-v3-recent", limit),
    getAdditionalV3DailyStats: (days) =>
      ipcRenderer.invoke("tool:get-additional-v3-daily-stats", days),
    getAdditionalV3Performance: () =>
      ipcRenderer.invoke("tool:get-additional-v3-performance"),
  },

  // 插件市场 (Plugin Marketplace)
  pluginMarketplace: {
    // 浏览和搜索
    list: (options) => ipcRenderer.invoke("plugin-marketplace:list", options),
    get: (pluginId) => ipcRenderer.invoke("plugin-marketplace:get", pluginId),
    search: (query, options) =>
      ipcRenderer.invoke("plugin-marketplace:search", query, options),
    featured: (limit) =>
      ipcRenderer.invoke("plugin-marketplace:featured", limit),
    categories: () => ipcRenderer.invoke("plugin-marketplace:categories"),

    // 安装和下载
    install: (pluginId, version) =>
      ipcRenderer.invoke("plugin-marketplace:install", pluginId, version),
    download: (pluginId, version, savePath) =>
      ipcRenderer.invoke(
        "plugin-marketplace:download",
        pluginId,
        version,
        savePath,
      ),

    // 评分和评论
    rate: (pluginId, rating, comment) =>
      ipcRenderer.invoke("plugin-marketplace:rate", pluginId, rating, comment),
    reviews: (pluginId, page, pageSize) =>
      ipcRenderer.invoke(
        "plugin-marketplace:reviews",
        pluginId,
        page,
        pageSize,
      ),
    report: (pluginId, reason, description) =>
      ipcRenderer.invoke(
        "plugin-marketplace:report",
        pluginId,
        reason,
        description,
      ),

    // 插件更新
    checkUpdates: (force) =>
      ipcRenderer.invoke("plugin-marketplace:check-updates", force),
    updatePlugin: (pluginId, version) =>
      ipcRenderer.invoke("plugin-marketplace:update-plugin", pluginId, version),
    updateAll: () => ipcRenderer.invoke("plugin-marketplace:update-all"),
    availableUpdates: () =>
      ipcRenderer.invoke("plugin-marketplace:available-updates"),
    setAutoUpdate: (enabled) =>
      ipcRenderer.invoke("plugin-marketplace:set-auto-update", enabled),

    // 插件发布（开发者功能）
    publish: (pluginData, pluginFilePath) =>
      ipcRenderer.invoke(
        "plugin-marketplace:publish",
        pluginData,
        pluginFilePath,
      ),
    updatePublished: (pluginId, version, pluginFilePath, changelog) =>
      ipcRenderer.invoke(
        "plugin-marketplace:update-published",
        pluginId,
        version,
        pluginFilePath,
        changelog,
      ),
    stats: (pluginId) =>
      ipcRenderer.invoke("plugin-marketplace:stats", pluginId),

    // 缓存管理
    clearCache: () => ipcRenderer.invoke("plugin-marketplace:clear-cache"),

    // 事件监听
    onUpdatesAvailable: (callback) =>
      ipcRenderer.on(
        "plugin-marketplace:updates-available",
        (_event, updates) => callback(updates),
      ),
    onUpdateComplete: (callback) =>
      ipcRenderer.on("plugin-marketplace:update-complete", (_event, pluginId) =>
        callback(pluginId),
      ),
    onUpdateError: (callback) =>
      ipcRenderer.on("plugin-marketplace:update-error", (_event, data) =>
        callback(data),
      ),
  },

  // 文档处理 (Document)
  document: {
    exportPPT: (params) => ipcRenderer.invoke("ppt:export", params),
  },

  // PDF处理
  pdf: {
    markdownToPDF: (params) => ipcRenderer.invoke("pdf:markdownToPDF", params),
    htmlFileToPDF: (params) => ipcRenderer.invoke("pdf:htmlFileToPDF", params),
    textFileToPDF: (params) => ipcRenderer.invoke("pdf:textFileToPDF", params),
    batchConvert: (params) => ipcRenderer.invoke("pdf:batchConvert", params),
  },

  // 社交功能 (Social)
  social: {
    // 联系人管理
    addContact: (contact) => ipcRenderer.invoke("contact:add", contact),
    addContactFromQR: (qrData) =>
      ipcRenderer.invoke("contact:add-from-qr", qrData),
    getAllContacts: () => ipcRenderer.invoke("contact:get-all"),
    getContact: (did) => ipcRenderer.invoke("contact:get", did),
    getContacts: (_options) => ipcRenderer.invoke("contact:get-all"), // 别名，兼容测试
    updateContact: (did, updates) =>
      ipcRenderer.invoke("contact:update", did, updates),
    deleteContact: (did) => ipcRenderer.invoke("contact:delete", did),
    searchContacts: (query) => ipcRenderer.invoke("contact:search", query),
    getFriends: () => ipcRenderer.invoke("contact:get-friends"),
    getContactStatistics: () => ipcRenderer.invoke("contact:get-statistics"),
    // 好友管理
    sendFriendRequest: (targetDid, message) =>
      ipcRenderer.invoke("friend:send-request", targetDid, message),
    acceptFriendRequest: (requestId) =>
      ipcRenderer.invoke("friend:accept-request", requestId),
    rejectFriendRequest: (requestId) =>
      ipcRenderer.invoke("friend:reject-request", requestId),
    getPendingFriendRequests: () =>
      ipcRenderer.invoke("friend:get-pending-requests"),
    getFriendsByGroup: (groupName) =>
      ipcRenderer.invoke("friend:get-friends", groupName),
    removeFriend: (friendDid) => ipcRenderer.invoke("friend:remove", friendDid),
    updateFriendNickname: (friendDid, nickname) =>
      ipcRenderer.invoke("friend:update-nickname", friendDid, nickname),
    updateFriendGroup: (friendDid, groupName) =>
      ipcRenderer.invoke("friend:update-group", friendDid, groupName),
    getFriendStatistics: () => ipcRenderer.invoke("friend:get-statistics"),
    // 动态/帖子管理
    createPost: (options) => ipcRenderer.invoke("post:create", options),
    getFeed: (options) => ipcRenderer.invoke("post:get-feed", options),
  },

  // 通知系统 (Notification)
  notification: {
    markRead: (id) => ipcRenderer.invoke("notification:mark-read", id),
    markAllRead: () => ipcRenderer.invoke("notification:mark-all-read"),
    getAll: (options) => ipcRenderer.invoke("notification:get-all", options),
    getUnreadCount: () => ipcRenderer.invoke("notification:get-unread-count"),
    sendDesktop: (title, body) =>
      ipcRenderer.invoke("notification:send-desktop", title, body),
  },

  // 系统信息 (System)
  system: {
    getSystemInfo: () => ipcRenderer.invoke("system:get-system-info"),
    getAppInfo: () => ipcRenderer.invoke("system:get-app-info"),
    // 降级注册可见告警：查询当前以降级模式注册的子系统清单
    getDegradedSubsystems: () =>
      ipcRenderer.invoke("system:get-degraded-subsystems"),
    // 订阅启动后广播的降级清单（UI 可据此弹横幅/通知）。返回取消订阅函数。
    onDegradedSubsystems: (callback) => {
      const listener = (_event, list) => callback(list);
      ipcRenderer.on("system:degraded-subsystems", listener);
      return () =>
        ipcRenderer.removeListener("system:degraded-subsystems", listener);
    },
    getPlatform: () => ipcRenderer.invoke("system:get-platform"),
    getVersion: () => ipcRenderer.invoke("system:get-version"),
    getPath: (name) => ipcRenderer.invoke("system:get-path", name),
    openExternal: (url) => ipcRenderer.invoke("system:open-external", url),
    showItemInFolder: (path) =>
      ipcRenderer.invoke("system:show-item-in-folder", path),
    selectDirectory: () => ipcRenderer.invoke("system:select-directory"),
    selectFile: (options) => ipcRenderer.invoke("system:select-file", options),
    quit: () => ipcRenderer.invoke("system:quit"),
    restart: () => ipcRenderer.invoke("system:restart"),
    getWindowState: () => ipcRenderer.invoke("system:get-window-state"),
    maximize: () => ipcRenderer.invoke("system:maximize"),
    minimize: () => ipcRenderer.invoke("system:minimize"),
    close: () => ipcRenderer.invoke("system:close"),
    setAlwaysOnTop: (flag) =>
      ipcRenderer.invoke("system:set-always-on-top", flag),
  },

  // 应用自动更新 — main/system/auto-updater.js electron-updater 封装。
  // status 字段是 dot-case 枚举：
  //   idle | checking | available | not-available | downloading
  //   | downloaded | error
  // downloading 时 data 是 progress object（percent / bytesPerSecond /
  // transferred / total），其余状态为 null。available / downloaded 在 info
  // 里带 {version, releaseDate, releaseNotes}；error 带 {message}。
  appUpdate: {
    check: () => ipcRenderer.invoke("app-update:check"),
    download: () => ipcRenderer.invoke("app-update:download"),
    install: () => ipcRenderer.invoke("app-update:install"),
    getStatus: () => ipcRenderer.invoke("app-update:get-status"),
    onStatus: (callback) => {
      const listener = (_event, payload) => callback(payload);
      ipcRenderer.on("update-status", listener);
      return () => ipcRenderer.removeListener("update-status", listener);
    },
  },

  // 后续输入意图分类器 (Follow-up Intent Classifier)
  followupIntent: {
    /**
     * 分类单个用户输入
     * @param {Object} params - 参数对象
     * @param {string} params.input - 用户输入
     * @param {Object} params.context - 上下文信息
     * @returns {Promise<Object>} 分类结果
     */
    classify: ({ input, context }) =>
      ipcRenderer.invoke("followup-intent:classify", { input, context }),

    /**
     * 批量分类多个输入
     * @param {Object} params - 参数对象
     * @param {Array<string>} params.inputs - 用户输入数组
     * @param {Object} params.context - 共享的上下文信息
     * @returns {Promise<Object>} 批量分类结果
     */
    classifyBatch: ({ inputs, context }) =>
      ipcRenderer.invoke("followup-intent:classify-batch", { inputs, context }),

    /**
     * 获取分类器统计信息
     * @returns {Promise<Object>} 统计信息
     */
    getStats: () => ipcRenderer.invoke("followup-intent:get-stats"),
  },

  // 技能工具系统通用
  skillTool: {
    // 依赖关系
    getDependencyGraph: () =>
      ipcRenderer.invoke("skill-tool:get-dependency-graph"),
    getAllRelations: () => ipcRenderer.invoke("skill-tool:get-all-relations"),

    // 使用分析
    getUsageAnalytics: (dateRange) =>
      ipcRenderer.invoke("skill-tool:get-usage-analytics", dateRange),
    getCategoryStats: () => ipcRenderer.invoke("skill-tool:get-category-stats"),
  },

  // MCP (Model Context Protocol) 服务器管理
  mcp: {
    // 服务器管理
    listServers: () => ipcRenderer.invoke("mcp:list-servers"),
    getConnectedServers: () => ipcRenderer.invoke("mcp:get-connected-servers"),
    connectServer: (serverName, config) =>
      ipcRenderer.invoke("mcp:connect-server", { serverName, config }),
    disconnectServer: (serverName) =>
      ipcRenderer.invoke("mcp:disconnect-server", { serverName }),

    // 工具管理
    listTools: (serverName) =>
      ipcRenderer.invoke("mcp:list-tools", { serverName }),
    callTool: (serverName, toolName, args) =>
      ipcRenderer.invoke("mcp:call-tool", {
        serverName,
        toolName,
        arguments: args,
      }),

    // 资源管理
    listResources: (serverName) =>
      ipcRenderer.invoke("mcp:list-resources", { serverName }),
    readResource: (serverName, resourceUri) =>
      ipcRenderer.invoke("mcp:read-resource", { serverName, resourceUri }),

    // 性能监控
    getMetrics: () => ipcRenderer.invoke("mcp:get-metrics"),

    // 配置管理
    getConfig: () => ipcRenderer.invoke("mcp:get-config"),
    updateConfig: (config) =>
      ipcRenderer.invoke("mcp:update-config", { config }),
    getServerConfig: (serverName) =>
      ipcRenderer.invoke("mcp:get-server-config", { serverName }),
    updateServerConfig: (serverName, config) =>
      ipcRenderer.invoke("mcp:update-server-config", { serverName, config }),

    // 安全与同意
    consentResponse: (requestId, decision) =>
      ipcRenderer.invoke("mcp:consent-response", { requestId, decision }),
    getPendingConsents: () => ipcRenderer.invoke("mcp:get-pending-consents"),
    cancelConsent: (requestId) =>
      ipcRenderer.invoke("mcp:cancel-consent", { requestId }),
    clearConsentCache: () => ipcRenderer.invoke("mcp:clear-consent-cache"),

    // 安全统计
    getSecurityStats: () => ipcRenderer.invoke("mcp:get-security-stats"),
    getAuditLog: (filters) =>
      ipcRenderer.invoke("mcp:get-audit-log", filters || {}),

    // 事件监听
    onConsentRequest: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("mcp:consent-request", handler);
      return () => ipcRenderer.removeListener("mcp:consent-request", handler);
    },
    onServerConnected: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("mcp:server-connected", handler);
      return () => ipcRenderer.removeListener("mcp:server-connected", handler);
    },
    onServerDisconnected: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("mcp:server-disconnected", handler);
      return () =>
        ipcRenderer.removeListener("mcp:server-disconnected", handler);
    },
    onServerError: (callback) => {
      const handler = (_event, data) => callback(data);
      ipcRenderer.on("mcp:server-error", handler);
      return () => ipcRenderer.removeListener("mcp:server-error", handler);
    },
  },

  // 安全配置存储 (API Keys 加密存储)
  secureStorage: {
    // 存储信息
    getInfo: () => ipcRenderer.invoke("secure-storage:get-info"),

    // 基本操作
    save: (config) => ipcRenderer.invoke("secure-storage:save", config),
    load: () => ipcRenderer.invoke("secure-storage:load"),
    exists: () => ipcRenderer.invoke("secure-storage:exists"),
    delete: () => ipcRenderer.invoke("secure-storage:delete"),

    // API Key 验证
    validateApiKey: (provider, apiKey) =>
      ipcRenderer.invoke("secure-storage:validate-api-key", {
        provider,
        apiKey,
      }),

    // 备份和恢复
    createBackup: () => ipcRenderer.invoke("secure-storage:create-backup"),
    listBackups: () => ipcRenderer.invoke("secure-storage:list-backups"),
    restoreBackup: (backupPath) =>
      ipcRenderer.invoke("secure-storage:restore-backup", backupPath),

    // 导出和导入（需要密码）
    export: (password) =>
      ipcRenderer.invoke("secure-storage:export", { password }),
    import: (password) =>
      ipcRenderer.invoke("secure-storage:import", { password }),

    // 安全迁移
    migrateToSafeStorage: () =>
      ipcRenderer.invoke("secure-storage:migrate-to-safe-storage"),

    // 缓存管理
    clearCache: () => ipcRenderer.invoke("secure-storage:clear-cache"),

    // 敏感字段信息
    getSensitiveFields: () =>
      ipcRenderer.invoke("secure-storage:get-sensitive-fields"),
    getProviderFields: (provider) =>
      ipcRenderer.invoke("secure-storage:get-provider-fields", provider),
    isSensitive: (fieldPath) =>
      ipcRenderer.invoke("secure-storage:is-sensitive", fieldPath),
    sanitize: (config) => ipcRenderer.invoke("secure-storage:sanitize", config),

    // 单个 API Key 操作
    setApiKey: (provider, key, value) =>
      ipcRenderer.invoke("secure-storage:set-api-key", {
        provider,
        key,
        value,
      }),
    getApiKeyMasked: (provider, key) =>
      ipcRenderer.invoke("secure-storage:get-api-key-masked", {
        provider,
        key,
      }),
    deleteApiKey: (provider, key) =>
      ipcRenderer.invoke("secure-storage:delete-api-key", { provider, key }),
    hasApiKey: (provider) =>
      ipcRenderer.invoke("secure-storage:has-api-key", provider),

    // 批量操作
    batchSetApiKeys: (apiKeys) =>
      ipcRenderer.invoke("secure-storage:batch-set-api-keys", apiKeys),
    getConfiguredProviders: () =>
      ipcRenderer.invoke("secure-storage:get-configured-providers"),
  },

  // ==========================================
  // Manus 优化 API (Context Engineering + Tool Masking + Multi-Agent)
  // ==========================================
  manus: {
    // 任务追踪
    startTask: (task) => ipcRenderer.invoke("manus:start-task", task),
    updateProgress: (data) => ipcRenderer.invoke("manus:update-progress", data),
    completeStep: () => ipcRenderer.invoke("manus:complete-step"),
    completeTask: () => ipcRenderer.invoke("manus:complete-task"),
    cancelTask: () => ipcRenderer.invoke("manus:cancel-task"),
    getCurrentTask: () => ipcRenderer.invoke("manus:get-current-task"),

    // 工具掩码控制
    setToolAvailable: (data) =>
      ipcRenderer.invoke("manus:set-tool-available", data),
    setToolsByPrefix: (data) =>
      ipcRenderer.invoke("manus:set-tools-by-prefix", data),
    validateToolCall: (data) =>
      ipcRenderer.invoke("manus:validate-tool-call", data),
    getAvailableTools: () => ipcRenderer.invoke("manus:get-available-tools"),

    // 阶段状态机
    configurePhases: (config) =>
      ipcRenderer.invoke("manus:configure-phases", config),
    transitionToPhase: (data) =>
      ipcRenderer.invoke("manus:transition-to-phase", data),
    getCurrentPhase: () => ipcRenderer.invoke("manus:get-current-phase"),

    // 错误记录
    recordError: (error) => ipcRenderer.invoke("manus:record-error", error),
    resolveError: (data) => ipcRenderer.invoke("manus:resolve-error", data),

    // 统计和调试
    getStats: () => ipcRenderer.invoke("manus:get-stats"),
    resetStats: () => ipcRenderer.invoke("manus:reset-stats"),
    exportDebugInfo: () => ipcRenderer.invoke("manus:export-debug-info"),

    // Prompt 优化
    buildOptimizedPrompt: (options) =>
      ipcRenderer.invoke("manus:build-optimized-prompt", options),
    compressContent: (data) =>
      ipcRenderer.invoke("manus:compress-content", data),
  },

  // ==========================================
  // TaskTracker API (todo.md 机制)
  // ==========================================
  taskTracker: {
    // 任务生命周期
    create: (plan) => ipcRenderer.invoke("task-tracker:create", plan),
    start: () => ipcRenderer.invoke("task-tracker:start"),
    updateProgress: (stepIndex, status, result) =>
      ipcRenderer.invoke("task-tracker:update-progress", {
        stepIndex,
        status,
        result,
      }),
    completeStep: (result) =>
      ipcRenderer.invoke("task-tracker:complete-step", result),
    complete: (result) => ipcRenderer.invoke("task-tracker:complete", result),
    cancel: (reason) => ipcRenderer.invoke("task-tracker:cancel", reason),
    recordError: (stepIndex, error) =>
      ipcRenderer.invoke("task-tracker:record-error", { stepIndex, error }),

    // 任务查询
    getCurrent: () => ipcRenderer.invoke("task-tracker:get-current"),
    hasActive: () => ipcRenderer.invoke("task-tracker:has-active"),
    getTodoContext: () => ipcRenderer.invoke("task-tracker:get-todo-context"),
    getPromptContext: () =>
      ipcRenderer.invoke("task-tracker:get-prompt-context"),

    // 中间结果
    saveResult: (stepIndex, result) =>
      ipcRenderer.invoke("task-tracker:save-result", { stepIndex, result }),
    loadResult: (stepIndex) =>
      ipcRenderer.invoke("task-tracker:load-result", { stepIndex }),

    // 任务恢复
    loadUnfinished: () => ipcRenderer.invoke("task-tracker:load-unfinished"),
    getHistory: (limit = 10) =>
      ipcRenderer.invoke("task-tracker:get-history", { limit }),
  },

  // ==========================================
  // Multi-Agent API (多 Agent 协作系统)
  // ==========================================
  multiAgent: {
    // Agent 管理
    list: () => ipcRenderer.invoke("agent:list"),
    get: (agentId) => ipcRenderer.invoke("agent:get", { agentId }),

    // 任务执行
    dispatch: (task) => ipcRenderer.invoke("agent:dispatch", task),
    executeParallel: (tasks, options = {}) =>
      ipcRenderer.invoke("agent:execute-parallel", { tasks, options }),
    executeChain: (tasks) =>
      ipcRenderer.invoke("agent:execute-chain", { tasks }),
    getCapable: (task) => ipcRenderer.invoke("agent:get-capable", task),

    // Agent 间通信
    sendMessage: (fromAgent, toAgent, message) =>
      ipcRenderer.invoke("agent:send-message", { fromAgent, toAgent, message }),
    broadcast: (fromAgent, message) =>
      ipcRenderer.invoke("agent:broadcast", { fromAgent, message }),
    getMessages: (agentId = null, limit = 50) =>
      ipcRenderer.invoke("agent:get-messages", { agentId, limit }),

    // 统计和调试
    getStats: () => ipcRenderer.invoke("agent:get-stats"),
    getHistory: (limit = 20) =>
      ipcRenderer.invoke("agent:get-history", { limit }),
    resetStats: () => ipcRenderer.invoke("agent:reset-stats"),
    exportDebug: () => ipcRenderer.invoke("agent:export-debug"),
  },

  // ==========================================
  // 通用 IPC invoke 方法
  // 用于调用任意 IPC 通道（如 session:*, error:* 等）
  // ==========================================
  invoke: fixedInvoke,

  // ==========================================
  // session-core (Managed Agents parity Phase H)
  // Shared file-backed singletons with CLI under ~/.chainlesschain/
  // ==========================================
  sessionCore: {
    policy: {
      get: (sessionId) =>
        ipcRenderer.invoke("session-core:policy:get", sessionId),
      set: (sessionId, policy) =>
        ipcRenderer.invoke("session-core:policy:set", sessionId, policy),
      clear: (sessionId) =>
        ipcRenderer.invoke("session-core:policy:clear", sessionId),
    },
    session: {
      list: (filter) => ipcRenderer.invoke("session-core:list", filter || {}),
      show: (sessionId) => ipcRenderer.invoke("session-core:show", sessionId),
      create: (opts) => ipcRenderer.invoke("session-core:create", opts),
      recallOnStart: (opts) =>
        ipcRenderer.invoke("session-core:recall-on-start", opts),
      park: (sessionId) => ipcRenderer.invoke("session-core:park", sessionId),
      resume: (sessionId) =>
        ipcRenderer.invoke("session-core:resume", sessionId),
      close: (sessionId, opts) =>
        ipcRenderer.invoke("session-core:close", sessionId, opts),
      usage: (opts) => ipcRenderer.invoke("session-core:usage", opts),
      subscribe: (filter) =>
        ipcRenderer.invoke("session-core:subscribe", filter),
      onEvent: (handler) => {
        const listener = (_ev, event) => handler(event);
        ipcRenderer.on("session-core:event", listener);
        return () => ipcRenderer.removeListener("session-core:event", listener);
      },
    },
    memory: {
      store: (entry) => ipcRenderer.invoke("session-core:memory:store", entry),
      recall: (query) =>
        ipcRenderer.invoke("session-core:memory:recall", query),
      delete: (id) => ipcRenderer.invoke("session-core:memory:delete", id),
      consolidate: (opts) =>
        ipcRenderer.invoke("session-core:memory:consolidate", opts),
    },
    agent: {
      streamStart: (opts) => ipcRenderer.invoke("agent:stream:start", opts),
      streamCancel: (streamId) =>
        ipcRenderer.invoke("agent:stream:cancel", streamId),
      onStreamEvent: (handler) => {
        const listener = (_ev, streamId, event) => handler(streamId, event);
        ipcRenderer.on("agent:stream:event", listener);
        return () => ipcRenderer.removeListener("agent:stream:event", listener);
      },
    },
    beta: {
      list: () => ipcRenderer.invoke("beta:list"),
      enable: (flag) => ipcRenderer.invoke("beta:enable", flag),
      disable: (flag) => ipcRenderer.invoke("beta:disable", flag),
    },
    bundle: {
      load: (opts) => ipcRenderer.invoke("bundle:load", opts),
      info: () => ipcRenderer.invoke("bundle:info"),
      unload: () => ipcRenderer.invoke("bundle:unload"),
    },
  },

  // ==========================================
  // 错误日志记录
  // ==========================================
  /**
   * 记录错误到日志文件
   * @param {Object} errorInfo - 错误信息对象
   * @returns {Promise<{success: boolean, error?: string}>}
   */
  logError: (errorInfo) => ipcRenderer.invoke("log:error", errorInfo),

  // ==========================================
  // Memory Sync Service (数据同步到文件系统)
  // ==========================================
  /**
   * 内存数据同步服务 API
   * 将数据库中的数据同步到 .chainlesschain/ 文件系统目录
   *
   * @example
   * // 触发全量同步
   * const result = await window.electronAPI.memorySync.syncAll();
   *
   * // 同步特定类别
   * await window.electronAPI.memorySync.syncCategory('sessions');
   */
  memorySync: {
    /**
     * 触发全量同步
     * @returns {Promise<{success: boolean, results?: object, duration?: number, error?: string}>}
     */
    syncAll: () => ipcRenderer.invoke("memory-sync:sync-all"),

    /**
     * 同步特定类别
     * @param {string} category - 类别名称: 'preferences' | 'patterns' | 'sessions' | 'behaviors' | 'contexts'
     * @returns {Promise<{success: boolean, count?: number, error?: string}>}
     */
    syncCategory: (category) =>
      ipcRenderer.invoke("memory-sync:sync-category", category),

    /**
     * 获取同步状态
     * @returns {Promise<{initialized: boolean, isSyncing: boolean, lastSyncTime: number|null, stats: object}>}
     */
    getStatus: () => ipcRenderer.invoke("memory-sync:get-status"),

    /**
     * 启动定期同步
     * @returns {Promise<{success: boolean}>}
     */
    startPeriodicSync: () => ipcRenderer.invoke("memory-sync:start-periodic"),

    /**
     * 停止定期同步
     * @returns {Promise<{success: boolean}>}
     */
    stopPeriodicSync: () => ipcRenderer.invoke("memory-sync:stop-periodic"),

    /**
     * 生成同步报告
     * @returns {Promise<object>} 同步报告
     */
    generateReport: () => ipcRenderer.invoke("memory-sync:generate-report"),

    /**
     * 确保所有目录存在
     * @returns {Promise<{success: boolean}>}
     */
    ensureDirectories: () =>
      ipcRenderer.invoke("memory-sync:ensure-directories"),
  },

  // ==========================================
  // Team Management (团队管理)
  // ==========================================
  team: {
    createTeam: (params) =>
      ipcRenderer.invoke("team:create-team", removeUndefined(params)),
    updateTeam: (params) =>
      ipcRenderer.invoke("team:update-team", removeUndefined(params)),
    deleteTeam: (params) =>
      ipcRenderer.invoke("team:delete-team", removeUndefined(params)),
    addMember: (params) =>
      ipcRenderer.invoke("team:add-member", removeUndefined(params)),
    removeMember: (params) =>
      ipcRenderer.invoke("team:remove-member", removeUndefined(params)),
    setLead: (params) =>
      ipcRenderer.invoke("team:set-lead", removeUndefined(params)),
    getTeams: (params) => ipcRenderer.invoke("team:get-teams", params),
    getTeamMembers: (params) =>
      ipcRenderer.invoke("team:get-team-members", params),
  },

  // ==========================================
  // Permission Management (权限管理)
  // ==========================================
  perm: {
    grantPermission: (params) =>
      ipcRenderer.invoke("perm:grant-permission", removeUndefined(params)),
    revokePermission: (params) =>
      ipcRenderer.invoke("perm:revoke-permission", removeUndefined(params)),
    checkPermission: (params) =>
      ipcRenderer.invoke("perm:check-permission", params),
    getUserPermissions: (params) =>
      ipcRenderer.invoke("perm:get-user-permissions", params),
    getResourcePermissions: (params) =>
      ipcRenderer.invoke("perm:get-resource-permissions", params),
    bulkGrant: (params) =>
      ipcRenderer.invoke("perm:bulk-grant", removeUndefined(params)),
    inheritPermissions: (params) =>
      ipcRenderer.invoke("perm:inherit-permissions", removeUndefined(params)),
    getEffectivePermissions: (params) =>
      ipcRenderer.invoke("perm:get-effective-permissions", params),
    // Approval Workflows
    createWorkflow: (params) =>
      ipcRenderer.invoke("perm:create-workflow", removeUndefined(params)),
    updateWorkflow: (params) =>
      ipcRenderer.invoke("perm:update-workflow", removeUndefined(params)),
    deleteWorkflow: (params) =>
      ipcRenderer.invoke("perm:delete-workflow", params),
    submitApproval: (params) =>
      ipcRenderer.invoke("perm:submit-approval", removeUndefined(params)),
    approveRequest: (params) =>
      ipcRenderer.invoke("perm:approve-request", removeUndefined(params)),
    rejectRequest: (params) =>
      ipcRenderer.invoke("perm:reject-request", removeUndefined(params)),
    getPendingApprovals: (params) =>
      ipcRenderer.invoke("perm:get-pending-approvals", params),
    getApprovalHistory: (params) =>
      ipcRenderer.invoke("perm:get-approval-history", params),
    // Delegation
    delegatePermissions: (params) =>
      ipcRenderer.invoke("perm:delegate-permissions", removeUndefined(params)),
    revokeDelegation: (params) =>
      ipcRenderer.invoke("perm:revoke-delegation", params),
    getDelegations: (params) =>
      ipcRenderer.invoke("perm:get-delegations", params),
    acceptDelegation: (params) =>
      ipcRenderer.invoke("perm:accept-delegation", params),
  },

  // ==========================================
  // Task Management (任务管理)
  // ==========================================
  task: {
    // Board Management
    createBoard: (params) =>
      ipcRenderer.invoke("task:create-board", removeUndefined(params)),
    updateBoard: (params) =>
      ipcRenderer.invoke("task:update-board", removeUndefined(params)),
    deleteBoard: (params) => ipcRenderer.invoke("task:delete-board", params),
    archiveBoard: (params) =>
      ipcRenderer.invoke("task:archive-board", removeUndefined(params)),
    getBoards: (params) => ipcRenderer.invoke("task:get-boards", params),
    getBoard: (params) => ipcRenderer.invoke("task:get-board", params),
    createColumn: (params) =>
      ipcRenderer.invoke("task:create-column", removeUndefined(params)),
    updateColumn: (params) =>
      ipcRenderer.invoke("task:update-column", removeUndefined(params)),
    deleteColumn: (params) => ipcRenderer.invoke("task:delete-column", params),
    createLabel: (params) =>
      ipcRenderer.invoke("task:create-label", removeUndefined(params)),
    // Task CRUD
    createTask: (params) =>
      ipcRenderer.invoke("task:create-task", removeUndefined(params)),
    updateTask: (params) =>
      ipcRenderer.invoke("task:update-task", removeUndefined(params)),
    deleteTask: (params) => ipcRenderer.invoke("task:delete-task", params),
    getTask: (params) => ipcRenderer.invoke("task:get-task", params),
    getTasks: (params) => ipcRenderer.invoke("task:get-tasks", params),
    assignTask: (params) =>
      ipcRenderer.invoke("task:assign-task", removeUndefined(params)),
    unassignTask: (params) => ipcRenderer.invoke("task:unassign-task", params),
    moveTask: (params) =>
      ipcRenderer.invoke("task:move-task", removeUndefined(params)),
    setDueDate: (params) =>
      ipcRenderer.invoke("task:set-due-date", removeUndefined(params)),
    setPriority: (params) =>
      ipcRenderer.invoke("task:set-priority", removeUndefined(params)),
    setEstimate: (params) =>
      ipcRenderer.invoke("task:set-estimate", removeUndefined(params)),
    addLabel: (params) =>
      ipcRenderer.invoke("task:add-label", removeUndefined(params)),
    // Checklists
    createChecklist: (params) =>
      ipcRenderer.invoke("task:create-checklist", removeUndefined(params)),
    addChecklistItem: (params) =>
      ipcRenderer.invoke("task:add-checklist-item", removeUndefined(params)),
    updateChecklist: (params) =>
      ipcRenderer.invoke("task:update-checklist", removeUndefined(params)),
    deleteChecklist: (params) =>
      ipcRenderer.invoke("task:delete-checklist", params),
    toggleChecklistItem: (params) =>
      ipcRenderer.invoke("task:toggle-checklist-item", removeUndefined(params)),
    // Comments
    addComment: (params) =>
      ipcRenderer.invoke("task:add-comment", removeUndefined(params)),
    updateComment: (params) =>
      ipcRenderer.invoke("task:update-comment", removeUndefined(params)),
    deleteComment: (params) =>
      ipcRenderer.invoke("task:delete-comment", params),
    getComments: (params) => ipcRenderer.invoke("task:get-comments", params),
    // Sprint Management
    createSprint: (params) =>
      ipcRenderer.invoke("task:create-sprint", removeUndefined(params)),
    updateSprint: (params) =>
      ipcRenderer.invoke("task:update-sprint", removeUndefined(params)),
    deleteSprint: (params) => ipcRenderer.invoke("task:delete-sprint", params),
    startSprint: (params) => ipcRenderer.invoke("task:start-sprint", params),
    completeSprint: (params) =>
      ipcRenderer.invoke("task:complete-sprint", params),
    moveToSprint: (params) =>
      ipcRenderer.invoke("task:move-to-sprint", removeUndefined(params)),
    // Reports and Analytics
    getBoardAnalytics: (params) =>
      ipcRenderer.invoke("task:get-board-analytics", params),
    exportBoard: (params) => ipcRenderer.invoke("task:export-board", params),
    getSprintStats: (params) =>
      ipcRenderer.invoke("task:get-sprint-stats", params),
    createReport: (params) =>
      ipcRenderer.invoke("task:create-report", removeUndefined(params)),
    createTeamReport: (params) =>
      ipcRenderer.invoke("task:create-team-report", removeUndefined(params)),
    getTeamReports: (params) =>
      ipcRenderer.invoke("task:get-team-reports", params),
  },

  // ==========================================
  // 主进程日志转发
  // ==========================================
  /**
   * 监听主进程日志
   * 用于在 DevTools 中显示主进程的 console 输出
   *
   * @example
   * window.electronAPI.mainLog.onLog((log) => {
   *   console[log.level](`[Main ${log.time}]`, ...log.args);
   * });
   */
  mainLog: {
    /**
     * 监听主进程日志
     * @param {Function} callback - 回调函数，接收 {level, timestamp, time, args}
     * @returns {Function} 取消监听的函数
     */
    onLog: (callback) => {
      const handler = (_event, log) => callback(log);
      ipcRenderer.on("main:log", handler);
      return () => ipcRenderer.removeListener("main:log", handler);
    },

    /**
     * 移除所有日志监听器
     */
    removeAllListeners: () => {
      ipcRenderer.removeAllListeners("main:log");
    },
  },

  // ==========================================
  // 浏览器自动化 - Phase 4-5
  // ==========================================
  browser: {
    // -------- 工作流管理 (Phase 4) --------
    workflow: {
      // CRUD 操作
      create: (workflow) =>
        ipcRenderer.invoke("browser:workflow:create", workflow),
      get: (workflowId) =>
        ipcRenderer.invoke("browser:workflow:get", workflowId),
      list: (options) => ipcRenderer.invoke("browser:workflow:list", options),
      update: (workflowId, updates) =>
        ipcRenderer.invoke("browser:workflow:update", workflowId, updates),
      delete: (workflowId) =>
        ipcRenderer.invoke("browser:workflow:delete", workflowId),
      duplicate: (workflowId, newName) =>
        ipcRenderer.invoke("browser:workflow:duplicate", workflowId, newName),

      // 执行控制
      execute: (workflowId, targetId, variables) =>
        ipcRenderer.invoke(
          "browser:workflow:execute",
          workflowId,
          targetId,
          variables,
        ),
      executeInline: (workflow, targetId, variables) =>
        ipcRenderer.invoke(
          "browser:workflow:executeInline",
          workflow,
          targetId,
          variables,
        ),
      pause: (executionId) =>
        ipcRenderer.invoke("browser:workflow:pause", executionId),
      resume: (executionId) =>
        ipcRenderer.invoke("browser:workflow:resume", executionId),
      cancel: (executionId) =>
        ipcRenderer.invoke("browser:workflow:cancel", executionId),
      getStatus: (executionId) =>
        ipcRenderer.invoke("browser:workflow:getStatus", executionId),
      listActive: () => ipcRenderer.invoke("browser:workflow:listActive"),

      // 执行历史
      getExecution: (executionId) =>
        ipcRenderer.invoke("browser:workflow:getExecution", executionId),
      listExecutions: (workflowId, options) =>
        ipcRenderer.invoke(
          "browser:workflow:listExecutions",
          workflowId,
          options,
        ),
      getStats: (workflowId) =>
        ipcRenderer.invoke("browser:workflow:getStats", workflowId),

      // 变量管理
      setVariable: (executionId, name, value, scope) =>
        ipcRenderer.invoke(
          "browser:workflow:setVariable",
          executionId,
          name,
          value,
          scope,
        ),
      getVariables: (executionId) =>
        ipcRenderer.invoke("browser:workflow:getVariables", executionId),

      // 导入导出
      export: (workflowId) =>
        ipcRenderer.invoke("browser:workflow:export", workflowId),
      import: (data) => ipcRenderer.invoke("browser:workflow:import", data),

      // 工作流构建
      build: (builder) => ipcRenderer.invoke("browser:workflow:build", builder),

      // 事件监听
      onEvent: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("browser:workflow:event", handler);
        return () =>
          ipcRenderer.removeListener("browser:workflow:event", handler);
      },
    },

    // -------- 扩展操作 (Phase 4) --------
    actions: {
      scroll: (targetId, options) =>
        ipcRenderer.invoke("browser:action:scroll", targetId, options),
      keyboard: (targetId, options) =>
        ipcRenderer.invoke("browser:action:keyboard", targetId, options),
      upload: (targetId, options) =>
        ipcRenderer.invoke("browser:action:upload", targetId, options),
      multiTab: (options) =>
        ipcRenderer.invoke("browser:action:multiTab", options),
    },

    // -------- 高级页面支持 (Phase 4) --------
    advanced: {
      scan: (targetId, options) =>
        ipcRenderer.invoke("browser:scan:advanced", targetId, options),
    },

    // -------- 录制回放 (Phase 5) --------
    recording: {
      // 录制控制
      start: (targetId, options) =>
        ipcRenderer.invoke("browser:recording:start", targetId, options),
      stop: (targetId) =>
        ipcRenderer.invoke("browser:recording:stop", targetId),
      pause: (targetId) =>
        ipcRenderer.invoke("browser:recording:pause", targetId),
      resume: (targetId) =>
        ipcRenderer.invoke("browser:recording:resume", targetId),
      getStatus: (targetId) =>
        ipcRenderer.invoke("browser:recording:getStatus", targetId),

      // 回放控制
      play: (recordingId, targetId, options) =>
        ipcRenderer.invoke(
          "browser:recording:play",
          recordingId,
          targetId,
          options,
        ),
      playPause: (playbackId) =>
        ipcRenderer.invoke("browser:recording:playPause", playbackId),
      playResume: (playbackId) =>
        ipcRenderer.invoke("browser:recording:playResume", playbackId),
      playStop: (playbackId) =>
        ipcRenderer.invoke("browser:recording:playStop", playbackId),
      getPlaybackStatus: (playbackId) =>
        ipcRenderer.invoke("browser:recording:getPlaybackStatus", playbackId),

      // 录制存储
      save: (recording) =>
        ipcRenderer.invoke("browser:recording:save", recording),
      load: (recordingId) =>
        ipcRenderer.invoke("browser:recording:load", recordingId),
      list: (options) => ipcRenderer.invoke("browser:recording:list", options),
      update: (recordingId, updates) =>
        ipcRenderer.invoke("browser:recording:update", recordingId, updates),
      delete: (recordingId) =>
        ipcRenderer.invoke("browser:recording:delete", recordingId),

      // 转换为工作流
      toWorkflow: (recordingId, options) =>
        ipcRenderer.invoke(
          "browser:recording:toWorkflow",
          recordingId,
          options,
        ),

      // 事件监听
      onEvent: (callback) => {
        const handler = (_event, data) => callback(data);
        ipcRenderer.on("browser:recording:event", handler);
        return () =>
          ipcRenderer.removeListener("browser:recording:event", handler);
      },
    },

    // -------- 截图基线 (Phase 5) --------
    baseline: {
      save: (baseline) => ipcRenderer.invoke("browser:baseline:save", baseline),
      get: (baselineId) =>
        ipcRenderer.invoke("browser:baseline:get", baselineId),
      list: (options) => ipcRenderer.invoke("browser:baseline:list", options),
      delete: (baselineId) =>
        ipcRenderer.invoke("browser:baseline:delete", baselineId),
    },

    // -------- 诊断工具 (Phase 5) --------
    diagnostics: {
      // OCR 识别
      ocr: {
        recognize: (targetId, options) =>
          ipcRenderer.invoke("browser:ocr:recognize", targetId, options),
      },

      // 截图对比
      screenshot: {
        compare: (targetId, baselineId, options) =>
          ipcRenderer.invoke(
            "browser:screenshot:compare",
            targetId,
            baselineId,
            options,
          ),
      },
    },
    // Plan A remote-terminal — V6 native bridge to PtyManager via IPC.
    // The same singleton PtyManager backs both the web-shell WS gateway
    // and this IPC, so sessions created in one shell appear in the other.
    // Data is UTF-8 strings (Electron structured-clone handles binary
    // safely — no base64 layer needed here, unlike the WS path).
    terminal: {
      create: (req) => ipcRenderer.invoke("terminal:create", req || {}),
      list: (projectId) => ipcRenderer.invoke("terminal:list", { projectId }),
      stdin: (projectId, sessionId, data) =>
        ipcRenderer.invoke("terminal:stdin", { projectId, sessionId, data }),
      resize: (projectId, sessionId, cols, rows) =>
        ipcRenderer.invoke("terminal:resize", {
          projectId,
          sessionId,
          cols,
          rows,
        }),
      close: (projectId, sessionId) =>
        ipcRenderer.invoke("terminal:close", { projectId, sessionId }),
      history: (projectId, sessionId, fromSeq) =>
        ipcRenderer.invoke("terminal:history", {
          projectId,
          sessionId,
          fromSeq: fromSeq || 0,
        }),
      onStdout: (handler) => {
        const listener = (_ev, payload) => handler(payload);
        ipcRenderer.on("terminal:stdout", listener);
        return () => ipcRenderer.removeListener("terminal:stdout", listener);
      },
      onExit: (handler) => {
        const listener = (_ev, payload) => handler(payload);
        ipcRenderer.on("terminal:exit", listener);
        return () => ipcRenderer.removeListener("terminal:exit", listener);
      },
    },
  },
});

// Also expose a direct electron object for components that use window.electron.ipcRenderer
contextBridge.exposeInMainWorld("electron", {
  ipcRenderer: {
    invoke: fixedInvoke,
    send: fixedSend,
    on: (channel, func) => fixedOn(channel, func),
    once: (channel, func) => fixedOn(channel, func, true),
    removeListener: (channel, func) => {
      assertFixedRendererIpcChannel(channel);
      return ipcRenderer.removeListener(channel, func);
    },
    removeAllListeners: (channel) => {
      assertFixedRendererIpcChannel(channel);
      return ipcRenderer.removeAllListeners(channel);
    },
  },
  desktopCapturer: {
    getSources: (options) => desktopCapturer.getSources(options),
  },
});

// Expose window.ipc for components that use window.ipc.invoke pattern
contextBridge.exposeInMainWorld("ipc", {
  invoke: fixedInvoke,
  on: (channel, func) => fixedOn(channel, func),
  once: (channel, func) => fixedOn(channel, func, true),
  removeListener: (channel, func) => {
    assertFixedRendererIpcChannel(channel);
    return ipcRenderer.removeListener(channel, func);
  },
  removeAllListeners: (channel) => {
    assertFixedRendererIpcChannel(channel);
    return ipcRenderer.removeAllListeners(channel);
  },
});
