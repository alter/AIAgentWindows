// window-visibility.ts
export type VisibilityEnv = Readonly<Record<string, string | undefined>>;

export function windowsVisible(env: VisibilityEnv): boolean {
  const testMode = (env['AIAW_USER_DATA'] ?? '').length > 0;
  return !testMode || env['AIAW_SHOW_WINDOWS'] === '1';
}
