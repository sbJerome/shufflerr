import type { MediaType } from '@server/constants/media';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import UserPlaylist from './UserPlaylist';

/**
 * One entry in a {@link UserPlaylist}. Mirrors how a request/`Media` row points
 * at a MusicBrainz entity: an `mbid` plus its `mediaType` (a release group =
 * "album", or a recording = "track"), with the title and artist name snapshotted
 * at the time it was added so the list still renders if MusicBrainz is slow or
 * the entity later disappears. `position` is the 0-based order within the list.
 */
@Entity()
class UserPlaylistItem {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => UserPlaylist, (playlist) => playlist.items, {
    onDelete: 'CASCADE',
  })
  @Index()
  public playlist: UserPlaylist;

  @Column({ type: 'varchar' })
  @Index()
  public mbid: string;

  @Column({ type: 'varchar' })
  public mediaType: MediaType;

  @Column({ type: 'varchar', default: '' })
  public title: string;

  @Column({ type: 'varchar', default: '' })
  public artistName: string;

  @Column({ type: 'int', default: 0 })
  public position: number;

  constructor(init?: Partial<UserPlaylistItem>) {
    Object.assign(this, init);
  }
}

export default UserPlaylistItem;
