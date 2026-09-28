import { config } from "dotenv";
config({ path: ".env" });

import {
  updateDailyRates,
  getLatestSuccessfulSnapshot,
} from "../src/lib/services/fx-rates";

async function main() {
  const result = await updateDailyRates();
  if (!result.ok) {
    console.error("FX update failed:", result.error);
    process.exit(1);
  }
  const latest = await getLatestSuccessfulSnapshot();
  console.log("Saved FX snapshot for", result.snapshot.effectiveDate);
  console.log("USD:", latest?.rates?.USD);
  console.log("EUR:", latest?.rates?.EUR);
  console.log("GBP:", latest?.rates?.GBP);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
