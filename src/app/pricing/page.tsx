import { PricingWorkspace } from "@/components/pricing/pricing-workspace";
import { getSession } from "@/lib/auth/session";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";
import { getPricingDefaults } from "@/lib/services/settings";

export const dynamic = "force-dynamic";

export default async function PricingPage() {
  const session = await getSession();
  const defaults = session
    ? await getPricingDefaults(session.id)
    : MOCK_PRICING_DEFAULTS;

  return <PricingWorkspace initialDefaults={defaults} />;
}
