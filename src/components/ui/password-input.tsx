"use client";

import * as React from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { Input } from "@/components/ui/input";

/**
 * Password field with a show/hide (eye) toggle. Same props as a normal input,
 * except `type` is managed internally.
 */
const PasswordInput = React.forwardRef<
  HTMLInputElement,
  Omit<React.ComponentProps<"input">, "type">
>(({ className, ...props }, ref) => {
  const [visible, setVisible] = React.useState(false);

  return (
    <div className="relative">
      <Input
        ref={ref}
        type={visible ? "text" : "password"}
        // Hide the browser's own password reveal control (Edge/IE/Safari) so it
        // can't overlap and steal taps from our custom eye button.
        className={cn(
          "pr-10 [&::-ms-reveal]:hidden [&::-ms-clear]:hidden [&::-webkit-textfield-decoration-container]:hidden",
          className,
        )}
        {...props}
      />
      <button
        type="button"
        tabIndex={-1}
        // Use onPointerDown + preventDefault so the tap toggles reliably on
        // touch without blurring the input or dismissing the keyboard.
        onPointerDown={(e) => {
          e.preventDefault();
          setVisible((v) => !v);
        }}
        aria-label={visible ? "Hide password" : "Show password"}
        className="absolute inset-y-0 right-0 z-10 flex w-11 items-center justify-center text-muted-foreground transition-colors hover:text-charcoal focus-visible:outline-none focus-visible:text-charcoal"
      >
        {visible ? (
          <EyeOff className="h-4 w-4" />
        ) : (
          <Eye className="h-4 w-4" />
        )}
      </button>
    </div>
  );
});
PasswordInput.displayName = "PasswordInput";

export { PasswordInput };
