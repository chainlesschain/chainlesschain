# Generated from src/command-manifest.json; do not edit.
# manifest-sha256: 10e9b6691a34d1d091488b50d346eef8f48029340d7a9a07041b666ba49f34a7

_chainlesschain_complete() {
  local current
  current="${COMP_WORDS[COMP_CWORD]}"
  if (( COMP_CWORD == 1 )); then
    COMPREPLY=( $(compgen -W 'a a2a activitypub agenda agent agent-network agents android anet ap artifact artifacts ask attach audit auth auto auto-mode autoagent automation automode batch bi bm25 browse ccron changelog chat checkpoint checkup ci cli-anything cloud cmd code-intel codegen collab command compact complete compliance compt config consol context cost cowork crosschain daemon dao db dbevo decrypt dev did did-v2 didv2 dlp doctor eco economy ecosystem encrypt eval evolution evomap execbe export federation fflag fusion git goal governance hardening hmemory hook hub ide import incentive inference infra init insights instinct ipfs itbudget kg lab learning llm logs loop lowcode marketplace matrix mcp mcpscaf meminj memory mm mtc multimodal multisig nlprog nostr note notif notification ops orchestrate orchgov org output-style output-styles p2p pack pair pdfp pdh perception perf perm permissions permmem perms persona pipe pipeline planmode plugin pqc privacy project promcomp quantize rc rcache recommend remote-control rep reputation review router routine runtime sandbox scim search serve services seshhook seshsearch seshtail seshu session setup sganal siem skill sla slotfill social sso start status status-line statusline stop stream stress subagent svccont sync team tech tenant terminal-setup terraform tms todo tokens topiccls trust ui update uprof vcheck video wallet webfetch whatsnew workflow zkp' -- "$current") )
  elif (( COMP_CWORD == 2 )); then
    case "${COMP_WORDS[1]}" in
      'lab') COMPREPLY=( $(compgen -W 'bm25 ccron compt consol dao evomap fflag pdfp sganal vcheck' -- "$current") ) ;;
      *) COMPREPLY=() ;;
    esac
  else
    COMPREPLY=()
  fi
}
complete -F _chainlesschain_complete cc chainlesschain clc clchain
