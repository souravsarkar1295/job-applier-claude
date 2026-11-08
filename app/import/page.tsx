"use client";
import { useState } from "react";
import Link from "next/link";

export default function ImportPage() {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">("idle");
  const [msg, setMsg] = useState("");

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0];
    if (!f) return;
    setState("busy"); setMsg("");
    try {
      const text = await f.text();
      const res = await fetch("/api/import", { method: "POST", headers: { "content-type": "application/json" }, body: text });
      const out = await res.json();
      if (!res.ok) throw new Error(out.error || res.statusText);
      setState("done"); setMsg(`Imported ${out.jobs} roles and ${out.companies} companies.`);
    } catch (err) {
      setState("error"); setMsg(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <main className="login">
      <div className="panel">
        <h1>Import from Google Sheet</h1>
        <p className="t2">Choose the job_board_snapshot.json file exported from your Sheet. Running it again updates rows instead of duplicating them, and never touches what you've marked applied or saved.</p>
        <label className="btn primary" htmlFor="file">{state === "busy" ? "Importing…" : "Choose snapshot file"}</label>
        <input id="file" type="file" accept="application/json,.json" onChange={onFile} hidden disabled={state === "busy"} />
        {msg && <p className={state === "error" ? "t2" : ""}>{state === "error" ? "Import failed: " : ""}{msg}</p>}
        {state === "done" && <Link className="btn" href="/">Open the board</Link>}
      </div>
    </main>
  );
}
