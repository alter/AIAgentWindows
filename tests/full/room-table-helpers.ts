// room-table-helpers.ts
import { expect, type Locator, type Page } from '@playwright/test';

export function table(page: Page): Locator {
  return page.locator('[data-room="participants"]');
}

export function tableRow(page: Page, id: string): Locator {
  return table(page).locator(`[data-row="${id}"]`);
}

export function tableRows(page: Page): Locator {
  return table(page).locator('tbody tr[data-row]');
}

export async function rowIds(page: Page): Promise<string[]> {
  return tableRows(page).evaluateAll((rows) => rows.map((row) => (row as HTMLElement).dataset['row'] ?? ''));
}

export async function addParticipant(page: Page, kind: string): Promise<void> {
  await page.locator('[data-room="add-participant"]').click();
  await page.locator(`[data-room="add-menu"] [data-add="${kind}"]`).click();
}

export async function removeParticipant(page: Page, id: string): Promise<void> {
  await tableRow(page, id).locator('[data-row-field="remove"]').click();
  await expect(tableRow(page, id)).toHaveCount(0);
}

export async function setParticipants(page: Page, kinds: readonly string[]): Promise<void> {
  const remove = table(page).locator('[data-row-field="remove"]').first();
  while ((await tableRows(page).count()) > 0) await remove.click();
  for (const kind of kinds) await addParticipant(page, kind);
  await expect(tableRows(page)).toHaveCount(kinds.length);
}
