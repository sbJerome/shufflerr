import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './User';

/**
 * Per-app password for OpenSubsonic / Jellyfin-compatible clients.
 * `hash` (argon2id) verifies `p=` / apiKey auth; `encryptedSecret` (AES-GCM,
 * server/lib/secrets.ts) is needed for Subsonic token auth
 * (t = md5(password + salt)). Plaintext is shown once on creation.
 */
@Entity()
class AppPassword {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, (user) => user.appPasswords, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public user: User;

  @Column({ type: 'varchar' })
  public name: string;

  @Column({ type: 'varchar', select: false })
  public hash: string;

  @Column({ type: 'text', select: false })
  public encryptedSecret: string;

  /** Opaque access token issued by the Jellyfin-compatible API for this app password. */
  @Column({ type: 'varchar', nullable: true, select: false })
  @Index()
  public accessToken?: string | null;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public lastUsedAt?: Date | null;

  @Column({ type: 'varchar', nullable: true })
  public lastUsedClient?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<AppPassword>) {
    Object.assign(this, init);
  }
}

export default AppPassword;
