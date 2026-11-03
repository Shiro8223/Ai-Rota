"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

export function PrintButton() {
  return (
    <button className="btn-secondary no-print" onClick={() => window.print()}>
      Print
    </button>
  );
}

/** Everyone, or one job role's people. */
export function RoleSelect({ roles, value }: { roles: { id: string; name: string }[]; value: string }) {
  const router = useRouter();
  const path = usePathname();
  const sp = useSearchParams();
  return (
    <label className="no-print flex items-center gap-2 text-sm">
      <span className="text-stone-600">Print for</span>
      <select
        className="input w-auto py-1.5"
        value={value}
        onChange={(e) => {
          const q = new URLSearchParams(sp.toString());
          if (e.target.value) q.set("role", e.target.value);
          else q.delete("role");
          router.replace(`${path}?${q.toString()}`);
        }}
      >
        <option value="">Everyone</option>
        {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </select>
    </label>
  );
}
