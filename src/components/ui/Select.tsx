import { forwardRef, type SelectHTMLAttributes } from "react";
import { ChevronDown } from "lucide-react";

type SelectProps = SelectHTMLAttributes<HTMLSelectElement>;

/**
 * Native <select> dressed as a design-system input, with a real chevron
 * (the UA arrow is suppressed). Options render in children as usual.
 */
export const Select = forwardRef<HTMLSelectElement, SelectProps>(function Select(
  { className, children, ...rest },
  ref,
) {
  const cls = ["input", "select", className].filter(Boolean).join(" ");
  return (
    <span className="select-wrap">
      <select ref={ref} className={cls} {...rest}>
        {children}
      </select>
      <ChevronDown size={16} className="select-chev" aria-hidden />
    </span>
  );
});
