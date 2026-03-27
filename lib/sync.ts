import { supabase } from "./supabase"

export interface SyncDayData {
  date: string
  brain_dump: string
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  items: any[]
}

export interface SyncMeta {
  current_streak: number
  last_active_date: string | null
}

export async function pushDay(syncToken: string, data: SyncDayData): Promise<void> {
  await supabase.from("day_data").upsert(
    {
      sync_token: syncToken,
      date: data.date,
      brain_dump: data.brain_dump,
      items: data.items,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "sync_token,date" }
  )
}

export async function pushMeta(syncToken: string, meta: SyncMeta): Promise<void> {
  await supabase.from("user_meta").upsert(
    {
      sync_token: syncToken,
      current_streak: meta.current_streak,
      last_active_date: meta.last_active_date,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "sync_token" }
  )
}

export async function pullAll(syncToken: string): Promise<{
  days: SyncDayData[]
  meta: SyncMeta | null
}> {
  const [daysResult, metaResult] = await Promise.all([
    supabase.from("day_data").select("*").eq("sync_token", syncToken),
    supabase.from("user_meta").select("*").eq("sync_token", syncToken).maybeSingle(),
  ])

  const days: SyncDayData[] = (daysResult.data ?? []).map((row) => ({
    date: row.date,
    brain_dump: row.brain_dump ?? "",
    items: row.items ?? [],
  }))

  const meta: SyncMeta | null = metaResult.data
    ? {
        current_streak: metaResult.data.current_streak ?? 0,
        last_active_date: metaResult.data.last_active_date ?? null,
      }
    : null

  return { days, meta }
}
