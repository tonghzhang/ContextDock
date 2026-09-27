import { z } from 'zod';
import type { GitHubConnection, RemoteWorkspace } from '../shared/transfer';
import { MAX_ARCHIVE_BYTES, readArchive } from './archive';
export const connectionSchema = z
  .object({
    owner: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9-]+$/u),
    repository: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .regex(/^[a-zA-Z0-9_.-]+$/u),
    branch: z.string().trim().min(1).max(200).default('main'),
  })
  .strict();
const directory = 'contextdock/workspaces';
export class GitHubProvider {
  private readonly connection: GitHubConnection;
  constructor(
    connection: GitHubConnection,
    private readonly token: string,
    private readonly request: typeof fetch = fetch,
  ) {
    const result = connectionSchema.safeParse(connection);
    if (!result.success) throw new Error('Enter a valid GitHub owner, repository, and branch.');
    this.connection = result.data;
    if (!token) throw new Error('Set a GitHub token in Settings.');
  }
  private async api(
    path: string,
    init: RequestInit = {},
    raw = false,
    missingOK = false,
  ): Promise<Response> {
    const config = this.connection;
    let response: Response;
    try {
      response = await this.request(
        'https://api.github.com/repos/' +
          encodeURIComponent(config.owner) +
          '/' +
          encodeURIComponent(config.repository) +
          path,
        {
          ...init,
          redirect: 'error',
          signal: AbortSignal.timeout(30000),
          headers: {
            Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
            Authorization: 'Bearer ' + this.token,
            'X-GitHub-Api-Version': '2022-11-28',
            ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          },
        },
      );
    } catch {
      throw new Error('GitHub could not be reached. Check your connection and retry.');
    }
    if (missingOK && response.status === 404) return response;
    if (response.status === 401 || response.status === 403)
      throw new Error('GitHub access denied. Check token permissions and expiry.');
    if (response.status === 404)
      throw new Error('GitHub repository or branch was not found. Check access and settings.');
    if (response.status === 409 || response.status === 422)
      throw new Error('GitHub could not save the package. Check the branch and retry.');
    if (!response.ok) throw new Error('GitHub request failed. Please retry.');
    return response;
  }
  async testConnection(): Promise<void> {
    const repo = (await (await this.api('')).json()) as { private?: boolean; size?: number };
    if (!repo.private) throw new Error('Choose a private GitHub repository.');
    // A new, empty repository has no branch yet; the first upload creates it.
    if (repo.size !== 0) await this.api('/branches/' + encodeURIComponent(this.connection.branch));
  }
  private contentPath(path: string): string {
    if (!/^contextdock\/workspaces\/[0-9a-f-]{36}\.contextdock$/iu.test(path))
      throw new Error('Invalid remote workspace path.');
    return '/contents/' + path + '?ref=' + encodeURIComponent(this.connection.branch);
  }
  async download(path: string): Promise<Uint8Array> {
    const response = await this.api(this.contentPath(path), {}, true);
    if (Number(response.headers.get('content-length')) > MAX_ARCHIVE_BYTES)
      throw new Error('Workspace package exceeds the size limit.');
    if (!response.body) throw new Error('GitHub returned an empty package.');
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > MAX_ARCHIVE_BYTES) throw new Error('Workspace package exceeds the size limit.');
        chunks.push(value);
      }
    } catch (error) {
      await reader.cancel().catch(() => {});
      if (error instanceof Error && error.message === 'Workspace package exceeds the size limit.')
        throw error;
      throw new Error('GitHub download failed. Please retry.');
    } finally {
      reader.releaseLock();
    }
    return Buffer.concat(chunks);
  }
  async list(): Promise<RemoteWorkspace[]> {
    await this.testConnection();
    const response = await this.api(
      '/contents/' + directory + '?ref=' + encodeURIComponent(this.connection.branch),
      {},
      false,
      true,
    );
    if (response.status === 404) return [];
    const entries = z
      .array(z.object({ type: z.string(), path: z.string() }))
      .parse(await response.json());
    const results: RemoteWorkspace[] = [];
    for (const entry of entries) {
      if (
        entry.type !== 'file' ||
        !/^contextdock\/workspaces\/[0-9a-f-]{36}\.contextdock$/iu.test(entry.path)
      )
        continue;
      const { manifest } = readArchive(await this.download(entry.path));
      results.push({ path: entry.path, name: manifest.workspace.name });
    }
    return results;
  }
  async upload(workspaceId: string, data: Uint8Array): Promise<void> {
    if (data.length > MAX_ARCHIVE_BYTES)
      throw new Error('Workspace package exceeds the size limit.');
    await this.testConnection();
    const path = directory + '/' + workspaceId + '.contextdock';
    const previous = await this.api(this.contentPath(path), {}, false, true);
    let sha: string | undefined;
    if (previous.ok) sha = z.object({ sha: z.string() }).parse(await previous.json()).sha;
    await this.api('/contents/' + path, {
      method: 'PUT',
      body: JSON.stringify({
        message: 'Export ContextDock workspace',
        branch: this.connection.branch,
        content: Buffer.from(data).toString('base64'),
        ...(sha ? { sha } : {}),
      }),
    });
  }
}
