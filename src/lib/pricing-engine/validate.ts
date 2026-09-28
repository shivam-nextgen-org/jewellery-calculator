import { d } from "./decimal";
import type { PricingSessionInput, PricingValidationIssue } from "./types";

export function validatePricingSession(
  session: PricingSessionInput,
): PricingValidationIssue[] {
  const issues: PricingValidationIssue[] = [];

  if (session.metals.length === 0) {
    issues.push({
      field: "metals",
      message: "Select at least one metal.",
    });
  }
  if (session.purities.length === 0) {
    issues.push({
      field: "purities",
      message: "Select at least one purity.",
    });
  }
  if (session.colors.length === 0) {
    issues.push({
      field: "colors",
      message: "Select at least one color.",
    });
  }
  if (!session.diamondTypes || session.diamondTypes.length === 0) {
    issues.push({
      field: "diamondTypes",
      message:
        "Select at least one stone type (Natural, Lab Grown, and/or Moissanite).",
    });
  }

  try {
    const net = d(session.netWeight);
    if (net.lte(0)) {
      issues.push({
        field: "netWeight",
        message: "Net weight must be greater than zero.",
      });
    }
  } catch {
    issues.push({
      field: "netWeight",
      message: "Invalid net weight.",
    });
  }

  try {
    const dw = d(session.diamondWeight);
    if (dw.lt(0)) {
      issues.push({
        field: "diamondWeight",
        message: "Diamond weight cannot be negative.",
      });
    }
  } catch {
    issues.push({
      field: "diamondWeight",
      message: "Invalid diamond weight.",
    });
  }

  try {
    if (d(session.gold24kRate).lt(0)) {
      issues.push({
        field: "gold24kRate",
        message: "Gold rate cannot be negative.",
      });
    }
  } catch {
    issues.push({
      field: "gold24kRate",
      message: "Invalid gold rate.",
    });
  }

  try {
    if (d(session.diamondRateNatural).lt(0)) {
      issues.push({
        field: "diamondRateNatural",
        message: "Natural diamond rate cannot be negative.",
      });
    }
    if (d(session.diamondRateLabGrown).lt(0)) {
      issues.push({
        field: "diamondRateLabGrown",
        message: "Lab grown diamond rate cannot be negative.",
      });
    }
    if (d(session.diamondRateMoissanite ?? 0).lt(0)) {
      issues.push({
        field: "diamondRateMoissanite",
        message: "Moissanite rate cannot be negative.",
      });
    }
  } catch {
    issues.push({
      field: "diamondRate",
      message: "Invalid diamond rate.",
    });
  }

  try {
    const discount = d(session.diamondDiscountPercent);
    if (discount.lt(0)) {
      issues.push({
        field: "diamondDiscount",
        message: "Discount cannot be negative.",
      });
    }
    if (discount.gt(100)) {
      issues.push({
        field: "diamondDiscount",
        message: "Discount cannot exceed 100%.",
      });
    }
  } catch {
    issues.push({
      field: "diamondDiscount",
      message: "Invalid discount.",
    });
  }

  try {
    if (d(session.makingCharge).lt(0)) {
      issues.push({
        field: "makingCharge",
        message: "Making charge cannot be negative.",
      });
    }
  } catch {
    issues.push({
      field: "makingCharge",
      message: "Invalid making charge.",
    });
  }

  for (const charge of session.otherCharges) {
    try {
      if (d(charge.amount).lt(0)) {
        issues.push({
          field: `charge:${charge.id}`,
          message: `"${charge.name}" cannot be negative.`,
        });
      }
    } catch {
      issues.push({
        field: `charge:${charge.id}`,
        message: `Invalid amount for "${charge.name}".`,
      });
    }
  }

  for (const purity of session.purities) {
    const pct = session.purityPercentages[purity];
    if (pct == null) {
      issues.push({
        field: `purity:${purity}`,
        message: `Missing purity percentage for ${purity}.`,
      });
    }
  }

  return issues;
}
