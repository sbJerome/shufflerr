// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import Alert from '@app/components/Common/Alert';
import Field from '@app/components/Common/Field';
import LoadingSpinner from '@app/components/Common/LoadingSpinner';
import Modal from '@app/components/Common/Modal';
import {
  issueOption,
  issueOptions,
} from '@app/components/IssueModal/constants';
import { useToasts } from '@app/hooks/useToasts';
import defineMessages from '@app/utils/defineMessages';
import { formatDuration } from '@app/utils/format';
import { IssueType } from '@server/constants/issue';
import { MediaStatus } from '@server/constants/media';
import type Issue from '@server/entity/Issue';
import type { AlbumDetails, ArtistDetails } from '@server/models/music';
import axios from 'axios';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { useIntl } from 'react-intl';
import useSWR, { mutate } from 'swr';

const messages = defineMessages('components.IssueModal.CreateIssueModal', {
  title: 'Report a problem',
  titleFor: 'Report a problem with {title}',
  whatswrong: 'What is wrong?',
  whichtracks: 'Which tracks?',
  whichtracksHint: 'Leave everything unchecked if it affects the whole album.',
  details: 'What happened',
  detailsPlaceholder: 'For example: track 4 cuts off after two minutes.',
  detailsRequired: 'Describe the problem so an admin knows what to fix.',
  submit: 'Report problem',
  submitting: 'Reporting…',
  cancel: 'Cancel',
  loadError:
    'Shufflerr could not load this item. Close this and try again in a moment.',
  notTracked:
    'Shufflerr has no record of this yet, so there is nothing to report on. Request it or wait for the next library scan.',
  created: 'Reported a problem with {title}.',
  viewIssue: 'View the report',
  createError: 'The report was not saved. {reason}',
  tryAgain: 'Try again in a moment.',
});

interface CreateIssueModalProps {
  mediaType: 'artist' | 'release-group';
  mbid: string;
  onCancel: () => void;
}

const CreateIssueModal = ({
  mediaType,
  mbid,
  onCancel,
}: CreateIssueModalProps) => {
  const intl = useIntl();
  const { addToast } = useToasts();
  const fieldId = useId();
  const isArtist = mediaType === 'artist';
  const { data, error } = useSWR<AlbumDetails | ArtistDetails>(
    `/api/v1/${isArtist ? 'artist' : 'album'}/${mbid}`
  );
  const options = issueOptions.filter((option) => !isArtist || option.artist);
  const [issueType, setIssueType] = useState<IssueType>(options[0].issueType);
  const [selectedTracks, setSelectedTracks] = useState<number[]>([]);
  const [message, setMessage] = useState('');
  const [messageError, setMessageError] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const title = data ? ('title' in data ? data.title : data.name) : undefined;
  const mediaId = data?.mediaInfo?.id;
  const tracks =
    data && 'tracks' in data
      ? data.tracks.filter((track) => track.id !== undefined)
      : [];
  const showTracks = issueOption(issueType).perTrack && tracks.length > 0;

  // "Missing tracks" starts with the tracks the library does not have.
  useEffect(() => {
    if (issueType === IssueType.MISSING_TRACKS && data && 'tracks' in data) {
      setSelectedTracks(
        data.tracks
          .filter(
            (track) =>
              track.id !== undefined && track.status !== MediaStatus.AVAILABLE
          )
          .map((track) => track.id as number)
      );
    } else {
      setSelectedTracks([]);
    }
  }, [issueType, data]);

  const submit = async () => {
    if (!mediaId) {
      return;
    }
    if (!message.trim()) {
      setMessageError(true);
      return;
    }
    setSubmitting(true);
    try {
      const response = await axios.post<Issue>('/api/v1/issue', {
        mediaId,
        issueType,
        message: message.trim(),
        problemTracks: showTracks ? selectedTracks : [],
      });
      addToast(
        <>
          {intl.formatMessage(messages.created, { title })}{' '}
          <Link href={`/issues/${response.data.id}`}>
            {intl.formatMessage(messages.viewIssue)}
          </Link>
        </>,
        { appearance: 'success' }
      );
      mutate(`/api/v1/${isArtist ? 'artist' : 'album'}/${mbid}`);
      mutate('/api/v1/issue/count');
      onCancel();
    } catch (e) {
      addToast(
        intl.formatMessage(messages.createError, {
          reason:
            e?.response?.data?.message ?? intl.formatMessage(messages.tryAgain),
        }),
        { appearance: 'error' }
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal
      title={
        title
          ? intl.formatMessage(messages.titleFor, { title })
          : intl.formatMessage(messages.title)
      }
      onCancel={onCancel}
      cancelText={intl.formatMessage(messages.cancel)}
      onOk={submit}
      okText={
        submitting
          ? intl.formatMessage(messages.submitting)
          : intl.formatMessage(messages.submit)
      }
      okButtonType="primary"
      okDisabled={submitting || !mediaId}
    >
      {!data && !error && <LoadingSpinner />}
      {error && (
        <Alert type="error" title={intl.formatMessage(messages.loadError)} />
      )}
      {data && !mediaId && (
        <Alert type="info" title={intl.formatMessage(messages.notTracked)} />
      )}
      {data && mediaId && (
        <>
          <fieldset>
            <legend>{intl.formatMessage(messages.whatswrong)}</legend>
            {options.map((option) => (
              // The label text is the nested <b>/<small> pair.
              // eslint-disable-next-line jsx-a11y/label-has-associated-control
              <label className="sh-opt" key={option.issueType}>
                <input
                  type="radio"
                  name={`${fieldId}-type`}
                  checked={issueType === option.issueType}
                  onChange={() => setIssueType(option.issueType)}
                />
                <span className="grow">
                  <b>{intl.formatMessage(option.name)}</b>
                  <small>{intl.formatMessage(option.description)}</small>
                </span>
              </label>
            ))}
          </fieldset>
          {showTracks && (
            <fieldset>
              <legend>{intl.formatMessage(messages.whichtracks)}</legend>
              <p className="sh-sub">
                {intl.formatMessage(messages.whichtracksHint)}
              </p>
              <div className="max-h-64 overflow-y-auto">
                {tracks.map((track) => (
                  <label className="sh-check" key={track.id}>
                    <input
                      type="checkbox"
                      checked={selectedTracks.includes(track.id as number)}
                      onChange={(e) =>
                        setSelectedTracks((current) =>
                          e.target.checked
                            ? [...current, track.id as number]
                            : current.filter((id) => id !== track.id)
                        )
                      }
                    />
                    <span className="font-mono text-faint">
                      {track.position}
                    </span>{' '}
                    {track.title}
                    {track.lengthMs ? (
                      <span className="font-mono text-faint">
                        {' '}
                        {formatDuration(track.lengthMs)}
                      </span>
                    ) : null}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <Field
            label={intl.formatMessage(messages.details)}
            error={
              messageError
                ? intl.formatMessage(messages.detailsRequired)
                : undefined
            }
            full
            required
          >
            {(p) => (
              <textarea
                {...p}
                rows={4}
                value={message}
                placeholder={intl.formatMessage(messages.detailsPlaceholder)}
                onChange={(e) => {
                  setMessage(e.target.value);
                  setMessageError(false);
                }}
              />
            )}
          </Field>
        </>
      )}
    </Modal>
  );
};

export default CreateIssueModal;
