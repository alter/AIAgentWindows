// save-plan.ts
import { lstat, mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import type { SavePlanResult } from '../../shared/plan-file';
import { writeAtomic } from '../store/atomic-file';

export interface SavePlanDeps {
  trash(file: string): Promise<void>;
  mkdir?(folder: string): Promise<unknown>;
  realpath?(file: string): Promise<string>;
  suffix?(): string;
}

type Kind = 'missing' | 'folder' | 'file' | 'link' | 'other';

async function kindOf(file: string): Promise<Kind> {
  try {
    const info = await lstat(file);
    if (info.isSymbolicLink()) return 'link';
    if (info.isDirectory()) return 'folder';
    return info.isFile() ? 'file' : 'other';
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'missing';
    throw error;
  }
}

function fail(error: string): SavePlanResult {
  return { ok: false, error };
}

function refusal(kind: Kind, what: string): SavePlanResult {
  return fail(kind === 'link' ? `${what} is a symbolic link: Save plan does not write through it.` : `${what} is not a folder.`);
}

function isInside(root: string, file: string): boolean {
  return file === root || file.startsWith(`${root}${path.sep}`);
}

export async function savePlanFile(projectFolder: string, slug: string, text: string, replace: boolean, deps: SavePlanDeps): Promise<SavePlanResult> {
  const resolve = deps.realpath ?? realpath;
  const make = deps.mkdir ?? ((folder: string) => mkdir(folder));
  try {
    const docs = path.join(projectFolder, 'docs');
    const plans = path.join(docs, 'plans');
    for (const folder of [docs, plans]) {
      const kind = await kindOf(folder);
      if (kind === 'missing') await make(folder);
      else if (kind !== 'folder') return refusal(kind, path.relative(projectFolder, folder));
    }
    if (!isInside(await resolve(projectFolder), await resolve(plans))) return fail('docs/plans resolves outside the project folder.');
    const file = path.join(plans, `${slug}.md`);
    const kind = await kindOf(file);
    if (kind === 'link') return fail(`docs/plans/${slug}.md is a symbolic link: Save plan does not write through it.`);
    if (kind === 'folder' || kind === 'other') return fail(`docs/plans/${slug}.md is not a file.`);
    if (kind === 'file') {
      if (!replace) return { ok: false, exists: true, file, error: `docs/plans/${slug}.md already exists.` };
      await deps.trash(file);
    }
    await writeAtomic(file, text, { ensureDir: false, ...(deps.suffix === undefined ? {} : { suffix: deps.suffix }) });
    return { ok: true, file };
  } catch (error) {
    return fail(error instanceof Error ? error.message : String(error));
  }
}
