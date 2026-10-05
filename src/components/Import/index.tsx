import Button from '@app/components/Common/Button';
import EmptyState from '@app/components/Common/EmptyState';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import PageHeader from '@app/components/Common/PageHeader';
import Panel from '@app/components/Common/Panel';
import SwitchRow from '@app/components/Common/SwitchRow';
import MatchList, { isPickable } from '@app/components/Import/MatchList';
import { revalidateMusic } from '@app/components/RequestModal';
import { relativeTime } from '@app/components/RequestList/requestText';
import { useToasts } from '@app/hooks/useToasts';
import { Permission, useUser } from '@app/hooks/useUser';
import defineMessages from '@app/utils/defineMessages';
import type {
  ImportJobSummary,
  ImportMatch,
  ImportRequestResponse,
  ImportResolveResponse,
  ImportSourceKey,
  ImportSourcesResponse,
  ImportSpotifySavedResponse,
} from '@server/interfaces/api/importInterfaces';
import type { UserSettingsGeneralResponse } from '@server/interfaces/api/userSettingsInterfaces';
import axios from 'axios';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR from 'swr';

const messages = defineMessages('components.Import', {
  import: 'Import',
  description:
    'Paste a playlist or album link. Shufflerr finds the albums and requests the ones you don’t have.',
  pastealink: 'Paste a link',
  workswith: 'Works with {sources}.',
  linklabel: 'Playlist or album link',
  findalbums: 'Find albums',
  finding: 'Finding albums…',
  enterlink: 'Paste a playlist or album link first.',
  resolvefailed:
    'Shufflerr couldn’t read that link. Check that it’s a public playlist or album link and try again.',
  nosources:
    'No import sources are turned on. An admin can turn on Spotify, Deezer or iTunes in Settings.',
  opensettings: 'Open settings',
  found: 'Found {count, plural, one {# album} other {# albums}}',
  foundnamed:
    'Found {count, plural, one {# album} other {# albums}} in {title}',
  foundsub: 'Albums already in your library are unchecked.',
  foundnone:
    'That link has no albums Shufflerr could read. Try another link.',
  requestchecked: 'Request checked albums',
  requesting: 'Requesting…',
  nothingchecked: 'Check at least one album to request.',
  requestfailed:
    'The albums couldn’t be requested. Check your connection and try again.',
  nopermission:
    'You don’t have permission to request albums. Ask an admin to change your permissions.',
  spotifysaved: 'Saved albums on Spotify',
  linkedas: 'Linked as {name}.',
  linked: 'Your Spotify account is linked.',
  notlinked:
    'Link Spotify to have albums you save requested automatically.',
  linkspotify: 'Link Spotify',
  autorequest: 'Request albums I save on Spotify',
  autorequestsub:
    'Runs daily. Requests follow your usual limits and approval rules.',
  autorequestnoperm:
    'An admin needs to allow automatic requests on your account first.',
  autorequeston: 'Albums you save on Spotify will be requested.',
  autorequestoff: 'Stopped requesting albums you save on Spotify.',
  savefailed:
    'That setting couldn’t be saved. Check your connection and try again.',
  showsaved: 'Show my saved albums',
  loadingsaved: 'Loading your saved albums…',
  savedfailed:
    'Your saved albums couldn’t be loaded from Spotify. Try linking Spotify again in your profile.',
  recentlinks: 'Recent links',
  recentlinkssub: 'Open one to see its albums again.',
  jobalbums: '{count, plural, one {# album} other {# albums}}',
  jobresolving: 'Still finding albums',
  stillmatching:
    'Still matching {count, plural, one {# album} other {# albums}} to MusicBrainz. The list fills in as they’re found.',
  matchfailed:
    'Matching stopped before it finished. Paste the link again to retry.',
  truncated:
    '{count, plural, one {# more album was} other {# more albums were}} left out because the link is too long for one import.',
  jobrequested: 'Requested',
  jobfailed: 'Couldn’t be read',
  open: 'Open',
  jobfailedload:
    'That link’s albums are no longer saved. Paste the link again.',
});

const SOURCE_TILE: Record<ImportSourceKey, { color: string; initials: string }> =
  {
    spotify: { color: '#1DB954', initials: 'Sp' },
    deezer: { color: '#A238FF', initials: 'Dz' },
    itunes: { color: '#FB5BC5', initials: 'iT' },
  };

const defaultPicks = (matches: ImportMatch[]): string[] =>
  matches
    .filter(isPickable)
    .map((m) => m.album?.mbid)
    .filter((mbid): mbid is string => !!mbid);

interface ImportView {
  jobId?: number;
  title?: string;
  matches: ImportMatch[];
  status?: ImportResolveResponse['status'];
  error?: string | null;
  truncated?: number;
}

const viewOf = (data: ImportResolveResponse): ImportView => ({
  jobId: data.jobId,
  title: data.title,
  matches: data.matches,
  status: data.status,
  error: data.error,
  truncated: data.truncated,
});

const Import = () => {
  const intl = useIntl();
  const router = useRouter();
  const { addToast } = useToasts();
  const { user, hasPermission } = useUser();

  const [url, setUrl] = useState('');
  const [urlError, setUrlError] = useState<string>();
  const [resolving, setResolving] = useState(false);
  const [result, setResult] = useState<ImportView | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [requesting, setRequesting] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState(false);
  const [savingAuto, setSavingAuto] = useState(false);

  const canRequest = hasPermission(
    [Permission.REQUEST, Permission.REQUEST_ALBUM],
    { type: 'or' }
  );

  const { data: sources, mutate: revalidateSources } =
    useSWR<ImportSourcesResponse>('/api/v1/import/sources');
  const { data: jobs, mutate: revalidateJobs } = useSWR<ImportJobSummary[]>(
    '/api/v1/import/jobs'
  );

  const showResult = (next: ImportView) => {
    setResult(next);
    setPicked(defaultPicks(next.matches));
  };

  // Long links come back as 'resolving': matching runs at MusicBrainz's pace,
  // so poll the job and fill the list in as albums are matched.
  const resolvingJobId =
    result?.status === 'resolving' ? result.jobId : undefined;
  useEffect(() => {
    if (!resolvingJobId) {
      return;
    }
    let cancelled = false;
    const timer = setInterval(async () => {
      try {
        const { data } = await axios.get<ImportResolveResponse>(
          `/api/v1/import/jobs/${resolvingJobId}`
        );
        if (cancelled) {
          return;
        }
        setResult((previous) => {
          if (!previous || previous.jobId !== data.jobId) {
            return previous;
          }
          // Check newly matched albums by default, keep what was already chosen.
          const known = new Set(
            previous.matches
              .filter((m) => !m.pending && m.album)
              .map((m) => m.album?.mbid)
          );
          const fresh = defaultPicks(
            data.matches.filter((m) => m.album && !known.has(m.album.mbid))
          );
          if (fresh.length > 0) {
            setPicked((current) => [...new Set([...current, ...fresh])]);
          }
          return viewOf(data);
        });
        if (data.status !== 'resolving') {
          revalidateJobs();
        }
      } catch {
        // keep polling; a restart or a blip should not lose the list
      }
    }, 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvingJobId]);

  // A reload (or a "Recent links" click) restores the job named in the URL.
  const jobParam = Number(router.query.job) || undefined;
  useEffect(() => {
    if (!jobParam || result?.jobId === jobParam) {
      return;
    }
    let cancelled = false;
    axios
      .get<ImportResolveResponse>(`/api/v1/import/jobs/${jobParam}`)
      .then(({ data }) => {
        if (!cancelled) {
          setUrl(data.url);
          showResult(viewOf(data));
        }
      })
      .catch(() => {
        if (!cancelled) {
          addToast(intl.formatMessage(messages.jobfailedload), {
            appearance: 'error',
          });
          router.replace('/import', undefined, { shallow: true });
        }
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobParam]);

  const enabledSources = (sources?.sources ?? []).filter((s) => s.enabled);

  const find = async (e: React.FormEvent) => {
    e.preventDefault();
    const link = url.trim();
    if (!link) {
      setUrlError(intl.formatMessage(messages.enterlink));
      return;
    }
    setUrlError(undefined);
    setResolving(true);
    try {
      const { data } = await axios.post<ImportResolveResponse>(
        '/api/v1/import/resolve',
        { url: link }
      );
      showResult(viewOf(data));
      router.replace(
        { pathname: '/import', query: { job: String(data.jobId) } },
        undefined,
        { shallow: true }
      );
      revalidateJobs();
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.status !== 501
          ? err.response?.data?.message
          : undefined;
      setUrlError(message ?? intl.formatMessage(messages.resolvefailed));
    } finally {
      setResolving(false);
    }
  };

  const requestPicked = async () => {
    if (!result) {
      return;
    }
    if (!picked.length) {
      addToast(intl.formatMessage(messages.nothingchecked), {
        appearance: 'error',
      });
      return;
    }
    setRequesting(true);
    try {
      const { data } = await axios.post<ImportRequestResponse>(
        '/api/v1/import/request',
        { jobId: result.jobId, mbids: picked }
      );
      addToast(data.summary, {
        appearance: data.auto + data.pending > 0 ? 'success' : 'error',
      });
      revalidateMusic();
      revalidateJobs();
      // Reload the matches so requested albums show their new status.
      if (result.jobId) {
        try {
          const refreshed = await axios.get<ImportResolveResponse>(
            `/api/v1/import/jobs/${result.jobId}`
          );
          showResult({
            jobId: refreshed.data.jobId,
            title: refreshed.data.title,
            matches: refreshed.data.matches,
          });
        } catch {
          setPicked([]);
        }
      } else {
        setPicked([]);
      }
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message
        : undefined;
      addToast(message ?? intl.formatMessage(messages.requestfailed), {
        appearance: 'error',
      });
    } finally {
      setRequesting(false);
    }
  };

  const showSaved = async () => {
    setLoadingSaved(true);
    try {
      const { data } = await axios.get<ImportSpotifySavedResponse>(
        '/api/v1/import/spotify/saved'
      );
      if (!data.linked) {
        revalidateSources();
        return;
      }
      showResult({ matches: data.matches });
      router.replace('/import', undefined, { shallow: true });
    } catch (err) {
      const message =
        axios.isAxiosError(err) && err.response?.status !== 501
          ? err.response?.data?.message
          : undefined;
      addToast(message ?? intl.formatMessage(messages.savedfailed), {
        appearance: 'error',
      });
    } finally {
      setLoadingSaved(false);
    }
  };

  const setAutoRequest = async (enabled: boolean) => {
    if (!user) {
      return;
    }
    setSavingAuto(true);
    try {
      const { data: current } = await axios.get<UserSettingsGeneralResponse>(
        `/api/v1/user/${user.id}/settings/main`
      );
      await axios.post(`/api/v1/user/${user.id}/settings/main`, {
        ...current,
        autoRequestSpotifySaved: enabled,
      });
      addToast(
        intl.formatMessage(
          enabled ? messages.autorequeston : messages.autorequestoff
        ),
        { appearance: 'success' }
      );
      revalidateSources();
    } catch (err) {
      const message = axios.isAxiosError(err)
        ? err.response?.data?.message
        : undefined;
      addToast(message ?? intl.formatMessage(messages.savefailed), {
        appearance: 'error',
      });
    } finally {
      setSavingAuto(false);
    }
  };

  const jobStatus = (job: ImportJobSummary): string => {
    switch (job.status) {
      case 'resolving':
        return intl.formatMessage(messages.jobresolving);
      case 'requested':
        return intl.formatMessage(messages.jobrequested);
      case 'failed':
        return job.error || intl.formatMessage(messages.jobfailed);
      default:
        return intl.formatMessage(messages.jobalbums, {
          count: job.matchCount,
        });
    }
  };

  const spotify = sources?.spotify;
  const pickableCount = result ? result.matches.filter(isPickable).length : 0;

  return (
    <>
      <PageHeader
        title={intl.formatMessage(messages.import)}
        description={intl.formatMessage(messages.description)}
      />

      {!sources ? (
        <LoadingSpinner />
      ) : (
        <div className="sh-stack">
          {enabledSources.length ? (
            <Panel
              as="form"
              onSubmit={find}
              title={intl.formatMessage(messages.pastealink)}
              sub={intl.formatMessage(messages.workswith, {
                sources: intl.formatList(
                  enabledSources.map((s) => s.name),
                  { type: 'conjunction' }
                ),
              })}
            >
              <div
                className="sh-int-grid"
                style={{
                  gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
                }}
              >
                {enabledSources.map((source) => (
                  <div className="sh-inline" key={source.key}>
                    <span
                      className="sh-logo"
                      style={{ background: SOURCE_TILE[source.key]?.color }}
                      aria-hidden="true"
                    >
                      {SOURCE_TILE[source.key]?.initials}
                    </span>
                    <span className="min-w-0">
                      <b>{source.name}</b>
                      {source.accepts.slice(0, 2).map((shape) => (
                        <span
                          key={shape}
                          className="sh-feat block truncate font-mono !text-xs"
                        >
                          {shape}
                        </span>
                      ))}
                    </span>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-3">
                <div className="min-w-[240px] flex-1">
                  <Field
                    label={intl.formatMessage(messages.linklabel)}
                    error={urlError}
                  >
                    {(p) => (
                      <input
                        {...p}
                        type="url"
                        inputMode="url"
                        autoComplete="off"
                        placeholder={
                          enabledSources[0]?.accepts[0]
                            ? `https://${enabledSources[0].accepts[0].replace(
                                /^https?:\/\//,
                                ''
                              )}`
                            : undefined
                        }
                        value={url}
                        onChange={(e) => setUrl(e.target.value)}
                      />
                    )}
                  </Field>
                </div>
                <Button
                  buttonType="primary"
                  type="submit"
                  disabled={resolving}
                  className={urlError ? 'self-center' : undefined}
                >
                  {intl.formatMessage(
                    resolving ? messages.finding : messages.findalbums
                  )}
                </Button>
              </div>
              {!canRequest && (
                <div className="sh-outcome block" role="status">
                  {intl.formatMessage(messages.nopermission)}
                </div>
              )}
            </Panel>
          ) : (
            <EmptyState
              title={intl.formatMessage(messages.nosources)}
              action={
                hasPermission(Permission.MANAGE_SETTINGS) ? (
                  <Link href="/settings/spotify" className="sh-btn small">
                    {intl.formatMessage(messages.opensettings)}
                  </Link>
                ) : undefined
              }
            />
          )}

          {result &&
            (result.matches.length ? (
              <Panel
                title={
                  result.title
                    ? intl.formatMessage(messages.foundnamed, {
                        count: result.matches.length,
                        title: result.title,
                      })
                    : intl.formatMessage(messages.found, {
                        count: result.matches.length,
                      })
                }
                sub={
                  result.status === 'resolving'
                    ? intl.formatMessage(messages.stillmatching, {
                        count: result.matches.filter((m) => m.pending).length,
                      })
                    : result.status === 'failed'
                      ? (result.error ??
                        intl.formatMessage(messages.matchfailed))
                      : result.truncated
                        ? intl.formatMessage(messages.truncated, {
                            count: result.truncated,
                          })
                        : intl.formatMessage(messages.foundsub)
                }
                actions={
                  <Button
                    buttonType="primary"
                    type="button"
                    disabled={requesting || !canRequest || !pickableCount}
                    onClick={requestPicked}
                  >
                    {intl.formatMessage(
                      requesting ? messages.requesting : messages.requestchecked
                    )}
                  </Button>
                }
              >
                <MatchList
                  matches={result.matches}
                  picked={picked}
                  onToggle={(mbid, checked) =>
                    setPicked((current) =>
                      checked
                        ? [...current.filter((m) => m !== mbid), mbid]
                        : current.filter((m) => m !== mbid)
                    )
                  }
                />
              </Panel>
            ) : (
              <EmptyState title={intl.formatMessage(messages.foundnone)} />
            ))}

          {spotify?.enabled && (
            <Panel
              title={intl.formatMessage(messages.spotifysaved)}
              sub={
                spotify.linked
                  ? spotify.linkedAs
                    ? intl.formatMessage(messages.linkedas, {
                        name: spotify.linkedAs,
                      })
                    : intl.formatMessage(messages.linked)
                  : intl.formatMessage(messages.notlinked)
              }
              actions={
                spotify.linked ? (
                  <Button
                    type="button"
                    disabled={loadingSaved}
                    onClick={showSaved}
                  >
                    {intl.formatMessage(
                      loadingSaved ? messages.loadingsaved : messages.showsaved
                    )}
                  </Button>
                ) : (
                  <Link
                    href="/profile/settings/linked-accounts"
                    className="sh-btn"
                  >
                    {intl.formatMessage(messages.linkspotify)}
                  </Link>
                )
              }
            >
              {spotify.linked && (
                <div className="sh-box">
                  <SwitchRow
                    label={intl.formatMessage(messages.autorequest)}
                    description={intl.formatMessage(
                      spotify.canAutoRequest
                        ? messages.autorequestsub
                        : messages.autorequestnoperm
                    )}
                    checked={spotify.autoRequest}
                    disabled={savingAuto || !spotify.canAutoRequest}
                    onChange={(checked: boolean) => setAutoRequest(checked)}
                  />
                </div>
              )}
            </Panel>
          )}

          {!!jobs?.length && (
            <Panel
              title={intl.formatMessage(messages.recentlinks)}
              sub={intl.formatMessage(messages.recentlinkssub)}
            >
              <div className="sh-box">
                <ul className="sh-list">
                  {jobs.map((job) => (
                    <li key={job.id}>
                      <span
                        className="sh-logo"
                        style={{ background: SOURCE_TILE[job.source]?.color }}
                        aria-hidden="true"
                      >
                        {SOURCE_TILE[job.source]?.initials}
                      </span>
                      <div className="grow min-w-0">
                        <b className="truncate">{job.title || job.url}</b>
                        <span className="sh-feat">
                          {[jobStatus(job), relativeTime(intl, job.createdAt)]
                            .filter(Boolean)
                            .join(', ')}
                        </span>
                      </div>
                      {job.status !== 'failed' && job.status !== 'resolving' && (
                        <Link
                          href={`/import?job=${job.id}`}
                          className="sh-btn small"
                          aria-current={
                            result?.jobId === job.id ? 'true' : undefined
                          }
                        >
                          {intl.formatMessage(messages.open)}
                        </Link>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            </Panel>
          )}
        </div>
      )}
    </>
  );
};

export default Import;
