// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import JellyfinAPI from '@server/api/jellyfin';
import PlexTvAPI from '@server/api/plextv';
import { ApiErrorCode } from '@server/constants/error';
import { MediaServerType } from '@server/constants/server';
import { UserType } from '@server/constants/user';
import { getRepository } from '@server/datasource';
import { User } from '@server/entity/User';
import { UserSettings } from '@server/entity/UserSettings';
import type {
  AppPasswordCreatedResponse,
  LinkableProvider,
  LinkAuthorizeResponse,
  LinkedAccountStatus,
  UserNotificationChannel,
  UserSettingsAppPasswordsResponse,
  UserSettingsGeneralResponse,
  UserSettingsLinkedAccountsResponse,
  UserSettingsNotificationsResponse,
  UserSettingsPasswordBody,
} from '@server/interfaces/api/userSettingsInterfaces';
import {
  clientUsername,
  createAppPassword,
  listAppPasswords,
  revokeAppPassword,
} from '@server/lib/auth/appPasswords';
import {
  buildLastfmAuthorizeUrl,
  buildSpotifyAuthorizeUrl,
  getBaseUrl,
  getLinkedAccounts,
  InvalidLinkTokenError,
  isLinkProvider,
  linkProviders,
  removeLinkedAccount,
  setLinkedAccount,
} from '@server/lib/auth/linkedAccounts';
import type { NotificationTypeKey } from '@server/lib/notifications/types';
import {
  MANAGER_NOTIFICATION_TYPES,
  maskToTypes,
  MUSIC_NOTIFICATION_TYPES,
  typesToMask,
} from '@server/lib/notifications/types';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { isAuthenticated } from '@server/middleware/auth';
import { quickConnectSecret } from '@server/routes/auth';
import { ApiError } from '@server/types/error';
import { getHostname } from '@server/utils/getHostname';
import {
  isOwnProfile,
  isOwnProfileOrAdmin,
} from '@server/utils/profileMiddleware';
import { Router } from 'express';
import net from 'net';
import { Not } from 'typeorm';
import validator from 'validator';
import { canMakePermissionsChange } from '.';

export const SETTINGS_MESSAGES = {
  ownerOnly: "Only the owner can change the owner's account.",
  emailInvalid: 'Enter a valid email address.',
  emailTaken: 'That email address is already used.',
  currentPasswordRequired: 'Enter your current password.',
  currentPasswordWrong: "That current password isn't right.",
  newPasswordTooShort: 'The new password needs at least 8 characters.',
  passwordMismatch: "The passwords don't match.",
  appPasswordName: 'Give the password a name, like "Finamp on my phone".',
  ownPermissions: "You can't change your own permissions.",
  ownerPermissions: 'The owner always has full access.',
  adminOnlyByOwner: 'Only the owner can make someone an admin.',
} as const;

/** Nobody but the owner edits the owner. */
const ownerGuard = (targetId: number, actor?: User): boolean =>
  targetId === 1 && actor?.id !== 1;

const userSettingsRoutes = Router({ mergeParams: true });

userSettingsRoutes.get<{ id: string }, UserSettingsGeneralResponse>(
  '/main',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const {
      main: { defaultQuotas },
    } = getSettings();
    const userRepository = getRepository(User);

    try {
      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json({
        username: user.username,
        email: user.email,
        locale: user.settings?.locale,
        discoverRegion: user.settings?.discoverRegion,
        albumQuotaLimit: user.albumQuotaLimit,
        albumQuotaDays: user.albumQuotaDays,
        trackQuotaLimit: user.trackQuotaLimit,
        trackQuotaDays: user.trackQuotaDays,
        globalAlbumQuotaDays: defaultQuotas.album.quotaDays,
        globalAlbumQuotaLimit: defaultQuotas.album.quotaLimit,
        globalTrackQuotaDays: defaultQuotas.track.quotaDays,
        globalTrackQuotaLimit: defaultQuotas.track.quotaLimit,
        autoRequestSpotifySaved: user.settings?.autoRequestSpotifySaved,
        scrobbleEnabled: user.settings?.scrobbleEnabled,
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<
  { id: string },
  UserSettingsGeneralResponse,
  UserSettingsGeneralResponse
>('/main', isOwnProfileOrAdmin(), async (req, res, next) => {
  const userRepository = getRepository(User);

  try {
    const user = await userRepository.findOne({
      where: { id: Number(req.params.id) },
    });

    if (!user) {
      return next({ status: 404, message: 'User not found.' });
    }

    // "Owner" user settings cannot be modified by other users
    if (ownerGuard(user.id, req.user)) {
      return next({ status: 403, message: SETTINGS_MESSAGES.ownerOnly });
    }

    const oldEmail = user.email;
    if (req.body.username !== undefined) {
      user.username = req.body.username?.trim() ?? '';
    }
    // A Plex account's email comes from Plex and is refreshed at sign-in.
    if (user.userType !== UserType.PLEX && req.body.email !== undefined) {
      const email = (req.body.email ?? '').trim().toLowerCase();
      if (email && email !== oldEmail) {
        if (!validator.isEmail(email, { require_tld: false })) {
          return next({
            status: 400,
            message: SETTINGS_MESSAGES.emailInvalid,
            errors: ['email'],
          });
        }
        user.email = email;
      }
    }

    if (oldEmail !== user.email) {
      const existingUser = await userRepository.findOne({
        where: { email: user.email, id: Not(user.id) },
      });
      if (existingUser) {
        return next({
          status: 400,
          message: SETTINGS_MESSAGES.emailTaken,
          errors: ['email', ApiErrorCode.InvalidEmail],
        });
      }
    }

    // Request-limit overrides: only people who manage users set them, and
    // never for themselves or for someone who has no limit anyway
    // (docs/USER_SYSTEM.md §General). null = follow the global limit.
    const quotaKeys = [
      'albumQuotaLimit',
      'albumQuotaDays',
      'trackQuotaLimit',
      'trackQuotaDays',
    ] as const;
    if (
      req.user?.hasPermission(Permission.MANAGE_USERS) &&
      req.user.id !== user.id &&
      !user.hasPermission(Permission.MANAGE_USERS)
    ) {
      for (const key of quotaKeys) {
        const value = req.body[key];
        if (value === undefined) {
          continue;
        }
        if (value === null) {
          user[key] = null;
        } else if (Number.isInteger(value) && value >= 0) {
          user[key] = value;
        } else {
          return next({
            status: 400,
            message: 'Request limits have to be whole numbers, 0 or higher.',
            errors: [key],
          });
        }
      }
    }

    // "Request albums I save on Spotify" needs the auto-request permission.
    const mayAutoRequest = user.hasPermission(
      [Permission.AUTO_REQUEST, Permission.AUTO_REQUEST_ALBUM],
      { type: 'or' }
    );
    if (req.body.autoRequestSpotifySaved && !mayAutoRequest) {
      req.body.autoRequestSpotifySaved = false;
    }

    if (!user.settings) {
      user.settings = new UserSettings({
        user,
        locale: req.body.locale,
        discoverRegion: req.body.discoverRegion,
        autoRequestSpotifySaved: req.body.autoRequestSpotifySaved ?? false,
        scrobbleEnabled: req.body.scrobbleEnabled ?? true,
      });
    } else {
      user.settings.locale = req.body.locale ?? user.settings.locale;
      user.settings.discoverRegion =
        req.body.discoverRegion ?? user.settings.discoverRegion;
      user.settings.autoRequestSpotifySaved =
        req.body.autoRequestSpotifySaved ??
        user.settings.autoRequestSpotifySaved;
      user.settings.scrobbleEnabled =
        req.body.scrobbleEnabled ?? user.settings.scrobbleEnabled;
    }

    const savedUser = await userRepository.save(user);
    const { defaultQuotas } = getSettings().main;

    return res.status(200).json({
      username: savedUser.username,
      email: savedUser.email,
      locale: savedUser.settings?.locale,
      discoverRegion: savedUser.settings?.discoverRegion,
      albumQuotaLimit: savedUser.albumQuotaLimit,
      albumQuotaDays: savedUser.albumQuotaDays,
      trackQuotaLimit: savedUser.trackQuotaLimit,
      trackQuotaDays: savedUser.trackQuotaDays,
      globalAlbumQuotaDays: defaultQuotas.album.quotaDays,
      globalAlbumQuotaLimit: defaultQuotas.album.quotaLimit,
      globalTrackQuotaDays: defaultQuotas.track.quotaDays,
      globalTrackQuotaLimit: defaultQuotas.track.quotaLimit,
      autoRequestSpotifySaved: savedUser.settings?.autoRequestSpotifySaved,
      scrobbleEnabled: savedUser.settings?.scrobbleEnabled,
    });
  } catch (e) {
    if (e.errorCode) {
      return next({
        status: e.statusCode,
        message: e.errorCode,
      });
    }
    return next({ status: 500, message: e.message });
  }
});

userSettingsRoutes.get<{ id: string }, { hasPassword: boolean }>(
  '/password',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
        select: ['id', 'password'],
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json({ hasPassword: !!user.password });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<{ id: string }, null, UserSettingsPasswordBody>(
  '/password',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
      });

      const userWithPassword = await userRepository.findOne({
        select: ['id', 'password'],
        where: { id: Number(req.params.id) },
      });

      if (!user || !userWithPassword) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (
        ownerGuard(user.id, req.user) ||
        (user.hasPermission(Permission.ADMIN) &&
          user.id !== req.user?.id &&
          req.user?.id !== 1)
      ) {
        return next({
          status: 403,
          message: "You do not have permission to modify this user's password.",
        });
      }

      const isSelf = req.user?.id === user.id;
      const newPassword = req.body.newPassword ?? '';

      // Changing your own existing password: prove you know it first.
      if (isSelf && userWithPassword.password) {
        if (!req.body.currentPassword) {
          return next({
            status: 400,
            message: SETTINGS_MESSAGES.currentPasswordRequired,
            errors: ['currentPassword'],
          });
        }
        if (!(await userWithPassword.passwordMatch(req.body.currentPassword))) {
          logger.debug(
            'Attempt to change password for user failed. Invalid current password provided.',
            { label: 'User Settings', userId: user.id }
          );
          return next({
            status: 403,
            message: SETTINGS_MESSAGES.currentPasswordWrong,
            errors: ['currentPassword'],
          });
        }
      }

      if (newPassword.length < 8) {
        return next({
          status: 400,
          message: SETTINGS_MESSAGES.newPasswordTooShort,
          errors: ['newPassword'],
        });
      }

      if (
        req.body.confirmPassword !== undefined &&
        req.body.confirmPassword !== newPassword
      ) {
        return next({
          status: 400,
          message: SETTINGS_MESSAGES.passwordMismatch,
          errors: ['confirmPassword'],
        });
      }

      await user.setPassword(newPassword);
      await userRepository.save(user);

      if (!isSelf) {
        logger.debug('Password set by a user manager.', {
          label: 'User Settings',
          userId: user.id,
          changingUserId: req.user?.id,
        });
      }

      return res.status(204).send();
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

// ---------------------------------------------------------------------------
// Linked accounts
// ---------------------------------------------------------------------------

const plexLinkAvailable = (): boolean => {
  const settings = getSettings();
  return (
    (settings.main.mediaServerLogin && settings.plex.loginEnabled) ||
    settings.integrations.plex
  );
};

const jellyfinLinkAvailable = (): boolean => {
  const settings = getSettings();
  return (
    settings.jellyfin.ip !== '' &&
    ((settings.main.mediaServerLogin && settings.jellyfin.loginEnabled) ||
      settings.integrations.jellyfin)
  );
};

const isEmby = (): boolean =>
  getSettings().main.mediaServerType === MediaServerType.EMBY;

/** After unlinking, what does the account sign in with? */
const fallbackUserType = (
  user: User,
  removed: 'plex' | 'jellyfin'
): UserType => {
  if (removed !== 'plex' && user.plexId) {
    return UserType.PLEX;
  }
  if (removed !== 'jellyfin' && user.jellyfinUserId) {
    return isEmby() ? UserType.EMBY : UserType.JELLYFIN;
  }
  return UserType.LOCAL;
};

const loadUserWithPassword = (id: number): Promise<User | null> =>
  getRepository(User)
    .createQueryBuilder('user')
    .addSelect('user.password')
    .where('user.id = :id', { id })
    .getOne();

const buildLinkedAccounts = async (
  user: User
): Promise<LinkedAccountStatus[]> => {
  const settings = getSettings();
  const integrations = settings.integrations;
  const withPassword = await loadUserWithPassword(user.id);
  // A media-server link can only go when another way to sign in remains.
  const hasPassword = !!withPassword?.password && settings.main.localLogin;
  const links = new Map(
    (await getLinkedAccounts(user.id)).map((link) => [link.provider, link])
  );

  const external = (
    provider: 'lastfm' | 'listenbrainz' | 'spotify',
    available: boolean,
    flow: LinkedAccountStatus['flow']
  ): LinkedAccountStatus => {
    const link = links.get(provider);
    return {
      provider,
      available,
      linked: !!link,
      externalUsername: link?.externalUsername || undefined,
      canUnlink: !!link,
      flow,
      linkedAt: link ? new Date(link.createdAt).toISOString() : undefined,
    };
  };

  return [
    {
      provider: 'plex',
      available: plexLinkAvailable(),
      linked: !!user.plexId,
      externalUsername: user.plexId
        ? (user.plexUsername ?? undefined)
        : undefined,
      canUnlink: !!user.plexId && (hasPassword || !!user.jellyfinUserId),
      flow: 'plex-pin',
    },
    {
      provider: 'jellyfin',
      available: jellyfinLinkAvailable(),
      linked: !!user.jellyfinUserId,
      externalUsername: user.jellyfinUserId
        ? (user.jellyfinUsername ?? undefined)
        : undefined,
      canUnlink: !!user.jellyfinUserId && (hasPassword || !!user.plexId),
      flow: 'credentials',
    },
    external('lastfm', integrations.lastfmScrobble, 'oauth'),
    external('listenbrainz', integrations.listenbrainz, 'token'),
    external('spotify', integrations.spotify, 'oauth'),
  ];
};

const linkedStatus = async (
  user: User,
  provider: LinkableProvider
): Promise<LinkedAccountStatus> => {
  const fresh = await getRepository(User).findOneOrFail({
    where: { id: user.id },
  });
  const accounts = await buildLinkedAccounts(fresh);
  return accounts.find((account) => account.provider === provider)!;
};

userSettingsRoutes.get<{ id: string }, UserSettingsLinkedAccountsResponse>(
  '/linked-accounts',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const user = await getRepository(User).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }
      return res
        .status(200)
        .json({ accounts: await buildLinkedAccounts(user) });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<{ id: string }, unknown, { authToken?: string }>(
  '/linked-accounts/plex',
  isOwnProfile(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    if (!req.user) {
      return next({ status: 401, message: ApiErrorCode.Unauthorized });
    }
    // The owner may always link Plex: that is what makes Plex sign-in,
    // imports and the server-access check possible in the first place.
    if (!plexLinkAvailable() && req.user.id !== 1) {
      return next({ status: 400, message: 'Plex is turned off.' });
    }
    if (!req.body.authToken) {
      return next({
        status: 400,
        message: "Plex didn't confirm that sign-in. Try again.",
      });
    }

    try {
      // First we need to use this auth token to get the user's account from plex.tv
      const plextv = new PlexTvAPI(req.body.authToken);
      const account = await plextv.getUser();

      // Do not allow linking of an already linked account
      if (
        await userRepository.exist({
          where: { plexId: account.id, id: Not(req.user.id) },
        })
      ) {
        return next({
          status: 422,
          message:
            'That Plex account is already linked to another Shufflerr user.',
        });
      }

      const user = req.user;

      // valid plex user found, link to current user
      user.userType = UserType.PLEX;
      user.plexId = account.id;
      user.plexUsername = account.username;
      user.plexToken = account.authToken;
      if (account.thumb && (!user.avatar || user.avatar.includes('gravatar'))) {
        user.avatar = account.thumb;
      }
      await userRepository.save(user);

      return res.status(200).json(await linkedStatus(user, 'plex'));
    } catch (e) {
      logger.error('Failed to link a Plex account.', {
        label: 'API',
        ip: req.ip,
        errorMessage: e.message,
      });
      return next({
        status: 500,
        message: "Plex didn't confirm that sign-in. Try again.",
      });
    }
  }
);

const unlinkMediaServer = async (
  targetId: number,
  provider: 'plex' | 'jellyfin'
): Promise<{ status: number; message?: string }> => {
  const userRepository = getRepository(User);
  const user = await loadUserWithPassword(targetId);

  if (!user) {
    return { status: 404, message: 'User not found.' };
  }

  const linked = provider === 'plex' ? !!user.plexId : !!user.jellyfinUserId;
  if (!linked) {
    return { status: 204 };
  }

  const otherLink = provider === 'plex' ? !!user.jellyfinUserId : !!user.plexId;
  const hasPassword = !!user.password && getSettings().main.localLogin;
  if (!otherLink && !hasPassword) {
    return {
      status: 400,
      message:
        'This is how the account signs in. Set a password first, then unlink it.',
    };
  }

  if (provider === 'plex') {
    user.plexId = null;
    user.plexUsername = null;
    user.plexToken = null;
  } else {
    user.jellyfinUserId = null;
    user.jellyfinUsername = null;
    user.jellyfinAuthToken = null;
    user.jellyfinDeviceId = null;
  }
  user.userType = fallbackUserType(user, provider);
  await userRepository.save(user);
  return { status: 204 };
};

userSettingsRoutes.post<
  { id: string },
  unknown,
  { username?: string; password?: string }
>('/linked-accounts/jellyfin', isOwnProfile(), async (req, res, next) => {
  const userRepository = getRepository(User);

  if (!req.user) {
    return next({ status: 401, message: ApiErrorCode.Unauthorized });
  }
  if (!jellyfinLinkAvailable()) {
    return next({
      status: 400,
      message:
        "Jellyfin isn't connected yet. Ask an admin to set it up in Settings.",
    });
  }
  if (!req.body.username) {
    return next({
      status: 400,
      message: 'Enter your Jellyfin username and password.',
    });
  }

  const hostname = getHostname();
  const deviceId = Buffer.from(
    req.user.id === 1
      ? 'BOT_shufflerr'
      : `BOT_shufflerr_${req.user.username ?? ''}`
  ).toString('base64');

  const jellyfinserver = new JellyfinAPI(hostname, undefined, deviceId);

  const ip = req.ip;
  let clientIp: string | undefined;
  if (ip) {
    if (net.isIPv4(ip)) {
      clientIp = ip;
    } else if (net.isIPv6(ip)) {
      clientIp = ip.startsWith('::ffff:') ? ip.substring(7) : ip;
    }
  }

  try {
    const account = await jellyfinserver.login(
      req.body.username,
      req.body.password,
      clientIp
    );

    // Do not allow linking of an already linked account
    if (
      await userRepository.exist({
        where: { jellyfinUserId: account.User.Id, id: Not(req.user.id) },
      })
    ) {
      return next({
        status: 422,
        message:
          'That Jellyfin account is already linked to another Shufflerr user.',
      });
    }

    const user = req.user;

    // valid jellyfin user found, link to current user
    if (!user.plexId) {
      user.userType = isEmby() ? UserType.EMBY : UserType.JELLYFIN;
    }
    user.jellyfinUserId = account.User.Id;
    user.jellyfinUsername = account.User.Name;
    user.jellyfinAuthToken = account.AccessToken;
    user.jellyfinDeviceId = deviceId;
    await userRepository.save(user);

    return res.status(200).json(await linkedStatus(user, 'jellyfin'));
  } catch (e) {
    logger.error('Failed to link a Jellyfin account.', {
      label: 'API',
      ip: req.ip,
      errorMessage: e.message,
    });
    if (
      e instanceof ApiError &&
      e.errorCode === ApiErrorCode.InvalidCredentials
    ) {
      return next({
        status: 401,
        message: "Jellyfin didn't accept that username and password.",
        errors: [e.errorCode],
      });
    }

    return next({
      status: 500,
      message: "Couldn't reach Jellyfin. Try again in a moment.",
    });
  }
});

userSettingsRoutes.post<{ id: string }, unknown, { secret?: string }>(
  '/linked-accounts/jellyfin/quickconnect',
  isOwnProfile(),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    if (!req.user) {
      return next({ status: 401, message: ApiErrorCode.Unauthorized });
    }

    const result = quickConnectSecret.safeParse(req.body);
    if (!result.success) {
      return next({ status: 400, message: 'Invalid secret format' });
    }

    const { secret } = result.data;

    if (!jellyfinLinkAvailable()) {
      return next({
        status: 400,
        message:
          "Jellyfin isn't connected yet. Ask an admin to set it up in Settings.",
      });
    }

    if (isEmby()) {
      return next({
        status: 403,
        message: 'Quick Connect is only supported by Jellyfin.',
      });
    }

    const hostname = getHostname();
    const jellyfinServer = new JellyfinAPI(hostname);

    try {
      const account = await jellyfinServer.authenticateQuickConnect(secret);

      if (
        await userRepository.exist({
          where: { jellyfinUserId: account.User.Id, id: Not(req.user.id) },
        })
      ) {
        return next({
          status: 422,
          message:
            'That Jellyfin account is already linked to another Shufflerr user.',
        });
      }

      const user = req.user;
      const deviceId = Buffer.from(
        user.id === 1 ? 'BOT_shufflerr' : `BOT_shufflerr_${user.username ?? ''}`
      ).toString('base64');

      if (!user.plexId) {
        user.userType = UserType.JELLYFIN;
      }
      user.jellyfinUserId = account.User.Id;
      user.jellyfinUsername = account.User.Name;
      user.jellyfinAuthToken = account.AccessToken;
      user.jellyfinDeviceId = deviceId;
      await userRepository.save(user);

      return res.status(200).json(await linkedStatus(user, 'jellyfin'));
    } catch (e) {
      logger.error('Failed to link account with Quick Connect.', {
        label: 'API',
        ip: req.ip,
        errorMessage: e.message,
      });

      return next({
        status: e instanceof ApiError ? e.statusCode : 500,
        message: "Jellyfin didn't approve that Quick Connect code.",
      });
    }
  }
);

// ListenBrainz: the user pastes their token; it is checked before it is stored.
userSettingsRoutes.post<{ id: string }, unknown, { token?: string }>(
  '/linked-accounts/listenbrainz',
  isOwnProfile(),
  async (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: ApiErrorCode.Unauthorized });
    }
    if (!getSettings().integrations.listenbrainz) {
      return next({ status: 400, message: 'ListenBrainz is turned off.' });
    }
    const token = (req.body.token ?? '').trim();
    if (!token) {
      return next({
        status: 400,
        message:
          'Paste your ListenBrainz user token. You find it on listenbrainz.org under Settings.',
      });
    }

    try {
      const result = await linkProviders.listenbrainzValidate(token);
      await setLinkedAccount(req.user.id, 'listenbrainz', result);
      return res.status(200).json(await linkedStatus(req.user, 'listenbrainz'));
    } catch (e) {
      if (e instanceof InvalidLinkTokenError) {
        return next({ status: 400, message: e.message });
      }
      logger.error('Failed to validate a ListenBrainz token.', {
        label: 'API',
        userId: req.user.id,
        errorMessage: e.message,
      });
      return next({
        status: 502,
        message: "Couldn't reach ListenBrainz to check the token. Try again.",
      });
    }
  }
);

// Last.fm and Spotify start in the browser: open the returned URL.
userSettingsRoutes.get<{ id: string; provider: string }, LinkAuthorizeResponse>(
  '/linked-accounts/:provider/authorize',
  isOwnProfile(),
  async (req, res, next) => {
    if (!req.user) {
      return next({ status: 401, message: ApiErrorCode.Unauthorized });
    }
    const integrations = getSettings().integrations;
    const returnPath = '/profile/settings/linked-accounts';

    switch (req.params.provider) {
      case 'lastfm':
        if (!integrations.lastfmScrobble) {
          return next({ status: 400, message: 'Last.fm is turned off.' });
        }
        return res.status(200).json({
          url: buildLastfmAuthorizeUrl(req.user.id, returnPath, req),
        });
      case 'spotify':
        if (!integrations.spotify) {
          return next({ status: 400, message: 'Spotify is turned off.' });
        }
        return res.status(200).json({
          url: buildSpotifyAuthorizeUrl(req.user.id, returnPath, req),
        });
      default:
        return next({
          status: 404,
          message: "That account type can't be linked this way.",
        });
    }
  }
);

userSettingsRoutes.delete<{ id: string; provider: string }>(
  '/linked-accounts/:provider',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const targetId = Number(req.params.id);
      if (ownerGuard(targetId, req.user)) {
        return next({ status: 403, message: SETTINGS_MESSAGES.ownerOnly });
      }
      const provider = req.params.provider;

      if (provider === 'plex' || provider === 'jellyfin') {
        const result = await unlinkMediaServer(targetId, provider);
        if (result.status !== 204) {
          return next(result);
        }
        return res.status(204).send();
      }

      if (!isLinkProvider(provider)) {
        return next({ status: 404, message: 'Unknown account type.' });
      }

      await removeLinkedAccount(targetId, provider);

      // No Spotify link, nothing to auto-request from.
      if (provider === 'spotify') {
        const user = await getRepository(User).findOne({
          where: { id: targetId },
        });
        if (user?.settings?.autoRequestSpotifySaved) {
          user.settings.autoRequestSpotifySaved = false;
          await getRepository(User).save(user);
        }
      }

      return res.status(204).send();
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

// ---------------------------------------------------------------------------
// App passwords
// ---------------------------------------------------------------------------

userSettingsRoutes.get<{ id: string }, UserSettingsAppPasswordsResponse>(
  '/app-passwords',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const settings = getSettings();
      const user = await getRepository(User).findOne({
        where: { id: Number(req.params.id) },
      });
      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json({
        serverUrl: getBaseUrl(req),
        username: clientUsername(user),
        openSubsonicEnabled: settings.clients.openSubsonic,
        jellyfinApiEnabled: settings.clients.jellyfinApi,
        passwords: await listAppPasswords(user.id),
      });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<
  { id: string },
  AppPasswordCreatedResponse,
  { name?: string }
>('/app-passwords', isOwnProfile(), async (req, res, next) => {
  try {
    if (!req.user) {
      return next({ status: 401, message: ApiErrorCode.Unauthorized });
    }
    const name = (req.body.name ?? '').trim();
    if (!name || name.length > 80) {
      return next({
        status: 400,
        message: SETTINGS_MESSAGES.appPasswordName,
        errors: ['name'],
      });
    }

    const { item, password } = await createAppPassword(req.user, name);
    logger.info('Created an app password', {
      label: 'User Settings',
      userId: req.user.id,
      appPasswordId: item.id,
    });

    // The only time the plaintext leaves the server.
    return res.status(201).json({ ...item, password });
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

userSettingsRoutes.delete<{ id: string; passwordId: string }>(
  '/app-passwords/:passwordId',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const targetId = Number(req.params.id);
      if (ownerGuard(targetId, req.user)) {
        return next({ status: 403, message: SETTINGS_MESSAGES.ownerOnly });
      }
      const removed = await revokeAppPassword(
        targetId,
        Number(req.params.passwordId)
      );
      if (!removed) {
        return next({ status: 404, message: 'App password not found.' });
      }
      return res.status(204).send();
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

type ChannelKey = keyof UserSettingsNotificationsResponse['channels'];
const CHANNELS: ChannelKey[] = [
  'email',
  'webpush',
  'discord',
  'telegram',
  'pushbullet',
  'pushover',
];

/** Manager-only types are offered only to people who manage requests. */
const availableTypesFor = (user: User): NotificationTypeKey[] =>
  MUSIC_NOTIFICATION_TYPES.filter(
    (type) =>
      !MANAGER_NOTIFICATION_TYPES.includes(type) ||
      user.hasPermission(Permission.MANAGE_REQUESTS)
  );

const buildNotifications = (user: User): UserSettingsNotificationsResponse => {
  const agents = getSettings().notifications.agents;
  const availableTypes = availableTypesFor(user);
  const stored = user.settings?.notificationTypes ?? {};

  const channel = (
    key: ChannelKey,
    available: boolean
  ): UserNotificationChannel => {
    // Without saved settings, email and web push default to everything
    // (Seerr behaviour); the other channels start off.
    const mask =
      stored[key] ??
      (key === 'email' || key === 'webpush' ? typesToMask(availableTypes) : 0);
    const types = maskToTypes(mask).filter((type) =>
      availableTypes.includes(type)
    );
    return { available, enabled: types.length > 0, types };
  };

  return {
    availableTypes,
    channels: {
      email: {
        ...channel('email', agents.email.enabled),
        pgpKey: user.settings?.pgpKey ?? undefined,
      },
      webpush: channel('webpush', agents.webpush.enabled),
      discord: {
        ...channel(
          'discord',
          agents.discord.enabled && !!agents.discord.options.enableMentions
        ),
        discordIds: user.settings?.discordIds ?? [],
      },
      telegram: {
        ...channel('telegram', agents.telegram.enabled),
        telegramBotUsername: agents.telegram.options.botUsername || undefined,
        telegramChatId: user.settings?.telegramChatId ?? undefined,
        telegramMessageThreadId:
          user.settings?.telegramMessageThreadId ?? undefined,
        telegramSendSilently: user.settings?.telegramSendSilently ?? false,
      },
      pushbullet: {
        ...channel('pushbullet', agents.pushbullet.enabled),
        pushbulletAccessToken:
          user.settings?.pushbulletAccessToken ?? undefined,
      },
      pushover: {
        ...channel('pushover', agents.pushover.enabled),
        pushoverApplicationToken:
          user.settings?.pushoverApplicationToken ?? undefined,
        pushoverUserKey: user.settings?.pushoverUserKey ?? undefined,
        pushoverSound: user.settings?.pushoverSound ?? undefined,
      },
    },
  };
};

userSettingsRoutes.get<{ id: string }, UserSettingsNotificationsResponse>(
  '/notifications',
  isOwnProfileOrAdmin(),
  async (req, res, next) => {
    try {
      const user = await getRepository(User).findOne({
        where: { id: Number(req.params.id) },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json(buildNotifications(user));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

type ChannelInput = Partial<
  UserNotificationChannel & {
    pgpKey: string;
    discordIds: string[];
    telegramChatId: string;
    telegramMessageThreadId: string;
    telegramSendSilently: boolean;
    pushbulletAccessToken: string;
    pushoverApplicationToken: string;
    pushoverUserKey: string;
    pushoverSound: string;
  }
>;

userSettingsRoutes.post<
  { id: string },
  UserSettingsNotificationsResponse,
  { channels?: Partial<Record<ChannelKey, ChannelInput>> }
>('/notifications', isOwnProfileOrAdmin(), async (req, res, next) => {
  const userRepository = getRepository(User);

  try {
    const user = await userRepository.findOne({
      where: { id: Number(req.params.id) },
    });

    if (!user) {
      return next({ status: 404, message: 'User not found.' });
    }

    // "Owner" user settings cannot be modified by other users
    if (ownerGuard(user.id, req.user)) {
      return next({ status: 403, message: SETTINGS_MESSAGES.ownerOnly });
    }

    const channels = req.body.channels ?? {};
    const availableTypes = availableTypesFor(user);

    if (!user.settings) {
      user.settings = new UserSettings({ user, notificationTypes: {} });
    }
    const settings = user.settings;
    const current = buildNotifications(user).channels;
    const masks = { ...(settings.notificationTypes ?? {}) };

    for (const key of CHANNELS) {
      const input = channels[key];
      if (!input) {
        continue;
      }
      // "Send me <channel> notifications" off = no types; the checklist is
      // kept client-side while the switch is off.
      const enabled = input.enabled ?? current[key].enabled;
      const types = (input.types ?? current[key].types).filter((type) =>
        availableTypes.includes(type)
      );
      masks[key] = enabled ? typesToMask(types) : 0;
    }
    settings.notificationTypes = masks;

    // Channel fields: only touch what was sent. Empty string clears.
    const text = (value: string | undefined, currentValue?: string) =>
      value === undefined ? currentValue : value.trim() || undefined;

    if (channels.email) {
      settings.pgpKey = text(channels.email.pgpKey, settings.pgpKey);
    }
    if (channels.discord?.discordIds !== undefined) {
      const ids = (channels.discord.discordIds ?? [])
        .map((id) => String(id).trim())
        .filter((id) => id !== '');
      if (ids.some((id) => !/^\d{17,20}$/.test(id))) {
        return next({
          status: 400,
          message:
            'A Discord user ID is a number of 17 to 20 digits. Copy it from Discord with developer mode on.',
          errors: ['discordIds'],
        });
      }
      settings.discordIds = ids;
    }
    if (channels.telegram) {
      settings.telegramChatId = text(
        channels.telegram.telegramChatId,
        settings.telegramChatId
      );
      settings.telegramMessageThreadId = text(
        channels.telegram.telegramMessageThreadId,
        settings.telegramMessageThreadId
      );
      if (channels.telegram.telegramSendSilently !== undefined) {
        settings.telegramSendSilently =
          !!channels.telegram.telegramSendSilently;
      }
    }
    if (channels.pushbullet) {
      settings.pushbulletAccessToken = text(
        channels.pushbullet.pushbulletAccessToken,
        settings.pushbulletAccessToken
      );
    }
    if (channels.pushover) {
      settings.pushoverApplicationToken = text(
        channels.pushover.pushoverApplicationToken,
        settings.pushoverApplicationToken
      );
      settings.pushoverUserKey = text(
        channels.pushover.pushoverUserKey,
        settings.pushoverUserKey
      );
      settings.pushoverSound = text(
        channels.pushover.pushoverSound,
        settings.pushoverSound
      );
    }

    await userRepository.save(user);

    return res.status(200).json(buildNotifications(user));
  } catch (e) {
    next({ status: 500, message: e.message });
  }
});

// ---------------------------------------------------------------------------
// Permissions
// ---------------------------------------------------------------------------

/**
 * Seerr rule, kept: the tab is hidden on your own account unless you're the
 * owner (`currentUser.id !== 1 && currentUser.id === user.id`).
 */
const ownPermissionsHidden = (targetId: number, actor?: User): boolean =>
  actor?.id !== 1 && actor?.id === targetId;

userSettingsRoutes.get<{ id: string }, { permissions?: number }>(
  '/permissions',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      if (ownPermissionsHidden(user.id, req.user)) {
        return next({
          status: 403,
          message: SETTINGS_MESSAGES.ownPermissions,
        });
      }

      return res.status(200).json({ permissions: user.permissions });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

userSettingsRoutes.post<
  { id: string },
  { permissions?: number },
  { permissions: number }
>(
  '/permissions',
  isAuthenticated(Permission.MANAGE_USERS),
  async (req, res, next) => {
    const userRepository = getRepository(User);

    try {
      const user = await userRepository.findOne({
        where: { id: Number(req.params.id) },
      });

      if (!user) {
        return next({ status: 404, message: 'User not found.' });
      }

      // The owner always has full access; nobody edits that, the owner included.
      if (user.id === 1) {
        return next({
          status: 403,
          message: SETTINGS_MESSAGES.ownerPermissions,
        });
      }

      // Users cannot set their own permissions.
      if (req.user?.id === user.id) {
        return next({
          status: 403,
          message: SETTINGS_MESSAGES.ownPermissions,
        });
      }

      if (!Number.isInteger(req.body.permissions) || req.body.permissions < 0) {
        return next({
          status: 400,
          message: 'Choose the permissions to save.',
        });
      }

      // Only the owner grants admin, or changes someone who already is one.
      if (
        !canMakePermissionsChange(req.body.permissions, req.user) ||
        (user.hasPermission(Permission.ADMIN) && req.user?.id !== 1)
      ) {
        return next({
          status: 403,
          message: SETTINGS_MESSAGES.adminOnlyByOwner,
        });
      }

      // ADMIN covers everything else (docs/PERMISSIONS_AND_APPROVALS.md):
      // store just that bit.
      user.permissions =
        req.body.permissions & Permission.ADMIN
          ? Permission.ADMIN
          : req.body.permissions;

      await userRepository.save(user);

      return res.status(200).json({ permissions: user.permissions });
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export default userSettingsRoutes;
