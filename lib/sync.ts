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
  await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "push-day", sync_token: syncToken, ...data }),
  })
}

export async function pushMeta(syncToken: string, meta: SyncMeta): Promise<void> {
  await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "push-meta", sync_token: syncToken, ...meta }),
  })
}

export async function pullAll(syncToken: string): Promise<{ days: SyncDayData[]; meta: SyncMeta | null }> {
  const res = await fetch("/api/sync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "pull-all", sync_token: syncToken }),
  })
  return res.json()
}
