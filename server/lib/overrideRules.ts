// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import { getRepository } from '@server/datasource';
import OverrideRule from '@server/entity/OverrideRule';
import type { User } from '@server/entity/User';

export type OverrideRulesResult = {
  serverId: number | null;
  rootFolder: string | null;
  profileId: number | null;
  metadataProfileId: number | null;
  tags: number[] | null;
};

export interface OverrideRuleInput {
  requestUser: User;
  /** MusicBrainz genres / Last.fm tags of the release group or artist. */
  genres?: string[];
  /** Label names or MBIDs. */
  labels?: string[];
  /** Album / EP / Single … */
  primaryType?: string;
  tags?: number[] | null;
  /** Restrict to rules for this Lidarr server. */
  serviceId?: number;
}

const list = (value?: string | null): string[] =>
  (value ?? '')
    .split(/[,|]/)
    .map((v) => v.trim().toLowerCase())
    .filter(Boolean);

/**
 * Route a request to a Lidarr server / profile / folder by user, genre, label
 * or release type. The first rule whose every stated condition matches wins
 * for each field. (Backlog UI; the engine may call this today — with no rules
 * it returns all nulls.)
 */
async function overrideRules({
  requestUser,
  genres = [],
  labels = [],
  primaryType,
  tags = null,
  serviceId,
}: OverrideRuleInput): Promise<OverrideRulesResult> {
  const result: OverrideRulesResult = {
    serverId: null,
    rootFolder: null,
    profileId: null,
    metadataProfileId: null,
    tags,
  };

  const rules = (
    await getRepository(OverrideRule).find({ order: { id: 'ASC' } })
  ).filter(
    (rule) => serviceId === undefined || rule.lidarrServiceId === serviceId
  );

  const lower = (values: string[]) => values.map((v) => v.toLowerCase());
  const matches = (rule: OverrideRule): boolean => {
    const users = list(rule.users);
    if (users.length && !users.includes(String(requestUser.id))) {
      return false;
    }
    const ruleGenres = list(rule.genre);
    if (
      ruleGenres.length &&
      !ruleGenres.some((g) => lower(genres).includes(g))
    ) {
      return false;
    }
    const ruleLabels = list(rule.label);
    if (
      ruleLabels.length &&
      !ruleLabels.some((l) => lower(labels).includes(l))
    ) {
      return false;
    }
    const types = list(rule.primaryType);
    if (types.length && !types.includes((primaryType ?? '').toLowerCase())) {
      return false;
    }
    return true;
  };

  for (const rule of rules.filter(matches)) {
    result.serverId ??= rule.lidarrServiceId ?? null;
    result.rootFolder ??= rule.rootFolder ?? null;
    result.profileId ??= rule.profileId ?? null;
    result.metadataProfileId ??= rule.metadataProfileId ?? null;
    if (rule.tags) {
      result.tags = [
        ...new Set([
          ...(result.tags ?? []),
          ...rule.tags
            .split(',')
            .map((t) => Number(t))
            .filter((t) => !isNaN(t)),
        ]),
      ];
    }
  }

  return result;
}

export default overrideRules;
