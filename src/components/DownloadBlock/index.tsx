// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import ProgressBar from '@app/components/Common/ProgressBar';
import defineMessages from '@app/utils/defineMessages';
import type { DownloadingItem } from '@server/interfaces/api/mediaInterfaces';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.DownloadBlock', {
  downloaded: '{percent}% downloaded',
  timeleft: '{percent}% downloaded, {time} left',
  progresslabel: '{title}: {percent}% downloaded',
});

interface DownloadBlockProps {
  downloadItem: DownloadingItem;
}

/** One item in the Lidarr queue with its progress. */
const DownloadBlock = ({ downloadItem }: DownloadBlockProps) => {
  const intl = useIntl();
  const percent = Math.max(0, Math.min(100, Math.round(downloadItem.progress)));

  return (
    <div className="flex flex-col gap-1.5">
      <span className="truncate text-sm font-semibold">
        {downloadItem.title}
      </span>
      <ProgressBar
        value={percent}
        tone="processing"
        label={intl.formatMessage(messages.progresslabel, {
          title: downloadItem.title,
          percent,
        })}
      />
      <span className="sh-feat">
        {downloadItem.timeLeft
          ? intl.formatMessage(messages.timeleft, {
              percent,
              time: downloadItem.timeLeft,
            })
          : intl.formatMessage(messages.downloaded, { percent })}
      </span>
    </div>
  );
};

export default DownloadBlock;
