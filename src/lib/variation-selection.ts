import {
  clarityGradeScaleForStoneType,
  colorGradeScaleForStoneType,
  defaultBaseClarityForStoneType,
  defaultBaseColorForStoneType,
} from "@/lib/pricing-engine";
import type {
  DiamondTypeOption,
  GoldColorOption,
  GoldMetalOption,
  GoldPurityOption,
  PricingGradeRule,
  StoneGradeSelection,
  StoneGradeSelectionMap,
  VariationSelection,
} from "@/types/jewellery";

export const METAL_OPTIONS: { id: GoldMetalOption; label: string }[] = [
  { id: "gold", label: "Gold" },
  { id: "silver", label: "Silver" },
];

export const GOLD_PURITY_OPTIONS: GoldPurityOption[] = [
  "24K",
  "22K",
  "18K",
  "14K",
  "10K",
  "9K",
];

export const SILVER_PURITY_OPTIONS: GoldPurityOption[] = ["999", "958", "925"];

export const GOLD_COLOR_OPTIONS: { id: GoldColorOption; label: string }[] = [
  { id: "yellow", label: "Yellow" },
  { id: "white", label: "White" },
  { id: "rose", label: "Rose" },
];

export const SILVER_COLOR_OPTIONS: { id: GoldColorOption; label: string }[] = [
  { id: "sterling", label: "Sterling" },
];

export const STONE_TYPE_OPTIONS: DiamondTypeOption[] = [
  "natural",
  "lab-grown",
  "moissanite",
];

export function toggleInArray<T>(list: T[], value: T): T[] {
  return list.includes(value)
    ? list.filter((item) => item !== value)
    : [...list, value];
}

/** Purities that price off the metal the card belongs to. */
export function purityOptionsForMetal(
  metal: GoldMetalOption,
): GoldPurityOption[] {
  return metal === "silver" ? SILVER_PURITY_OPTIONS : GOLD_PURITY_OPTIONS;
}

/** Colours that physically exist for a metal — no sterling gold, no rose silver. */
export function colorOptionsForMetal(
  metal: GoldMetalOption,
): { id: GoldColorOption; label: string }[] {
  return metal === "silver" ? SILVER_COLOR_OPTIONS : GOLD_COLOR_OPTIONS;
}

/** Shape of a saved pricing profile, narrowed to what grade pickers need. */
export interface StoneGradeSource {
  baseColorGrade?: string;
  baseClarityGrade?: string;
  colorRules?: PricingGradeRule[];
  clarityRules?: PricingGradeRule[];
}

export type StoneGradeSourceMap = Partial<
  Record<DiamondTypeOption, StoneGradeSource>
>;

/**
 * Grade chips for one stone card: the grades configured in Settings for that
 * stone, else its own standard scale. Natural and lab-grown use GIA grades,
 * moissanite uses commercial bands — the two never mix.
 */
export function gradeOptionsForStoneType(
  stoneType: DiamondTypeOption,
  source?: StoneGradeSource,
): { colors: string[]; clarities: string[] } {
  const colors = source?.colorRules?.length
    ? source.colorRules.map((r) => r.grade)
    : [...colorGradeScaleForStoneType(stoneType)];
  const clarities = source?.clarityRules?.length
    ? source.clarityRules.map((r) => r.grade)
    : [...clarityGradeScaleForStoneType(stoneType)];
  return { colors, clarities };
}

function keepOnScale(grades: string[] | undefined, allowed: string[]): string[] {
  if (!grades?.length) return [];
  const byLower = new Map(allowed.map((g) => [g.trim().toLowerCase(), g]));
  const kept: string[] = [];
  for (const grade of grades) {
    const match = byLower.get(grade.trim().toLowerCase());
    if (match && !kept.includes(match)) kept.push(match);
  }
  return kept;
}

/** The single base colour / clarity a stone starts at when switched on. */
export function defaultStoneGradeSelection(
  stoneType: DiamondTypeOption,
  source?: StoneGradeSource,
): StoneGradeSelection {
  const options = gradeOptionsForStoneType(stoneType, source);
  const color =
    keepOnScale(
      [source?.baseColorGrade ?? defaultBaseColorForStoneType(stoneType)],
      options.colors,
    )[0] ?? options.colors[0];
  const clarity =
    keepOnScale(
      [source?.baseClarityGrade ?? defaultBaseClarityForStoneType(stoneType)],
      options.clarities,
    )[0] ?? options.clarities[0];
  return {
    colors: color ? [color] : [],
    clarities: clarity ? [clarity] : [],
  };
}

/**
 * Grades for one stone, dropping anything that is no longer on its scale.
 * An axis the user cleared on purpose stays cleared (one row at the base
 * grade); an axis left empty only because its grades were invalid is reseeded.
 */
export function stoneGradesForType(
  selection: StoneGradeSelectionMap | undefined,
  stoneType: DiamondTypeOption,
  sources?: StoneGradeSourceMap,
): StoneGradeSelection {
  const source = sources?.[stoneType];
  const options = gradeOptionsForStoneType(stoneType, source);
  const picked = selection?.[stoneType];
  if (!picked) return defaultStoneGradeSelection(stoneType, source);

  const fallback = defaultStoneGradeSelection(stoneType, source);
  const colors = keepOnScale(picked.colors, options.colors);
  const clarities = keepOnScale(picked.clarities, options.clarities);
  return {
    colors:
      colors.length === 0 && picked.colors.length > 0 ? fallback.colors : colors,
    clarities:
      clarities.length === 0 && picked.clarities.length > 0
        ? fallback.clarities
        : clarities,
  };
}

/**
 * Bring any saved selection up to the per-stone grade model.
 *
 * v1 / v2 drafts stored one global `diamondColors` / `diamondClarities` pair
 * shared by every stone type. Those grades are kept only for the stones whose
 * scale actually contains them (so a draft's "G / VS1" stays on natural and
 * lab-grown), and every other stone falls back to its own base grade.
 */
export function migrateVariationSelection(
  selection: VariationSelection | null | undefined,
  sources?: StoneGradeSourceMap,
): VariationSelection {
  const diamondTypes = selection?.diamondTypes?.length
    ? selection.diamondTypes
    : (["natural", "lab-grown"] as DiamondTypeOption[]);

  const stoneGrades: StoneGradeSelectionMap = {};
  for (const stoneType of STONE_TYPE_OPTIONS) {
    if (selection?.stoneGrades?.[stoneType]) {
      stoneGrades[stoneType] = stoneGradesForType(
        selection.stoneGrades,
        stoneType,
        sources,
      );
      continue;
    }
    const source = sources?.[stoneType];
    const options = gradeOptionsForStoneType(stoneType, source);
    const fallback = defaultStoneGradeSelection(stoneType, source);
    const colors = keepOnScale(selection?.diamondColors, options.colors);
    const clarities = keepOnScale(selection?.diamondClarities, options.clarities);
    stoneGrades[stoneType] = {
      colors: colors.length ? colors : fallback.colors,
      clarities: clarities.length ? clarities : fallback.clarities,
    };
  }

  return {
    metals: selection?.metals ?? ["gold"],
    purities: selection?.purities ?? ["14K", "18K"],
    colors: selection?.colors ?? ["yellow", "white", "rose"],
    diamondTypes,
    stoneGrades,
  };
}

/** Purities / colours seeded the first time a metal is switched on. */
export function defaultMetalSelection(metal: GoldMetalOption): {
  purities: GoldPurityOption[];
  colors: GoldColorOption[];
} {
  if (metal === "silver") {
    return { purities: ["925"], colors: ["sterling"] };
  }
  return { purities: ["14K", "18K"], colors: ["yellow", "white", "rose"] };
}
