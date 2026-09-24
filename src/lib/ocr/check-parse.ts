/**
 * Sheet-text parser sanity check.
 * Run: npx tsx src/lib/ocr/check-parse.ts
 */
import { parseJewellerySheetText } from "./parse-sheet-text";

const samples = [
  `
Design No | Category | Gold qty | Gross wt. | Net wt. | Pure wt. | Size | Dia Wt. | Certified | Diamond | Purity | Dia pcs.
LR-0003 | LADIES RING | G10Y | 2.22 | 1.932 | 0.83 | 7 | 1.44 | Natural | Round | Natural | 28
`,
  `
Design Name/No Category Gold qty Gross wt. Net wt. Pure wt. Size Dia Wt. Certified Certi price Diamond Purity Diamond Dia pcs.
MSLR 05 LADIES RING G10W 3.38 2.638 1.148 7 0.63 3.096 18197 RD(pink)/RND/HI-VS1 FVP Lab 21
`,
  // Messy OCR-like noise (gross misread as GLOW, spaces broken)
  `
GLOW wt Net wt
MSLR 05 LADIES RING G1OW 3.38 2.638 1.148 7 0.63 Lab 21
`,
  // Columnar OCR (label then value on next line)
  `
Design Name/No
MSLR 05
Category
LADIES RING
Gold qty
G10W
Gross wt.
3.38
Net wt.
2.638
Pure wt.
1.148
Size
7
Dia Wt.
0.63
Dia pcs.
21
`,
  // G10Y misread as G105 — common OCR error on MSLR sheets
  `
Design Name/No Category Gold qty Gross wt. Net wt. Pure wt. Size Dia Wt. Diamond Purity Dia pcs.
MSLR 07 LADIES RING G105 7.551 6.368 5.80 7 0.014 RND/MQ/PAR Lab 13
`,
  // Silver S925
  `
Design No Category Gold qty Gross wt. Net wt. Size Dia Wt. Dia pcs.
SR-12 PENDANT S925 12.5 11.8 7 0.05 8
`,
  // Final sheet — Metal / Purity / Color, Metal Mix ignored
  `
Design Name/No Category Metal Metal Purity Metal Color Metal Mix Gross wt. Net wt. Pure wt. Size Dia Wt. Certified Certi price Diamond Shape Clarity Color Diamond Dia pcs.
MSLR-09 LADIES RING Gold 10 Rose Gold G10RG 3.48 3.333 1.45 7 0.735 RND/PE/PRI Lab 54
`,
];

for (const [i, sample] of samples.entries()) {
  console.log(`\n=== Sample ${i + 1} ===`);
  console.log(JSON.stringify(parseJewellerySheetText(sample), null, 2));
}
