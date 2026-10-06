import { AccessRestricted } from "@/components/security/access-restricted";
import { PricingDefaultsForm } from "@/components/settings/pricing-defaults-form";
import { PageHeading } from "@/components/ui/page-heading";
import { getPageAccess } from "@/lib/auth/session";
import { getPricingDefaults } from "@/lib/services/settings";
import { ensureDefaultPricingProfiles } from "@/lib/services/pricing-profiles";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await getPageAccess("USER");
  if (access.kind === "denied") return <AccessRestricted device={access.device} />;
  const defaults =
    access.kind === "ok"
      ? await getPricingDefaults(access.user.id)
      : MOCK_PRICING_DEFAULTS;

  if (access.kind === "ok") {
    await ensureDefaultPricingProfiles(access.user.id);
  }

  return (
    <div className="space-y-6">
      <PageHeading
        eyebrow="Settings"
        title="Rates & pricing defaults"
        description="Every new pricing session starts from these values. You can still adjust any of them per design."
      />
      <PricingDefaultsForm initialDefaults={defaults} />
    </div>
  );
}
