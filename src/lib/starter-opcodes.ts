export type StarterOpCode = { code: string; description: string; flagHours: number };

export const STARTER_OP_CODES: StarterOpCode[] = [
  { code: "OIL",      description: "Oil & Filter Change",        flagHours: 0.5 },
  { code: "DIAG",     description: "Diagnostics / Check Engine", flagHours: 1.0 },
  { code: "INSP",     description: "Multi-Point Inspection",     flagHours: 0.5 },
  { code: "TIRE-ROT", description: "Tire Rotation",              flagHours: 0.3 },
  { code: "ALN-4",    description: "4-Wheel Alignment",          flagHours: 1.0 },
  { code: "BRK-FR",   description: "Front Brake Pads & Rotors",  flagHours: 1.8 },
  { code: "BRK-RR",   description: "Rear Brake Pads & Rotors",   flagHours: 1.5 },
  { code: "BRK-FL",   description: "Brake Fluid Flush",          flagHours: 0.5 },
  { code: "AC-RCH",   description: "A/C Recharge",               flagHours: 1.0 },
  { code: "COOL-FL",  description: "Coolant Flush",               flagHours: 0.8 },
  { code: "TRANS-FL", description: "Transmission Fluid Change",   flagHours: 1.2 },
  { code: "SUSP-STR", description: "Struts — Front Pair",        flagHours: 2.5 },
];
