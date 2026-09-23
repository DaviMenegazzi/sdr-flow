import { useEffect } from 'react';
import { FaqSection, MarketingShell, PlanComparison, PricingSection } from './marketing';

export function PricingPage() {
  useEffect(() => {
    document.title = 'Planos · Prodigi';
    return () => { document.title = 'SDR Flow · Prodigi'; };
  }, []);
  return (
    <MarketingShell>
      <div className="pt-6">
        <PricingSection id="precos" />
      </div>
      <PlanComparison />
      <FaqSection />
    </MarketingShell>
  );
}
