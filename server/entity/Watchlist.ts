// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { MediaType } from '@server/constants/media';
import { getRepository } from '@server/datasource';
import Media from '@server/entity/Media';
import { User } from '@server/entity/User';
import type { WatchlistItem } from '@server/interfaces/api/discoverInterfaces';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';

export class DuplicateWatchlistRequestError extends Error {}
export class NotFoundError extends Error {
  constructor(message = 'Not found') {
    super(message);
    this.name = 'NotFoundError';
  }
}

export type WatchlistSource = 'manual' | 'spotify' | 'plex-playlist';

/** Per-user wanted list ("follow artist" / wanted albums). Backlog UI. */
@Entity()
@Unique('UNIQUE_USER_DB', ['mbid', 'mediaType', 'requestedBy'])
export class Watchlist implements WatchlistItem {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ type: 'varchar', default: 'manual' })
  public source: WatchlistSource;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column({ type: 'varchar' })
  title = '';

  @Column({ type: 'varchar' })
  @Index()
  public mbid: string;

  @ManyToOne(() => User, (user) => user.watchlists, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public requestedBy: User;

  @ManyToOne(() => Media, (media) => media.watchlists, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<Watchlist>) {
    Object.assign(this, init);
  }

  public static async createWatchlist({
    watchlistRequest,
    user,
  }: {
    watchlistRequest: {
      mediaType: MediaType;
      title?: string;
      mbid: string;
      source?: WatchlistSource;
    };
    user: User;
  }): Promise<Watchlist> {
    const watchlistRepository = getRepository(this);
    const mediaRepository = getRepository(Media);

    const existing = await watchlistRepository.findOne({
      where: {
        mbid: watchlistRequest.mbid,
        mediaType: watchlistRequest.mediaType,
        requestedBy: { id: user.id },
      },
    });

    if (existing) {
      logger.warn('Duplicate request for watchlist blocked', {
        mbid: watchlistRequest.mbid,
        mediaType: watchlistRequest.mediaType,
        label: 'Watchlist',
      });

      throw new DuplicateWatchlistRequestError();
    }

    let media = await mediaRepository.findOne({
      where: {
        mbid: watchlistRequest.mbid,
        mediaType: watchlistRequest.mediaType,
      },
    });

    if (!media) {
      media = new Media({
        mbid: watchlistRequest.mbid,
        mediaType: watchlistRequest.mediaType,
        title: watchlistRequest.title ?? '',
      });
    }

    const watchlist = new this({
      ...watchlistRequest,
      title: watchlistRequest.title ?? '',
      requestedBy: user,
      media,
    });

    await mediaRepository.save(media);
    await watchlistRepository.save(watchlist);
    return watchlist;
  }

  public static async deleteWatchlist(
    mbid: Watchlist['mbid'],
    mediaType: MediaType,
    user: User
  ): Promise<Watchlist | null> {
    const watchlistRepository = getRepository(this);
    const watchlist = await watchlistRepository.findOneBy({
      mbid,
      mediaType,
      requestedBy: { id: user.id },
    });
    if (!watchlist) {
      throw new NotFoundError('not Found');
    }

    await watchlistRepository.delete(watchlist.id);

    return watchlist;
  }
}
