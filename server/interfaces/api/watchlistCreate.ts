// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { MediaType } from '@server/constants/media';
import { z } from 'zod';

export const watchlistCreate = z.object({
  mbid: z.string().uuid(),
  mediaType: z.nativeEnum(MediaType),
  title: z.coerce.string().optional(),
  source: z.enum(['manual', 'spotify', 'plex-playlist']).optional(),
});
