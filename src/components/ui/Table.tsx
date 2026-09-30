import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from "react";

/**
 * Ruled data table (mock `.tbl`): 46px rows, label-style headers, hairline
 * rules, figures right-aligned and set in the figure font via the `num` cell
 * prop. Wrap it in
 * <Card flush> and it reads as one surface.
 */
export function Table({ className, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return <table className={["table", className].filter(Boolean).join(" ")} {...rest} />;
}

export function Th({
  num,
  className,
  ...rest
}: ThHTMLAttributes<HTMLTableCellElement> & { num?: boolean }) {
  const cls = [num && "table-num", className].filter(Boolean).join(" ") || undefined;
  return <th className={cls} {...rest} />;
}

export function Td({
  num,
  dim,
  className,
  ...rest
}: TdHTMLAttributes<HTMLTableCellElement> & { num?: boolean; dim?: boolean }) {
  const cls = [num && "table-num", dim && "table-dim", className].filter(Boolean).join(" ") || undefined;
  return <td className={cls} {...rest} />;
}

export function TableFootRow({ children }: { children: ReactNode }) {
  return <tr className="table-foot">{children}</tr>;
}
