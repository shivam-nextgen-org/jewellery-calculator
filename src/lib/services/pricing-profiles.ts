import { unstable_cache, revalidateTag } from "next/cache";
import type {
  DiamondTypeOption,
  PricingDefaults,
  PricingGradeRule,
  PricingProfile,
  PricingProfileInput,
} from "@/types/jewellery";
import {
  calculateRateFromGradeProfile,
  type PricingCalculationMethod,
} from "@/lib/pricing-engine/grade-adjustments";
import {
  defaultBaseClarityForStoneType,
  defaultBaseColorForStoneType,
  defaultClarityRulesForStoneType,
  defaultColorRulesForStoneType,
  defaultProfileNameForStoneType,
} from "@/lib/pricing-engine/grade-defaults";
import {
  PricingProfileValidationError,
  validatePricingProfileInput,
} from "@/lib/pricing-engine/profile-validate";
import { getDb, idOf, ObjectId, oid } from "@/lib/mongo";
import {
  getPricingDefaults,
  parsePricingDefaults,
  PRICING_DEFAULTS_KEY,
} from "@/lib/services/settings";

const COLLECTION = "PricingProfile";
const REVISION_COLLECTION = "PricingProfileRevision";
const STONE_TYPES: DiamondTypeOption[] = ["natural", "lab-grown", "moissanite"];

type ProfileDoc = {
  _id: ObjectId;
  userId: ObjectId;
  name: string;
  stoneType: DiamondTypeOption;
  status: "active" | "archived";
  basePricePerCt: number;
  baseCurrency: "INR";
  baseColorGrade: string;
  baseClarityGrade: string;
  calculationMethod: PricingCalculationMethod;
  colorRules: PricingGradeRule[];
  clarityRules: PricingGradeRule[];
  isDefault: boolean;
  updatedByUserId: ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
};

function profilesTag(userId: string) {
  return `pricing-profiles:${userId}`;
}

function invalidateProfilesCache(userId: string) {
  try {
    revalidateTag(profilesTag(userId), { expire: 0 });
  } catch {
    // Outside a Next request (scripts) — Mongo write still succeeds.
  }
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function serializeProfile(doc: ProfileDoc): PricingProfile {
  return {
    id: idOf(doc._id),
    userId: idOf(doc.userId),
    name: doc.name,
    stoneType: doc.stoneType,
    status: doc.status,
    basePricePerCt: doc.basePricePerCt,
    baseCurrency: "INR",
    baseColorGrade: doc.baseColorGrade,
    baseClarityGrade: doc.baseClarityGrade,
    calculationMethod:
      doc.calculationMethod === "sequential" ? "sequential" : "additive",
    colorRules: Array.isArray(doc.colorRules) ? doc.colorRules : [],
    clarityRules: Array.isArray(doc.clarityRules) ? doc.clarityRules : [],
    isDefault: Boolean(doc.isDefault),
    updatedByUserId: doc.updatedByUserId ? idOf(doc.updatedByUserId) : null,
    createdAt: toIso(doc.createdAt),
    updatedAt: toIso(doc.updatedAt),
  };
}

function basePriceFromDefaults(
  defaults: PricingDefaults,
  stoneType: DiamondTypeOption,
): number {
  if (stoneType === "lab-grown") return defaults.defaultDiamondRateLabGrown;
  if (stoneType === "moissanite") return defaults.defaultDiamondRateMoissanite;
  return defaults.defaultDiamondRateNatural;
}

function buildDefaultProfileDoc(
  userId: string,
  stoneType: DiamondTypeOption,
  basePricePerCt: number,
  now: Date,
): Omit<ProfileDoc, "_id"> {
  return {
    userId: oid(userId),
    name: defaultProfileNameForStoneType(stoneType),
    stoneType,
    status: "active",
    basePricePerCt,
    baseCurrency: "INR",
    baseColorGrade: defaultBaseColorForStoneType(stoneType),
    baseClarityGrade: defaultBaseClarityForStoneType(stoneType),
    calculationMethod: "additive",
    colorRules: defaultColorRulesForStoneType(stoneType),
    clarityRules: defaultClarityRulesForStoneType(stoneType),
    isDefault: true,
    updatedByUserId: oid(userId),
    createdAt: now,
    updatedAt: now,
  };
}

async function writeRevision(
  profile: ProfileDoc,
  actorUserId: string,
): Promise<void> {
  const db = await getDb();
  await db.collection(REVISION_COLLECTION).insertOne({
    _id: new ObjectId(),
    profileId: profile._id,
    userId: oid(actorUserId),
    snapshot: serializeProfile(profile),
    createdAt: new Date(),
  });
}

async function clearDefaultFlags(
  userId: string,
  stoneType: DiamondTypeOption,
  exceptId?: ObjectId,
): Promise<void> {
  const db = await getDb();
  const filter: Record<string, unknown> = {
    userId: oid(userId),
    stoneType,
    isDefault: true,
    status: "active",
  };
  if (exceptId) filter._id = { $ne: exceptId };
  await db.collection(COLLECTION).updateMany(filter, {
    $set: { isDefault: false, updatedAt: new Date() },
  });
}

async function syncDefaultBasePriceToSettings(
  userId: string,
  stoneType: DiamondTypeOption,
  basePricePerCt: number,
): Promise<void> {
  const db = await getDb();
  const row = await db.collection("AppSetting").findOne({
    userId: oid(userId),
    key: PRICING_DEFAULTS_KEY,
  });
  const current = parsePricingDefaults(row?.value);
  const next: PricingDefaults = { ...current };
  if (stoneType === "lab-grown") {
    next.defaultDiamondRateLabGrown = basePricePerCt;
  } else if (stoneType === "moissanite") {
    next.defaultDiamondRateMoissanite = basePricePerCt;
  } else {
    next.defaultDiamondRateNatural = basePricePerCt;
    next.defaultDiamondRate = basePricePerCt;
  }
  const now = new Date();
  await db.collection("AppSetting").updateOne(
    { userId: oid(userId), key: PRICING_DEFAULTS_KEY },
    {
      $set: { value: next, updatedAt: now },
      $setOnInsert: {
        _id: new ObjectId(),
        userId: oid(userId),
        key: PRICING_DEFAULTS_KEY,
        createdAt: now,
      },
    },
    { upsert: true },
  );
  try {
    revalidateTag(`pricing-defaults:${userId}`, { expire: 0 });
  } catch {
    // ignore outside Next
  }
}

async function fetchProfiles(
  userId: string,
  stoneType?: DiamondTypeOption,
): Promise<PricingProfile[]> {
  const db = await getDb();
  const filter: Record<string, unknown> = {
    userId: oid(userId),
    status: "active",
  };
  if (stoneType) filter.stoneType = stoneType;
  const rows = (await db
    .collection(COLLECTION)
    .find(filter)
    .sort({ isDefault: -1, name: 1 })
    .toArray()) as ProfileDoc[];
  return rows.map(serializeProfile);
}

/**
 * Ensure the user has a default profile for each stone type.
 * Creates from pricing_defaults rates with all grade adjustments at 0%.
 */
export async function ensureDefaultPricingProfiles(
  userId: string,
): Promise<PricingProfile[]> {
  const defaults = await getPricingDefaults(userId);
  const db = await getDb();
  const now = new Date();

  for (const stoneType of STONE_TYPES) {
    const existing = await db.collection(COLLECTION).findOne({
      userId: oid(userId),
      stoneType,
      status: "active",
    });
    if (existing) {
      const hasDefault = await db.collection(COLLECTION).findOne({
        userId: oid(userId),
        stoneType,
        status: "active",
        isDefault: true,
      });
      if (!hasDefault) {
        await db.collection(COLLECTION).updateOne(
          { _id: existing._id },
          { $set: { isDefault: true, updatedAt: now } },
        );
      }
      continue;
    }

    const doc = {
      _id: new ObjectId(),
      ...buildDefaultProfileDoc(
        userId,
        stoneType,
        basePriceFromDefaults(defaults, stoneType),
        now,
      ),
    };
    await db.collection(COLLECTION).insertOne(doc);
    await writeRevision(doc as ProfileDoc, userId);
  }

  invalidateProfilesCache(userId);
  return fetchProfiles(userId);
}

export async function listPricingProfiles(
  userId: string,
  stoneType?: DiamondTypeOption,
): Promise<PricingProfile[]> {
  const cached = unstable_cache(
    () => fetchProfiles(userId, stoneType),
    ["pricing-profiles", userId, stoneType ?? "all"],
    { tags: [profilesTag(userId)], revalidate: 300 },
  );
  return cached();
}

export async function getPricingProfile(
  userId: string,
  id: string,
): Promise<PricingProfile | null> {
  const db = await getDb();
  const doc = (await db.collection(COLLECTION).findOne({
    _id: oid(id),
    userId: oid(userId),
  })) as ProfileDoc | null;
  if (!doc || doc.status === "archived") return null;
  return serializeProfile(doc);
}

export async function getDefaultPricingProfile(
  userId: string,
  stoneType: DiamondTypeOption,
): Promise<PricingProfile | null> {
  await ensureDefaultPricingProfiles(userId);
  const db = await getDb();
  const doc = (await db.collection(COLLECTION).findOne({
    userId: oid(userId),
    stoneType,
    status: "active",
    isDefault: true,
  })) as ProfileDoc | null;
  if (doc) return serializeProfile(doc);
  const fallback = (await db.collection(COLLECTION).findOne({
    userId: oid(userId),
    stoneType,
    status: "active",
  })) as ProfileDoc | null;
  return fallback ? serializeProfile(fallback) : null;
}

export async function createPricingProfile(
  userId: string,
  input: PricingProfileInput,
): Promise<PricingProfile> {
  const validated = validatePricingProfileInput(input);
  const db = await getDb();
  const now = new Date();
  const isDefault = Boolean(validated.isDefault);

  if (isDefault) {
    await clearDefaultFlags(userId, validated.stoneType);
  }

  const doc: ProfileDoc = {
    _id: new ObjectId(),
    userId: oid(userId),
    name: validated.name,
    stoneType: validated.stoneType,
    status: "active",
    basePricePerCt: validated.basePricePerCt,
    baseCurrency: "INR",
    baseColorGrade: validated.baseColorGrade,
    baseClarityGrade: validated.baseClarityGrade,
    calculationMethod: validated.calculationMethod,
    colorRules: validated.colorRules,
    clarityRules: validated.clarityRules,
    isDefault,
    updatedByUserId: oid(userId),
    createdAt: now,
    updatedAt: now,
  };

  await db.collection(COLLECTION).insertOne(doc);
  await writeRevision(doc, userId);

  if (isDefault) {
    await syncDefaultBasePriceToSettings(
      userId,
      validated.stoneType,
      validated.basePricePerCt,
    );
  }

  invalidateProfilesCache(userId);
  return serializeProfile(doc);
}

export async function updatePricingProfile(
  userId: string,
  id: string,
  input: PricingProfileInput,
): Promise<PricingProfile> {
  const validated = validatePricingProfileInput(input);
  const db = await getDb();
  const existing = (await db.collection(COLLECTION).findOne({
    _id: oid(id),
    userId: oid(userId),
    status: "active",
  })) as ProfileDoc | null;

  if (!existing) {
    throw new PricingProfileValidationError("Pricing profile not found.");
  }

  if (validated.updatedAt) {
    const clientUpdated = new Date(validated.updatedAt).getTime();
    const serverUpdated = new Date(existing.updatedAt).getTime();
    if (
      Number.isFinite(clientUpdated) &&
      Number.isFinite(serverUpdated) &&
      clientUpdated !== serverUpdated
    ) {
      throw new PricingProfileValidationError(
        "This pricing profile was updated elsewhere. Please reload and try again.",
        undefined,
        409,
      );
    }
  }

  const now = new Date();
  const makeDefault =
    validated.isDefault === true ||
    (validated.isDefault !== false && existing.isDefault);

  if (makeDefault) {
    await clearDefaultFlags(userId, validated.stoneType, existing._id);
  }

  const next: ProfileDoc = {
    ...existing,
    name: validated.name,
    stoneType: validated.stoneType,
    basePricePerCt: validated.basePricePerCt,
    baseColorGrade: validated.baseColorGrade,
    baseClarityGrade: validated.baseClarityGrade,
    calculationMethod: validated.calculationMethod,
    colorRules: validated.colorRules,
    clarityRules: validated.clarityRules,
    isDefault: makeDefault,
    updatedByUserId: oid(userId),
    updatedAt: now,
  };

  await db.collection(COLLECTION).updateOne(
    { _id: existing._id },
    {
      $set: {
        name: next.name,
        stoneType: next.stoneType,
        basePricePerCt: next.basePricePerCt,
        baseColorGrade: next.baseColorGrade,
        baseClarityGrade: next.baseClarityGrade,
        calculationMethod: next.calculationMethod,
        colorRules: next.colorRules,
        clarityRules: next.clarityRules,
        isDefault: next.isDefault,
        updatedByUserId: next.updatedByUserId,
        updatedAt: next.updatedAt,
      },
    },
  );

  await writeRevision(next, userId);

  if (next.isDefault) {
    await syncDefaultBasePriceToSettings(
      userId,
      next.stoneType,
      next.basePricePerCt,
    );
  }

  invalidateProfilesCache(userId);
  return serializeProfile(next);
}

export async function archivePricingProfile(
  userId: string,
  id: string,
): Promise<{ id: string; archived: true }> {
  const db = await getDb();
  const existing = (await db.collection(COLLECTION).findOne({
    _id: oid(id),
    userId: oid(userId),
    status: "active",
  })) as ProfileDoc | null;

  if (!existing) {
    throw new PricingProfileValidationError("Pricing profile not found.");
  }

  const siblings = await db.collection(COLLECTION).countDocuments({
    userId: oid(userId),
    stoneType: existing.stoneType,
    status: "active",
    _id: { $ne: existing._id },
  });

  if (siblings === 0) {
    throw new PricingProfileValidationError(
      "Cannot archive the only pricing profile for this stone type.",
    );
  }

  const now = new Date();
  await db.collection(COLLECTION).updateOne(
    { _id: existing._id },
    {
      $set: {
        status: "archived",
        isDefault: false,
        updatedAt: now,
        updatedByUserId: oid(userId),
      },
    },
  );

  if (existing.isDefault) {
    const nextDefault = (await db.collection(COLLECTION).findOne({
      userId: oid(userId),
      stoneType: existing.stoneType,
      status: "active",
    })) as ProfileDoc | null;
    if (nextDefault) {
      await db.collection(COLLECTION).updateOne(
        { _id: nextDefault._id },
        { $set: { isDefault: true, updatedAt: now } },
      );
      await syncDefaultBasePriceToSettings(
        userId,
        nextDefault.stoneType,
        nextDefault.basePricePerCt,
      );
    }
  }

  invalidateProfilesCache(userId);
  return { id, archived: true };
}

export async function setDefaultPricingProfile(
  userId: string,
  id: string,
): Promise<PricingProfile> {
  const db = await getDb();
  const existing = (await db.collection(COLLECTION).findOne({
    _id: oid(id),
    userId: oid(userId),
    status: "active",
  })) as ProfileDoc | null;

  if (!existing) {
    throw new PricingProfileValidationError("Pricing profile not found.");
  }

  await clearDefaultFlags(userId, existing.stoneType, existing._id);
  const now = new Date();
  await db.collection(COLLECTION).updateOne(
    { _id: existing._id },
    {
      $set: {
        isDefault: true,
        updatedAt: now,
        updatedByUserId: oid(userId),
      },
    },
  );

  await syncDefaultBasePriceToSettings(
    userId,
    existing.stoneType,
    existing.basePricePerCt,
  );

  invalidateProfilesCache(userId);
  return serializeProfile({
    ...existing,
    isDefault: true,
    updatedAt: now,
    updatedByUserId: oid(userId),
  });
}

export function previewPricingProfile(
  profile: Pick<
    PricingProfile,
    | "basePricePerCt"
    | "colorRules"
    | "clarityRules"
    | "calculationMethod"
    | "baseCurrency"
  >,
  input: {
    colorGrade: string;
    clarityGrade: string;
    carat?: number;
  },
) {
  const gradeResult = calculateRateFromGradeProfile({
    basePricePerCt: profile.basePricePerCt,
    colorRules: profile.colorRules,
    clarityRules: profile.clarityRules,
    colorGrade: input.colorGrade,
    clarityGrade: input.clarityGrade,
    calculationMethod: profile.calculationMethod,
  });

  const carat =
    input.carat != null && Number.isFinite(input.carat) && input.carat >= 0
      ? input.carat
      : 1;
  const rateNum = Number(gradeResult.ratePerCt);
  const totalForCarat = Number((rateNum * carat).toFixed(2));

  return {
    basePricePerCt: profile.basePricePerCt,
    colorGrade: input.colorGrade,
    clarityGrade: input.clarityGrade,
    colorAdjustmentPercent: gradeResult.colorAdjustmentPercent,
    clarityAdjustmentPercent: gradeResult.clarityAdjustmentPercent,
    totalAdjustmentPercent: Number(gradeResult.totalAdjustmentPercent),
    calculationMethod: gradeResult.method,
    ratePerCt: rateNum,
    carat,
    totalPrice: totalForCarat,
    currency: profile.baseCurrency ?? "INR",
  };
}

export function buildSeedProfileInput(
  stoneType: DiamondTypeOption,
  basePricePerCt: number,
  name?: string,
): PricingProfileInput {
  return {
    name: name ?? defaultProfileNameForStoneType(stoneType),
    stoneType,
    basePricePerCt,
    baseColorGrade: defaultBaseColorForStoneType(stoneType),
    baseClarityGrade: defaultBaseClarityForStoneType(stoneType),
    calculationMethod: "additive",
    colorRules: defaultColorRulesForStoneType(stoneType),
    clarityRules: defaultClarityRulesForStoneType(stoneType),
    isDefault: false,
  };
}

/**
 * When metal/diamond rates are saved in Settings, push base ₹/ct (and diamond
 * color/clarity bases) onto each stone type's default pricing profile so the
 * jewellery workspace and Diamond pricing tab stay aligned.
 */
export async function syncSettingsRatesToDefaultProfiles(
  userId: string,
  defaults: PricingDefaults,
): Promise<void> {
  await ensureDefaultPricingProfiles(userId);
  const db = await getDb();
  const now = new Date();
  const rates: Record<DiamondTypeOption, number> = {
    natural: defaults.defaultDiamondRateNatural,
    "lab-grown": defaults.defaultDiamondRateLabGrown,
    moissanite: defaults.defaultDiamondRateMoissanite,
  };

  for (const stoneType of STONE_TYPES) {
    const basePricePerCt = rates[stoneType];
    if (!Number.isFinite(basePricePerCt) || basePricePerCt < 0) continue;

    const doc = (await db.collection(COLLECTION).findOne({
      userId: oid(userId),
      stoneType,
      status: "active",
      isDefault: true,
    })) as ProfileDoc | null;
    if (!doc) continue;

    const patch: Record<string, unknown> = {
      basePricePerCt,
      updatedAt: now,
      updatedByUserId: oid(userId),
    };

    if (stoneType !== "moissanite") {
      const color = defaults.defaultDiamondColorGrade?.trim();
      const clarity = defaults.defaultDiamondClarityGrade?.trim();
      if (color && doc.colorRules.some((r) => r.grade === color)) {
        patch.baseColorGrade = color;
        patch.colorRules = doc.colorRules.map((r) =>
          r.grade === color ? { ...r, adjustmentPercent: 0 } : r,
        );
      }
      if (clarity && doc.clarityRules.some((r) => r.grade === clarity)) {
        patch.baseClarityGrade = clarity;
        patch.clarityRules = doc.clarityRules.map((r) =>
          r.grade === clarity ? { ...r, adjustmentPercent: 0 } : r,
        );
      }
    }

    await db.collection(COLLECTION).updateOne({ _id: doc._id }, { $set: patch });
  }

  invalidateProfilesCache(userId);
}

export { PricingProfileValidationError };
