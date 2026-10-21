// site-log-file.ts
import { appendFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { formatSiteLog, type SiteLogValue } from '../shared/site-log';

export type SiteLogger = (site: string, event: string, fields: Readonly<Record<string, SiteLogValue>>) => void;

export function createSiteLogger(file: string): SiteLogger {
  let queue: Promise<void> = mkdir(path.dirname(file), { recursive: true }).then(() => undefined);
  return (site, event, fields) => {
    const line = formatSiteLog(new Date().toISOString(), site, event, fields);
    console.log(`[sites] ${line}`);
    queue = queue
      .then(() => appendFile(file, `${line}\n`, 'utf8'))
      .catch(() => undefined);
  };
}
