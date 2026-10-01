import { PricingWorkspace } from "@/components/pricing/pricing-workspace";
import { AccessRestricted } from "@/components/security/access-restricted";
import { getPageAccess } from "@/lib/auth/session";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import { getPricingDefaults } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const access = await getPageAccess("USER");
  if (access.kind === "denied") return <AccessRestricted device={access.device} />;
  const defaults =
    access.kind === "ok"
      ? await getPricingDefaults(access.user.id)
      : MOCK_PRICING_DEFAULTS;

  return <PricingWorkspace initialDefaults={defaults} />;
}
