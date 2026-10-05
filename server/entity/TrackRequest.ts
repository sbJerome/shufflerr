// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/entity/SeasonRequest.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
import { MediaRequestStatus } from '@server/constants/media';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { MediaRequest } from './MediaRequest';
import Track from './Track';

@Entity()
class TrackRequest {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => MediaRequest, (request) => request.tracks, {
    onDelete: 'CASCADE',
  })
  @Index()
  public request: MediaRequest;

  @ManyToOne(() => Track, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public track: Track;

  @Column({ type: 'int', default: MediaRequestStatus.PENDING })
  public status: MediaRequestStatus;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<TrackRequest>) {
    Object.assign(this, init);
  }
}

export default TrackRequest;
