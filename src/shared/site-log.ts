// site-log.ts
export type SiteLogValue = string | number | boolean;

function formatValue(value: SiteLogValue): string {
  return typeof value === 'string' ? JSON.stringify(value) : String(value);
}

export function formatSiteLog(
  time: string,
  site: string,
  event: string,
  fields: Readonly<Record<string, SiteLogValue>>,
): string {
  const pairs = Object.entries(fields).map(([key, value]) => `${key}=${formatValue(value)}`);
  return [time, site, event, ...pairs].join(' ');
}
