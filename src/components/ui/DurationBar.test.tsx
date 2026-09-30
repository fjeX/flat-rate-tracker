// @vitest-environment jsdom
import { render, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach } from "vitest";
import { DurationBar } from "./DurationBar";

afterEach(cleanup);

function bar(ui: React.ReactElement): HTMLElement {
  return render(ui).container.querySelector(".dur") as HTMLElement;
}

describe("DurationBar", () => {
  it.each([[0, "0"], [1.5, "1.5"], [12, "12"], [-3, "0"], [NaN, "0"], [Infinity, "0"]])(
    "hours=%s -> --h %s",
    (hours, expected) => {
      expect(bar(<DurationBar hours={hours} />).style.getPropertyValue("--h")).toBe(expected);
    },
  );
  it("is aria-hidden by default and role=img when labelled", () => {
    expect(bar(<DurationBar hours={2} />).getAttribute("aria-hidden")).toBe("true");
    const b = bar(<DurationBar hours={2} label="2 hours" />);
    expect(b.getAttribute("role")).toBe("img");
    expect(b.getAttribute("aria-label")).toBe("2 hours");
  });
  it("sets --dur-gap only when given, and renders the scale note", () => {
    const { container } = render(
      <DurationBar hours={2} gapColor="var(--plate)" scaleNote="one block = 1 hr" />,
    );
    expect((container.querySelector(".dur") as HTMLElement).style.getPropertyValue("--dur-gap")).toBe("var(--plate)");
    expect(container.querySelector(".scale-note")?.textContent).toBe("one block = 1 hr");
    expect(bar(<DurationBar hours={2} />).style.getPropertyValue("--dur-gap")).toBe("");
  });
});
