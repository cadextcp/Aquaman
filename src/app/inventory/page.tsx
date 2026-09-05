import Link from "next/link";
import { listProducts, listArchivedProducts, listSchedules } from "@/lib/repo";
import { PageHeader } from "@/components/ui/page-header";
import { HelpNote } from "@/components/ui/help";
import { InventorySection } from "@/components/inventory-section";
import { getLocale } from "@/lib/settings";
import { t } from "@/i18n";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  const locale = getLocale();
  return { title: t("app.pageTitle", locale, { page: t("inventory.title", locale) }) };
}

/**
 * The virtual shelf (docs/plan-produkt-lager.md): the fertilizers and foods
 * the user owns. Install-global rather than per tank — the cupboard serves
 * every aquarium — and reached from More, because the bottom nav is full at
 * five entries.
 */
export default function InventoryPage() {
  const locale = getLocale();
  const fertilizers = listProducts("fertilizer");
  const foods = listProducts("food");
  /**
   * Every active fertilize plan across all tanks — "used in N plans" is only
   * answerable across the lot: scoped to one tank, a fertilizer used by the
   * second aquarium would be reported as unused.
   */
  const fertilizePlans = listSchedules()
    .filter((s) => s.actionType === "fertilize")
    .map((s) => (s.detailData as { nutrients?: Record<string, unknown> } | null)?.nutrients ?? null);
  const archived = listArchivedProducts();

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-2xl">
      <PageHeader
        title={t("inventory.title", locale)}
        subtitle={t("inventory.lede", locale)}
        action={
          <Link
            href="/more"
            className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm"
            style={{ minHeight: 44 }}
          >
            <i aria-hidden className="ph ph-caret-left" /> {t("common.back", locale)}
          </Link>
        }
      />

      <HelpNote id="inventory" className="mb-4" />

      <InventorySection kind="fertilizer" products={fertilizers} fertilizePlans={fertilizePlans} archived={archived} />
      <InventorySection kind="food" products={foods} archived={archived} />
    </main>
  );
}
