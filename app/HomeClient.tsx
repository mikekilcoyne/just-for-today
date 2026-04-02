"use client"

import { useState, useEffect, useRef } from "react"
import confetti from "canvas-confetti"
import { pushDay, pushMeta, pullAll } from "@/lib/sync"

function fireBalloons() {
  const colors = ["#ff6b6b", "#ffd93d", "#6bcb77", "#4d96ff", "#ff922b", "#cc5de8", "#f06595"]
  confetti({
    particleCount: 70,
    angle: 90,
    spread: 75,
    origin: { x: 0.5, y: 1 },
    gravity: -0.9,
    ticks: 500,
    shapes: ["circle"],
    colors,
    scalar: 2.2,
    drift: 0.4,
  })
}

// ─── Types ────────────────────────────────────────────────────────────────────

type Priority = "today" | "week" | "later" | "unassigned"

interface Item {
  id: string
  text: string
  priority: Priority
  status: "active" | "done" | "archived"
  created_at: string
  type?: "event" // calendar events parsed from day headers
  notes?: string
  links?: string[]
  project?: string
  focus_seconds?: number
  last_focused_at?: string
}

interface DayData {
  date: string
  brain_dump: string
  items: Item[]
}

interface AppMeta {
  current_streak: number
  last_active_date: string | null
}

interface FocusSession {
  date: string
  itemId: string
  startedAt: string
  elapsedSeconds: number
  lastTickedAt: string
}

interface ProjectEntry {
  date: string
  item: Item
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "jft2-"
const META_KEY = "jft2-meta"
const FOCUS_SESSION_KEY = "jft2-focus-session"
const DAY_ABBREVS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]
const COMMON_PROJECTS = ["Just For Today", "Breakfast Clubbing", "YSJ site"]
const FOCUS_MAX_TICK_GAP_MS = 90_000
const FOCUS_IDLE_THRESHOLD_MS = 5 * 60_000
const COMMON_PROJECT_ALIASES: Record<string, string[]> = {
  "Just For Today": ["just for today", "jft"],
  "Breakfast Clubbing": ["breakfast clubbing", "breakfast club"],
  "YSJ site": ["ysj site", "ysj"],
}

interface IdleDetectorLike extends EventTarget {
  readonly userState: "active" | "idle" | null
  readonly screenState: "locked" | "unlocked" | null
  start(options?: { threshold?: number; signal?: AbortSignal }): Promise<void>
}

interface IdleDetectorStatic {
  new (): IdleDetectorLike
  requestPermission(): Promise<"granted" | "denied">
}

function makeId() {
  const cryptoApi = globalThis.crypto
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") return cryptoApi.randomUUID()
  return `jft-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function safeStorageGet(key: string) {
  if (typeof window === "undefined") return null
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function safeStorageSet(key: string, value: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.setItem(key, value)
  } catch {}
}

function safeStorageRemove(key: string) {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(key)
  } catch {}
}

function safeStorageKeys() {
  if (typeof window === "undefined") return []
  try {
    return Object.keys(window.localStorage)
  } catch {
    return []
  }
}

function getUrlSyncToken() {
  if (typeof window === "undefined") return null
  try {
    const url = new URL(window.location.href)
    const token = url.searchParams.get("syncToken") ?? url.searchParams.get("token")
    return token?.trim() ? token.trim() : null
  } catch {
    return null
  }
}

function clearUrlSyncToken() {
  if (typeof window === "undefined") return
  try {
    const url = new URL(window.location.href)
    if (!url.searchParams.has("syncToken") && !url.searchParams.has("token")) return
    url.searchParams.delete("syncToken")
    url.searchParams.delete("token")
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`)
  } catch {}
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function normalizePriority(value: unknown): Priority {
  if (value === "today" || value === "week" || value === "later" || value === "unassigned") return value
  return "unassigned"
}

function normalizeStatus(value: unknown): Item["status"] {
  if (value === "done" || value === "archived" || value === "active") return value
  return "active"
}

function normalizeStringList(value: unknown) {
  if (!Array.isArray(value)) return undefined
  const list = value.filter((entry): entry is string => typeof entry === "string").map((entry) => entry.trim()).filter(Boolean)
  return list.length > 0 ? list : undefined
}

function normalizeItem(value: unknown): Item | null {
  if (!isRecord(value)) return null
  const text = typeof value.text === "string" ? value.text.trim() : ""
  if (!text) return null

  const project = typeof value.project === "string" ? normalizeProjectName(value.project) : ""
  const focusSeconds = typeof value.focus_seconds === "number" && Number.isFinite(value.focus_seconds)
    ? Math.max(0, Math.floor(value.focus_seconds))
    : undefined

  return {
    id: typeof value.id === "string" && value.id.trim() ? value.id : makeId(),
    text,
    priority: normalizePriority(value.priority),
    status: normalizeStatus(value.status),
    created_at: typeof value.created_at === "string" && value.created_at ? value.created_at : new Date().toISOString(),
    type: value.type === "event" ? "event" : undefined,
    notes: typeof value.notes === "string" && value.notes.trim() ? value.notes.trim() : undefined,
    links: normalizeStringList(value.links),
    project: project || undefined,
    focus_seconds: focusSeconds,
    last_focused_at: typeof value.last_focused_at === "string" && value.last_focused_at ? value.last_focused_at : undefined,
  }
}

function normalizeDayData(value: unknown, fallbackDate?: string): DayData | null {
  if (!isRecord(value)) return null
  const date = typeof value.date === "string" && value.date ? value.date : fallbackDate
  if (!date) return null

  return {
    date,
    brain_dump: typeof value.brain_dump === "string" ? value.brain_dump : "",
    items: Array.isArray(value.items) ? value.items.map(normalizeItem).filter((item): item is Item => Boolean(item)) : [],
  }
}

function normalizeMeta(value: unknown): AppMeta {
  if (!isRecord(value)) return { current_streak: 0, last_active_date: null }
  const currentStreak = typeof value.current_streak === "number" && Number.isFinite(value.current_streak)
    ? Math.max(0, Math.floor(value.current_streak))
    : 0
  const lastActiveDate = typeof value.last_active_date === "string" && value.last_active_date ? value.last_active_date : null
  return { current_streak: currentStreak, last_active_date: lastActiveDate }
}

function normalizeFocusSession(value: unknown): FocusSession | null {
  if (!isRecord(value)) return null
  if (
    typeof value.date !== "string" ||
    !value.date ||
    typeof value.itemId !== "string" ||
    !value.itemId ||
    typeof value.startedAt !== "string" ||
    !value.startedAt
  ) {
    return null
  }
  const elapsedSeconds = typeof value.elapsedSeconds === "number" && Number.isFinite(value.elapsedSeconds)
    ? Math.max(0, Math.floor(value.elapsedSeconds))
    : 0
  const lastTickedAt = typeof value.lastTickedAt === "string" && value.lastTickedAt
    ? value.lastTickedAt
    : value.startedAt
  return {
    date: value.date,
    itemId: value.itemId,
    startedAt: value.startedAt,
    elapsedSeconds,
    lastTickedAt,
  }
}

// ─── Date Helpers ─────────────────────────────────────────────────────────────

function formatDateStr(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`
}

function getTodayStr(): string {
  return formatDateStr(new Date())
}

function formatDisplayDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  return new Date(y, m - 1, d).toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  })
}

function getPrevDateStr(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  date.setDate(date.getDate() - 1)
  return formatDateStr(date)
}

function getWeekDays(dateStr: string): string[] {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, m - 1, d)
  const dow = date.getDay() // 0 = Sunday
  const monday = new Date(date)
  monday.setDate(date.getDate() - (dow === 0 ? 6 : dow - 1))
  return Array.from({ length: 7 }, (_, i) => {
    const day = new Date(monday)
    day.setDate(monday.getDate() + i)
    return formatDateStr(day)
  })
}

// Maps a day name to its date within the week containing anchorDate
function getDayDateForWeek(dayName: string, anchorDate: string): string {
  const dayMap: Record<string, number> = {
    monday: 1, mon: 1,
    tuesday: 2, tue: 2, tues: 2,
    wednesday: 3, wed: 3, weds: 3,
    thursday: 4, thu: 4, thur: 4, thurs: 4,
    friday: 5, fri: 5,
    saturday: 6, sat: 6,
    sunday: 0, sun: 0,
  }
  const targetDow = dayMap[dayName.toLowerCase().trim()]
  if (targetDow === undefined) return anchorDate
  const [y, m, d] = anchorDate.split("-").map(Number)
  const anchor = new Date(y, m - 1, d)
  const anchorDow = anchor.getDay()
  const monday = new Date(anchor)
  monday.setDate(anchor.getDate() - (anchorDow === 0 ? 6 : anchorDow - 1))
  const offset = targetDow === 0 ? 6 : targetDow - 1
  const target = new Date(monday)
  target.setDate(monday.getDate() + offset)
  return formatDateStr(target)
}

// ─── Storage Helpers ──────────────────────────────────────────────────────────

function loadDay(date: string): DayData | null {
  try {
    const raw = safeStorageGet(STORAGE_PREFIX + date)
    return raw ? normalizeDayData(JSON.parse(raw), date) : null
  } catch {
    return null
  }
}

function saveDay(data: DayData): void {
  const normalized = normalizeDayData(data, data.date)
  if (!normalized) return
  safeStorageSet(STORAGE_PREFIX + normalized.date, JSON.stringify(normalized))
}

function loadAllDays(): DayData[] {
  const keys = safeStorageKeys()
    .filter((key) => key.startsWith(STORAGE_PREFIX))
    .sort()

  return keys
    .map((key) => {
      try {
        return normalizeDayData(JSON.parse(safeStorageGet(key) ?? ""))
      } catch {
        return null
      }
    })
    .filter((day): day is DayData => Boolean(day))
}

function loadMeta(): AppMeta {
  try {
    const raw = safeStorageGet(META_KEY)
    if (raw) return normalizeMeta(JSON.parse(raw))
  } catch {}
  return { current_streak: 0, last_active_date: null }
}

function loadFocusSession(): FocusSession | null {
  try {
    const raw = safeStorageGet(FOCUS_SESSION_KEY)
    return raw ? normalizeFocusSession(JSON.parse(raw)) : null
  } catch {
    return null
  }
}

function saveFocusSession(session: FocusSession | null) {
  if (!session) {
    safeStorageRemove(FOCUS_SESSION_KEY)
    return
  }
  safeStorageSet(FOCUS_SESSION_KEY, JSON.stringify(session))
}

function normalizeProjectName(value: string) {
  return value.replace(/\s+/g, " ").trim()
}

function formatDurationCompact(seconds: number) {
  if (seconds <= 0) return "0m"
  if (seconds < 60) return `${seconds}s`
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  if (hours === 0) return `${minutes}m`
  if (minutes === 0) return `${hours}h`
  return `${hours}h ${minutes}m`
}

function formatDurationClock(seconds: number) {
  const total = Math.max(0, seconds)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = total % 60
  if (hours > 0) return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
  return `${String(minutes).padStart(2, "0")}:${String(secs).padStart(2, "0")}`
}

function getIdleDetectorApi(): IdleDetectorStatic | null {
  if (typeof window === "undefined") return null
  const maybeIdleDetector = (window as Window & { IdleDetector?: IdleDetectorStatic }).IdleDetector
  return typeof maybeIdleDetector === "function" ? maybeIdleDetector : null
}

function getFocusTimestamp(value: string, fallback = Date.now()) {
  const timestamp = new Date(value).getTime()
  return Number.isFinite(timestamp) ? timestamp : fallback
}

function getFocusGapMs(session: FocusSession, now = Date.now()) {
  return Math.max(0, now - getFocusTimestamp(session.lastTickedAt, now))
}

function advanceFocusSession(session: FocusSession, now = Date.now()): FocusSession {
  const gapMs = getFocusGapMs(session, now)
  const addedSeconds = gapMs > FOCUS_MAX_TICK_GAP_MS ? 0 : Math.floor(gapMs / 1000)
  return {
    ...session,
    elapsedSeconds: session.elapsedSeconds + Math.max(0, addedSeconds),
    lastTickedAt: new Date(now).toISOString(),
  }
}

function getElapsedFocusSeconds(session: FocusSession) {
  return Math.max(0, session.elapsedSeconds)
}

function collectProjectNames(days: DayData[]) {
  const names = new Set(COMMON_PROJECTS)
  days.forEach((day) => {
    ;(day.items ?? []).forEach((item) => {
      const project = normalizeProjectName(item.project ?? "")
      if (project) names.add(project)
    })
  })
  return [...names].sort((a, b) => a.localeCompare(b))
}

function inferProjectSuggestions(item: Item, projectNames: string[]) {
  const haystack = `${item.text} ${item.notes ?? ""}`.toLowerCase()
  const suggestions = new Set<string>()

  projectNames.forEach((name) => {
    if (item.project === name) suggestions.add(name)
  })

  Object.entries(COMMON_PROJECT_ALIASES).forEach(([project, aliases]) => {
    if (aliases.some((alias) => haystack.includes(alias))) suggestions.add(project)
  })

  projectNames.forEach((name) => {
    const lowered = name.toLowerCase()
    if (lowered.length >= 4 && haystack.includes(lowered)) suggestions.add(name)
  })

  return [...suggestions].sort((a, b) => a.localeCompare(b))
}

function getProjectEntries(days: DayData[], project: string) {
  const normalized = normalizeProjectName(project).toLowerCase()
  return days
    .flatMap((day) =>
      day.items
        .filter((item) => normalizeProjectName(item.project ?? "").toLowerCase() === normalized)
        .map((item) => ({ date: day.date, item }))
    )
    .sort((a, b) => {
      if (a.date !== b.date) return b.date.localeCompare(a.date)
      return a.item.created_at.localeCompare(b.item.created_at)
    })
}

function saveMeta(meta: AppMeta): void {
  safeStorageSet(META_KEY, JSON.stringify(meta))
}

function getRecentDays(n: number, today: string): DayData[] {
  const result: DayData[] = []
  for (let i = 0; i < n; i++) {
    const [y, m, d] = today.split("-").map(Number)
    const date = new Date(y, m - 1, d)
    date.setDate(date.getDate() - i)
    const data = loadDay(formatDateStr(date))
    if (data) result.push(data)
  }
  return result
}

// ─── Streak ───────────────────────────────────────────────────────────────────

function computeStreak(meta: AppMeta, today: string): AppMeta {
  if (meta.last_active_date === today) return meta
  const yesterday = getPrevDateStr(today)
  if (meta.last_active_date === yesterday) {
    return { current_streak: meta.current_streak + 1, last_active_date: today }
  }
  return { current_streak: 1, last_active_date: today }
}

// ─── Parse Brain Dump ─────────────────────────────────────────────────────────

function isIntentionPhrase(text: string): boolean {
  return (
    /^(today[,\s]+)?i\s+(want|need|would like|hope|plan|intend)\s+to\b/i.test(text) ||
    /^(today[,\s]*)?i['']?m\s+(going to|planning to|hoping to)\b/i.test(text) ||
    /^(my\s+)?goals?\s*(for\s+today)?\s*:/i.test(text)
  )
}

// Parses brain dump text. Lines under a day header (e.g. "Monday") become
// events assigned to that day. Everything else goes to anchorDate as tasks.
function parseBrainDump(text: string, anchorDate: string): {
  items: Item[]
  otherDays: Record<string, Item[]>
} {
  const now = new Date().toISOString()
  const dayHeaderRe = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|tues|wed|weds|thu|thur|thurs|fri|sat|sun)[:\s\-–—]*$/i
  const calendarHeaderRe = /^(calendar\s+(?:week|events?)|week\s+at\s+a\s+glance)[:\s\-–—]*$/i
  const sectionHeaderRe = /^[a-z][a-z0-9 '&/+]{1,30}:\s*$/i
  const stripBullet = (s: string) => s.replace(/^[\s\u2022\u2023\u25E6\u2043\-*\d.)]+/, "").trim()
  const stripEventBullet = (s: string) => s.replace(/^[\s\u2022\u2023\u25E6\u2043\-*]+/, "").trim()
  const looksLikeCalendarEvent = (s: string) =>
    /^(\d{1,2}(?::\d{2})?\s*[-–—]\s*\d{1,2}(?::\d{2})?|\d{3,4}\s*[-–—])/.test(s) ||
    /(?:^|[\s(])\d{1,4}(?::\d{2})?\s*(?:am|pm)\b/i.test(s) ||
    /(?:^|[\s(])\d{3,4}\b/.test(s) ||
    /\b\d{1,2}\s*o[‘’]?clock\b/i.test(s) ||
    /(?:@|at)\s*\d{1,2}(?::\d{2})?\b/i.test(s) ||
    /(?:@|at)\s*\d{3,4}\b/i.test(s)
  const weekStartDate = getWeekDays(anchorDate)[0]

  function makeItem(text: string, isEvent: boolean): Item {
    return {
      id: makeId(),
      text,
      priority: "unassigned",
      status: "active",
      created_at: now,
      type: isEvent ? "event" : undefined,
    }
  }

  let currentEventDate: string | null = null
  let inCalendarSection = false
  const items: Item[] = []
  const otherDays: Record<string, Item[]> = {}

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    if (calendarHeaderRe.test(trimmed)) {
      inCalendarSection = true
      currentEventDate = weekStartDate
      continue
    }

    const dayMatch = trimmed.match(dayHeaderRe)
    if (dayMatch) {
      currentEventDate = getDayDateForWeek(dayMatch[1], anchorDate)
      inCalendarSection = true
      continue
    }

    if (inCalendarSection && sectionHeaderRe.test(trimmed)) {
      inCalendarSection = false
      currentEventDate = null
      continue
    }

    const eventText = stripEventBullet(trimmed)
    const itemText = stripBullet(trimmed)
    if (eventText.length < 2 && itemText.length < 2) continue
    if (inCalendarSection && currentEventDate) {
      if (!looksLikeCalendarEvent(eventText)) continue
      const item = makeItem(eventText, true)
      if (currentEventDate === anchorDate) items.push(item)
      else otherDays[currentEventDate] = [...(otherDays[currentEventDate] ?? []), item]
      continue
    }
    if (itemText.length < 2) continue
    if (isIntentionPhrase(itemText)) continue
    if (looksLikeCalendarEvent(itemText)) {
      items.push(makeItem(itemText, true))
      continue
    }
    items.push(makeItem(itemText, false))
  }

  return { items, otherDays }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomeClient() {
  const today = getTodayStr()

  const [selectedDate, setSelectedDate] = useState(today)
  const [view, setView] = useState<"dump" | "triage" | "project">("dump")
  const [rawDump, setRawDump] = useState("")
  const [dayData, setDayData] = useState<DayData | null>(null)
  const [meta, setMeta] = useState<AppMeta>({ current_streak: 0, last_active_date: null })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [syncToken, setSyncToken] = useState<string | null>(null)
  const [syncStatus, setSyncStatus] = useState<"idle" | "syncing" | "synced" | "error">("idle")
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null)
  const [selectedProject, setSelectedProject] = useState<string | null>(null)
  const [activeFocus, setActiveFocus] = useState<FocusSession | null>(() => loadFocusSession())
  const [idleDetectionPermission, setIdleDetectionPermission] = useState<"unknown" | "granted" | "denied" | "unsupported">(() =>
    getIdleDetectorApi() ? "unknown" : "unsupported"
  )
  const activeFocusRef = useRef<FocusSession | null>(activeFocus)
  const idlePermissionRequestedRef = useRef(false)

  // Load meta once
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMeta(loadMeta())
  }, [])

  // Init sync token + pull remote data on mount
  useEffect(() => {
    const urlToken = getUrlSyncToken()
    const stored = safeStorageGet("jft-sync-token")
    const token = urlToken ?? stored ?? makeId()
    if (urlToken) clearUrlSyncToken()
    if (token !== stored) safeStorageSet("jft-sync-token", token)
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSyncToken(token)
    setSyncStatus("syncing")

    pullAll(token)
      .then(({ days, meta: remoteMeta }) => {
        days.forEach((remoteRaw) => {
          const remote = normalizeDayData(remoteRaw)
          if (!remote) return
          const local = loadDay(remote.date)
          if (!local || remote.items.length >= local.items.length) {
            safeStorageSet(`jft2-${remote.date}`, JSON.stringify(remote))
          }
        })
        if (remoteMeta) {
          const localMeta = loadMeta()
          const normalizedRemoteMeta = normalizeMeta(remoteMeta)
          if (normalizedRemoteMeta.current_streak >= localMeta.current_streak) {
            saveMeta(normalizedRemoteMeta)
            setMeta(normalizedRemoteMeta)
          }
        }
        // Reload current day in case remote data changed it
        const fresh = loadDay(getTodayStr())
        if (fresh) {
          setDayData(fresh)
          setRawDump(fresh.brain_dump)
          setView("triage")
        }
        setSyncStatus("synced")
      })
      .catch(() => setSyncStatus("error"))
  }, [])

  // Load data for selected date
  useEffect(() => {
    const data = loadDay(selectedDate)
    if (data) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDayData(data)
      setRawDump(data.brain_dump)
      setView("triage")
    } else {
      setDayData(null)
      setRawDump("")
      setView("dump")
    }
  }, [selectedDate])

  useEffect(() => {
    saveFocusSession(activeFocus)
  }, [activeFocus])

  useEffect(() => {
    activeFocusRef.current = activeFocus
  }, [activeFocus])

  useEffect(() => {
    if (!activeFocus) return
    const tickFocus = () => {
      const session = activeFocusRef.current
      if (!session) return
      const now = Date.now()
      if (getFocusGapMs(session, now) > FOCUS_MAX_TICK_GAP_MS) {
        finalizeFocusSession(session)
        clearActiveFocus()
        return
      }
      const advanced = advanceFocusSession(session, now)
      activeFocusRef.current = advanced
      setActiveFocus(advanced)
    }

    const interval = window.setInterval(tickFocus, 1000)
    return () => window.clearInterval(interval)
  }, [activeFocus?.date, activeFocus?.itemId, activeFocus])

  useEffect(() => {
    if (!activeFocus || idleDetectionPermission !== "granted") return
    const IdleDetectorApi = getIdleDetectorApi()
    if (!IdleDetectorApi) return

    const abortController = new AbortController()
    const detector = new IdleDetectorApi()
    const pauseForIdle = () => {
      const session = activeFocusRef.current
      if (!session) return
      finalizeFocusSession(session)
      clearActiveFocus()
    }

    detector.addEventListener("change", pauseForIdle)
    detector.start({
      threshold: FOCUS_IDLE_THRESHOLD_MS,
      signal: abortController.signal,
    }).then(() => {
      if (detector.userState === "idle" || detector.screenState === "locked") pauseForIdle()
    }).catch(() => {
      setIdleDetectionPermission("denied")
    })

    return () => {
      abortController.abort()
      detector.removeEventListener("change", pauseForIdle)
    }
  }, [activeFocus?.date, activeFocus?.itemId, activeFocus, idleDetectionPermission])

  // ── Brain dump submit ──

  function handleSubmit() {
    if (!rawDump.trim()) return
    const { items, otherDays } = parseBrainDump(rawDump, selectedDate)

    // Save this day
    const data: DayData = { date: selectedDate, brain_dump: rawDump, items }
    setDayData(data)
    saveDay(data)

    // Distribute calendar events to their respective days
    for (const [date, dayItems] of Object.entries(otherDays)) {
      const existing = loadDay(date) ?? { date, brain_dump: "", items: [] }
      const existingTexts = new Set(existing.items.map((i) => i.text.toLowerCase()))
      const newItems = dayItems.filter((i) => !existingTexts.has(i.text.toLowerCase()))
      if (newItems.length > 0) {
        saveDay({ ...existing, items: [...existing.items, ...newItems] })
      }
    }

    setView("triage")
  }

  // ── Item mutations ──

  function persistDay(data: DayData) {
    saveDay(data)
    if (data.date === selectedDate) setDayData(data)
    if (syncToken) pushDay(syncToken, data).catch(console.error)
  }

  function mutateItems(items: Item[]) {
    if (!dayData) return
    const updated = { ...dayData, items }
    persistDay(updated)
  }

  function mutateStoredDay(date: string, mutator: (data: DayData) => DayData | null) {
    const existing = loadDay(date)
    if (!existing) return
    const updated = mutator(existing)
    if (!updated) return
    persistDay(updated)
  }

  function finalizeFocusSession(session: FocusSession | null) {
    if (!session) return
    const finalizedSession = advanceFocusSession(session)
    const elapsed = getElapsedFocusSeconds(finalizedSession)
    if (elapsed <= 0) return

    mutateStoredDay(finalizedSession.date, (data) => {
      let changed = false
      const items = data.items.map((item) => {
        if (item.id !== finalizedSession.itemId) return item
        changed = true
        return {
          ...item,
          focus_seconds: (item.focus_seconds ?? 0) + elapsed,
          last_focused_at: new Date().toISOString(),
        }
      })
      return changed ? { ...data, items } : null
    })
  }

  function clearActiveFocus(closeView = false) {
    setActiveFocus(null)
    if (closeView) setFocusedItemId(null)
  }

  function pauseActiveFocus(closeView = false) {
    const session = activeFocusRef.current
    if (!session) return
    finalizeFocusSession(session)
    clearActiveFocus(closeView)
  }

  async function maybeEnableIdleDetection() {
    const IdleDetectorApi = getIdleDetectorApi()
    if (!IdleDetectorApi) {
      setIdleDetectionPermission("unsupported")
      return
    }
    if (idlePermissionRequestedRef.current) return
    idlePermissionRequestedRef.current = true
    try {
      const permission = await IdleDetectorApi.requestPermission()
      setIdleDetectionPermission(permission === "granted" ? "granted" : "denied")
    } catch {
      setIdleDetectionPermission("denied")
    }
  }

  function startFocus(id: string) {
    if (activeFocus) {
      if (activeFocus.date === selectedDate && activeFocus.itemId === id) {
        setFocusedItemId(id)
        return
      }
      finalizeFocusSession(activeFocus)
    }

    setActiveFocus({
      date: selectedDate,
      itemId: id,
      startedAt: new Date().toISOString(),
      elapsedSeconds: 0,
      lastTickedAt: new Date().toISOString(),
    })
    setFocusedItemId(id)
    void maybeEnableIdleDetection()
  }

  function setPriority(id: string, priority: Priority) {
    if (!dayData) return
    mutateItems(dayData.items.map((i) => (i.id === id ? { ...i, priority } : i)))
  }

  function toggleDone(id: string) {
    if (!dayData) return
    const item = dayData.items.find((i) => i.id === id)
    if (!item) return
    const newStatus: Item["status"] = item.status === "done" ? "active" : "done"
    const justFocused = activeFocus && activeFocus.date === dayData.date && activeFocus.itemId === id
    const elapsed = justFocused ? getElapsedFocusSeconds(advanceFocusSession(activeFocus)) : 0
    const updatedItems = dayData.items.map((i) =>
      i.id === id
        ? {
            ...i,
            status: newStatus,
            focus_seconds: (i.focus_seconds ?? 0) + elapsed,
            last_focused_at: elapsed > 0 ? new Date().toISOString() : i.last_focused_at,
          }
        : i
    )
    if (justFocused) clearActiveFocus(true)
    mutateItems(updatedItems)
    if (newStatus === "done") {
      fireBalloons()
      const newMeta = computeStreak(meta, today)
      if (newMeta !== meta) {
        setMeta(newMeta)
        saveMeta(newMeta)
        if (syncToken) pushMeta(syncToken, newMeta).catch(console.error)
      }
    }
  }

  function editItemText(id: string, text: string) {
    if (!dayData) return
    mutateItems(dayData.items.map((i) => (i.id === id ? { ...i, text } : i)))
  }

  function deleteItem(id: string) {
    if (!dayData) return
    if (activeFocus && activeFocus.date === dayData.date && activeFocus.itemId === id) {
      pauseActiveFocus(true)
    }
    mutateItems(dayData.items.filter((i) => i.id !== id))
  }

  function updateItemDetail(id: string, notes: string, links: string[]) {
    if (!dayData) return
    mutateItems(dayData.items.map((i) => (i.id === id ? { ...i, notes, links } : i)))
  }

  function updateItemProject(id: string, project: string) {
    if (!dayData) return
    const normalized = normalizeProjectName(project)
    mutateItems(dayData.items.map((i) => (i.id === id ? { ...i, project: normalized || undefined } : i)))
  }

  function addItem() {
    if (!dayData) return
    const item: Item = {
      id: makeId(),
      text: "",
      priority: "unassigned",
      status: "active",
      created_at: new Date().toISOString(),
    }
    mutateItems([...dayData.items, item])
    setEditingId(item.id)
  }

  // ── Context data ──

  const recentDays = getRecentDays(7, today)
  const allDays = loadAllDays()
  const projectNames = collectProjectNames(allDays)
  const activeFocusItem = activeFocus ? loadDay(activeFocus.date)?.items.find((item) => item.id === activeFocus.itemId) ?? null : null
  const activeFocusSeconds =
    activeFocus && activeFocusItem
      ? (activeFocusItem.focus_seconds ?? 0) + getElapsedFocusSeconds(activeFocus)
      : 0
  const selectedProjectEntries = selectedProject ? getProjectEntries(allDays, selectedProject) : []
  const recentlyDone = recentDays
    .flatMap((d) => d.items.filter((i) => i.status === "done").map((i) => ({ ...i, date: d.date })))
    .slice(0, 6)
  const stillActive = recentDays
    .filter((d) => d.date !== selectedDate)
    .flatMap((d) =>
      d.items.filter(
        (i) => i.status === "active" && (i.priority === "today" || i.priority === "week")
      ).map((i) => ({ ...i, date: d.date }))
    )
    .slice(0, 5)

  function mutateItemOnDate(date: string, itemId: string, mutator: (item: Item) => Item) {
    mutateStoredDay(date, (data) => ({
      ...data,
      items: data.items.map((item) => (item.id === itemId ? mutator(item) : item)),
    }))
  }

  const weekItems = dayData?.items.filter((i) => i.type !== "event" && i.priority === "week" && i.status === "active") ?? []
  const laterItems = dayData?.items.filter((i) => i.type !== "event" && i.priority === "later" && i.status === "active") ?? []

  return (
    <div className="min-h-screen" style={{ background: "var(--background)" }}>
      {/* ── Header ── */}
      <header
        className="sticky top-0 z-10 border-b"
        style={{
          borderColor: "var(--surface-border)",
          background: "rgba(247, 246, 242, 0.94)",
          backdropFilter: "blur(10px)",
        }}
      >
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center">
          {/* Left: brand + This Week */}
          <div className="flex items-center gap-3 flex-1">
            <span
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: "var(--text-muted)" }}
            >
              Just for Today
            </span>
            {weekItems.length > 0 && (
              <QueueDropdown
                label="This Week"
                items={weekItems}
                onPromote={(id: string) => setPriority(id, "today")}
              />
            )}
            {projectNames.length > 0 && (
              <ProjectsDropdown
                projects={projectNames}
                activeProject={selectedProject}
                onSelect={(project) => {
                  setSelectedProject(project)
                  setView("project")
                }}
              />
            )}
          </div>

          {/* Center: date */}
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {formatDisplayDate(selectedDate)}
          </span>

          {/* Right: Later + streak + sync */}
          <div className="flex items-center gap-2 flex-1 justify-end">
            {laterItems.length > 0 && (
              <QueueDropdown
                label="Later"
                items={laterItems}
                onPromote={(id: string) => setPriority(id, "today")}
              />
            )}
            {meta.current_streak > 0 && (
              <span
                className="text-xs font-bold tabular-nums"
                style={{ color: "#b45309" }}
                title={`${meta.current_streak}-day streak`}
              >
                {meta.current_streak}d
              </span>
            )}
            {syncToken && (
              <SyncIndicator
                status={syncStatus}
                token={syncToken}
                onChangeToken={(t) => {
                  safeStorageSet("jft-sync-token", t)
                  setSyncToken(t)
                  setSyncStatus("syncing")
                  pullAll(t)
                    .then(({ days, meta: remoteMeta }) => {
                      days.forEach((remoteRaw) => {
                        const remote = normalizeDayData(remoteRaw)
                        if (!remote) return
                        safeStorageSet(`jft2-${remote.date}`, JSON.stringify(remote))
                      })
                      if (remoteMeta) {
                        const normalizedRemoteMeta = normalizeMeta(remoteMeta)
                        saveMeta(normalizedRemoteMeta)
                        setMeta(normalizedRemoteMeta)
                      }
                      const fresh = loadDay(selectedDate)
                      if (fresh) { setDayData(fresh); setRawDump(fresh.brain_dump); setView("triage") }
                      setSyncStatus("synced")
                    })
                    .catch(() => setSyncStatus("error"))
                }}
                onPushAll={() => {
                  if (!syncToken) return
                  setSyncStatus("syncing")
                  const keys = safeStorageKeys().filter((k) => k.startsWith("jft2-"))
                  const days = keys
                    .map((k) => {
                      try {
                        return normalizeDayData(JSON.parse(safeStorageGet(k) ?? ""))
                      } catch {
                        return null
                      }
                    })
                    .filter((day): day is DayData => Boolean(day))
                  Promise.all(days.map((d) => pushDay(syncToken, d)))
                    .then(() => pushMeta(syncToken, meta))
                    .then(() => setSyncStatus("synced"))
                    .catch(() => setSyncStatus("error"))
                }}
              />
            )}
          </div>
        </div>
      </header>

      <main className="max-w-2xl mx-auto px-6 pb-24 pt-6">
        {/* ── Week Strip ── */}
        <WeekStrip
          today={today}
          selectedDate={selectedDate}
          onSelect={setSelectedDate}
        />

        {activeFocus && activeFocusItem && !focusedItemId && (
          <ActiveFocusBar
            item={activeFocusItem}
            seconds={activeFocusSeconds}
            onResume={() => {
              setSelectedDate(activeFocus.date)
              setView("triage")
              setFocusedItemId(activeFocus.itemId)
            }}
            onPause={() => pauseActiveFocus()}
            onOpenProject={(project) => {
              setSelectedProject(project)
              setView("project")
            }}
          />
        )}

        {/* ── Brain Dump ── */}
        {view === "dump" && (
          <BrainDumpView
            value={rawDump}
            onChange={setRawDump}
            onSubmit={handleSubmit}
            isToday={selectedDate === today}
          />
        )}

        {/* ── Focus Mode ── */}
        {view === "triage" && dayData && focusedItemId && (() => {
          const focusedItem = dayData.items.find((i) => i.id === focusedItemId)
          return focusedItem ? (
            <FocusView
              item={focusedItem}
              projectOptions={projectNames}
              activeSeconds={activeFocus && activeFocus.date === selectedDate && activeFocus.itemId === focusedItem.id
                ? (focusedItem.focus_seconds ?? 0) + getElapsedFocusSeconds(activeFocus)
                : focusedItem.focus_seconds ?? 0}
              isActive={Boolean(activeFocus && activeFocus.date === selectedDate && activeFocus.itemId === focusedItem.id)}
              onToggleDone={(id) => { toggleDone(id); setTimeout(() => setFocusedItemId(null), 1200) }}
              onUpdateDetail={(notes, links) => updateItemDetail(focusedItem.id, notes, links)}
              onUpdateProject={(project) => updateItemProject(focusedItem.id, project)}
              onToggleFocus={() => {
                if (activeFocus && activeFocus.date === selectedDate && activeFocus.itemId === focusedItem.id) {
                  pauseActiveFocus()
                  return
                }
                startFocus(focusedItem.id)
              }}
              onOpenProject={(project) => {
                setSelectedProject(project)
                setView("project")
              }}
              onExit={() => setFocusedItemId(null)}
            />
          ) : null
        })()}

        {/* ── Project View ── */}
        {view === "project" && selectedProject && (
          <ProjectView
            project={selectedProject}
            entries={selectedProjectEntries}
            onBack={() => setView(dayData ? "triage" : "dump")}
            onOpenDay={(date) => {
              setSelectedDate(date)
              setView("triage")
            }}
          />
        )}

        {/* ── Triage ── */}
        {view === "triage" && dayData && !focusedItemId && (
          <>
            <TriageView
              items={dayData.items}
              editingId={editingId}
              isToday={selectedDate === today}
              onSetPriority={setPriority}
              onToggleDone={toggleDone}
              onEditText={editItemText}
              onDelete={deleteItem}
              onAdd={addItem}
              onEditingIdChange={setEditingId}
              onReDump={() => setView("dump")}
              onUpdateDetail={updateItemDetail}
              onUpdateProject={updateItemProject}
              projectOptions={projectNames}
              onFocus={startFocus}
              onOpenProject={(project) => {
                setSelectedProject(project)
                setView("project")
              }}
            />
            {(recentlyDone.length > 0 || stillActive.length > 0) && (
              <ContextPanel
                done={recentlyDone}
                active={stillActive}
                onLater={(date, id) => mutateItemOnDate(date, id, (item) => ({ ...item, priority: "later" }))}
                onArchive={(date, id) => mutateItemOnDate(date, id, (item) => ({ ...item, status: "archived" }))}
                onComplete={(date, id) => mutateItemOnDate(date, id, (item) => ({ ...item, status: "done" }))}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}

// ─── Week Strip ───────────────────────────────────────────────────────────────

function WeekStrip({
  today,
  selectedDate,
  onSelect,
}: {
  today: string
  selectedDate: string
  onSelect: (date: string) => void
}) {
  const weekDays = getWeekDays(today)

  return (
    <div className="flex gap-1 mb-8">
      {weekDays.map((date, i) => {
        const data = loadDay(date)
        const events = data?.items.filter((item) => item.type === "event") ?? []
        const tasks = data?.items.filter((item) => item.type !== "event" && item.status !== "archived") ?? []
        const doneTasks = tasks.filter((t) => t.status === "done").length
        const isToday = date === today
        const isSelected = date === selectedDate
        const isFuture = date > today
        const isEmpty = events.length === 0 && tasks.length === 0

        const mutedColor = isFuture ? "rgba(120,113,108,0.3)" : "var(--text-muted)"

        return (
          <button
            key={date}
            onClick={() => onSelect(date)}
            className="flex-1 flex flex-col items-center gap-1 py-2.5 rounded-2xl transition-all"
            style={{
              background: isSelected ? "rgba(255,255,255,0.96)" : "transparent",
              border: isSelected
                ? "1px solid var(--surface-border)"
                : "1px solid transparent",
              boxShadow: isSelected ? "var(--shadow-soft)" : "none",
              minWidth: 0,
            }}
          >
            {/* Day label */}
            <span
              className="font-bold tracking-wide uppercase"
              style={{
                fontSize: "0.6rem",
                color: isToday ? "#b45309" : mutedColor,
              }}
            >
              {DAY_ABBREVS[i]}
            </span>

            {/* Event name preview */}
            {events.length > 0 ? (
              <span
                className="w-full text-center truncate px-1 leading-tight"
                style={{ fontSize: "0.6rem", color: "#0369a1" }}
                title={events.map((e) => e.text).join(", ")}
              >
                {events[0].text.length > 9
                  ? events[0].text.slice(0, 8) + "…"
                  : events[0].text}
              </span>
            ) : (
              <span style={{ fontSize: "0.6rem", opacity: 0 }}>·</span>
            )}

            {/* Extra events badge */}
            {events.length > 1 ? (
              <span
                className="font-semibold"
                style={{ fontSize: "0.55rem", color: "#0369a1", opacity: 0.7 }}
              >
                +{events.length - 1}
              </span>
            ) : (
              <span style={{ fontSize: "0.55rem", opacity: 0 }}>·</span>
            )}

            {/* Task count */}
            {tasks.length > 0 ? (
              <span
                className="text-xs font-semibold tabular-nums"
                style={{
                  color:
                    doneTasks === tasks.length
                      ? "#047857"
                      : mutedColor,
                }}
              >
                {doneTasks}/{tasks.length}
              </span>
            ) : isEmpty ? (
              <span style={{ fontSize: "0.65rem", color: "rgba(120,113,108,0.25)" }}>
                —
              </span>
            ) : (
              <span style={{ fontSize: "0.65rem", opacity: 0 }}>·</span>
            )}
          </button>
        )
      })}
    </div>
  )
}

// ─── Brain Dump View ──────────────────────────────────────────────────────────

function BrainDumpView({
  value,
  onChange,
  onSubmit,
  isToday,
}: {
  value: string
  onChange: (v: string) => void
  onSubmit: () => void
  isToday: boolean
}) {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    textareaRef.current?.focus()
  }, [])

  return (
    <div className="space-y-5">
      <div>
        <h1
          className="text-3xl font-black mb-1.5"
          style={{ fontFamily: "var(--font-playfair)" }}
        >
          {isToday ? "What's on your mind?" : "Add to this day"}
        </h1>
        <p className="text-sm" style={{ color: "var(--text-muted)" }}>
          Get it all out — we&apos;ll sort it in a second.
        </p>
      </div>

      <div className="app-card">
        <textarea
          ref={textareaRef}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) onSubmit()
          }}
          placeholder="emails to send, calls to make, stuff moving, things stuck in your head..."
          className="w-full resize-none outline-none text-sm leading-relaxed"
          style={{
            minHeight: "220px",
            background: "transparent",
            color: "var(--foreground)",
          }}
        />
      </div>

      <div className="flex items-center justify-between">
        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
          ⌘↵ to submit
        </span>
        <button
          className="ui-button ui-button--primary"
          onClick={onSubmit}
          disabled={!value.trim()}
        >
          Sort it out →
        </button>
      </div>
    </div>
  )
}

// ─── Triage View ──────────────────────────────────────────────────────────────

function TriageView({
  items,
  editingId,
  isToday,
  onSetPriority,
  onToggleDone,
  onEditText,
  onDelete,
  onAdd,
  onEditingIdChange,
  onReDump,
  onUpdateDetail,
  onUpdateProject,
  projectOptions,
  onFocus,
  onOpenProject,
}: {
  items: Item[]
  editingId: string | null
  isToday: boolean
  onSetPriority: (id: string, p: Priority) => void
  onToggleDone: (id: string) => void
  onEditText: (id: string, text: string) => void
  onDelete: (id: string) => void
  onAdd: () => void
  onEditingIdChange: (id: string | null) => void
  onReDump: () => void
  onUpdateDetail: (id: string, notes: string, links: string[]) => void
  onUpdateProject: (id: string, project: string) => void
  projectOptions: string[]
  onFocus: (id: string) => void
  onOpenProject: (project: string) => void
}) {
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const events = items.filter((i) => i.type === "event")
  const tasks = items.filter((i) => i.type !== "event" && i.status !== "archived")

  const priorityOrder: Record<Priority, number> = { today: 0, week: 1, later: 2, unassigned: 3 }
  const sortedTasks = [...tasks].sort((a, b) => {
    if (a.status !== b.status) return a.status === "done" ? 1 : -1
    return priorityOrder[a.priority] - priorityOrder[b.priority]
  })
  const sortedEvents = [...events].sort((a, b) =>
    a.status === b.status ? 0 : a.status === "done" ? 1 : -1
  )

  const activeTasks = tasks.filter((i) => i.status === "active")
  const doneTasks = tasks.filter((i) => i.status === "done").length
  const unassigned = activeTasks.filter((i) => i.priority === "unassigned").length
  const todayCount = activeTasks.filter((i) => i.priority === "today").length
  const weekCount = activeTasks.filter((i) => i.priority === "week").length
  const laterCount = activeTasks.filter((i) => i.priority === "later").length

  const subline =
    tasks.length === 0 && events.length > 0
      ? `${events.length} calendar event${events.length !== 1 ? "s" : ""}`
      : unassigned > 0
      ? `${unassigned} unsorted`
      : doneTasks === tasks.length && tasks.length > 0
      ? "all done ✓"
      : [
          todayCount > 0 && `${todayCount} today`,
          weekCount > 0 && `${weekCount} this week`,
          laterCount > 0 && `${laterCount} later`,
          doneTasks > 0 && `${doneTasks} done`,
        ]
          .filter(Boolean)
          .join(" · ")

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1
            className="text-3xl font-black mb-1"
            style={{ fontFamily: "var(--font-playfair)" }}
          >
            What actually matters?
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {subline}
          </p>
        </div>
        {isToday && (
          <button className="ui-button ui-button--ghost text-xs mt-1" onClick={onReDump}>
            ← Edit dump
          </button>
        )}
      </div>

      {/* Calendar events */}
      {sortedEvents.length > 0 && (
        <div className="space-y-1">
          <p
            className="text-xs font-bold tracking-widest uppercase mb-2"
            style={{ color: "var(--text-muted)" }}
          >
            Calendar
          </p>
          {sortedEvents.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              isEditing={editingId === item.id}
              isExpanded={expandedId === item.id}
              onSetPriority={onSetPriority}
              onToggleDone={onToggleDone}
              onEditText={onEditText}
              onDelete={onDelete}
              onStartEdit={() => onEditingIdChange(item.id)}
              onStopEdit={() => onEditingIdChange(null)}
              onExpandToggle={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
              onUpdateDetail={(notes, links) => onUpdateDetail(item.id, notes, links)}
              onUpdateProject={(project) => onUpdateProject(item.id, project)}
              projectOptions={projectOptions}
              onFocus={() => onFocus(item.id)}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}

      {/* Tasks */}
      {sortedTasks.length > 0 && (
        <div className="space-y-2.5">
          {sortedEvents.length > 0 && (
            <p
              className="text-xs font-bold tracking-widest uppercase mb-2 pt-1"
              style={{ color: "var(--text-muted)" }}
            >
              Tasks
            </p>
          )}
          {sortedTasks.map((item) => (
            <ItemCard
              key={item.id}
              item={item}
              isEditing={editingId === item.id}
              isExpanded={expandedId === item.id}
              onSetPriority={onSetPriority}
              onToggleDone={onToggleDone}
              onEditText={onEditText}
              onDelete={onDelete}
              onStartEdit={() => onEditingIdChange(item.id)}
              onStopEdit={() => onEditingIdChange(null)}
              onExpandToggle={() => setExpandedId((prev) => (prev === item.id ? null : item.id))}
              onUpdateDetail={(notes: string, links: string[]) => onUpdateDetail(item.id, notes, links)}
              onUpdateProject={(project: string) => onUpdateProject(item.id, project)}
              projectOptions={projectOptions}
              onFocus={() => onFocus(item.id)}
              onOpenProject={onOpenProject}
            />
          ))}
        </div>
      )}

      {isToday && (
        <button className="ui-button ui-button--ghost text-xs" onClick={onAdd}>
          + Add item
        </button>
      )}
    </div>
  )
}

// ─── Item Card ────────────────────────────────────────────────────────────────

const PILL_ACTIVE: Record<string, string> = {
  today: "ui-action-pill--archive",
  week: "ui-action-pill--later",
  later: "ui-action-pill--muted",
}

function ItemCard({
  item,
  isEditing,
  isExpanded,
  onSetPriority,
  onToggleDone,
  onEditText,
  onDelete,
  onStartEdit,
  onStopEdit,
  onExpandToggle,
  onUpdateDetail,
  onUpdateProject,
  projectOptions,
  onFocus,
  onOpenProject,
}: {
  item: Item
  isEditing: boolean
  isExpanded: boolean
  onSetPriority: (id: string, p: Priority) => void
  onToggleDone: (id: string) => void
  onEditText: (id: string, text: string) => void
  onDelete: (id: string) => void
  onStartEdit: () => void
  onStopEdit: () => void
  onExpandToggle: () => void
  onUpdateDetail: (notes: string, links: string[]) => void
  onUpdateProject: (project: string) => void
  projectOptions: string[]
  onFocus: () => void
  onOpenProject: (project: string) => void
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const isDone = item.status === "done"

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus()
      const len = item.text.length
      inputRef.current.setSelectionRange(len, len)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEditing])

  const isEvent = item.type === "event"
  const hasDetail = !!(item.notes || (item.links && item.links.length > 0) || item.project)

  return (
    <div
      className="task-card px-4 py-3.5 group"
      style={{
        opacity: isDone ? 0.5 : 1,
        transition: "opacity 200ms ease",
        borderColor: isEvent ? "rgba(56,189,248,0.25)" : undefined,
        background: isEvent ? "rgba(240,249,255,0.7)" : undefined,
      }}
    >
      <div className="flex items-start gap-3">
        {/* Checkbox */}
        <button
          className={`ui-check flex-shrink-0 mt-0.5 ${isDone ? "ui-check--done" : ""}`}
          onClick={() => onToggleDone(item.id)}
          aria-label={isDone ? "Mark undone" : "Mark done"}
        >
          {isDone && (
            <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
              <path
                d="M1 4L3.5 6.5L9 1"
                stroke="white"
                strokeWidth="1.8"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </button>

        {/* Text */}
        <div className="flex-1 min-w-0 pt-px">
          {isEditing ? (
            <input
              ref={inputRef}
              type="text"
              value={item.text}
              onChange={(e) => onEditText(item.id, e.target.value)}
              onBlur={onStopEdit}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === "Escape") onStopEdit()
              }}
              className="w-full outline-none text-sm bg-transparent"
              style={{ color: "var(--foreground)" }}
            />
          ) : (
            <div>
              <span
                className="text-sm leading-snug cursor-text"
                style={{
                  color: "var(--foreground)",
                  textDecoration: isDone ? "line-through" : "none",
                  textDecorationColor: "rgba(120,113,108,0.5)",
                }}
                onClick={!isDone ? onStartEdit : undefined}
              >
                {item.text || (
                  <span style={{ color: "var(--text-muted)" }}>tap to edit</span>
                )}
              </span>
              {(item.project || item.focus_seconds) && (
                <div className="flex flex-wrap items-center gap-2 mt-2">
                  {item.project && (
                    <ProjectBadge
                      project={item.project}
                      onClick={() => onOpenProject(item.project!)}
                    />
                  )}
                  {(item.focus_seconds ?? 0) > 0 && (
                    <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                      focused {formatDurationCompact(item.focus_seconds ?? 0)}
                    </span>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Focus */}
        {!isDone && item.type !== "event" && (
          <button
            onClick={onFocus}
            className="flex-shrink-0 opacity-0 group-hover:opacity-50 hover:!opacity-100 transition-opacity text-xs leading-none"
            style={{ color: "var(--text-muted)", marginTop: "2px" }}
            aria-label="Focus mode"
            title="Focus"
          >
            ◎
          </button>
        )}

        {/* Delete */}
        <button
          onClick={() => onDelete(item.id)}
          className="flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity text-xs leading-none"
          style={{ color: "var(--text-muted)", marginTop: "2px" }}
          aria-label="Remove"
        >
          ✕
        </button>
      </div>

      {/* Priority pills + expand toggle — hidden when done */}
      {!isDone && (
        <div className="flex items-center gap-2 mt-3 pl-9">
          {(["today", "week", "later"] as const).map((p) => {
            const isActive = item.priority === p
            return (
              <button
                key={p}
                onClick={() => onSetPriority(item.id, isActive ? "unassigned" : p)}
                className={`ui-action-pill ${isActive ? PILL_ACTIVE[p] : ""}`}
                style={{ fontSize: "0.65rem", opacity: isActive ? 1 : 0.4 }}
              >
                {p === "today" ? "Today" : p === "week" ? "This Week" : "Later"}
              </button>
            )
          })}
          <button
            onClick={onExpandToggle}
            className="ml-auto text-xs"
            style={{ color: "var(--text-muted)", opacity: hasDetail ? 0.8 : 0.35 }}
          >
            {isExpanded ? "▾ resources" : hasDetail ? "▸ resources ·" : "▸ resources"}
          </button>
        </div>
      )}

      {/* Expanded detail panel */}
      {isExpanded && !isDone && (
        <div className="mt-3 pl-9 space-y-3">
          <ResourceEditor
            key={`${item.id}-${item.project ?? ""}`}
            item={item}
            projectOptions={projectOptions}
            onUpdateDetail={onUpdateDetail}
            onUpdateProject={onUpdateProject}
            onOpenProject={onOpenProject}
          />
        </div>
      )}
    </div>
  )
}

// ─── Context Panel ────────────────────────────────────────────────────────────

function ContextPanel({
  done,
  active,
  onLater,
  onArchive,
  onComplete,
}: {
  done: (Item & { date: string })[]
  active: (Item & { date: string })[]
  onLater: (date: string, id: string) => void
  onArchive: (date: string, id: string) => void
  onComplete: (date: string, id: string) => void
}) {
  return (
    <div className="mt-12 space-y-7">
      <div className="h-px" style={{ background: "var(--surface-border)" }} />

      {done.length > 0 && (
        <div>
          <p
            className="text-xs font-bold tracking-widest uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            Recently Completed
          </p>
          <div className="space-y-1.5">
            {done.map((item) => (
              <div key={item.id + item.date} className="flex items-center gap-2.5">
                <span className="text-xs" style={{ color: "#047857" }}>✓</span>
                <span
                  className="text-sm"
                  style={{
                    color: "var(--text-muted)",
                    textDecoration: "line-through",
                    textDecorationColor: "rgba(120,113,108,0.35)",
                  }}
                >
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {active.length > 0 && (
        <div>
          <p
            className="text-xs font-bold tracking-widest uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            Still in Progress
          </p>
          <div className="space-y-1.5">
            {active.map((item) => (
              <div
                key={item.id}
                className="task-card px-4 py-3"
              >
                <div className="flex items-start gap-3">
                  <span className="text-xs mt-0.5" style={{ color: "#0369a1" }}>→</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mb-2">
                      <span className="text-sm leading-snug" style={{ color: "var(--foreground)" }}>
                        {item.text}
                      </span>
                      <span className="text-[11px]" style={{ color: "rgba(120,113,108,0.8)" }}>
                        {formatDisplayDate(item.date)}
                      </span>
                      {item.project && (
                        <ProjectBadge project={item.project} />
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <button
                        type="button"
                        className="ui-action-pill ui-action-pill--muted"
                        onClick={() => onLater(item.date, item.id)}
                      >
                        Later
                      </button>
                      <button
                        type="button"
                        className="ui-action-pill ui-action-pill--archive"
                        onClick={() => onArchive(item.date, item.id)}
                      >
                        Archive
                      </button>
                      <button
                        type="button"
                        className="ui-action-pill ui-action-pill--done"
                        onClick={() => onComplete(item.date, item.id)}
                      >
                        Check Off
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

// ─── Queue Dropdown ───────────────────────────────────────────────────────────

function QueueDropdown({
  label,
  items,
  onPromote,
}: {
  label: string
  items: Item[]
  onPromote: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
        style={{
          background: open ? "rgba(0,0,0,0.08)" : "rgba(0,0,0,0.04)",
          color: "var(--text-muted)",
          transition: "background 150ms",
        }}
      >
        {label}
        <span className="font-bold tabular-nums hidden sm:inline" style={{ color: "#b45309" }}>
          {items.length}
        </span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: label === "This Week" ? 0 : undefined,
            right: label !== "This Week" ? 0 : undefined,
            width: "280px",
            background: "rgba(247,246,242,0.98)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--surface-border)",
            borderRadius: "12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
            padding: "0.75rem",
            zIndex: 100,
          }}
        >
          <p
            className="text-xs font-bold tracking-widest uppercase mb-3"
            style={{ color: "var(--text-muted)" }}
          >
            {label}
          </p>
          <div className="space-y-1">
            {items.map((item) => (
              <div key={item.id} className="flex items-center justify-between gap-3 py-1">
                <span className="text-sm flex-1" style={{ color: "var(--foreground)" }}>
                  {item.text}
                </span>
                <button
                  className="text-xs flex-shrink-0"
                  style={{ color: "#0369a1" }}
                  onClick={() => { onPromote(item.id); setOpen(false) }}
                >
                  → today
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ProjectBadge({
  project,
  onClick,
}: {
  project: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex items-center gap-1.5 text-xs px-2 py-1 rounded-full"
      style={{
        background: "rgba(2,132,199,0.08)",
        color: "#075985",
        border: "1px solid rgba(2,132,199,0.14)",
      }}
    >
      <span style={{ opacity: 0.7 }}>◈</span>
      <span>{project}</span>
    </button>
  )
}

function ResourceEditor({
  item,
  projectOptions,
  onUpdateDetail,
  onUpdateProject,
  onOpenProject,
}: {
  item: Item
  projectOptions: string[]
  onUpdateDetail: (notes: string, links: string[]) => void
  onUpdateProject: (project: string) => void
  onOpenProject?: (project: string) => void
}) {
  const [linkInput, setLinkInput] = useState("")
  const [projectInput, setProjectInput] = useState(item.project ?? "")
  const suggestions = inferProjectSuggestions(item, projectOptions)

  function addLink() {
    if (!linkInput.trim()) return
    const url = linkInput.trim().startsWith("http") ? linkInput.trim() : `https://${linkInput.trim()}`
    onUpdateDetail(item.notes ?? "", [...(item.links ?? []), url])
    setLinkInput("")
  }

  function applyProject(value: string) {
    const normalized = normalizeProjectName(value)
    onUpdateProject(normalized)
    setProjectInput(normalized)
  }

  return (
    <div className="space-y-3">
      <div>
        <p className="text-[11px] font-bold tracking-widest uppercase mb-2" style={{ color: "var(--text-muted)" }}>
          Resources
        </p>
        <textarea
          value={item.notes ?? ""}
          onChange={(e) => onUpdateDetail(e.target.value, item.links ?? [])}
          placeholder="notes, context, next steps..."
          className="w-full text-xs resize-none outline-none rounded-xl"
          style={{
            minHeight: "72px",
            background: "rgba(0,0,0,0.03)",
            border: "1px solid var(--surface-border)",
            padding: "10px 12px",
            color: "var(--foreground)",
          }}
        />
      </div>

      <div className="space-y-2">
        {(item.links ?? []).map((link, i) => (
          <div
            key={i}
            className="flex items-center gap-2 rounded-xl px-3 py-2"
            style={{ background: "rgba(255,255,255,0.65)", border: "1px solid var(--surface-border)" }}
          >
            <a
              href={link}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs flex-1 truncate"
              style={{ color: "#0369a1" }}
            >
              {link}
            </a>
            <button
              onClick={() => onUpdateDetail(item.notes ?? "", (item.links ?? []).filter((_, j) => j !== i))}
              className="text-xs flex-shrink-0"
              style={{ color: "var(--text-muted)" }}
            >
              remove
            </button>
          </div>
        ))}

        <div className="flex gap-2">
          <input
            value={linkInput}
            onChange={(e) => setLinkInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                addLink()
              }
            }}
            placeholder="add link, doc, or page"
            className="flex-1 text-xs outline-none rounded-xl px-3 py-2"
            style={{
              background: "rgba(255,255,255,0.65)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
            }}
          />
          <button className="ui-button ui-button--ghost text-xs" onClick={addLink}>
            Add
          </button>
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[11px] font-bold tracking-widest uppercase" style={{ color: "var(--text-muted)" }}>
          Project
        </p>
        {item.project && (
          <div className="flex items-center gap-2">
            <ProjectBadge
              project={item.project}
              onClick={onOpenProject ? () => onOpenProject(item.project!) : undefined}
            />
            <button
              className="text-xs"
              style={{ color: "var(--text-muted)" }}
              onClick={() => applyProject("")}
            >
              clear
            </button>
          </div>
        )}
        <div className="flex gap-2">
          <input
            list={`project-options-${item.id}`}
            value={projectInput}
            onChange={(e) => setProjectInput(e.target.value)}
            onBlur={() => {
              if (projectInput !== (item.project ?? "")) applyProject(projectInput)
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault()
                applyProject(projectInput)
              }
            }}
            placeholder="attach to a project"
            className="flex-1 text-xs outline-none rounded-xl px-3 py-2"
            style={{
              background: "rgba(255,255,255,0.65)",
              border: "1px solid var(--surface-border)",
              color: "var(--foreground)",
            }}
          />
          <datalist id={`project-options-${item.id}`}>
            {projectOptions.map((project) => (
              <option key={project} value={project} />
            ))}
          </datalist>
          <button className="ui-button ui-button--ghost text-xs" onClick={() => applyProject(projectInput)}>
            Save
          </button>
        </div>
        {suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {suggestions.map((project) => (
              <button
                key={project}
                className="text-xs px-2 py-1 rounded-full"
                style={{
                  background: "rgba(180,83,9,0.08)",
                  color: "#92400e",
                  border: "1px solid rgba(180,83,9,0.15)",
                }}
                onClick={() => applyProject(project)}
              >
                {project}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function ProjectsDropdown({
  projects,
  activeProject,
  onSelect,
}: {
  projects: string[]
  activeProject: string | null
  onSelect: (project: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((value) => !value)}
        className="flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full"
        style={{
          background: activeProject ? "rgba(2,132,199,0.1)" : "rgba(0,0,0,0.04)",
          color: activeProject ? "#075985" : "var(--text-muted)",
          transition: "background 150ms",
        }}
      >
        Projects
        <span className="font-bold tabular-nums hidden sm:inline">{projects.length}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            left: 0,
            width: "280px",
            background: "rgba(247,246,242,0.98)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--surface-border)",
            borderRadius: "12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
            padding: "0.75rem",
            zIndex: 100,
          }}
        >
          <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
            Projects
          </p>
          <div className="space-y-1">
            {projects.map((project) => (
              <button
                key={project}
                className="w-full flex items-center justify-between gap-3 py-2 px-2 rounded-lg text-left"
                style={{
                  background: activeProject === project ? "rgba(2,132,199,0.08)" : "transparent",
                  color: "var(--foreground)",
                }}
                onClick={() => {
                  onSelect(project)
                  setOpen(false)
                }}
              >
                <span className="text-sm">{project}</span>
                <span className="text-xs" style={{ color: "var(--text-muted)" }}>open</span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

function ActiveFocusBar({
  item,
  seconds,
  onResume,
  onPause,
  onOpenProject,
}: {
  item: Item
  seconds: number
  onResume: () => void
  onPause: () => void
  onOpenProject: (project: string) => void
}) {
  return (
    <div
      className="mb-5 rounded-3xl px-4 py-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between"
      style={{
        background: "linear-gradient(135deg, rgba(255,255,255,0.95), rgba(240,249,255,0.95))",
        border: "1px solid rgba(2,132,199,0.12)",
        boxShadow: "var(--shadow-soft)",
      }}
    >
      <div className="min-w-0">
        <p className="text-[11px] font-bold tracking-widest uppercase mb-1" style={{ color: "#0369a1" }}>
          Active Focus
        </p>
        <p className="text-sm font-semibold truncate" style={{ color: "var(--foreground)" }}>
          {item.text}
        </p>
        <div className="flex flex-wrap items-center gap-2 mt-2">
          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
            {formatDurationClock(seconds)} running
          </span>
          {item.project && (
            <ProjectBadge project={item.project} onClick={() => onOpenProject(item.project!)} />
          )}
        </div>
      </div>
      <div className="flex items-center gap-2">
        <button className="ui-button ui-button--ghost text-xs" onClick={onPause}>
          Pause
        </button>
        <button className="ui-button ui-button--primary text-xs" onClick={onResume}>
          Resume Focus
        </button>
      </div>
    </div>
  )
}

function ProjectView({
  project,
  entries,
  onBack,
  onOpenDay,
}: {
  project: string
  entries: ProjectEntry[]
  onBack: () => void
  onOpenDay: (date: string) => void
}) {
  const activeCount = entries.filter((entry) => entry.item.status === "active").length
  const doneCount = entries.filter((entry) => entry.item.status === "done").length
  const archivedCount = entries.filter((entry) => entry.item.status === "archived").length
  const totalFocus = entries.reduce((sum, entry) => sum + (entry.item.focus_seconds ?? 0), 0)
  const grouped = entries.reduce<Record<string, Item[]>>((acc, entry) => {
    acc[entry.date] = [...(acc[entry.date] ?? []), entry.item]
    return acc
  }, {})

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <button className="ui-button ui-button--ghost text-xs mb-3" onClick={onBack}>
            ← Back
          </button>
          <h1 className="text-3xl font-black mb-1" style={{ fontFamily: "var(--font-playfair)" }}>
            {project}
          </h1>
          <p className="text-sm" style={{ color: "var(--text-muted)" }}>
            {activeCount} active · {doneCount} done · {archivedCount} archived · {formatDurationCompact(totalFocus)} focused
          </p>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="app-card text-sm" style={{ color: "var(--text-muted)" }}>
          Nothing tied to this project yet.
        </div>
      ) : (
        Object.keys(grouped).sort((a, b) => b.localeCompare(a)).map((date) => (
          <div key={date} className="space-y-2">
            <button
              className="text-xs font-bold tracking-widest uppercase"
              style={{ color: "var(--text-muted)" }}
              onClick={() => onOpenDay(date)}
            >
              {formatDisplayDate(date)}
            </button>
            <div className="space-y-2">
              {grouped[date].map((item) => (
                <div
                  key={item.id}
                  className="task-card px-4 py-3"
                  style={{ opacity: item.status === "done" ? 0.6 : 1 }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p
                        className="text-sm leading-snug"
                        style={{
                          color: "var(--foreground)",
                          textDecoration: item.status === "done" ? "line-through" : "none",
                        }}
                      >
                        {item.text}
                      </p>
                      <div className="flex flex-wrap items-center gap-2 mt-2">
                        {item.type === "event" && (
                          <span className="text-xs px-2 py-1 rounded-full" style={{ background: "rgba(56,189,248,0.1)", color: "#0369a1" }}>
                            calendar
                          </span>
                        )}
                        <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                          {item.status === "done"
                            ? "done"
                            : item.status === "archived"
                              ? "archived"
                              : item.priority === "unassigned"
                                ? "active"
                                : item.priority}
                        </span>
                        {(item.focus_seconds ?? 0) > 0 && (
                          <span className="text-xs" style={{ color: "var(--text-muted)" }}>
                            {formatDurationCompact(item.focus_seconds ?? 0)} focused
                          </span>
                        )}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))
      )}
    </div>
  )
}

// ─── Focus View ───────────────────────────────────────────────────────────────

function FocusView({
  item,
  projectOptions,
  activeSeconds,
  isActive,
  onToggleDone,
  onUpdateDetail,
  onUpdateProject,
  onToggleFocus,
  onOpenProject,
  onExit,
}: {
  item: Item
  projectOptions: string[]
  activeSeconds: number
  isActive: boolean
  onToggleDone: (id: string) => void
  onUpdateDetail: (notes: string, links: string[]) => void
  onUpdateProject: (project: string) => void
  onToggleFocus: () => void
  onOpenProject: (project: string) => void
  onExit: () => void
}) {
  const isDone = item.status === "done"

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onExit()
    }
    document.addEventListener("keydown", onKey)
    return () => document.removeEventListener("keydown", onKey)
  }, [onExit])

  return (
    <div
      className="flex flex-col items-center text-center"
      style={{ minHeight: "calc(100vh - 57px)", padding: "2rem 0 3rem" }}
    >
      <div
        className="w-full max-w-xl rounded-[2rem] px-5 py-6 sm:px-8"
        style={{
          background: "linear-gradient(180deg, rgba(255,255,255,0.96), rgba(255,255,255,0.84))",
          border: "1px solid var(--surface-border)",
          boxShadow: "var(--shadow-soft)",
        }}
      >
        <span
          className="font-mono text-xs tracking-widest"
          style={{ color: "var(--text-muted)", opacity: 0.7 }}
        >
          {isActive ? "ACTIVE" : "PAUSED"} · {formatDurationClock(activeSeconds)}
        </span>

        <p
          className="text-3xl font-black leading-snug max-w-md mx-auto mt-5 mb-4"
          style={{
            fontFamily: "var(--font-playfair)",
            color: isDone ? "var(--text-muted)" : "var(--foreground)",
            textDecoration: isDone ? "line-through" : "none",
            transition: "all 400ms ease",
          }}
        >
          {item.text}
        </p>

        <div className="flex flex-wrap items-center justify-center gap-2 mb-8">
          {(item.focus_seconds ?? 0) > 0 && (
            <span className="text-xs" style={{ color: "var(--text-muted)" }}>
              tracked {formatDurationCompact(item.focus_seconds ?? 0)} total
            </span>
          )}
          {item.project && (
            <ProjectBadge project={item.project} onClick={() => onOpenProject(item.project!)} />
          )}
        </div>

        {!isDone ? (
          <div className="flex items-center justify-center gap-3 mb-8">
            <button
              onClick={() => onToggleDone(item.id)}
              className="w-14 h-14 rounded-full border-2 flex items-center justify-center transition-all"
              style={{ borderColor: "var(--surface-border)" }}
              aria-label="Mark done"
            />
            <button className="ui-button ui-button--ghost text-xs" onClick={onToggleFocus}>
              {isActive ? "Pause Timer" : "Resume Timer"}
            </button>
          </div>
        ) : (
          <span className="text-sm" style={{ color: "#047857" }}>
            Done ✓
          </span>
        )}

        <div className="text-left mt-8">
          <ResourceEditor
            key={`${item.id}-${item.project ?? ""}`}
            item={item}
            projectOptions={projectOptions}
            onUpdateDetail={onUpdateDetail}
            onUpdateProject={onUpdateProject}
            onOpenProject={onOpenProject}
          />
        </div>

        {!isDone && (
          <button
            onClick={onExit}
            className="mt-8 text-xs"
            style={{ color: "var(--text-muted)", opacity: 0.5 }}
          >
            close focus view
          </button>
        )}
      </div>
    </div>
  )
}

// ─── Sync Indicator ───────────────────────────────────────────────────────────

function SyncIndicator({
  status,
  token,
  onChangeToken,
  onPushAll,
}: {
  status: "idle" | "syncing" | "synced" | "error"
  token: string
  onChangeToken: (t: string) => void
  onPushAll: () => void
}) {
  const [open, setOpen] = useState(false)
  const [tokenInput, setTokenInput] = useState("")
  const [copied, setCopied] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", handleClick)
    return () => document.removeEventListener("mousedown", handleClick)
  }, [open])

  function copyToken() {
    navigator.clipboard.writeText(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 1500)
  }

  const cloudColor =
    status === "syncing" ? "var(--text-muted)" :
    status === "synced"  ? "#047857" :
    status === "error"   ? "#dc2626" : "var(--text-muted)"

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 text-xs px-2 py-1 rounded-full border"
        style={{ color: cloudColor, borderColor: cloudColor, opacity: 0.85 }}
        title="Sync"
      >
        <span style={{ fontSize: "0.75rem" }}>☁</span>
        <span>{status === "syncing" ? "Syncing…" : status === "error" ? "Sync error" : "Cloud"}</span>
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            top: "calc(100% + 8px)",
            right: 0,
            width: "260px",
            background: "rgba(247,246,242,0.98)",
            backdropFilter: "blur(12px)",
            border: "1px solid var(--surface-border)",
            borderRadius: "12px",
            boxShadow: "0 8px 24px rgba(0,0,0,0.1)",
            padding: "0.875rem",
            zIndex: 100,
          }}
        >
          <p className="text-xs font-bold tracking-widest uppercase mb-3" style={{ color: "var(--text-muted)" }}>
            Sync token
          </p>
          <div className="flex items-center gap-2 mb-4">
            <code
              className="text-xs flex-1 truncate"
              style={{ color: "var(--foreground)", fontFamily: "monospace" }}
            >
              {token.slice(0, 8)}…
            </code>
            <button
              onClick={copyToken}
              className="text-xs flex-shrink-0"
              style={{ color: "#0369a1" }}
            >
              {copied ? "Copied!" : "Copy"}
            </button>
          </div>

          <button
            onClick={() => { onPushAll(); setOpen(false) }}
            className="text-xs w-full text-left mb-4"
            style={{ color: "#0369a1" }}
          >
            Push local data to cloud ↑
          </button>

          <p className="text-xs mb-1.5" style={{ color: "var(--text-muted)" }}>
            Use on another device:
          </p>
          <p className="text-[11px] leading-relaxed mb-2.5" style={{ color: "var(--text-muted)", opacity: 0.8 }}>
            Localhost has its own browser storage, so paste the same cloud token here once to pull your Vercel data.
          </p>
          <div className="flex gap-2">
            <input
              value={tokenInput}
              onChange={(e) => setTokenInput(e.target.value)}
              placeholder="paste token…"
              className="flex-1 text-xs outline-none"
              style={{
                borderBottom: "1px solid var(--surface-border)",
                padding: "3px 0",
                background: "transparent",
                color: "var(--foreground)",
              }}
            />
            <button
              onClick={() => {
                if (tokenInput.trim()) {
                  onChangeToken(tokenInput.trim())
                  setTokenInput("")
                  setOpen(false)
                }
              }}
              className="text-xs flex-shrink-0"
              style={{ color: "#0369a1" }}
            >
              Link
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
