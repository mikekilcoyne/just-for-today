"use client"

import { useState, useEffect, useRef } from "react"
import confetti from "canvas-confetti"

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
  status: "active" | "done"
  created_at: string
  type?: "event" // calendar events parsed from day headers
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

// ─── Constants ────────────────────────────────────────────────────────────────

const STORAGE_PREFIX = "jft2-"
const META_KEY = "jft2-meta"
const DAY_ABBREVS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]

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
    tuesday: 2, tue: 2,
    wednesday: 3, wed: 3,
    thursday: 4, thu: 4,
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
    const raw = localStorage.getItem(STORAGE_PREFIX + date)
    return raw ? (JSON.parse(raw) as DayData) : null
  } catch {
    return null
  }
}

function saveDay(data: DayData): void {
  localStorage.setItem(STORAGE_PREFIX + data.date, JSON.stringify(data))
}

function loadMeta(): AppMeta {
  try {
    const raw = localStorage.getItem(META_KEY)
    if (raw) return JSON.parse(raw) as AppMeta
  } catch {}
  return { current_streak: 0, last_active_date: null }
}

function saveMeta(meta: AppMeta): void {
  localStorage.setItem(META_KEY, JSON.stringify(meta))
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

// Parses brain dump text. Lines under a day header (e.g. "Monday") become
// events assigned to that day. Everything else goes to anchorDate as tasks.
function parseBrainDump(text: string, anchorDate: string): {
  items: Item[]
  otherDays: Record<string, Item[]>
} {
  const now = new Date().toISOString()
  const dayHeaderRe = /^(monday|tuesday|wednesday|thursday|friday|saturday|sunday|mon|tue|wed|thu|fri|sat|sun)[:\s\-–—]*$/i
  const stripBullet = (s: string) => s.replace(/^[\s\u2022\u2023\u25E6\u2043\-*\d.)]+/, "").trim()

  let currentDay: string | null = null // null → goes to anchorDate
  const items: Item[] = []
  const otherDays: Record<string, Item[]> = {}

  for (const line of text.split("\n")) {
    const trimmed = line.trim()
    if (!trimmed) continue

    const dayMatch = trimmed.match(dayHeaderRe)
    if (dayMatch) {
      const date = getDayDateForWeek(dayMatch[1], anchorDate)
      currentDay = date === anchorDate ? null : date
      continue
    }

    const itemText = stripBullet(trimmed)
    if (itemText.length < 2) continue

    const item: Item = {
      id: crypto.randomUUID(),
      text: itemText,
      priority: currentDay ? "week" : "unassigned",
      status: "active",
      created_at: now,
      type: currentDay ? "event" : undefined,
    }

    if (currentDay) {
      otherDays[currentDay] = [...(otherDays[currentDay] ?? []), item]
    } else {
      items.push(item)
    }
  }

  return { items, otherDays }
}

// ─── Main Component ───────────────────────────────────────────────────────────

export default function HomeClient() {
  const today = getTodayStr()

  const [selectedDate, setSelectedDate] = useState(today)
  const [view, setView] = useState<"dump" | "triage">("dump")
  const [rawDump, setRawDump] = useState("")
  const [dayData, setDayData] = useState<DayData | null>(null)
  const [meta, setMeta] = useState<AppMeta>({ current_streak: 0, last_active_date: null })
  const [editingId, setEditingId] = useState<string | null>(null)

  // Load meta once
  useEffect(() => {
    setMeta(loadMeta())
  }, [])

  // Load data for selected date
  useEffect(() => {
    const data = loadDay(selectedDate)
    if (data) {
      setDayData(data)
      setRawDump(data.brain_dump)
      setView("triage")
    } else {
      setDayData(null)
      setRawDump("")
      setView("dump")
    }
  }, [selectedDate])

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

  function mutateItems(items: Item[]) {
    if (!dayData) return
    const updated = { ...dayData, items }
    setDayData(updated)
    saveDay(updated)
  }

  function setPriority(id: string, priority: Priority) {
    if (!dayData) return
    mutateItems(dayData.items.map((i) => (i.id === id ? { ...i, priority } : i)))
  }

  function toggleDone(id: string) {
    if (!dayData) return
    const item = dayData.items.find((i) => i.id === id)
    if (!item) return
    const newStatus = item.status === "done" ? "active" : "done"
    mutateItems(dayData.items.map((i) => (i.id === id ? { ...i, status: newStatus } : i)))
    if (newStatus === "done") {
      fireBalloons()
      const newMeta = computeStreak(meta, today)
      if (newMeta !== meta) {
        setMeta(newMeta)
        saveMeta(newMeta)
      }
    }
  }

  function editItemText(id: string, text: string) {
    if (!dayData) return
    mutateItems(dayData.items.map((i) => (i.id === id ? { ...i, text } : i)))
  }

  function deleteItem(id: string) {
    if (!dayData) return
    mutateItems(dayData.items.filter((i) => i.id !== id))
  }

  function addItem() {
    if (!dayData) return
    const item: Item = {
      id: crypto.randomUUID(),
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
  const recentlyDone = recentDays
    .flatMap((d) => d.items.filter((i) => i.status === "done").map((i) => ({ ...i, date: d.date })))
    .slice(0, 6)
  const stillActive = recentDays
    .filter((d) => d.date !== selectedDate)
    .flatMap((d) =>
      d.items.filter(
        (i) => i.status === "active" && (i.priority === "today" || i.priority === "week")
      )
    )
    .slice(0, 5)

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
        <div className="max-w-2xl mx-auto px-6 py-4 flex items-center justify-between">
          <span
            className="text-xs font-bold tracking-widest uppercase"
            style={{ color: "var(--text-muted)" }}
          >
            Just for Today
          </span>
          <span className="text-sm" style={{ color: "var(--text-muted)" }}>
            {formatDisplayDate(selectedDate)}
          </span>
          <div className="w-12 flex justify-end">
            {meta.current_streak > 0 && (
              <span
                className="text-xs font-bold tabular-nums"
                style={{ color: "#b45309" }}
                title={`${meta.current_streak}-day streak`}
              >
                {meta.current_streak}d
              </span>
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

        {/* ── Brain Dump ── */}
        {view === "dump" && (
          <BrainDumpView
            value={rawDump}
            onChange={setRawDump}
            onSubmit={handleSubmit}
            isToday={selectedDate === today}
          />
        )}

        {/* ── Triage ── */}
        {view === "triage" && dayData && (
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
            />
            {(recentlyDone.length > 0 || stillActive.length > 0) && (
              <ContextPanel done={recentlyDone} active={stillActive} />
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
        const tasks = data?.items.filter((item) => item.type !== "event") ?? []
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
}) {
  const events = items.filter((i) => i.type === "event")
  const tasks = items.filter((i) => i.type !== "event")

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
              onSetPriority={onSetPriority}
              onToggleDone={onToggleDone}
              onEditText={onEditText}
              onDelete={onDelete}
              onStartEdit={() => onEditingIdChange(item.id)}
              onStopEdit={() => onEditingIdChange(null)}
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
              onSetPriority={onSetPriority}
              onToggleDone={onToggleDone}
              onEditText={onEditText}
              onDelete={onDelete}
              onStartEdit={() => onEditingIdChange(item.id)}
              onStopEdit={() => onEditingIdChange(null)}
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
  onSetPriority,
  onToggleDone,
  onEditText,
  onDelete,
  onStartEdit,
  onStopEdit,
}: {
  item: Item
  isEditing: boolean
  onSetPriority: (id: string, p: Priority) => void
  onToggleDone: (id: string) => void
  onEditText: (id: string, text: string) => void
  onDelete: (id: string) => void
  onStartEdit: () => void
  onStopEdit: () => void
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
          )}
        </div>

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

      {/* Priority pills — tasks only, hidden when done */}
      {!isDone && item.type !== "event" && (
        <div className="flex gap-2 mt-3 pl-9">
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
        </div>
      )}
    </div>
  )
}

// ─── Context Panel ────────────────────────────────────────────────────────────

function ContextPanel({
  done,
  active,
}: {
  done: (Item & { date: string })[]
  active: Item[]
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
              <div key={item.id} className="flex items-center gap-2.5">
                <span className="text-xs" style={{ color: "#0369a1" }}>→</span>
                <span className="text-sm" style={{ color: "var(--text-muted)" }}>
                  {item.text}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
