import json, sys, glob, os

def claude_last(path):
    reply, unknown = [], 0
    for line in open(path, encoding="utf-8"):
        try: o = json.loads(line)
        except ValueError: unknown += 1; continue
        if o.get("isSidechain"): continue
        if o.get("type") == "user" and isinstance(o["message"]["content"], str): reply = []
        if o.get("type") == "assistant":
            reply += [b["text"] for b in o["message"]["content"] if b.get("type") == "text"]
    return "".join(reply[-1:]), unknown

def codex_last(path):
    reply, meta = "", None
    for line in open(path, encoding="utf-8"):
        o = json.loads(line); p = o.get("payload") or {}
        if o.get("type") == "session_meta": meta = p.get("cwd")
        if o.get("type") == "response_item" and p.get("type") == "message" and p.get("role") == "assistant":
            reply = "".join(c.get("text", "") for c in p.get("content", []) if c.get("type") == "output_text")
    return reply, meta

kind, arg = sys.argv[1], sys.argv[2]
if kind == "claude":
    root = os.environ.get("CLAUDE_CONFIG_DIR", os.path.expanduser("~/.claude"))
    hits = glob.glob(os.path.join(root, "projects", "*", f"{arg}.jsonl"))
    print(f"lookup {root}/projects/*/{arg}.jsonl -> {hits}")
    r, u = claude_last(hits[0]); print(f"last reply: {r[:200]!r}; unparsable lines: {u}")
else:
    r, cwd = codex_last(arg); print(f"{os.path.basename(arg)} cwd={cwd}\nlast reply: {r[:200]!r}")
