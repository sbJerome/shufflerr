// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { User } from '@server/entity/User';
import type { PaginatedResponse } from '@server/interfaces/api/common';

export interface BlocklistItem {
  mbid: string;
  mediaType: string;
  title?: string;
  createdAt?: Date;
  user?: User;
  blocklistedTags?: string;
}

export interface BlocklistResultsResponse extends PaginatedResponse {
  results: BlocklistItem[];
}
