"use client";

import { useEffect } from "react";

function isExtensionNoise(value: unknown): boolean {
  const msg =
    value instanceof Error
      ? `${value.name} ${value.message}`
      : typeof value === "string"
        ? value
        : String(value ?? "");

  return (
    msg.includes("M_ID") ||
    msg.includes("bis_skin_checked") ||
    msg.includes("bis_skin") ||
    msg.includes(
      "A tree hydrated but some attributes of the server rendered HTML didn't match",
    ) ||
    msg.includes("Hydration failed because the server rendered HTML") ||
    msg.includes("There was an error while hydrating")
  );
}

export function ClientRoot({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const originalError = console.error;
    const originalWarn = console.warn;

    console.error = (...args: unknown[]) => {
      if (args.some((arg) => isExtensionNoise(arg))) return;
      originalError.apply(console, args as []);
    };
    console.warn = (...args: unknown[]) => {
      if (args.some((arg) => isExtensionNoise(arg))) return;
      originalWarn.apply(console, args as []);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      if (!isExtensionNoise(event.reason)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };
    const onError = (event: ErrorEvent) => {
      if (!isExtensionNoise(event.error ?? event.message)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    return () => {
      console.error = originalError;
      console.warn = originalWarn;
      window.removeEventListener("unhandledrejection", onRejection);
      window.removeEventListener("error", onError);
    };
  }, []);

  return children;
}
