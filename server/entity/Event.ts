import { DbAwareColumn } from '@server/utils/DbColumnHelper';
import { Column, Entity, Index, PrimaryGeneratedColumn, Unique } from 'typeorm';

export type EventProvider = 'ticketmaster' | 'skiddle';

/** Cached concert listing (purged per provider terms by the concerts-refresh job). */
@Entity()
@Unique('UQ_event_provider_external', ['provider', 'externalId'])
class Event {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'varchar' })
  public provider: EventProvider;

  @Column({ type: 'varchar' })
  public externalId: string;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  public artistMbid?: string | null;

  @Column({ type: 'varchar' })
  public artistName: string;

  @Column({ type: 'varchar', nullable: true })
  public name?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public venue?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public city?: string | null;

  @Column({ type: 'varchar', nullable: true })
  @Index()
  public country?: string | null;

  @DbAwareColumn({ type: 'datetime' })
  @Index()
  public startsAt: Date;

  @Column({ type: 'varchar' })
  public url: string;

  @Column({ type: 'varchar', nullable: true })
  public imageUrl?: string | null;

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public fetchedAt: Date;

  constructor(init?: Partial<Event>) {
    Object.assign(this, init);
  }
}

export default Event;
