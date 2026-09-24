import type { PricingStep } from "@/types/jewellery";
import { cn } from "@/lib/utils";

const STEPS: { id: PricingStep; label: string; num: string }[] = [
  { id: "import", label: "Import", num: "01" },
  { id: "verify", label: "Verify", num: "02" },
  { id: "price", label: "Price", num: "03" },
  { id: "variations", label: "Variations", num: "04" },
  { id: "review", label: "Review", num: "05" },
];

const ORDER: PricingStep[] = [
  "import",
  "verify",
  "price",
  "variations",
  "review",
];

export function StepIndicator({
  current,
  onSelect,
}: {
  current: PricingStep;
  onSelect?: (step: PricingStep) => void;
}) {
  const currentIndex = ORDER.indexOf(current);

  return (
    <ol className="flex flex-wrap items-center gap-x-1 gap-y-2 sm:gap-x-2">
      {STEPS.map((step, index) => {
        const done = index < currentIndex;
        const active = step.id === current;
        const clickable = onSelect && (done || active || index <= currentIndex);

        return (
          <li key={step.id} className="flex items-center gap-1 sm:gap-2">
            <button
              type="button"
              disabled={!clickable}
              onClick={() => onSelect?.(step.id)}
              className={cn(
                "group flex items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors",
                active && "bg-champagne-muted/50",
                done && !active && "hover:bg-ivory-deep",
                !clickable && "cursor-default opacity-50",
              )}
            >
              <span
                className={cn(
                  "font-mono text-[10px] tracking-wider",
                  active ? "text-champagne" : "text-muted-foreground",
                )}
              >
                {step.num}
              </span>
              <span
                className={cn(
                  "text-sm",
                  active
                    ? "font-medium text-charcoal"
                    : done
                      ? "text-charcoal-muted"
                      : "text-muted-foreground",
                )}
              >
                {step.label}
              </span>
            </button>
            {index < STEPS.length - 1 && (
              <span
                className="hidden text-border sm:inline"
                aria-hidden
              >
                →
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
