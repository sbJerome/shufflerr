// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { getRepository } from '@server/datasource';
import OverrideRule from '@server/entity/OverrideRule';
import { User } from '@server/entity/User';
import type { OverrideRuleResultsResponse } from '@server/interfaces/api/overrideRuleInterfaces';
import overrideRules, {
  type OverrideRulesResult,
} from '@server/lib/overrideRules';
import { Permission } from '@server/lib/permissions';
import { isAuthenticated } from '@server/middleware/auth';
import { Router } from 'express';

type OverrideRuleBody = {
  users?: string;
  genre?: string;
  label?: string;
  primaryType?: string;
  profileId?: number;
  metadataProfileId?: number;
  rootFolder?: string;
  tags?: string;
  lidarrServiceId?: number;
};

const fields = (body: OverrideRuleBody): OverrideRuleBody => ({
  users: body.users,
  genre: body.genre,
  label: body.label,
  primaryType: body.primaryType,
  profileId: body.profileId,
  metadataProfileId: body.metadataProfileId,
  rootFolder: body.rootFolder,
  tags: body.tags,
  lidarrServiceId: body.lidarrServiceId,
});

const overrideRuleRoutes = Router();

overrideRuleRoutes.get(
  '/',
  isAuthenticated(Permission.MANAGE_SETTINGS),
  async (_req, res, next) => {
    try {
      const rules = await getRepository(OverrideRule).find({});

      return res.status(200).json(rules as OverrideRuleResultsResponse);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

overrideRuleRoutes.post<Record<string, string>, OverrideRule, OverrideRuleBody>(
  '/',
  isAuthenticated(Permission.MANAGE_SETTINGS),
  async (req, res, next) => {
    try {
      const rule = await getRepository(OverrideRule).save(
        new OverrideRule(fields(req.body))
      );

      return res.status(200).json(rule);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

/** Which server/profile/folder the rules would pick for a request (request modal). */
overrideRuleRoutes.post<
  Record<string, string>,
  OverrideRulesResult,
  {
    requestUser?: number;
    genres?: string[];
    labels?: string[];
    primaryType?: string;
    tags?: number[] | null;
    serviceId?: number;
  }
>(
  '/advancedRequest',
  isAuthenticated([Permission.REQUEST_ADVANCED, Permission.MANAGE_REQUESTS], {
    type: 'or',
  }),
  async (req, res, next) => {
    try {
      let ruleUser: User | null = req.user ?? null;

      if (
        req.body.requestUser &&
        req.user?.hasPermission(Permission.MANAGE_REQUESTS)
      ) {
        ruleUser = await getRepository(User).findOne({
          where: { id: Number(req.body.requestUser) },
        });
      }

      if (!ruleUser) {
        return next({ status: 404, message: 'User not found.' });
      }

      return res.status(200).json(
        await overrideRules({
          requestUser: ruleUser,
          genres: req.body.genres,
          labels: req.body.labels,
          primaryType: req.body.primaryType,
          tags: req.body.tags,
          serviceId: req.body.serviceId,
        })
      );
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

overrideRuleRoutes.put<{ ruleId: string }, OverrideRule, OverrideRuleBody>(
  '/:ruleId',
  isAuthenticated(Permission.MANAGE_SETTINGS),
  async (req, res, next) => {
    try {
      const repository = getRepository(OverrideRule);
      const rule = await repository.findOne({
        where: { id: Number(req.params.ruleId) },
      });

      if (!rule) {
        return next({ status: 404, message: 'Override Rule not found.' });
      }

      Object.assign(rule, fields(req.body));

      return res.status(200).json(await repository.save(rule));
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

overrideRuleRoutes.delete<{ ruleId: string }, OverrideRule>(
  '/:ruleId',
  isAuthenticated(Permission.MANAGE_SETTINGS),
  async (req, res, next) => {
    try {
      const repository = getRepository(OverrideRule);
      const rule = await repository.findOne({
        where: { id: Number(req.params.ruleId) },
      });

      if (!rule) {
        return next({ status: 404, message: 'Override Rule not found.' });
      }

      await repository.remove(rule);

      return res.status(200).json(rule);
    } catch (e) {
      next({ status: 500, message: e.message });
    }
  }
);

export default overrideRuleRoutes;
