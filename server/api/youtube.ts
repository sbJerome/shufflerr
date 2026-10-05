import ExternalAPI from '@server/api/externalapi';
import { getSettings } from '@server/lib/settings';

/**
 * YouTube Data API v3 — search only. Shufflerr plays the result in YouTube's
 * own IFrame player; nothing is ever downloaded or extracted.
 * A search costs 100 quota units (default 10,000 a day), so callers cache.
 */

export interface YoutubeVideo {
  videoId: string;
  title: string;
  channel: string;
}

interface SearchResponse {
  items?: {
    id?: { videoId?: string };
    snippet?: { title?: string; channelTitle?: string };
  }[];
}

class YoutubeAPI extends ExternalAPI {
  constructor(apiKey: string) {
    super(
      'https://www.googleapis.com/youtube/v3',
      { key: apiKey },
      { timeout: getSettings().network.apiRequestTimeout }
    );
  }

  /** The best embeddable music video for "artist - title", or null. */
  public async searchTrack(
    artist: string,
    title: string,
    regionCode?: string
  ): Promise<YoutubeVideo | null> {
    const data = await this.get<SearchResponse>(
      '/search',
      {
        params: {
          part: 'snippet',
          type: 'video',
          videoCategoryId: 10,
          videoEmbeddable: 'true',
          maxResults: 1,
          q: `${artist} - ${title}`,
          ...(regionCode ? { regionCode: regionCode.toUpperCase() } : {}),
        },
      },
      0
    );
    const item = data.items?.find((i) => i.id?.videoId);
    if (!item?.id?.videoId) {
      return null;
    }
    return {
      videoId: item.id.videoId,
      title: item.snippet?.title ?? '',
      channel: item.snippet?.channelTitle ?? '',
    };
  }
}

export default YoutubeAPI;
