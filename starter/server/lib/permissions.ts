// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Original: server/lib/permissions.ts at commit 2cfbcf8940225f1597d44f507fd78040887c5597
//
// Shufflerr keeps Seerr's bitmask mechanism and hasPermission() semantics unchanged.
// Movie/TV/4K bits are retired; their values are reused for music where the meaning maps
// cleanly, so the bit layout stays inside 32-bit signed integer range (JS bitwise safe).
// Bits that have no music meaning are left unassigned (do NOT reuse them for something
// unrelated without a migration note).

export enum Permission {
  NONE = 0,
  ADMIN = 2,
  MANAGE_SETTINGS = 4,
  MANAGE_USERS = 8,
  MANAGE_REQUESTS = 16,
  REQUEST = 32, // request anything (album, tracks, discography)
  VOTE = 64, // backlog: request voting
  AUTO_APPROVE = 128, // auto-approve anything
  AUTO_APPROVE_ALBUM = 256, // was AUTO_APPROVE_MOVIE
  AUTO_APPROVE_TRACK = 512, // was AUTO_APPROVE_TV
  REQUEST_DISCOGRAPHY = 1024, // was REQUEST_4K
  REQUEST_HIRES = 2048, // was REQUEST_4K_MOVIE  (backlog: hi-res as a request option)
  // 4096 (REQUEST_4K_TV) intentionally unused
  REQUEST_ADVANCED = 8192, // choose server / quality / metadata profile / folder
  REQUEST_VIEW = 16384, // see everyone's requests
  AUTO_APPROVE_DISCOGRAPHY = 32768, // was AUTO_APPROVE_4K
  AUTO_APPROVE_HIRES = 65536, // was AUTO_APPROVE_4K_MOVIE
  // 131072 (AUTO_APPROVE_4K_TV) intentionally unused
  REQUEST_ALBUM = 262144, // was REQUEST_MOVIE
  REQUEST_TRACK = 524288, // was REQUEST_TV
  MANAGE_ISSUES = 1048576,
  VIEW_ISSUES = 2097152,
  CREATE_ISSUES = 4194304,
  AUTO_REQUEST = 8388608, // watchlist / Spotify saved albums auto-request
  AUTO_REQUEST_ALBUM = 16777216,
  AUTO_REQUEST_TRACK = 33554432,
  RECENT_VIEW = 67108864,
  WATCHLIST_VIEW = 134217728,
  MANAGE_BLOCKLIST = 268435456,
  VIEW_BLOCKLIST = 1073741824,
}

export interface PermissionCheckOptions {
  type: 'and' | 'or';
}

/**
 * Same semantics as Seerr:
 * - ADMIN always passes.
 * - Array + 'and' => every permission required; Array + 'or' => any one.
 * - Permission.NONE (0) always passes.
 */
export const hasPermission = (
  permissions: Permission | Permission[],
  value: number,
  options: PermissionCheckOptions = { type: 'and' }
): boolean => {
  let total = 0;

  if (permissions === 0) {
    return true;
  }

  if (Array.isArray(permissions)) {
    if (value & Permission.ADMIN) {
      return true;
    }
    switch (options.type) {
      case 'and':
        return permissions.every((permission) => !!(value & permission));
      case 'or':
        return permissions.some((permission) => !!(value & permission));
    }
  } else {
    total = permissions;
  }

  return !!(value & Permission.ADMIN) || !!(value & total);
};

/** Request type -> [request permission, auto-approve permission]. */
export const REQUEST_TYPE_PERMISSIONS = {
  album: [Permission.REQUEST_ALBUM, Permission.AUTO_APPROVE_ALBUM],
  tracks: [Permission.REQUEST_TRACK, Permission.AUTO_APPROVE_TRACK],
  discography: [
    Permission.REQUEST_DISCOGRAPHY,
    Permission.AUTO_APPROVE_DISCOGRAPHY,
  ],
} as const;
