// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
// Mounted at /api/v1/service (see docs/API_CONTRACT.md). What the request
// modal needs to know about the Lidarr servers — never any secrets.
import LidarrAPI from '@server/api/servarr/lidarr';
import type {
  ServiceCommonServer,
  ServiceCommonServerWithDetails,
} from '@server/interfaces/api/serviceInterfaces';
import type { LidarrSettings } from '@server/lib/settings';
import { getSettings } from '@server/lib/settings';
import logger from '@server/logger';
import { Router } from 'express';

const router = Router();

const toCommonServer = (server: LidarrSettings): ServiceCommonServer => ({
  id: server.id,
  name: server.name,
  isHiRes: server.isHiRes,
  isDefault: server.isDefault,
  activeQualityProfileId: server.activeQualityProfileId,
  activeMetadataProfileId: server.activeMetadataProfileId,
  activeDirectory: server.activeDirectory,
  activeTags: server.tags ?? [],
});

// GET /service/lidarr · signed in
router.get<Record<string, string>, ServiceCommonServer[]>(
  '/lidarr',
  (_req, res) => {
    res.status(200).json(getSettings().lidarr.map(toCommonServer));
  }
);

// GET /service/lidarr/:id · signed in
router.get<{ id: string }, ServiceCommonServerWithDetails>(
  '/lidarr/:id',
  async (req, res, next) => {
    const server = getSettings().lidarr.find(
      (s) => s.id === Number(req.params.id)
    );

    if (!server) {
      return next({
        status: 404,
        message: "That Lidarr server doesn't exist any more.",
      });
    }

    try {
      const lidarr = LidarrAPI.fromSettings(server);
      const [profiles, metadataProfiles, rootFolders, tags] = await Promise.all(
        [
          lidarr.getProfiles(),
          lidarr.getMetadataProfiles(),
          lidarr.getRootFolders(),
          lidarr.getTags(),
        ]
      );

      return res.status(200).json({
        server: toCommonServer(server),
        profiles: profiles.map((p) => ({ id: p.id, name: p.name })),
        metadataProfiles,
        rootFolders: rootFolders.map((folder) => ({
          id: folder.id,
          path: folder.path,
          freeSpace: folder.freeSpace,
          totalSpace: folder.totalSpace,
        })),
        tags,
      });
    } catch (e) {
      logger.error('Could not load Lidarr server details', {
        label: 'API',
        server: server.name,
        errorMessage: e.message,
      });
      next({
        status: 502,
        message: `Couldn't reach Lidarr (${server.name}). The request will use its default settings.`,
      });
    }
  }
);

export default router;
