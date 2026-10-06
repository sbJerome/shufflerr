import { getRepository } from '@server/datasource';
import type { User } from '@server/entity/User';
import UserPlaylist from '@server/entity/UserPlaylist';
import UserPlaylistItem from '@server/entity/UserPlaylistItem';
import type {
  PlaylistDetail,
  PlaylistItemResult,
  PlaylistResult,
} from '@server/interfaces/api/playlistInterfaces';
import {
  playlistCreate,
  playlistItemAdd,
  playlistReorder,
  playlistUpdate,
} from '@server/interfaces/api/playlistInterfaces';
import logger from '@server/logger';
import { Router } from 'express';
import { z } from 'zod';

const playlistRoutes = Router();

const INVALID = 'The details you entered are not valid. Check them and retry.';
const NOT_FOUND = 'That playlist could not be found.';
const GENERIC = 'Something went wrong. Try again in a moment.';

const sortItems = (items: UserPlaylistItem[] = []): UserPlaylistItem[] =>
  [...items].sort((a, b) => a.position - b.position || a.id - b.id);

const toItem = (item: UserPlaylistItem): PlaylistItemResult => ({
  id: item.id,
  mbid: item.mbid,
  mediaType: item.mediaType,
  title: item.title,
  artistName: item.artistName,
  position: item.position,
});

const toDetail = (playlist: UserPlaylist): PlaylistDetail => ({
  id: playlist.id,
  name: playlist.name,
  description: playlist.description ?? null,
  createdAt: playlist.createdAt.toISOString(),
  updatedAt: playlist.updatedAt.toISOString(),
  items: sortItems(playlist.items).map(toItem),
});

// Loads a playlist (with items) only if it belongs to the signed-in user.
const findOwned = (id: number, user: User): Promise<UserPlaylist | null> =>
  getRepository(UserPlaylist).findOne({
    where: { id, owner: { id: user.id } },
    relations: { items: true },
  });

// Bumps updatedAt without touching the (cascading) items relation, so the list
// sorts by most-recently-changed. A plain save() of a loaded entity would risk
// re-inserting or orphaning items through the OneToMany cascade.
const touch = (id: number): Promise<unknown> =>
  getRepository(UserPlaylist).update({ id }, { updatedAt: new Date() });

// GET /  — the signed-in user's own playlists
playlistRoutes.get<never, PlaylistResult[]>('/', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 401, message: GENERIC });
  }
  try {
    const playlists = await getRepository(UserPlaylist).find({
      where: { owner: { id: req.user.id } },
      relations: { items: true },
      order: { updatedAt: 'DESC' },
    });

    return res.json(
      playlists.map((playlist) => ({
        id: playlist.id,
        name: playlist.name,
        description: playlist.description ?? null,
        itemCount: playlist.items?.length ?? 0,
        createdAt: playlist.createdAt.toISOString(),
        updatedAt: playlist.updatedAt.toISOString(),
      }))
    );
  } catch (error) {
    logger.error('Failed to list playlists', {
      label: 'Playlist',
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return next({ status: 500, message: GENERIC });
  }
});

// POST /  — create a playlist
playlistRoutes.post<never, PlaylistDetail>('/', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 401, message: GENERIC });
  }
  try {
    const values = playlistCreate.parse(req.body);
    const playlist = await getRepository(UserPlaylist).save(
      new UserPlaylist({
        name: values.name,
        description: values.description ?? null,
        owner: req.user,
      })
    );
    return res.status(201).json(toDetail({ ...playlist, items: [] }));
  } catch (error) {
    if (error instanceof z.ZodError) {
      return next({ status: 400, message: INVALID });
    }
    logger.error('Failed to create playlist', {
      label: 'Playlist',
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return next({ status: 500, message: GENERIC });
  }
});

// GET /:id  — one playlist with its items (owner only)
playlistRoutes.get<{ id: string }, PlaylistDetail>(
  '/:id',
  async (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: GENERIC });
    }
    try {
      const playlist = await findOwned(Number(req.params.id), req.user);
      if (!playlist) {
        return next({ status: 404, message: NOT_FOUND });
      }
      return res.json(toDetail(playlist));
    } catch (error) {
      logger.error('Failed to load playlist', {
        label: 'Playlist',
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
      return next({ status: 500, message: GENERIC });
    }
  }
);

// PUT /:id  — rename / update description
playlistRoutes.put<{ id: string }, PlaylistDetail>(
  '/:id',
  async (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: GENERIC });
    }
    try {
      const values = playlistUpdate.parse(req.body);
      const playlist = await findOwned(Number(req.params.id), req.user);
      if (!playlist) {
        return next({ status: 404, message: NOT_FOUND });
      }
      if (values.name !== undefined) {
        playlist.name = values.name;
      }
      if (values.description !== undefined) {
        playlist.description = values.description;
      }
      const saved = await getRepository(UserPlaylist).save(playlist);
      return res.json(toDetail(saved));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next({ status: 400, message: INVALID });
      }
      logger.error('Failed to update playlist', {
        label: 'Playlist',
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
      return next({ status: 500, message: GENERIC });
    }
  }
);

// DELETE /:id  — delete a playlist (and its items, via cascade)
playlistRoutes.delete<{ id: string }>('/:id', async (req, res, next) => {
  if (!req.user) {
    return next({ status: 401, message: GENERIC });
  }
  try {
    const playlist = await findOwned(Number(req.params.id), req.user);
    if (!playlist) {
      return next({ status: 404, message: NOT_FOUND });
    }
    await getRepository(UserPlaylist).remove(playlist);
    return res.status(204).send();
  } catch (error) {
    logger.error('Failed to delete playlist', {
      label: 'Playlist',
      errorMessage: error instanceof Error ? error.message : 'unknown',
    });
    return next({ status: 500, message: GENERIC });
  }
});

// POST /:id/items  — add an album or track to a playlist (appended to the end)
playlistRoutes.post<{ id: string }, PlaylistDetail>(
  '/:id/items',
  async (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: GENERIC });
    }
    try {
      const values = playlistItemAdd.parse(req.body);
      const playlist = await findOwned(Number(req.params.id), req.user);
      if (!playlist) {
        return next({ status: 404, message: NOT_FOUND });
      }
      const nextPosition = (playlist.items ?? []).reduce(
        (max, item) => Math.max(max, item.position + 1),
        0
      );
      await getRepository(UserPlaylistItem).save(
        new UserPlaylistItem({
          playlist: { id: playlist.id } as UserPlaylist,
          mbid: values.mbid,
          mediaType: values.mediaType,
          title: values.title ?? '',
          artistName: values.artistName ?? '',
          position: nextPosition,
        })
      );
      await touch(playlist.id);
      const updated = await findOwned(playlist.id, req.user);
      return res.status(201).json(toDetail(updated as UserPlaylist));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next({ status: 400, message: INVALID });
      }
      logger.error('Failed to add playlist item', {
        label: 'Playlist',
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
      return next({ status: 500, message: GENERIC });
    }
  }
);

// DELETE /:id/items/:itemId  — remove one item
playlistRoutes.delete<{ id: string; itemId: string }, PlaylistDetail>(
  '/:id/items/:itemId',
  async (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: GENERIC });
    }
    try {
      const playlist = await findOwned(Number(req.params.id), req.user);
      if (!playlist) {
        return next({ status: 404, message: NOT_FOUND });
      }
      const itemId = Number(req.params.itemId);
      const item = (playlist.items ?? []).find((i) => i.id === itemId);
      if (!item) {
        return next({ status: 404, message: NOT_FOUND });
      }
      await getRepository(UserPlaylistItem).remove(item);
      await touch(playlist.id);
      const updated = await findOwned(playlist.id, req.user);
      return res.json(toDetail(updated as UserPlaylist));
    } catch (error) {
      logger.error('Failed to remove playlist item', {
        label: 'Playlist',
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
      return next({ status: 500, message: GENERIC });
    }
  }
);

// POST /:id/items/reorder  — set a new order from a list of item ids
playlistRoutes.post<{ id: string }, PlaylistDetail>(
  '/:id/items/reorder',
  async (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: GENERIC });
    }
    try {
      const values = playlistReorder.parse(req.body);
      const playlist = await findOwned(Number(req.params.id), req.user);
      if (!playlist) {
        return next({ status: 404, message: NOT_FOUND });
      }
      const items = playlist.items ?? [];
      const ids = new Set(items.map((item) => item.id));
      // The new order must be exactly the playlist's own items, no more, no less.
      if (
        values.itemIds.length !== items.length ||
        values.itemIds.some((id) => !ids.has(id)) ||
        new Set(values.itemIds).size !== values.itemIds.length
      ) {
        return next({ status: 400, message: INVALID });
      }
      const repository = getRepository(UserPlaylistItem);
      await Promise.all(
        values.itemIds.map((id, index) =>
          repository.update({ id }, { position: index })
        )
      );
      await touch(playlist.id);
      const updated = await findOwned(playlist.id, req.user);
      return res.json(toDetail(updated as UserPlaylist));
    } catch (error) {
      if (error instanceof z.ZodError) {
        return next({ status: 400, message: INVALID });
      }
      logger.error('Failed to reorder playlist', {
        label: 'Playlist',
        errorMessage: error instanceof Error ? error.message : 'unknown',
      });
      return next({ status: 500, message: GENERIC });
    }
  }
);

export default playlistRoutes;
