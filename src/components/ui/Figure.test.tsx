// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { Figure } from "./Figure";
import { RollingNumber } from "./RollingNumber";

afterEach(cleanup);

describe("decimal pull", () => {
  it("Figure keeps text intact and wraps only inner separators", () => {
    const { container } = render(<Figure value="1,234.5" />);
    expect(container.textContent).toBe("1,234.5");
    expect(container.querySelectorAll(".pt").length).toBe(2);
  });
  it("Figure leaves non-decimal punctuation alone", () => {
    const { container } = render(<Figure value="$5." />);
    expect(container.querySelectorAll(".pt").length).toBe(0);
  });
  it("RollingNumber marks the point and still reads 8.5", () => {
    const { container } = render(<RollingNumber value="8.5" />);
    expect(container.querySelector(".rn-sep.pt")?.textContent).toBe(".");
    expect(container.querySelector(".sr-only")?.textContent).toBe("8.5");
  });
});
