import { PageHeader } from "@/components/ui";
import { requireStore } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function OutboxPage({ params }: { params: Promise<{ storeId: string }> }) {
  const { storeId } = await params;
  await requireStore(storeId, "account.billing");
  const emails = await (await db()).list("emails", { storeId }, { orderBy: "at", desc: true, limit: 100 });
  return (
    <>
      <PageHeader title="Email outbox" sub="Every notification the app sends. In demo mode nothing actually leaves the building." />
      <div className="space-y-3">
        {emails.map((m) => (
          <div key={m.id} className="card">
            <p className="text-xs text-stone-500">
              {new Date(m.at).toLocaleString("en-GB")} · to {m.to} · {m.sent ? "sent" : "not sent (demo)"}
            </p>
            <p className="mt-1 font-medium">{m.subject}</p>
            <p className="mt-1 text-sm whitespace-pre-line text-stone-700">{m.body}</p>
          </div>
        ))}
        {!emails.length && <p className="text-sm text-stone-500">No emails yet. Approve or decline a swap to see one.</p>}
      </div>
    </>
  );
}
