// global-setup.ts
import { execFileSync } from 'node:child_process';

export default function globalSetup(): void {
  execFileSync(process.execPath, ['scripts/build.mjs'], { stdio: 'ignore' });
}
