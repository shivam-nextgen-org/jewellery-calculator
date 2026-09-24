"use client";

import * as React from "react";
import { Input } from "@/components/ui/input";

/**
 * A number field that:
 *  - lets you clear it fully (backspace on "0" leaves it empty instead of
 *    snapping back to 0),
 *  - reports the numeric value to the parent (empty -> 0),
 *  - ignores mouse-wheel scroll so the value can't change accidentally.
 */
type NumberInputProps = Omit<
  React.ComponentProps<"input">,
  "type" | "value" | "onChange"
> & {
  value: number;
  onValueChange: (value: number) => void;
};

const NumberInput = React.forwardRef<HTMLInputElement, NumberInputProps>(
  ({ value, onValueChange, onBlur, ...props }, ref) => {
    // Keep a local text value so the field can be empty while typing.
    const [text, setText] = React.useState<string>(String(value));

    // Sync when the parent value changes (e.g. reset / load), but don't fight
    // the user: only overwrite if the numeric meaning differs.
    React.useEffect(() => {
      if (Number(text) !== value) {
        setText(String(value));
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [value]);

    return (
      <Input
        ref={ref}
        type="number"
        inputMode="decimal"
        value={text}
        onWheel={(e) => e.currentTarget.blur()}
        onChange={(e) => {
          const raw = e.target.value;
          setText(raw);
          onValueChange(raw === "" ? 0 : Number(raw));
        }}
        onBlur={(e) => {
          // Normalise on blur: empty becomes "0".
          if (text === "") {
            setText("0");
            onValueChange(0);
          }
          onBlur?.(e);
        }}
        {...props}
      />
    );
  },
);
NumberInput.displayName = "NumberInput";

export { NumberInput };
