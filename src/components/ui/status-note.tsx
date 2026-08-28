/**
 * The little "✓ Saved" / "✗ error" line that seven components spelled out with
 * a bare glyph and a colour. Glyphs like ✓ ✗ ◐ fall back to whatever font the
 * platform has, so they rendered at a different weight and baseline than the
 * Phosphor icons used everywhere else — this keeps them on one set.
 */

const TONE = {
  success: { icon: "check-circle", color: "var(--success)" },
  error: { icon: "x-circle", color: "var(--destructive)" },
  warning: { icon: "warning-circle", color: "var(--warning)" },
  info: { icon: "info", color: "var(--muted-foreground)" },
} as const;

export function StatusNote({
  tone,
  children,
  className = "text-sm",
}: {
  tone: keyof typeof TONE;
  children: React.ReactNode;
  className?: string;
}) {
  const { icon, color } = TONE[tone];
  return (
    <span
      role={tone === "error" ? "alert" : undefined}
      className={`inline-flex items-center gap-1.5 ${className}`}
      style={{ color }}
    >
      <i aria-hidden className={`ph-fill ph-${icon} shrink-0`} />
      <span>{children}</span>
    </span>
  );
}
