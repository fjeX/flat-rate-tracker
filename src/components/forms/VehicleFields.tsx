"use client";

// Step 3 of the log form: the collapsible Vehicle section (year / make / model /
// VIN / mileage, plus the "auto-fill make" toggle). Presentational — all state
// lives in useLogRoForm; this component only renders and calls back.
import { useRef, useState } from "react";
import { ChevronDown, ChevronUp, Info, Loader2, Sparkles, Undo2 } from "lucide-react";
import { decodeVin, isValidVin } from "@/lib/vin";

const COMMON_MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
  "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia",
  "Land Rover", "Lexus", "Lincoln", "Lucid", "Mazda", "Mercedes-Benz",
  "Mitsubishi", "Nissan", "Porsche", "RAM", "Rivian", "Subaru", "Tesla",
  "Toyota", "Volkswagen", "Volvo",
];

export function VehicleFields({
  isEdit,
  vehicleOpen,
  setVehicleOpen,
  vehicleSummary,
  year,
  setYear,
  make,
  handleMakeChange,
  model,
  setModel,
  vin,
  setVin,
  mileage,
  setMileage,
  autoFill,
  handleAutoFillToggle,
}: {
  isEdit: boolean;
  vehicleOpen: boolean;
  setVehicleOpen: (fn: (v: boolean) => boolean) => void;
  vehicleSummary: string;
  year: string;
  setYear: (v: string) => void;
  make: string;
  handleMakeChange: (v: string) => void;
  model: string;
  setModel: (v: string) => void;
  vin: string;
  setVin: (v: string) => void;
  mileage: string;
  setMileage: (v: string) => void;
  autoFill: boolean;
  handleAutoFillToggle: (checked: boolean) => void;
}) {
  // VIN decode (NHTSA vPIC). Fills empty year/make/model on blur with a plausible
  // VIN; never overwrites what the tech typed. All state is local — the decode is
  // a display-only prefill of the existing fields, so it needs nothing from the
  // parent hook beyond the setters it already passes down.
  const [decoding, setDecoding] = useState(false);
  const [decodedFields, setDecodedFields] = useState<
    null | { year: boolean; make: boolean; model: boolean }
  >(null);
  // Guards against a stale slow decode landing after a newer one.
  const decodeReq = useRef(0);

  async function handleVinBlur() {
    const v = vin.trim().toUpperCase();
    if (!isValidVin(v)) return;

    const reqId = ++decodeReq.current;
    setDecoding(true);
    try {
      const result = await decodeVin(v);
      if (reqId !== decodeReq.current) return; // superseded by a newer decode
      if (!result) return;

      const filled = { year: false, make: false, model: false };
      // Fill ONLY empty fields — decoded data never clobbers user input.
      if (!year.trim() && result.year) {
        setYear(result.year);
        filled.year = true;
      }
      if (!make.trim() && result.make) {
        handleMakeChange(result.make);
        filled.make = true;
      }
      if (!model.trim() && result.model) {
        setModel(result.model);
        filled.model = true;
      }
      if (filled.year || filled.make || filled.model) setDecodedFields(filled);
    } finally {
      if (reqId === decodeReq.current) setDecoding(false);
    }
  }

  function handleVinChange(value: string) {
    setVin(value.toUpperCase());
    // Editing the VIN invalidates any prior "decoded" confirmation.
    if (decodedFields) setDecodedFields(null);
  }

  function undoDecode() {
    if (!decodedFields) return;
    if (decodedFields.year) setYear("");
    if (decodedFields.make) handleMakeChange("");
    if (decodedFields.model) setModel("");
    setDecodedFields(null);
  }

  return (
    <div className={`step-card${vehicleOpen ? " active" : " collapsed"}`}>
      <button
        type="button"
        className="step-head"
        onClick={() => setVehicleOpen((v) => !v)}
        aria-expanded={vehicleOpen}
        aria-controls="vehicle-step-body"
      >
        <div className="step-num">3</div>
        <div className="step-title">
          Vehicle
          <span className="optional-badge">recommended</span>
        </div>
        {vehicleSummary && !vehicleOpen && (
          <div className="step-summary">{vehicleSummary}</div>
        )}
        {vehicleOpen ? <ChevronUp size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} /> : <ChevronDown size={15} style={{ color: "var(--fg-3)", flexShrink: 0 }} />}
      </button>

      {vehicleOpen && (
        <div className="step-body" id="vehicle-step-body">
          <p style={{
            display: "flex",
            gap: 6,
            alignItems: "flex-start",
            fontSize: 11,
            lineHeight: 1.45,
            color: "var(--fg-2)",
            marginBottom: 12,
          }}>
            <Info size={13} style={{ flexShrink: 0, marginTop: 1, color: "var(--brand)" }} />
            <span>
              Optional, but worth it — RO numbers get reused over time. The vehicle
              is what tells repeat RO numbers apart later.
            </span>
          </p>

          <datalist id="make-options">
            {COMMON_MAKES.map((m) => (
              <option key={m} value={m} />
            ))}
          </datalist>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 10, marginBottom: 10 }}>
            <div>
              <label className="field-label" htmlFor="ro-year">Year</label>
              <input
                id="ro-year"
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                placeholder="2000"
                className="input"
                style={{ width: "100%" }}
              />
            </div>
            <div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 6 }}>
                <label className="field-label" htmlFor="ro-make" style={{ margin: 0 }}>Make</label>
                {!isEdit && (
                  <label className="hit-expand" style={{ display: "flex", alignItems: "center", gap: 4, cursor: "pointer" }}>
                    <input
                      type="checkbox"
                      checked={autoFill}
                      onChange={(e) => handleAutoFillToggle(e.target.checked)}
                      style={{ accentColor: "var(--brand)", width: 11, height: 11 }}
                    />
                    <span style={{ fontSize: 11, letterSpacing: "0.08em", textTransform: "uppercase", color: "var(--fg-3)" }}>
                      Auto
                    </span>
                  </label>
                )}
              </div>
              <input
                id="ro-make"
                type="text"
                list="make-options"
                value={make}
                onChange={(e) => handleMakeChange(e.target.value)}
                placeholder="Toyota"
                autoComplete="off"
                className="input"
                style={{
                  width: "100%",
                  borderColor: autoFill ? "var(--brand-soft)" : undefined,
                }}
              />
              {autoFill && make && (
                <p style={{ marginTop: 2, fontSize: 11, color: "var(--brand)" }}>
                  ✓ Saved — new ROs pre-fill with {make}
                </p>
              )}
            </div>
            <div>
              <label className="field-label" htmlFor="ro-model">Model</label>
              <input
                id="ro-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Camry"
                className="input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
            <div>
              <label className="field-label" htmlFor="ro-vin">VIN</label>
              <div style={{ position: "relative" }}>
                <input
                  id="ro-vin"
                  type="text"
                  value={vin}
                  onChange={(e) => handleVinChange(e.target.value)}
                  onBlur={handleVinBlur}
                  maxLength={17}
                  placeholder="17-char VIN"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className="input mono"
                  style={{ width: "100%", paddingRight: decoding ? 30 : undefined }}
                  aria-describedby={decodedFields ? "vin-decoded-note" : undefined}
                />
                {decoding && (
                  <Loader2
                    size={14}
                    aria-label="Decoding VIN"
                    className="animate-spin"
                    style={{
                      position: "absolute",
                      right: 9,
                      top: "50%",
                      marginTop: -7,
                      color: "var(--brand)",
                    }}
                  />
                )}
              </div>
            </div>
            <div>
              <label className="field-label" htmlFor="ro-mileage">Mileage</label>
              <input
                id="ro-mileage"
                type="text"
                inputMode="numeric"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="65,000"
                className="input"
                style={{ width: "100%" }}
              />
            </div>
          </div>

          {decodedFields && (
            <p
              id="vin-decoded-note"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                marginTop: 8,
                fontSize: 11,
                color: "var(--brand)",
              }}
            >
              <Sparkles size={12} style={{ flexShrink: 0 }} />
              <span>Decoded from VIN</span>
              <button
                type="button"
                onClick={undoDecode}
                className="hit-expand"
                style={{
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 3,
                  marginLeft: 2,
                  padding: 0,
                  border: "none",
                  background: "transparent",
                  color: "var(--fg-3)",
                  fontSize: 11,
                  cursor: "pointer",
                  textDecoration: "underline",
                }}
              >
                <Undo2 size={11} />
                Undo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
