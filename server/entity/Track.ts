import { MediaStatus } from '@server/constants/media';
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
import Media from './Media';

export interface TrackSourceIds {
  plex?: string;
  jellyfin?: string;
  navidrome?: string;
  localPath?: string;
  /** Plex part key / stream path, when known */
  plexPartKey?: string;
}

/** A recording on a release group's canonical tracklist (replaces Seerr's Season). */
@Entity()
@Unique('UQ_track_media_position', ['media', 'position'])
class Track {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Media, (media) => media.tracks, { onDelete: 'CASCADE' })
  @Index()
  public media: Media;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  public recordingMbid?: string | null;

  /** "01", or "1-07" for multi-disc releases */
  @Column({ type: 'varchar' })
  public position: string;

  @Column({ type: 'int', default: 1 })
  public discNumber: number;

  @Column({ type: 'int', default: 0 })
  public trackNumber: number;

  @Column({ type: 'varchar' })
  public title: string;

  @Column({ type: 'varchar', default: '' })
  public artistCredit: string;

  @Column({ type: 'int', nullable: true })
  public lengthMs?: number | null;

  @Column({ type: 'int', default: MediaStatus.UNKNOWN })
  @Index()
  public status: MediaStatus;

  /** e.g. "FLAC 16/44.1", "MP3 320" */
  @Column({ type: 'varchar', nullable: true })
  public fileFormat?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  public sourceIds?: TrackSourceIds | null;

  /** Precomputed waveform peaks (base64 Uint8 array), generated on scan. */
  @Column({ type: 'text', nullable: true, select: false })
  public peaks?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<Track>) {
    Object.assign(this, init);
  }
}

export default Track;
