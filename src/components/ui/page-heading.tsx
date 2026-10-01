import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Shared page + section heading primitives so every screen reads the same:
 * a champagne eyebrow, a tight charcoal title, a muted description, and an
 * optional right-aligned actions slot.
 */

export function PageHeading({
  eyebrow,
  title,
  description,
  actions,
  className,
}: {
  eyebrow?: string;
  title: string;
  description?: React.ReactNode;
  /** Right-aligned controls (buttons, badges) shown beside the title. */
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? (
          <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
            {eyebrow}
          </p>
        ) : null}
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">
          {title}
        </h1>
        {description ? (
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

export function SectionHeading({
  title,
  description,
  actions,
  className,
}: {
  title: string;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between",
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-lg font-semibold tracking-tight text-charcoal">
          {title}
        </h2>
        {description ? (
          <p className="mt-0.5 text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>
      ) : null}
    </div>
  );
}

/**
 * Consistent back navigation. Pass `href` for a link, or `onClick` for an
 * in-flow action (e.g. stepping back inside a wizard).
 */
export function BackLink({
  href,
  onClick,
  children = "Back",
  className,
}: {
  href?: string;
  onClick?: () => void;
  children?: React.ReactNode;
  className?: string;
}) {
  const content = (
    <>
      <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </>
  );
  const classes = cn(
    "inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-champagne/40 rounded-md",
    className,
  );
  if (href) {
    return (
      <Link href={href} className={classes}>
        {content}
      </Link>
    );
  }
  return (
    <button type="button" onClick={onClick} className={classes}>
      {content}
    </button>
  );
}
