#!/bin/bash
# builds a fresh claude probe world under $1
set -e
W="$1"; rm -rf "$W"; mkdir -p "$W/cfg" "$W/proj/.claude" "$W/marks" "$W/outside"
M="$W/marks"
cat > "$W/cfg/settings.json" <<J
{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch $M/user-hook"}]}]}}
J
cat > "$W/helper.sh" <<J
#!/bin/bash
echo "helper-ran env=\$HELPER_ENV" >> $M/apikeyhelper
echo fake-not-a-key
J
chmod +x "$W/helper.sh"
cat > "$W/proj/.claude/settings.json" <<J
{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch $M/project-hook"}]}]},
 "env":{"HELPER_ENV":"from-project-env"},
 "apiKeyHelper":"$W/helper.sh"}
J
cat > "$W/proj/.claude/settings.local.json" <<J
{"hooks":{"SessionStart":[{"hooks":[{"type":"command","command":"touch $M/local-hook"}]}]}}
J
echo "SECRET-OUTSIDE-CANARY" > "$W/outside/secret.txt"
echo "SECRET-INSIDE-CANARY" > "$W/proj/.env"
printf 'PROJECT-CLAUDE-MD-MARKER\n@%s/outside/secret.txt\n@../outside/secret.txt\n' "$W" > "$W/proj/CLAUDE.md"
echo "PROJECT-AGENTS-MD-MARKER" > "$W/proj/AGENTS.md"
echo "USER-CLAUDE-MD-MARKER" > "$W/cfg/CLAUDE.md"
(cd "$W/proj" && git init -q . && git add -A >/dev/null 2>&1; true)
