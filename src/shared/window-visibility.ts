// window-visibility.ts
export type VisibilityEnv = Readonly<Record<string, string | undefined>>;

export function windowsVisible(env: VisibilityEnv): boolean {
  if ((env['AIAW_CAPTURE_AUTO'] ?? '').length > 0) return false;
  const testMode = (env['AIAW_USER_DATA'] ?? '').length > 0;
  return !testMode || env['AIAW_SHOW_WINDOWS'] === '1';
}

export function dockHidden(env: VisibilityEnv, platform: string): boolean {
  return platform === 'darwin' && !windowsVisible(env);
}
