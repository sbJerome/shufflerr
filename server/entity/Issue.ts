// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import type { IssueType } from '@server/constants/issue';
import { IssueStatus } from '@server/constants/issue';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import {
  AfterLoad,
  Column,
  Entity,
  Index,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import IssueComment from './IssueComment';
import Media from './Media';
import { User } from './User';

@Entity()
class Issue {
  @PrimaryGeneratedColumn()
  public id: number;

  @Column({ type: 'int' })
  @Index()
  public issueType: IssueType;

  @Column({ type: 'int', default: IssueStatus.OPEN })
  public status: IssueStatus;

  /** Track ids the problem applies to (missing/bad tracks); empty = whole album. */
  @Column({ type: 'simple-json', nullable: true })
  public problemTracks?: number[] | null;

  @ManyToOne(() => Media, (media) => media.issues, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public media: Media;

  @ManyToOne(() => User, (user) => user.createdIssues, {
    eager: true,
    onDelete: 'CASCADE',
  })
  @Index()
  public createdBy: User;

  @ManyToOne(() => User, {
    eager: true,
    onDelete: 'CASCADE',
    nullable: true,
  })
  @Index()
  public modifiedBy?: User;

  @OneToMany(() => IssueComment, (comment) => comment.issue, {
    cascade: true,
    eager: true,
  })
  public comments: IssueComment[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  @AfterLoad()
  sortComments() {
    this.comments?.sort((a, b) => a.id - b.id);
  }

  constructor(init?: Partial<Issue>) {
    Object.assign(this, init);
  }
}

export default Issue;
