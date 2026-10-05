interface EmptyStateProps {
  /** Short statement of what's empty. */
  title: React.ReactNode;
  /** The next step, e.g. "Search for an album to start." */
  children?: React.ReactNode;
  /** Optional button or link. */
  action?: React.ReactNode;
}

const EmptyState = ({ title, children, action }: EmptyStateProps) => (
  <div className="sh-empty">
    <b>{title}</b>
    {children && <span>{children}</span>}
    {action}
  </div>
);

export default EmptyState;
