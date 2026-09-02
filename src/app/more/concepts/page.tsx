import Link from "next/link";
import { PageHeader } from "@/components/ui/page-header";
import { concepts, t } from "@/i18n";
import { getLocale } from "@/lib/settings";

export const dynamic = "force-dynamic";

export function generateMetadata() {
  const locale = getLocale();
  return { title: t("app.pageTitle", locale, { page: concepts(locale).title }) };
}

/**
 * Ebene 4 of the help plan: the scheduling model explained in one place.
 * The E3 sheets link here by anchor (help.topics.*.more), so this is the
 * destination for "why is it behind but planned for Saturday?" — never the
 * entry point. Content lives in the i18n catalogs like every other string.
 */
export default function ConceptsPage() {
  const locale = getLocale();
  const { title, lede, sections } = concepts(locale);

  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-2xl">
      <PageHeader
        title={title}
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

      <p className="text-base mb-7" style={{ color: "var(--secondary-foreground)" }}>
        {lede}
      </p>

      <div className="flex flex-col gap-4">
        {sections.map((s) => (
          // scroll-mt keeps the heading clear of the top edge when linked to
          <section key={s.id} id={s.id} className="rounded-xl p-5 edge-card scroll-mt-4">
            <h2 className="text-lg font-semibold mb-2">{s.heading}</h2>
            <div className="flex flex-col gap-2.5">
              {s.body.map((p, i) => (
                <p key={i} className="text-sm" style={{ color: "var(--muted-foreground)" }}>
                  {p}
                </p>
              ))}
            </div>
          </section>
        ))}
      </div>
    </main>
  );
}
