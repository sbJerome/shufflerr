import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import Playlist from './Playlist';
import Track from './Track';

@Entity()
class PlaylistItem {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => Playlist, (playlist) => playlist.items, {
    onDelete: 'CASCADE',
  })
  @Index()
  public playlist: Playlist;

  @ManyToOne(() => Track, { eager: true, onDelete: 'CASCADE' })
  @Index()
  public track: Track;

  @Column({ type: 'int', default: 0 })
  public position: number;

  constructor(init?: Partial<PlaylistItem>) {
    Object.assign(this, init);
  }
}

export default PlaylistItem;
