"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { BouncingRing } from "@/components/brand/diamond-ring";

/**
 * Looping video loader. Plays /loader.mp4 muted on repeat for as long as it is
 * mounted. Falls back to the animated gem only if the video genuinely fails to
 * load (media error) or the user prefers reduced motion. A rejected play()
 * promise is NOT treated as a failure — muted autoplay can reject transiently
 * and still play, so we simply retry.
 */
export function VideoLoader({
  size = 120,
  className,
  label,
}: {
  size?: number;
  className?: string;
  label?: string;
}) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [reducedMotion] = useState<boolean>(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  });
  const [errored, setErrored] = useState(false);

  const showFallback = reducedMotion || errored;

  useEffect(() => {
    if (showFallback) return;
    const el = videoRef.current;
    if (!el) return;

    const tryPlay = () => {
      const p = el.play();
      // Ignore rejections — retry happens on canplay/loadeddata events.
      if (p && typeof p.catch === "function") p.catch(() => {});
    };

    tryPlay();
    el.addEventListener("loadeddata", tryPlay);
    el.addEventListener("canplay", tryPlay);
    return () => {
      el.removeEventListener("loadeddata", tryPlay);
      el.removeEventListener("canplay", tryPlay);
    };
  }, [showFallback]);

  return (
    <span
      className={cn(
        "relative inline-flex items-center justify-center",
        className,
      )}
      style={{ width: size, height: size }}
      role="img"
      aria-label={label ?? "Loading"}
    >
      {showFallback ? (
        <BouncingRing size={Math.round(size * 0.85)} label={label} />
      ) : (
        <video
          ref={videoRef}
          className="h-full w-full object-contain"
          style={{ mixBlendMode: "multiply" }}
          src="/loader.mp4"
          autoPlay
          loop
          muted
          playsInline
          preload="auto"
          aria-hidden
          onError={() => setErrored(true)}
        />
      )}
    </span>
  );
}

/**
 * Full-screen centered loader overlay. Sits dead-center of the viewport,
 * above the app chrome, with the looping video loader.
 */
export function PageLoader({
  label = "Loading…",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 backdrop-blur-md",
        className,
      )}
      suppressHydrationWarning
    >
      <BouncingRing size={180} label={label} />
      <p
        className="font-display text-xl font-medium tracking-tight text-charcoal-muted"
        suppressHydrationWarning
      >
        {label}
      </p>
    </div>
  );
}
