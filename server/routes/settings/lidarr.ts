// STREAM(SV2): implement (adapt Seerr's routes/settings/radarr.ts at commit
// 2cfbcf8940225f1597d44f507fd78040887c5597). Mounted at /api/v1/settings/lidarr.
import { notImplemented } from '@server/routes/_stub';
import { Router } from 'express';

const lidarrRoutes = Router();

// GET    /            → LidarrSettingsResponse (apiKey masked, live status per server)
// POST   /            → create server (exactly one default; at most one default hi-res)
// POST   /test        → LidarrTestResponse { profiles, metadataProfiles, rootFolders, tags }
// PUT    /:id         → update
// GET    /:id/profiles→ QualityProfile[]
// DELETE /:id         → remove
lidarrRoutes.get('/', notImplemented('SV2'));
lidarrRoutes.post('/', notImplemented('SV2'));
lidarrRoutes.post('/test', notImplemented('SV2'));
lidarrRoutes.put('/:id', notImplemented('SV2'));
lidarrRoutes.get('/:id/profiles', notImplemented('SV2'));
lidarrRoutes.delete('/:id', notImplemented('SV2'));

export default lidarrRoutes;
