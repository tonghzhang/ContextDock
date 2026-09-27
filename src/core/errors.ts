export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly code: 'VALIDATION' | 'NOT_FOUND' | 'DUPLICATE' | 'STORAGE' = 'VALIDATION',
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}
