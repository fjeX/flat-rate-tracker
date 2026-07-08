import { describe, it, expect, vi, afterEach } from "vitest";
import { isValidVin, mapVpicResponse, decodeVin } from "./vin";

// A real, canonical VIN with a valid ISO 3779 check digit (position 9 = "3").
const VALID_VIN = "1HGCM82633A004352";

// A trimmed-down copy of a real vPIC DecodeVinValues payload (2003 Honda Accord).
// Only the fields the mapper reads are asserted on; the rest mirror the real
// shape so the fixture stays representative.
const VPIC_FIXTURE = {
  Count: 1,
  Message: "Results returned successfully",
  Results: [
    {
      Make: "HONDA",
      Model: "Accord",
      ModelYear: "2003",
      EngineCylinders: "4",
      DisplacementL: "2.4",
      Trim: "EX",
      ErrorCode: "0",
      ErrorText: "0 - VIN decoded clean. Check Digit (9th position) is correct",
      VIN: VALID_VIN,
    },
  ],
};

describe("isValidVin", () => {
  it("accepts a real VIN with a correct check digit", () => {
    expect(isValidVin(VALID_VIN)).toBe(true);
  });

  it("is case- and whitespace-insensitive", () => {
    expect(isValidVin(`  ${VALID_VIN.toLowerCase()}  `)).toBe(true);
  });

  it("rejects a VIN of the wrong length (e.g. pre-1981 short VIN)", () => {
    expect(isValidVin("1HGCM82633A00435")).toBe(false); // 16 chars
    expect(isValidVin("1HGCM82633A0043521")).toBe(false); // 18 chars
    expect(isValidVin("")).toBe(false);
  });

  it("rejects illegal characters I, O, and Q", () => {
    expect(isValidVin("1HGCM8263IA004352")).toBe(false); // contains I
    expect(isValidVin("1HGCM8263OA004352")).toBe(false); // contains O
    expect(isValidVin("1HGCM8263QA004352")).toBe(false); // contains Q
  });

  it("rejects a VIN whose check digit is wrong (catches OCR misreads)", () => {
    // Same VIN, check digit (position 9) flipped from 3 → 4.
    expect(isValidVin("1HGCM82643A004352")).toBe(false);
  });
});

describe("mapVpicResponse", () => {
  it("maps year, make, and model from a real payload", () => {
    const result = mapVpicResponse(VPIC_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.year).toBe("2003");
    expect(result!.make).toBe("Honda"); // title-cased from "HONDA"
    expect(result!.model).toBe("Accord");
    expect(result!.partial).toBe(false);
  });

  it("builds a display-only engine string and trim", () => {
    const result = mapVpicResponse(VPIC_FIXTURE);
    expect(result!.engine).toBe("2.4L 4-cyl");
    expect(result!.trim).toBe("EX");
  });

  it("title-cases ALL-CAPS makes but preserves acronyms", () => {
    expect(mapVpicResponse({ Results: [{ Make: "TOYOTA", ModelYear: "2020" }] })!.make).toBe("Toyota");
    expect(mapVpicResponse({ Results: [{ Make: "MERCEDES-BENZ", ModelYear: "2020" }] })!.make).toBe("Mercedes-Benz");
    expect(mapVpicResponse({ Results: [{ Make: "LAND ROVER", ModelYear: "2020" }] })!.make).toBe("Land Rover");
    expect(mapVpicResponse({ Results: [{ Make: "BMW", ModelYear: "2020" }] })!.make).toBe("BMW");
  });

  it("accepts a partial decode (warning ErrorCode) as long as data came back", () => {
    const partial = mapVpicResponse({
      Results: [{ Make: "FORD", Model: "F-150", ModelYear: "", ErrorCode: "1,14", ErrorText: "1 - Check Digit..." }],
    });
    expect(partial).not.toBeNull();
    expect(partial!.make).toBe("Ford");
    expect(partial!.partial).toBe(true);
    expect(partial!.warning).toContain("Check Digit");
  });

  it("returns null on total failure (no row / no usable fields)", () => {
    expect(mapVpicResponse({ Results: [] })).toBeNull();
    expect(mapVpicResponse({})).toBeNull();
    expect(mapVpicResponse(null)).toBeNull();
    expect(mapVpicResponse({ Results: [{ Make: "", Model: "", ModelYear: "", ErrorCode: "11" }] })).toBeNull();
  });
});

describe("decodeVin", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("decodes a valid VIN via a mocked fetch (no live API call)", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => VPIC_FIXTURE,
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await decodeVin(VALID_VIN);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0][0]).toContain(VALID_VIN);
    expect(result!.make).toBe("Honda");
    expect(result!.model).toBe("Accord");
    expect(result!.year).toBe("2003");
  });

  it("short-circuits invalid VINs without hitting the network", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    expect(await decodeVin("NOTAVIN")).toBeNull();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("degrades to null when fetch rejects (offline / API down)", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    expect(await decodeVin(VALID_VIN)).toBeNull();
  });

  it("degrades to null on a non-2xx response", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, json: async () => ({}) }));
    expect(await decodeVin(VALID_VIN)).toBeNull();
  });
});
