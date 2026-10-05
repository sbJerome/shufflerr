import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { User } from './User';

export type LinkedAccountProvider = 'lastfm' | 'listenbrainz' | 'spotify';

/**
 * Per-user links to scrobbling/import services. Plex and Jellyfin stay on User
 * (as in Seerr). `secret` is encrypted with server/lib/secrets.ts.
 */
@Entity()
@Unique('UQ_linked_account_user_provider', ['user', 'provider'])
class LinkedAccount {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, (user) => user.linkedAccounts, { onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @Column({ type: 'varchar' })
  public provider: LinkedAccountProvider;

  @Column({ type: 'varchar', default: '' })
  public externalUsername: string;

  /** Encrypted: Last.fm session key / ListenBrainz user token / Spotify refresh token. */
  @Column({ type: 'text', select: false })
  public secret: string;

  @Column({ type: 'varchar', nullable: true })
  public scopes?: string | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public expiresAt?: Date | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public lastUsedAt?: Date | null;

  constructor(init?: Partial<LinkedAccount>) {
    Object.assign(this, init);
  }
}

export default LinkedAccount;
