// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import { getRepository } from '@server/datasource';
import type {
  DryRunResult,
  MediaRequestBody,
} from '@server/interfaces/api/requestInterfaces';
import { ensureMedia, getDiscographyReleaseGroups } from '@server/lib/metadata';
import { Permission } from '@server/lib/permissions';
import { emitMediaUpdate } from '@server/lib/realtime';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  In,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Blocklist } from './Blocklist';
import Media from './Media';
import Track from './Track';
import TrackRequest from './TrackRequest';
import { User } from './User';

export class RequestPermissionError extends Error {}
export class QuotaRestrictedError extends Error {}
export class DuplicateMediaRequestError extends Error {}
export class BlocklistedMediaError extends Error {}
/** The body itself is wrong (unknown scope, MBID of the wrong kind, …) → 400. */
export class RequestValidationError extends Error {}

export type MediaRequestOptions = {
  isAutoRequest?: boolean;
};

/** Statuses that still "hold" a media item (duplicate checks, media status). */
export const ACTIVE_STATUSES = [
  MediaRequestStatus.PENDING,
  MediaRequestStatus.APPROVED,
];

const SCOPE_NOUN: Record<RequestScope, string> = {
  [RequestScope.ALBUM]: 'albums',
  [RequestScope.TRACKS]: 'tracks',
  [RequestScope.DISCOGRAPHY]: 'discographies',
};

const SCOPE_PERMISSION: Record<RequestScope, [Permission, Permission]> = {
  [RequestScope.ALBUM]: [
    Permission.REQUEST_ALBUM,
    Permission.AUTO_APPROVE_ALBUM,
  ],
  [RequestScope.TRACKS]: [
    Permission.REQUEST_TRACK,
    Permission.AUTO_APPROVE_TRACK,
  ],
  [RequestScope.DISCOGRAPHY]: [
    Permission.REQUEST_DISCOGRAPHY,
    Permission.AUTO_APPROVE_DISCOGRAPHY,
  ],
};

/** "weekly" for 7 days, otherwise "14-day" … */
const periodAdjective = (days?: number): string =>
  !days || days === 7 ? 'weekly' : `${days}-day`;

const plural = (n: number, one: string, many: string): string =>
  `${n} ${n === 1 ? one : many}`;

const blockedCode = (e: Error): DryRunResult['code'] => {
  if (e instanceof RequestPermissionError) return 'permission';
  if (e instanceof QuotaRestrictedError) return 'quota';
  if (e instanceof BlocklistedMediaError) return 'blocklisted';
  if (e instanceof DuplicateMediaRequestError) {
    return e.message === ALREADY_IN_LIBRARY ? 'available' : 'duplicate';
  }
  return 'error';
};

const ALREADY_REQUESTED = 'This has already been requested.';
const ALREADY_IN_LIBRARY = 'This is already in the library.';

@Entity()
@Index('IDX_request_media_scope_status', ['media', 'scope', 'status'])
export class MediaRequest {
  /**
   * The request engine. Order of checks is fixed by
   * docs/PERMISSIONS_AND_APPROVALS.md (acting user → permission → quota →
   * blocklist → duplicate → already available → auto-approve → dry run →
   * create).
   *
   * With `dryRun` nothing is written and a DryRunResult is returned (errors
   * map to `{ outcome: 'blocked', reason }`).
   */
  public static async request(
    requestBody: MediaRequestBody & { dryRun: true },
    user: User,
    options?: MediaRequestOptions
  ): Promise<DryRunResult>;
  public static async request(
    requestBody: MediaRequestBody,
    user: User,
    options?: MediaRequestOptions
  ): Promise<MediaRequest>;
  public static async request(
    requestBody: MediaRequestBody,
    user: User,
    options: MediaRequestOptions = {}
  ): Promise<MediaRequest | DryRunResult> {
    if (!requestBody.dryRun) {
      return MediaRequest.evaluate(requestBody, user, options);
    }

    try {
      return await MediaRequest.evaluate(requestBody, user, options);
    } catch (e) {
      if (
        e instanceof RequestPermissionError ||
        e instanceof QuotaRestrictedError ||
        e instanceof DuplicateMediaRequestError ||
        e instanceof BlocklistedMediaError ||
        e instanceof RequestValidationError
      ) {
        return { outcome: 'blocked', reason: e.message, code: blockedCode(e) };
      }

      logger.error('Could not evaluate a request', {
        label: 'Media Request',
        errorMessage: e.message,
        mbid: requestBody.mbid,
      });
      return {
        outcome: 'blocked',
        reason: "Couldn't check this request right now. Try again in a moment.",
        code: 'error',
      };
    }
  }

  private static async evaluate(
    requestBody: MediaRequestBody,
    user: User,
    options: MediaRequestOptions
  ): Promise<MediaRequest | DryRunResult> {
    const settings = getSettings();
    const userRepository = getRepository(User);
    const requestRepository = getRepository(MediaRequest);
    const trackRepository = getRepository(Track);
    const mediaRepository = getRepository(Media);

    const scope = requestBody.scope;
    if (!Object.values(RequestScope).includes(scope)) {
      throw new RequestValidationError(
        'Choose what to request: tracks, the album or the discography.'
      );
    }
    if (!requestBody.mbid) {
      throw new RequestValidationError(
        'The request is missing a MusicBrainz ID.'
      );
    }
    const mediaType =
      scope === RequestScope.DISCOGRAPHY
        ? MediaType.ARTIST
        : MediaType.RELEASE_GROUP;
    if (requestBody.mediaType && requestBody.mediaType !== mediaType) {
      throw new RequestValidationError(
        scope === RequestScope.DISCOGRAPHY
          ? 'A discography request needs an artist.'
          : 'An album or track request needs an album.'
      );
    }

    // 1. Acting user
    let requestUser = user;
    if (requestBody.userId && requestBody.userId !== user.id) {
      if (
        !user.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        throw new RequestPermissionError(
          "You don't have permission to request for someone else."
        );
      }
      const found = await userRepository.findOne({
        where: { id: requestBody.userId },
      });
      if (!found) {
        throw new RequestValidationError(
          "The user you're requesting for doesn't exist any more."
        );
      }
      requestUser = found;
    }

    // 2. Permission
    const [requestPermission, autoApprovePermission] = SCOPE_PERMISSION[scope];
    if (
      !requestUser.hasPermission([Permission.REQUEST, requestPermission], {
        type: 'or',
      })
    ) {
      throw new RequestPermissionError(
        `You don't have permission to request ${SCOPE_NOUN[scope]}.`
      );
    }
    if (scope === RequestScope.TRACKS && !settings.main.allowTrackRequests) {
      throw new RequestPermissionError(
        'Track requests are turned off. Request the whole album instead.'
      );
    }

    // Advanced fields are silently dropped without REQUEST_ADVANCED (Seerr behavior).
    const useAdvanced = user.hasPermission(
      [Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS],
      { type: 'or' }
    );
    const advanced = useAdvanced
      ? {
          serverId: requestBody.serverId ?? null,
          qualityProfileId: requestBody.qualityProfileId ?? null,
          metadataProfileId: requestBody.metadataProfileId ?? null,
          rootFolder: requestBody.rootFolder ?? null,
        }
      : {
          serverId: null,
          qualityProfileId: null,
          metadataProfileId: null,
          rootFolder: null,
        };

    if (
      requestBody.ignoreQuota &&
      !user.hasPermission(Permission.MANAGE_REQUESTS)
    ) {
      throw new RequestPermissionError(
        "You don't have permission to go over request limits."
      );
    }
    const ignoreQuota = !!requestBody.ignoreQuota;

    // Resolve what is being asked for (needed to count against quotas). Errors
    // are still raised in the documented order below.
    const media = await ensureMedia(requestBody.mbid, mediaType, {
      withTracks: mediaType === MediaType.RELEASE_GROUP,
    });

    const activeOnMedia = await requestRepository.find({
      where: { media: { id: media.id }, status: In(ACTIVE_STATUSES) },
    });

    let artistMedia: Media | null = null;
    if (mediaType === MediaType.RELEASE_GROUP && media.artistMbid) {
      artistMedia = await mediaRepository.findOne({
        where: { mbid: media.artistMbid, mediaType: MediaType.ARTIST },
      });
    }
    const coveringDiscography = artistMedia
      ? await requestRepository.findOne({
          where: {
            media: { id: artistMedia.id },
            scope: RequestScope.DISCOGRAPHY,
            status: In(ACTIVE_STATUSES),
          },
        })
      : null;

    let duplicate = false;
    let alreadyAvailable = false;
    let requestedTracks: Track[] = [];
    let releaseCount = 0;

    if (scope === RequestScope.DISCOGRAPHY) {
      duplicate = activeOnMedia.some(
        (r) => r.scope === RequestScope.DISCOGRAPHY
      );
      releaseCount = await MediaRequest.countDiscographyReleases(
        media.mbid,
        requestBody.releaseCount
      );
    } else {
      const albumTracks = await trackRepository.find({
        where: { media: { id: media.id } },
        order: { discNumber: 'ASC', trackNumber: 'ASC' },
      });
      const everyTrackAvailable =
        albumTracks.length > 0
          ? albumTracks.every((t) => t.status === MediaStatus.AVAILABLE)
          : media.libraryStatus() === MediaStatus.AVAILABLE;

      if (scope === RequestScope.ALBUM) {
        duplicate =
          activeOnMedia.some((r) => r.scope === RequestScope.ALBUM) ||
          !!coveringDiscography;
        alreadyAvailable = everyTrackAvailable;
      } else {
        const wanted = requestBody.trackMbids?.length
          ? new Set(requestBody.trackMbids)
          : null;
        let candidates = wanted
          ? albumTracks.filter(
              (t) => !!t.recordingMbid && wanted.has(t.recordingMbid)
            )
          : albumTracks;

        if (wanted && candidates.length === 0) {
          throw new RequestValidationError(
            "Those tracks aren't on this album. Reload the page and pick again."
          );
        }

        const missing = candidates.filter(
          (t) => t.status !== MediaStatus.AVAILABLE
        );
        if (missing.length === 0) {
          alreadyAvailable = true;
        }
        candidates = missing;

        // Duplicates are per track: drop the ones an active request already covers.
        const wholeAlbumCovered =
          activeOnMedia.some((r) => r.scope === RequestScope.ALBUM) ||
          !!coveringDiscography;
        const coveredTrackIds = new Set(
          activeOnMedia
            .filter((r) => r.scope === RequestScope.TRACKS)
            .flatMap((r) => (r.tracks ?? []).map((tr) => tr.track?.id))
        );
        const remaining = wholeAlbumCovered
          ? []
          : candidates.filter((t) => !coveredTrackIds.has(t.id));

        if (!alreadyAvailable && remaining.length === 0) {
          duplicate = true;
        }
        requestedTracks = remaining;
      }
    }

    // 3. Quota
    if (!ignoreQuota) {
      const quotas = await requestUser.getQuota();

      if (scope === RequestScope.ALBUM && quotas.album.restricted) {
        throw new QuotaRestrictedError(
          `You've used your ${periodAdjective(quotas.album.days)} limit of ${plural(
            quotas.album.limit ?? 0,
            'album',
            'albums'
          )}.`
        );
      }
      if (
        scope === RequestScope.DISCOGRAPHY &&
        quotas.album.limit &&
        releaseCount > (quotas.album.remaining ?? 0)
      ) {
        throw new QuotaRestrictedError(
          `A discography counts each release against your album limit. You have ${
            quotas.album.remaining ?? 0
          } left.`
        );
      }
      if (
        scope === RequestScope.TRACKS &&
        quotas.track.limit &&
        requestedTracks.length > (quotas.track.remaining ?? 0)
      ) {
        throw new QuotaRestrictedError(
          `That's more tracks than your limit allows (${
            quotas.track.remaining ?? 0
          } left).`
        );
      }
    }

    // 4. Blocklist
    if (await MediaRequest.isBlocklisted(media, artistMedia)) {
      throw new BlocklistedMediaError(
        "This has been blocked, so it can't be requested."
      );
    }

    // 5. Duplicate
    if (duplicate) {
      throw new DuplicateMediaRequestError(ALREADY_REQUESTED);
    }

    // 6. Already available
    if (alreadyAvailable) {
      throw new DuplicateMediaRequestError(ALREADY_IN_LIBRARY);
    }

    // 7. Auto-approve
    let auto = requestUser.hasPermission(
      [Permission.AUTO_APPROVE, autoApprovePermission],
      { type: 'or' }
    );
    if (
      scope === RequestScope.DISCOGRAPHY &&
      settings.main.discographyAlwaysReview &&
      !(requestUser.permissions & Permission.ADMIN)
    ) {
      auto = false;
    }

    // 8. Dry run
    if (requestBody.dryRun) {
      return {
        outcome: auto ? 'auto' : 'pending',
        trackCount: requestedTracks.length,
        releaseCount,
      };
    }

    // 9. Create
    const request = new MediaRequest({
      status: auto ? MediaRequestStatus.APPROVED : MediaRequestStatus.PENDING,
      scope,
      media,
      requestedBy: requestUser,
      modifiedBy: auto ? requestUser : null,
      isAutoApproved: auto,
      isAutoRequest: !!(options.isAutoRequest ?? requestBody.isAutoRequest),
      ignoreQuota,
      releaseCount,
      trackCount: requestedTracks.length,
      tracks: requestedTracks.map(
        (track) =>
          new TrackRequest({
            track,
            status: auto
              ? MediaRequestStatus.APPROVED
              : MediaRequestStatus.PENDING,
          })
      ),
      ...advanced,
      isHiRes: useAdvanced ? !!requestBody.isHiRes : false,
      monitorFuture: !!requestBody.monitorFuture,
    });

    const saved = await requestRepository.save(request);
    await MediaRequest.applyMediaStatus(media, [...activeOnMedia, saved]);

    logger.info('Created a request', {
      label: 'Media Request',
      requestId: saved.id,
      scope,
      mbid: media.mbid,
      requestedBy: requestUser.id,
      autoApproved: auto,
    });

    return saved;
  }

  /**
   * Release groups a discography request covers: what MusicBrainz lists for the
   * artist minus what the library already has in full. Falls back to the
   * caller's number when MusicBrainz can't be reached.
   */
  private static async countDiscographyReleases(
    artistMbid: string,
    fallback?: number
  ): Promise<number> {
    try {
      const releaseGroups = await getDiscographyReleaseGroups(artistMbid);
      if (releaseGroups.length === 0) {
        return Math.max(1, fallback ?? 1);
      }
      const inLibrary = await getRepository(Media).find({
        where: {
          mbid: In(releaseGroups.map((rg) => rg.mbid)),
          mediaType: MediaType.RELEASE_GROUP,
          status: MediaStatus.AVAILABLE,
        },
        select: { id: true, mbid: true },
      });
      return Math.max(1, releaseGroups.length - inLibrary.length);
    } catch (e) {
      logger.warn('Could not count the discography; using the given number', {
        label: 'Media Request',
        artistMbid,
        errorMessage: e.message,
      });
      return Math.max(1, fallback ?? 1);
    }
  }

  private static async isBlocklisted(
    media: Media,
    artistMedia: Media | null
  ): Promise<boolean> {
    if (
      media.status === MediaStatus.BLOCKLISTED ||
      artistMedia?.status === MediaStatus.BLOCKLISTED
    ) {
      return true;
    }
    const where = [{ mbid: media.mbid, mediaType: media.mediaType }];
    if (media.artistMbid) {
      where.push({ mbid: media.artistMbid, mediaType: MediaType.ARTIST });
    }
    return (await getRepository(Blocklist).count({ where })) > 0;
  }

  /**
   * Sets `media.status` from its library state and the given active requests
   * (APPROVED → PROCESSING, PENDING → PENDING, none → library status) and
   * saves it when it changed. Fully available and blocklisted items are left
   * alone.
   */
  private static async applyMediaStatus(
    media: Media,
    activeRequests: Pick<MediaRequest, 'status'>[]
  ): Promise<void> {
    const library = media.libraryStatus();
    let next: MediaStatus;

    if (media.status === MediaStatus.BLOCKLISTED) {
      return;
    }
    if (library === MediaStatus.AVAILABLE) {
      next = MediaStatus.AVAILABLE;
    } else if (
      activeRequests.some((r) => r.status === MediaRequestStatus.APPROVED)
    ) {
      next = MediaStatus.PROCESSING;
    } else if (
      activeRequests.some((r) => r.status === MediaRequestStatus.PENDING)
    ) {
      next = MediaStatus.PENDING;
    } else {
      next = library;
    }

    if (media.status !== next) {
      media.status = next;
      await getRepository(Media).update(media.id, { status: next });
      emitMediaUpdate({
        mediaId: media.id,
        mbid: media.mbid,
        mediaType: media.mediaType,
        status: next,
      });
    }
  }

  /**
   * Recalculate a Media row's status after a request was created, declined,
   * failed, completed or deleted.
   */
  public static async refreshMediaStatus(mediaId: number): Promise<void> {
    const media = await getRepository(Media).findOne({
      where: { id: mediaId },
    });
    if (!media) {
      return;
    }
    const active = await getRepository(MediaRequest).find({
      where: { media: { id: mediaId }, status: In(ACTIVE_STATUSES) },
      select: { id: true, status: true },
      loadEagerRelations: false,
    });
    await MediaRequest.applyMediaStatus(media, active);
  }

  /**
   * Marks approved requests for a Media row COMPLETED once what they asked for
   * is in the library (tracks: every requested track AVAILABLE; album: the
   * whole release group AVAILABLE). Scanners and the availability sync call
   * this after updating Track/Media; the request subscriber then sends the
   * `available` notification. Returns the requests it completed.
   *
   * This is the ONLY place album/tracks requests become COMPLETED (the library
   * layer's completeReleaseGroupRequests delegates here), so the notification
   * is sent exactly once. `fullyAvailable` lets a caller that has just counted
   * the tracks pass the answer before the Media row is written.
   */
  public static async completeSatisfied(
    mediaId: number,
    options: { fullyAvailable?: boolean } = {}
  ): Promise<MediaRequest[]> {
    const requestRepository = getRepository(MediaRequest);
    const approved = await requestRepository.find({
      where: {
        media: { id: mediaId },
        status: MediaRequestStatus.APPROVED,
        scope: In([RequestScope.ALBUM, RequestScope.TRACKS]),
      },
    });
    const completed: MediaRequest[] = [];

    for (const request of approved) {
      const satisfied =
        request.scope === RequestScope.ALBUM ||
        (request.tracks ?? []).length === 0
          ? (options.fullyAvailable ??
            request.media.libraryStatus() === MediaStatus.AVAILABLE)
          : (request.tracks ?? []).length > 0 &&
            request.tracks.every(
              (tr) => tr.track?.status === MediaStatus.AVAILABLE
            );

      if (satisfied) {
        request.status = MediaRequestStatus.COMPLETED;
        request.downloadProgress = 100;
        for (const tr of request.tracks ?? []) {
          tr.status = MediaRequestStatus.COMPLETED;
        }
        completed.push(await requestRepository.save(request));
      }
    }

    return completed;
  }

  /**
   * Marks the approved discography requests of an artist COMPLETED. Callers
   * decide WHEN the discography is in (library layer: every covered release
   * group available; Lidarr scan: every monitored album has its files); this
   * is the single place the status changes, so `available` is sent once.
   */
  public static async completeDiscography(
    artistMediaId: number
  ): Promise<MediaRequest[]> {
    const requestRepository = getRepository(MediaRequest);
    const requests = await requestRepository.find({
      where: {
        media: { id: artistMediaId },
        scope: RequestScope.DISCOGRAPHY,
        status: MediaRequestStatus.APPROVED,
      },
    });
    const completed: MediaRequest[] = [];

    for (const request of requests) {
      request.status = MediaRequestStatus.COMPLETED;
      request.downloadProgress = 100;
      completed.push(await requestRepository.save(request));
    }

    return completed;
  }

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'integer', default: MediaRequestStatus.PENDING })
  public status: MediaRequestStatus;

  @Column({ type: 'varchar' })
  public scope: RequestScope;

  /** Release group for tracks/album scope; artist for discography scope. */
  @ManyToOne(() => Media, (media) => media.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @ManyToOne(() => User, (user) => user.requests, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public requestedBy: User;

  /** Who approved/declined; the requester when auto-approved. */
  @ManyToOne(() => User, {
    nullable: true,
    cascade: true,
    eager: true,
    onDelete: 'SET NULL',
  })
  @Index()
  public modifiedBy?: User | null;

  @Column({ type: 'boolean', default: false })
  public isAutoApproved: boolean;

  @Column({ type: 'boolean', default: false })
  public isAutoRequest: boolean;

  @Column({ type: 'boolean', default: false })
  public ignoreQuota: boolean;

  /** Discography: number of release groups included (counts against the album quota). */
  @Column({ type: 'int', default: 0 })
  public releaseCount: number;

  /** Tracks scope: number of tracks requested (counts against the track quota). */
  @Column({ type: 'int', default: 0 })
  public trackCount: number;

  @OneToMany(() => TrackRequest, (track) => track.request, {
    eager: true,
    cascade: true,
  })
  public tracks: TrackRequest[];

  /** Lidarr instance (default when null). */
  @Column({ type: 'int', nullable: true })
  public serverId?: number | null;

  @Column({ type: 'int', nullable: true })
  public qualityProfileId?: number | null;

  @Column({ type: 'int', nullable: true })
  public metadataProfileId?: number | null;

  @Column({ type: 'varchar', nullable: true })
  public rootFolder?: string | null;

  @Column({ type: 'boolean', default: false })
  public isHiRes: boolean;

  @Column({ type: 'boolean', default: false })
  public monitorFuture: boolean;

  /** 0–100 from the download sync job. */
  @Column({ type: 'int', nullable: true })
  public downloadProgress?: number | null;

  @Column({ type: 'varchar', nullable: true })
  public failureReason?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public declineReason?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<MediaRequest>) {
    Object.assign(this, init);
  }
}

export default MediaRequest;
