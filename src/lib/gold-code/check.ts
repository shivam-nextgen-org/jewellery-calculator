/**
 * Metal-code parser sanity check.
 * Run: npx tsx src/lib/gold-code/check.ts
 */
import { parseGoldCode } from "./index";

const samples = [
  "G10Y",
  "G10W",
  "G10R",
  "G14Y",
  "G18W",
  "G22R",
  "G105",
  "S925",
  "S925W",
  "S999",
  "S925Y",
  "P950",
  "G99X",
  "",
  "g14y",
  "s925",
];

for (const code of samples) {
  const result = parseGoldCode(code);
  if (result.ok) {
    console.log(
      `${code || "(empty)"} → ${result.metalLabel} / ${result.purity} / ${result.colorLabel} (${result.normalizedCode})`,
    );
  } else {
    console.log(`${code || "(empty)"} → FAIL: ${result.reason}`);
  }
}
