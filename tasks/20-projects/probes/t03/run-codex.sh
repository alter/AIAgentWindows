#!/bin/bash
# usage: run-codex.sh <world> <trusted|untrusted> <label> [codex exec args...]; offline via sandbox-exec deny network, no creds
W="$1"; K="$2"; L="$3"; shift 3
rm -f "$W/marks/"*
cd "$W/$K"
CODEX_HOME="$W/home" timeout 40 sandbox-exec -p '(version 1)(allow default)(deny network*)' \
 codex exec --sandbox read-only "$@" "x" > "$W/out-$K-$L.txt" 2>&1 </dev/null
echo "[$K/$L] exit=$? args: $*"
echo "  out: $(head -c 700 "$W/out-$K-$L.txt" | tr '\n' ' ')"
echo "  marks: $(ls "$W/marks" | tr '\n' ' ')"
