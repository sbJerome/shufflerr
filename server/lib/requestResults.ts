// Turns MediaRequest entities into the RequestResult shape lists show
// (docs/API_CONTRACT.md): cover, profile name, what the viewer may do, the
// "last change" line and whether the requested music can be played.
import LidarrAPI from '@server/api/servarr/lidarr';
import {
  MediaRequestStatus,
  MediaStatus,
  MediaType,
  RequestScope,
} from '@server/constants/media';
import type { MediaRequest } from '@server/entity/MediaRequest';
import type { User } from '@server/entity/User';
import type { RequestResult } from '@server/interfaces/api/requestInterfaces';
import downloadTracker from '@server/lib/downloadtracker';
import { coverUrlFor } from '@server/lib/metadata';
import { Permission } from '@server/lib/permissions';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';

export type ServiceErrors = { lidarr: { id: number; name: string }[] };

/** "Approved automatically" | "Approved by <name>" | "Declined by <name>" | "Failed after approval" | "No changes yet" */
export const lastChangeLabel = (request: MediaRequest): string => {
  switch (request.status) {
    case MediaRequestStatus.FAILED:
      return 'Failed after approval';
    case MediaRequestStatus.DECLINED:
      return request.modifiedBy
        ? `Declined by ${request.modifiedBy.displayName}`
        : 'Declined';
    case MediaRequestStatus.APPROVED:
    case MediaRequestStatus.COMPLETED:
      if (request.isAutoApproved) {
        return 'Approved automatically';
      }
      return request.modifiedBy
        ? `Approved by ${request.modifiedBy.displayName}`
        : 'Approved';
    default:
      return 'No changes yet';
  }
};

const isPlayable = (request: MediaRequest): boolean => {
  if (request.scope === RequestScope.TRACKS) {
    return (
      (request.tracks ?? []).length > 0 &&
      request.tracks.every(
        (tr) =>
          tr.track?.status === MediaStatus.AVAILABLE &&
          Object.values(tr.track.sourceIds ?? {}).some(Boolean)
      )
    );
  }
  if (request.scope === RequestScope.ALBUM) {
    return request.media?.libraryStatus?.() === MediaStatus.AVAILABLE;
  }
  return false;
};

/**
 * Resolve display fields for a page of requests as seen by `viewer`. Quality
 * profile names come from settings; only a request with its own profile
 * choice needs a (cached) call to its Lidarr server.
 */
export const toRequestResults = async (
  requests: MediaRequest[],
  viewer: User
): Promise<{ results: RequestResult[]; serviceErrors: ServiceErrors }> => {
  const servers = getSettings().lidarr;
  const canManage = viewer.hasPermission(Permission.MANAGE_REQUESTS);
  const serviceErrors: ServiceErrors = { lidarr: [] };
  const profileNames = new Map<number, Map<number, string> | null>();

  const profileName = async (
    request: MediaRequest
  ): Promise<string | undefined> => {
    const server =
      servers.find(
        (s) => s.id === (request.serverId ?? request.media?.lidarrServerId)
      ) ??
      servers.find((s) => s.isDefault && s.isHiRes === !!request.isHiRes) ??
      servers.find((s) => s.isDefault);

    if (!server) {
      return undefined;
    }
    if (
      request.qualityProfileId === null ||
      request.qualityProfileId === undefined ||
      request.qualityProfileId === server.activeQualityProfileId
    ) {
      return server.activeQualityProfileName || undefined;
    }

    if (!profileNames.has(server.id)) {
      try {
        const profiles = await LidarrAPI.fromSettings(server).getProfiles();
        profileNames.set(
          server.id,
          new Map(profiles.map((p) => [p.id, p.name]))
        );
      } catch (e) {
        logger.debug('Could not load quality profiles for the request list', {
          label: 'Media Request',
          server: server.name,
          errorMessage: e.message,
        });
        profileNames.set(server.id, null);
        serviceErrors.lidarr.push({ id: server.id, name: server.name });
      }
    }

    return profileNames.get(server.id)?.get(request.qualityProfileId);
  };

  const results: RequestResult[] = [];

  for (const request of requests) {
    const media = request.media;

    if (
      media &&
      media.lidarrServerId !== null &&
      media.lidarrServerId !== undefined &&
      media.lidarrAlbumId
    ) {
      media.downloadStatus = downloadTracker.getMusicProgress(
        media.lidarrServerId,
        media.lidarrAlbumId
      );
    }

    results.push({
      ...request,
      coverUrl:
        media?.mediaType === MediaType.RELEASE_GROUP &&
        getSettings().metadata.coverArtArchive.enabled
          ? coverUrlFor(media.mbid)
          : null,
      profileName: await profileName(request),
      canManage,
      canRemove:
        canManage ||
        (request.requestedBy?.id === viewer.id &&
          request.status === MediaRequestStatus.PENDING),
      lastChange: lastChangeLabel(request),
      playable: isPlayable(request),
    });
  }

  return { results, serviceErrors };
};

export const toRequestResult = async (
  request: MediaRequest,
  viewer: User
): Promise<RequestResult> =>
  (await toRequestResults([request], viewer)).results[0];
