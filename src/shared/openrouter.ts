// openrouter.ts
export const OPENROUTER_BASE = 'https://openrouter.ai';
export const OPENROUTER_BASE_ENV = 'AIAW_OPENROUTER_BASE';
export const OPENROUTER_APP_TITLE = 'AI Agent Windows';
export const MAX_KEY_CHARS = 512;
export const MAX_CODE_CHARS = 512;
export const MAX_PASTE_CHARS = 4096;
export const MAX_MODEL_FIELD_CHARS = 200;
export const MAX_MODELS_BYTES = 4 * 1024 * 1024;
export const STATE_CHARS = 43;
export const SIGN_IN_TIMEOUT_MS = 10 * 60 * 1000;

export type OpenRouterMode = 'browser' | 'code';
export type OpenRouterNotice =
  | 'storage-unavailable'
  | 'sign-in-failed'
  | 'sign-in-timeout'
  | 'key-rejected'
  | 'invalid-key'
  | 'network'
  | 'open-failed';

export interface FreeRequests {
  used: number;
  limit: number;
  remaining: number;
}

export interface KeyInfo {
  isFreeTier: boolean | null;
  limitRemaining: number | null;
  freeRequests: FreeRequests | null;
}

export interface OpenRouterStatus {
  state: 'signed-out' | 'signing-in' | 'connected';
  mode: OpenRouterMode | null;
  notice: OpenRouterNotice | null;
  info: KeyInfo | null;
}

export interface ModelItem {
  id: string;
  name: string;
  contextLength: number | null;
  promptUsdPerMillion: number | null;
  completionUsdPerMillion: number | null;
  free: boolean;
  efforts: string[];
}

export interface OpenRouterSettings {
  model: string;
  modelName?: string;
  effort: string;
  web: boolean;
}

export type ModelFilter = 'all' | 'free' | 'paid';
export type ModelSort = 'name' | 'price' | 'context';

export const MODEL_FILTERS: readonly ModelFilter[] = ['all', 'free', 'paid'];
export const MODEL_ID_PATTERN = /^[a-z0-9._/:-]{1,200}$/;
export const GATEWAY_EFFORTS: readonly string[] = ['max', 'xhigh', 'high', 'medium', 'low', 'minimal', 'none'];
export const WEB_SEARCH_USD = 0.007;
const EFFORT_SHAPE = /^[a-z]{1,16}$/;
const CONTROL_CHARS = /[\p{Cc}\u2028\u2029]/u;

type Env = Readonly<Record<string, string | undefined>>;

const NOTICE_TEXT: Readonly<Record<OpenRouterNotice, string>> = {
  'storage-unavailable': 'This computer cannot store the key safely, so nothing was saved.',
  'sign-in-failed': 'OpenRouter refused the sign-in. Start it again.',
  'sign-in-timeout': 'Sign-in was not finished in 10 minutes. Start it again.',
  'key-rejected': 'OpenRouter no longer accepts the saved key. Sign in again.',
  'invalid-key': 'That does not look like a key or a code.',
  network: 'OpenRouter could not be reached.',
  'open-failed': 'The browser could not be opened. Paste a key instead.',
};

export function noticeText(notice: OpenRouterNotice | null): string {
  return notice === null ? '' : NOTICE_TEXT[notice];
}

export function emptyStatus(): OpenRouterStatus {
  return { state: 'signed-out', mode: null, notice: null, info: null };
}

export function parsePastedKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const key = value.trim();
  return key.length >= 1 && key.length <= MAX_KEY_CHARS && !/[\s\p{Cc}]/u.test(key) ? key : null;
}

function loopbackOrigin(value: string): string | null {
  try {
    const url = new URL(value);
    const loopback = url.hostname === '127.0.0.1' || url.hostname === 'localhost';
    const bare = url.pathname === '/' && url.search === '' && url.hash === '' && url.username === '' && url.password === '';
    return url.protocol === 'http:' && loopback && url.port !== '' && bare ? url.origin : null;
  } catch {
    return null;
  }
}

function overrideBase(env: Env): string | null {
  const override = env[OPENROUTER_BASE_ENV];
  return (env['AIAW_USER_DATA'] ?? '').length > 0 && override !== undefined ? loopbackOrigin(override) : null;
}

export function openrouterTestMode(env: Env): boolean {
  return overrideBase(env) !== null;
}

export function openrouterBase(env: Env): string {
  return overrideBase(env) ?? OPENROUTER_BASE;
}

export function attributionHeaders(): Record<string, string> {
  return {
    'HTTP-Referer': 'http://localhost',
    'X-OpenRouter-Title': OPENROUTER_APP_TITLE,
    'X-OpenRouter-App-Visibility': 'hidden',
  };
}

export function authUrl(base: string, options: { challenge: string; callbackUrl?: string; state?: string }): string {
  const params = new URLSearchParams();
  if (options.callbackUrl !== undefined) params.set('callback_url', options.callbackUrl);
  params.set('code_challenge', options.challenge);
  params.set('code_challenge_method', 'S256');
  if (options.state !== undefined) params.set('state', options.state);
  params.set('key_label', OPENROUTER_APP_TITLE);
  return `${base}/auth?${params.toString()}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isFreeModel(id: string, prompt: number | null, completion: number | null): boolean {
  return id.endsWith(':free') || id === 'openrouter/free' || (prompt === 0 && completion === 0);
}

function perMillion(value: unknown): number | null {
  if (typeof value !== 'string') return null;
  const perToken = Number(value);
  return Number.isFinite(perToken) && perToken >= 0 ? Number((perToken * 1e6).toPrecision(12)) : null;
}

function contextOf(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function producesText(architecture: unknown): boolean {
  if (architecture === undefined) return true;
  if (!isRecord(architecture)) return false;
  const modalities = architecture['output_modalities'];
  return !Array.isArray(modalities) || modalities.includes('text');
}

function expired(value: unknown, nowMs: number): boolean {
  return typeof value === 'string' && Date.parse(value) <= nowMs;
}

function isEffort(value: unknown): value is string {
  return typeof value === 'string' && EFFORT_SHAPE.test(value);
}

function parseEfforts(reasoning: unknown): string[] {
  if (!isRecord(reasoning)) return [];
  const listed = reasoning['supported_efforts'];
  const offered = listed === null ? GATEWAY_EFFORTS : Array.isArray(listed) ? (listed as unknown[]).filter(isEffort) : [];
  return [...new Set(offered)].filter((effort) => reasoning['mandatory'] !== true || effort !== 'none');
}

function parseModel(raw: unknown, nowMs: number): ModelItem | null {
  if (!isRecord(raw)) return null;
  const id = raw['id'];
  if (typeof id !== 'string' || id.length < 1 || id.length > MAX_MODEL_FIELD_CHARS) return null;
  if (!producesText(raw['architecture']) || expired(raw['expiration_date'], nowMs)) return null;
  const name = raw['name'];
  const pricing = isRecord(raw['pricing']) ? raw['pricing'] : {};
  const prompt = perMillion(pricing['prompt']);
  const completion = perMillion(pricing['completion']);
  return {
    id,
    name: typeof name === 'string' && name.length > 0 ? name.slice(0, MAX_MODEL_FIELD_CHARS) : id,
    contextLength: contextOf(raw['context_length']),
    promptUsdPerMillion: prompt,
    completionUsdPerMillion: completion,
    free: isFreeModel(id, prompt, completion),
    efforts: parseEfforts(raw['reasoning']),
  };
}

export function parseModels(raw: unknown, nowMs: number): ModelItem[] {
  if (!isRecord(raw) || !Array.isArray(raw['data'])) return [];
  const seen = new Set<string>();
  const items: ModelItem[] = [];
  for (const entry of raw['data'] as unknown[]) {
    const item = parseModel(entry, nowMs);
    if (item === null || seen.has(item.id)) continue;
    seen.add(item.id);
    items.push(item);
  }
  return items;
}

export function filterModels(models: readonly ModelItem[], filter: ModelFilter, query: string): ModelItem[] {
  const needle = query.trim().toLowerCase();
  return models.filter((model) => {
    if (filter === 'free' && !model.free) return false;
    if (filter === 'paid' && model.free) return false;
    return needle === '' || model.id.toLowerCase().includes(needle) || model.name.toLowerCase().includes(needle);
  });
}

function byId(a: ModelItem, b: ModelItem): number {
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function byNumber(a: number | null, b: number | null, descending: boolean): number {
  if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
  return descending ? b - a : a - b;
}

export function sortModels(models: readonly ModelItem[], sort: ModelSort): ModelItem[] {
  const compare = (a: ModelItem, b: ModelItem): number => {
    if (sort === 'price') return byNumber(a.promptUsdPerMillion, b.promptUsdPerMillion, false);
    if (sort === 'context') return byNumber(a.contextLength, b.contextLength, true);
    const left = a.name.toLowerCase();
    const right = b.name.toLowerCase();
    return left < right ? -1 : left > right ? 1 : 0;
  };
  return [...models].sort((a, b) => compare(a, b) || byId(a, b));
}

export function pickableModels(models: readonly ModelItem[]): ModelItem[] {
  return models.filter((model) => MODEL_ID_PATTERN.test(model.id));
}

export function emptyOpenRouterSettings(): OpenRouterSettings {
  return { model: '', effort: '', web: false };
}

export function parseOpenRouterSettings(raw: unknown): OpenRouterSettings | null {
  if (!isRecord(raw)) return null;
  const { model, modelName, effort, web } = raw;
  if (typeof model !== 'string' || (model !== '' && !MODEL_ID_PATTERN.test(model))) return null;
  if (typeof effort !== 'string' || (effort !== '' && !EFFORT_SHAPE.test(effort))) return null;
  if (typeof web !== 'boolean') return null;
  if (modelName === undefined) return { model, effort, web };
  if (typeof modelName !== 'string' || modelName.length < 1 || modelName.length > MAX_MODEL_FIELD_CHARS || CONTROL_CHARS.test(modelName)) return null;
  return { model, modelName, effort, web };
}

export function effortSupported(model: ModelItem | undefined, effort: string): boolean {
  return effort === '' || model === undefined || model.efforts.includes(effort);
}

export function modelPick(model: ModelItem): { model: string; modelName: string; web: boolean } {
  return { model: model.id, modelName: model.name, web: !model.free };
}

function dollars(value: number | null): string {
  return value === null ? '?' : `$${Number(value.toFixed(4))}`;
}

export function modelPriceText(model: ModelItem): string {
  if (model.free) return 'free';
  return `${dollars(model.promptUsdPerMillion)} in / ${dollars(model.completionUsdPerMillion)} out per 1M tokens`;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null;
}

function parseFreeRequests(raw: unknown): FreeRequests | null {
  if (!isRecord(raw)) return null;
  const used = count(raw['used']);
  const limit = count(raw['limit']);
  const remaining = count(raw['remaining']);
  return used === null || limit === null || remaining === null ? null : { used, limit, remaining };
}

export function parseKeyInfo(raw: unknown): KeyInfo | null {
  if (!isRecord(raw) || !isRecord(raw['data'])) return null;
  const data = raw['data'];
  const flag = data['is_free_tier'];
  const left = data['limit_remaining'];
  return {
    isFreeTier: typeof flag === 'boolean' ? flag : null,
    limitRemaining: typeof left === 'number' && Number.isFinite(left) ? left : null,
    freeRequests: parseFreeRequests(data['free_model_daily_requests']),
  };
}
