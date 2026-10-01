"use client";

// Step 3 of the log form: the collapsible "Add the vehicle" step (year / make / model /
// VIN / mileage, plus the "auto-fill make" toggle). Presentational — all state
// lives in useLogRoForm; this component only renders and calls back.
import { useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { Badge } from "@/components/ui/Badge";
import { decodeVin, isValidVin } from "@/lib/vin";
import { LogIcon } from "./logParts";

const COMMON_MAKES = [
  "Acura", "Audi", "BMW", "Buick", "Cadillac", "Chevrolet", "Chrysler",
  "Dodge", "Ford", "GMC", "Honda", "Hyundai", "Infiniti", "Jeep", "Kia",
  "Land Rover", "Lexus", "Lincoln", "Lucid", "Mazda", "Mercedes-Benz",
  "Mitsubishi", "Nissan", "Porsche", "RAM", "Rivian", "Subaru", "Tesla",
  "Toyota", "Volkswagen", "Volvo",
];

export function VehicleFields({
  step,
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
  /** Position of this step in the form, counted by LogRoForm — the op-code step
   *  above disappears in ticket mode, so the badge cannot be a literal. */
  step: number;
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
    <div className={`log-step is-fold${vehicleOpen ? " is-open" : ""}`}>
      <button
        type="button"
        className="log-step-head"
        onClick={() => setVehicleOpen((v) => !v)}
        aria-expanded={vehicleOpen}
        aria-controls="vehicle-step-body"
      >
        <span className="log-step-no">{step}</span>
        <span className="log-step-title">Add the vehicle</span>
        <span className="log-step-aside">
          {vehicleSummary && !vehicleOpen ? (
            <span className="log-step-sum">{vehicleSummary}</span>
          ) : (
            "recommended"
          )}
          <LogIcon name="chev" small className="chev" />
        </span>
      </button>

      {vehicleOpen && (
        <div className="log-step-body" id="vehicle-step-body">
          <p className="log-help">
            <LogIcon name="info" small />
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

          <div className="log-veh">
            <div className="field">
              <label className="field-label" htmlFor="ro-year">Year</label>
              <input
                id="ro-year"
                type="text"
                value={year}
                onChange={(e) => setYear(e.target.value)}
                inputMode="numeric"
                placeholder="2000"
                className="input mono"
              />
            </div>
            <div className="field">
              <div className="log-veh-label">
                <label className="field-label" htmlFor="ro-make">Make</label>
                {!isEdit && (
                  <label className="log-auto">
                    <input
                      type="checkbox"
                      checked={autoFill}
                      onChange={(e) => handleAutoFillToggle(e.target.checked)}
                    />
                    <span>Auto</span>
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
              />
              {autoFill && make && (
                <p className="log-veh-saved">
                  <Badge tone="good">Saved</Badge>
                  <span>New ROs pre-fill with {make}</span>
                </p>
              )}
            </div>
            <div className="field">
              <label className="field-label" htmlFor="ro-model">Model</label>
              <input
                id="ro-model"
                type="text"
                value={model}
                onChange={(e) => setModel(e.target.value)}
                placeholder="Camry"
                className="input"
              />
            </div>
            <div className="field wide">
              <label className="field-label" htmlFor="ro-vin">VIN</label>
              <div className="log-vin">
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
                  aria-describedby={decodedFields ? "vin-decoded-note" : undefined}
                />
                {decoding && (
                  <Loader2
                    size={14}
                    aria-label="Decoding VIN"
                    className="animate-spin log-vin-spin"
                  />
                )}
              </div>
            </div>
            <div className="field wide">
              <label className="field-label" htmlFor="ro-mileage">Mileage</label>
              <input
                id="ro-mileage"
                type="text"
                inputMode="numeric"
                value={mileage}
                onChange={(e) => setMileage(e.target.value)}
                placeholder="65,000"
                className="input mono"
              />
            </div>
          </div>

          {decodedFields && (
            <p id="vin-decoded-note" className="log-veh-saved">
              <Badge>Note</Badge>
              <span>Decoded from VIN</span>
              <button
                type="button"
                onClick={undoDecode}
                className="btn btn-quiet btn-sm"
              >
                Undo
              </button>
            </p>
          )}
        </div>
      )}
    </div>
  );
}
