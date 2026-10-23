#!/bin/bash
# usage: run-claude.sh <world> <label> [claude args...]; prompt is "x"; offline, no creds
W="$1"; L="$2"; shift 2
rm -f "$W/marks/"*
cd "$W/proj" || exit 1
ANTHROPIC_BASE_URL=http://127.0.0.1:1 CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1 DISABLE_TELEMETRY=1 CLAUDE_CONFIG_DIR="$W/cfg" \
 timeout 60 claude -p "x" --debug-file "$W/debug-$L.log" "$@" > "$W/out-$L.txt" 2>&1 </dev/null
echo "[$L] exit=$? args: $*"
echo "  out: $(head -c 300 "$W/out-$L.txt" | tr '\n' ' ')"
echo "  marks: $(ls "$W/marks" | tr '\n' ' ')"
