// STREAM(SV3): implement (music libraries only). Contract: each export is a
// LibraryScanner — { run(), status(), cancel() } — status() returns
// StatusBase & Partial<ScanStatus>.
import type { LibraryScanner } from '@server/lib/scanners/stub';
import { notImplementedScanner } from '@server/lib/scanners/stub';

export const jellyfinFullScanner: LibraryScanner =
  notImplementedScanner('Jellyfin Full Scan');
export const jellyfinRecentScanner: LibraryScanner = notImplementedScanner(
  'Jellyfin Recently Added Scan'
);
