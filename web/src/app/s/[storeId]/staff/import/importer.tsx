"use client";

import Papa from "papaparse";
import { useState, useTransition } from "react";
import * as XLSX from "xlsx";
import { guessMapping, IMPORT_FIELDS, type ImportField } from "@/lib/import-parse";
import { previewImport, runImport, type PreviewRow } from "./actions";

type Row = Record<string, unknown>;

const SAMPLE = `Name,Role,Start date,Contracted hours,Max hours,Under 18,Email,Mon,Tue,Wed,Thu,Fri,Sat,Sun
Jamie Fox,Server,14/03/2024,24,32,no,jamie@example.com,any,any,off,16:00-23:00,16:00-23:00,any,off
Rosa Diaz,Cook,02/09/2026,30,40,no,,10-16,10-16,10-16,off,any,any,any`;

export function Importer({ storeId }: { storeId: string }) {
  const [rows, setRows] = useState<Row[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [mapping, setMapping] = useState<Partial<Record<ImportField, string>>>({});
  const [preview, setPreview] = useState<PreviewRow[] | null>(null);
  const [defaultAny, setDefaultAny] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pins, setPins] = useState<{ name: string; pin: string }[] | null>(null);
  const [pending, start] = useTransition();

  function load(data: Row[]) {
    const hs = data.length ? Object.keys(data[0]) : [];
    setRows(data);
    setHeaders(hs);
    setMapping(guessMapping(hs));
    setPreview(null);
    setPins(null);
    setError(data.length ? null : "That file has no rows.");
  }

  async function onFile(f: File) {
    setError(null);
    if (/\.(xlsx|xls|ods)$/i.test(f.name)) {
      const wb = XLSX.read(await f.arrayBuffer(), { cellDates: true });
      load(XLSX.utils.sheet_to_json<Row>(wb.Sheets[wb.SheetNames[0]], { defval: "", raw: true }));
    } else {
      const parsed = Papa.parse<Row>(await f.text(), { header: true, skipEmptyLines: true });
      load(parsed.data);
    }
  }

  const check = () =>
    start(async () => {
      const r = await previewImport(storeId, rows, mapping);
      if ("error" in r) setError(r.error ?? null);
      else {
        setError(null);
        setPreview(r.rows);
      }
    });

  const save = () =>
    start(async () => {
      const r = await runImport(storeId, rows, mapping, defaultAny);
      if ("error" in r) setError(r.error ?? null);
      else {
        setPins(r.pins);
        setPreview(null);
        setRows([]);
      }
    });

  if (pins) {
    const csv = "Name,PIN\n" + pins.map((p) => `"${p.name}",${p.pin}`).join("\n");
    return (
      <div className="card">
        <h2 className="font-semibold">Imported {pins.length} staff</h2>
        <p className="mb-3 text-sm text-stone-600">Hand each person their PIN. PINs aren&apos;t stored in readable form, so download this list now.</p>
        <a className="btn-primary" href={`data:text/csv;charset=utf-8,${encodeURIComponent(csv)}`} download="staff-pins.csv">Download PINs (CSV)</a>
        <ul className="mt-4 grid grid-cols-2 gap-1 text-sm sm:grid-cols-3">
          {pins.map((p) => <li key={p.name}>{p.name}: <span className="font-mono">{p.pin}</span></li>)}
        </ul>
      </div>
    );
  }

  const bad = preview?.filter((r) => !r.ok).length ?? 0;
  return (
    <div className="space-y-6">
      <section className="card">
        <h2 className="mb-2 font-semibold">1. Choose a file</h2>
        <input type="file" accept=".csv,.xlsx,.xls,.ods,text/csv" onChange={(e) => e.target.files?.[0] && onFile(e.target.files[0])} className="text-sm" />
        <p className="mt-2 text-xs text-stone-500">
          CSV or Excel, one row per person. Staff exports from Deputy, RotaCloud, When I Work or a payroll system are recognised. Availability columns per day accept “any”, “off”, or times like “16:00-23:00” or “10-4pm, 6pm-11pm”.{" "}
          <a className="underline" href={`data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE)}`} download="staff-template.csv">Download a template</a>
        </p>
      </section>

      {rows.length > 0 && (
        <section className="card">
          <h2 className="mb-1 font-semibold">2. Match your columns</h2>
          <p className="mb-3 text-sm text-stone-600">{rows.length} rows found. We guessed the matches; change any that are wrong.</p>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {IMPORT_FIELDS.map(([field, label, required]) => (
              <div key={field}>
                <label className="label">{label}{required && " *"}</label>
                <select className="input" value={mapping[field] ?? ""} onChange={(e) => setMapping({ ...mapping, [field]: e.target.value || undefined })}>
                  <option value="">— not in file —</option>
                  {headers.map((h) => <option key={h} value={h}>{h}</option>)}
                </select>
              </div>
            ))}
          </div>
          <label className="mt-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={defaultAny} onChange={(e) => setDefaultAny(e.target.checked)} /> If the file has no availability columns, mark everyone as available any time (they can change it later)
          </label>
          <button className="btn-primary mt-4" onClick={check} disabled={pending}>{pending ? "Checking…" : "Preview"}</button>
        </section>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}

      {preview && (
        <section className="card overflow-x-auto">
          <h2 className="mb-1 font-semibold">3. Check and import</h2>
          <p className="mb-3 text-sm text-stone-600">{bad ? `${bad} row(s) need fixing in the file before you can import.` : "Everything looks good."}</p>
          <table className="w-full min-w-[640px]">
            <thead>
              <tr>
                <th className="th">Row</th><th className="th">Name</th><th className="th">Role</th><th className="th">Start</th><th className="th">Hours</th><th className="th">U18</th><th className="th">Availability</th><th className="th">Problems</th>
              </tr>
            </thead>
            <tbody>
              {preview.map((r) => (
                <tr key={r.line} className={r.ok ? "" : "bg-red-50"}>
                  <td className="td text-stone-400">{r.line}</td>
                  <td className="td">{r.name}</td>
                  <td className="td">{r.role}</td>
                  <td className="td">{r.startDate}</td>
                  <td className="td">{r.contractedHours}/{r.maxHoursPerWeek}</td>
                  <td className="td">{r.isUnder18 ? "Yes" : ""}</td>
                  <td className="td text-xs">{r.availability ? Object.entries(r.availability).filter(([, w]) => w.length).map(([d]) => d).join(" ") || "none" : defaultAny ? "any (default)" : "—"}</td>
                  <td className="td text-xs text-red-700">{r.errors.join("; ")}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <button className="btn-primary mt-4" onClick={save} disabled={pending || bad > 0}>{pending ? "Importing…" : `Import ${preview.length} staff`}</button>
        </section>
      )}
    </div>
  );
}
