import type { DesktopApi } from '../shared/types';

declare global {
  interface Window {
    contextdock?: DesktopApi;
  }
}

export {};
