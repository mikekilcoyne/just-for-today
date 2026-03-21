"use client";

import { useEffect, useState, useCallback, useTransition, useRef } from "react";

const ANTIGRAVITY_URL =
  process.env.NEXT_PUBLIC_ANTIGRAVITY_URL ?? "https://claude.ai/new";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TextDraft   { to: string; draft: string; done?: boolean; }
interface EmailDraft  { to: string; subject: string; draft: string; }
interface ScheduleBlock { time: string; task: string; note: string; }
interface ShotListItem  { text: string; done: boolean; archived?: boolean; later?: boolean; }

interface Interviewee { name: string; questions: string[]; }

interface ComposeEmailDraft { to: string; subject: string; notes: string; draft: string; }
interface PromptBuilder { brief: string; prompt: string; }
interface MeetingPrep {
  title: string;
  notes: string;
  agenda: string;
  followUpActions: string;
}
interface TomorrowBriefing {
  topPriority: string;
  completed: string[];
  open: string[];
  secondaryMoves: string;
  niceToHaves: string;
  movedForward: string;
  howItFelt: string;
  pushedLater: string[];
  archived: string[];
}

interface DayData {
  brainDump: string;
  topPriority: string;
  secondaryMoves: string;
  niceToHaves: string;
  projectPlan: string;
  texts: TextDraft[];
  emails: EmailDraft[];
  schedule: ScheduleBlock[];
  interviewGameplan: string;
  interviewees: Interviewee[];
  shotList: ShotListItem[];
  projectLink: string;
  howItFelt: string;
  midDayFeeling: string;
  movedForward: string;
  done: Record<string, boolean>;
  sectionTitles: Record<string, string>;
  weekendVibes: string;
  weekendLinks: string;
  composeEmail: ComposeEmailDraft;
  promptBuilder: PromptBuilder;
  meetingPrep: MeetingPrep;
  sectionState: Record<string, "later" | "archived">;
  sectionOrder: string[];
  savedForDate?: string;
  tomorrowBriefing?: TomorrowBriefing;
}

interface SavedDaySnapshot {
  key: string;
  label: string;
  rawDate: string;
  score: number;
  summary: string[];
  data: Partial<DayData>;
}

interface WeekendTaskHelperAction {
  kind: "copyText" | "link" | "prompt";
  label: string;
  value: string;
}

const DEFAULT_SECTION_ORDER = [
  "sec-yesterday",
  "sec-midday",
  "sec-braindump",
  "sec-plan",
  "sec-schedule",
  "sec-texts",
  "sec-emails",
  "sec-projectplan",
  "sec-shotlist",
  "sec-meetingprep",
  "sec-interviews",
  "sec-projectlinks",
  "sec-email",
  "sec-prompt",
  "sec-weekend",
  "sec-reflection",
];

const SECTION_LABELS: Record<string, string> = {
  yesterday: "Yesterday",
  brainDump: "Brain Dump",
  plan: "Today's Plan",
  schedule: "Schedule",
  texts: "Texts",
  emails: "Emails",
  projectPlan: "Project Plan",
  shotList: "Shot List",
  meetingPrep: "Meeting Prep",
  interviews: "Interviews",
  projectLinks: "Project Links",
  composeEmail: "Quick Email",
  promptBuilder: "Prompt",
  reflection: "Reflection",
  midday: "Check-In",
  weekend: "Weekend",
};

const EMPTY: DayData = {
  brainDump: "", topPriority: "", secondaryMoves: "", niceToHaves: "",
  projectPlan: "", texts: [], emails: [], schedule: [],
  interviewGameplan: "", interviewees: [], shotList: [],
  projectLink: "", howItFelt: "", midDayFeeling: "", movedForward: "",
  done: {},
  sectionTitles: {},
  weekendVibes: "",
  weekendLinks: "",
  composeEmail: { to: "", subject: "", notes: "", draft: "" },
  promptBuilder: { brief: "", prompt: "" },
  meetingPrep: { title: "", notes: "", agenda: "", followUpActions: "" },
  sectionState: {},
  sectionOrder: DEFAULT_SECTION_ORDER,
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getProjectMeta(url: string): { name: string; icon: string; desktopUrl?: string } {
  try {
    const host = new URL(url).hostname.toLowerCase();
    const path = url.toLowerCase();
    // desktopUrl = URL scheme that opens the native desktop app
    if (host.includes("canva.com"))       return { name: "Open in Canva", icon: "🎨", desktopUrl: url.replace("https://", "canva://") };
    if (host.includes("figma.com"))       return { name: "Open in Figma", icon: "✏️", desktopUrl: url.replace("https://www.figma.com", "figma://") };
    if (host.includes("notion.so"))       return { name: "Open in Notion", icon: "📝", desktopUrl: url.replace("https://www.notion.so", "notion://") };
    if (host.includes("linear.app"))      return { name: "Open in Linear", icon: "📋", desktopUrl: url.replace("https://linear.app", "linear://") };
    if (host.includes("adobe.com") || path.includes("premiere")) return { name: "Open in Premiere", icon: "🎬" };
    if (host.includes("github.com"))      return { name: "Open in GitHub", icon: "💻" };
    if (host.includes("claude.ai") || host.includes("antigravity")) return { name: "Open in AntiGravity", icon: "⚡" };
    if (host.includes("docs.google.com")) return { name: "Open in Google Docs", icon: "📄" };
    if (host.includes("sheets.google"))   return { name: "Open in Sheets", icon: "📊" };
    if (host.includes("airtable.com"))    return { name: "Open in Airtable", icon: "🗂️" };
    if (host.includes("loom.com"))        return { name: "Open in Loom", icon: "🎥" };
    if (host.includes("miro.com"))        return { name: "Open in Miro", icon: "🗺️" };
  } catch {}
  return { name: "Open Project", icon: "🔗" };
}

function getInterviewTitle(gameplan: string): string {
  const first = gameplan.trim().split("\n").find(l => l.trim().length > 2);
  return first ? first.replace(/^[•–\-*]\s*/, "").trim() : "Interview";
}

function formatLocalDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getStorageKeyForDate(date: Date) {
  return `jft-${formatLocalDateKey(date)}`;
}

function getLegacyStorageKeyForDate(date: Date) {
  return `jft-${date.toISOString().slice(0, 10)}`;
}

function isMeaningfulDayData(value: unknown): value is Partial<DayData> {
  if (!value || typeof value !== "object") return false;
  const day = value as Partial<DayData>;
  return Boolean(
    day.brainDump ||
    day.topPriority ||
    day.secondaryMoves ||
    day.niceToHaves ||
    day.projectPlan ||
    day.movedForward ||
    day.howItFelt ||
    day.schedule?.length ||
    day.texts?.length ||
    day.emails?.length ||
    day.shotList?.length
  );
}

function scoreDayData(value: Partial<DayData>) {
  return [
    value.brainDump?.length ?? 0,
    value.topPriority?.length ?? 0,
    value.secondaryMoves?.length ?? 0,
    value.projectPlan?.length ?? 0,
    value.schedule?.length ?? 0,
    value.shotList?.length ?? 0,
    value.texts?.length ?? 0,
    value.emails?.length ?? 0,
  ].reduce((sum, part) => sum + part, 0);
}

function calculateStreak(baseDate: Date, currentDay: Partial<DayData>, includeCurrentDay: boolean) {
  let streak = includeCurrentDay && isMeaningfulDayData(currentDay) ? 1 : 0;
  for (let i = 1; i <= 365; i++) {
    const date = new Date(baseDate);
    date.setDate(date.getDate() - i);
    const key = getStorageKeyForDate(date);
    const raw = localStorage.getItem(key);
    if (!raw) break;
    try {
      const parsed = JSON.parse(raw);
      if (isMeaningfulDayData(parsed)) streak += 1;
      else break;
    } catch {
      break;
    }
  }
  return streak;
}

function coerceTextList(value: unknown): string {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    return value
      .map((item) => {
        if (typeof item === "string") return item;
        if (item && typeof item === "object" && "text" in item && typeof (item as { text?: unknown }).text === "string") {
          return (item as { text: string }).text;
        }
        return "";
      })
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

function mergeTextLines(...values: Array<unknown>) {
  const seen = new Set<string>();
  const merged: string[] = [];
  values.forEach((value) => {
    coerceTextList(value)
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .forEach((line) => {
        if (seen.has(line)) return;
        seen.add(line);
        merged.push(line);
      });
  });
  return merged.join("\n");
}

function formatSavedDayLabel(key: string) {
  const raw = key.replace(/^jft-/, "");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    const [year, month, day] = raw.split("-").map(Number);
    const localDate = new Date(year, month - 1, day);
    return localDate.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
  }
  return raw;
}

function getSnapshotRawDate(key: string) {
  return key.replace(/^jft-/, "");
}

function autoGrow(el: HTMLTextAreaElement) {
  el.style.height = "auto";
  el.style.height = `${el.scrollHeight}px`;
}

function summarizeDayData(value: Partial<DayData>) {
  const summary: string[] = [];
  if (value.brainDump?.trim()) summary.push("brain dump");
  if (value.topPriority?.trim()) summary.push("top priority");
  if (value.schedule?.length) summary.push(`${value.schedule.length} block${value.schedule.length === 1 ? "" : "s"}`);
  if (value.shotList?.length) summary.push(`${value.shotList.length} shot item${value.shotList.length === 1 ? "" : "s"}`);
  if (value.projectPlan?.trim()) summary.push("project plan");
  if (value.texts?.length) summary.push(`${value.texts.length} text${value.texts.length === 1 ? "" : "s"}`);
  if (value.emails?.length) summary.push(`${value.emails.length} email${value.emails.length === 1 ? "" : "s"}`);
  return summary;
}

function summarizeListPreview(items: string[], limit = 3) {
  const cleaned = items.map((item) => item.trim()).filter(Boolean);
  if (!cleaned.length) return { preview: [], summary: "" };
  const preview = cleaned.slice(0, limit);
  const remainder = cleaned.length - preview.length;
  const summary = remainder > 0
    ? `${preview.join(" • ")} + ${remainder} more`
    : preview.join(" • ");
  return { preview, summary };
}

function hashString(value: string) {
  return value.split("").reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) % 100000, 7);
}

function buildEndOfDaySummary(briefing: TomorrowBriefing | undefined, isWeekendMode: boolean, dateLabel: string) {
  const completed = briefing?.completed ?? [];
  const open = briefing?.open ?? [];
  const pushedLater = briefing?.pushedLater ?? [];
  const archived = briefing?.archived ?? [];
  const totalHandled = completed.length + archived.length + pushedLater.length;
  const base = completed.length * 2 + (briefing?.movedForward?.trim() ? 2 : 0) + (briefing?.howItFelt?.trim() ? 1 : 0);
  const flavor = (hashString(`${dateLabel}-${completed.join("|")}-${open.join("|")}`) % 3);
  const score = base + flavor;

  let scoreLine = "You showed up in a big way.";
  if (score >= 9 || completed.length >= 5) {
    scoreLine = `${8 + flavor}/${7 + flavor} on the Productivity Scale. You killed it.`;
  } else if (score >= 5 || completed.length >= 2) {
    scoreLine = `${5 + flavor}/${4 + flavor} Apples. Go you.`;
  }

  const vibeLine = completed.length > 0
    ? `You moved ${completed.length} thing${completed.length === 1 ? "" : "s"} today and kept momentum alive.`
    : pushedLater.length > 0 || open.length > 0
    ? "You kept the thread alive, which absolutely counts."
    : "Even a quieter day still counts when you showed up for it.";

  return {
    headline: isWeekendMode ? "All of the epic s**t I got to do today, go, me!" : "You showed up today.",
    scoreLine,
    vibeLine,
    completedPreview: summarizeListPreview(completed, 4),
    openPreview: summarizeListPreview(open, 3),
    laterPreview: summarizeListPreview(pushedLater, 3),
    totalHandled,
  };
}

function extractChecklistItems(value: {
  topPriority?: string;
  secondaryMoves?: string;
  niceToHaves?: string;
}) {
  return [
    typeof value.topPriority === "string" ? value.topPriority.trim() : "",
    ...coerceTextList(value.secondaryMoves).split("\n").map((line) => line.trim()),
    ...coerceTextList(value.niceToHaves).split("\n").map((line) => line.trim()),
  ].filter(Boolean);
}

function cleanWeekendTaskText(value: string) {
  return value
    .replace(/\((?:this|that)\s+should[\s\S]*?\)/gi, "")
    .replace(/\b(?:this|that)\s+should\b[\s\S]*$/i, "")
    .replace(/\bshould\s+(?:prompt|populate|include|add|create|generate)\b[\s\S]*$/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s+[.,;:!?]+$/g, "")
    .trim();
}

function extractWeekendBrainDumpItems(brainDump: string) {
  const lines = brainDump
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
  const explicitBullets = lines.filter((line) => /^[-*•]\s+/.test(line) || /^\d+\.\s+/.test(line));
  const source = explicitBullets.length ? explicitBullets : lines;

  return source
    .map((line) => line.replace(/^[-*•]\s+/, "").replace(/^\d+\.\s+/, "").trim())
    .map(cleanWeekendTaskText)
    .filter((line) => line.length > 3)
    .filter((line) => !/^alright[, ]/i.test(line))
    .filter((line) => !/^today[, ]/i.test(line));
}

function uniqueTextDrafts(drafts: TextDraft[]) {
  const seen = new Set<string>();
  return drafts.filter((draft) => {
    const key = `${draft.to.toLowerCase()}|${draft.draft.trim().toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueShotList(items: string[]) {
  const seen = new Set<string>();
  return items
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item) => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .map((text) => ({ text, done: false, archived: false }));
}

function normalizeTextDrafts(value: unknown): TextDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<TextDraft>;
      if (typeof candidate.to !== "string" || typeof candidate.draft !== "string") return null;
      return {
        to: candidate.to,
        draft: candidate.draft,
        done: Boolean(candidate.done),
      };
    })
    .filter((item): item is TextDraft => Boolean(item));
}

function normalizeEmailDrafts(value: unknown): EmailDraft[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<EmailDraft>;
      if (typeof candidate.to !== "string" || typeof candidate.subject !== "string" || typeof candidate.draft !== "string") return null;
      return {
        to: candidate.to,
        subject: candidate.subject,
        draft: candidate.draft,
      };
    })
    .filter((item): item is EmailDraft => Boolean(item));
}

function normalizeScheduleBlocks(value: unknown): ScheduleBlock[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (!item || typeof item !== "object") return null;
      const candidate = item as Partial<ScheduleBlock>;
      if (typeof candidate.time !== "string" || typeof candidate.task !== "string") return null;
      return {
        time: candidate.time,
        task: candidate.task,
        note: typeof candidate.note === "string" ? candidate.note : "",
      };
    })
    .filter((item): item is ScheduleBlock => Boolean(item));
}

function getWeekendTaskHelpers(task: string): WeekendTaskHelperAction[] {
  const lower = task.toLowerCase();
  const helpers: WeekendTaskHelperAction[] = [];

  if (lower.includes("elliot")) {
    helpers.push({
      kind: "copyText",
      label: "Copy Elliot text",
      value: "Hey Elliot, I'm looking at BC Club Europe timing for the end of April / May. Any chance I could crash at your place if the dates line up?",
    });
  }

  if (lower.includes("ridwan")) {
    helpers.push({
      kind: "copyText",
      label: "Copy Ridwan text",
      value: "Hey Ridwan, I'm mapping BC Club Europe dates for the end of April / May. Any chance I could crash at your place if the timing works?",
    });
  }

  if (lower.includes("leti")) {
    helpers.push({
      kind: "copyText",
      label: "Copy Leti text",
      value: "Hey Leti, would a Mushroom Sesh next weekend work, or would the following weekend be better? Happy to book two nights if that feels right.",
    });
  }

  if (lower.includes("jeff")) {
    helpers.push({
      kind: "copyText",
      label: "Copy Jeff text",
      value: "Hey Jeff, sending a Partiful invite your way. If anyone cool comes to mind, invite someone interesting and let's expand the group a bit.",
    });
  }

  if (lower.includes("lisa")) {
    helpers.push({
      kind: "copyText",
      label: "Copy Lisa text",
      value: "Hey Lisa, sending a Partiful invite your way. If anyone cool comes to mind, invite someone interesting and let's expand the group a bit.",
    });
  }

  if (lower.includes("bc club") || lower.includes("breakfastclubbing") || lower.includes("europe")) {
    helpers.push({
      kind: "link",
      label: "Open BreakfastClubbing",
      value: "https://breakfastclubbing.com",
    });
  }

  if (lower.includes("partiful")) {
    helpers.push({
      kind: "link",
      label: "Open Partiful",
      value: "https://partiful.com/create",
    });
  }

  if (lower.includes("ups") || lower.includes("label") || lower.includes("dad's shoes") || lower.includes("grandma")) {
    helpers.push({
      kind: "link",
      label: "Open Pack Pirate",
      value: "https://www.pirateship.com",
    });
  }

  if (
    lower.includes("substack pull") ||
    lower.includes("word cloud") ||
    lower.includes("wireframe") ||
    lower.includes("map out a prompt") ||
    lower.includes("weekend view") ||
    lower.includes("build out")
  ) {
    const brief = lower.includes("substack pull")
      ? [
          "Write a Codex implementation prompt for a 'Substack Pull' feature for BC Club Sunday reminders from Ben.",
          "Include the product goal, likely data flow, the smallest useful prototype, and what to ship first.",
          "Keep it practical and scoped for this app.",
        ].join("\n\n")
      : lower.includes("word cloud")
      ? [
          "Write a Codex implementation prompt for a 'Word Cloud' feature for clubs.",
          "Help decide where it should live on the site, especially whether it belongs in a featured section.",
          "Keep the result concrete, visual, and scoped to an MVP.",
        ].join("\n\n")
      : [
          `Break this down into a clean implementation prompt for Codex: ${task}`,
          "Focus on the smallest useful version to ship today.",
        ].join("\n\n");

    helpers.push({
      kind: "prompt",
      label: "Generate prompt",
      value: brief,
    });
  }

  return helpers;
}

function summarizeMovedForward(value: string) {
  const clean = value
    .replace(/[“”"]/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!clean) return "";

  const clauses = clean
    .split(/[.!?;]+|\band\b/gi)
    .map((part) => part.trim())
    .filter((part) => part.length > 10);

  const first = clauses[0];
  const second = clauses[1];
  const bigWin =
    clauses.find((part) => /\b(first dollar|big win|huge|thanks|landed|sold|booked|shipped|finished)\b/i.test(part)) ||
    clauses[2] ||
    clauses[1] ||
    clauses[0];

  if (first && second && bigWin) {
    return `You moved ${first} forward, and ${second} forward. And got a big win in the form of ${bigWin}. Great work, self!`;
  }
  if (first && bigWin) {
    return `You moved ${first} forward. And got a big win in the form of ${bigWin}. Great work, self!`;
  }
  return `You moved something meaningful forward today. Great work, self!`;
}

function summarizeHowItFelt(value: string) {
  const clean = value.toLowerCase();
  if (!clean.trim()) return "";
  const frustrated = /\b(frustrat|tough|hard|rough|so-so|bad|overwhelmed|exhaust|stuck|messy)\b/.test(clean);
  if (frustrated) {
    return "Dang! Seemed like it was a so-so day, but here's the good news... Tomorrow's a new day.";
  }
  return "Seemed like today was a good day. Tomorrow's gonna be an even better today.";
}

function normalizeDayData(value: Partial<DayData>) {
  const normalized = { ...value } as Partial<DayData> & { interviewQuestions?: string[] };
  normalized.brainDump = typeof normalized.brainDump === "string" ? normalized.brainDump : "";
  normalized.topPriority = typeof normalized.topPriority === "string" ? normalized.topPriority : "";
  normalized.secondaryMoves = coerceTextList(normalized.secondaryMoves);
  normalized.niceToHaves = coerceTextList(normalized.niceToHaves);
  normalized.projectPlan = coerceTextList(normalized.projectPlan);
  normalized.projectLink = typeof normalized.projectLink === "string" ? normalized.projectLink : "";
  normalized.howItFelt = typeof normalized.howItFelt === "string" ? normalized.howItFelt : "";
  normalized.midDayFeeling = typeof normalized.midDayFeeling === "string" ? normalized.midDayFeeling : "";
  normalized.movedForward = typeof normalized.movedForward === "string" ? normalized.movedForward : "";
  normalized.weekendVibes = typeof normalized.weekendVibes === "string" ? normalized.weekendVibes : "";
  normalized.weekendLinks = typeof normalized.weekendLinks === "string" ? normalized.weekendLinks : "";
  normalized.savedForDate = typeof normalized.savedForDate === "string" ? normalized.savedForDate : undefined;
  if (normalized.interviewQuestions?.length && !normalized.interviewees?.length) {
    normalized.interviewees = [{ name: "Questions", questions: normalized.interviewQuestions }];
  }
  delete normalized.interviewQuestions;
  if (normalized.schedule?.length) normalized.schedule = sanitizeSchedule(normalized.schedule);
  normalized.sectionOrder = Array.isArray(normalized.sectionOrder)
    ? [...normalized.sectionOrder, ...DEFAULT_SECTION_ORDER.filter((id) => !normalized.sectionOrder!.includes(id))]
    : DEFAULT_SECTION_ORDER;
  return { ...EMPTY, ...normalized };
}

function withSavedDate(data: DayData, storageKey: string) {
  return {
    ...data,
    savedForDate: storageKey.replace(/^jft-/, ""),
  };
}

const PRINT_STYLES = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Georgia', serif; background: #fff; color: #1a1a1a; }
  .page { padding: 56px 64px; max-width: 780px; margin: 0 auto; }
  .header { border-bottom: 2px solid #1a1a1a; padding-bottom: 18px; margin-bottom: 32px; }
  .project { font-size: 11px; font-family: Arial, sans-serif; text-transform: uppercase; letter-spacing: 3px; color: #999; margin-bottom: 8px; }
  .subject { font-size: 28px; font-weight: bold; line-height: 1.2; }
  .meta { font-size: 11px; font-family: Arial, sans-serif; color: #bbb; margin-top: 8px; }
  .questions { list-style: none; }
  .q { display: flex; gap: 20px; padding: 13px 0; border-bottom: 1px solid #f0f0f0; }
  .q:last-child { border-bottom: none; }
  .num { font-size: 11px; font-family: Arial, sans-serif; color: #bbb; min-width: 24px; padding-top: 3px; }
  .text { font-size: 15px; line-height: 1.65; }
  @media print {
    .page { padding: 40px 48px; }
    .page-break { page-break-after: always; }
    body { -webkit-print-color-adjust: exact; }
  }
`;

function interviewPageHtml(projectTitle: string, personName: string, questions: string[], isLast = true) {
  return `<div class="page${isLast ? "" : " page-break"}">
    <div class="header">
      <p class="project">${projectTitle}</p>
      <p class="subject">${personName}</p>
      <p class="meta">${questions.length} questions</p>
    </div>
    <ol class="questions">
      ${questions.map((q, i) => `<li class="q"><span class="num">${i + 1}.</span><span class="text">${q}</span></li>`).join("")}
    </ol>
  </div>`;
}

function printOnePager(projectTitle: string, personName: string, questions: string[]) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${projectTitle} | ${personName}</title><style>${PRINT_STYLES}</style></head><body>
    ${interviewPageHtml(projectTitle, personName, questions)}
  </body></html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 300);
}

function printAllInterviews(projectTitle: string, interviewees: { name: string; questions: string[] }[]) {
  const win = window.open("", "_blank");
  if (!win) return;
  const pages = interviewees
    .map((p, i) => interviewPageHtml(projectTitle, p.name, p.questions, i === interviewees.length - 1))
    .join("");
  win.document.write(`<!DOCTYPE html><html><head><title>${projectTitle} — All Interviews</title><style>${PRINT_STYLES}</style></head><body>
    ${pages}
  </body></html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 300);
}

async function copyHtmlToClipboard(html: string) {
  try {
    await navigator.clipboard.write([
      new ClipboardItem({ "text/html": new Blob([html], { type: "text/html" }) }),
    ]);
  } catch {
    // Fallback to plain text
    const tmp = document.createElement("div");
    tmp.innerHTML = html;
    await navigator.clipboard.writeText(tmp.innerText);
  }
}

function openAsGoogleDoc(projectTitle: string, interviewees: { name: string; questions: string[] }[]) {
  // One Google Doc per person — each opens as its own tab
  interviewees.forEach((p, i) => {
    const html = `
      <h1>${projectTitle} | ${p.name}</h1>
      <p style="color:#999;font-size:12px">${p.questions.length} questions</p>
      <hr/>
      <ol>${p.questions.map(q => `<li><p>${q}</p></li>`).join("")}</ol>`;
    setTimeout(() => {
      copyHtmlToClipboard(html).then(() => {
        window.open("https://docs.google.com/document/create", "_blank");
      });
    }, i * 600); // stagger so browser doesn't block multiple popups
  });
}

function saveDayToGoogleDoc(data: DayData, today: string) {
  const s = (t: string) => `<h2 style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#999;margin-top:32px">${t}</h2>`;
  const li = (t: string) => `<li><p>${t}</p></li>`;

  let html = `<h1 style="font-size:28px">Just for Today</h1><p style="color:#999">${today}</p><hr/>`;

  if (data.topPriority)    html += `${s("Top Priority")}<p><strong>${data.topPriority}</strong></p>`;
  if (data.secondaryMoves) html += `${s("Secondary Moves")}<p>${data.secondaryMoves}</p>`;
  if (data.niceToHaves)    html += `${s("Nice to Haves")}<p>${data.niceToHaves}</p>`;

  if (data.schedule.length) {
    html += s("Today's Schedule");
    html += `<table style="border-collapse:collapse;width:100%">${
      data.schedule.map(b => `<tr><td style="color:#999;padding:6px 16px 6px 0;white-space:nowrap;vertical-align:top">${b.time}</td><td style="padding:6px 0"><strong>${b.task}</strong>${b.note ? `<br/><span style="color:#999">${b.note}</span>` : ""}</td></tr>`).join("")
    }</table>`;
  }

  if (data.texts.length) {
    html += s("Texts to Send");
    data.texts.forEach(t => {
      html += `<p><strong>To: ${t.to}</strong></p><blockquote style="border-left:3px solid #ddd;margin:4px 0;padding-left:12px;color:#555">${t.draft}</blockquote>`;
    });
  }

  if (data.emails.length) {
    html += s("Emails to Send");
    data.emails.forEach(e => {
      html += `<p><strong>To: ${e.to}</strong> — ${e.subject}</p><blockquote style="border-left:3px solid #ddd;margin:4px 0;padding-left:12px;color:#555">${e.draft.replace(/\n/g, "<br/>")}</blockquote>`;
    });
  }

  if (data.projectPlan) {
    html += s("Project Plan");
    data.projectPlan.split("\n").filter(Boolean).forEach(line => {
      html += `<p>• ${line.replace(/^[•–]\s*/, "")}</p>`;
    });
  }

  if (data.shotList.length) {
    html += s("Shot List");
    html += `<ul>${data.shotList.map(i => li(i.text)).join("")}</ul>`;
  }

  if (data.meetingPrep.title || data.meetingPrep.notes || data.meetingPrep.agenda || data.meetingPrep.followUpActions) {
    html += s("Meeting Prep");
    if (data.meetingPrep.title) html += `<p><strong>${data.meetingPrep.title}</strong></p>`;
    if (data.meetingPrep.notes) html += `<p>${data.meetingPrep.notes.replace(/\n/g, "<br/>")}</p>`;
    if (data.meetingPrep.agenda) html += `<p><strong>Agenda</strong><br/>${data.meetingPrep.agenda.replace(/\n/g, "<br/>")}</p>`;
    if (data.meetingPrep.followUpActions) html += `<p><strong>Follow-up actions</strong><br/>${data.meetingPrep.followUpActions.replace(/\n/g, "<br/>")}</p>`;
  }

  if (data.interviewees.length) {
    const projectTitle = getInterviewTitle(data.interviewGameplan);
    html += s("Interview Questions");
    data.interviewees.forEach(p => {
      html += `<h3>${projectTitle} | ${p.name}</h3><ol>${p.questions.map(q => li(q)).join("")}</ol>`;
    });
  }

  copyHtmlToClipboard(html).then(() => {
    window.open("https://docs.google.com/document/create", "_blank");
  });
}

function printList(title: string, items: string[]) {
  const win = window.open("", "_blank");
  if (!win) return;
  win.document.write(`<!DOCTYPE html><html><head><title>${title}</title><style>
    body { font-family: 'Georgia', serif; padding: 60px; max-width: 700px; margin: 0 auto; }
    h1 { font-size: 13px; color: #aaa; text-transform: uppercase; letter-spacing: 3px; margin-bottom: 40px; font-family: Arial, sans-serif; }
    .item { display: flex; align-items: flex-start; gap: 16px; padding: 14px 0; border-bottom: 1px solid #f0f0f0; }
    .box { width: 18px; height: 18px; border: 1.5px solid #ccc; border-radius: 50%; margin-top: 2px; shrink: 0; }
    .text { font-size: 16px; line-height: 1.5; color: #1a1a1a; }
  </style></head><body>
  <h1>${title}</h1>
  ${items.map(t => `<div class="item"><div class="box"></div><p class="text">${t}</p></div>`).join("")}
  </body></html>`);
  win.document.close();
  setTimeout(() => { win.print(); }, 300);
}

// ─── Small UI components ──────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-1">{children}</p>;
}

function SectionTitle({ sectionKey, defaultTitle, sectionTitles, onSave }: {
  sectionKey: string; defaultTitle: string;
  sectionTitles: Record<string, string>;
  onSave: (key: string, val: string) => void;
}) {
  const [editing, setEditing] = useState(false);
  const title = sectionTitles[sectionKey] || defaultTitle;
  const [draft, setDraft] = useState("");
  const commit = () => { if (draft.trim()) onSave(sectionKey, draft.trim()); setEditing(false); };
  if (editing) {
    return (
      <input autoFocus
        className="min-w-0 w-full text-2xl font-black text-stone-800 bg-transparent outline-none border-b-2 border-stone-300 pb-1 mb-2"
        style={{ fontFamily: "var(--font-playfair)" }}
        value={draft} onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => { if (e.key === "Enter") commit(); if (e.key === "Escape") setEditing(false); }}
      />
    );
  }
  return (
    <h2 onClick={() => { setDraft(title); setEditing(true); }}
      className="min-w-0 flex-1 text-2xl font-black text-stone-800 mb-2 cursor-text leading-[1.05] hover:opacity-70 transition-opacity break-words"
      style={{ fontFamily: "var(--font-playfair)" }}
      title="Click to rename">
      {title}
    </h2>
  );
}

function Card({ children, className = "", id, style }: { children: React.ReactNode; className?: string; id?: string; style?: React.CSSProperties }) {
  return <div id={id} style={style} className={`rounded-2xl border border-stone-200 bg-stone-50 p-6 md:p-8 ${className}`}>{children}</div>;
}

function Field({ label, value, onChange, placeholder, multiline = false, rows = 4 }: {
  label?: string; value: string; onChange: (v: string) => void;
  placeholder: string; multiline?: boolean; rows?: number;
}) {
  const base = "w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none";
  return (
    <div className="mb-4">
      {label && <label className="block text-sm font-medium text-stone-500 mb-1.5">{label}</label>}
      {multiline
        ? <textarea
            className={base}
            rows={rows}
            placeholder={placeholder}
            value={value}
            onChange={(e) => {
              onChange(e.target.value);
              autoGrow(e.target);
            }}
            onFocus={(e) => autoGrow(e.target)}
          />
        : <input type="text" className={base} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />}
    </div>
  );
}

function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
      className="text-xs text-stone-400 hover:text-stone-700 border border-stone-200 rounded-lg px-3 py-1 transition-colors shrink-0">
      {copied ? "Copied ✓" : label}
    </button>
  );
}

function BulletedField({ label, value, onChange, placeholder, rows = 3 }: {
  label: string; value: unknown; onChange: (v: string) => void; placeholder: string; rows?: number;
}) {
  const [editing, setEditing] = useState(false);
  const [lineMenu, setLineMenu] = useState<number | null>(null);
  const safeValue = coerceTextList(value);
  const lines = safeValue.split("\n").filter(l => l.trim());

  const removeLine = (i: number) => {
    const updated = lines.filter((_, idx) => idx !== i).join("\n");
    onChange(updated);
  };

  return (
    <div className="mb-4">
      <label className="block text-sm font-medium text-stone-500 mb-1.5">{label}</label>
      {!editing && lines.length > 0 ? (
        <div className="rounded-xl border border-stone-200 bg-white px-4 py-3 hover:border-stone-300 transition-colors">
          {lines.map((line, i) => {
            const clean = line.replace(/^[•\-\*◆]\s*/, "");
            return (
              <div key={i} className="flex items-start gap-2.5 py-0.5 group relative">
                <span className="text-amber-400 text-xs mt-1.5 shrink-0">◆</span>
                <span className="text-sm text-stone-600 leading-relaxed flex-1 cursor-text" onClick={() => setEditing(true)}>{clean}</span>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all shrink-0 mt-0.5">
                  <button
                    onClick={(e) => { e.stopPropagation(); setLineMenu(lineMenu === i ? null : i); }}
                    className="text-stone-300 hover:text-stone-600 text-xs px-1 rounded hover:bg-stone-100">
                    ···
                  </button>
                  <button onClick={() => removeLine(i)}
                    className="text-stone-300 hover:text-rose-400 text-xs">✕</button>
                </div>
                {lineMenu === i && (
                  <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-stone-200 rounded-xl shadow-lg py-1 min-w-[170px]" onClick={e => e.stopPropagation()}>
                    <button onClick={() => { navigator.clipboard.writeText(clean); setLineMenu(null); }}
                      className="w-full text-left px-4 py-2 text-xs text-stone-600 hover:bg-stone-50">
                      📋 Copy to clipboard
                    </button>
                    <button onClick={() => {
                      const draft = `Hey — following up on: ${clean}`;
                      navigator.clipboard.writeText(draft); setLineMenu(null);
                      alert("Draft copied — paste into WhatsApp or Messages.");
                    }} className="w-full text-left px-4 py-2 text-xs text-stone-600 hover:bg-stone-50">
                      💬 Copy as message draft
                    </button>
                    <div className="border-t border-stone-100 my-1" />
                    <button onClick={() => { removeLine(i); setLineMenu(null); }}
                      className="w-full text-left px-4 py-2 text-xs text-rose-400 hover:bg-rose-50">
                      ✕ Remove
                    </button>
                  </div>
                )}
              </div>
            );
          })}
          <p className="text-xs text-stone-300 mt-2 cursor-text" onClick={() => setEditing(true)}>click to edit</p>
        </div>
      ) : (
        <textarea
          autoFocus={editing}
          className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-base text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none"
          rows={rows}
          placeholder={placeholder}
          value={safeValue}
          onChange={(e) => {
            onChange(e.target.value);
            autoGrow(e.target);
          }}
          onFocus={(e) => autoGrow(e.target)}
          onBlur={() => setEditing(false)}
        />
      )}
    </div>
  );
}

function NiceToHaves({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <BulletedField
      label="Nice-to-haves"
      value={value}
      onChange={onChange}
      placeholder={"If there's time and energy...\n(one item per line)"}
    />
  );
}

function GhostButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="text-xs text-stone-400 hover:text-stone-700 border border-stone-200 rounded-lg px-3 py-1 transition-colors disabled:opacity-40">
      {children}
    </button>
  );
}

function CoachNote({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 mb-1">Coach note</p>
      <p className="text-sm text-amber-900 leading-relaxed">{children}</p>
    </div>
  );
}

function NextActionButton({ onClick, label = "I'm ready for the next action" }: { onClick: () => void; label?: string }) {
  return (
    <button
      onClick={onClick}
      className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-colors"
    >
      {label} <span aria-hidden="true">→</span>
    </button>
  );
}

function AddTextForm({ onAdd }: { onAdd: (to: string, context: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [context, setContext] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!to.trim()) return;
    setLoading(true);
    await onAdd(to.trim(), context.trim());
    setTo(""); setContext(""); setOpen(false); setLoading(false);
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="mt-3 w-full rounded-xl border border-dashed border-stone-200 py-2 text-xs text-stone-400 hover:text-stone-600 hover:border-stone-400 transition-colors">
      + Add someone
    </button>
  );
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4 space-y-2">
      <input type="text" placeholder="Who?" value={to} onChange={e => setTo(e.target.value)}
        className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-300" />
      <input type="text" placeholder="What's the context? (e.g. follow up on the proposal)" value={context} onChange={e => setContext(e.target.value)}
        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); submit(); } }}
        className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-300" />
      <div className="flex gap-2">
        <button onClick={submit} disabled={loading || !to.trim()}
          className="flex-1 rounded-lg bg-stone-800 text-white px-3 py-2 text-xs font-medium hover:bg-stone-700 disabled:opacity-40 transition-colors">
          {loading ? "Generating…" : "Generate draft"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-400 hover:text-stone-700 transition-colors">Cancel</button>
      </div>
    </div>
  );
}

function AddEmailForm({ onAdd }: { onAdd: (to: string, subject: string, notes: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [to, setTo] = useState("");
  const [subject, setSubject] = useState("");
  const [notes, setNotes] = useState("");
  const [loading, setLoading] = useState(false);
  const submit = async () => {
    if (!to.trim()) return;
    setLoading(true);
    await onAdd(to.trim(), subject.trim(), notes.trim());
    setTo(""); setSubject(""); setNotes(""); setOpen(false); setLoading(false);
  };
  if (!open) return (
    <button onClick={() => setOpen(true)} className="mt-3 w-full rounded-xl border border-dashed border-stone-200 py-2 text-xs text-stone-400 hover:text-stone-600 hover:border-stone-400 transition-colors">
      + Add someone
    </button>
  );
  return (
    <div className="mt-3 rounded-xl border border-stone-200 bg-white p-4 space-y-2">
      <input type="text" placeholder="To (name or email)" value={to} onChange={e => setTo(e.target.value)}
        className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-300" />
      <input type="text" placeholder="Subject" value={subject} onChange={e => setSubject(e.target.value)}
        className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-300" />
      <textarea placeholder="Notes — what do you need to say?" value={notes} onChange={e => setNotes(e.target.value)} rows={2}
        className="w-full rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-300 resize-none" />
      <div className="flex gap-2">
        <button onClick={submit} disabled={loading || !to.trim()}
          className="flex-1 rounded-lg bg-stone-800 text-white px-3 py-2 text-xs font-medium hover:bg-stone-700 disabled:opacity-40 transition-colors">
          {loading ? "Generating…" : "Generate draft"}
        </button>
        <button onClick={() => setOpen(false)} className="rounded-lg border border-stone-200 px-3 py-2 text-xs text-stone-400 hover:text-stone-700 transition-colors">Cancel</button>
      </div>
    </div>
  );
}

function EmailModal({ email, onClose }: { email: EmailDraft; onClose: () => void }) {
  const [draft, setDraft] = useState(email.draft);
  const [context, setContext] = useState("");
  const [refining, setRefining] = useState(false);

  const openInHey = () => {
    const url = `https://app.hey.com/compose?to=${encodeURIComponent(email.to)}&subject=${encodeURIComponent(email.subject)}&body=${encodeURIComponent(draft)}`;
    window.open(url, "_blank");
  };

  const refine = async () => {
    if (!context.trim()) return;
    setRefining(true);
    try {
      const res = await fetch("/api/nudge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: `Rewrite this email based on the context below. Return only the new email body, nothing else.\n\nOriginal email:\n${draft}\n\nContext / changes:\n${context}` }),
      });
      const { message } = await res.json();
      if (message) { setDraft(message); setContext(""); }
    } catch {}
    setRefining(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-stone-100 overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        {/* Header */}
        <div className="px-8 pt-7 pb-4 border-b border-stone-100">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">To: {email.to}</p>
          <p className="text-base font-bold text-stone-800">{email.subject}</p>
        </div>
        {/* Editable draft */}
        <div className="px-8 py-5 flex-1 overflow-y-auto">
          <textarea
            className="w-full text-sm text-stone-600 leading-relaxed resize-none border-none outline-none bg-transparent"
            rows={8}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
          />
        </div>
        {/* Refine area */}
        <div className="px-8 pb-4 border-t border-stone-100 pt-4">
          <div className="flex gap-2">
            <input
              type="text"
              className="flex-1 rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-600 placeholder-stone-300 focus:outline-none focus:ring-1 focus:ring-stone-300"
              placeholder="Add context to refine… e.g. 'make it shorter and more direct'"
              value={context}
              onChange={(e) => setContext(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); refine(); } }}
            />
            <button onClick={refine} disabled={refining || !context.trim()}
              className="rounded-xl border border-stone-200 bg-stone-50 px-3 py-2 text-xs text-stone-500 hover:text-stone-800 disabled:opacity-40 transition-colors whitespace-nowrap">
              {refining ? "..." : "Refine →"}
            </button>
          </div>
        </div>
        {/* Actions */}
        <div className="px-8 pb-7 flex items-center gap-3">
          <button onClick={openInHey}
            className="flex-1 rounded-xl bg-stone-800 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-700 transition-colors text-center">
            Open in Hey ✉️
          </button>
          <CopyButton text={`Subject: ${email.subject}\n\n${draft}`} label="Copy" />
          <button onClick={onClose} className="text-xs text-stone-300 hover:text-stone-500 transition-colors">✕</button>
        </div>
      </div>
    </div>
  );
}

function MeetingPrepModal({
  meetingPrep,
  onChange,
  onClose,
  onGeneratePrompt,
}: {
  meetingPrep: MeetingPrep;
  onChange: (field: keyof MeetingPrep, value: string) => void;
  onClose: () => void;
  onGeneratePrompt: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-stone-100 overflow-hidden flex flex-col max-h-[90vh]" onClick={(e) => e.stopPropagation()}>
        <div className="px-8 pt-7 pb-4 border-b border-stone-100">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">Meeting Prep</p>
          <p className="text-base font-bold text-stone-800">Keep the call context in one place.</p>
        </div>
        <div className="px-8 py-6 space-y-4 overflow-y-auto">
          <div>
            <label className="block text-sm font-medium text-stone-500 mb-1.5">Title</label>
            <input
              type="text"
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
              placeholder="Prep for meeting with Ben"
              value={meetingPrep.title}
              onChange={(e) => onChange("title", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-500 mb-1.5">Meeting notes</label>
            <textarea
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none"
              rows={8}
              placeholder={"BreakfastClubbing.com\nRoadmap priorities\nWhat Ben needs from me\nWhat decisions we need to make"}
              value={meetingPrep.notes}
              onChange={(e) => onChange("notes", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-500 mb-1.5">Agenda / outcomes</label>
            <textarea
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none"
              rows={4}
              placeholder={"1. Review BreakfastClubbing.com status\n2. Align on roadmap\n3. Leave with next actions"}
              value={meetingPrep.agenda}
              onChange={(e) => onChange("agenda", e.target.value)}
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-stone-500 mb-1.5">Follow-up actions?</label>
            <textarea
              className="w-full rounded-xl border border-stone-200 bg-stone-50 px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none"
              rows={4}
              placeholder={"Send Ben roadmap recap\nTurn decisions into tasks\nWrite next-pass prompt for BreakfastClubbing.com"}
              value={meetingPrep.followUpActions}
              onChange={(e) => onChange("followUpActions", e.target.value)}
            />
          </div>
        </div>
        <div className="px-8 pb-7 pt-4 border-t border-stone-100 flex items-center gap-3">
          <CopyButton
            text={[
              meetingPrep.title,
              meetingPrep.notes,
              meetingPrep.agenda ? `Agenda\n${meetingPrep.agenda}` : "",
              meetingPrep.followUpActions ? `Follow-up actions\n${meetingPrep.followUpActions}` : "",
            ].filter(Boolean).join("\n\n")}
            label="Copy notes"
          />
          <GhostButton onClick={onGeneratePrompt}>
            Generate prompt
          </GhostButton>
          <button onClick={onClose} className="ml-auto rounded-xl bg-stone-800 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-700 transition-colors">
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function ReflectionModal({
  data,
  onClose,
  onUpdate,
  onFinish,
}: {
  data: DayData;
  onClose: () => void;
  onUpdate: (field: "howItFelt" | "movedForward", value: string) => void;
  onFinish: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-xl border border-stone-100 overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-8 pt-7 pb-4 border-b border-stone-100">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">End of Day Reflection</p>
          <p className="text-base font-bold text-stone-800">Wrap the day gently and carry the right things forward.</p>
        </div>
        <div className="px-8 py-6 space-y-4 overflow-y-auto">
          <Field
            label="How did today feel?"
            value={data.howItFelt}
            onChange={(value) => onUpdate("howItFelt", value)}
            placeholder="A few words, or a few paragraphs..."
            multiline
            rows={3}
          />
          <Field
            label="Did you move something important forward?"
            value={data.movedForward}
            onChange={(value) => onUpdate("movedForward", value)}
            placeholder="Even a small step counts..."
            multiline
            rows={3}
          />
        </div>
        <div className="px-8 pb-7 pt-4 border-t border-stone-100 flex items-center gap-3">
          <button
            onClick={onClose}
            className="rounded-xl border border-stone-200 px-4 py-2.5 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-colors"
          >
            Keep editing
          </button>
          <button
            onClick={onFinish}
            className="ml-auto rounded-xl bg-stone-800 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-700 transition-colors"
          >
            Finish the Day
          </button>
        </div>
      </div>
    </div>
  );
}

function PromptModal({
  title,
  prompt,
  loading,
  onClose,
}: {
  title: string;
  prompt: string;
  loading: boolean;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={onClose}>
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-2xl border border-stone-100 overflow-hidden max-h-[90vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
        <div className="px-8 pt-7 pb-4 border-b border-stone-100">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">Generated Prompt</p>
          <p className="text-base font-bold text-stone-800">{title}</p>
        </div>
        <div className="px-8 py-6 overflow-y-auto">
          {loading ? (
            <p className="text-sm text-stone-500">Building your prompt…</p>
          ) : (
            <textarea
              readOnly
              value={prompt}
              rows={14}
              className="w-full rounded-2xl border border-stone-200 bg-stone-50 px-4 py-4 text-sm leading-relaxed text-stone-700 resize-none focus:outline-none"
              onFocus={(e) => autoGrow(e.target)}
            />
          )}
        </div>
        <div className="px-8 pb-7 pt-4 border-t border-stone-100 flex items-center gap-3">
          {!loading && !!prompt.trim() && <CopyButton text={prompt} label="Copy prompt" />}
          <button
            onClick={onClose}
            className="ml-auto rounded-xl bg-stone-800 text-white px-4 py-2.5 text-sm font-medium hover:bg-stone-700 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

function SectionControlButton({
  icon,
  label,
  onClick,
  showLabel,
  subtle = false,
}: {
  icon: string;
  label: string;
  onClick: () => void;
  showLabel: boolean;
  subtle?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      title={label}
      aria-label={label}
      className={`inline-flex items-center gap-1.5 rounded-xl border px-2.5 py-1.5 text-xs transition-colors ${
        subtle
          ? "border-stone-200 bg-white text-stone-400 hover:border-stone-400 hover:text-stone-700"
          : "border-stone-200 bg-white text-stone-500 hover:border-stone-400 hover:text-stone-800"
      }`}
    >
      <span aria-hidden="true">{icon}</span>
      {showLabel && <span>{label}</span>}
    </button>
  );
}

function SectionControls({
  sectionKey,
  sectionId,
  done,
  state,
  onToggleDone,
  onSetState,
  onMove,
  allowDefer = true,
  allowArchive = true,
  allowMove = true,
}: {
  sectionKey: string;
  sectionId: string;
  done: boolean;
  state?: "later" | "archived";
  onToggleDone: (key: string) => void;
  onSetState: (key: string, state?: "later" | "archived") => void;
  onMove: (id: string, direction: -1 | 1) => void;
  allowDefer?: boolean;
  allowArchive?: boolean;
  allowMove?: boolean;
}) {
  const [showMore, setShowMore] = useState(false);

  return (
    <div className="flex max-w-full items-center gap-2 shrink-0 flex-wrap justify-start">
      <SectionControlButton
        icon={done ? "✅" : "☐"}
        label={done ? "Done" : "Mark done"}
        onClick={() => onToggleDone(sectionKey)}
        showLabel={false}
      />
      {allowDefer && (
        <SectionControlButton
          icon={state === "later" ? "🕓" : "⏭"}
          label={state === "later" ? "Later" : "Push later"}
          onClick={() => onSetState(sectionKey, state === "later" ? undefined : "later")}
          showLabel={false}
        />
      )}
      {allowArchive && (
        <SectionControlButton
          icon="🗑️"
          label={state === "archived" ? "Trashed" : "Trash"}
          onClick={() => onSetState(sectionKey, state === "archived" ? undefined : "archived")}
          showLabel={false}
        />
      )}
      <SectionControlButton
        icon={showMore ? "▴" : "▾"}
        label={showMore ? "Hide" : "More Options"}
        onClick={() => setShowMore((value) => !value)}
        showLabel={true}
        subtle
      />
      {showMore && allowMove && (
        <SectionControlButton icon="⬆️" label="Move up" onClick={() => onMove(sectionId, -1)} showLabel={true} />
      )}
      {showMore && allowMove && (
        <SectionControlButton icon="⬇️" label="Move down" onClick={() => onMove(sectionId, 1)} showLabel={true} />
      )}
    </div>
  );
}

// ─── Day Plan Review Modal ────────────────────────────────────────────────────

function PlanGroup({ icon, label, items, dim }: { icon: string; label: string; items: string[]; dim?: boolean }) {
  if (!items.length) return null;
  return (
    <div className={`mb-5 ${dim ? "opacity-60" : ""}`}>
      <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">{icon} {label}</p>
      <div className="space-y-1.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-2.5">
            <span className="text-amber-400 text-xs mt-1.5 shrink-0">◆</span>
            <span className="text-sm text-stone-700 leading-relaxed">{item}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DayPlanModal({
  data,
  today,
  onClose,
  isWeekendMode,
  onStartFresh,
  onSaveToDoc,
  onPrepMeeting,
}: {
  data: DayData;
  today: string;
  onClose: () => void;
  isWeekendMode: boolean;
  onStartFresh: () => void;
  onSaveToDoc: () => void;
  onPrepMeeting: () => void;
}) {
  // Calendar events: only time-fixed blocks, render with bold time
  const calendarBlocks = data.schedule; // each has .time and .task

  // Messages: just recipient + subject, no draft preview
  const messageItems = [
    ...data.texts.map(t => `Text ${t.to}`),
    ...data.emails.map(e => `Email ${e.to}${e.subject ? ` — ${e.subject}` : ""}`),
  ];

  // Project plan: each bullet, keep short
  const planItems = data.projectPlan
    ? data.projectPlan.split("\n").map(l => l.replace(/^[•–\-*]\s*/, "").trim()).filter(Boolean)
    : [];

  // Shot list: undone items only
  const shotItems = data.shotList.filter(s => !s.done).map(s => s.text);

  // Interview prep: simple per-person line
  const interviewItems = data.interviewees.map(p => `Prepare for ${p.name}`);
  if (data.interviewGameplan && !interviewItems.length) interviewItems.push("Review interview gameplan");

  // Secondary moves: each line
  const secondaryItems = data.secondaryMoves
    ? data.secondaryMoves.split("\n").map(l => l.replace(/^[•–\-*◆]\s*/, "").trim()).filter(Boolean)
    : [];

  // Nice-to-haves: each line
  const niceItems = data.niceToHaves
    ? data.niceToHaves.split("\n").map(l => l.replace(/^[•–\-*◆]\s*/, "").trim()).filter(Boolean)
    : [];
  const todoItems = extractChecklistItems(data);

  const hasAnything = data.topPriority || calendarBlocks.length || messageItems.length || planItems.length ||
    shotItems.length || secondaryItems.length || niceItems.length || interviewItems.length;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4">
      <div className="bg-white rounded-3xl shadow-2xl w-full max-w-lg border border-stone-100 overflow-hidden max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="px-8 pt-8 pb-5 border-b border-stone-100">
          <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">{today}</p>
          <h2 className="text-3xl font-black text-stone-800 leading-tight" style={{ fontFamily: "var(--font-playfair)" }}>
            {isWeekendMode ? "Today I Get To Do..." : "Alright — here&apos;s your day."}
          </h2>
          <p className="text-sm text-stone-500 mt-2">
            {isWeekendMode
              ? "Simple list first. Expand only if something needs more thought."
              : hasAnything
              ? "Here's exactly what's on deck. How's that feel?"
              : "Your plan is set. How's that feel?"}
          </p>
        </div>

        {/* Specifics */}
        <div className="px-8 py-6 overflow-y-auto flex-1">
          {/* Top priority */}
          {data.topPriority && (
            <div className="mb-6 rounded-2xl bg-stone-50 border border-stone-200 px-5 py-4">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">🎯 Top priority</p>
              <p className="text-base font-bold text-stone-800">{data.topPriority}</p>
            </div>
          )}

          {isWeekendMode ? (
            <PlanGroup icon="✅" label="Today's list" items={todoItems} />
          ) : (
          <>
          {/* Calendar: time-fixed events at a glance, bold times */}
          {calendarBlocks.length > 0 && (
            <div className="mb-5">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">🗓 What&apos;s coming up today</p>
              <div className="space-y-2">
                {calendarBlocks.map((b, i) => (
                  <div key={i} className="flex items-baseline gap-3 py-1.5 border-b border-stone-50 last:border-0">
                    <span className="text-sm font-black text-stone-800 shrink-0 w-20 tabular-nums">{b.time}</span>
                    <span className="text-sm font-semibold text-stone-700 leading-snug">{b.task}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Messages */}
          <PlanGroup icon="✉️" label="Messages to send" items={messageItems} />

          {/* Project work */}
          <PlanGroup icon="🔨" label="Project work" items={planItems} />

          {/* Shot list */}
          <PlanGroup icon="✅" label="Shot list" items={shotItems} />

          {/* Interview prep */}
          <PlanGroup icon="🎙" label="Interview prep" items={interviewItems} />

          {/* Secondary moves */}
          <PlanGroup icon="➕" label="Secondary moves" items={secondaryItems} />

          {/* Nice-to-haves — dimmed */}
          <PlanGroup icon="🌟" label="Nice-to-haves (if time allows)" items={niceItems} dim />
          </>
          )}
        </div>

        {/* Actions */}
        <div className="px-8 pb-8 pt-4 border-t border-stone-100 space-y-3">
          <div className="flex flex-wrap gap-2">
            <button
              onClick={onSaveToDoc}
              className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-colors">
              Save to Doc
            </button>
            <button
              onClick={onPrepMeeting}
              className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-colors">
              Prep a Meeting
            </button>
            <button
              onClick={onStartFresh}
              className="rounded-xl border border-stone-200 px-3 py-2 text-sm text-stone-500 hover:text-rose-500 hover:border-rose-200 transition-colors">
              Start Fresh
            </button>
          </div>
          <div className="flex gap-3">
          <button
            onClick={onClose}
            className="flex-1 rounded-2xl bg-stone-800 px-6 py-3.5 text-base font-semibold text-white hover:bg-stone-700 transition-colors">
            {isWeekendMode ? "Looks good" : "Let's go"}
          </button>
          <button
            onClick={onClose}
            className="rounded-2xl border border-stone-200 px-5 py-3.5 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-colors">
            Keep editing
          </button>
        </div>
        </div>
      </div>
    </div>
  );
}

// ─── Time sanitizer ──────────────────────────────────────────────────────────
// Strips ranges like "11:00 – 12:30 PM" down to start time "11:00 AM".
// Applied on load and on every save so stale Llama output is cleaned up.
function sanitizeTime(t: string): string {
  const first = t.split(/\s*[-–—]\s*/)[0].trim();
  if (/AM|PM/i.test(first)) return first;
  const m = first.match(/^(\d{1,2}):?(\d{2})?$/);
  if (m) {
    const h = parseInt(m[1]);
    const min = m[2] ?? "00";
    const suffix = h >= 7 && h < 12 ? "AM" : "PM";
    return `${h}:${min} ${suffix}`;
  }
  return first || t;
}

function timeToMins(t: string): number {
  const m = t.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!m) return 0;
  let h = parseInt(m[1]);
  const min = parseInt(m[2]);
  const ap = m[3]?.toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  return h * 60 + min;
}

function sanitizeSchedule(schedule: ScheduleBlock[]): ScheduleBlock[] {
  // 1. Sanitize time strings
  const cleaned = schedule.map(b => ({ ...b, time: sanitizeTime(b.time) }));
  // 2. Deduplicate by (time, task) — keep first occurrence
  const seen = new Set<string>();
  const deduped = cleaned.filter(b => {
    const key = b.time + "|" + b.task.toLowerCase().trim();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  // 3. Sort chronologically
  return deduped.sort((a, b) => timeToMins(a.time) - timeToMins(b.time));
}

// ─── Event reminder helpers ───────────────────────────────────────────────────

function parseEventStart(timeStr: string): Date | null {
  const match = timeStr.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
  if (!match) return null;
  let h = parseInt(match[1]);
  const m = parseInt(match[2]);
  const ap = match[3]?.toUpperCase();
  if (ap === "PM" && h !== 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  const d = new Date(); d.setHours(h, m, 0, 0);
  return d;
}

const VAGUE_PATTERNS = [
  /\bfollow[\s-]?up\b/i, /\bloose\s+thread/i, /\bhandle\b/i, /\bdeal\s+with\b/i,
  /\bstuff\b/i, /\bthings\b/i, /\bmisc(ellaneous)?\b/i, /\bsomeone\b/i,
  /\bwork\s+on\b/i, /\bcheck\s+on\b/i, /\bfigure\s+out\b/i, /\bsomething\b/i,
  /\bthat\s+thing\b/i, /\bdo\s+it\b/i, /\bget\s+to\b/i,
];

function isVagueItem(text: string): boolean {
  if (text.trim().split(/\s+/).length <= 2) return true; // too short to be actionable
  return VAGUE_PATTERNS.some(p => p.test(text));
}

function eventPrepHint(block: ScheduleBlock): string {
  const t = (block.task + " " + block.note).toLowerCase();
  if (t.includes("zoom") || t.includes("meet") || t.includes("call") || t.includes("interview"))
    return "Get your notes open and grab the link.";
  if (t.includes("drive") || t.includes("travel") || t.includes("commute") || t.includes("appointment"))
    return "Leave time to get there — check traffic now.";
  if (t.includes("email") || t.includes("send") || t.includes("follow"))
    return "Prep anything you need to send before this.";
  return "Give yourself 5 minutes to focus before this one.";
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [data, setData] = useState<DayData>(EMPTY);
  const [saved, setSaved] = useState(false);
  const [isParsing, startParsing] = useTransition();
  const [isGeneratingQuestions, startGeneratingQuestions] = useTransition();
  const [parseError, setParseError] = useState<string | null>(null);
  const [today, setToday] = useState("");
  const [storageKey, setStorageKey] = useState("");
  const [viewingDate, setViewingDate] = useState<Date | null>(null); // null = today
  const [celebration, setCelebration] = useState<null | "text" | "section">(null);
  const [isMidDay, setIsMidDay] = useState(false);
  const [midDayDismissed, setMidDayDismissed] = useState(false);
  const [newShotItem, setNewShotItem] = useState("");
  const [shotMenu, setShotMenu] = useState<number | null>(null);
  const [showArchived, setShowArchived] = useState(false);
  const [expandedWeekendTask, setExpandedWeekendTask] = useState<number | null>(null);
  const shotInputRef = useRef<HTMLInputElement>(null);
  const [nudge, setNudge] = useState("");
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [yesterday, setYesterday] = useState<{ topPriority?: string; movedForward?: string; howItFelt?: string; tomorrowBriefing?: TomorrowBriefing; shotList?: ShotListItem[] } | null>(null);
  const [yesterdayRecap, setYesterdayRecap] = useState<string | null>(null);
  const [showEodCelebration, setShowEodCelebration] = useState(false);
  const [showBreak, setShowBreak] = useState(false);
  const breakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workStart = useRef<number>(Date.now());
  const [emailModal, setEmailModal] = useState<EmailDraft | null>(null);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);
  const [streak, setStreak] = useState(0);
  const [activeSectionId, setActiveSectionId] = useState("");
  const [upcomingEvent, setUpcomingEvent] = useState<{ block: ScheduleBlock; minsUntil: number } | null>(null);
  const [dayOfWeek, setDayOfWeek] = useState(0); // 0=Sun, 6=Sat
  const [showDayPlan, setShowDayPlan] = useState(false);
  const [breakSeconds, setBreakSeconds] = useState(0);
  const breakCountdownRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [shareText, setShareText] = useState("");
  const [showYesterday, setShowYesterday] = useState(false);
  const [showMeetingPrep, setShowMeetingPrep] = useState(false);
  const [showReflectionModal, setShowReflectionModal] = useState(false);
  const [weekendPromptModal, setWeekendPromptModal] = useState<{ title: string; prompt: string } | null>(null);
  const [isParsingCalendar, setIsParsingCalendar] = useState(false);
  const calendarInputRef = useRef<HTMLInputElement>(null);
  const [didHydrateDay, setDidHydrateDay] = useState(false);
  const [hasMounted, setHasMounted] = useState(false);
  const [savedSnapshots, setSavedSnapshots] = useState<SavedDaySnapshot[]>([]);
  const [showRestoreTray, setShowRestoreTray] = useState(false);
  const [showHistoryMenu, setShowHistoryMenu] = useState(false);
  const isWeekendMode = dayOfWeek === 6 || dayOfWeek === 0;

  const navigateDay = (offset: number) => {
    const base = viewingDate ?? new Date();
    const next = new Date(base); next.setDate(next.getDate() + offset);
    const todayMidnight = new Date(); todayMidnight.setHours(0, 0, 0, 0);
    const nextMidnight = new Date(next); nextMidnight.setHours(0, 0, 0, 0);
    if (nextMidnight > todayMidnight) return; // can't go into the future
    const isToday = nextMidnight.getTime() === todayMidnight.getTime();
    setViewingDate(isToday ? null : next);
    setData(EMPTY); // clear while loading
    setToday(next.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    setStorageKey(getStorageKeyForDate(next));
  };

  useEffect(() => {
    setHasMounted(true);
    const d = new Date();
    setToday(d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    const todayKey = getStorageKeyForDate(d);
    setStorageKey(todayKey);
    const h = d.getHours();
    setIsMidDay(h >= 11 && h < 13);
    setDayOfWeek(d.getDay());
    // Load yesterday's wins
    const yest = new Date(d); yest.setDate(yest.getDate() - 1);
    const yesterKey = getStorageKeyForDate(yest);
    try {
      const raw = localStorage.getItem(yesterKey);
      if (raw) {
        const y = JSON.parse(raw);
        if (y.topPriority || y.movedForward || y.howItFelt || y.tomorrowBriefing || y.shotList?.length) {
          const yData = { topPriority: y.topPriority, movedForward: y.movedForward, howItFelt: y.howItFelt, tomorrowBriefing: y.tomorrowBriefing, shotList: y.shotList };
          setYesterday(yData);
          // Generate a short AI recap in the background
          fetch("/api/recap", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify(yData),
          }).then(r => r.json()).then(({ recap }) => {
            if (recap) setYesterdayRecap(recap);
          }).catch(() => {});
        }
      }
    } catch {}
  }, []);

  useEffect(() => {
    if (!hasMounted || viewingDate) return;
    const todayDate = new Date();
    setStreak(calculateStreak(todayDate, data, true));
  }, [data, hasMounted, viewingDate]);

  useEffect(() => {
    if (!storageKey) return;
    const todayDate = viewingDate ?? new Date();
    const localKey = getStorageKeyForDate(todayDate);
    const legacyKey = getLegacyStorageKeyForDate(todayDate);
    const todayStamp = formatLocalDateKey(todayDate);
    const storedCandidates = [
      localStorage.getItem(localKey),
      legacyKey !== localKey ? localStorage.getItem(legacyKey) : null,
      storageKey !== localKey && storageKey !== legacyKey ? localStorage.getItem(storageKey) : null,
    ].filter((value): value is string => Boolean(value));

    let parsedStored: Partial<DayData> | null = null;
    let shouldUseFallback = true;

    for (const candidate of storedCandidates) {
      try {
        const parsed = JSON.parse(candidate);
        parsedStored = parsed;
        if (isMeaningfulDayData(parsed)) {
          shouldUseFallback = false;
          break;
        }
      } catch {}
    }

    if (parsedStored && !shouldUseFallback) {
      try {
        if (!viewingDate && isWeekendMode && parsedStored.savedForDate !== todayStamp) {
          setData(EMPTY);
          localStorage.removeItem(localKey);
        } else {
          setData(normalizeDayData(parsedStored));
        }
      } catch {}
    }
    setDidHydrateDay(true);
  }, [isWeekendMode, storageKey, viewingDate]);

  useEffect(() => {
    if (!hasMounted) return;
    const snapshots: SavedDaySnapshot[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key?.startsWith("jft-")) continue;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) continue;
        const parsed = JSON.parse(raw);
        if (!isMeaningfulDayData(parsed)) continue;
        snapshots.push({
          key,
          label: formatSavedDayLabel(key),
          rawDate: getSnapshotRawDate(key),
          score: scoreDayData(parsed),
          summary: summarizeDayData(parsed),
          data: parsed,
        });
      } catch {}
    }
    const todayKey = getStorageKeyForDate(new Date());
    snapshots.sort((a, b) => {
      if (a.key === todayKey && b.key !== todayKey) return -1;
      if (b.key === todayKey && a.key !== todayKey) return 1;
      return b.key.localeCompare(a.key) || b.score - a.score;
    });
    setSavedSnapshots(snapshots);
  }, [hasMounted, didHydrateDay, storageKey]);

  useEffect(() => {
    if (!didHydrateDay || viewingDate || !storageKey || data.meetingPrep.title || isWeekendMode) return;
    const noteParts = [
      data.topPriority ? `Top priority: ${data.topPriority}` : "",
      data.projectPlan ? `Project plan:\n${data.projectPlan}` : "",
      data.secondaryMoves ? `Secondary moves:\n${data.secondaryMoves}` : "",
      data.schedule.length
        ? `Today so far:\n${data.schedule.map((block) => `${block.time} — ${block.task}`).join("\n")}`
        : "",
    ].filter(Boolean);
    const followUpSeed = [
      data.shotList.filter((item) => item.done).length
        ? `Completed today:\n${data.shotList.filter((item) => item.done).map((item) => `- ${item.text}`).join("\n")}`
        : "",
      data.shotList.filter((item) => !item.done && !item.archived).length
        ? `Still open:\n${data.shotList.filter((item) => !item.done && !item.archived).map((item) => `- ${item.text}`).join("\n")}`
        : "",
    ].filter(Boolean);
    const seededMeeting: MeetingPrep = {
      title: "Prep for call with Chris · 4:30 PM",
      notes: noteParts.join("\n\n") || "BreakfastClubbing.com\nRoadmap priorities\nWhat Chris needs to weigh in on",
      agenda: "1. Current state of BreakfastClubbing.com\n2. Roadmap priorities\n3. Decisions, owners, and next steps",
      followUpActions: followUpSeed.join("\n\n"),
    };
    const updated = { ...data, meetingPrep: seededMeeting };
    setData(updated);
    localStorage.setItem(storageKey, JSON.stringify(updated));
    // Seed only once for the current day if no meeting prep exists yet.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [didHydrateDay, isWeekendMode, storageKey, viewingDate]);

  // Break reminder — fires after 60min of continuous session time
  useEffect(() => {
    const BREAK_AFTER = 60 * 60 * 1000; // 60 minutes
    workStart.current = Date.now();
    breakTimer.current = setTimeout(() => setShowBreak(true), BREAK_AFTER);
    return () => { if (breakTimer.current) clearTimeout(breakTimer.current); };
  }, []);

  // Break countdown — counts up while the break modal is open
  useEffect(() => {
    if (showBreak) {
      setBreakSeconds(0);
      breakCountdownRef.current = setInterval(() => setBreakSeconds(s => s + 1), 1000);
    } else {
      if (breakCountdownRef.current) clearInterval(breakCountdownRef.current);
      setBreakSeconds(0);
    }
    return () => { if (breakCountdownRef.current) clearInterval(breakCountdownRef.current); };
  }, [showBreak]);

  // Close shot menu on outside click
  useEffect(() => {
    if (shotMenu === null) return;
    const handler = () => setShotMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [shotMenu]);

  // Event reminder — checks schedule every minute for upcoming blocks
  useEffect(() => {
    if (!data.schedule.length) { setUpcomingEvent(null); return; }
    const check = () => {
      const now = new Date();
      // Find the most imminent upcoming event (within 35 min)
      let soonest: { block: ScheduleBlock; minsUntil: number } | null = null;
      for (const block of data.schedule) {
        const start = parseEventStart(block.time);
        if (!start) continue;
        const mins = (start.getTime() - now.getTime()) / 60000;
        if (mins > 0 && mins <= 35) {
          if (!soonest || mins < soonest.minsUntil) soonest = { block, minsUntil: Math.round(mins) };
        }
      }
      setUpcomingEvent(soonest);
    };
    check();
    const iv = setInterval(check, 60000);
    return () => clearInterval(iv);
  }, [data.schedule]);

  // ─── Section nav ────────────────────────────────────────────────────────────
  // Stable dep key — only recalculate when visible sections change
  const sectionDepKey = [
    isWeekendMode ? "weekend" : "",
    !isWeekendMode && yesterday && !data.brainDump ? "y" : "",
    !isWeekendMode && data.midDayFeeling ? "m" : "",
    !isWeekendMode && data.schedule.length > 0 ? "sc" : "",
    !isWeekendMode && data.texts.length > 0 ? "tx" : "",
    !isWeekendMode && data.emails.length > 0 ? "em" : "",
    !isWeekendMode && data.projectPlan ? "pp" : "",
    !isWeekendMode && (data.meetingPrep.title || data.meetingPrep.notes || data.meetingPrep.agenda || data.meetingPrep.followUpActions) ? "mp" : "",
    !isWeekendMode && (data.interviewGameplan || data.interviewees.length > 0) ? "iv" : "",
    !isWeekendMode && (data.composeEmail.notes || data.composeEmail.draft) ? "ce" : "",
    !isWeekendMode && (data.done["composeEmail"] || data.promptBuilder.brief) ? "pb" : "",
  ].join("");

  useEffect(() => {
    const sectionIds = isWeekendMode
      ? ["sec-braindump", "sec-plan"]
      : [
        ...(yesterday && !data.brainDump ? ["sec-yesterday"] : []),
        ...(data.midDayFeeling ? ["sec-midday"] : []),
        "sec-braindump",
        "sec-plan",
        ...(data.schedule.length > 0 ? ["sec-schedule"] : []),
        ...(data.texts.length > 0 ? ["sec-texts"] : []),
        ...(data.emails.length > 0 ? ["sec-emails"] : []),
        ...(data.projectPlan ? ["sec-projectplan"] : []),
        "sec-shotlist",
        ...(data.meetingPrep.title || data.meetingPrep.notes || data.meetingPrep.agenda || data.meetingPrep.followUpActions ? ["sec-meetingprep"] : []),
        ...(data.interviewGameplan || data.interviewees.length > 0 ? ["sec-interviews"] : []),
        "sec-projectlinks",
        ...(data.composeEmail.notes || data.composeEmail.draft ? ["sec-email"] : []),
        ...((data.done["composeEmail"] || data.promptBuilder.brief) ? ["sec-prompt"] : []),
        "sec-reflection",
      ];
    const observers: IntersectionObserver[] = [];
    sectionIds.forEach(id => {
      const el = document.getElementById(id);
      if (!el) return;
      const obs = new IntersectionObserver(
        ([entry]) => { if (entry.isIntersecting) setActiveSectionId(id); },
        { rootMargin: "-15% 0px -70% 0px" }
      );
      obs.observe(el);
      observers.push(obs);
    });
    return () => observers.forEach(o => o.disconnect());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isWeekendMode, sectionDepKey]);

  const save = useCallback((updated: DayData) => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(withSavedDate(updated, storageKey)));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [storageKey]);

  const restoreSavedDay = useCallback((snapshot: SavedDaySnapshot) => {
    const restored = normalizeDayData(snapshot.data);
    const currentDate = new Date();
    const todayKey = getStorageKeyForDate(currentDate);
    localStorage.setItem(todayKey, JSON.stringify(withSavedDate(restored, todayKey)));
    setViewingDate(null);
    setToday(currentDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    setStorageKey(todayKey);
    setData(restored);
    setSavedSnapshots((current) =>
      current.map((entry) =>
        entry.key === snapshot.key || entry.key === todayKey
          ? { ...entry, data: restored, summary: summarizeDayData(restored), score: scoreDayData(restored) }
          : entry
      )
    );
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
    setShowMeetingPrep(false);
  }, []);

  const rebuildTodayContext = useCallback(() => {
    const currentDate = new Date();
    const todayKey = getStorageKeyForDate(currentDate);
    const benFollowUp = [
      "Follow up from meeting with Ben on BreakfastClubbing.com roadmap",
      "Turn Ben meeting notes into next actions and ownership",
      "Generate prompts related to the Ben follow-up work",
      "Email Tara",
      "Prep for call with Chris at 4:30 PM",
    ];
    const mergedEmails = data.emails.some((email) => email.to.toLowerCase().includes("tara"))
      ? data.emails
      : [...data.emails, {
        to: "Tara",
        subject: "BreakfastClubbing.com follow-up",
        draft: "Hi Tara,\n\nQuick follow-up from today's BreakfastClubbing.com conversations. Sharing the roadmap priorities, Ben follow-up items, and next steps.\n\nBest,\nMichael",
      }];
    const updated: DayData = {
      ...data,
      brainDump: mergeTextLines(
        data.brainDump,
        benFollowUp.join("\n")
      ),
      topPriority: data.topPriority || "Follow up on BreakfastClubbing.com after the meeting with Ben",
      secondaryMoves: mergeTextLines(data.secondaryMoves, [
        "Draft Tara email",
        "Prep Chris call",
        "Generate Ben follow-up prompt",
      ].join("\n")),
      shotList: [
        ...data.shotList,
        ...benFollowUp
          .filter((item) => !data.shotList.some((shot) => shot.text === item))
          .map((text) => ({ text, done: false })),
      ],
      composeEmail: {
        to: data.composeEmail.to || "Tara",
        subject: data.composeEmail.subject || "BreakfastClubbing.com follow-up",
        notes: mergeTextLines(
          data.composeEmail.notes,
          [
            "Summarize the Ben meeting",
            "Share roadmap priorities",
            "Call out open questions and next steps",
          ].join("\n")
        ),
        draft: data.composeEmail.draft,
      },
      promptBuilder: {
        brief: data.promptBuilder.brief || [
          "Create a follow-up prompt based on the meeting with Ben about BreakfastClubbing.com.",
          "Include roadmap priorities, decisions made, open questions, and suggested next actions.",
          "Also prepare any useful next-step prompts for execution after the Chris call.",
        ].join("\n\n"),
        prompt: data.promptBuilder.prompt,
      },
      meetingPrep: {
        title: data.meetingPrep.title || "Prep for call with Chris · 4:30 PM",
        notes: mergeTextLines(
          data.meetingPrep.notes,
          [
            "BreakfastClubbing.com",
            "Roadmap priorities",
            "What Chris needs to weigh in on",
            "Ben meeting follow-up and open loops",
          ].join("\n")
        ),
        agenda: data.meetingPrep.agenda || "1. Ben follow-up\n2. BreakfastClubbing.com roadmap\n3. Decisions, owners, and next steps",
        followUpActions: mergeTextLines(
          data.meetingPrep.followUpActions,
          [
            "Send Tara the follow-up email",
            "Generate implementation prompt from Ben notes",
            "Capture decisions from the Chris call",
          ].join("\n")
        ),
      },
      emails: mergedEmails,
    };
    localStorage.setItem(todayKey, JSON.stringify(withSavedDate(updated, todayKey)));
    setViewingDate(null);
    setToday(currentDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    setStorageKey(todayKey);
    setData(updated);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [data]);

  const openTaskExpansion = useCallback((task: string, mode: "expand" | "project") => {
    const brief = mode === "project"
      ? [
        `This looks like a project, not a single task: ${task}`,
        "Break it into the smallest clear steps for today.",
        "Keep it low-friction and realistic.",
      ].join("\n\n")
      : [
        `Expand this task into clear next actions: ${task}`,
        "Keep the steps practical, short, and easy to start.",
      ].join("\n\n");

    const updated = {
      ...data,
      promptBuilder: {
        ...data.promptBuilder,
        brief,
      },
    };
    setData(updated);
    save(updated);
    setTimeout(() => scrollToSection("sec-prompt"), 80);
  }, [data, save]);

  const openChecklistAsProject = useCallback(() => {
    const checklistContext = [
      data.topPriority,
      data.secondaryMoves,
      data.niceToHaves,
      data.shotList.filter((item) => !item.archived).map((item) => item.text).join("\n"),
    ].filter(Boolean).join("\n");

    openTaskExpansion(checklistContext || "Today's checklist", "project");
  }, [data, openTaskExpansion]);

  const saveSectionTitle = (key: string, value: string) => {
    const updated = { ...data, sectionTitles: { ...data.sectionTitles, [key]: value } };
    setData(updated); save(updated);
  };

  const update = (field: keyof DayData) => (value: string) => {
    const updated = { ...data, [field]: value };
    setData(updated);
    save(updated);
  };

  const celebrate = async () => {
    const confetti = (await import("canvas-confetti")).default;
    confetti({ particleCount: 90, spread: 65, origin: { y: 0.55 }, colors: ["#a8a29e", "#78716c", "#d6d3d1", "#fbbf24"] });
    confetti({ particleCount: 40, spread: 40, origin: { x: 0.1, y: 0.6 }, angle: 60 });
    confetti({ particleCount: 40, spread: 40, origin: { x: 0.9, y: 0.6 }, angle: 120 });
    setCelebration("text");
    setTimeout(() => setCelebration(null), 2400);
  };

  const toggleTextDone = async (i: number) => {
    const updated = { ...data, texts: data.texts.map((t, idx) => idx === i ? { ...t, done: !t.done } : t) };
    setData(updated); save(updated);
    if (!data.texts[i].done) await celebrate();
  };

  const removeText = (i: number) => {
    const updated = { ...data, texts: data.texts.filter((_, idx) => idx !== i) };
    setData(updated); save(updated);
  };

  const removeEmail = (i: number) => {
    const updated = { ...data, emails: data.emails.filter((_, idx) => idx !== i) };
    setData(updated); save(updated);
  };

  const addTextWithDraft = async (to: string, context: string) => {
    const res = await fetch("/api/nudge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: `Write a short, casual text message to ${to}. Context: ${context}. Return only the message text, nothing else.` }),
    });
    const { message } = await res.json();
    const updated = { ...data, texts: [...data.texts, { to, draft: message || context, done: false }] };
    setData(updated); save(updated);
  };

  const addEmailWithDraft = async (to: string, subject: string, notes: string) => {
    const res = await fetch("/api/draft-email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ to, subject, notes }),
    });
    const { draft } = await res.json();
    const updated = { ...data, emails: [...data.emails, { to, subject, draft: draft || notes }] };
    setData(updated); save(updated);
  };

  const toggleShotDone = async (i: number) => {
    const updated = { ...data, shotList: data.shotList.map((s, idx) => idx === i ? { ...s, done: !s.done } : s) };
    setData(updated); save(updated);
    if (!data.shotList[i].done) await celebrate();
  };

  const addShotItem = () => {
    if (!newShotItem.trim()) return;
    const updated = { ...data, shotList: [...data.shotList, { text: newShotItem.trim(), done: false }] };
    setData(updated); save(updated);
    setNewShotItem("");
    shotInputRef.current?.focus();
  };

  const removeShotItem = (i: number) => {
    const updated = { ...data, shotList: data.shotList.filter((_, idx) => idx !== i) };
    setData(updated); save(updated);
  };

  const moveToTomorrow = (i: number) => {
    const item = data.shotList[i];
    const tom = new Date(); tom.setDate(tom.getDate() + 1);
    const tomKey = getStorageKeyForDate(tom);
    try {
      const raw = localStorage.getItem(tomKey);
      const tomData = raw ? JSON.parse(raw) : { ...EMPTY };
      tomData.shotList = [...(tomData.shotList || []), { text: item.text, done: false }];
      localStorage.setItem(tomKey, JSON.stringify(tomData));
    } catch {}
    removeShotItem(i);
  };

  const toggleShotLater = (i: number) => {
    const updated = {
      ...data,
      shotList: data.shotList.map((item, idx) =>
        idx === i ? { ...item, later: !item.later, archived: false } : item
      ),
    };
    setData(updated);
    save(updated);
  };

  const archiveShotItem = (i: number) => {
    const updated = { ...data, shotList: data.shotList.map((s, idx) => idx === i ? { ...s, archived: true } : s) };
    setData(updated); save(updated);
  };

  const buildShareText = () => {
    const lines: string[] = [];
    if (data.topPriority) lines.push(`Today I'm focused on: ${data.topPriority}`);
    if (data.secondaryMoves) lines.push(`Also working on: ${data.secondaryMoves}`);
    const open = data.shotList.filter(s => !s.done).map(s => s.text);
    if (open.length) lines.push(`Shot list: ${open.join(", ")}`);
    if (!lines.length) return "";
    return `Hey! Trying to stay accountable today. ${lines.join(". ")}. Can you check in on me later? 🙌\n\n(Studies show people with ADHD are ~3x more likely to follow through when they tell someone. So here I am, telling you.)`;
  };


  const importCalendarPhoto = async (file: File) => {
    setIsParsingCalendar(true);
    try {
      const form = new FormData();
      form.append("image", file);
      const res = await fetch("/api/parse-calendar", { method: "POST", body: form });
      if (!res.ok) throw new Error("Failed");
      const { schedule } = await res.json();
      if (schedule?.length) {
        const merged = sanitizeSchedule([...data.schedule, ...schedule]);
        const updated = { ...data, schedule: merged };
        setData(updated); save(updated);
      }
    } catch {}
    setIsParsingCalendar(false);
  };

  const generatePlan = () => {
    setParseError(null);
    startParsing(async () => {
      try {
        if (isWeekendMode) {
          const weekendChecklist = extractWeekendBrainDumpItems(data.brainDump);
          const nextItems = weekendChecklist.length
            ? weekendChecklist
            : data.brainDump
                .split("\n")
                .map((line) => cleanWeekendTaskText(line.trim()))
                .filter(Boolean);
          const weekendTexts = uniqueTextDrafts([
            ...data.texts,
            ...nextItems.flatMap((task) =>
              getWeekendTaskHelpers(task)
                .filter((helper) => helper.kind === "copyText")
                .map((helper) => {
                  const to = helper.label.replace(/^Copy\s+/, "").replace(/\s+text$/i, "");
                  return { to, draft: helper.value, done: false };
                })
            ),
          ]);
          const updated: DayData = {
            ...data,
            topPriority: "",
            secondaryMoves: nextItems.join("\n"),
            niceToHaves: "",
            shotList: uniqueShotList(nextItems),
            texts: weekendTexts,
          };
          setData(updated);
          save(updated);
          setTimeout(() => scrollToSection("sec-plan"), 80);
          return;
        }

        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brainDump: data.brainDump,
            currentTime: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
            fixedEvents: data.schedule, // pass any already-imported calendar events
          }),
        });
        if (!res.ok) throw new Error("Failed");
        const parsed = await res.json();
        const parsedTexts = normalizeTextDrafts(parsed.texts);
        const parsedEmails = normalizeEmailDrafts(parsed.emails);
        const parsedSchedule = normalizeScheduleBlocks(parsed.schedule);
        const updated: DayData = {
          ...data,
          topPriority: parsed.topPriority || data.topPriority,
          secondaryMoves: parsed.secondaryMoves || data.secondaryMoves,
          niceToHaves: parsed.niceToHaves || data.niceToHaves,
          projectPlan: parsed.projectPlan || data.projectPlan,
          texts: parsedTexts.length ? parsedTexts : data.texts,
          emails: parsedEmails.length ? parsedEmails : data.emails,
          schedule: parsedSchedule.length
            ? sanitizeSchedule(parsedSchedule)
            : data.schedule,
          interviewGameplan: parsed.interviewGameplan || data.interviewGameplan,
          shotList: data.shotList,
        };
        setData(updated); save(updated);
        setShowDayPlan(true);
      } catch (e) { setParseError(e instanceof Error ? e.message : "Couldn't generate — check your API key or Ollama connection."); }
    });
  };

  const generateInterviewQuestions = () => {
    const context = data.interviewGameplan || data.brainDump;
    if (!context.trim()) return;
    startGeneratingQuestions(async () => {
      try {
        const res = await fetch("/api/interview", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ context }),
        });
        if (!res.ok) throw new Error("Failed");
        const parsed = await res.json();
        // Support both new grouped format and legacy flat array
        const interviewees: Interviewee[] = parsed.interviewees?.length
          ? parsed.interviewees
          : parsed.questions?.length
            ? [{ name: "Questions", questions: parsed.questions }]
            : [];
        if (interviewees.length) {
          const updated = { ...data, interviewees };
          setData(updated); save(updated);
        }
      } catch { /* silent fail */ }
    });
  };

  const handleBrainDumpChange = (value: string) => {
    update("brainDump")(value);
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
    if (isWeekendMode) {
      setNudge(value.trim() ? "It's the weekend. What do you want to feel good about today?" : "");
      return;
    }
    if (value.trim().length < 10) { setNudge(""); return; }
    nudgeTimer.current = setTimeout(async () => {
      try {
        const res = await fetch("/api/nudge", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: value }),
        });
        const { message } = await res.json();
        if (message) setNudge(message);
      } catch {}
    }, 1800);
  };

  const updateCompose = (field: keyof ComposeEmailDraft) => (value: string) => {
    const updated = { ...data, composeEmail: { ...data.composeEmail, [field]: value } };
    setData(updated); save(updated);
  };

  const updateMeetingPrep = (field: keyof MeetingPrep, value: string) => {
    const updated = { ...data, meetingPrep: { ...data.meetingPrep, [field]: value } };
    setData(updated); save(updated);
  };

  const seedPromptFromMeeting = () => {
    const parts = [
      data.meetingPrep.title ? `Meeting: ${data.meetingPrep.title}` : "",
      data.meetingPrep.notes ? `Notes:\n${data.meetingPrep.notes}` : "",
      data.meetingPrep.agenda ? `Agenda / outcomes:\n${data.meetingPrep.agenda}` : "",
      data.meetingPrep.followUpActions ? `Follow-up actions:\n${data.meetingPrep.followUpActions}` : "",
    ].filter(Boolean);

    if (!parts.length) return;

    const brief = `${parts.join("\n\n")}\n\nCreate a clear execution prompt tied to this project or meeting follow-up. Turn the open loops into concrete next steps or deliverables.`;
    const updated = { ...data, promptBuilder: { ...data.promptBuilder, brief } };
    setData(updated); save(updated);
    setShowMeetingPrep(false);
    setTimeout(() => scrollToSection("sec-prompt"), 80);
  };

  const generateEmail = async () => {
    if (!data.composeEmail.notes.trim()) return;
    setIsGeneratingEmail(true);
    try {
      const res = await fetch("/api/draft-email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          to: data.composeEmail.to,
          subject: data.composeEmail.subject,
          notes: data.composeEmail.notes,
        }),
      });
      const { draft } = await res.json();
      if (draft) {
        const updated = { ...data, composeEmail: { ...data.composeEmail, draft } };
        setData(updated); save(updated);
      }
    } catch {}
    setIsGeneratingEmail(false);
  };

  const generatePrompt = async () => {
    if (!data.promptBuilder.brief.trim()) return;
    setIsGeneratingPrompt(true);
    try {
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief: data.promptBuilder.brief }),
      });
      const { prompt } = await res.json();
      if (prompt) {
        const updated = { ...data, promptBuilder: { ...data.promptBuilder, prompt } };
        setData(updated); save(updated);
      }
    } catch {}
    setIsGeneratingPrompt(false);
  };

  const generatePromptFromBrief = async (title: string, brief: string) => {
    if (!brief.trim()) return;
    const seeded = { ...data, promptBuilder: { ...data.promptBuilder, brief } };
    setData(seeded);
    save(seeded);
    setWeekendPromptModal({ title, prompt: "" });
    setIsGeneratingPrompt(true);
    try {
      const res = await fetch("/api/generate-prompt", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brief }),
      });
      const { prompt } = await res.json();
      const finalPrompt = typeof prompt === "string" && prompt.trim() ? prompt : brief;
      const updated = { ...seeded, promptBuilder: { ...seeded.promptBuilder, prompt: finalPrompt } };
      setData(updated);
      save(updated);
      setWeekendPromptModal({ title, prompt: finalPrompt });
    } catch {
      setWeekendPromptModal({ title, prompt: brief });
    }
    setIsGeneratingPrompt(false);
  };

  const finishDay = async () => {
    const pushedLater = Object.entries(data.sectionState)
      .filter(([, status]) => status === "later")
      .map(([key]) => SECTION_LABELS[key] ?? key);
    const archived = Object.entries(data.sectionState)
      .filter(([, status]) => status === "archived")
      .map(([key]) => SECTION_LABELS[key] ?? key);
    const briefing: TomorrowBriefing = {
      topPriority: data.topPriority,
      completed: data.shotList.filter(s => s.done).map(s => s.text),
      open: data.shotList.filter(s => !s.done).map(s => s.text),
      secondaryMoves: data.secondaryMoves,
      niceToHaves: data.niceToHaves,
      movedForward: data.movedForward,
      howItFelt: data.howItFelt,
      pushedLater,
      archived,
    };
    const updated = { ...data, tomorrowBriefing: briefing, done: { ...data.done, reflection: true } };
    setData(updated); save(updated);
    const confetti = (await import("canvas-confetti")).default;
    confetti({ particleCount: 200, spread: 120, origin: { y: 0.4 }, colors: ["#fbbf24", "#f59e0b", "#a78bfa", "#60a5fa", "#34d399", "#f472b6"] });
    confetti({ particleCount: 100, angle: 60, spread: 70, origin: { x: 0, y: 0.5 } });
    confetti({ particleCount: 100, angle: 120, spread: 70, origin: { x: 1, y: 0.5 } });
    setTimeout(() => {
      confetti({ particleCount: 80, spread: 90, origin: { y: 0.3 }, colors: ["#fbbf24", "#a78bfa", "#34d399"] });
    }, 600);
    setShowEodCelebration(true);
  };

  const toggleSection = async (key: string) => {
    const nowDone = !data.done[key];
    const nextSectionState = { ...data.sectionState };
    delete nextSectionState[key];
    const updated = { ...data, done: { ...data.done, [key]: nowDone }, sectionState: nextSectionState };
    setData(updated); save(updated);
    if (nowDone) {
      const confetti = (await import("canvas-confetti")).default;
      // Big fireworks burst
      confetti({ particleCount: 150, spread: 100, origin: { y: 0.5 }, colors: ["#fbbf24", "#f59e0b", "#a78bfa", "#60a5fa", "#34d399"] });
      confetti({ particleCount: 80, angle: 60, spread: 55, origin: { x: 0, y: 0.6 } });
      confetti({ particleCount: 80, angle: 120, spread: 55, origin: { x: 1, y: 0.6 } });
      setCelebration("section");
      setTimeout(() => setCelebration(null), 3000);
    }
  };

  const setSectionState = (key: string, state?: "later" | "archived") => {
    const nextState = { ...data.sectionState };
    if (state) nextState[key] = state;
    else delete nextState[key];
    const updated = { ...data, sectionState: nextState, done: { ...data.done, [key]: false } };
    setData(updated);
    save(updated);
  };

  const moveSection = (sectionId: string, direction: -1 | 1) => {
    const order = data.sectionOrder.length ? [...data.sectionOrder] : [...DEFAULT_SECTION_ORDER];
    const index = order.indexOf(sectionId);
    if (index < 0) return;
    const nextIndex = index + direction;
    if (nextIndex < 0 || nextIndex >= order.length) return;
    [order[index], order[nextIndex]] = [order[nextIndex], order[index]];
    const updated = { ...data, sectionOrder: order };
    setData(updated);
    save(updated);
  };

  const hasGeneratedContent =
    data.schedule.length > 0 || data.texts.length > 0 || data.emails.length > 0 || data.projectPlan;

  const projectMeta = data.projectLink ? getProjectMeta(data.projectLink) : null;
  const weekendHidden = isWeekendMode ? "hidden" : "";

  // Section nav definition — drives both the side nav and keyboard shortcuts
  const navSections: { id: string; label: string; doneKey?: string }[] = [
    { id: "sec-braindump", label: "Brain Dump", doneKey: "brainDump" },
    { id: "sec-plan", label: isWeekendMode ? "Today I Get To Do..." : "Today's Plan", doneKey: "plan" },
    ...(!isWeekendMode ? [
      ...(yesterday && !data.brainDump ? [{ id: "sec-yesterday", label: "Yesterday" }] : []),
      ...(data.midDayFeeling ? [{ id: "sec-midday", label: "Check-In", doneKey: "midday" }] : []),
      ...(data.schedule.length > 0 ? [{ id: "sec-schedule", label: "Schedule", doneKey: "schedule" }] : []),
      ...(data.texts.length > 0 ? [{ id: "sec-texts", label: "Texts", doneKey: "texts" }] : []),
      ...(data.emails.length > 0 ? [{ id: "sec-emails", label: "Emails", doneKey: "emails" }] : []),
      ...(data.projectPlan ? [{ id: "sec-projectplan", label: "Project Plan", doneKey: "projectPlan" }] : []),
      { id: "sec-shotlist", label: "Shot List", doneKey: "shotList" },
      ...(data.meetingPrep.title || data.meetingPrep.notes || data.meetingPrep.agenda || data.meetingPrep.followUpActions ? [{ id: "sec-meetingprep", label: "Meeting Prep" }] : []),
      ...(data.interviewGameplan || data.interviewees.length > 0 ? [{ id: "sec-interviews", label: "Interviews", doneKey: "interviews" }] : []),
      { id: "sec-projectlinks", label: "Project Links" },
      ...(data.composeEmail.notes || data.composeEmail.draft ? [{ id: "sec-email", label: "Quick Email", doneKey: "composeEmail" }] : []),
      ...((data.done["composeEmail"] || data.promptBuilder.brief) ? [{ id: "sec-prompt", label: "Prompt", doneKey: "promptBuilder" }] : []),
      { id: "sec-reflection", label: "Reflection", doneKey: "reflection" },
    ] : []),
  ];

  const getSectionOrder = (sectionId: string) => {
    const idx = data.sectionOrder.indexOf(sectionId);
    return idx >= 0 ? idx + 1 : DEFAULT_SECTION_ORDER.indexOf(sectionId) + 1;
  };

  const isSectionResolved = (key: string) => !!data.done[key] || !!data.sectionState[key];
  const archivedSections = Object.entries(data.sectionState).filter(([, status]) => status === "archived");
  const sectionTone = (key: string) => {
    if (data.sectionState[key] === "archived") return "hidden";
    if (data.sectionState[key] === "later") return "opacity-60";
    return "";
  };

  const scrollToSection = (id: string) => {
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  const goToNextSection = (currentId: string) => {
    const idx = navSections.findIndex(section => section.id === currentId);
    if (idx >= 0 && idx < navSections.length - 1) {
      scrollToSection(navSections[idx + 1].id);
    }
  };

  // Keyboard navigation — ↑↓ arrows jump between sections when not in a text field
  useEffect(() => {
    const nav = navSections;
    const handleKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      const inTextField = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
      const canUseDesktopJump =
        (e.altKey || e.metaKey) &&
        (e.key === "ArrowDown" || e.key === "ArrowUp" || e.key.toLowerCase() === "j" || e.key.toLowerCase() === "k");

      if (inTextField && !canUseDesktopJump) return;
      if (
        e.key !== "ArrowDown" &&
        e.key !== "ArrowUp" &&
        e.key.toLowerCase() !== "j" &&
        e.key.toLowerCase() !== "k"
      ) return;

      const goingForward = e.key === "ArrowDown" || e.key.toLowerCase() === "j";
      if ((e.key.toLowerCase() === "j" || e.key.toLowerCase() === "k") && !(e.altKey || e.metaKey)) return;

      e.preventDefault();
      const idx = nav.findIndex(s => s.id === activeSectionId);
      const baseIndex = idx >= 0 ? idx : 0;
      const next = goingForward ? baseIndex + 1 : baseIndex - 1;
      if (next >= 0 && next < nav.length) {
        scrollToSection(nav[next].id);
      }
    };
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSectionId, sectionDepKey]);

  // Progress bar
  const activeWeekendTasks = data.shotList.filter((item) => !item.archived && !item.later);
  const weekendDoneCount = activeWeekendTasks.filter((item) => item.done).length;
  const completableSections = isWeekendMode
    ? ["brainDump", "plan"]
    : [
      "plan", "shotList", "reflection",
      ...(data.schedule.length > 0 ? ["schedule"] : []),
      ...(data.texts.length > 0 ? ["texts"] : []),
      ...(data.emails.length > 0 ? ["emails"] : []),
      ...(data.projectPlan ? ["projectPlan"] : []),
      ...((data.interviewGameplan || data.interviewees.length > 0) ? ["interviews"] : []),
      ...(data.midDayFeeling ? ["midday"] : []),
      ...((data.composeEmail.notes || data.composeEmail.draft) ? ["composeEmail"] : []),
      ...(data.promptBuilder.brief ? ["promptBuilder"] : []),
    ];
  const doneCount = completableSections.filter((key) => isSectionResolved(key)).length;
  const progressPct = isWeekendMode
    ? activeWeekendTasks.length > 0
      ? Math.round((weekendDoneCount / activeWeekendTasks.length) * 100)
      : data.brainDump.trim()
      ? 10
      : 0
    : completableSections.length > 0
    ? Math.round((doneCount / completableSections.length) * 100)
    : 0;
  const readyToWrap =
    completableSections.filter((key) => key !== "reflection").length > 0 &&
    completableSections.filter((key) => key !== "reflection").every((key) => isSectionResolved(key)) &&
    !isSectionResolved("reflection");

  // Break modal messaging
  const breakMins = Math.floor(breakSeconds / 60);
  const breakSecs = breakSeconds % 60;
  const breakTimerDisplay = `${breakMins}:${String(breakSecs).padStart(2, "0")}`;
  const breakMessage = breakMins >= 15
    ? "You earned that. 15 minutes of real rest. 💪"
    : breakMins >= 5
      ? `Break time: ${breakTimerDisplay} 🌿`
      : "You've been working hard. Take a real break.";

  // Render bullet lines cleanly for project plan
  const renderBullets = (text: unknown) => {
    const str = Array.isArray(text) ? (text as string[]).join("\n") : typeof text === "string" ? text : "";
    return str.split("\n").filter(Boolean).map((line, i) => (
      <div key={i} className="flex gap-2.5 mb-2">
        <span className="text-stone-400 mt-0.5 shrink-0">{line.startsWith("•") ? "•" : "–"}</span>
        <span className="text-sm text-stone-600 leading-relaxed">{line.replace(/^[•–]\s*/, "")}</span>
      </div>
    ));
  };

  const hasMeaningfulCurrentDay = isMeaningfulDayData(data);
  const eodSummary = buildEndOfDaySummary(data.tomorrowBriefing, isWeekendMode, today);

  return (
    <main className="min-h-screen px-4 py-12 md:py-20">
      {/* Section nav — right side scrollspy */}
      <nav className="fixed right-5 top-1/2 -translate-y-1/2 z-30 hidden lg:flex flex-col gap-2 items-end select-none"
        aria-label="Page sections">
        <div className="mb-3 w-24 rounded-2xl border border-stone-200 bg-white/95 px-3 py-2 shadow-sm backdrop-blur">
          <p className="text-[10px] font-semibold uppercase tracking-widest text-stone-400">Progress</p>
          <p className="mt-1 text-sm font-semibold text-stone-700 tabular-nums">{progressPct}%</p>
          {isWeekendMode && activeWeekendTasks.length > 0 && (
            <p className="mt-1 text-[10px] text-stone-400">
              {weekendDoneCount}/{activeWeekendTasks.length} tasks
            </p>
          )}
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-stone-100">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #f59e0b 0%, #f97316 45%, #34d399 100%)" }}
            />
          </div>
        </div>
        {navSections.map((sec) => {
          const isActive = activeSectionId === sec.id;
          const isDone = sec.doneKey ? !!data.done[sec.doneKey] : false;
          return (
            <button
              key={sec.id}
              onClick={() => scrollToSection(sec.id)}
              className="flex items-center gap-2 group transition-all duration-150"
              title={sec.label}
            >
              <span className={`text-xs transition-all duration-150 whitespace-nowrap ${isActive ? "text-stone-500 opacity-100" : "text-stone-400 opacity-0 group-hover:opacity-100"}`}>
                {sec.label}
              </span>
              <span className={`rounded-full transition-all duration-200 shrink-0 ${
                isDone
                  ? "bg-emerald-400 " + (isActive ? "w-2.5 h-2.5" : "w-2 h-2")
                  : isActive
                    ? "bg-stone-500 w-2.5 h-2.5"
                    : "bg-stone-300 w-1.5 h-1.5 group-hover:bg-stone-400 group-hover:w-2 group-hover:h-2"
              }`} />
            </button>
          );
        })}
        {/* Progress fraction */}
        <span className="text-[10px] text-stone-300 mt-1 tabular-nums">{doneCount}/{completableSections.length}</span>
      </nav>

      <div className="mx-auto max-w-2xl">
        {!didHydrateDay && (
          <div className="mb-6 rounded-2xl border border-stone-200 bg-stone-50 p-8 text-center">
            <p className="text-sm uppercase tracking-[0.2em] text-stone-400">Just for Today</p>
            <p className="mt-3 text-stone-500">Loading your day…</p>
          </div>
        )}
        {/* Hidden calendar photo input — always mounted so it can be triggered before schedule exists */}
        <input
          ref={calendarInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) importCalendarPhoto(f); e.target.value = ""; }}
        />

        {/* Celebration toast */}
        {celebration === "text" && (
          <div className="animate-celebration fixed top-6 right-6 z-50 bg-white rounded-2xl shadow-xl px-5 py-3.5 border border-stone-200 pointer-events-none">
            <p className="text-sm font-semibold text-stone-700">🎉 Woot, progress!</p>
          </div>
        )}
        {celebration === "section" && (
          <div className="animate-celebration fixed top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 bg-white rounded-3xl shadow-2xl px-10 py-8 border border-stone-100 pointer-events-none text-center">
            <p className="text-4xl mb-2">🎆</p>
            <p className="text-2xl font-black text-stone-800" style={{ fontFamily: "var(--font-playfair)" }}>WOOT!</p>
            <p className="text-sm text-stone-400 mt-1">That&apos;s a whole section. Done.</p>
          </div>
        )}

        {/* Break reminder */}
        {/* Floating break button */}
        {!showBreak && (
          <button
            onClick={() => setShowBreak(true)}
            className="fixed bottom-5 right-5 z-40 flex items-center gap-2 rounded-2xl border border-stone-200 bg-white px-4 py-3 shadow-md hover:shadow-lg hover:border-stone-300 transition-all text-stone-400 hover:text-stone-700"
            title="Take a break">
            <span className="text-lg">☕</span>
            <span className="text-[10px] font-semibold uppercase tracking-widest">Break</span>
          </button>
        )}

        {showBreak && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl px-10 py-10 max-w-sm mx-4 text-center border border-stone-100">
              <p className="text-4xl mb-4">☕</p>
              <p className="text-xl font-black text-stone-800 mb-2" style={{ fontFamily: "var(--font-playfair)" }}>
                {breakMessage}
              </p>
              {breakSeconds > 0 && breakMins < 15 && (
                <p className="text-3xl font-mono font-light text-stone-400 mb-3 tabular-nums">{breakTimerDisplay}</p>
              )}
              <p className="text-sm text-stone-500 mb-6 leading-relaxed">
                Step away, breathe, hydrate. You&apos;ll think better for it.
              </p>
              <div className="flex flex-col gap-2">
                <button onClick={() => setShowBreak(false)}
                  className="w-full rounded-xl bg-stone-800 text-white px-6 py-3 text-sm font-medium hover:bg-stone-700 transition-colors">
                  Come back in 15–20 minutes 🌿
                </button>
                <button onClick={() => setShowBreak(false)}
                  className="w-full rounded-xl border border-stone-200 text-stone-500 px-6 py-3 text-sm hover:text-stone-800 hover:border-stone-400 transition-colors">
                  Keep working
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Day plan review modal */}
        {showDayPlan && (
          <DayPlanModal
            data={data}
            today={today}
            onClose={() => setShowDayPlan(false)}
            isWeekendMode={isWeekendMode}
            onSaveToDoc={() => saveDayToGoogleDoc(data, today)}
            onPrepMeeting={() => setShowMeetingPrep(true)}
            onStartFresh={() => {
              if (confirm("Start fresh today? This clears everything for today — yesterday stays.")) {
                if (storageKey) localStorage.removeItem(storageKey);
                setData(EMPTY);
                setShowDayPlan(false);
              }
            }}
          />
        )}

        {/* Yesterday modal */}
        {showYesterday && yesterday && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4" onClick={() => setShowYesterday(false)}>
            <div className="bg-white rounded-3xl shadow-2xl w-full max-w-md border border-stone-100 overflow-hidden max-h-[88vh] flex flex-col" onClick={e => e.stopPropagation()}>
              {/* Header */}
              <div className="px-8 pt-8 pb-5 border-b border-stone-100">
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">Yesterday</p>
                <h2 className="text-xl font-black text-stone-800" style={{ fontFamily: "var(--font-playfair)" }}>
                  Here&rsquo;s what you got done.
                </h2>
              </div>

              <div className="px-8 py-6 overflow-y-auto flex-1 space-y-6">
                {/* Accomplished — pull from topPriority, secondaryMoves, shot list done */}
                {(() => {
                  const items: string[] = [];
                  if (yesterday.topPriority) items.push(yesterday.topPriority);
                  if (yesterday.tomorrowBriefing?.secondaryMoves) {
                    yesterday.tomorrowBriefing.secondaryMoves.split("\n").forEach(l => { if (l.trim()) items.push(l.trim()); });
                  }
                  if (yesterday.tomorrowBriefing?.completed?.length) {
                    yesterday.tomorrowBriefing.completed.forEach(l => { if (!items.includes(l)) items.push(l); });
                  }
                  if (!items.length) return null;
                  return (
                    <div>
                      <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">Accomplished ✓</p>
                      <div className="space-y-1">
                        {items.map((item, i) => (
                          <div key={i} className="flex items-start gap-2.5">
                            <span className="mt-1 w-3.5 h-3.5 rounded-full bg-stone-200 shrink-0 flex items-center justify-center text-[8px] text-stone-500 font-bold">✓</span>
                            <p className="text-sm text-stone-700 leading-snug">{item}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })()}

                {/* Still open — shot list items grouped as one project */}
                {yesterday.tomorrowBriefing?.open?.length ? (
                  <div>
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">Still open</p>
                    <div className="rounded-2xl border border-stone-100 bg-stone-50 p-4">
                      <div className="flex items-center justify-between mb-3">
                        <p className="text-sm font-semibold text-stone-700">Shot List <span className="text-stone-400 font-normal">({yesterday.tomorrowBriefing.open.length} remaining)</span></p>
                        <button
                          onClick={() => {
                            const items = yesterday!.tomorrowBriefing!.open;
                            // Move as new shot list items into today
                            const newItems = items.map(text => ({ text, done: false }));
                            const merged = [...data.shotList, ...newItems.filter(n => !data.shotList.find(s => s.text === n.text))];
                            const updated = { ...data, shotList: merged };
                            setData(updated); save(updated);
                            setShowYesterday(false);
                          }}
                          className="text-[11px] px-3 py-1.5 rounded-xl bg-stone-800 text-white hover:bg-stone-700 transition-colors font-medium">
                          → Move to today
                        </button>
                      </div>
                      {(() => {
                        const { preview, summary } = summarizeListPreview(yesterday.tomorrowBriefing.open);
                        return (
                          <>
                            <p className="text-xs text-stone-500 leading-relaxed">
                              {summary ? `Mostly about: ${summary}` : "Open items carried over."}
                            </p>
                            <div className="mt-3 space-y-1.5">
                              {preview.map((item, i) => (
                                <div key={i} className="flex items-start gap-2">
                                  <span className="mt-1 w-3 h-3 rounded-full border-2 border-stone-300 shrink-0" />
                                  <p className="text-xs text-stone-500 leading-snug">{item}</p>
                                </div>
                              ))}
                            </div>
                          </>
                        );
                      })()}
                    </div>
                  </div>
                ) : null}

                {/* Shot list summary */}
                {yesterday.shotList && yesterday.shotList.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">Shot list</p>
                    {(() => {
                      const shotItems = yesterday.shotList!.map((item) => item.text);
                      const { preview, summary } = summarizeListPreview(shotItems);
                      return (
                        <div className="rounded-2xl border border-stone-100 bg-stone-50 p-4 mb-3">
                          <p className="text-xs text-stone-500 leading-relaxed">
                            {summary ? `It was mostly about: ${summary}` : "Captured as a shot list."}
                          </p>
                          <div className="mt-3 space-y-1.5">
                            {preview.map((item, i) => (
                              <div key={i} className="flex items-start gap-2.5">
                                <span className="mt-0.5 w-3.5 h-3.5 rounded-full border-2 border-stone-300 shrink-0" />
                                <span className="text-sm text-stone-700 leading-snug">{item}</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      );
                    })()}
                    <div className="flex gap-2">
                      <button
                        onClick={() => printList("Shot List", yesterday.shotList!.map(s => (s.done ? "✓ " : "  ") + s.text))}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors font-medium">
                        🖨 Print
                      </button>
                      <button
                        onClick={() => {
                          const text = yesterday.shotList!.map(s => (s.done ? "✓ " : "☐ ") + s.text).join("\n");
                          navigator.clipboard.writeText(text).then(() => alert("Copied! Paste into a new Google Doc."));
                        }}
                        className="text-[11px] px-2.5 py-1 rounded-lg bg-stone-100 text-stone-600 hover:bg-stone-200 transition-colors font-medium">
                        📋 Copy for Google Doc
                      </button>
                    </div>
                  </div>
                )}

                {/* How it felt */}
                {yesterday.howItFelt && (
                  <div>
                    <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-1">Quick reflection</p>
                    <p className="text-sm text-stone-500 italic">&ldquo;{yesterday.howItFelt}&rdquo;</p>
                  </div>
                )}
              </div>

              <div className="px-8 pb-8 pt-4 border-t border-stone-100">
                <button onClick={() => setShowYesterday(false)}
                  className="w-full rounded-2xl px-5 py-3.5 text-sm font-semibold text-white shadow-md transition-all hover:scale-[1.01]"
                  style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ec4899 50%, #8b5cf6 100%)" }}>
                  Back to Today
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Email detail modal */}
        {emailModal && (
          <EmailModal email={emailModal} onClose={() => setEmailModal(null)} />
        )}
        {showMeetingPrep && (
          <MeetingPrepModal
            meetingPrep={data.meetingPrep}
            onChange={updateMeetingPrep}
            onClose={() => setShowMeetingPrep(false)}
            onGeneratePrompt={seedPromptFromMeeting}
          />
        )}
        {showReflectionModal && (
          <ReflectionModal
            data={data}
            onClose={() => setShowReflectionModal(false)}
            onUpdate={(field, value) => update(field)(value)}
            onFinish={async () => {
              setShowReflectionModal(false);
              await finishDay();
            }}
          />
        )}
        {weekendPromptModal && (
          <PromptModal
            title={weekendPromptModal.title}
            prompt={weekendPromptModal.prompt}
            loading={isGeneratingPrompt && !weekendPromptModal.prompt}
            onClose={() => setWeekendPromptModal(null)}
          />
        )}

        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-5xl md:text-7xl font-black tracking-tight text-stone-800 leading-none mb-4"
            style={{ fontFamily: "var(--font-playfair)" }}>
            Just for Today
          </h1>
          <div className="flex items-center justify-center gap-3 mt-2">
            <button onClick={() => navigateDay(-1)} className="text-stone-400 hover:text-stone-700 transition-colors text-lg leading-none" title="Previous day">‹</button>
            <p className="text-stone-400 text-sm tracking-wide">{today}</p>
            {viewingDate
              ? <button onClick={() => navigateDay(1)} className="text-stone-400 hover:text-stone-700 transition-colors text-lg leading-none" title="Next day">›</button>
              : <span className="text-lg leading-none text-stone-200">›</span>
            }
          </div>
          {viewingDate && (
            <p className="text-xs text-stone-300 mt-1">Viewing a past day — read only friendly</p>
          )}
          {viewingDate && (
            <button onClick={() => {
              const d = new Date();
              setViewingDate(null);
              setData(EMPTY);
              setToday(d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
              setStorageKey(getStorageKeyForDate(d));
            }} className="mt-2 text-xs text-amber-600 border border-amber-200 bg-amber-50 rounded-lg px-3 py-1 hover:bg-amber-100 transition-colors">
              → Go to Today
            </button>
          )}
          <p className="text-stone-500 text-sm mt-4 max-w-md mx-auto leading-relaxed">
            Stop managing complicated databases, and get s**t done. A tool designed for those with ADHD to help you DO MORE, and feel better about what you&apos;ve DONE. Time for a celebraish.
          </p>
          <p className="text-stone-400 text-xs mt-2">
            Built by{" "}
            <a href="https://www.instagram.com/themichaelkilcoyne/" target="_blank" rel="noopener noreferrer"
              className="underline underline-offset-2 hover:text-stone-600 transition-colors">
              Michael Kilcoyne
            </a>{" "}with ❤️
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-center gap-3">
            {streak > 0 && (
              <div className="inline-flex items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50 px-3 py-1.5 text-xs font-medium text-amber-600">
                🔥 {streak} day{streak !== 1 ? "s" : ""} in a row
              </div>
            )}
            <button
              onClick={() => {
                const msg = buildShareText();
                if (msg) { navigator.clipboard.writeText(msg); setShareText(msg); setTimeout(() => setShareText(""), 3000); }
              }}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-all shadow-sm">
              {shareText ? "Copied — send it! ✓" : "📣 Share with a friend"}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-3">
            <div className="relative">
              <button
                onClick={() => setShowHistoryMenu((value) => !value)}
                className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-all shadow-sm"
              >
                Yesterday (and Beyond)
                <span className="text-xs">{showHistoryMenu ? "▴" : "▾"}</span>
              </button>
              {showHistoryMenu && (
                <div className="absolute left-1/2 top-full z-20 mt-2 w-56 -translate-x-1/2 rounded-2xl border border-stone-200 bg-white p-2 shadow-lg">
                  {yesterday && (
                    <button
                      onClick={() => {
                        setShowYesterday(true);
                        setShowHistoryMenu(false);
                      }}
                      className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors"
                    >
                      Previous Day Reflection
                    </button>
                  )}
                  <button
                    onClick={() => {
                      setShowRestoreTray((value) => !value);
                      setShowHistoryMenu(false);
                    }}
                    className="flex w-full items-center rounded-xl px-3 py-2 text-left text-sm text-stone-600 hover:bg-stone-50 hover:text-stone-900 transition-colors"
                  >
                    {showRestoreTray ? "Hide View Previous Day" : "View Previous Day"}
                  </button>
                </div>
              )}
            </div>
          </div>
          <div className="mt-6 rounded-3xl border border-stone-200 bg-white/85 px-5 py-4 text-left shadow-sm">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">Today&apos;s momentum</p>
                <p className="mt-1 text-sm text-stone-600">
                  {doneCount} of {completableSections.length} sections complete
                </p>
              </div>
              <p className="text-2xl font-black text-stone-800 tabular-nums" style={{ fontFamily: "var(--font-playfair)" }}>
                {progressPct}%
              </p>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-stone-100">
              <div
                className="h-full rounded-full transition-all duration-300"
                style={{ width: `${progressPct}%`, background: "linear-gradient(90deg, #f59e0b 0%, #ec4899 55%, #34d399 100%)" }}
              />
            </div>
            <p className="mt-3 text-xs text-stone-400">
              The goal isn&apos;t perfection. It&apos;s staying in motion.
            </p>
          </div>
        </div>

        {didHydrateDay && !viewingDate && showRestoreTray && (
          <div className="mb-6 rounded-3xl border border-sky-200 bg-sky-50/80 px-5 py-4 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold uppercase tracking-widest text-sky-700">Restore saved day</p>
                <p className="mt-1 text-sm text-stone-600 leading-relaxed">
                  {savedSnapshots.length
                    ? hasMeaningfulCurrentDay
                      ? "If today's page isn't quite right, pull in one of the saved snapshots below."
                      : "I found saved snapshots in this browser. Pick one to pull your real day back in."
                    : "I couldn't find any saved `jft-*` days in this browser for this localhost app yet."}
                </p>
              </div>
              {savedSnapshots.length > 0 && (
                <div className="rounded-2xl bg-white px-3 py-2 text-right shadow-sm">
                  <p className="text-[11px] uppercase tracking-widest text-stone-400">Found here</p>
                  <p className="mt-1 text-sm font-semibold text-stone-700 tabular-nums">{savedSnapshots.length} saved day{savedSnapshots.length === 1 ? "" : "s"}</p>
                </div>
              )}
            </div>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <button
                onClick={rebuildTodayContext}
                className="rounded-xl border border-sky-200 bg-white px-4 py-2 text-sm font-medium text-sky-700 hover:border-sky-300 hover:text-sky-900 transition-colors"
              >
                Rebuild today around Ben, Tara, and Chris
              </button>
              <p className="text-xs text-stone-400">
                Uses the context you named: Ben meeting follow-up, Tara email, prompts, and Chris at 4:30.
              </p>
            </div>
            {savedSnapshots.length > 0 && (
              <div className="mt-4 grid gap-3">
                {savedSnapshots.slice(0, 6).map((snapshot) => (
                  <div key={snapshot.key} className="flex flex-wrap items-center gap-3 rounded-2xl border border-sky-100 bg-white/90 px-4 py-3">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold text-stone-700">
                        {snapshot.label}
                        {snapshot.key === getStorageKeyForDate(new Date()) && (
                          <span className="ml-2 rounded-full bg-emerald-50 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-700">
                            today
                          </span>
                        )}
                      </p>
                      <p className="mt-1 text-[11px] uppercase tracking-widest text-stone-300">
                        Saved as {snapshot.rawDate}
                      </p>
                      <p className="mt-1 text-xs text-stone-400">
                        {snapshot.summary.length ? snapshot.summary.join(" · ") : "Saved day data"}
                      </p>
                    </div>
                    <button
                      onClick={() => restoreSavedDay(snapshot)}
                      className="rounded-xl bg-stone-800 px-4 py-2 text-sm font-medium text-white hover:bg-stone-700 transition-colors"
                    >
                      Use for today
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Upcoming event reminder */}
        {upcomingEvent && (
          <div className="mb-6 rounded-2xl border border-amber-200 bg-amber-50 px-6 py-4 flex items-start gap-4">
            <span className="text-2xl shrink-0">⏰</span>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 mb-1">
                In {upcomingEvent.minsUntil} minute{upcomingEvent.minsUntil !== 1 ? "s" : ""}
              </p>
              <p className="text-sm font-semibold text-stone-800">{upcomingEvent.block.task}</p>
              {upcomingEvent.block.note && (
                <p className="text-xs text-stone-500 mt-0.5">{upcomingEvent.block.note}</p>
              )}
              <p className="text-xs text-amber-700 mt-2">{eventPrepHint(upcomingEvent.block)}</p>
            </div>
            <button onClick={() => setUpcomingEvent(null)} className="text-stone-300 hover:text-stone-500 text-xs shrink-0">✕</button>
          </div>
        )}

        {!isWeekendMode && archivedSections.length > 0 && (
          <div className="mb-6 rounded-2xl border border-stone-200 bg-white px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-2">Archived sections</p>
            <div className="flex flex-wrap gap-2">
              {archivedSections.map(([key]) => (
                <button
                  key={key}
                  onClick={() => setSectionState(key)}
                  className="rounded-xl border border-stone-200 px-3 py-1.5 text-xs text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-colors"
                >
                  Restore {SECTION_LABELS[key] ?? key}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-col">
        {/* Yesterday's wins banner */}
        {!isWeekendMode && yesterday && !data.brainDump && (
          <Card id="sec-yesterday" className={`mb-6 border-stone-200 bg-gradient-to-br from-stone-50 to-amber-50 ${sectionTone("yesterday")}`} style={{ order: getSectionOrder("sec-yesterday") }}>
            <div className="flex items-start justify-between gap-3 mb-3">
              <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 pt-2">🌅 Yesterday</p>
              <SectionControls
                sectionKey="yesterday"
                sectionId="sec-yesterday"
                done={!!data.done["yesterday"]}
                state={data.sectionState["yesterday"]}
                onToggleDone={toggleSection}
                onSetState={setSectionState}
                onMove={moveSection}
              />
              {yesterday.shotList && yesterday.shotList.length > 0 && (
                <div className="flex gap-2">
                  <GhostButton onClick={() => printList("Yesterday's Shot List", yesterday.shotList!.map(s => (s.done ? "✓ " : "  ") + s.text))}>
                    🖨 Print
                  </GhostButton>
                  <GhostButton onClick={() => {
                    const s = (t: string) => `<h2 style="font-size:11px;text-transform:uppercase;letter-spacing:2px;color:#999;margin-top:24px">${t}</h2>`;
                    let html = `<h1>Yesterday's Shot List</h1>`;
                    html += s("Shot List");
                    html += `<ul>${yesterday.shotList!.map(i => `<li><p>${i.done ? "✓ " : ""}${i.text}</p></li>`).join("")}</ul>`;
                    copyHtmlToClipboard(html).then(() => window.open("https://docs.google.com/document/create", "_blank"));
                  }}>
                    📄 Google Doc
                  </GhostButton>
                </div>
              )}
            </div>
            {/* AI recap — shown when loaded, fades in */}
            {yesterdayRecap && (
              <p className="text-base text-stone-700 leading-relaxed mb-4" style={{ fontFamily: "var(--font-playfair)" }}>
                {yesterdayRecap}
              </p>
            )}
            {/* Yesterday's shot list */}
            {yesterday.shotList && yesterday.shotList.length > 0 && (
              <div className="mb-3">
                <p className="text-xs text-stone-400 uppercase tracking-wide mb-2">Shot List</p>
                <div className="space-y-1">
                  {yesterday.shotList.map((item, i) => (
                    <div key={i} className={`flex items-center gap-2.5 ${item.done ? "opacity-50" : ""}`}>
                      <span className={`w-4 h-4 rounded-full border-2 shrink-0 flex items-center justify-center text-[9px] ${item.done ? "bg-stone-400 border-stone-400 text-white" : "border-stone-300"}`}>
                        {item.done ? "✓" : ""}
                      </span>
                      <span className={`text-sm text-stone-600 ${item.done ? "line-through decoration-stone-400" : ""}`}>{item.text}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
            {/* Raw details — collapsed under the recap */}
            {yesterday.tomorrowBriefing ? (
              <div className="space-y-2 border-t border-amber-100 pt-3">
                {yesterday.tomorrowBriefing.completed.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Done ✓</p>
                    {yesterday.tomorrowBriefing.completed.map((item, i) => (
                      <p key={i} className="text-xs text-stone-500 leading-snug">· {item}</p>
                    ))}
                  </div>
                )}
                {yesterday.tomorrowBriefing.open.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Still open →</p>
                    {yesterday.tomorrowBriefing.open.map((item, i) => (
                      <p key={i} className="text-xs text-stone-500 leading-snug">· {item}</p>
                    ))}
                  </div>
                )}
                {yesterday.tomorrowBriefing.pushedLater?.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Pushed later</p>
                    {yesterday.tomorrowBriefing.pushedLater.map((item, i) => (
                      <p key={i} className="text-xs text-stone-500 leading-snug">· {item}</p>
                    ))}
                  </div>
                )}
                {yesterday.tomorrowBriefing.archived?.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-400 uppercase tracking-wide mb-1">Archived</p>
                    {yesterday.tomorrowBriefing.archived.map((item, i) => (
                      <p key={i} className="text-xs text-stone-500 leading-snug">· {item}</p>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="space-y-1 border-t border-amber-100 pt-3">
                {yesterday.movedForward && (
                  <p className="text-xs text-stone-500">· {yesterday.movedForward}</p>
                )}
                {yesterday.howItFelt && (
                  <p className="text-xs text-stone-400 italic">&ldquo;{yesterday.howItFelt}&rdquo;</p>
                )}
              </div>
            )}
          </Card>
        )}

        {/* Mid-day check-in */}
        {isMidDay && !midDayDismissed && !data.midDayFeeling && (
          <Card className="mb-6 border-amber-200 bg-amber-50" style={{ order: getSectionOrder("sec-midday") }}>
            <div className="flex items-start justify-between mb-2">
              <SectionLabel>Mid-Day Check-In</SectionLabel>
              <button onClick={() => setMidDayDismissed(true)} className="text-stone-400 hover:text-stone-600 text-xs">dismiss</button>
            </div>
            <p className="text-sm text-stone-600 mb-3">Hey — how are you feeling right now? 🌤️</p>
            <textarea
              className="w-full rounded-xl border border-amber-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-amber-200 transition resize-none"
              rows={3}
              placeholder="Quick gut check. Don't overthink it."
              value={data.midDayFeeling}
              onChange={(e) => update("midDayFeeling")(e.target.value)}
            />
          </Card>
        )}
        {!isWeekendMode && data.midDayFeeling && (
          <Card id="sec-midday" className={`mb-6 border-amber-100 bg-amber-50 transition-opacity ${data.done["midday"] ? "opacity-50" : ""} ${sectionTone("midday")}`} style={{ order: getSectionOrder("sec-midday") }}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <SectionTitle sectionKey="midday" defaultTitle="Mid-Day Check-In" sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
              <SectionControls
                sectionKey="midday"
                sectionId="sec-midday"
                done={!!data.done["midday"]}
                state={data.sectionState["midday"]}
                onToggleDone={toggleSection}
                onSetState={setSectionState}
                onMove={moveSection}
              />
            </div>
            <textarea
              className="w-full bg-transparent border-none outline-none resize-none text-sm text-stone-600 placeholder-stone-300"
              rows={2}
              value={data.midDayFeeling}
              onChange={(e) => update("midDayFeeling")(e.target.value)}
            />
          </Card>
        )}

        {/* Brain Dump */}
        <Card id="sec-braindump" className={`mb-6 transition-opacity ${data.done["brainDump"] ? "opacity-50" : ""} ${sectionTone("brainDump")}`} style={{ order: getSectionOrder("sec-braindump") }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <SectionTitle sectionKey="brainDump" defaultTitle="Brain Dump" sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
            <SectionControls
              sectionKey="brainDump"
              sectionId="sec-braindump"
              done={!!data.done["brainDump"]}
              state={data.sectionState["brainDump"]}
              onToggleDone={toggleSection}
              onSetState={setSectionState}
              onMove={moveSection}
              allowDefer={false}
              allowArchive={false}
            />
          </div>
          <SectionLabel>Dump everything on your mind</SectionLabel>
          <textarea
            autoFocus
            className="w-full bg-transparent border-none outline-none resize-none text-stone-700 placeholder-stone-300 text-base leading-relaxed"
            style={{ minHeight: "9rem" }}
            rows={1}
            placeholder="Just start typing. Brain dump. Or, use text to speech."
            value={data.brainDump}
            onChange={(e) => {
              handleBrainDumpChange(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = e.target.scrollHeight + "px";
            }}
            onFocus={(e) => {
              e.target.style.height = "auto";
              e.target.style.height = Math.max(e.target.scrollHeight, 144) + "px";
            }}
          />
          {nudge && (
            <div className="mt-4">
              <CoachNote>{nudge}</CoachNote>
            </div>
          )}
          {data.brainDump.trim() && (
            <div className="mt-4 flex flex-col items-start gap-2">
              <button onClick={generatePlan} disabled={isParsing}
                className="relative w-full rounded-2xl px-6 py-4 text-base font-bold text-white shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98] disabled:opacity-50 disabled:scale-100 overflow-hidden"
                style={{ background: isParsing ? "#a8a29e" : "linear-gradient(135deg, #1c1917 0%, #44403c 50%, #1c1917 100%)" }}>
                <span className="relative z-10">
                  {isParsing ? "✨ Building your plan..." : isWeekendMode ? "Start the Day 👇" : "Ready to plan the day? Click me. 👇"}
                </span>
                {!isParsing && (
                  <span className="absolute inset-0 opacity-0 hover:opacity-100 transition-opacity duration-300"
                    style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ec4899 40%, #8b5cf6 100%)" }} />
                )}
              </button>
              {!isWeekendMode && <div className="relative w-full">
                {/* Invisible textarea captures Cmd+V paste anywhere in the zone */}
                <textarea
                  className="absolute inset-0 w-full h-full opacity-0 cursor-pointer resize-none z-10"
                  readOnly
                  tabIndex={0}
                  placeholder=""
                  onPaste={(e) => {
                    const item = Array.from(e.clipboardData.items).find(i => i.type.startsWith("image/"));
                    if (item) { e.preventDefault(); const f = item.getAsFile(); if (f) importCalendarPhoto(f); }
                  }}
                  onClick={() => !isParsingCalendar && calendarInputRef.current?.click()}
                />
                <div className="w-full rounded-2xl border border-dashed border-stone-200 px-4 py-5 text-center text-sm text-stone-400 hover:border-stone-400 hover:text-stone-600 transition-all pointer-events-none select-none">
                  {isParsingCalendar
                    ? "📸 Reading your calendar…"
                    : <span>📅 Click or paste a screenshot of your calendar <span className="block text-xs text-stone-300 mt-1">Cmd+V to paste · or click to choose a file</span></span>
                  }
                </div>
              </div>}
              {parseError && <span className="text-xs text-rose-400">{parseError}</span>}
            </div>
          )}
          {data.brainDump.trim() && !isWeekendMode && (
            <NextActionButton onClick={() => goToNextSection("sec-braindump")} />
          )}
        </Card>

        {/* Today's Plan */}
        <Card id="sec-plan" className={`mb-6 transition-opacity ${data.done["plan"] ? "opacity-50" : ""} ${sectionTone("plan")}`} style={{ order: getSectionOrder("sec-plan") }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <SectionTitle sectionKey="plan"
              defaultTitle={isWeekendMode ? "Today I Get To Do..." : "Your day at a glance."}
              sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
            <SectionControls
              sectionKey="plan"
              sectionId="sec-plan"
              done={!!data.done["plan"]}
              state={data.sectionState["plan"]}
              onToggleDone={toggleSection}
              onSetState={setSectionState}
              onMove={moveSection}
            />
          </div>
          <SectionLabel>{isWeekendMode ? "Simple to-do dump for the day" : "Top priority · secondary moves · nice-to-haves"}</SectionLabel>
          {!isWeekendMode && (
            <Field label="Top Priority" value={data.topPriority} onChange={update("topPriority")} placeholder="The one thing that matters most today" />
          )}
          <BulletedField label={isWeekendMode ? "To-Do Dump" : "Secondary Moves"} value={data.secondaryMoves} onChange={isWeekendMode ? (value) => {
            const lines = value.split("\n").map((line) => line.trim()).filter(Boolean);
            const nextShotList = lines.map((line) => {
              const existing = data.shotList.find((item) => item.text.toLowerCase() === line.toLowerCase());
              return existing ? { ...existing, text: line, archived: false } : { text: line, done: false, archived: false };
            });
            const updated = {
              ...data,
              topPriority: "",
              secondaryMoves: lines.join("\n"),
              niceToHaves: "",
              shotList: nextShotList,
            };
            setData(updated);
            save(updated);
          } : update("secondaryMoves")} placeholder={isWeekendMode ? "Laundry\nGroceries\nText Alex back\nTidy up\n(one item per line)" : "Other things you want to get done...\n(one item per line)"} />
          {!isWeekendMode && (
            <NiceToHaves value={data.niceToHaves} onChange={update("niceToHaves")} />
          )}
          {isWeekendMode && (
            <div className="mt-5 border-t border-stone-100 pt-5">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-stone-700">Today&apos;s checklist</p>
                  <p className="text-xs text-stone-400">Simple list first. Open something up only if it needs more structure.</p>
                </div>
                <div className="flex items-center gap-2">
                  {data.shotList.length > 0 && (
                    <GhostButton onClick={openChecklistAsProject}>Project?</GhostButton>
                  )}
                  {data.shotList.length > 0 && (
                    <GhostButton onClick={() => setShowDayPlan(true)}>Open to-do list</GhostButton>
                  )}
                </div>
              </div>
              <div className="space-y-2 mb-3">
                {data.shotList.filter((s) => !s.archived && !s.later).map((item) => {
                  const realIdx = data.shotList.indexOf(item);
                  const helpers = isWeekendMode ? getWeekendTaskHelpers(item.text) : [];
                  const isExpanded = expandedWeekendTask === realIdx;
                  return (
                    <div key={realIdx} className={`rounded-2xl border border-stone-200 bg-white px-3 py-2.5 ${item.done ? "opacity-50" : ""}`}>
                      <div className={`flex items-center gap-3 ${!item.done ? "hover:bg-stone-50" : ""}`}>
                        <button onClick={() => toggleShotDone(realIdx)}
                          className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${item.done ? "bg-stone-400 border-stone-400" : "border-stone-300 hover:border-stone-600"}`}>
                          {item.done && <span className="text-white text-xs">✓</span>}
                        </button>
                        <span className={`text-sm text-stone-700 flex-1 ${item.done ? "line-through decoration-stone-400" : ""}`}>{item.text}</span>
                        {!item.done && (
                          <div className="hidden sm:flex items-center gap-1 shrink-0">
                            <button
                              onClick={() => setExpandedWeekendTask((current) => current === realIdx ? null : realIdx)}
                              className="rounded-lg border border-stone-200 px-2 py-1 text-[11px] text-stone-500 hover:border-stone-400 hover:text-stone-800 transition-colors"
                            >
                              {isExpanded ? "Hide" : "Expand"}
                            </button>
                          </div>
                        )}
                      </div>
                      {!item.done && isExpanded && (
                        <div className="mt-3 ml-8 rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Task options</p>
                          <div className="flex flex-wrap gap-2">
                            <button
                              onClick={() => openTaskExpansion(item.text, "expand")}
                              className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] text-stone-600 hover:border-stone-400 hover:text-stone-800 transition-colors"
                            >
                              Break it down
                            </button>
                            <button
                              onClick={() => toggleShotLater(realIdx)}
                              className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] text-stone-600 hover:border-stone-400 hover:text-stone-800 transition-colors"
                            >
                              Later
                            </button>
                            <button
                              onClick={() => moveToTomorrow(realIdx)}
                              className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] text-stone-600 hover:border-stone-400 hover:text-stone-800 transition-colors"
                            >
                              Tomorrow
                            </button>
                          </div>
                        </div>
                      )}
                      {!item.done && helpers.length > 0 && (
                        <div className="mt-3 ml-8 rounded-xl border border-stone-100 bg-stone-50 px-3 py-2.5">
                          <p className="mb-2 text-[11px] font-semibold uppercase tracking-widest text-stone-400">Helpful shortcuts</p>
                          <div className="flex flex-wrap gap-2">
                            {helpers.map((helper) => {
                              if (helper.kind === "link") {
                                return (
                                  <a
                                    key={`${helper.kind}-${helper.label}`}
                                    href={helper.value}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] text-stone-600 hover:border-stone-400 hover:text-stone-800 transition-colors"
                                  >
                                    {helper.label}
                                  </a>
                                );
                              }

                              if (helper.kind === "prompt") {
                                return (
                                  <button
                                    key={`${helper.kind}-${helper.label}`}
                                    onClick={() => generatePromptFromBrief(item.text, helper.value)}
                                    className="rounded-lg border border-stone-200 bg-white px-2.5 py-1.5 text-[11px] text-stone-600 hover:border-stone-400 hover:text-stone-800 transition-colors"
                                  >
                                    {helper.label}
                                  </button>
                                );
                              }

                              return <CopyButton key={`${helper.kind}-${helper.label}`} text={helper.value} label={helper.label} />;
                            })}
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              {data.shotList.some((item) => item.later && !item.archived) && (
                <div className="mb-4 rounded-2xl border border-stone-100 bg-stone-50 px-4 py-4">
                  <p className="mb-2 text-sm font-semibold text-stone-700">Later today</p>
                  <div className="space-y-2">
                    {data.shotList.filter((item) => item.later && !item.archived).map((item) => {
                      const realIdx = data.shotList.indexOf(item);
                      return (
                        <div key={`later-${realIdx}`} className="flex items-center gap-3 rounded-xl border border-stone-200 bg-white px-3 py-2.5">
                          <span className="text-xs uppercase tracking-wide text-stone-400">Later</span>
                          <span className="flex-1 text-sm text-stone-600">{item.text}</span>
                          <button
                            onClick={() => toggleShotLater(realIdx)}
                            className="rounded-lg border border-stone-200 px-2 py-1 text-[11px] text-stone-500 hover:border-stone-400 hover:text-stone-800 transition-colors"
                          >
                            Bring back
                          </button>
                          <button
                            onClick={() => moveToTomorrow(realIdx)}
                            className="rounded-lg border border-stone-200 px-2 py-1 text-[11px] text-stone-500 hover:border-stone-400 hover:text-stone-800 transition-colors"
                          >
                            Tomorrow
                          </button>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
              {data.texts.length > 0 && (
                <div className="mb-4 rounded-2xl border border-stone-100 bg-stone-50 px-4 py-4">
                  <div className="mb-3 flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-stone-700">Helpful texts</p>
                      <p className="text-xs text-stone-400">Copy, paste, and keep moving.</p>
                    </div>
                    <span className="rounded-full border border-stone-200 bg-white px-2.5 py-1 text-[11px] text-stone-500">
                      {data.texts.length} ready
                    </span>
                  </div>
                  <div className="space-y-2.5">
                    {data.texts.map((text, index) => (
                      <div key={`${text.to}-${index}`} className="rounded-xl border border-stone-200 bg-white px-3 py-3">
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <p className="text-xs font-semibold uppercase tracking-wide text-stone-400">{text.to}</p>
                          <CopyButton text={text.draft} label="Copy text" />
                        </div>
                        <p className="whitespace-pre-wrap text-sm leading-relaxed text-stone-600">{text.draft}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              <div className="flex gap-2">
                <input
                  ref={shotInputRef}
                  type="text"
                  className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
                  placeholder="Add a to-do..."
                  value={newShotItem}
                  onChange={(e) => setNewShotItem(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addShotItem(); } }}
                />
                <button onClick={addShotItem} className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
                  Add
                </button>
              </div>
            </div>
          )}
          <NextActionButton
            onClick={() => {
              if (isWeekendMode) {
                setShowReflectionModal(true);
                return;
              }
              goToNextSection("sec-plan");
            }}
            label={isWeekendMode ? "I'm done with the day. Time to reflect..." : undefined}
          />
        </Card>

        {/* Generated Content */}
        {!isWeekendMode && hasGeneratedContent && (
          <>
            {/* Schedule */}
            {data.schedule.length > 0 && (
              <Card id="sec-schedule" className={`mb-6 transition-opacity ${data.done["schedule"] ? "opacity-50" : ""} ${sectionTone("schedule")}`} style={{ order: getSectionOrder("sec-schedule") }}>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <SectionTitle sectionKey="schedule"
                    defaultTitle={`${data.schedule.length} block${data.schedule.length !== 1 ? "s" : ""} today`}
                    sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
                  <div className="flex items-center gap-2 shrink-0">
                    <GhostButton onClick={() => calendarInputRef.current?.click()} disabled={isParsingCalendar}>
                      {isParsingCalendar ? "Reading…" : "📅 Update from photo"}
                    </GhostButton>
                    <SectionControls
                      sectionKey="schedule"
                      sectionId="sec-schedule"
                      done={!!data.done["schedule"]}
                      state={data.sectionState["schedule"]}
                      onToggleDone={toggleSection}
                      onSetState={setSectionState}
                      onMove={moveSection}
                    />
                  </div>
                </div>
                <SectionLabel>Today&apos;s calendar</SectionLabel>
                <div>
                  {data.schedule.map((block, i) => (
                    <div key={i} className="flex items-baseline gap-4 py-3 border-b border-stone-100 last:border-0">
                      <span className="text-sm font-black text-stone-800 shrink-0 w-24 tabular-nums">{block.time}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-semibold text-stone-700 leading-snug">{block.task}</p>
                        {block.note && <p className="text-xs text-stone-400 mt-0.5 leading-relaxed">{block.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
                <NextActionButton onClick={() => goToNextSection("sec-schedule")} />
              </Card>
            )}

            {/* Texts to Send */}
            {data.texts.length > 0 && (
              <Card id="sec-texts" className={`mb-6 transition-opacity ${data.done["texts"] ? "opacity-50" : ""} ${sectionTone("texts")}`} style={{ order: getSectionOrder("sec-texts") }}>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <SectionTitle sectionKey="texts"
                    defaultTitle={`Send ${data.texts.length} text${data.texts.length !== 1 ? "s" : ""}`}
                    sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
                  <SectionControls
                    sectionKey="texts"
                    sectionId="sec-texts"
                    done={!!data.done["texts"]}
                    state={data.sectionState["texts"]}
                    onToggleDone={toggleSection}
                    onSetState={setSectionState}
                    onMove={moveSection}
                  />
                </div>
                <SectionLabel>Drafts ready to copy-paste</SectionLabel>
                <div className="space-y-3">
                  {data.texts.map((t, i) => (
                    <div key={i} className={`rounded-xl border bg-white p-4 transition-all duration-300 ${t.done ? "border-stone-100 opacity-60" : "border-stone-200"}`}>
                      <div className="flex items-center gap-3 mb-2">
                        <button onClick={() => toggleTextDone(i)}
                          className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all duration-200 ${t.done ? "bg-stone-400 border-stone-400" : "border-stone-300 hover:border-stone-500"}`}>
                          {t.done && <span className="text-white text-xs">✓</span>}
                        </button>
                        <span className="text-xs font-semibold text-stone-400 uppercase tracking-wide relative">
                          To: {t.to}
                          {t.done && <span className="strike-line opacity-60" />}
                        </span>
                        <div className="ml-auto flex items-center gap-2">
                          <CopyButton text={t.draft} />
                          <button onClick={() => removeText(i)} className="text-stone-300 hover:text-rose-400 transition-colors text-xs" title="Remove">✕</button>
                        </div>
                      </div>
                      <p className={`text-sm text-stone-600 leading-relaxed whitespace-pre-wrap pl-8 transition-all duration-300 ${t.done ? "line-through decoration-stone-400" : ""}`}>
                        {t.draft}
                      </p>
                    </div>
                  ))}
                </div>
                <AddTextForm onAdd={addTextWithDraft} />
                <NextActionButton onClick={() => goToNextSection("sec-texts")} />
              </Card>
            )}

            {/* Emails to Send */}
            {data.emails.length > 0 && (
              <Card id="sec-emails" className={`mb-6 transition-opacity ${data.done["emails"] ? "opacity-50" : ""} ${sectionTone("emails")}`} style={{ order: getSectionOrder("sec-emails") }}>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <SectionTitle sectionKey="emails"
                    defaultTitle={`Send ${data.emails.length} email${data.emails.length !== 1 ? "s" : ""}`}
                    sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
                  <SectionControls
                    sectionKey="emails"
                    sectionId="sec-emails"
                    done={!!data.done["emails"]}
                    state={data.sectionState["emails"]}
                    onToggleDone={toggleSection}
                    onSetState={setSectionState}
                    onMove={moveSection}
                  />
                </div>
                <div className="space-y-4">
                  {data.emails.map((e, i) => (
                    <div key={i} className="rounded-xl border border-stone-200 bg-white p-4 transition-all group">
                      <div className="flex items-start justify-between mb-2 gap-3">
                        <div className="flex-1 cursor-pointer" onClick={() => setEmailModal(e)}>
                          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">To: {e.to}</p>
                          <p className="text-sm font-medium text-stone-600 mt-0.5">{e.subject}</p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span onClick={() => setEmailModal(e)} className="text-xs text-stone-300 hover:text-stone-500 transition-colors cursor-pointer pt-0.5">Open →</span>
                          <button onClick={() => removeEmail(i)} className="text-stone-300 hover:text-rose-400 transition-colors text-xs" title="Remove">✕</button>
                        </div>
                      </div>
                      <p className="text-sm text-stone-400 leading-relaxed line-clamp-2 mt-2 pt-2 border-t border-stone-100 cursor-pointer" onClick={() => setEmailModal(e)}>
                        {e.draft}
                      </p>
                    </div>
                  ))}
                </div>
                <AddEmailForm onAdd={addEmailWithDraft} />
                <NextActionButton onClick={() => goToNextSection("sec-emails")} />
              </Card>
            )}

            {/* Project Plan */}
            {data.projectPlan && (
              <Card id="sec-projectplan" className={`mb-6 transition-opacity ${data.done["projectPlan"] ? "opacity-50" : ""} ${sectionTone("projectPlan")}`} style={{ order: getSectionOrder("sec-projectplan") }}>
                <div className="flex items-start justify-between gap-3 mb-1">
                  <SectionTitle sectionKey="projectPlan" defaultTitle="Project Plan"
                    sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
                  <div className="flex items-center gap-2 shrink-0">
                    <SectionControls
                      sectionKey="projectPlan"
                      sectionId="sec-projectplan"
                      done={!!data.done["projectPlan"]}
                      state={data.sectionState["projectPlan"]}
                      onToggleDone={toggleSection}
                      onSetState={setSectionState}
                      onMove={moveSection}
                    />
                    <CopyButton text={data.projectPlan} label="Copy" />
                  </div>
                </div>
                <SectionLabel>Action steps</SectionLabel>
                <div>{renderBullets(data.projectPlan)}</div>
                <NextActionButton onClick={() => goToNextSection("sec-projectplan")} />
              </Card>
            )}
          </>
        )}

        {/* Shot List */}
        <Card id="sec-shotlist" className={`${weekendHidden} mb-6 transition-opacity ${data.done["shotList"] ? "opacity-50" : ""} ${sectionTone("shotList")}`} style={{ order: getSectionOrder("sec-shotlist") }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <SectionTitle sectionKey="shotList"
              defaultTitle={(() => {
                const open = data.shotList.filter(s => !s.done).length;
                if (isWeekendMode) return open > 0 ? `${open} thing${open !== 1 ? "s" : ""} for today` : "Today's To-Do";
                return open > 0 ? `${open} item${open !== 1 ? "s" : ""} to knock out` : "Shot List";
              })()}
              sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
            <div className="flex items-center gap-2 shrink-0">
              <SectionControls
                sectionKey="shotList"
                sectionId="sec-shotlist"
                done={!!data.done["shotList"]}
                state={data.sectionState["shotList"]}
                onToggleDone={toggleSection}
                onSetState={setSectionState}
                onMove={moveSection}
              />
              {data.shotList.length > 0 && (
                <GhostButton onClick={() => printList("Shot List", data.shotList.map(s => s.text))}>
                  🖨 Print
                </GhostButton>
              )}
            </div>
          </div>
          <SectionLabel>{isWeekendMode ? "Clean checklist first. Expand only if something turns into a project." : "Check things off as you go"}</SectionLabel>
          <div className="space-y-1 mb-3 max-h-96 overflow-y-auto pr-1">
            {data.shotList.filter(s => !s.archived).map((item) => {
              const realIdx = data.shotList.indexOf(item);
              return (
                <div key={realIdx}>
                  <div className={`flex items-center gap-3 group rounded-xl px-3 py-2 transition-all relative ${item.done ? "opacity-50" : "hover:bg-stone-50"}`}>
                    <button onClick={() => toggleShotDone(realIdx)}
                      className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${item.done ? "bg-stone-400 border-stone-400" : "border-stone-300 hover:border-stone-600"}`}>
                      {item.done && <span className="text-white text-xs">✓</span>}
                    </button>
                    <span className={`text-sm text-stone-700 flex-1 ${item.done ? "line-through decoration-stone-400" : ""}`}>{item.text}</span>
                    {isWeekendMode && !item.done && (
                      <div className="hidden sm:flex items-center gap-1 shrink-0">
                        <button
                          onClick={() => openTaskExpansion(item.text, "expand")}
                          className="rounded-lg border border-stone-200 px-2 py-1 text-[11px] text-stone-500 hover:border-stone-400 hover:text-stone-800 transition-colors"
                        >
                          Expand
                        </button>
                        <button
                          onClick={() => openTaskExpansion(item.text, "project")}
                          className="rounded-lg border border-stone-200 px-2 py-1 text-[11px] text-stone-500 hover:border-stone-400 hover:text-stone-800 transition-colors"
                        >
                          Project?
                        </button>
                      </div>
                    )}
                    <div className="flex items-center gap-1.5 opacity-0 group-hover:opacity-100 transition-all shrink-0">
                      <button onClick={() => moveToTomorrow(realIdx)} title="Move to tomorrow" className="text-stone-300 hover:text-amber-500 text-xs">→ tmrw</button>
                      <button
                        onClick={(e) => { e.stopPropagation(); setShotMenu(shotMenu === realIdx ? null : realIdx); }}
                        className="text-stone-300 hover:text-stone-600 text-xs px-1.5 py-0.5 rounded-md hover:bg-stone-100">
                        ···
                      </button>
                    </div>
                    {shotMenu === realIdx && (
                      <div className="absolute right-0 top-full mt-1 z-20 bg-white border border-stone-200 rounded-xl shadow-lg py-1 min-w-[170px]" onClick={e => e.stopPropagation()}>
                        <button onClick={() => { navigator.clipboard.writeText(item.text); setShotMenu(null); }}
                          className="w-full text-left px-4 py-2 text-xs text-stone-600 hover:bg-stone-50">
                          📋 Copy to clipboard
                        </button>
                        <button onClick={() => {
                          const appended = (data.projectPlan ? data.projectPlan + "\n" : "") + `• ${item.text}`;
                          const updated = { ...data, projectPlan: appended };
                          setData(updated); save(updated); setShotMenu(null);
                        }} className="w-full text-left px-4 py-2 text-xs text-stone-600 hover:bg-stone-50">
                          📝 Add to project plan
                        </button>
                        <button onClick={() => {
                          const draft: TextDraft = { to: "", draft: item.text };
                          const updated = { ...data, texts: [...data.texts, draft] };
                          setData(updated); save(updated); setShotMenu(null);
                        }} className="w-full text-left px-4 py-2 text-xs text-stone-600 hover:bg-stone-50">
                          💬 Draft a message
                        </button>
                        <div className="border-t border-stone-100 my-1" />
                        <button onClick={() => { archiveShotItem(realIdx); setShotMenu(null); }}
                          className="w-full text-left px-4 py-2 text-xs text-stone-400 hover:bg-stone-50">
                          🗃 Archive (no longer relevant)
                        </button>
                        <button onClick={() => { removeShotItem(realIdx); setShotMenu(null); }}
                          className="w-full text-left px-4 py-2 text-xs text-rose-400 hover:bg-rose-50">
                          ✕ Remove
                        </button>
                      </div>
                    )}
                  </div>
                  {!item.done && isVagueItem(item.text) && (
                    <p className="text-xs text-amber-600 ml-11 mb-1">
                      This seems incomplete. Wanna clarify? <span className="opacity-50">(edit above)</span>
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          {/* Archived items */}
          {data.shotList.some(s => s.archived) && (
            <div className="mb-3">
              <button onClick={() => setShowArchived(v => !v)}
                className="text-xs text-stone-400 hover:text-stone-600 transition-colors flex items-center gap-1">
                {showArchived ? "▾" : "▸"} {data.shotList.filter(s => s.archived).length} archived
              </button>
              {showArchived && (
                <div className="mt-1.5 space-y-1 pl-2 border-l-2 border-stone-100">
                  {data.shotList.filter(s => s.archived).map((item) => {
                    const realIdx = data.shotList.indexOf(item);
                    return (
                      <div key={realIdx} className="flex items-center gap-2 group py-1">
                        <span className="text-xs text-stone-300 line-through flex-1">{item.text}</span>
                        <button onClick={() => {
                          const updated = { ...data, shotList: data.shotList.map((s, idx) => idx === realIdx ? { ...s, archived: false } : s) };
                          setData(updated); save(updated);
                        }} className="text-[10px] text-stone-300 hover:text-stone-600 opacity-0 group-hover:opacity-100 transition-all">
                          restore
                        </button>
                        <button onClick={() => removeShotItem(realIdx)} className="text-[10px] text-stone-300 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all">✕</button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <div className="flex gap-2">
            <input
              ref={shotInputRef}
              type="text"
              className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
              placeholder="Add a shot or task… press Enter"
              value={newShotItem}
              onChange={(e) => setNewShotItem(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addShotItem(); } }}
            />
            <button onClick={addShotItem} className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-500 hover:text-stone-800 transition-colors">
              Add
            </button>
          </div>
          {(data.shotList.length > 0 || data.meetingPrep.title || data.meetingPrep.notes || data.meetingPrep.followUpActions) && (
            <NextActionButton onClick={() => goToNextSection("sec-shotlist")} />
          )}
        </Card>

        {!isWeekendMode && (data.meetingPrep.title || data.meetingPrep.notes || data.meetingPrep.agenda || data.meetingPrep.followUpActions) && (
          <Card id="sec-meetingprep" className={`mb-6 border-sky-200 bg-sky-50 ${sectionTone("meetingPrep")}`} style={{ order: getSectionOrder("sec-meetingprep") }}>
            <div className="mb-3">
              <div className="mb-2">
                <SectionTitle
                  sectionKey="meetingPrep"
                  defaultTitle={data.meetingPrep.title || "Meeting Prep"}
                  sectionTitles={data.sectionTitles}
                  onSave={saveSectionTitle}
                />
                <SectionLabel>Context · notes · outcomes</SectionLabel>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <SectionControls
                  sectionKey="meetingPrep"
                  sectionId="sec-meetingprep"
                  done={!!data.done["meetingPrep"]}
                  state={data.sectionState["meetingPrep"]}
                  onToggleDone={toggleSection}
                  onSetState={setSectionState}
                  onMove={moveSection}
                />
                <GhostButton onClick={() => setShowMeetingPrep(true)}>Open notes</GhostButton>
                <GhostButton onClick={seedPromptFromMeeting}>Generate prompt</GhostButton>
                <CopyButton
                  text={[
                    data.meetingPrep.title,
                    data.meetingPrep.notes,
                    data.meetingPrep.agenda ? `Agenda\n${data.meetingPrep.agenda}` : "",
                    data.meetingPrep.followUpActions ? `Follow-up actions\n${data.meetingPrep.followUpActions}` : "",
                  ].filter(Boolean).join("\n\n")}
                  label="Copy"
                />
              </div>
            </div>
            {data.meetingPrep.notes && (
              <div className="rounded-2xl border border-sky-100 bg-white/90 p-4 mb-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-sky-600 mb-2">Meeting notes</p>
                <p className="text-sm text-stone-600 whitespace-pre-wrap leading-relaxed">{data.meetingPrep.notes}</p>
              </div>
            )}
            {data.meetingPrep.agenda && (
              <div className="rounded-2xl border border-sky-100 bg-white/90 p-4">
                <p className="text-xs font-semibold uppercase tracking-widest text-sky-600 mb-2">Agenda</p>
                <p className="text-sm text-stone-600 whitespace-pre-wrap leading-relaxed">{data.meetingPrep.agenda}</p>
              </div>
            )}
            {data.meetingPrep.followUpActions && (
              <div className="rounded-2xl border border-sky-100 bg-white/90 p-4 mt-3">
                <p className="text-xs font-semibold uppercase tracking-widest text-sky-600 mb-2">Follow-up actions</p>
                <p className="text-sm text-stone-600 whitespace-pre-wrap leading-relaxed">{data.meetingPrep.followUpActions}</p>
              </div>
            )}
            <NextActionButton onClick={() => goToNextSection("sec-meetingprep")} />
          </Card>
        )}

        {/* Interview Gameplan */}
        {!isWeekendMode && <Card id="sec-interviews" className={`mb-6 transition-opacity ${data.done["interviews"] ? "opacity-50" : ""} ${sectionTone("interviews")}`} style={{ order: getSectionOrder("sec-interviews") }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <div>
              <SectionTitle sectionKey="interviews"
                defaultTitle={data.interviewees.length > 0 ? `${data.interviewees.length} interview${data.interviewees.length !== 1 ? "s" : ""} prepped` : "Interview Gameplan"}
                sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
              <SectionLabel>Questions · one-pagers · logistics</SectionLabel>
            </div>
            <div className="flex gap-2 shrink-0 flex-wrap justify-end">
              <SectionControls
                sectionKey="interviews"
                sectionId="sec-interviews"
                done={!!data.done["interviews"]}
                state={data.sectionState["interviews"]}
                onToggleDone={toggleSection}
                onSetState={setSectionState}
                onMove={moveSection}
              />
              {data.interviewees.length > 0 && (<>
                <GhostButton onClick={() => openAsGoogleDoc(getInterviewTitle(data.interviewGameplan), data.interviewees)}>
                  📄 Google Doc
                </GhostButton>
                <GhostButton onClick={() => printAllInterviews(getInterviewTitle(data.interviewGameplan), data.interviewees)}>
                  🖨 Print All
                </GhostButton>
              </>)}
              <GhostButton onClick={generateInterviewQuestions} disabled={isGeneratingQuestions}>
                {isGeneratingQuestions ? "Generating..." : "✦ Create Questions"}
              </GhostButton>
            </div>
          </div>

          {data.interviewees.length > 0 && (
            <div className="space-y-3 mb-4">
              {data.interviewees.map((person, pi) => (
                <div key={pi} className="rounded-xl border border-stone-200 bg-white p-4">
                  <div className="flex items-center justify-between mb-3">
                    <p className="text-xs font-semibold uppercase tracking-widest text-stone-400">
                      {person.name}
                    </p>
                    <div className="flex items-center gap-2">
                      <span className="text-xs text-stone-300">{person.questions.length} questions</span>
                      <GhostButton onClick={() => printOnePager(getInterviewTitle(data.interviewGameplan), person.name, person.questions)}>
                        🖨 Print
                      </GhostButton>
                    </div>
                  </div>
                  <div className="space-y-2">
                    {person.questions.map((q, i) => (
                      <div key={i} className="flex gap-2.5">
                        <span className="text-stone-400 text-xs mt-1 shrink-0">{i + 1}.</span>
                        <p className="text-sm text-stone-600 leading-relaxed">{q}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          <textarea
            className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none"
            rows={5}
            placeholder={"Who are you interviewing? What do you need to prepare?\n\nThis will auto-fill if you mention interviews in your brain dump."}
            value={data.interviewGameplan}
            onChange={(e) => {
              update("interviewGameplan")(e.target.value);
              autoGrow(e.target);
            }}
            onFocus={(e) => autoGrow(e.target)}
          />
          {(data.interviewGameplan || data.interviewees.length > 0) && (
            <NextActionButton onClick={() => goToNextSection("sec-interviews")} />
          )}
        </Card>}

        {/* Project Links */}
        {!isWeekendMode && <Card id="sec-projectlinks" className={`mb-6 ${sectionTone("projectLinks")}`} style={{ order: getSectionOrder("sec-projectlinks") }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <SectionTitle sectionKey="projectLinks" defaultTitle="Project Links"
              sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
            <SectionControls
              sectionKey="projectLinks"
              sectionId="sec-projectlinks"
              done={!!data.done["projectLinks"]}
              state={data.sectionState["projectLinks"]}
              onToggleDone={toggleSection}
              onSetState={setSectionState}
              onMove={moveSection}
            />
          </div>
          <SectionLabel>Open your tools from here</SectionLabel>
          <div className="flex gap-2 mb-3">
            <input type="url"
              className="flex-1 rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
              placeholder="Paste a Canva, Figma, or project link..."
              value={data.projectLink}
              onChange={(e) => update("projectLink")(e.target.value)}
            />
            {data.projectLink && projectMeta && (
              <div className="flex gap-2 shrink-0">
                {projectMeta.desktopUrl && (
                  <a href={projectMeta.desktopUrl}
                    className="rounded-xl border border-stone-200 bg-white px-3 py-2.5 text-xs text-stone-400 hover:text-stone-700 transition-colors whitespace-nowrap"
                    title="Open in desktop app">
                    🖥 Desktop
                  </a>
                )}
                <a href={data.projectLink} target="_blank" rel="noopener noreferrer"
                  className="rounded-xl border border-stone-200 bg-white px-4 py-2.5 text-sm text-stone-500 hover:text-stone-800 transition-colors whitespace-nowrap">
                  {projectMeta.icon} {projectMeta.name}
                </a>
              </div>
            )}
          </div>
          <a href={ANTIGRAVITY_URL} target="_blank" rel="noopener noreferrer"
            className="flex items-center justify-center gap-2 w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-300 transition-colors">
            ⚡ Start a New Chat in AntiGravity
          </a>
          {data.projectLink && (
            <NextActionButton onClick={() => goToNextSection("sec-projectlinks")} />
          )}
        </Card>}

        {/* Quick Email Composer */}
        {!isWeekendMode && <Card id="sec-email" className={`mb-6 transition-opacity ${data.done["composeEmail"] ? "opacity-50" : ""} ${sectionTone("composeEmail")}`} style={{ order: getSectionOrder("sec-email") }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <SectionTitle sectionKey="composeEmail"
              defaultTitle={data.composeEmail.to ? `Email to ${data.composeEmail.to}` : "Quick Email"}
              sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
            <SectionControls
              sectionKey="composeEmail"
              sectionId="sec-email"
              done={!!data.done["composeEmail"]}
              state={data.sectionState["composeEmail"]}
              onToggleDone={toggleSection}
              onSetState={setSectionState}
              onMove={moveSection}
            />
          </div>
          <SectionLabel>Draft it, then open in Hey or copy</SectionLabel>
          <div className="flex gap-3 mb-3">
            <div className="flex-1">
              <label className="block text-sm font-medium text-stone-500 mb-1.5">To</label>
              <input type="text"
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
                placeholder="Diego, attorneys..."
                value={data.composeEmail.to}
                onChange={(e) => updateCompose("to")(e.target.value)}
              />
            </div>
            <div className="flex-1">
              <label className="block text-sm font-medium text-stone-500 mb-1.5">Subject</label>
              <input type="text"
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition"
                placeholder="Let's wrap this up"
                value={data.composeEmail.subject}
                onChange={(e) => updateCompose("subject")(e.target.value)}
              />
            </div>
          </div>
          <div className="mb-3">
            <label className="block text-sm font-medium text-stone-500 mb-1.5">What do you want to say?</label>
            <textarea
              className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none"
              rows={3}
              placeholder="Key points, tone, anything relevant... e.g. 'remind them we need a decision by Friday, keep it warm but firm'"
              value={data.composeEmail.notes}
              onChange={(e) => {
                updateCompose("notes")(e.target.value);
                autoGrow(e.target);
              }}
              onFocus={(e) => autoGrow(e.target)}
            />
          </div>
          <div className="flex items-center gap-2 mb-4">
            <button
              onClick={generateEmail}
              disabled={isGeneratingEmail || !data.composeEmail.notes.trim()}
              className="rounded-xl bg-stone-800 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700 transition-colors disabled:opacity-40">
              {isGeneratingEmail ? "Drafting..." : "Generate Draft →"}
            </button>
          </div>
          {data.composeEmail.draft && (
            <div className="rounded-xl border border-stone-200 bg-white p-4">
              <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">
                Draft{data.composeEmail.to ? ` → ${data.composeEmail.to}` : ""}
              </p>
              <textarea
                className="w-full text-sm text-stone-600 leading-relaxed resize-none border-none outline-none bg-transparent"
                rows={6}
                value={data.composeEmail.draft}
                onChange={(e) => {
                  updateCompose("draft")(e.target.value);
                  autoGrow(e.target);
                }}
                onFocus={(e) => autoGrow(e.target)}
              />
              <div className="flex items-center gap-2 pt-3 border-t border-stone-100 mt-2">
                <button
                  onClick={() => {
                    const url = `https://app.hey.com/compose?to=${encodeURIComponent(data.composeEmail.to)}&subject=${encodeURIComponent(data.composeEmail.subject)}&body=${encodeURIComponent(data.composeEmail.draft)}`;
                    window.open(url, "_blank");
                  }}
                  className="flex-1 rounded-xl bg-stone-800 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700 transition-colors text-center">
                  Open in Hey ✉️
                </button>
                <CopyButton text={`${data.composeEmail.subject ? `Subject: ${data.composeEmail.subject}\n\n` : ""}${data.composeEmail.draft}`} label="Copy" />
              </div>
            </div>
          )}
          {(data.composeEmail.notes || data.composeEmail.draft) && (
            <NextActionButton onClick={() => goToNextSection("sec-email")} />
          )}
        </Card>}

        {/* Prompt Builder */}
        {!isWeekendMode && (data.done["composeEmail"] || data.promptBuilder.brief) && (
          <Card id="sec-prompt" className={`mb-6 transition-opacity ${data.done["promptBuilder"] ? "opacity-50" : ""} ${sectionTone("promptBuilder")}`} style={{ order: getSectionOrder("sec-prompt") }}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <SectionTitle sectionKey="promptBuilder" defaultTitle="Build a Prompt"
                sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
              <SectionControls
                sectionKey="promptBuilder"
                sectionId="sec-prompt"
                done={!!data.done["promptBuilder"]}
                state={data.sectionState["promptBuilder"]}
                onToggleDone={toggleSection}
                onSetState={setSectionState}
                onMove={moveSection}
              />
            </div>
            <SectionLabel>
              {data.done["composeEmail"] && !data.promptBuilder.brief ? "Next up 👇" : "Describe what you need · get a ready-to-use prompt"}
            </SectionLabel>
            <div className="mb-3">
              <label className="block text-sm font-medium text-stone-500 mb-1.5">What do you need to build?</label>
              <textarea
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-300 transition resize-none"
                rows={3}
                placeholder="e.g. Build out landing page for Jim — hero section, testimonials, CTA. Clean and minimal. Target audience: small business owners."
                value={data.promptBuilder.brief}
                onChange={(e) => {
                  const updated = { ...data, promptBuilder: { ...data.promptBuilder, brief: e.target.value } };
                  setData(updated); save(updated);
                  autoGrow(e.target);
                }}
                onFocus={(e) => autoGrow(e.target)}
              />
            </div>
            <div className="flex items-center gap-2 mb-4">
              <button
                onClick={generatePrompt}
                disabled={isGeneratingPrompt || !data.promptBuilder.brief.trim()}
                className="rounded-xl bg-stone-800 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700 transition-colors disabled:opacity-40">
                {isGeneratingPrompt ? "Building..." : "Generate Prompt →"}
              </button>
            </div>
            {data.promptBuilder.prompt && (
              <div className="rounded-xl border border-stone-200 bg-white p-4">
                <p className="text-xs font-semibold text-stone-400 uppercase tracking-widest mb-2">Generated Prompt</p>
                <textarea
                  className="w-full text-sm text-stone-600 leading-relaxed resize-none border-none outline-none bg-transparent"
                  rows={6}
                  value={data.promptBuilder.prompt}
                  onChange={(e) => {
                    const updated = { ...data, promptBuilder: { ...data.promptBuilder, prompt: e.target.value } };
                    setData(updated); save(updated);
                    autoGrow(e.target);
                  }}
                  onFocus={(e) => autoGrow(e.target)}
                />
                <div className="flex items-center gap-2 pt-3 border-t border-stone-100 mt-2">
                  <a href={`${ANTIGRAVITY_URL}`} target="_blank" rel="noopener noreferrer"
                    onClick={() => navigator.clipboard.writeText(data.promptBuilder.prompt)}
                    className="flex-1 rounded-xl bg-stone-800 text-white px-4 py-2 text-sm font-medium hover:bg-stone-700 transition-colors text-center">
                    Copy &amp; Open in AntiGravity ⚡
                  </a>
                  <CopyButton text={data.promptBuilder.prompt} label="Copy" />
                </div>
              </div>
            )}
            {(data.promptBuilder.brief || data.promptBuilder.prompt) && (
              <NextActionButton onClick={() => goToNextSection("sec-prompt")} />
            )}
          </Card>
        )}

        {/* Weekend Mode */}
        {!isWeekendMode && (dayOfWeek === 6 || dayOfWeek === 0) && (
          <Card id="sec-weekend" className={`mb-6 border-stone-200 bg-gradient-to-br from-stone-50 to-sky-50 ${sectionTone("weekend")}`} style={{ order: getSectionOrder("sec-weekend") }}>
            <div className="flex items-start justify-between gap-3 mb-1">
              <SectionTitle
                sectionKey="weekend"
                defaultTitle={dayOfWeek === 6 ? "Catching Up on the Week" : "Plan the Week, then Chill"}
                sectionTitles={data.sectionTitles} onSave={saveSectionTitle}
              />
              <SectionControls
                sectionKey="weekend"
                sectionId="sec-weekend"
                done={!!data.done["weekend"]}
                state={data.sectionState["weekend"]}
                onToggleDone={toggleSection}
                onSetState={setSectionState}
                onMove={moveSection}
              />
            </div>
            <SectionLabel>{dayOfWeek === 6 ? "Light Chore Mode — Saturday" : "Wind down and look ahead — Sunday"}</SectionLabel>
            <p className="text-sm text-stone-500 mb-4 mt-2">
              {dayOfWeek === 6
                ? "What loose ends from the week do you want to tie up today?"
                : "What do you want to feel good about going into Monday?"}
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-stone-500 mb-1.5">
                What restorative things are you getting into this weekend? 🌿
              </label>
              <textarea
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-200 transition resize-none"
                rows={3}
                placeholder="Hiking, reading, cooking, a movie... what sounds good?"
                value={data.weekendVibes}
                onChange={(e) => update("weekendVibes")(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-stone-500 mb-1.5">Links to look forward to</label>
              <textarea
                className="w-full rounded-xl border border-stone-200 bg-white px-4 py-3 text-sm text-stone-700 placeholder-stone-300 focus:outline-none focus:ring-2 focus:ring-stone-200 transition resize-none"
                rows={3}
                placeholder="Podcast, show, book, event... paste links or just name them"
                value={data.weekendLinks}
                onChange={(e) => update("weekendLinks")(e.target.value)}
              />
            </div>
          </Card>
        )}

        {/* Reflection */}
        {!isWeekendMode && <Card id="sec-reflection" className={`mb-8 ${sectionTone("reflection")}`} style={{ order: getSectionOrder("sec-reflection") }}>
          <div className="flex items-start justify-between gap-3 mb-1">
            <SectionTitle sectionKey="reflection" defaultTitle="Wrap Up the Day"
              sectionTitles={data.sectionTitles} onSave={saveSectionTitle} />
            <SectionControls
              sectionKey="reflection"
              sectionId="sec-reflection"
              done={!!data.done["reflection"]}
              state={data.sectionState["reflection"]}
              onToggleDone={toggleSection}
              onSetState={setSectionState}
              onMove={moveSection}
              allowDefer={false}
              allowArchive={false}
              allowMove={false}
            />
          </div>
          <SectionLabel>How did it feel · what moved forward</SectionLabel>
          {readyToWrap && (
            <div className="mb-4">
              <CoachNote>
                You cleared the working parts of the day. Want to wrap it up now, or keep going and add a couple more things?
              </CoachNote>
            </div>
          )}
          <Field label="How did today feel?" value={data.howItFelt} onChange={update("howItFelt")} placeholder="A few words, or a few paragraphs..." multiline rows={3} />
          <Field label="Did you move something important forward?" value={data.movedForward} onChange={update("movedForward")} placeholder="Even a small step counts..." multiline rows={3} />
          {readyToWrap && (
            <div className="mb-4 flex flex-wrap gap-2">
              <GhostButton onClick={() => scrollToSection("sec-shotlist")}>Keep working</GhostButton>
              <GhostButton onClick={() => shotInputRef.current?.focus()}>Add another task</GhostButton>
            </div>
          )}
          {(data.howItFelt || data.movedForward) && !data.done["reflection"] && (
            <div className="mt-5">
              <button
                onClick={finishDay}
                className="w-full rounded-2xl px-6 py-4 text-base font-bold text-white shadow-lg transition-all hover:scale-[1.02] active:scale-[0.98]"
                style={{ background: "linear-gradient(135deg, #f59e0b 0%, #ec4899 40%, #8b5cf6 100%)" }}
              >
                Finish the Day ✨
              </button>
            </div>
          )}
        </Card>}

        {/* Footer */}
        <div className="flex items-center justify-between text-sm text-stone-400">
          <span className={`transition-opacity duration-500 ${saved ? "opacity-100" : "opacity-0"}`}>Saved</span>
        </div>

      </div>
      </div>

      {/* End of Day overlay */}
      {showEodCelebration && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 py-12 overflow-y-auto"
          style={{ background: "#f7efe2" }}>
          <div className="w-full max-w-2xl text-center text-stone-900">
            <p className="text-5xl mb-6">🎉</p>
            <h1 className="text-4xl font-black mb-3" style={{ fontFamily: "var(--font-playfair)" }}>
              {eodSummary.headline}
            </h1>
            <p className="text-lg mb-2">{eodSummary.scoreLine}</p>
            <p className="text-stone-600 text-base mb-10">{eodSummary.vibeLine}</p>

            {data.tomorrowBriefing && (
              <div className="rounded-3xl border border-stone-300 bg-[#fffaf1] p-6 text-left space-y-5 mb-8 shadow-[0_20px_60px_rgba(0,0,0,0.08)]">
                <div className="grid gap-3 sm:grid-cols-3">
                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-400">Done</p>
                    <p className="mt-1 text-2xl font-black text-stone-900">{data.tomorrowBriefing.completed.length}</p>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-400">Still Open</p>
                    <p className="mt-1 text-2xl font-black text-stone-900">{data.tomorrowBriefing.open.length}</p>
                  </div>
                  <div className="rounded-2xl border border-stone-200 bg-white px-4 py-3">
                    <p className="text-[11px] font-semibold uppercase tracking-widest text-stone-400">Handled</p>
                    <p className="mt-1 text-2xl font-black text-stone-900">{eodSummary.totalHandled}</p>
                  </div>
                </div>

                {eodSummary.completedPreview.preview.length > 0 && (
                  <div>
                    <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-stone-500">What you actually got done</p>
                    <div className="space-y-2">
                      {eodSummary.completedPreview.preview.map((item, i) => (
                        <div key={i} className="flex items-start gap-2 rounded-xl bg-white px-3 py-2 text-sm text-stone-700">
                          <span className="mt-0.5 text-emerald-600">✓</span>
                          <span>{item}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {!isWeekendMode && eodSummary.openPreview.summary && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-stone-500">Carried forward</p>
                    <p className="text-sm text-stone-700">{eodSummary.openPreview.summary}</p>
                  </div>
                )}

                {!isWeekendMode && eodSummary.laterPreview.summary && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-stone-500">Pushed later</p>
                    <p className="text-sm text-stone-700">{eodSummary.laterPreview.summary}</p>
                  </div>
                )}

                {data.tomorrowBriefing.movedForward && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-stone-500">Moved forward</p>
                    <p className="text-sm italic text-stone-700">&ldquo;{data.tomorrowBriefing.movedForward}&rdquo;</p>
                  </div>
                )}

                {data.tomorrowBriefing.howItFelt && (
                  <div>
                    <p className="mb-1 text-xs font-semibold uppercase tracking-widest text-stone-500">How it felt</p>
                    <p className="text-sm italic text-stone-700">&ldquo;{data.tomorrowBriefing.howItFelt}&rdquo;</p>
                  </div>
                )}
              </div>
            )}

            <p className="text-stone-500 text-sm">Rest up. Tomorrow gets to start clean.</p>
          </div>
        </div>
      )}

    </main>
  );
}
