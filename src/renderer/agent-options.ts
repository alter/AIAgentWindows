// agent-options.ts
import type { AgentKind } from '../shared/agents';

export const ADD_OPTIONS: readonly { kind: AgentKind; label: string }[] = [
  { kind: 'claude', label: 'Claude Code' },
  { kind: 'codex', label: 'Codex' },
  { kind: 'chatgpt', label: 'ChatGPT' },
  { kind: 'grok', label: 'Grok' },
  { kind: 'deepseek', label: 'DeepSeek' },
  { kind: 'openrouter', label: 'OpenRouter' },
];
