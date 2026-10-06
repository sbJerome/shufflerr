import { MediaType } from '@server/constants/media';
import { z } from 'zod';

/** Items reference an album (release group) or a track (recording) only. */
export const playlistItemMediaType = z.enum([
  MediaType.RELEASE_GROUP,
  MediaType.RECORDING,
]);

export const playlistCreate = z.object({
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(2000).optional(),
});

export const playlistUpdate = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
  })
  .refine((body) => body.name !== undefined || body.description !== undefined, {
    message: 'Nothing to update.',
  });

export const playlistItemAdd = z.object({
  mbid: z.string().uuid(),
  mediaType: playlistItemMediaType,
  title: z.coerce.string().trim().max(500).optional(),
  artistName: z.coerce.string().trim().max(500).optional(),
});

export const playlistReorder = z.object({
  /** Item ids in their new order, from first to last. */
  itemIds: z.array(z.number().int().positive()).min(1),
});

export interface PlaylistItemResult {
  id: number;
  mbid: string;
  mediaType: MediaType;
  title: string;
  artistName: string;
  position: number;
}

export interface PlaylistResult {
  id: number;
  name: string;
  description: string | null;
  itemCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface PlaylistDetail extends Omit<PlaylistResult, 'itemCount'> {
  items: PlaylistItemResult[];
}
