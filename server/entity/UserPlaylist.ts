import { User } from '@server/entity/User';
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
import UserPlaylistItem from './UserPlaylistItem';

/**
 * A Shufflerr-internal playlist a user curates in the web app. These are kept
 * entirely in Shufflerr's own database and are never synced to Plex, Navidrome
 * or Jellyfin. (The `Playlist`/`PlaylistItem` entities are a separate concept:
 * library playlists exposed through the Subsonic/Jellyfin client APIs, keyed on
 * local `Track` rows. This one stores MusicBrainz references like a request.)
 */
@Entity()
class UserPlaylist {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public name: string;

  @Column({ type: 'varchar', nullable: true })
  public description?: string | null;

  @ManyToOne(() => User, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public owner: User;

  @OneToMany(() => UserPlaylistItem, (item) => item.playlist, {
    cascade: true,
  })
  public items: UserPlaylistItem[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<UserPlaylist>) {
    Object.assign(this, init);
  }
}

export default UserPlaylist;
