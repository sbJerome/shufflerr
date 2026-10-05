import type { User } from '@app/hooks/useUser';
import { Permission, useUser } from '@app/hooks/useUser';
import { MediaType, RequestScope } from '@server/constants/media';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import { hasPermission } from '@server/lib/permissions';
import { useRouter } from 'next/router';

/**
 * Resolves the profile being viewed: `/users/[userId]/…` → that user,
 * `/profile/…` → the signed-in user. `base` is the route prefix for links.
 */
export const useProfileUser = () => {
  const router = useRouter();
  const routeId = router.query.userId ? Number(router.query.userId) : undefined;
  const { user: currentUser, hasPermission: currentHasPermission } = useUser();
  const viewed = useUser({ id: routeId });
  const user = routeId ? viewed.user : currentUser;
  const base = routeId ? `/users/${routeId}` : '/profile';
  const isSelf = !!user && !!currentUser && user.id === currentUser.id;

  return {
    user,
    currentUser,
    base,
    isSelf,
    loading: routeId ? viewed.loading : !currentUser,
    error: routeId ? viewed.error : undefined,
    revalidate: viewed.revalidate,
    currentHasPermission,
  };
};

/** docs/USER_SYSTEM.md: you can always edit yourself; others need MANAGE_USERS and the target isn't the owner (unless you are). */
export const canEditUser = (actor?: User, target?: User): boolean => {
  if (!actor || !target) {
    return false;
  }
  if (actor.id === target.id) {
    return true;
  }
  if (!hasPermission(Permission.MANAGE_USERS, actor.permissions)) {
    return false;
  }
  return target.id !== 1 || actor.id === 1;
};

/** Seerr rule: hidden: currentUser.id !== 1 && currentUser.id === user.id */
export const canSeePermissionsTab = (actor?: User, target?: User): boolean => {
  if (!actor || !target) {
    return false;
  }
  if (!hasPermission(Permission.MANAGE_USERS, actor.permissions)) {
    return false;
  }
  if (target.id === 1 && actor.id !== 1) {
    return false;
  }
  return !(actor.id !== 1 && actor.id === target.id);
};

export const requestHref = (request: RequestResult): string =>
  request.media?.mediaType === MediaType.ARTIST
    ? `/artist/${request.media.mbid}`
    : `/album/${request.media?.mbid}`;

export const scopeOf = (request: RequestResult): RequestScope =>
  request.scope ?? RequestScope.ALBUM;

/** The server puts user-facing copy in `message`; fall back to our own sentence. */
export const apiErrorMessage = (e: unknown, fallback: string): string => {
  const message = (e as { response?: { data?: { message?: unknown } } })
    ?.response?.data?.message;
  return typeof message === 'string' && message.length > 0 ? message : fallback;
};

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 31536000],
  ['month', 2592000],
  ['week', 604800],
  ['day', 86400],
  ['hour', 3600],
  ['minute', 60],
];

/** "3 hours ago" in the viewer's locale. */
export const timeAgo = (
  date: string | Date | null | undefined,
  locale: string
): string => {
  if (!date) {
    return '';
  }
  const seconds = Math.round((new Date(date).getTime() - Date.now()) / 1000);
  const formatter = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) {
      return formatter.format(Math.round(seconds / size), unit);
    }
  }
  return formatter.format(Math.min(seconds, 0) === 0 ? 0 : -1, 'minute');
};
