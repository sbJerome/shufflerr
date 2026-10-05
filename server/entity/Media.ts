// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type { User } from '@server/entity/User';
import type { DownloadingItem } from '@server/interfaces/api/mediaInterfaces';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  In,
  Index,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  Unique,
  UpdateDateColumn,
} from 'typeorm';
import { Blocklist } from './Blocklist';
import Issue from './Issue';
import { MediaRequest } from './MediaRequest';
import Track from './Track';
import { Watchlist } from './Watchlist';

/**
 * One row per MusicBrainz entity Shufflerr tracks: an artist or a release
 * group ("album" in the UI). Recordings live in Track.
 */
@Entity()
@Unique('UQ_media_type_mbid', ['mediaType', 'mbid'])
class Media {
  /** Media rows for a list of MBIDs (used to merge library status into search/browse results). */
  public static async getRelatedMedia(
    _user: User | undefined,
    items: { mbid: string; mediaType: MediaType }[]
  ): Promise<Media[]> {
    const mediaRepository = getRepository(Media);

    try {
      if (items.length === 0) {
        return [];
      }
      const mbids = [...new Set(items.map((i) => i.mbid))];
      const media = await mediaRepository.find({ where: { mbid: In(mbids) } });

      return media.filter((m) =>
        items.some((i) => i.mbid === m.mbid && i.mediaType === m.mediaType)
      );
    } catch (e) {
      logger.error(e.message);
      return [];
    }
  }

  public static async getMedia(
    mbid: string,
    mediaType: MediaType
  ): Promise<Media | undefined> {
    const mediaRepository = getRepository(Media);

    try {
      const media = await mediaRepository.findOne({
        where: { mbid, mediaType },
        relations: { requests: true, issues: true },
      });

      return media ?? undefined;
    } catch (e) {
      logger.error(e.message);
      return undefined;
    }
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  /** MusicBrainz ID (artist MBID or release-group MBID). */
  @Column({ type: 'varchar' })
  @Index()
  public mbid: string;

  /** For release groups: the primary artist's MBID. */
  @Column({ type: 'varchar', nullable: true })
  @Index()
  public artistMbid?: string | null;

  @Column({ type: 'varchar', default: '' })
  public title: string;

  @Column({ type: 'varchar', nullable: true })
  public artistName?: string | null;

  /** Album / Single / EP / Broadcast / Other */
  @Column({ type: 'varchar', nullable: true })
  public primaryType?: string | null;

  @Column({ type: 'simple-array', nullable: true })
  public secondaryTypes?: string[] | null;

  /** YYYY or YYYY-MM-DD */
  @Column({ type: 'varchar', nullable: true })
  public firstReleaseDate?: string | null;

  @Column({ type: 'int', default: MediaStatus.UNKNOWN })
  @Index()
  public status: MediaStatus;

  @Column({ type: 'int', nullable: true })
  public trackCount?: number | null;

  @Column({ type: 'int', default: 0 })
  public tracksAvailable: number;

  /** The MusicBrainz release (edition) whose tracklist is stored in Track. */
  @Column({ type: 'varchar', nullable: true })
  public releaseMbid?: string | null;

  @Column({ type: 'int', nullable: true })
  public lidarrServerId?: number | null;

  @Column({ type: 'int', nullable: true })
  public lidarrArtistId?: number | null;

  @Column({ type: 'int', nullable: true })
  public lidarrAlbumId?: number | null;

  /** True when Shufflerr (not the user) added the artist/album to Lidarr. */
  @Column({ type: 'boolean', default: false })
  public lidarrAddedByShufflerr: boolean;

  @Column({ type: 'varchar', nullable: true })
  public plexRatingKey?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public jellyfinItemId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public navidromeId?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public localPath?: string | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public lastScanAt?: Date | null;

  /** First time it became (partly) available. */
  @DbAwareColumn({ type: 'datetime', nullable: true })
  @Index()
  public mediaAddedAt?: Date | null;

  @OneToMany(() => MediaRequest, (request) => request.media, { cascade: true })
  public requests: MediaRequest[];

  @OneToMany(() => Track, (track) => track.media, { cascade: true })
  public tracks: Track[];

  @OneToMany(() => Watchlist, (watchlist) => watchlist.media)
  public watchlists: Watchlist[];

  @OneToMany(() => Issue, (issue) => issue.media, { cascade: true })
  public issues: Issue[];

  @OneToOne(() => Blocklist, (blocklist) => blocklist.media)
  public blocklist: Promise<Blocklist>;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  /** Filled by the download tracker (not a column). */
  public downloadStatus?: DownloadingItem[] = [];

  constructor(init?: Partial<Media>) {
    Object.assign(this, init);
  }

  /** Status to fall back to when no request is active any more. */
  public libraryStatus(): MediaStatus {
    if (this.mediaType !== MediaType.RELEASE_GROUP) {
      return this.tracksAvailable > 0
        ? MediaStatus.AVAILABLE
        : MediaStatus.UNKNOWN;
    }
    if (this.trackCount && this.tracksAvailable >= this.trackCount) {
      return MediaStatus.AVAILABLE;
    }
    return this.tracksAvailable > 0
      ? MediaStatus.PARTIALLY_AVAILABLE
      : MediaStatus.UNKNOWN;
  }
}

export const ACTIVE_REQUEST_STATUSES = [
  MediaRequestStatus.PENDING,
  MediaRequestStatus.APPROVED,
];

export default Media;
