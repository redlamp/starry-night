#!/usr/bin/env bash
# Blocks git commit / merge / push. Forces Claude to surface the intended
# command for the user to run, rather than committing or pushing on its own.

set -euo pipefail

command=$(python -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))")

# Match the operations we want to gate. Word boundaries matter so we
# don't trip on things like `git log --grep="commit"`.
if echo "$command" | grep -Eq '(^|[[:space:]&|;])git[[:space:]]+(commit|merge|push)([[:space:]]|$)'; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by git-gate. git commit / merge / push require explicit user approval per CLAUDE.md. Show the command you would run and wait for the user to run it or to say 'ship it' / 'next' / 'move on' / 'yes, commit' / 'yes, merge' / 'yes, push'."
  }
}
EOF
  exit 0
fi

# Force-push variants are extra dangerous. Block --force / -f on any git command.
if echo "$command" | grep -Eq '^git[[:space:]].*([[:space:]]--force([[:space:]]|=|$)|[[:space:]]-f([[:space:]]|$))'; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by git-gate. Force-push / force operations require explicit user approval. Surface the command and wait."
  }
}
EOF
  exit 0
fi

# Everything else passes.
echo "{}"
exit 0
