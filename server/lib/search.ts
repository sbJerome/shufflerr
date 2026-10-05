/* eslint-disable @typescript-eslint/no-unused-vars -- stub signatures; remove when implemented */
// STREAM(SV1): implement — unified MusicBrainz search (artists, release groups,
// recordings) with library status merged from Media/Track.
import type { User } from '@server/entity/User';
import type { SearchResults } from '@server/models/music';

export type SearchType = 'all' | 'artist' | 'album' | 'track';

export interface SearchOptions {
  query: string;
  type?: SearchType;
  page?: number;
  pageSize?: number;
  user?: User;
}

export const searchMusic = async (
  _options: SearchOptions
): Promise<SearchResults> => {
  throw new Error('searchMusic() is not implemented');
};
