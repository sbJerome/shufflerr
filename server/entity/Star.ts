import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import Media from './Media';
import Track from './Track';
import { User } from './User';

/** A starred/favourite track, album or artist (client APIs). Exactly one of track/media is set. */
@Entity()
@Unique('UQ_star_user_track_media', ['user', 'track', 'media'])
class Star {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @ManyToOne(() => Track, { nullable: true, eager: true, onDelete: 'CASCADE' })
  @Index()
  public track?: Track | null;

  /** Artist or release-group Media row. */
  @ManyToOne(() => Media, { nullable: true, eager: true, onDelete: 'CASCADE' })
  @Index()
  public media?: Media | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<Star>) {
    Object.assign(this, init);
  }
}

export default Star;
