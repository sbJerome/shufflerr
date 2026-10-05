// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity()
class OverrideRule {
  @PrimaryGeneratedColumn()
  public id: number;

  /** Lidarr instance the rule routes to. */
  @Column({ type: 'int', nullable: true })
  public lidarrServiceId?: number;

  @Column({ nullable: true })
  public users?: string;

  @Column({ nullable: true })
  public genre?: string;

  /** Record label names/MBIDs, comma-separated. */
  @Column({ nullable: true })
  public label?: string;

  /** Release primary types (Album, EP, Single…), comma-separated. */
  @Column({ nullable: true })
  public primaryType?: string;

  @Column({ type: 'int', nullable: true })
  public profileId?: number;

  @Column({ type: 'int', nullable: true })
  public metadataProfileId?: number;

  @Column({ nullable: true })
  public rootFolder?: string;

  @Column({ nullable: true })
  public tags?: string;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  constructor(init?: Partial<OverrideRule>) {
    Object.assign(this, init);
  }
}

export default OverrideRule;
