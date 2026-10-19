import { AccessRestricted } from "@/components/security/access-restricted";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { getPageAccess } from "@/lib/auth/session";
import {
  getEtsyCommission,
  getUserEtsyEnabled,
} from "@/lib/services/etsy-settings";
import { getPricingDefaults } from "@/lib/services/settings";
import { ensureDefaultPricingProfiles } from "@/lib/services/pricing-profiles";
import { MOCK_PRICING_DEFAULTS } from "@/lib/mock/data";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const access = await getPageAccess("USER");
  if (access.kind === "denied")
    return <AccessRestricted device={access.device} />;
  const defaults =
    access.kind === "ok"
      ? await getPricingDefaults(access.user.id)
      : MOCK_PRICING_DEFAULTS;

  let etsyEnabled = false;
  let etsySettings = null;
  if (access.kind === "ok") {
    await ensureDefaultPricingProfiles(access.user.id);
    etsyEnabled = await getUserEtsyEnabled(access.user.id);
    if (etsyEnabled) {
      etsySettings = await getEtsyCommission(access.user.id);
    }
  }

  return (
    <SettingsWorkspace
      defaults={defaults}
      etsyEnabled={etsyEnabled}
      etsySettings={etsySettings}
    />
  );
}
