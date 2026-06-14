#!/usr/bin/env bash
# Gates git --force / -f variants only. Narrowed 2026-06-14: `git merge` and
# `git push` used to be blocked here too, but that was more ceremony than safety
# for a solo repo — they now run on a user signal (per CLAUDE.md) with no hard
# block. Force / force-push stays gated because it can irreversibly rewrite
# remote history; surface it and get explicit approval first.

set -euo pipefail

command=$(python -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))")

# One-off bypass: once the user has explicitly approved a force operation, prefix
# the command with GIT_GATE_BYPASS=1 so this single invocation passes.
if echo "$command" | grep -Eq '(^|[[:space:]])GIT_GATE_BYPASS=1[[:space:]]'; then
  echo "{}"
  exit 0
fi

# Force / force-push variants are history-destroying. Block --force / -f on any git command.
if echo "$command" | grep -Eq '^git[[:space:]].*([[:space:]]--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))'; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by git-gate. Force / force-push can rewrite history irreversibly — surface the command and wait for explicit user approval ('yes, force'), then prefix with GIT_GATE_BYPASS=1."
  }
}
EOF
  exit 0
fi

# Everything else — including merge and push — passes.
echo "{}"
exit 0
