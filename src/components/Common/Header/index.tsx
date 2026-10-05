// Adapted from Seerr (https://github.com/seerr-team/seerr), MIT License.
interface HeaderProps {
  extraMargin?: number;
  subtext?: React.ReactNode;
  children: React.ReactNode;
}

const Header = ({ children, extraMargin = 0, subtext }: HeaderProps) => {
  return (
    <div className="mt-8 md:flex md:items-center md:justify-between">
      <div className={`min-w-0 flex-1 mx-${extraMargin}`}>
        <h2
          className="mb-4 truncate text-[30px] font-bold leading-9 tracking-[-0.02em] text-ink sm:overflow-visible md:mb-0"
          data-testid="page-header"
        >
          {children}
        </h2>
        {subtext && <div className="sh-sub mt-2">{subtext}</div>}
      </div>
    </div>
  );
};

export default Header;
