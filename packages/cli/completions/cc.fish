# Generated from src/command-manifest.json; do not edit.
# manifest-sha256: e989e4e22dc918cc8f60a1857957f9e4cfdfd4ced4ca6ab8f956156e441ba528
set -l chainlesschain_commands 'a' 'a2a' 'activitypub' 'agenda' 'agent' 'agent-network' 'agents' 'android' 'anet' 'ap' 'artifact' 'artifacts' 'ask' 'attach' 'audit' 'auth' 'auto' 'auto-mode' 'autoagent' 'automation' 'automode' 'batch' 'bi' 'bm25' 'browse' 'ccron' 'changelog' 'chat' 'checkpoint' 'checkup' 'ci' 'cli-anything' 'cloud' 'cmd' 'code-intel' 'codegen' 'collab' 'command' 'compact' 'complete' 'compliance' 'compt' 'config' 'consol' 'context' 'cost' 'cowork' 'crosschain' 'daemon' 'dao' 'db' 'dbevo' 'decrypt' 'dev' 'did' 'did-v2' 'didv2' 'dlp' 'doctor' 'eco' 'economy' 'ecosystem' 'encrypt' 'eval' 'evolution' 'evomap' 'execbe' 'export' 'federation' 'fflag' 'fusion' 'git' 'goal' 'governance' 'hardening' 'hmemory' 'hook' 'hub' 'ide' 'import' 'incentive' 'inference' 'infra' 'init' 'insights' 'instinct' 'ipfs' 'itbudget' 'kg' 'lab' 'learning' 'llm' 'logs' 'loop' 'lowcode' 'marketplace' 'matrix' 'mcp' 'mcpscaf' 'meminj' 'memory' 'mm' 'mtc' 'multimodal' 'multisig' 'nlprog' 'nostr' 'note' 'notif' 'notification' 'ops' 'orchestrate' 'orchgov' 'org' 'output-style' 'output-styles' 'p2p' 'pack' 'pair' 'pdfp' 'pdh' 'perception' 'perf' 'perm' 'permissions' 'permmem' 'perms' 'persona' 'pipe' 'pipeline' 'planmode' 'plugin' 'pqc' 'privacy' 'project' 'promcomp' 'quantize' 'rc' 'rcache' 'recommend' 'remote-control' 'rep' 'reputation' 'review' 'router' 'routine' 'runtime' 'sandbox' 'scim' 'search' 'serve' 'services' 'seshhook' 'seshsearch' 'seshtail' 'seshu' 'session' 'setup' 'sganal' 'siem' 'skill' 'sla' 'slotfill' 'social' 'sso' 'start' 'status' 'status-line' 'statusline' 'stop' 'stream' 'stress' 'subagent' 'svccont' 'sync' 'team' 'tech' 'tenant' 'terminal-setup' 'terraform' 'tms' 'todo' 'tokens' 'topiccls' 'trust' 'ui' 'update' 'uprof' 'vcheck' 'video' 'wallet' 'webfetch' 'whatsnew' 'workflow' 'zkp'

function __chainlesschain_needs_lab_command
  set -l tokens (commandline -opc)
  test (count $tokens) -eq 2; and test "$tokens[2]" = 'lab'
end

for executable in cc chainlesschain clc clchain
  complete -c $executable -f -n '__fish_use_subcommand' -a "$chainlesschain_commands"
  complete -c $executable -f -n '__chainlesschain_needs_lab_command' -a 'dao evomap'
end
