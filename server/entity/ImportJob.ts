import type { ImportMatch } from '@server/interfaces/api/importInterfaces';
import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  Index,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { User } from './User';

export type ImportSource = 'spotify' | 'deezer' | 'itunes';
export type ImportJobStatus = 'resolving' | 'ready' | 'requested' | 'failed';

/** A resolved import link, persisted so the Import page survives reloads. */
@Entity()
class ImportJob {
  @PrimaryGeneratedColumn()
  public id: number;

  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @Index()
  public user: User;

  @Column({ type: 'varchar' })
  public source: ImportSource;

  @Column({ type: 'varchar' })
  public url: string;

  @Column({ type: 'varchar', nullable: true })
  public title?: string | null;

  @Column({ type: 'varchar', default: 'resolving' })
  public status: ImportJobStatus;

  @Column({ type: 'varchar', nullable: true })
  public error?: string | null;

  @Column({ type: 'simple-json', nullable: true })
  public matched?: ImportMatch[] | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  constructor(init?: Partial<ImportJob>) {
    Object.assign(this, init);
  }
}

export default ImportJob;
