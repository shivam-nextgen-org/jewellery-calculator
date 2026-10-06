import { PricingWorkspace } from "@/components/pricing/pricing-workspace";
import { AccessRestricted } from "@/components/security/access-restricted";
import { getPageAccess } from "@/lib/auth/session";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import {
  ensureDefaultPricingProfiles,
  getDefaultPricingProfile,
} from "@/lib/services/pricing-profiles";
import { getPricingDefaults } from "@/lib/services/settings";
import type { DiamondTypeOption, PricingProfile } from "@/types/jewellery";

export const dynamic = "force-dynamic";

const STONE_TYPES: DiamondTypeOption[] = ["natural", "lab-grown", "moissanite"];

export default async function PricingPage() {
  const access = await getPageAccess("USER");
  if (access.kind === "denied") return <AccessRestricted device={access.device} />;
  const defaults =
    access.kind === "ok"
      ? await getPricingDefaults(access.user.id)
      : MOCK_PRICING_DEFAULTS;

  const initialProfiles: Partial<Record<DiamondTypeOption, PricingProfile>> = {};
  if (access.kind === "ok") {
    await ensureDefaultPricingProfiles(access.user.id);
    await Promise.all(
      STONE_TYPES.map(async (stoneType) => {
        const profile = await getDefaultPricingProfile(access.user.id, stoneType);
        if (profile) initialProfiles[stoneType] = profile;
      }),
    );
  }

  return (
    <PricingWorkspace
      initialDefaults={defaults}
      initialProfiles={initialProfiles}
    />
  );
}
