import type { CSSProperties } from "react";
import Image from "next/image";
import { cn } from "@/lib/utils";

/**
 * Brand mark: the Atelier diamond-ring calculator logo. Reads well at small
 * sizes (nav) and large (login). Keeps the same size/className/label API so all
 * existing call sites work unchanged.
 */
export function DiamondRingMark({
  size = 40,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn(
        "relative inline-flex shrink-0 items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? "Atelier"}
    >
      <Image
        src="/logo.png?v=5"
        alt={label ?? "Atelier logo"}
        width={size}
        height={size}
        className="h-full w-full object-contain"
        priority
        unoptimized
      />
    </span>
  );
}

/**
 * Loader mark: the faceted gem bobs up and down with a soft, squashing shadow
 * and a sparkle — a lively jewellery-themed loading indicator.
 */
export function BouncingRing({
  size = 44,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  return (
    <span
      className={cn("relative inline-flex flex-col items-center", className)}
      style={
        {
          width: size,
          height: Math.round(size * 1.3),
          "--gem-size": `${size}px`,
        } as CSSProperties
      }
      role="img"
      aria-label={label ?? "Loading"}
    >
      <span
        className="gem-bounce inline-flex items-center justify-center"
        style={{ width: size, height: size }}
      >
        <DiamondRingMark size={size} label={label ?? "Loading"} />
      </span>
      {/* Shadow that squashes as the gem lifts */}
      <span
        className="gem-shadow mt-2 block rounded-[50%] bg-champagne/45"
        style={{
          width: Math.round(size * 0.62),
          height: Math.max(5, Math.round(size * 0.1)),
        }}
      />
    </span>
  );
}

/**
 * Looping video loader. Plays /loader.mp4 muted on repeat for as long as it
 * stays mounted (i.e. the whole time the loader is on screen). Falls back to
 * the animated gem for reduced-motion users via CSS.
 */

