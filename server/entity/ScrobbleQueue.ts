import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './User';

export type ScrobbleSource = 'plex' | 'jellyfin' | 'navidrome' | 'apps' | 'web';
export type ScrobbleTargetStatus = 'pending' | 'sent' | 'failed' | 'skipped';
export interface ScrobbleTargets {
  listenbrainz?: ScrobbleTargetStatus;
  lastfm?: ScrobbleTargetStatus;
}

/** Plays waiting to be (or already) submitted. Doubles as the play history ("Recently played"). */
@Entity()
class ScrobbleQueue {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @Column({ type: 'varchar', nullable: true })
  public recordingMbid?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public releaseGroupMbid?: string | null;

  /** Track row, when the play maps to a library track. */
  @Column({ type: 'int', nullable: true })
  public trackId?: number | null;

  @Column({ type: 'varchar' })
  public artist: string;

  @Column({ type: 'varchar' })
  public track: string;

  @Column({ type: 'varchar', nullable: true })
  public album?: string | null;

  @Column({ type: 'int', nullable: true })
  public durationMs?: number | null;

  @DbAwareColumn({ type: 'datetime' })
  @Index()
  public playedAt: Date;

  @Column({ type: 'varchar' })
  public source: ScrobbleSource;

  @Column({ type: 'simple-json' })
  public targets: ScrobbleTargets;

  @Column({ type: 'int', default: 0 })
  public attempts: number;

  @Column({ type: 'varchar', nullable: true })
  public lastError?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<ScrobbleQueue>) {
    Object.assign(this, init);
  }
}

export default ScrobbleQueue;
