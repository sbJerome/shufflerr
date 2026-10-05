// STREAM(SV2): implement — sync monitored artists/albums from every Lidarr
// server with syncEnabled into Media rows (lidarrArtistId / lidarrAlbumId).
import type { LibraryScanner } from '@server/lib/scanners/stub';
import { notImplementedScanner } from '@server/lib/scanners/stub';

export const lidarrScanner: LibraryScanner =
  notImplementedScanner('Lidarr Scan');
