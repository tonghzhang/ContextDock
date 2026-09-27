import { z } from 'zod';
import { itemInput, workspaceInput } from '../core/validation';
const location = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string().max(32768) }).strict(),
  z.object({ kind: z.literal('local'), path: z.string().max(32768) }).strict(),
  z.object({ kind: z.literal('attachment'), path: z.string().max(240) }).strict(),
]);
const schema = z
  .object({
    format: z.literal('contextdock-workspace'),
    version: z.literal(1),
    workspace: z
      .object({
        id: z.string().uuid(),
        name: z.string().max(200),
        description: z.string().max(4096).default(''),
        items: z
          .array(
            z
              .object({
                id: z.string().min(1).max(100),
                type: z.enum(['url', 'application', 'file', 'folder']),
                name: z.string().max(200),
                arguments: z.array(z.string().max(32768)).max(128).default([]),
                enabled: z.boolean(),
                launchOrder: z.number().int().min(0).max(1000000),
                location,
              })
              .strict(),
          )
          .max(1000),
      })
      .strict(),
  })
  .strict();
export type Manifest = z.infer<typeof schema>;
export function safeAttachmentPath(path: string): boolean {
  return (
    !Array.from(path).some((char) => char.charCodeAt(0) < 32) &&
    /^files\/[^/\\<>:"|?*]+$/u.test(path) &&
    !/[. ]$/u.test(path) &&
    !/^files\/(?:con|prn|aux|nul|com[0-9]|lpt[0-9])(?:\.|$)/iu.test(path)
  );
}
export function parseManifest(value: unknown): Manifest {
  if (typeof value === 'object' && value !== null && 'version' in value && value.version !== 1)
    throw new Error('Unsupported workspace format version.');
  const result = schema.safeParse(value);
  if (!result.success) throw new Error('Invalid workspace manifest.');
  const manifest = result.data;
  workspaceInput(manifest.workspace);
  const ids = new Set<string>();
  const orders = new Set<number>();
  for (const item of manifest.workspace.items) {
    if (ids.has(item.id) || orders.has(item.launchOrder))
      throw new Error('Invalid workspace manifest.');
    ids.add(item.id);
    orders.add(item.launchOrder);
    const loc = item.location;
    if (loc.kind === 'attachment') {
      if (item.type !== 'file' || !safeAttachmentPath(loc.path))
        throw new Error('Invalid attachment path.');
      itemInput({ ...item, target: 'C:\\ContextDock\\attachment.txt' });
    } else {
      if ((item.type === 'url') !== (loc.kind === 'url'))
        throw new Error('Invalid workspace manifest.');
      itemInput({ ...item, target: loc.kind === 'url' ? loc.url : loc.path });
    }
  }
  manifest.workspace.items.sort((a, b) => a.launchOrder - b.launchOrder);
  return manifest;
}

export function safeFileName(name: string): string {
  return (
    Array.from(name)
      .map((char) => (char.charCodeAt(0) < 32 || '<>:"/\\|?*'.includes(char) ? '_' : char))
      .join('')
      .replace(/[. ]+$/u, '')
      .slice(0, 120) || 'workspace'
  );
}
