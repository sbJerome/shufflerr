import Button from '@app/components/Common/Button';
import defineMessages from '@app/utils/defineMessages';
import { useIntl } from 'react-intl';

const messages = defineMessages('components.Library.Pager', {
  previous: 'Previous',
  next: 'Next',
  pageof: 'Page {page} of {pages}',
});

interface PagerProps {
  page: number;
  pages: number;
  onPage: (page: number) => void;
}

/** Previous / next paging under a grid. Renders nothing for a single page. */
const Pager = ({ page, pages, onPage }: PagerProps) => {
  const intl = useIntl();
  if (pages <= 1) {
    return null;
  }
  const label = intl.formatMessage(messages.pageof, { page, pages });
  return (
    <nav className="flex items-center justify-between gap-3" aria-label={label}>
      <Button
        buttonSize="sm"
        disabled={page <= 1}
        onClick={() => onPage(page - 1)}
      >
        {intl.formatMessage(messages.previous)}
      </Button>
      <span className="font-mono text-[13px] text-faint">{label}</span>
      <Button
        buttonSize="sm"
        disabled={page >= pages}
        onClick={() => onPage(page + 1)}
      >
        {intl.formatMessage(messages.next)}
      </Button>
    </nav>
  );
};

export default Pager;
