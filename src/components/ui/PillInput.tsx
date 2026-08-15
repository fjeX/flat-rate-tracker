"use client";

import type { ComponentPropsWithoutRef } from "react";

/**
 * A date or time input drawn as a pill, whose WHOLE surface opens the picker.
 *
 * TWO THINGS THIS FIXES, BOTH OF WHICH READ AS BUGS
 *
 * 1. By default only the little calendar/clock glyph opens the picker. Clicking
 *    the date text just puts a caret in the field, so the control looks dead
 *    unless you happen to hit a 16px target at its right edge. `showPicker()` on
 *    click makes the whole pill the affordance it already looked like.
 *
 * 2. The browser's popup is not stylable — no selector reaches inside it — so a
 *    white calendar over a dark page can only be fixed with `color-scheme`,
 *    which `.pill-input` sets (see globals.css).
 *
 * A component rather than a helper function because the styling and the click
 * behaviour have to travel together: a fourth date field added later inherits
 * both, instead of inheriting the class and silently losing the picker.
 */
export function PillInput({
  type,
  className,
  onClick,
  ...rest
}: Omit<ComponentPropsWithoutRef<"input">, "type"> & {
  type: "date" | "time";
}) {
  return (
    <input
      {...rest}
      type={type}
      className={className ? `pill-input ${className}` : "pill-input"}
      onClick={(event) => {
        // showPicker() THROWS rather than returning false when it refuses —
        // no user activation, a hidden or disabled input, or a browser that
        // doesn't implement it. Swallowed on purpose: the input is still a
        // perfectly good text field, so the worst case is the behaviour this
        // component was added to improve, not a broken form.
        try {
          event.currentTarget.showPicker();
        } catch {
          /* typing the value still works */
        }
        onClick?.(event);
      }}
    />
  );
}
