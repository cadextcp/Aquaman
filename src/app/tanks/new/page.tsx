import Link from "next/link";
import { TankForm } from "@/components/tank-form";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

export default function NewTankPage() {
  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-2xl">
      <PageHeader
        title="New tank"
        action={
          <Link href="/tanks" className="btn-ghost inline-flex items-center gap-1.5 rounded-lg px-3 py-2 text-sm" style={{ minHeight: 44 }}>
            <i aria-hidden className="ph ph-caret-left" /> Tanks
          </Link>
        }
      />
      <div className="rounded-xl p-5 edge-card">
        <TankForm />
      </div>
    </main>
  );
}
