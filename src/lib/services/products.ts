import { getDb, idOf, ObjectId, oid } from "@/lib/mongo";
import {
  calculateAllVariations,
  getPriceRange,
  validatePricingSession,
  type PricedVariation,
  type PricingSessionInput,
} from "@/lib/pricing-engine";
import {
  decimalToNumber,
  toPrismaChargeCalcType,
} from "@/lib/services/settings";
import type {
  JewelleryExtractedData,
  PricingFormState,
  VariationSelection,
} from "@/types/jewellery";

export interface SaveProductPayload {
  extracted: JewelleryExtractedData;
  pricing: PricingFormState;
  selection: VariationSelection;
  purityPercentages: PricingSessionInput["purityPercentages"];
  imageFileName?: string | null;
  overridesByVariationId?: PricingSessionInput["overridesByVariationId"];
}

export interface SaveProductResult {
  productId: string;
  calculationId: string;
  designNo: string;
  variationCount: number;
  priceMin: number;
  priceMax: number;
}

function buildSession(payload: SaveProductPayload): PricingSessionInput {
  return {
    netWeight: payload.extracted.netWeight,
    diamondWeight: payload.extracted.diamondWeight,
    gold24kRate: payload.pricing.gold24kRate,
    purityPercentages: payload.purityPercentages,
    metals: payload.selection.metals,
    purities: payload.selection.purities,
    colors: payload.selection.colors,
    diamondTypes: payload.selection.diamondTypes,
    diamondRateNatural: payload.pricing.diamondRateNatural,
    diamondRateLabGrown: payload.pricing.diamondRateLabGrown,
    diamondDiscountPercent: payload.pricing.diamondDiscount,
    makingCharge: payload.pricing.makingCharge,
    makingCalcType: payload.pricing.makingCalcType,
    otherCharges: payload.pricing.otherCharges.map((c) => ({
      id: c.id,
      name: c.name,
      amount: c.amount,
      calcType: c.calcType,
    })),
    overridesByVariationId: payload.overridesByVariationId,
  };
}

export async function saveJewelleryProduct(
  payload: SaveProductPayload,
  userId: string,
): Promise<SaveProductResult> {
  const session = buildSession(payload);
  const issues = validatePricingSession(session);
  if (issues.length > 0) {
    throw new Error(issues.map((i) => i.message).join(" "));
  }

  const variations = calculateAllVariations(session);
  if (variations.length === 0) {
    throw new Error("No variations to save.");
  }

  const range = getPriceRange(variations);
  const { extracted, pricing } = payload;
  const db = await getDb();
  const now = new Date();
  const productId = new ObjectId();
  const userOid = oid(userId);

  await db.collection("JewelleryProduct").insertOne({
    _id: productId,
    userId: userOid,
    designNo: extracted.designNo,
    category: extracted.category,
    goldCode: extracted.goldCode,
    goldMetal: extracted.goldMetal,
    goldPurity: extracted.goldPurity,
    goldColor: extracted.goldColor,
    grossWeight: extracted.grossWeight,
    netWeight: extracted.netWeight,
    pureWeight: extracted.pureWeight,
    size: extracted.size,
    diamondWeight: extracted.diamondWeight,
    diamondShape: extracted.diamondShape,
    diamondType: extracted.diamondType,
    diamondPieces: extracted.diamondPieces,
    certified: extracted.certified,
    imageFileName: payload.imageFileName ?? null,
    priceMin: range.min,
    priceMax: range.max,
    variationCount: variations.length,
    createdAt: now,
    updatedAt: now,
  });

  const createdVariations = await Promise.all(
    variations.map(async (v) => {
      const id = new ObjectId();
      await db.collection("JewelleryVariation").insertOne({
        _id: id,
        productId,
        metal: v.metal,
        purity: v.purity,
        color: v.color,
        label: v.label,
        finalPrice: decimalToNumber(v.calculation.finalPrice),
        goldPrice: decimalToNumber(v.calculation.goldPrice),
        diamondPrice: decimalToNumber(v.calculation.diamondFinalPrice),
        makingCharge: decimalToNumber(v.calculation.makingCharge),
        otherCharges: decimalToNumber(v.calculation.otherChargesTotal),
        isManualOverride: v.hasManualOverride,
        breakdownJson: v.calculation,
        createdAt: now,
      });
      return { id: idOf(id) };
    }),
  );

  const variationByKey = new Map(
    createdVariations.map((row, index) => [variations[index].id, row]),
  );

  const calculationId = new ObjectId();
  await db.collection("PricingCalculation").insertOne({
    _id: calculationId,
    userId: userOid,
    productId,
    gold24kRate: pricing.gold24kRate,
    purityPercentagesJson: payload.purityPercentages,
    diamondRate: pricing.diamondRateNatural,
    diamondDiscountPercent: pricing.diamondDiscount,
    diamondType: payload.selection.diamondTypes.includes("lab-grown")
      ? "lab-grown"
      : "natural",
    diamondShape: pricing.diamondShape,
    makingCharge: pricing.makingCharge,
    makingCalcType: toPrismaChargeCalcType(pricing.makingCalcType),
    otherChargesJson: pricing.otherCharges,
    netWeight: extracted.netWeight,
    diamondWeight: extracted.diamondWeight,
    variationCount: variations.length,
    priceMin: range.min,
    priceMax: range.max,
    createdAt: now,
  });

  await Promise.all(
    variations.map((v: PricedVariation) => {
      const linked = variationByKey.get(v.id);
      return db.collection("PricingCalculationItem").insertOne({
        _id: new ObjectId(),
        calculationId,
        variationId: linked ? oid(linked.id) : null,
        metal: v.metal,
        purity: v.purity,
        color: v.color,
        label: v.label,
        goldRatePerGram: decimalToNumber(v.goldRatePerGram),
        goldPrice: decimalToNumber(v.calculation.goldPrice),
        diamondGrossPrice: decimalToNumber(v.calculation.diamondGrossPrice),
        diamondDiscount: decimalToNumber(v.calculation.diamondDiscountAmount),
        diamondFinalPrice: decimalToNumber(v.calculation.diamondFinalPrice),
        makingCharge: decimalToNumber(v.calculation.makingCharge),
        otherChargesTotal: decimalToNumber(v.calculation.otherChargesTotal),
        subtotal: decimalToNumber(v.calculation.subtotal),
        finalPrice: decimalToNumber(v.calculation.finalPrice),
        isManualOverride: v.hasManualOverride,
        breakdownJson: v.calculation.breakdown,
      });
    }),
  );

  return {
    productId: idOf(productId),
    calculationId: idOf(calculationId),
    designNo: extracted.designNo,
    variationCount: variations.length,
    priceMin: range.min,
    priceMax: range.max,
  };
}

export async function listProducts(userId: string, limit = 50) {
  const db = await getDb();
  const rows = await db
    .collection("JewelleryProduct")
    .find({ userId: oid(userId) })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .project({
      designNo: 1,
      category: 1,
      variationCount: 1,
      priceMin: 1,
      priceMax: 1,
      netWeight: 1,
      diamondWeight: 1,
      updatedAt: 1,
      createdAt: 1,
    })
    .toArray();

  return rows.map((p) => ({
    id: idOf(p._id),
    designNo: p.designNo as string,
    category: p.category as string,
    variationCount: (p.variationCount as number) ?? 0,
    priceMin: (p.priceMin as number) ?? null,
    priceMax: (p.priceMax as number) ?? null,
    netWeight: p.netWeight as number,
    diamondWeight: p.diamondWeight as number,
    updatedAt: p.updatedAt as Date,
    createdAt: p.createdAt as Date,
  }));
}

export async function listCalculations(userId: string, limit = 50) {
  const db = await getDb();
  const rows = await db
    .collection("PricingCalculation")
    .find({ userId: oid(userId) })
    .sort({ createdAt: -1 })
    .limit(limit)
    .toArray();

  const productIds = rows.map((row) => row.productId as ObjectId);
  const products = productIds.length
    ? await db
        .collection("JewelleryProduct")
        .find({ _id: { $in: productIds } })
        .project({ designNo: 1, category: 1 })
        .toArray()
    : [];
  const productMap = new Map(
    products.map((p) => [
      idOf(p._id),
      {
        id: idOf(p._id),
        designNo: p.designNo as string,
        category: p.category as string,
      },
    ]),
  );

  return rows.map((row) => ({
    id: idOf(row._id),
    productId: idOf(row.productId as ObjectId),
    gold24kRate: row.gold24kRate as number,
    diamondRate: row.diamondRate as number,
    diamondDiscountPercent: row.diamondDiscountPercent as number,
    makingCharge: row.makingCharge as number,
    variationCount: row.variationCount as number,
    priceMin: row.priceMin as number,
    priceMax: row.priceMax as number,
    createdAt: row.createdAt as Date,
    product: productMap.get(idOf(row.productId as ObjectId)) ?? {
      id: idOf(row.productId as ObjectId),
      designNo: "Unknown",
      category: "",
    },
  }));
}

export async function getDashboardStats(userId: string) {
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const db = await getDb();
  const userOid = oid(userId);

  // Fetch the user's products once with just the fields we need. We derive
  // totalDesigns, calculatedProducts and totalVariations from this single
  // result instead of running three separate Atlas queries (each remote
  // round-trip adds latency).
  const productAgg = db
    .collection("JewelleryProduct")
    .find({ userId: userOid })
    .project({ variationCount: 1 })
    .toArray();

  const [products, todaysImports, defaults] = await Promise.all([
    productAgg,
    db.collection("OcrImport").countDocuments({
      userId: userOid,
      createdAt: { $gte: startOfDay },
    }),
    db.collection("AppSetting").findOne({
      userId: userOid,
      key: "pricing_defaults",
    }),
  ]);

  let calculatedProducts = 0;
  let totalVariations = 0;
  for (const p of products) {
    const count = (p.variationCount as number) ?? 0;
    if (count > 0) calculatedProducts++;
    totalVariations += count;
  }

  const defaultsValue = (defaults?.value ?? {}) as { gold24kRate?: number };

  return {
    totalDesigns: products.length,
    todaysImports,
    calculatedProducts,
    totalVariations,
    current24kGoldRate: defaultsValue.gold24kRate ?? 10000,
  };
}
