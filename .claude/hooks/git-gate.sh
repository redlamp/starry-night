#!/usr/bin/env bash
# Blocks git merge / push and any --force variant. Local commits are reversible
# (reset / amend / revert) so they pass through; CLAUDE.md still tells Claude
# not to commit without a user signal. This hook is the safety net for the
# irreversible operations only.

set -euo pipefail

command=$(python -c "import json,sys; print(json.load(sys.stdin).get('tool_input',{}).get('command',''))")

# One-off bypass: if the user said "ship it" / "yes, commit" / etc., Claude is
# expected to prefix the gated command with GIT_GATE_BYPASS=1 so the hook lets
# this single invocation through. Each gated action still needs its own
# explicit approval — Claude does not get to stash this anywhere.
if echo "$command" | grep -Eq '(^|[[:space:]])GIT_GATE_BYPASS=1[[:space:]]'; then
  echo "{}"
  exit 0
fi

# Match the operations we want to gate. Word boundaries matter so we
# don't trip on things like `git log --grep="commit"`.
if echo "$command" | grep -Eq '(^|[[:space:]&|;])git[[:space:]]+(merge|push)([[:space:]]|$)'; then
  cat <<'EOF'
{
  "hookSpecificOutput": {
    "hookEventName": "PreToolUse",
    "permissionDecision": "deny",
    "permissionDecisionReason": "Blocked by git-gate. git merge / push require explicit user approval per CLAUDE.md. Show the command you would run and wait for the user to run it or to say 'ship it' / 'next' / 'move on' / 'yes, merge' / 'yes, push'."
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
