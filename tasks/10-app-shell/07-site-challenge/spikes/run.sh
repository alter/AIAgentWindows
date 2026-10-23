#!/bin/bash
# run.sh <variant> <tag> <url> [wait]
R=/Users/user/workflow/git/AIAgentWindows
VARIANT=$1 TARGET=$3 WAIT=${4:-25000} OUT=$R/.claude/scratch/turnstile/out/$2-$1.json timeout 150 $R/node_modules/electron/dist/Electron.app/Contents/MacOS/Electron $R/.claude/scratch/turnstile > $R/.claude/scratch/turnstile/out/$2-$1.log 2>&1
echo "$1 $2 exit $?"
