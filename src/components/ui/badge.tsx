import { cn } from "@/lib/utils";

function Badge({
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-champagne/30 bg-champagne-muted/50 px-2 py-0.5 text-xs font-medium text-charcoal",
        className,
      )}
      {...props}
    />
  );
}

export { Badge };
