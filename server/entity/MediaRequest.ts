// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { RequestScope } from '@server/constants/media';
import { MediaRequestStatus } from '@server/constants/media';
import type {
  DryRunResult,
  MediaRequestBody,
} from '@server/interfaces/api/requestInterfaces';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import Media from './Media';
import TrackRequest from './TrackRequest';
import { User } from './User';

export class RequestPermissionError extends Error {}
export class QuotaRestrictedError extends Error {}
export class DuplicateMediaRequestError extends Error {}
export class BlocklistedMediaError extends Error {}

export type MediaRequestOptions = {
  isAutoRequest?: boolean;
};

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
  // STREAM(SV2): implement
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
    _requestBody: MediaRequestBody,
    _user: User,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- stub
    _options: MediaRequestOptions = {}
  ): Promise<MediaRequest | DryRunResult> {
    throw new Error('MediaRequest.request() is not implemented');
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
