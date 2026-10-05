interface PanelProps extends Omit<
  React.HTMLAttributes<HTMLElement>,
  'title' | 'onSubmit'
> {
  title?: React.ReactNode;
  /** One-line description under the title. */
  sub?: React.ReactNode;
  /** Right-aligned buttons at the bottom of the panel (e.g. "Save changes"). */
  actions?: React.ReactNode;
  as?: 'section' | 'form' | 'div';
  onSubmit?: React.FormEventHandler<HTMLFormElement>;
  children?: React.ReactNode;
}

/** Rounded settings card: title, optional sub, fields, right-aligned actions. */
const Panel = ({
  title,
  sub,
  actions,
  as = 'section',
  children,
  className,
  ...props
}: PanelProps) => {
  const Component = as as React.ElementType;
  return (
    <Component className={`sh-panel ${className ?? ''}`} {...props}>
      {title && <h2>{title}</h2>}
      {sub && <p className="sh-sub">{sub}</p>}
      {children}
      {actions && <div className="row-end">{actions}</div>}
    </Component>
  );
};

export default Panel;
