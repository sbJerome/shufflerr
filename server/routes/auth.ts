// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType, ServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { startJobs } from '@server/job/schedule';
import { authRateLimit } from '@server/lib/auth/rateLimit';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { checkAvatarChanged } from '@server/routes/avatarproxy';
import { ApiError } from '@server/types/error';
import { getAppVersion } from '@server/utils/appVersion';
import { getHostname } from '@server/utils/getHostname';
import axios from 'axios';
import type { Request } from 'express';
import { Router } from 'express';
import gravatarUrl from 'gravatar-url';
import net from 'net';
import validator from 'validator';
import { z } from 'zod';

const authRoutes = Router();

/**
 * Start a fresh authenticated session. The session id is regenerated on every
 * sign-in, so an id that was fixed/planted before authentication cannot be
 * reused to ride the victim's session afterwards (session fixation).
 */
const startSession = (req: Request, userId: number): Promise<void> =>
  new Promise((resolve, reject) => {
    if (!req.session) {
      return resolve();
    }
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        return reject(regenErr);
      }
      req.session.userId = userId;
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });

// Exact copy from docs/AUTH.md — the login page shows these as they are.
export const AUTH_MESSAGES = {
  localEmpty: 'Enter your email and password.',
  localUnknown:
    'No Shufflerr account uses that email. Try signing in with Plex or Jellyfin.',
  localNoPasswordPlex:
    'This account signs in with Plex. Use the Plex button, or set a password in your profile first.',
  localNoPasswordJellyfin:
    'This account signs in with Jellyfin. Use the Jellyfin button, or set a password in your profile first.',
  localNoPassword:
    'This account doesn\'t have a password yet. Use "Forgot password?" to set one.',
  localWrongPassword:
    'That password isn\'t right. Try again, or use "Forgot password?".',
  localDisabled:
    'Signing in with a Shufflerr account is turned off. Use Plex or Jellyfin.',
  plexDisabled: 'Signing in with Plex is turned off.',
  plexUnknown:
    "Your Plex account doesn't have a Shufflerr account yet. Ask the server owner to import you.",
  plexNoAccess:
    "Your Plex account doesn't have access to this server. Ask the server owner to share it with you.",
  plexFailed: "Plex didn't confirm that sign-in. Try again.",
  jellyfinDisabled: 'Signing in with Jellyfin is turned off.',
  jellyfinNotSetUp:
    "Jellyfin isn't connected yet. Ask an admin to set it up in Settings.",
  jellyfinUnknown:
    "Your Jellyfin account doesn't have a Shufflerr account yet. Ask an admin to import you.",
  jellyfinInvalid: "Jellyfin didn't accept that username and password.",
  jellyfinEmpty: 'Enter your Jellyfin username and password.',
  passwordTooShort: 'The password needs at least 8 characters.',
  invalidEmail: 'Enter a valid email address.',
  setupDone:
    'Shufflerr already has an owner. Sign in with that account instead.',
} as const;

const plexLoginEnabled = (): boolean => {
  const settings = getSettings();
  return settings.main.mediaServerLogin && settings.plex.loginEnabled;
};

const jellyfinLoginEnabled = (): boolean => {
  const settings = getSettings();
  return settings.main.mediaServerLogin && settings.jellyfin.loginEnabled;
};

/** Jellyfin and Emby share one connection; the owner's setup choice says which it is. */
const isEmby = (): boolean =>
  getSettings().main.mediaServerType === MediaServerType.EMBY;

const jellyfinUserType = (): UserType =>
  isEmby() ? UserType.EMBY : UserType.JELLYFIN;

export const quickConnectSecret = z.object({
  secret: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[A-Fa-f0-9]+$/),
});

authRoutes.get('/me', isAuthenticated(), async (req, res) => {
  const userRepository = getRepository(User);
  if (!req.user) {
    return res.status(500).json({
      status: 500,
      error: 'Please sign in.',
    });
  }
  const user = await userRepository.findOneOrFail({
    where: { id: req.user.id },
  });

  // check if email is required in settings and if user has an valid email
  const settings = await getSettings();
  if (
    settings.notifications.agents.email.options.userEmailRequired &&
    !validator.isEmail(user.email, { require_tld: false })
  ) {
    user.warnings.push('userEmailRequired');
    logger.warn(`User ${user.username} has no valid email address`);
  }

  return res.status(200).json({
    ...user.toJSON(),
    settings: user.settings && {
      locale: user.settings.locale,
      discoverRegion: user.settings.discoverRegion,
      notificationTypes: user.settings.notificationTypes,
      autoRequestSpotifySaved: user.settings.autoRequestSpotifySaved,
      scrobbleEnabled: user.settings.scrobbleEnabled,
    },
  });
});

authRoutes.post('/plex', authRateLimit, async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as { authToken?: string };

  if (!body.authToken) {
    return next({
      status: 400,
      message: AUTH_MESSAGES.plexFailed,
    });
  }

  // The very first sign-in creates the owner, whatever the switches say.
  const firstRun = !(await userRepository.count());
  if (!firstRun && !plexLoginEnabled()) {
    return next({ status: 403, message: AUTH_MESSAGES.plexDisabled });
  }
  try {
    // First we need to use this auth token to get the user's email from plex.tv
    const plextv = new PlexTvAPI(body.authToken);
    const account = await plextv.getUser();

    // Next let's see if the user already exists
    let user = await userRepository
      .createQueryBuilder('user')
      .where('user.plexId = :id', { id: account.id })
      .orWhere('user.email = :email', {
        email: account.email.toLowerCase(),
      })
      .getOne();

    if (firstRun) {
      user = new User({
        email: account.email,
        plexUsername: account.username,
        plexId: account.id,
        plexToken: account.authToken,
        permissions: Permission.ADMIN,
        avatar: account.thumb,
        userType: UserType.PLEX,
      });

      settings.main.mediaServerType = MediaServerType.PLEX;
      await settings.save();
      startJobs();

      await userRepository.save(user);
    } else {
      const mainUser = await userRepository.findOneOrFail({
        select: { id: true, plexToken: true, plexId: true, email: true },
        where: { id: 1 },
      });
      // The owner's token answers "does this account have access to the
      // server?". An owner who never linked Plex can't answer it, so only
      // accounts already known to Shufflerr get in.
      const ownerHasPlex = !!mainUser.plexToken;
      const mainPlexTv = new PlexTvAPI(mainUser.plexToken ?? '');

      if (!account.id) {
        logger.error('Plex ID was missing from Plex.tv response', {
          label: 'API',
          ip: req.ip,
          email: account.email,
          plexUsername: account.username,
        });

        return next({
          status: 500,
          message: 'Something went wrong. Try again.',
        });
      }

      if (
        account.id === mainUser.plexId ||
        (account.email === mainUser.email && !mainUser.plexId) ||
        (ownerHasPlex
          ? await mainPlexTv.checkUserAccess(account.id)
          : !!user?.plexId && user.plexId === account.id)
      ) {
        if (user) {
          if (!user.plexId) {
            logger.info(
              'Found matching Plex user; updating user with Plex data',
              {
                label: 'API',
                ip: req.ip,
                email: user.email,
                userId: user.id,
                plexId: account.id,
                plexUsername: account.username,
              }
            );
          }

          user.plexToken = body.authToken;
          user.plexId = account.id;
          user.avatar = account.thumb;
          user.email = account.email;
          user.plexUsername = account.username;
          user.userType = UserType.PLEX;

          await userRepository.save(user);
        } else if (!settings.main.newPlexLogin) {
          logger.warn(
            'Failed sign-in attempt by unimported Plex user with access to the media server',
            {
              label: 'API',
              ip: req.ip,
              email: account.email,
              plexId: account.id,
              plexUsername: account.username,
            }
          );
          return next({
            status: 403,
            message: AUTH_MESSAGES.plexUnknown,
          });
        } else {
          logger.info(
            'Sign-in attempt from Plex user with access to the media server; creating new Shufflerr user',
            {
              label: 'API',
              ip: req.ip,
              email: account.email,
              plexId: account.id,
              plexUsername: account.username,
            }
          );
          user = new User({
            email: account.email,
            plexUsername: account.username,
            plexId: account.id,
            plexToken: account.authToken,
            permissions: settings.main.defaultPermissions,
            avatar: account.thumb,
            userType: UserType.PLEX,
          });

          await userRepository.save(user);
        }
      } else {
        logger.warn(
          'Failed sign-in attempt by Plex user without access to the media server',
          {
            label: 'API',
            ip: req.ip,
            email: account.email,
            plexId: account.id,
            plexUsername: account.username,
          }
        );
        return next({
          status: 403,
          message: ownerHasPlex
            ? AUTH_MESSAGES.plexNoAccess
            : AUTH_MESSAGES.plexUnknown,
        });
      }
    }

    await startSession(req, user.id);

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
    logger.error('Something went wrong authenticating with Plex account', {
      label: 'API',
      errorMessage: e.message,
      ip: req.ip,
    });
    return next({
      status: 500,
      message: AUTH_MESSAGES.plexFailed,
    });
  }
});

function getUserAvatarUrl(user: User): string {
  return `/avatarproxy/${user.jellyfinUserId}?v=${user.avatarVersion}`;
}

authRoutes.post('/jellyfin', authRateLimit, async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as {
    username?: string;
    password?: string;
    hostname?: string;
    port?: number;
    urlBase?: string;
    useSsl?: boolean;
    email?: string;
    serverType?: number;
  };

  // First run: the owner signs in with a hostname and Shufflerr stores the
  // connection. Afterwards the sign-in switch decides, and the connection
  // comes from settings only.
  const firstRun = !(await userRepository.count());
  if (!firstRun && !jellyfinLoginEnabled()) {
    return next({ status: 403, message: AUTH_MESSAGES.jellyfinDisabled });
  }

  if (!body.username) {
    return next({ status: 400, message: AUTH_MESSAGES.jellyfinEmpty });
  } else if (!firstRun && body.hostname) {
    return next({
      status: 400,
      message:
        'The Jellyfin server is already set. Change it in Settings, not at sign-in.',
    });
  } else if (settings.jellyfin.ip === '' && !body.hostname) {
    return next({
      status: firstRun ? 400 : 403,
      message: firstRun
        ? 'Enter the address of your Jellyfin server.'
        : AUTH_MESSAGES.jellyfinNotSetUp,
    });
  }

  try {
    const hostname =
      !firstRun || !body.hostname
        ? getHostname()
        : getHostname({
            useSsl: body.useSsl,
            ip: body.hostname,
            port: body.port,
            urlBase: body.urlBase,
          });

    // Try to find deviceId that corresponds to jellyfin user, else generate a new one
    let user = await userRepository.findOne({
      where: { jellyfinUsername: body.username },
      select: { id: true, jellyfinDeviceId: true },
    });

    let deviceId = 'BOT_shufflerr';
    if (user && user.id === 1) {
      // Admin is always BOT_shufflerr
      deviceId = 'BOT_shufflerr';
    } else if (user && user.jellyfinDeviceId) {
      deviceId = user.jellyfinDeviceId;
    } else if (body.username) {
      deviceId = Buffer.from(`BOT_shufflerr_${body.username}`).toString(
        'base64'
      );
    }

    // First we need to attempt to log the user in to jellyfin
    const jellyfinserver = new JellyfinAPI(hostname ?? '', undefined, deviceId);

    const ip = req.ip;
    let clientIp;

    if (ip) {
      if (net.isIPv4(ip)) {
        clientIp = ip;
      } else if (net.isIPv6(ip)) {
        clientIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;
      }
    }

    const account = await jellyfinserver.login(
      body.username,
      body.password,
      clientIp
    );

    // Next let's see if the user already exists
    user = await userRepository.findOne({
      where: { jellyfinUserId: account.User.Id },
    });

    // Only the very first sign-in may create the owner and store the
    // connection. (Seerr also re-ran this while the media server type was
    // unset; in Shufflerr an owner can be a local account, and that path would
    // overwrite them with whoever signed in.)
    const missingAdminUser = firstRun;
    if (missingAdminUser) {
      // Check if user is admin on jellyfin
      if (account.User.Policy.IsAdministrator === false) {
        throw new ApiError(403, ApiErrorCode.NotAdmin);
      }

      if (
        body.serverType !== MediaServerType.JELLYFIN &&
        body.serverType !== MediaServerType.EMBY
      ) {
        throw new ApiError(500, ApiErrorCode.NoAdminUser);
      }
      settings.main.mediaServerType = body.serverType;

      if (missingAdminUser) {
        logger.info(
          'Sign-in attempt from Jellyfin user with access to the media server; creating initial admin user for Shufflerr',
          {
            label: 'API',
            ip: req.ip,
            jellyfinUsername: account.User.Name,
          }
        );

        // User doesn't exist, and there are no users in the database, we'll create the user
        // with admin permissions

        user = new User({
          id: 1,
          email: body.email || account.User.Name,
          jellyfinUsername: account.User.Name,
          jellyfinUserId: account.User.Id,
          jellyfinDeviceId: deviceId,
          jellyfinAuthToken: account.AccessToken,
          permissions: Permission.ADMIN,
          userType:
            body.serverType === MediaServerType.JELLYFIN
              ? UserType.JELLYFIN
              : UserType.EMBY,
        });
        user.avatar = getUserAvatarUrl(user);

        await userRepository.save(user);
      } else {
        logger.info(
          'Sign-in attempt from Jellyfin user with access to the media server; editing admin user for Shufflerr',
          {
            label: 'API',
            ip: req.ip,
            jellyfinUsername: account.User.Name,
          }
        );

        // User alread exist but settings.json is not configured, we'll edit the admin user

        user = await userRepository.findOne({
          where: { id: 1 },
        });
        if (!user) {
          throw new Error('Unable to find admin user to edit');
        }
        user.email = body.email || account.User.Name;
        user.jellyfinUsername = account.User.Name;
        user.jellyfinUserId = account.User.Id;
        user.jellyfinDeviceId = deviceId;
        user.jellyfinAuthToken = account.AccessToken;
        user.permissions = Permission.ADMIN;
        user.avatar = getUserAvatarUrl(user);
        user.userType =
          body.serverType === MediaServerType.JELLYFIN
            ? UserType.JELLYFIN
            : UserType.EMBY;

        await userRepository.save(user);
      }

      // Create an API key on Jellyfin from this admin user
      const jellyfinClient = new JellyfinAPI(
        hostname,
        account.AccessToken,
        deviceId
      );
      const apiKey = await jellyfinClient.createApiToken('Shufflerr');

      const serverName = await jellyfinserver.getServerName();

      settings.jellyfin.name = serverName;
      settings.jellyfin.serverId = account.User.ServerId;
      if (body.hostname) {
        settings.jellyfin.ip = body.hostname;
        settings.jellyfin.port = body.port ?? 8096;
        settings.jellyfin.urlBase = body.urlBase ?? '';
        settings.jellyfin.useSsl = body.useSsl ?? false;
      }
      settings.jellyfin.apiKey = apiKey;
      settings.jellyfin.loginEnabled = true;
      await settings.save();
      startJobs();
    }
    // User already exists, let's update their information
    else if (account.User.Id === user?.jellyfinUserId) {
      logger.info(
        `Found matching ${
          settings.main.mediaServerType === MediaServerType.JELLYFIN
            ? ServerType.JELLYFIN
            : ServerType.EMBY
        } user; updating user with ${
          settings.main.mediaServerType === MediaServerType.JELLYFIN
            ? ServerType.JELLYFIN
            : ServerType.EMBY
        }`,
        {
          label: 'API',
          ip: req.ip,
          jellyfinUsername: account.User.Name,
        }
      );
      user.avatar = getUserAvatarUrl(user);
      user.jellyfinUsername = account.User.Name;
      user.jellyfinAuthToken = account.AccessToken;
      user.jellyfinDeviceId = deviceId;

      if (user.username === account.User.Name) {
        user.username = '';
      }

      await userRepository.save(user);
    } else if (!settings.jellyfin.newLogin) {
      logger.warn(
        'Failed sign-in attempt by unimported Jellyfin user with access to the media server',
        {
          label: 'API',
          ip: req.ip,
          jellyfinUserId: account.User.Id,
          jellyfinUsername: account.User.Name,
        }
      );
      return next({
        status: 403,
        message: AUTH_MESSAGES.jellyfinUnknown,
      });
    } else if (!user) {
      logger.info(
        'Sign-in attempt from Jellyfin user with access to the media server; creating new Shufflerr user',
        {
          label: 'API',
          ip: req.ip,
          jellyfinUsername: account.User.Name,
        }
      );

      user = new User({
        email: body.email || account.User.Name,
        jellyfinUsername: account.User.Name,
        jellyfinUserId: account.User.Id,
        jellyfinDeviceId: deviceId,
        jellyfinAuthToken: account.AccessToken,
        permissions: settings.main.defaultPermissions,
        userType: jellyfinUserType(),
      });
      user.avatar = getUserAvatarUrl(user);
      // No Shufflerr password is derived from the media-server password; the
      // user can set one in their profile.
      await userRepository.save(user);
    }

    if (user && user.jellyfinUserId) {
      try {
        const { changed } = await checkAvatarChanged(user);

        if (changed) {
          user.avatar = getUserAvatarUrl(user);
          await userRepository.save(user);
          logger.debug('Avatar updated during login', {
            userId: user.id,
            jellyfinUserId: user.jellyfinUserId,
          });
        }
      } catch (error) {
        logger.error('Error handling avatar during login', {
          label: 'Auth',
          errorMessage: error.message,
        });
      }
    }

    if (user?.id) {
      await startSession(req, user.id);
    }

    return res.status(200).json(user?.filter() ?? {});
  } catch (e) {
    switch (e.errorCode) {
      case ApiErrorCode.InvalidUrl:
        logger.error(
          `The provided ${
            settings.main.mediaServerType === MediaServerType.JELLYFIN
              ? ServerType.JELLYFIN
              : ServerType.EMBY
          } is invalid or the server is not reachable.`,
          {
            label: 'Auth',
            error: e.errorCode,
            status: e.statusCode,
            hostname: getHostname({
              useSsl: body.useSsl,
              ip: body.hostname,
              port: body.port,
              urlBase: body.urlBase,
            }),
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      case ApiErrorCode.ConnectionError:
        logger.error(
          `Unable to reach the ${
            settings.main.mediaServerType === MediaServerType.JELLYFIN
              ? ServerType.JELLYFIN
              : ServerType.EMBY
          } server.`,
          {
            label: 'Auth',
            error: e.errorCode,
            status: e.statusCode,
            hostname: getHostname({
              useSsl: body.useSsl,
              ip: body.hostname,
              port: body.port,
              urlBase: body.urlBase,
            }),
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      case ApiErrorCode.InvalidCredentials:
        logger.warn(
          'Failed sign-in attempt from user with incorrect Jellyfin credentials',
          {
            label: 'Auth',
            account: {
              ip: req.ip,
              email: body.username,
              password: '__REDACTED__',
            },
          }
        );
        return next({
          status: 401,
          message: AUTH_MESSAGES.jellyfinInvalid,
          errors: [e.errorCode],
        });

      case ApiErrorCode.NotAdmin:
        logger.warn(
          'Failed sign-in attempt from user without admin permissions',
          {
            label: 'Auth',
            account: {
              ip: req.ip,
              email: body.username,
            },
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      case ApiErrorCode.NoAdminUser:
        logger.warn(
          'Failed sign-in attempt from user without admin permissions and no admin user exists',
          {
            label: 'Auth',
            account: {
              ip: req.ip,
              email: body.username,
            },
          }
        );
        return next({
          status: e.statusCode,
          message: e.errorCode,
        });

      default:
        logger.error(e.message, { label: 'Auth' });
        return next({
          status: 500,
          message: 'Something went wrong.',
        });
    }
  }
});

/** Quick Connect needs a connected Jellyfin (Emby doesn't have it). */
const quickConnectAvailable = (): boolean =>
  getSettings().jellyfin.ip !== '' && !isEmby();

authRoutes.post('/jellyfin/quickconnect/initiate', async (req, res, next) => {
  if (!quickConnectAvailable()) {
    return next({
      status: 403,
      message: 'Quick Connect is only supported by Jellyfin.',
    });
  }

  try {
    const hostname = getHostname();
    const jellyfinServer = new JellyfinAPI(
      hostname ?? '',
      undefined,
      undefined
    );

    const response = await jellyfinServer.initiateQuickConnect();

    return res.status(200).json({
      code: response.Code,
      secret: response.Secret,
    });
  } catch (error) {
    logger.error('Error initiating Jellyfin quick connect', {
      label: 'Auth',
      errorMessage: error.message,
    });
    return next({
      status: 500,
      message: 'Failed to initiate quick connect.',
    });
  }
});

authRoutes.get('/jellyfin/quickconnect/check', async (req, res, next) => {
  if (!quickConnectAvailable()) {
    return next({
      status: 403,
      message: 'Quick Connect is only supported by Jellyfin.',
    });
  }

  const result = quickConnectSecret.safeParse(req.query);
  if (!result.success) {
    return next({
      status: 400,
      message: 'Invalid secret format',
    });
  }

  const { secret } = result.data;

  try {
    const hostname = getHostname();
    const jellyfinServer = new JellyfinAPI(
      hostname ?? '',
      undefined,
      undefined
    );

    const response = await jellyfinServer.checkQuickConnect(secret);

    return res.status(200).json({ authenticated: response.Authenticated });
  } catch (e) {
    return next({
      status: e.statusCode || 500,
      message: 'Failed to check Quick Connect status',
    });
  }
});

authRoutes.post(
  '/jellyfin/quickconnect/authenticate',
  authRateLimit,
  async (req, res, next) => {
    const settings = getSettings();
    const userRepository = getRepository(User);
    const result = quickConnectSecret.safeParse(req.body);
    if (!result.success) {
      return next({
        status: 400,
        message: 'Secret required',
      });
    }

    const { secret } = result.data;

    if (settings.jellyfin.ip === '' || !(await userRepository.count())) {
      return next({
        status: 403,
        message: 'Quick Connect is not available during initial setup.',
      });
    }

    if (!quickConnectAvailable()) {
      return next({
        status: 403,
        message: 'Quick Connect is only supported by Jellyfin.',
      });
    }

    if (!jellyfinLoginEnabled()) {
      return next({ status: 403, message: AUTH_MESSAGES.jellyfinDisabled });
    }

    try {
      const hostname = getHostname();
      const jellyfinServer = new JellyfinAPI(
        hostname ?? '',
        undefined,
        undefined
      );

      const account = await jellyfinServer.authenticateQuickConnect(secret);

      let user = await userRepository.findOne({
        where: { jellyfinUserId: account.User.Id },
      });

      const deviceId = Buffer.from(
        `BOT_shufflerr_${account.User.Name ?? ''}`
      ).toString('base64');

      if (user) {
        logger.info('Quick Connect sign-in from existing user', {
          label: 'API',
          ip: req.ip,
          jellyfinUsername: account.User.Name,
          userId: user.id,
        });

        user.jellyfinAuthToken = account.AccessToken;
        user.jellyfinDeviceId = deviceId;
        user.avatar = getUserAvatarUrl(user);
        await userRepository.save(user);
      } else if (!settings.jellyfin.newLogin) {
        logger.warn(
          'Failed Quick Connect sign-in attempt by unimported Jellyfin user',
          {
            label: 'API',
            ip: req.ip,
            jellyfinUserId: account.User.Id,
            jellyfinUsername: account.User.Name,
          }
        );
        return next({
          status: 403,
          message: AUTH_MESSAGES.jellyfinUnknown,
        });
      } else {
        logger.info(
          'Quick Connect sign-in from new Jellyfin user; creating new Shufflerr user',
          {
            label: 'API',
            ip: req.ip,
            jellyfinUsername: account.User.Name,
          }
        );

        user = new User({
          email: account.User.Name,
          jellyfinUsername: account.User.Name,
          jellyfinUserId: account.User.Id,
          jellyfinDeviceId: deviceId,
          jellyfinAuthToken: account.AccessToken,
          permissions: settings.main.defaultPermissions,
          userType: UserType.JELLYFIN,
        });
        user.avatar = getUserAvatarUrl(user);
        await userRepository.save(user);
      }

      if (user.jellyfinUserId) {
        try {
          const { changed } = await checkAvatarChanged(user);

          if (changed) {
            user.avatar = getUserAvatarUrl(user);
            await userRepository.save(user);
            logger.debug('Avatar updated during Quick Connect login', {
              userId: user.id,
              jellyfinUserId: user.jellyfinUserId,
            });
          }
        } catch (error) {
          logger.error('Error handling avatar during Quick Connect login', {
            label: 'Auth',
            errorMessage: error.message,
          });
        }
      }

      await startSession(req, user.id);

      return res.status(200).json(user?.filter() ?? {});
    } catch (e) {
      logger.error('Quick Connect authentication failed', {
        label: 'Auth',
        error: e.message,
        ip: req.ip,
      });
      return next({
        status: e.statusCode || 500,
        message: ApiErrorCode.InvalidCredentials,
      });
    }
  }
);

/**
 * First-run only: create the owner as a Shufflerr (email + password) account,
 * so the app can be set up without Plex or Jellyfin. Refused once any user
 * exists.
 */
// `/setup-local` is the name the setup UI calls; `/setup` is kept as an alias.
authRoutes.post(
  ['/setup-local', '/setup'],
  authRateLimit,
  async (req, res, next) => {
    const userRepository = getRepository(User);
    const settings = getSettings();
    const body = req.body as {
      username?: string;
      email?: string;
      password?: string;
    };

    try {
      if (await userRepository.count()) {
        return next({ status: 403, message: AUTH_MESSAGES.setupDone });
      }

      const email = (body.email ?? '').trim().toLowerCase();
      if (!validator.isEmail(email, { require_tld: false })) {
        return next({ status: 400, message: AUTH_MESSAGES.invalidEmail });
      }
      if (!body.password || body.password.length < 8) {
        return next({ status: 400, message: AUTH_MESSAGES.passwordTooShort });
      }

      const user = new User({
        email,
        username: body.username?.trim() || undefined,
        permissions: Permission.ADMIN,
        avatar: gravatarUrl(email, { default: 'mm', size: 200 }),
        userType: UserType.LOCAL,
      });
      await user.setPassword(body.password);
      await userRepository.save(user);

      // A local owner must be able to sign in again.
      if (!settings.main.localLogin) {
        settings.main.localLogin = true;
        await settings.save();
      }

      logger.info('Created the owner account as a Shufflerr account', {
        label: 'Auth',
        ip: req.ip,
        userId: user.id,
      });

      await startSession(req, user.id);

      return res.status(201).json(user.filter());
    } catch (e) {
      logger.error('Something went wrong creating the owner account', {
        label: 'Auth',
        errorMessage: e.message,
        ip: req.ip,
      });
      return next({ status: 500, message: 'Could not create the account.' });
    }
  }
);

authRoutes.post('/local', authRateLimit, async (req, res, next) => {
  const settings = getSettings();
  const userRepository = getRepository(User);
  const body = req.body as { email?: string; password?: string };

  if (!settings.main.localLogin) {
    return next({ status: 403, message: AUTH_MESSAGES.localDisabled });
  } else if (!body.email || !body.password) {
    return next({ status: 400, message: AUTH_MESSAGES.localEmpty });
  }
  try {
    const user = await userRepository
      .createQueryBuilder('user')
      .select([
        'user.id',
        'user.email',
        'user.password',
        'user.plexId',
        'user.jellyfinUserId',
        'user.userType',
      ])
      .where('user.email = :email', { email: body.email.trim().toLowerCase() })
      .getOne();

    if (!user) {
      logger.warn('Failed sign-in attempt for an unknown email address', {
        label: 'API',
        ip: req.ip,
        email: body.email,
      });
      return next({ status: 403, message: AUTH_MESSAGES.localUnknown });
    }

    if (!user.password) {
      return next({
        status: 403,
        message:
          user.userType === UserType.PLEX || user.plexId
            ? AUTH_MESSAGES.localNoPasswordPlex
            : user.userType === UserType.JELLYFIN ||
                user.userType === UserType.EMBY ||
                user.jellyfinUserId
              ? AUTH_MESSAGES.localNoPasswordJellyfin
              : AUTH_MESSAGES.localNoPassword,
      });
    }

    if (!(await user.passwordMatch(body.password))) {
      logger.warn('Failed sign-in attempt using invalid Shufflerr password', {
        label: 'API',
        ip: req.ip,
        email: body.email,
        userId: user.id,
      });
      return next({ status: 403, message: AUTH_MESSAGES.localWrongPassword });
    }

    await startSession(req, user.id);

    // Reload so the response carries the full (filtered) user, not just the
    // columns needed to check the password.
    const fullUser = await userRepository.findOneOrFail({
      where: { id: user.id },
    });

    return res.status(200).json(fullUser.filter());
  } catch (e) {
    logger.error(
      'Something went wrong authenticating with Shufflerr password',
      {
        label: 'API',
        errorMessage: e.message,
        ip: req.ip,
        email: body.email,
      }
    );
    return next({
      status: 500,
      message: 'Something went wrong signing you in. Try again.',
    });
  }
});

authRoutes.post('/logout', async (req, res, next) => {
  try {
    const userId = req.session?.userId;
    if (!userId) {
      return res.status(200).json({ status: 'ok' });
    }

    const settings = getSettings();
    const isJellyfinOrEmby =
      settings.jellyfin.ip !== '' && !!settings.jellyfin.apiKey;

    if (isJellyfinOrEmby) {
      const user = await getRepository(User)
        .createQueryBuilder('user')
        .addSelect(['user.jellyfinUserId', 'user.jellyfinDeviceId'])
        .where('user.id = :id', { id: userId })
        .getOne();

      if (user?.jellyfinUserId && user.jellyfinDeviceId) {
        try {
          const baseUrl = getHostname();
          try {
            await axios.delete(`${baseUrl}/Devices`, {
              params: { Id: user.jellyfinDeviceId },
              headers: {
                Authorization: `MediaBrowser Client="Shufflerr", Device="Shufflerr", DeviceId="shufflerr", Version="${
                  settings.main.mediaServerType === MediaServerType.EMBY
                    ? '1.0.0'
                    : getAppVersion()
                }", Token="${settings.jellyfin.apiKey}"`,
              },
            });
          } catch (error) {
            logger.error('Failed to delete Jellyfin device', {
              label: 'Auth',
              error: error instanceof Error ? error.message : 'Unknown error',
              userId: user.id,
              jellyfinUserId: user.jellyfinUserId,
            });
          }
        } catch (error) {
          logger.error('Failed to delete Jellyfin device', {
            label: 'Auth',
            error: error instanceof Error ? error.message : 'Unknown error',
            userId: user.id,
            jellyfinUserId: user.jellyfinUserId,
          });
        }
      }
    }

    req.session?.destroy((err: Error | null) => {
      if (err) {
        logger.error('Failed to destroy session', {
          label: 'Auth',
          error: err.message,
          userId,
        });
        return next({ status: 500, message: 'Failed to destroy session.' });
      }
      logger.debug('Successfully logged out user', {
        label: 'Auth',
        userId,
      });
      res.status(200).json({ status: 'ok' });
    });
  } catch (error) {
    logger.error('Error during logout process', {
      label: 'Auth',
      error: error instanceof Error ? error.message : 'Unknown error',
      userId: req.session?.userId,
    });
    next({ status: 500, message: 'Error during logout process.' });
  }
});

authRoutes.post('/reset-password', authRateLimit, async (req, res, next) => {
  const userRepository = getRepository(User);
  const body = req.body as { email?: string };

  if (!body.email) {
    return next({
      status: 400,
      message: 'Enter your email address.',
    });
  }

  // The link is emailed; without the email agent nothing can be sent. The
  // answer is the same either way so addresses can't be probed.
  if (!getSettings().notifications.agents.email.enabled) {
    logger.warn('Password reset requested but email notifications are off', {
      label: 'API',
      ip: req.ip,
    });
    return res.status(200).json({ status: 'ok' });
  }

  const user = await userRepository
    .createQueryBuilder('user')
    .where('user.email = :email', { email: body.email.toLowerCase() })
    .getOne();

  if (user) {
    await user.resetPassword();
    await userRepository.save(user);
    logger.info('Successfully sent password reset link', {
      label: 'API',
      ip: req.ip,
      email: body.email,
    });
  } else {
    logger.warn('Password reset requested for an unknown email address', {
      label: 'API',
      ip: req.ip,
    });
  }

  return res.status(200).json({ status: 'ok' });
});

authRoutes.post(
  '/reset-password/:guid',
  authRateLimit,
  async (req, res, next) => {
    const userRepository = getRepository(User);

    if (!req.body.password || req.body.password?.length < 8) {
      logger.warn('Failed password reset attempt using invalid new password', {
        label: 'API',
        ip: req.ip,
        guid: req.params.guid,
      });
      return next({
        status: 400,
        message: AUTH_MESSAGES.passwordTooShort,
      });
    }

    const user = await userRepository.findOne({
      where: { resetPasswordGuid: String(req.params.guid) },
    });

    if (!user) {
      logger.warn('Failed password reset attempt using invalid recovery link', {
        label: 'API',
        ip: req.ip,
        guid: req.params.guid,
      });
      return next({
        status: 400,
        message:
          'That reset link is no longer valid. Ask for a new one from the sign-in page.',
      });
    }

    if (
      !user.recoveryLinkExpirationDate ||
      user.recoveryLinkExpirationDate <= new Date()
    ) {
      logger.warn('Failed password reset attempt using expired recovery link', {
        label: 'API',
        ip: req.ip,
        guid: req.params.guid,
        email: user.email,
      });
      return next({
        status: 400,
        message:
          'That reset link is no longer valid. Ask for a new one from the sign-in page.',
      });
    }
    user.recoveryLinkExpirationDate = null;
    await user.setPassword(req.body.password);
    await userRepository.save(user);
    logger.info('Successfully reset password', {
      label: 'API',
      ip: req.ip,
      guid: req.params.guid,
      email: user.email,
    });

    return res.status(200).json({ status: 'ok' });
  }
);

export default authRoutes;
