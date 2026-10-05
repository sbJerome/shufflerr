// STREAM(SV3): implement — Navidrome scan over the Subsonic/OpenSubsonic API.
import type { LibraryScanner } from '@server/lib/scanners/stub';
import { notImplementedScanner } from '@server/lib/scanners/stub';

export const navidromeScanner: LibraryScanner = notImplementedScanner(
  'Navidrome Library Scan'
);
