import { createClient } from "@supabase/supabase-js"
import { NextResponse } from "next/server"

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

export async function POST(req: Request) {
  const body = await req.json()
  const { action, sync_token, ...data } = body

  if (!sync_token) {
    return NextResponse.json({ error: "missing sync_token" }, { status: 400 })
  }

  if (action === "push-day") {
    const { error } = await supabase.from("day_data").upsert(
      {
        sync_token,
        date: data.date,
        brain_dump: data.brain_dump,
        items: data.items,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sync_token,date" }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === "push-meta") {
    const { error } = await supabase.from("user_meta").upsert(
      {
        sync_token,
        current_streak: data.current_streak,
        last_active_date: data.last_active_date,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "sync_token" }
    )
    if (error) return NextResponse.json({ error: error.message }, { status: 500 })
    return NextResponse.json({ ok: true })
  }

  if (action === "pull-all") {
    const [daysResult, metaResult] = await Promise.all([
      supabase.from("day_data").select("*").eq("sync_token", sync_token),
      supabase.from("user_meta").select("*").eq("sync_token", sync_token).maybeSingle(),
    ])

    const days = (daysResult.data ?? []).map((row) => ({
      date: row.date,
      brain_dump: row.brain_dump ?? "",
      items: row.items ?? [],
    }))

    const meta = metaResult.data
      ? {
          current_streak: metaResult.data.current_streak ?? 0,
          last_active_date: metaResult.data.last_active_date ?? null,
        }
      : null

    return NextResponse.json({ days, meta })
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 })
}
