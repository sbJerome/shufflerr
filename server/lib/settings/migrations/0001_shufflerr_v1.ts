import type { AllSettings } from '@server/lib/settings';

/**
 * v1 marker. Shufflerr starts with a fresh settings shape (it is a new
 * product, not an upgrade path from Seerr), so there is nothing to migrate.
 */
const shufflerrV1 = (settings: AllSettings): AllSettings => settings;

export default shufflerrV1;
