import PageTitle from '@app/components/Common/PageTitle';

interface PageHeaderProps {
  /** Page H1; also used as the document title unless `documentTitle` is set. */
  title: string;
  description?: React.ReactNode;
  /** Buttons on the right. */
  actions?: React.ReactNode;
  documentTitle?: string | (string | undefined)[];
}

/** H1 + one-line description + actions. One per page. */
const PageHeader = ({
  title,
  description,
  actions,
  documentTitle,
}: PageHeaderProps) => (
  <>
    <PageTitle title={documentTitle ?? title} />
    <div className="sh-page-head">
      <div className="min-w-0">
        <h1 data-testid="page-header">{title}</h1>
        {description && <p className="sh-sub">{description}</p>}
      </div>
      {actions && <div className="sh-inline">{actions}</div>}
    </div>
  </>
);

export default PageHeader;
