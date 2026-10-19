"use client";

import { Gem, Store } from "lucide-react";
import { EtsyCommissionForm } from "@/components/settings/etsy-commission-form";
import { PricingDefaultsForm } from "@/components/settings/pricing-defaults-form";
import { PageHeading } from "@/components/ui/page-heading";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { EtsyCommissionSettings } from "@/types/etsy";
import type { PricingDefaults } from "@/types/jewellery";

export function SettingsWorkspace({
  defaults,
  etsyEnabled,
  etsySettings,
}: {
  defaults: PricingDefaults;
  etsyEnabled: boolean;
  etsySettings: EtsyCommissionSettings | null;
}) {
  const showEtsy = etsyEnabled && etsySettings !== null;

  if (!showEtsy) {
    return (
      <div className="space-y-6">
        <PageHeading
          eyebrow="Settings"
          title="Jewellery pricing"
          description="Every new pricing session starts from these values. You can still adjust any of them per design."
        />
        <PricingDefaultsForm initialDefaults={defaults} />
      </div>
    );
  }

  return (
    <Tabs defaultValue="jewellery" className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <PageHeading
          eyebrow="Settings"
          title="Rates & commissions"
          description="Switch between jewellery defaults and Etsy marketplace rates."
          className="sm:flex-1"
        />
        <TabsList className="shrink-0 self-start sm:self-auto">
          <TabsTrigger value="jewellery">
            <Gem className="h-3.5 w-3.5 opacity-70" />
            Jewellery pricing
          </TabsTrigger>
          <TabsTrigger value="etsy">
            <Store className="h-3.5 w-3.5 opacity-70" />
            Etsy Commission
          </TabsTrigger>
        </TabsList>
      </div>

      <TabsContent value="jewellery" className="space-y-6 outline-none">
        <PricingDefaultsForm initialDefaults={defaults} />
      </TabsContent>

      <TabsContent value="etsy" className="space-y-6 outline-none">
        <EtsyCommissionForm initialSettings={etsySettings} />
      </TabsContent>
    </Tabs>
  );
}
