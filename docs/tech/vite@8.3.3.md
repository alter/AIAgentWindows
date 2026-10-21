# vite@8.3.3

Pinned 2026-10-21 (published 2026-10-06; 8.3.5 is the newest, 8.3.3 is the newest release older than two weeks at pin time). Used only as the required peer of vitest 5.0.3; the project does not run `vite` itself (esbuild builds the app).

- vitest 5.0.3 declares peer `vite ^6.4.0 || ^7.0.0 || ^8.0.0`, not optional, so it must be a direct devDependency once `legacy-peer-deps=true` stops npm from installing peers — https://www.npmjs.com/package/vitest/v/5.0.3?activeTab=dependencies
- 8.3.3 is inside that range — https://www.npmjs.com/package/vite/v/8.3.3
