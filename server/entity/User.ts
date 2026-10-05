// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { MediaRequestStatus, RequestScope } from '@server/constants/media';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { Watchlist } from '@server/entity/Watchlist';
import type { QuotaResponse } from '@server/interfaces/api/userInterfaces';
import PreparedEmail from '@server/lib/email';
import type { PermissionCheckOptions } from '@server/lib/permissions';
import { Permission, hasPermission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { DbAwareColumn, resolveDbType } from '@server/utils/DbColumnHelper';
import bcrypt from 'bcrypt';
import { randomUUID } from 'crypto';
import { nanoid } from 'nanoid';
import path from 'path';
import {
  AfterLoad,
  Column,
  Entity,
  OneToMany,
  OneToOne,
  PrimaryGeneratedColumn,
  RelationCount,
  UpdateDateColumn,
} from 'typeorm';
import AppPassword from './AppPassword';
import Issue from './Issue';
import LinkedAccount from './LinkedAccount';
import { MediaRequest } from './MediaRequest';
import { UserPushSubscription } from './UserPushSubscription';
import { UserSettings } from './UserSettings';

@Entity()
export class User {
  public static filterMany(
    users: User[],
    showFiltered?: boolean
  ): Partial<User>[] {
    return users.map((u) => u.filter(showFiltered));
  }

  static readonly filteredFields: string[] = [
    'email',
    'plexId',
    'password',
    'resetPasswordGuid',
    'jellyfinDeviceId',
    'jellyfinAuthToken',
    'plexToken',
    'settings',
  ];

  static readonly serializationExcludedFields: string[] = ['settings'];

  public displayName: string;

  @PrimaryGeneratedColumn()
  public id: number;

  @Column({
    unique: true,
    transformer: {
      from: (value: string): string => (value ?? '').toLowerCase(),
      to: (value: string): string => (value ?? '').toLowerCase(),
    },
  })
  public email: string;

  @Column({ type: 'varchar', nullable: true })
  public plexUsername?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public jellyfinUsername?: string | null;

  @Column({ nullable: true })
  public username?: string;

  @Column({ nullable: true, select: false })
  public password?: string;

  @Column({ nullable: true, select: false })
  public resetPasswordGuid?: string;

  @DbAwareColumn({ type: 'datetime', nullable: true })
  public recoveryLinkExpirationDate?: Date | null;

  @Column({ type: 'integer', default: UserType.PLEX })
  public userType: UserType;

  @Column({ type: 'integer', nullable: true, select: true })
  public plexId?: number | null;

  @Column({ type: 'varchar', nullable: true })
  public jellyfinUserId?: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  public jellyfinDeviceId?: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  public jellyfinAuthToken?: string | null;

  @Column({ type: 'varchar', nullable: true, select: false })
  public plexToken?: string | null;

  @Column({ type: 'integer', default: 0 })
  public permissions = 0;

  @Column()
  public avatar: string;

  @Column({ type: 'varchar', nullable: true })
  public avatarETag?: string | null;

  @Column({ type: 'varchar', nullable: true })
  public avatarVersion?: string | null;

  @RelationCount((user: User) => user.requests)
  public requestCount: number;

  @OneToMany(() => MediaRequest, (request) => request.requestedBy)
  public requests: MediaRequest[];

  @OneToMany(() => Watchlist, (watchlist) => watchlist.requestedBy)
  public watchlists: Watchlist[];

  /** null = use the global limit. 0 = unlimited. */
  @Column({ type: 'int', nullable: true })
  public albumQuotaLimit?: number | null;

  @Column({ type: 'int', nullable: true })
  public albumQuotaDays?: number | null;

  @Column({ type: 'int', nullable: true })
  public trackQuotaLimit?: number | null;

  @Column({ type: 'int', nullable: true })
  public trackQuotaDays?: number | null;

  @OneToMany(() => LinkedAccount, (account) => account.user)
  public linkedAccounts: LinkedAccount[];

  @OneToMany(() => AppPassword, (appPassword) => appPassword.user)
  public appPasswords: AppPassword[];

  @OneToOne(() => UserSettings, (settings) => settings.user, {
    cascade: true,
    eager: true,
    onDelete: 'CASCADE',
  })
  public settings?: UserSettings;

  @OneToMany(() => UserPushSubscription, (pushSub) => pushSub.user)
  public pushSubscriptions: UserPushSubscription[];

  @OneToMany(() => Issue, (issue) => issue.createdBy, { cascade: true })
  public createdIssues: Issue[];

  @DbAwareColumn({ type: 'datetime', default: () => 'CURRENT_TIMESTAMP' })
  public createdAt: Date;

  @UpdateDateColumn({
    type: resolveDbType('datetime'),
    default: () => 'CURRENT_TIMESTAMP',
  })
  public updatedAt: Date;

  public warnings: string[] = [];

  constructor(init?: Partial<User>) {
    Object.assign(this, init);
  }

  public filter(showFiltered?: boolean): Partial<User> {
    const filtered: Partial<User> = Object.assign(
      {},
      ...(Object.keys(this) as (keyof User)[])
        .filter((k) => showFiltered || !User.filteredFields.includes(k))
        .map((k) => ({ [k]: this[k] }))
    );

    return filtered;
  }

  // settings is eager-loaded and would otherwise ride along into every nested User response
  public toJSON(): Partial<User> {
    return Object.assign(
      {},
      ...(Object.keys(this) as (keyof User)[])
        .filter((k) => !User.serializationExcludedFields.includes(k))
        .map((k) => ({ [k]: this[k] }))
    );
  }

  public hasPermission(
    permissions: Permission | Permission[],
    options?: PermissionCheckOptions
  ): boolean {
    return !!hasPermission(permissions, this.permissions, options);
  }

  public passwordMatch(password: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (this.password) {
        resolve(bcrypt.compare(password, this.password));
      } else {
        return resolve(false);
      }
    });
  }

  public async setPassword(password: string): Promise<void> {
    const hashedPassword = await bcrypt.hash(password, 12);
    this.password = hashedPassword;
  }

  public async generatePassword(): Promise<void> {
    const password = nanoid(16);
    await this.setPassword(password);

    const { applicationTitle, applicationUrl } = getSettings().main;
    try {
      logger.info(`Sending generated password email for ${this.email}`, {
        label: 'User Management',
      });

      const email = new PreparedEmail(getSettings().notifications.agents.email);
      await email.send({
        template: path.join(__dirname, '../templates/email/generatedpassword'),
        message: {
          to: this.email,
        },
        locals: {
          password: password,
          applicationUrl,
          applicationTitle,
          recipientName: this.username,
        },
      });
    } catch (e) {
      logger.error('Failed to send out generated password email', {
        label: 'User Management',
        message: e.message,
      });
    }
  }

  public async resetPassword(): Promise<void> {
    const guid = randomUUID();
    this.resetPasswordGuid = guid;

    // 24 hours into the future
    const targetDate = new Date();
    targetDate.setDate(targetDate.getDate() + 1);
    this.recoveryLinkExpirationDate = targetDate;

    const { applicationTitle, applicationUrl } = getSettings().main;
    const resetPasswordLink = `${applicationUrl}/resetpassword/${guid}`;

    try {
      logger.info(`Sending reset password email for ${this.email}`, {
        label: 'User Management',
      });
      const email = new PreparedEmail(getSettings().notifications.agents.email);
      await email.send({
        template: path.join(__dirname, '../templates/email/resetpassword'),
        message: {
          to: this.email,
        },
        locals: {
          resetPasswordLink,
          applicationUrl,
          applicationTitle,
          recipientName: this.displayName,
          recipientEmail: this.email,
        },
      });
    } catch (e) {
      logger.error('Failed to send out reset password email', {
        label: 'User Management',
        message: e.message,
      });
    }
  }

  @AfterLoad()
  public setDisplayName(): void {
    this.displayName =
      this.username || this.plexUsername || this.jellyfinUsername || this.email;
  }

  /**
   * Request quotas (docs/PERMISSIONS_AND_APPROVALS.md §Quotas).
   * - album usage = count(scope=album) + sum(releaseCount for scope=discography)
   * - track usage = sum(trackCount for scope=tracks)
   * Requests that are DECLINED or have ignoreQuota are not counted.
   */
  public async getQuota(): Promise<QuotaResponse> {
    const {
      main: { defaultQuotas },
    } = getSettings();
    const requestRepository = getRepository(MediaRequest);
    const canBypass = this.hasPermission([Permission.MANAGE_USERS], {
      type: 'or',
    });

    const albumQuotaLimit = !canBypass
      ? (this.albumQuotaLimit ?? defaultQuotas.album.quotaLimit ?? 0)
      : 0;
    const albumQuotaDays =
      this.albumQuotaDays ?? defaultQuotas.album.quotaDays ?? 7;
    const trackQuotaLimit = !canBypass
      ? (this.trackQuotaLimit ?? defaultQuotas.track.quotaLimit ?? 0)
      : 0;
    const trackQuotaDays =
      this.trackQuotaDays ?? defaultQuotas.track.quotaDays ?? 7;

    const usage = async (
      scopes: RequestScope[],
      days: number
    ): Promise<MediaRequest[]> => {
      const qb = requestRepository
        .createQueryBuilder('request')
        .leftJoin('request.requestedBy', 'requestedBy')
        .where('requestedBy.id = :userId', { userId: this.id })
        .andWhere('request.scope IN (:...scopes)', { scopes })
        .andWhere('request.status != :declined', {
          declined: MediaRequestStatus.DECLINED,
        })
        .andWhere('request.ignoreQuota = :ignoreQuota', { ignoreQuota: false });

      if (days) {
        const since = new Date();
        since.setDate(since.getDate() - days);
        qb.andWhere('request.createdAt > :since', { since: since.toJSON() });
      }

      return qb.getMany();
    };

    const albumQuotaUsed = albumQuotaLimit
      ? (
          await usage(
            [RequestScope.ALBUM, RequestScope.DISCOGRAPHY],
            albumQuotaDays
          )
        ).reduce(
          (sum, r) =>
            sum +
            (r.scope === RequestScope.DISCOGRAPHY
              ? Math.max(1, r.releaseCount ?? 0)
              : 1),
          0
        )
      : 0;

    const trackQuotaUsed = trackQuotaLimit
      ? (await usage([RequestScope.TRACKS], trackQuotaDays)).reduce(
          (sum, r) => sum + (r.trackCount ?? 0),
          0
        )
      : 0;

    return {
      album: {
        days: albumQuotaDays,
        limit: albumQuotaLimit,
        used: albumQuotaUsed,
        remaining: albumQuotaLimit
          ? Math.max(0, albumQuotaLimit - albumQuotaUsed)
          : undefined,
        restricted: !!(
          albumQuotaLimit && albumQuotaLimit - albumQuotaUsed <= 0
        ),
      },
      track: {
        days: trackQuotaDays,
        limit: trackQuotaLimit,
        used: trackQuotaUsed,
        remaining: trackQuotaLimit
          ? Math.max(0, trackQuotaLimit - trackQuotaUsed)
          : undefined,
        restricted: !!(
          trackQuotaLimit && trackQuotaLimit - trackQuotaUsed <= 0
        ),
      },
    };
  }
}
