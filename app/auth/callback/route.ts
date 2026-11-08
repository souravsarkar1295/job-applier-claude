import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { serverClient } from "@/lib/supabase/clients";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  if (code) {
    const supabase = serverClient(await cookies());
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) return NextResponse.redirect(new URL("/login?error=link", url.origin));
  }
  return NextResponse.redirect(new URL("/", url.origin));
}
