// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import dataSource, { getRepository } from '@server/datasource';
import { MediaRequest } from '@server/entity/MediaRequest';
import ScrobbleQueue from '@server/entity/ScrobbleQueue';
import Track from '@server/entity/Track';
import { User } from '@server/entity/User';
import { UserPushSubscription } from '@server/entity/UserPushSubscription';
import { Watchlist } from '@server/entity/Watchlist';
import type { WatchlistResponse } from '@server/interfaces/api/discoverInterfaces';
import type {
  CreateUserBody,
  QuotaResponse,
  UserRecentlyPlayedResponse,
  UserRequestsResponse,
  UserResultsResponse,
} from '@server/interfaces/api/userInterfaces';
import { getLinkedAccounts } from '@server/lib/auth/linkedAccounts';
import { coverUrlFor } from '@server/lib/metadata';
import { Permission, hasPermission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { getHostname } from '@server/utils/getHostname';
import { normalizeJellyfinGuid } from '@server/utils/jellyfin';
import { isOwnProfileOrAdmin } from '@server/utils/profileMiddleware';
import { Router } from 'express';
import gravatarUrl from 'gravatar-url';
import type { EntityManager } from 'typeorm';
import { In, Not } from 'typeorm';
import validator from 'validator';
import userSettingsRoutes from './usersettings';

const router = Router();

// The user list is for people who manage users; request managers also need it
// to pick a requester. Everyone else gets 403.
router.get(
  '/',
  isAuthenticated([Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS], {
    type: 'or',
  }),
  async (req, res, next) => {
    try {
      const includeIds = [
        ...new Set(
          req.query.includeIds ? req.query.includeIds.toString().split(',') : []
        ),
      ];
      const pageSize = req.query.take
        ? Number(req.query.take)
        : Math.max(10, includeIds.length);
      const skip = req.query.skip ? Number(req.query.skip) : 0;
      const q = req.query.q ? req.query.q.toString().toLowerCase() : '';
      const sortParam = req.query.sort ? req.query.sort.toString() : undefined;
      const sortDirectionQuery = req.query.sortDirection
        ? req.query.sortDirection.toString().toLowerCase()
        : undefined;

      let sortDirection: 'ASC' | 'DESC';
      if (sortDirectionQuery === 'asc') {
        sortDirection = 'ASC';
      } else if (sortDirectionQuery === 'desc') {
        sortDirection = 'DESC';
      } else {
        switch (sortParam) {
          case 'displayname':
            sortDirection = 'ASC';
            break;
          case 'requests':
          case 'updated':
          case 'created':
            // newest members first ("date joined" is the default sort)
            sortDirection = 'DESC';
            break;
          case 'usertype':
          case 'role':
          case undefined:
          default:
            sortDirection = 'ASC';
            break;
        }
      }

      let query = getRepository(User).createQueryBuilder('user');

      if (q) {
        query = query.where(
          'LOWER(user.username) LIKE :q OR LOWER(user.email) LIKE :q OR LOWER(user.plexUsername) LIKE :q OR LOWER(user.jellyfinUsername) LIKE :q',
          { q: `%${q}%` }
        );
      }

      if (includeIds.length > 0) {
        query.andWhereInIds(includeIds);
      }

      switch (sortParam) {
        case 'created':
          query = query.orderBy('user.createdAt', sortDirection);
          break;
        case 'updated':
          query = query.orderBy('user.updatedAt', sortDirection);
          break;
        case 'displayname':
          query = query
            .addSelect(
              `CASE WHEN (user.username IS NULL OR user.username = '') THEN (
                CASE WHEN (user.plexUsername IS NULL OR user.plexUsername = '') THEN (
                  CASE WHEN (user.jellyfinUsername IS NULL OR user.jellyfinUsername = '') THEN
                    "user"."email"
                  ELSE
                    LOWER(user.jellyfinUsername)
                  END)
                ELSE
                  LOWER(user.plexUsername)
                END)
              ELSE
                LOWER(user.username)
              END`,
              'displayname_sort_key'
            )
            .orderBy('displayname_sort_key', sortDirection);
          break;
        case 'requests':
          query = query
            .addSelect((subQuery) => {
              return subQuery
                .select('COUNT(request.id)', 'request_count')
                .from(MediaRequest, 'request')
                .where('request.requestedBy.id = user.id');
            }, 'request_count')
            .orderBy('request_count', sortDirection);
          break;
        case 'usertype':
          query = query.orderBy('user.userType', sortDirection);
          break;
        case 'role':
          query = query
            .addSelect(
              `CASE
              WHEN user.id = 1 THEN 0
              WHEN (user.permissions & ${Permission.ADMIN}) != 0 THEN 1
              ELSE 2
            END`,
              'role_sort_key'
            )
            .orderBy('role_sort_key', sortDirection);
          break;
        default:
          query = query.orderBy('user.id', sortDirection);
          break;
      }
      // stable order for rows that tie on the sort key
      if (sortParam && sortParam !== 'created') {
        query = query.addOrderBy('user.id', 'ASC');
      }

      const [users, userCount] = await query
        .take(pageSize)
        .skip(skip)
        .distinct(true)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(userCount / pageSize),
          pageSize,
          results: userCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        results: User.filterMany(
          users,
          req.user?.hasPermission(Permission.MANAGE_USERS)
        ),
      } as UserResultsResponse);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export const USER_MESSAGES = {
  usernameRequired: 'Enter a username.',
  emailInvalid: 'Enter a valid email address.',
  emailTaken: 'That email address is already used.',
  passwordTooShort: 'The password needs at least 8 characters.',
  passwordNeeded:
    "Email notifications are off, so a generated password can't be sent. Set a password for this user.",
  localLoginOff:
    'Shufflerr accounts are turned off. Turn them on in Settings → Users first.',
} as const;

router.post<Record<string, never>, unknown, CreateUserBody>(
  '/',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);

      const username = (req.body.username ?? '').trim();
      const email = (req.body.email ?? '').trim().toLowerCase();
      const password = req.body.password ?? '';

      if (!settings.main.localLogin) {
        return next({ status: 400, message: USER_MESSAGES.localLoginOff });
      }
      if (!username) {
        return next({
          status: 400,
          message: USER_MESSAGES.usernameRequired,
          errors: ['username'],
        });
      }
      if (!validator.isEmail(email, { require_tld: false })) {
        return next({
          status: 400,
          message: USER_MESSAGES.emailInvalid,
          errors: ['email'],
        });
      }

      const existingUser = await userRepository
        .createQueryBuilder('user')
        .where('user.email = :email', { email })
        .getOne();

      if (existingUser) {
        return next({
          status: 409,
          message: USER_MESSAGES.emailTaken,
          errors: ['email', 'USER_EXISTS'],
        });
      }

      const emailEnabled = settings.notifications.agents.email.enabled;
      if (password) {
        if (password.length < 8) {
          return next({
            status: 400,
            message: USER_MESSAGES.passwordTooShort,
            errors: ['password'],
          });
        }
      } else if (!emailEnabled) {
        return next({
          status: 400,
          message: USER_MESSAGES.passwordNeeded,
          errors: ['password'],
        });
      }

      const user = new User({
        email,
        avatar: gravatarUrl(email, { default: 'mm', size: 200 }),
        username,
        permissions: settings.main.defaultPermissions,
        plexToken: '',
        userType: UserType.LOCAL,
      });

      if (password) {
        await user.setPassword(password);
      } else {
        await user.generatePassword();
      }

      await userRepository.save(user);
      // The creator manages users, so they get the full record (incl. email).
      // Reload it: the in-memory object still carries the password hash.
      const created = await userRepository.findOneOrFail({
        where: { id: user.id },
      });
      return res.status(201).json(created.filter(true));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post<
  never,
  unknown,
  {
    endpoint: string;
    p256dh: string;
    auth: string;
    userAgent: string;
  }
>('/registerPushSubscription', async (req, res, next) => {
  try {
    // This prevents race conditions where two requests both pass the checks
    await dataSource.transaction(
      async (transactionalEntityManager: EntityManager) => {
        const transactionalRepo =
          transactionalEntityManager.getRepository(UserPushSubscription);

        // Check for existing subscription by endpoint within transaction
        const existingSubscription = await transactionalRepo.findOne({
          relations: { user: true },
          where: {
            endpoint: req.body.endpoint,
            user: { id: req.user?.id },
          },
        });

        if (existingSubscription) {
          // If endpoint matches but auth is different, update with new keys (iOS refresh case)
          if (
            existingSubscription.endpoint === req.body.endpoint &&
            existingSubscription.auth !== req.body.auth
          ) {
            existingSubscription.auth = req.body.auth;
            existingSubscription.p256dh = req.body.p256dh;
            existingSubscription.userAgent = req.body.userAgent;

            await transactionalRepo.save(existingSubscription);

            logger.debug(
              'Updated existing push subscription with new keys for same endpoint.',
              { label: 'API' }
            );
            return;
          }

          logger.debug(
            'Duplicate subscription detected. Skipping registration.',
            { label: 'API' }
          );
          return;
        }

        // Clean up only true endpoint rotations. Same push-service subscription
        // (matched by `auth`) but with a stale endpoint. Matching on `auth`
        // avoids deleting sibling devices that only share a user agent.
        if (req.body.auth) {
          const staleSubscriptions = await transactionalRepo.find({
            relations: { user: true },
            where: {
              user: { id: req.user?.id },
              auth: req.body.auth,
              endpoint: Not(req.body.endpoint),
            },
          });

          if (staleSubscriptions.length > 0) {
            await transactionalRepo.remove(staleSubscriptions);
            logger.debug(
              `Removed ${staleSubscriptions.length} stale push subscription(s) from same device.`,
              { label: 'API' }
            );
          }
        }

        const userPushSubscription = new UserPushSubscription({
          auth: req.body.auth,
          endpoint: req.body.endpoint,
          p256dh: req.body.p256dh,
          userAgent: req.body.userAgent,
          user: req.user,
        });

        await transactionalRepo.save(userPushSubscription);
      }
    );

    return res.status(204).send();
  } catch {
    logger.error('Failed to register user push subscription', {
      label: 'API',
    });
    next({ status: 500, message: 'Failed to register subscription.' });
  }
});

router.get<{ id: string }>(
  '/:id/pushSubscriptions',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSubs = await userPushSubRepository.find({
        relations: { user: true },
        where: { user: { id: Number(req.params.id) } },
      });

      return res.status(200).json(userPushSubs);
    } catch {
      next({ status: 404, message: 'User subscriptions not found.' });
    }
  }
);

router.get<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSub = await userPushSubRepository.findOneOrFail({
        relations: {
          user: true,
        },
        where: {
          user: { id: Number(req.params.id) },
          endpoint: req.params.endpoint,
        },
      });

      return res.status(200).json(userPushSub);
    } catch {
      next({ status: 404, message: 'User subscription not found.' });
    }
  }
);

router.delete<{ id: string; endpoint: string }>(
  '/:id/pushSubscription/:endpoint',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const userPushSubRepository = getRepository(UserPushSubscription);

      const userPushSub = await userPushSubRepository.findOne({
        relations: { user: true },
        where: {
          user: { id: Number(req.params.id) },
          endpoint: req.params.endpoint,
        },
      });

      // If not found, just return 204 to prevent push disable failure
      // (rare scenario where user push sub does not exist)
      if (!userPushSub) {
        return res.status(204).send();
      }

      await userPushSubRepository.remove(userPushSub);
      return res.status(204).send();
    } catch (e) {
      logger.error('Something went wrong deleting the user push subcription', {
        label: 'API',
        endpoint: req.params.endpoint,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'User push subcription not found',
      });
    }
  }
);

router.get<{ id: string }>('/:id', async (req, res, next) => {
  try {
    const userRepository = getRepository(User);
    const user = await userRepository.findOneOrFail({
      where: { id: Number(req.params.id) },
    });

    const isOwnProfile = req.user?.id === user.id;
    const isAdmin = req.user?.hasPermission(Permission.MANAGE_USERS);

    return res.status(200).json(user.filter(isOwnProfile || isAdmin));
  } catch {
    next({ status: 404, message: 'User not found.' });
  }
});

router.get<{ jellyfinUserId: string }>(
  '/jellyfin/:jellyfinUserId',
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const jellyfinUserId = normalizeJellyfinGuid(req.params.jellyfinUserId);
      if (!jellyfinUserId) {
        return next({ status: 400, message: 'Invalid Jellyfin User ID.' });
      }

      const user = await userRepository.findOneOrFail({
        where: { jellyfinUserId },
      });

      return res
        .status(200)
        .json(user.filter(req.user?.hasPermission(Permission.MANAGE_USERS)));
    } catch {
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.use('/:id/settings', userSettingsRoutes);

router.get<{ id: string }, UserRequestsResponse>(
  '/:id/requests',
  async (req, res, next) => {
    const pageSize = req.query.take ? Number(req.query.take) : 20;
    const skip = req.query.skip ? Number(req.query.skip) : 0;

    try {
      const user = await getRepository(User).findOne({
        where: { id: Number(req.params.id) },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (
        user.id !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_REQUESTS, Permission.REQUEST_VIEW],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message: "You do not have permission to view this user's requests.",
        });
      }

      const [requests, requestCount] = await getRepository(MediaRequest)
        .createQueryBuilder('request')
        .leftJoinAndSelect('request.media', 'media')
        .leftJoinAndSelect('request.tracks', 'tracks')
        .leftJoinAndSelect('request.modifiedBy', 'modifiedBy')
        .leftJoinAndSelect('request.requestedBy', 'requestedBy')
        .andWhere('requestedBy.id = :id', {
          id: user.id,
        })
        .orderBy('request.id', 'DESC')
        .take(pageSize)
        .skip(skip)
        .getManyAndCount();

      return res.status(200).json({
        pageInfo: {
          pages: Math.ceil(requestCount / pageSize),
          pageSize,
          results: requestCount,
          page: Math.ceil(skip / pageSize) + 1,
        },
        // STREAM(SV4/SV2): map through the shared RequestResult mapper once
        // SV2 exports it from routes/request.ts.
        results: requests as unknown as UserRequestsResponse['results'],
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export const canMakePermissionsChange = (
  permissions: number,
  user?: User
): boolean =>
  // Only let the owner grant admin privileges
  !(hasPermission(Permission.ADMIN, permissions) && user?.id !== 1);

router.put<
  Record<string, never>,
  Partial<User>[],
  { ids: (string | number)[]; permissions: number }
>('/', isAuthenticated(Permission.MANAGE_USERS), async (req, res, next) => {
  try {
    const isOwner = req.user?.id === 1;

    if (!Number.isInteger(req.body.permissions) || req.body.permissions < 0) {
      return next({ status: 400, message: 'Choose the permissions to save.' });
    }

    if (!canMakePermissionsChange(req.body.permissions, req.user)) {
      return next({
        status: 403,
        message: 'You do not have permission to grant this level of access',
      });
    }

    const userRepository = getRepository(User);

    // Bulk edits never touch the owner, whoever sends them.
    const ids = (req.body.ids ?? [])
      .map((id) => Number(id))
      .filter((id) => Number.isInteger(id) && id !== 1);
    // Nobody but the owner changes another admin's permissions.
    const users: User[] = (
      await userRepository.find({ where: { id: In(ids) } })
    ).filter(
      (user) =>
        isOwner ||
        !user.hasPermission(Permission.ADMIN) ||
        user.id === req.user?.id
    );

    const updatedUsers: User[] = [];
    for (const user of users) {
      // A user can't change their own permissions (the owner isn't in the list).
      if (user.id === req.user?.id) {
        continue;
      }
      user.permissions = req.body.permissions;
      updatedUsers.push(await userRepository.save(user));
    }

    return res.status(200).json(User.filterMany(updatedUsers, true));
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

router.put<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      // Only let the owner user modify themselves
      if (user.id === 1 && req.user?.id !== 1) {
        return next({
          status: 403,
          message: 'You do not have permission to modify this user',
        });
      }

      if (
        !canMakePermissionsChange(req.body.permissions ?? 0, req.user) ||
        (user.hasPermission(Permission.ADMIN) &&
          req.user?.id !== 1 &&
          user.id !== req.user?.id)
      ) {
        return next({
          status: 403,
          message: 'You do not have permission to grant this level of access',
        });
      }

      // Users can't change their own permissions unless they're the owner
      // (whose permissions are fixed anyway).
      const permissions =
        user.id === 1 || user.id === req.user?.id
          ? user.permissions
          : (req.body.permissions ?? user.permissions);

      Object.assign(user, {
        username: req.body.username ?? user.username,
        permissions,
      });

      await userRepository.save(user);

      return res.status(200).json(user.filter());
    } catch {
      next({ status: 404, message: 'User not found.' });
    }
  }
);

router.delete<{ id: string }>(
  '/:id',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
        relations: { requests: true },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (user.id === 1) {
        return next({
          status: 405,
          message: "The owner's account can't be deleted.",
        });
      }

      if (user.id === req.user?.id) {
        return next({
          status: 405,
          message: "You can't delete your own account.",
        });
      }

      if (user.hasPermission(Permission.ADMIN) && req.user?.id !== 1) {
        return next({
          status: 405,
          message: 'Only the owner can delete an admin.',
        });
      }

      const requestRepository = getRepository(MediaRequest);

      /**
       * Requests are usually deleted through a cascade constraint. Those however, do
       * not trigger the removal event so listeners to not run and the parent Media
       * will not be updated back to unknown for titles that were still pending. So
       * we manually remove all requests from the user here so the parent media's
       * properly reflect the change.
       */
      await requestRepository.remove(user.requests, {
        /**
         * Break-up into groups of 1000 requests to be removed at a time.
         * Necessary for users with >1000 requests, else an SQLite 'Expression tree is too large' error occurs.
         * https://typeorm.io/repository-api#additional-options
         */
        chunk: Math.max(1, Math.ceil(user.requests.length / 1000)),
      });

      await userRepository.delete(user.id);
      return res.status(200).json(user.filter());
    } catch (e) {
      logger.error('Something went wrong deleting a user', {
        label: 'API',
        userId: req.params.id,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: 'Something went wrong deleting the user',
      });
    }
  }
);

router.post(
  '/import-from-plex',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);
      const body = req.body as { plexIds?: (string | number)[] } | undefined;
      const wanted = body?.plexIds?.map((id) => String(id));

      // taken from auth.ts
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true },
        where: { id: 1 },
      });
      if (!mainUser.plexToken) {
        return next({
          status: 400,
          message:
            'Link the owner account to Plex first. Shufflerr uses it to see who has access to the server.',
        });
      }
      const mainPlexTv = new PlexTvAPI(mainUser.plexToken);

      const plexUsersResponse = await mainPlexTv.getUsers();
      const createdUsers: User[] = [];
      for (const rawUser of plexUsersResponse.MediaContainer.User) {
        const account = rawUser.$;

        if (account.email) {
          const user = await userRepository
            .createQueryBuilder('user')
            .where('user.plexId = :id', { id: account.id })
            .orWhere('user.email = :email', {
              email: account.email.toLowerCase(),
            })
            .getOne();

          if (user) {
            // Update the user's avatar with their Plex thumbnail, in case it changed
            user.avatar = account.thumb;
            user.email = account.email;
            user.plexUsername = account.username;

            // In case the user was previously a local account
            if (user.userType === UserType.LOCAL) {
              user.userType = UserType.PLEX;
              user.plexId = parseInt(account.id);
            }
            await userRepository.save(user);
          } else if (!wanted || wanted.includes(String(account.id))) {
            if (await mainPlexTv.checkUserAccess(parseInt(account.id))) {
              const newUser = new User({
                plexUsername: account.username,
                email: account.email,
                permissions: settings.main.defaultPermissions,
                plexId: parseInt(account.id),
                plexToken: '',
                avatar: account.thumb,
                userType: UserType.PLEX,
              });
              await userRepository.save(newUser);
              createdUsers.push(newUser);
            }
          }
        }
      }

      return res.status(201).json(User.filterMany(createdUsers, true));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.post(
  '/import-from-jellyfin',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const userRepository = getRepository(User);
      const body = req.body as { jellyfinUserIds?: string[] };
      if (!settings.jellyfin.ip || !settings.jellyfin.apiKey) {
        return next({
          status: 400,
          message: 'Connect Jellyfin in Settings before importing its users.',
        });
      }

      // taken from auth.ts
      const admin = await userRepository.findOneOrFail({
        where: { id: 1 },
        select: ['id', 'jellyfinDeviceId', 'jellyfinUserId'],
        order: { id: 'ASC' },
      });

      const hostname = getHostname();
      const jellyfinClient = new JellyfinAPI(
        hostname,
        settings.jellyfin.apiKey,
        admin.jellyfinDeviceId ?? ''
      );
      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');

      //const jellyfinUsersResponse = await jellyfinClient.getUsers();
      const createdUsers: User[] = [];

      jellyfinClient.setUserId(admin.jellyfinUserId ?? '');
      const jellyfinUsers = await jellyfinClient.getUsers();

      const jellyfinUsersById = new Map(
        jellyfinUsers.users.map((user) => [
          normalizeJellyfinGuid(user.Id),
          user,
        ])
      );

      for (const rawJellyfinUserId of body.jellyfinUserIds ?? []) {
        const jellyfinUserId = normalizeJellyfinGuid(rawJellyfinUserId);
        if (!jellyfinUserId) {
          continue;
        }

        const jellyfinUser = jellyfinUsersById.get(jellyfinUserId);
        if (!jellyfinUser) {
          continue;
        }

        const user = await userRepository.findOne({
          select: ['id', 'jellyfinUserId'],
          where: { jellyfinUserId: jellyfinUserId },
        });

        if (!user) {
          const newUser = new User({
            jellyfinUsername: jellyfinUser?.Name,
            jellyfinUserId: jellyfinUser?.Id,
            jellyfinDeviceId: Buffer.from(
              `BOT_shufflerr_${jellyfinUser?.Name ?? ''}`
            ).toString('base64'),
            email: jellyfinUser?.Name,
            permissions: settings.main.defaultPermissions,
            avatar: `/avatarproxy/${jellyfinUser?.Id}`,
            userType:
              settings.main.mediaServerType === MediaServerType.EMBY
                ? UserType.EMBY
                : UserType.JELLYFIN,
          });

          await userRepository.save(newUser);
          createdUsers.push(newUser);
        }
      }
      return res.status(201).json(User.filterMany(createdUsers, true));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.get<{ id: string }, QuotaResponse>(
  '/:id/quota',
  async (req, res, next) => {
    try {
      const userRepository = getRepository(User);

      if (
        Number(req.params.id) !== req.user?.id &&
        !req.user?.hasPermission(
          [Permission.MANAGE_USERS, Permission.MANAGE_REQUESTS],
          { type: 'or' }
        )
      ) {
        return next({
          status: 403,
          message:
            "You do not have permission to view this user's request limits.",
        });
      }

      const user = await userRepository.findOneOrFail({
        where: { id: Number(req.params.id) },
      });

      const quotas = await user.getQuota();

      return res.status(200).json(quotas);
    } catch (e) {
      next({ status: 404, message: e.message });
    }
  }
);

// "Recently played" on the profile: the user's real play history. Plays are
// recorded by the scrobble pipeline (web player, connected apps, media-server
// webhooks); the list stays empty until something has been played.
router.get<{ id: string }, UserRecentlyPlayedResponse>(
  '/:id/recently-played',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const userId = Number(req.params.id);
      const take = Math.min(
        50,
        Math.max(1, req.query.take ? Number(req.query.take) || 12 : 12)
      );

      const user = await getRepository(User).findOne({
        where: { id: userId },
      });
      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      // Over-fetch a little: the same track played twice in a row shows once.
      const plays = await getRepository(ScrobbleQueue)
        .createQueryBuilder('play')
        .where('play.userId = :userId', { userId })
        .orderBy('play.playedAt', 'DESC')
        .addOrderBy('play.id', 'DESC')
        .take(take * 3)
        .getMany();

      const trackIds = [
        ...new Set(
          plays.map((p) => p.trackId).filter((id): id is number => !!id)
        ),
      ];
      const tracks = trackIds.length
        ? await getRepository(Track).find({
            where: { id: In(trackIds) },
            relations: { media: true },
          })
        : [];
      const tracksById = new Map(tracks.map((t) => [t.id, t]));

      const results: UserRecentlyPlayedResponse['results'] = [];
      let lastKey = '';
      for (const play of plays) {
        const key = `${play.trackId ?? ''}|${play.artist}|${play.track}`;
        if (key === lastKey) {
          continue;
        }
        lastKey = key;

        const track = play.trackId ? tracksById.get(play.trackId) : undefined;
        const albumMbid = play.releaseGroupMbid ?? track?.media?.mbid ?? null;
        results.push({
          id: play.id,
          playedAt: new Date(play.playedAt).toISOString(),
          source: play.source,
          title: play.track,
          artistName: play.artist,
          albumTitle: play.album ?? track?.media?.title ?? null,
          albumMbid,
          coverUrl:
            albumMbid && settings.metadata.coverArtArchive.enabled
              ? coverUrlFor(albumMbid, 250)
              : null,
          trackId: track?.id ?? null,
          playable: !!track,
        });
        if (results.length >= take) {
          break;
        }
      }

      const sourceSwitches = settings.scrobble.sources;
      const integrations = settings.integrations;
      const sources = (
        [
          ['plex', integrations.plex && sourceSwitches.plex],
          ['jellyfin', integrations.jellyfin && sourceSwitches.jellyfin],
          ['navidrome', integrations.navidrome && sourceSwitches.navidrome],
          [
            'apps',
            (integrations.openSubsonic || integrations.jellyfinApi) &&
              sourceSwitches.apps,
          ],
          ['web', sourceSwitches.web],
        ] as const
      )
        .filter(([, on]) => on)
        .map(([name]) => name);

      const linked = new Set(
        (await getLinkedAccounts(userId)).map((a) => a.provider)
      );
      const scrobbleOn = user.settings?.scrobbleEnabled ?? true;
      const scrobblingTo: UserRecentlyPlayedResponse['scrobblingTo'] = [];
      if (
        scrobbleOn &&
        integrations.listenbrainz &&
        linked.has('listenbrainz')
      ) {
        scrobblingTo.push('listenbrainz');
      }
      if (scrobbleOn && integrations.lastfmScrobble && linked.has('lastfm')) {
        scrobblingTo.push('lastfm');
      }

      return res.status(200).json({
        enabled: sources.length > 0,
        reason: sources.length
          ? undefined
          : 'No play source is turned on in Settings → Scrobbling.',
        results,
        sources: [...sources],
        scrobblingTo,
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

router.get<{ id: string }, WatchlistResponse>(
  '/:id/watchlist',
  async (req, res, next) => {
    if (
      Number(req.params.id) !== req.user?.id &&
      !req.user?.hasPermission(
        [Permission.MANAGE_REQUESTS, Permission.WATCHLIST_VIEW],
        {
          type: 'or',
        }
      )
    ) {
      return next({
        status: 403,
        message: "You do not have permission to view this user's Watchlist.",
      });
    }

    const itemsPerPage = 20;
    const page = req.query.page ? Number(req.query.page) : 1;
    const offset = (page - 1) * itemsPerPage;

    const user = await getRepository(User).findOneOrFail({
      where: { id: Number(req.params.id) },
      select: ['id'],
    });

    if (user) {
      const [result, total] = await getRepository(Watchlist).findAndCount({
        where: { requestedBy: { id: user?.id } },
        relations: {
          /*requestedBy: true,media:true*/
        },
        // loadRelationIds: true,
        take: itemsPerPage,
        skip: offset,
      });
      if (total) {
        return res.json({
          page: page,
          totalPages: Math.ceil(total / itemsPerPage),
          totalResults: total,
          results: result,
        });
      }
    }

    return res.json({
      page: 1,
      totalPages: 1,
      totalResults: 0,
      results: [],
    });
  }
);

export default router;
