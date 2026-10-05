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
import PlaylistItem from './PlaylistItem';
import { User } from './User';

/** User playlists, used by the OpenSubsonic and Jellyfin-compatible client APIs. */
@Entity()
class Playlist {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @Column({ type: 'varchar' })
  public name: string;

  @Column({ type: 'varchar', nullable: true })
  public comment?: string | null;

  @Column({ type: 'boolean', default: false })
  public isPublic: boolean;

  @OneToMany(() => PlaylistItem, (item) => item.playlist, { cascade: true })
  public items: PlaylistItem[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<Playlist>) {
    Object.assign(this, init);
  }
}

export default Playlist;
