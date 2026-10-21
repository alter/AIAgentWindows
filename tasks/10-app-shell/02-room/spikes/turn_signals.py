# turn_signals.py
import collections
import glob
import json
import os
import sys


def claude_report(limit):
    files = sorted(glob.glob(os.path.expanduser("~/.claude/projects/*/*.jsonl")), key=os.path.getmtime)[-limit:]
    shapes = collections.Counter()
    records = collections.Counter()
    system_subtypes = collections.Counter()
    duration_keys = set()
    end_text = 0
    end_with_duration = 0
    for path in files:
        recs = []
        for line in open(path, errors="replace"):
            try:
                recs.append(json.loads(line))
            except ValueError:
                continue
        by_message = collections.OrderedDict()
        for i, rec in enumerate(recs):
            records[rec.get("type")] += 1
            if rec.get("type") == "system":
                system_subtypes[(rec.get("subtype"), rec.get("preventedContinuation"))] += 1
                if rec.get("subtype") == "turn_duration":
                    duration_keys.update(rec.keys())
            if rec.get("type") == "assistant" and not rec.get("isSidechain") and rec["message"].get("stop_reason") == "end_turn" and any(b.get("type") == "text" for b in rec["message"]["content"]):
                end_text += 1
                nxt = next((k for k in range(i + 1, len(recs)) if recs[k].get("type") == "assistant"), len(recs))
                if any(recs[k].get("type") == "system" and recs[k].get("subtype") == "turn_duration" for k in range(i + 1, nxt)):
                    end_with_duration += 1
            if rec.get("type") == "assistant" and not rec.get("isSidechain"):
                msg = rec["message"]
                blocks = tuple(b.get("type") for b in msg.get("content", []))
                by_message.setdefault(msg.get("id"), []).append((msg.get("stop_reason"), blocks))
        for parts in by_message.values():
            shapes[tuple(parts)] += 1
    print("CLAUDE transcripts scanned:", len(files))
    print("record types:", dict(records))
    print("assistant message shapes (stop_reason, content block types per record, in file order):")
    for shape, n in shapes.most_common(8):
        print(" ", n, shape)
    print("system subtypes:", dict(system_subtypes))
    print("turn_duration keys:", sorted(duration_keys))
    print("end_turn records with a text block:", end_text, "followed by a turn_duration record before the next assistant record:", end_with_duration)
    print("assistant record keys:", sorted(next(r for r in recs if r.get("type") == "assistant").keys()))
    print("user record keys:", sorted(next(r for r in recs if r.get("type") == "user").keys()))


def codex_report():
    files = sorted(glob.glob(os.path.expanduser("~/.codex/sessions/*/*/*/rollout-*.jsonl")))
    print("CODEX rollouts:", len(files))
    modes = collections.Counter()
    events = collections.Counter()
    tc_keys = set()
    phases = collections.Counter()
    ctx = collections.Counter()
    for path in files:
        for line in open(path, errors="replace"):
            try:
                rec = json.loads(line)
            except ValueError:
                continue
            payload = rec.get("payload") if isinstance(rec.get("payload"), dict) else {}
            if rec.get("type") == "session_meta":
                modes[(payload.get("cli_version"), payload.get("history_mode"))] += 1
            if rec.get("type") == "event_msg":
                events[payload.get("type")] += 1
                if payload.get("type") == "task_complete":
                    tc_keys.update(payload.keys())
                    ctx[("task_complete", "last_agent_message is str", isinstance(payload.get("last_agent_message"), str), "error present", payload.get("error") is not None)] += 1
                if payload.get("type") == "item_completed" and payload["item"].get("type") == "AgentMessage":
                    phases[payload["item"].get("phase")] += 1
            if rec.get("type") == "turn_context":
                ctx[("turn_context", "approval_policy", payload.get("approval_policy"), "sandbox_policy.type", (payload.get("sandbox_policy") or {}).get("type"))] += 1
    print("(cli_version, history_mode):", dict(modes))
    print("event_msg types:", dict(events))
    print("task_complete keys seen:", sorted(tc_keys))
    print("AgentMessage phases:", dict(phases))
    for key, n in ctx.items():
        print(" ", n, key)


if __name__ == "__main__":
    (claude_report if sys.argv[1] == "claude" else lambda _: codex_report())(int(sys.argv[2]) if len(sys.argv) > 2 else 6)
