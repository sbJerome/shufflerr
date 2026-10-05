// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
import EmptyState from '@app/components/Common/EmptyState';
import PageTitle from '@app/components/Common/PageTitle';
import defineMessages from '@app/utils/defineMessages';
import type { Undefinable } from '@app/utils/typeHelpers';
import type { NextPage } from 'next';
import Link from 'next/link';
import { useIntl } from 'react-intl';

interface ErrorProps {
  statusCode?: number;
}

const messages = defineMessages('pages.error', {
  servererror: 'Shufflerr ran into a server error',
  unavailable: 'Shufflerr is unavailable right now',
  generic: 'That didn’t load',
  explainserver:
    'The server couldn’t finish this request. Reload the page; if it keeps happening, an admin can check Settings, then Logs.',
  explainunavailable:
    'The server is starting up or restarting. Wait a moment and reload the page.',
  explaingeneric:
    'Something stopped this page from loading. Reload it, or go back to Discover.',
  reload: 'Reload the page',
  gotodiscover: 'Go to Discover',
});

const ErrorPage: NextPage<ErrorProps> = ({ statusCode }) => {
  const intl = useIntl();

  const title =
    statusCode === 503
      ? intl.formatMessage(messages.unavailable)
      : statusCode && statusCode >= 500
        ? intl.formatMessage(messages.servererror)
        : intl.formatMessage(messages.generic);
  const explain =
    statusCode === 503
      ? intl.formatMessage(messages.explainunavailable)
      : statusCode && statusCode >= 500
        ? intl.formatMessage(messages.explainserver)
        : intl.formatMessage(messages.explaingeneric);

  return (
    <>
      <PageTitle title={title} />
      <div className="mx-auto flex w-full max-w-[560px] flex-col gap-4 px-4 py-16">
        {statusCode && (
          <p className="m-0 font-mono text-[13px] text-faint">{statusCode}</p>
        )}
        <h1 className="text-[32px] font-bold tracking-[-0.02em]">{title}</h1>
        <EmptyState
          title={explain}
          action={
            <span className="flex flex-wrap justify-center gap-3">
              <button
                type="button"
                className="sh-btn small primary"
                onClick={() => window.location.reload()}
              >
                {intl.formatMessage(messages.reload)}
              </button>
              <Link href="/discover" className="sh-btn small">
                {intl.formatMessage(messages.gotodiscover)}
              </Link>
            </span>
          }
        />
      </div>
    </>
  );
};

ErrorPage.getInitialProps = async ({ res, err }): Promise<ErrorProps> => {
  // Apologies for how gross ternary is but this is just temporary. Honestly,
  // blame the nextjs docs
  let statusCode: Undefinable<number>;
  if (res) {
    statusCode = res.statusCode;
  } else {
    statusCode = err ? err.statusCode : undefined;
  }

  return { statusCode };
};

export default ErrorPage;
