/**
 * The page title block, which six pages hand-rolled with four different
 * vertical alignments (items-end / items-baseline / items-center /
 * items-start). One component so every screen starts on the same line.
 */
export function PageHeader({
  eyebrow,
  title,
  subtitle,
  adornment,
  action,
  className = "",
}: {
  /** small uppercase line above the title (e.g. the date on the dashboard) */
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  /** secondary line under the title */
  subtitle?: React.ReactNode;
  /** control sitting directly beside the title (e.g. the tank edit pencil) */
  adornment?: React.ReactNode;
  /** right-hand side: a button, badge or nav control */
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`flex items-start justify-between gap-3 mb-5 ${className}`}>
      <div className="min-w-0">
        {eyebrow && (
          <div
            className="text-xs uppercase tracking-wide"
            style={{ color: "var(--muted-foreground)" }}
          >
            {eyebrow}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className={`text-2xl font-bold ${eyebrow ? "mt-1" : ""}`}>{title}</h1>
          {adornment}
        </div>
        {subtitle && (
          <div className="text-sm mt-1" style={{ color: "var(--muted-foreground)" }}>
            {subtitle}
          </div>
        )}
      </div>
      {action && <div className="shrink-0 flex items-center gap-2">{action}</div>}
    </div>
  );
}
