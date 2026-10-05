import type { ScanStatus } from '@server/interfaces/api/settingsInterfaces';
import type {
  RunnableScanner,
  StatusBase,
} from '@server/lib/scanners/baseScanner';
import logger from '@server/logger';

export type LibraryScanner = RunnableScanner<Partial<ScanStatus>>;

/**
 * Placeholder scanner used until the owning stream replaces the module.
 * It does nothing and reports idle. DELETE this file once no scanner uses it.
 */
export const notImplementedScanner = (name: string): LibraryScanner => ({
  run: async () => {
    logger.debug(`${name} is not implemented yet`, { label: 'Scanner' });
  },
  status: (): Partial<ScanStatus> & StatusBase => ({
    running: false,
    progress: 0,
    total: 0,
  }),
  cancel: () => undefined,
});
