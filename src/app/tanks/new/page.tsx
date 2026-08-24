import { TankForm } from "@/components/tank-form";

export const dynamic = "force-dynamic";

export default function NewTankPage() {
  return (
    <main className="flex-1 pb-20 lg:pb-8 p-4 lg:p-8 max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">New tank</h1>
      <div className="rounded-xl p-5 edge-card">
        <TankForm />
      </div>
    </main>
  );
}
