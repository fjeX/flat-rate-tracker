// @vitest-environment jsdom
//
// The Code | Description toggle in the op code browse bar: which field leads
// each row, and that the choice survives a remount (per-device localStorage).
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import { describe, it, expect, afterEach, vi } from "vitest";
import type { OpCode } from "@/lib/types";
import { OpCodeBrowseBar } from "./OpCodeBrowseBar";
import { OpCodeRowContent } from "./OpCodeRow";
import { LABEL_MODE_KEY, useOpCodeLabelMode } from "./useOpCodeLabelMode";

const op: OpCode = {
  id: "1",
  code: "BRK-F",
  description: "Front brake pads and rotors",
  flagHours: 1.5,
  notes: "",
  tags: [],
  subOpCodes: [],
} as unknown as OpCode;

function Harness() {
  const [mode, setMode] = useOpCodeLabelMode();
  return (
    <>
      <OpCodeBrowseBar
        search=""
        onSearch={() => {}}
        sortBy="manual"
        sortDir="desc"
        onSortClick={() => {}}
        allTags={[]}
        selectedTags={[]}
        onToggleTag={() => {}}
        onClearTags={() => {}}
        labelMode={mode}
        onLabelMode={setMode}
      />
      <div data-testid="row">
        <OpCodeRowContent opCode={op} labelMode={mode} onEdit={() => {}} onDelete={() => {}} />
      </div>
    </>
  );
}

const lead = () => screen.getByTestId("row").querySelector(".opl-code b")!.textContent;
const second = () => screen.getByTestId("row").querySelector(".opl-desc > span")!.textContent;

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("op code Code | Description toggle", () => {
  it("defaults to Code leading", () => {
    render(<Harness />);
    expect(screen.getByRole("button", { name: "Code" }).getAttribute("aria-pressed")).toBe("true");
    expect(screen.getByRole("button", { name: "Description" }).getAttribute("aria-pressed")).toBe("false");
    expect(lead()).toBe("BRK-F");
    expect(second()).toBe("Front brake pads and rotors");
  });

  it("swaps primary and secondary when Description is picked", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Description" }));
    expect(screen.getByRole("button", { name: "Description" }).getAttribute("aria-pressed")).toBe("true");
    expect(lead()).toBe("Front brake pads and rotors");
    expect(second()).toBe("BRK-F");
  });

  it("remembers the choice across a remount", () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole("button", { name: "Description" }));
    expect(localStorage.getItem(LABEL_MODE_KEY)).toBe("description");
    cleanup();
    render(<Harness />);
    expect(lead()).toBe("Front brake pads and rotors");
  });

  it("falls back to Code when storage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<Harness />);
    expect(lead()).toBe("BRK-F");
    spy.mockRestore();
  });
});
