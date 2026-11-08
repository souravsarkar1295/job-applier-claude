"use client";
import { useEffect, useState } from "react";
import { browserClient } from "@/lib/supabase/clients";

export default function Login() {
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">("idle");
  const [msg, setMsg] = useState("");
  const [denied, setDenied] = useState(false);
  const [linkError, setLinkError] = useState(false);
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    setDenied(p.has("denied")); setLinkError(p.has("error"));
  }, []);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setState("sending");
    const { error } = await browserClient().auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: `${window.location.origin}/auth/callback` },
    });
    if (error) { setState("error"); setMsg(error.message); } else setState("sent");
  }

  return (
    <main className="login">
      <form onSubmit={send} className="panel">
        <h1>PM Job Board</h1>
        {denied && <p className="t2">That account doesn&apos;t have access. Sign in with the owner&apos;s email.</p>}
        {linkError && <p className="t2">That sign-in link has expired or was already used. Request a new one.</p>}
        {state === "sent" ? (
          <p>Check your inbox at <b>{email}</b> and open the sign-in link on this device.</p>
        ) : (
          <>
            <label htmlFor="email" className="label">Email</label>
            <input id="email" type="email" required autoComplete="email" value={email}
              onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
            <button className="btn primary" disabled={state === "sending"}>
              {state === "sending" ? "Sending link…" : "Email me a sign-in link"}
            </button>
            {state === "error" && <p className="t2">Couldn&apos;t send the link: {msg}</p>}
          </>
        )}
      </form>
    </main>
  );
}
