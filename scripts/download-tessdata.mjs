/**
 * Downloads English traineddata for Tesseract into ./tessdata
 * so OCR does not fetch from CDN at runtime (avoids SSL/fetch failures).
 */
import fs from "node:fs";
import https from "node:https";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "tessdata");
const OUT_FILE = path.join(OUT_DIR, "eng.traineddata.gz");
const URL =
  "https://cdn.jsdelivr.net/npm/@tesseract.js-data/eng/4.0.0_best_int/eng.traineddata.gz";

fs.mkdirSync(OUT_DIR, { recursive: true });

if (fs.existsSync(OUT_FILE) && fs.statSync(OUT_FILE).size > 1000) {
  console.log("Already present:", OUT_FILE);
  process.exit(0);
}

console.log("Downloading", URL);
const file = fs.createWriteStream(OUT_FILE);

https
  .get(URL, (res) => {
    if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
      console.error("Redirect not followed automatically. Open:", res.headers.location);
      process.exit(1);
    }
    if (res.statusCode !== 200) {
      console.error("HTTP", res.statusCode);
      process.exit(1);
    }
    res.pipe(file);
    file.on("finish", () => {
      file.close();
      console.log("Saved", OUT_FILE, fs.statSync(OUT_FILE).size, "bytes");
    });
  })
  .on("error", (err) => {
    console.error(err);
    try {
      fs.unlinkSync(OUT_FILE);
    } catch {
      /* ignore */
    }
    process.exit(1);
  });
