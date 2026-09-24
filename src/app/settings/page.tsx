import { PricingDefaultsForm } from "@/components/settings/pricing-defaults-form";
import { getSession } from "@/lib/auth/session";
import { getPricingDefaults } from "@/lib/services/settings";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const session = await getSession();
  const defaults = session
    ? await getPricingDefaults(session.id)
    : MOCK_PRICING_DEFAULTS;

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <p className="text-xs font-medium uppercase tracking-[0.12em] text-champagne">
          Settings
        </p>
        <h1 className="mt-1 text-2xl font-semibold tracking-tight text-charcoal sm:text-3xl">
          Pricing defaults
        </h1>
        <p className="mt-2 max-w-xl text-sm leading-relaxed text-muted-foreground">
          Set gold, diamond, and charge defaults once. The Jewellery Pricing
          workspace loads these automatically so you type less on every design.
        </p>
      </div>

      <PricingDefaultsForm initialDefaults={defaults} />
    </div>
  );
}
