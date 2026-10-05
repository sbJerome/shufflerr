import ExternalAPI from '@server/api/externalapi';
import cacheManager from '@server/lib/cache';
import { getSettings } from '@server/lib/settings';

export type CoverSize = 250 | 500 | 1200;

interface CaaImage {
  id: number | string;
  front: boolean;
  back: boolean;
  types: string[];
  image: string;
  thumbnails: Record<string, string>;
}

interface CaaListing {
  images: CaaImage[];
  release: string;
}

/**
 * Cover Art Archive. Shufflerr never hands a CAA/archive.org URL to the
 * browser: covers are always same-origin image-proxy paths
 * (`/imageproxy/caa/...`), which the proxy fetches, follows the redirect to
 * archive.org, and caches per `main.cacheImages`.
 */
class CoverArtArchive extends ExternalAPI {
  constructor() {
    super(
      'https://coverartarchive.org',
      {},
      {
        nodeCache: cacheManager.getCache('coverart').data,
        timeout: getSettings().network.apiRequestTimeout,
      }
    );
  }

  public static enabled(): boolean {
    return getSettings().metadata.coverArtArchive.enabled;
  }

  /** Image-proxy path for a release group's front cover, or null when CAA is off. */
  public static releaseGroupFront(
    releaseGroupMbid: string,
    size: CoverSize = 500
  ): string | null {
    if (!CoverArtArchive.enabled() || !releaseGroupMbid) {
      return null;
    }
    return `/imageproxy/caa/release-group/${releaseGroupMbid}/front-${size}`;
  }

  /** Image-proxy path for one release's (edition's) front cover, or null when CAA is off. */
  public static releaseFront(
    releaseMbid: string,
    size: CoverSize = 500
  ): string | null {
    if (!CoverArtArchive.enabled() || !releaseMbid) {
      return null;
    }
    return `/imageproxy/caa/release/${releaseMbid}/front-${size}`;
  }

  /** The art listing of a release group; null when it has none. Cached 24 h. */
  public async getReleaseGroupListing(
    releaseGroupMbid: string
  ): Promise<CaaListing | null> {
    try {
      return await this.get<CaaListing>(
        `/release-group/${releaseGroupMbid}`,
        undefined,
        86400
      );
    } catch {
      return null;
    }
  }

  /** True when the release group has a front image. */
  public async hasFront(releaseGroupMbid: string): Promise<boolean> {
    const listing = await this.getReleaseGroupListing(releaseGroupMbid);
    return !!listing?.images?.some((i) => i.front);
  }
}

export default CoverArtArchive;
