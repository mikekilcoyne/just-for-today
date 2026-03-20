"use client";

import { useEffect, useState, useCallback, useTransition, useRef } from "react";

const ANTIGRAVITY_URL =
  process.env.NEXT_PUBLIC_ANTIGRAVITY_URL ?? "https://claude.ai/new";

// ─── Types ───────────────────────────────────────────────────────────────────

interface TextDraft   { to: string; draft: string; done?: boolean; }
interface EmailDraft  { to: string; subject: string; draft: string; }
interface ScheduleBlock { time: string; task: string; note: string; }
interface ShotListItem  { text: string; done: boolean; }

interface Interviewee { name: string; questions: string[]; }

interface ComposeEmailDraft { to: string; subject: string; notes: string; draft: string; }
interface PromptBuilder { brief: string; prompt: string; }
interface TomorrowBriefing {
  topPriority: string;
  completed: string[];
  open: string[];
  secondaryMoves: string;
  niceToHaves: string;
  movedForward: string;
  howItFelt: string;
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
  composeEmail: ComposeEmailDraft;
  promptBuilder: PromptBuilder;
  tomorrowBriefing?: TomorrowBriefing;
}

const EMPTY: DayData = {
  brainDump: "", topPriority: "", secondaryMoves: "", niceToHaves: "",
  projectPlan: "", texts: [], emails: [], schedule: [],
  interviewGameplan: "", interviewees: [], shotList: [],
  projectLink: "", howItFelt: "", midDayFeeling: "", movedForward: "",
  done: {},
  composeEmail: { to: "", subject: "", notes: "", draft: "" },
  promptBuilder: { brief: "", prompt: "" },
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
  return <p className="text-xs font-semibold uppercase tracking-widest text-stone-400 mb-3">{children}</p>;
}

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return <div className={`rounded-2xl border border-stone-200 bg-stone-50 p-6 md:p-8 ${className}`}>{children}</div>;
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
        ? <textarea className={base} rows={rows} placeholder={placeholder} value={value} onChange={(e) => onChange(e.target.value)} />
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

function GhostButton({ onClick, children, disabled }: { onClick: () => void; children: React.ReactNode; disabled?: boolean }) {
  return (
    <button onClick={onClick} disabled={disabled}
      className="text-xs text-stone-400 hover:text-stone-700 border border-stone-200 rounded-lg px-3 py-1 transition-colors disabled:opacity-40">
      {children}
    </button>
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

function DoneToggle({ sectionKey, done, onToggle }: { sectionKey: string; done: boolean; onToggle: (k: string) => void }) {
  return (
    <button onClick={() => onToggle(sectionKey)}
      className={`flex items-center gap-1.5 text-xs transition-colors shrink-0 ${done ? "text-stone-400" : "text-stone-300 hover:text-stone-500"}`}>
      <span className={`w-4 h-4 rounded border-2 flex items-center justify-center transition-all ${done ? "bg-stone-400 border-stone-400" : "border-stone-300"}`}>
        {done && <span className="text-white text-[9px] leading-none">✓</span>}
      </span>
      <span>{done ? "Done" : "Mark done"}</span>
    </button>
  );
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
  const [celebration, setCelebration] = useState<null | "text" | "section">(null);
  const [isMidDay, setIsMidDay] = useState(false);
  const [midDayDismissed, setMidDayDismissed] = useState(false);
  const [newShotItem, setNewShotItem] = useState("");
  const shotInputRef = useRef<HTMLInputElement>(null);
  const [nudge, setNudge] = useState("");
  const nudgeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [yesterday, setYesterday] = useState<{ topPriority?: string; movedForward?: string; howItFelt?: string; tomorrowBriefing?: TomorrowBriefing } | null>(null);
  const [yesterdayRecap, setYesterdayRecap] = useState<string | null>(null);
  const [showEodCelebration, setShowEodCelebration] = useState(false);
  const [showBreak, setShowBreak] = useState(false);
  const breakTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const workStart = useRef<number>(Date.now());
  const [emailModal, setEmailModal] = useState<EmailDraft | null>(null);
  const [isGeneratingEmail, setIsGeneratingEmail] = useState(false);
  const [isGeneratingPrompt, setIsGeneratingPrompt] = useState(false);

  useEffect(() => {
    const d = new Date();
    setToday(d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" }));
    const todayKey = `jft-${d.toISOString().slice(0, 10)}`;
    setStorageKey(todayKey);
    const h = d.getHours();
    setIsMidDay(h >= 11 && h < 14);
    // Load yesterday's wins
    const yest = new Date(d); yest.setDate(yest.getDate() - 1);
    const yesterKey = `jft-${yest.toISOString().slice(0, 10)}`;
    try {
      const raw = localStorage.getItem(yesterKey);
      if (raw) {
        const y = JSON.parse(raw);
        if (y.topPriority || y.movedForward || y.howItFelt || y.tomorrowBriefing) {
          const yData = { topPriority: y.topPriority, movedForward: y.movedForward, howItFelt: y.howItFelt, tomorrowBriefing: y.tomorrowBriefing };
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
    if (!storageKey) return;
    const stored = localStorage.getItem(storageKey);
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        // Migrate old flat interviewQuestions to new grouped format
        if (parsed.interviewQuestions?.length && !parsed.interviewees?.length) {
          parsed.interviewees = [{ name: "Questions", questions: parsed.interviewQuestions }];
        }
        delete parsed.interviewQuestions;
        setData({ ...EMPTY, ...parsed });
      } catch {}
    }
  }, [storageKey]);

  // Break reminder — fires after 60min of continuous session time
  useEffect(() => {
    const BREAK_AFTER = 60 * 60 * 1000; // 60 minutes
    workStart.current = Date.now();
    breakTimer.current = setTimeout(() => setShowBreak(true), BREAK_AFTER);
    return () => { if (breakTimer.current) clearTimeout(breakTimer.current); };
  }, []);

  const save = useCallback((updated: DayData) => {
    if (!storageKey) return;
    localStorage.setItem(storageKey, JSON.stringify(updated));
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }, [storageKey]);

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

  const generatePlan = () => {
    setParseError(null);
    startParsing(async () => {
      try {
        const res = await fetch("/api/parse", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            brainDump: data.brainDump,
            currentTime: new Date().toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" }),
          }),
        });
        if (!res.ok) throw new Error("Failed");
        const parsed = await res.json();
        const updated: DayData = {
          ...data,
          topPriority: parsed.topPriority || data.topPriority,
          secondaryMoves: parsed.secondaryMoves || data.secondaryMoves,
          niceToHaves: parsed.niceToHaves || data.niceToHaves,
          projectPlan: parsed.projectPlan || data.projectPlan,
          texts: parsed.texts?.length ? parsed.texts : data.texts,
          emails: parsed.emails?.length ? parsed.emails : data.emails,
          schedule: parsed.schedule?.length ? parsed.schedule : data.schedule,
          interviewGameplan: parsed.interviewGameplan || data.interviewGameplan,
        };
        setData(updated); save(updated);
      } catch { setParseError("Couldn't generate — is Ollama running?"); }
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

  const resetDay = () => {
    if (confirm("Reset everything for today? This can't be undone.")) {
      if (storageKey) localStorage.removeItem(storageKey);
      setData(EMPTY);
    }
  };

  const handleBrainDumpChange = (value: string) => {
    update("brainDump")(value);
    if (nudgeTimer.current) clearTimeout(nudgeTimer.current);
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

  const finishDay = async () => {
    const briefing: TomorrowBriefing = {
      topPriority: data.topPriority,
      completed: data.shotList.filter(s => s.done).map(s => s.text),
      open: data.shotList.filter(s => !s.done).map(s => s.text),
      secondaryMoves: data.secondaryMoves,
      niceToHaves: data.niceToHaves,
      movedForward: data.movedForward,
      howItFelt: data.howItFelt,
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
    const updated = { ...data, done: { ...data.done, [key]: nowDone } };
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

  const hasGeneratedContent =
    data.schedule.length > 0 || data.texts.length > 0 || data.emails.length > 0 || data.projectPlan;

  const projectMeta = data.projectLink ? getProjectMeta(data.projectLink) : null;

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

  return (
    <main className="min-h-screen px-4 py-12 md:py-20">
      <div className="mx-auto max-w-2xl">

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
        {showBreak && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 backdrop-blur-sm">
            <div className="bg-white rounded-3xl shadow-2xl px-10 py-10 max-w-sm mx-4 text-center border border-stone-100">
              <p className="text-4xl mb-4">☕</p>
              <p className="text-xl font-black text-stone-800 mb-2" style={{ fontFamily: "var(--font-playfair)" }}>
                You&apos;ve been working hard.
              </p>
              <p className="text-sm text-stone-500 mb-6 leading-relaxed">
                Time for a break. Step away, breathe, hydrate. You&apos;ll think better for it.
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

        {/* Email detail modal */}
        {emailModal && (
          <EmailModal email={emailModal} onClose={() => setEmailModal(null)} />
        )}

        {/* Header */}
        <div className="mb-10 text-center">
          <h1 className="text-5xl md:text-7xl font-black tracking-tight text-stone-800 leading-none mb-4"
            style={{ fontFamily: "var(--font-playfair)" }}>
            Just for Today
          </h1>
          <p className="text-stone-400 text-sm tracking-wide">{today}</p>
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
          <div className="mt-5 flex items-center justify-center gap-3">
            <button onClick={() => saveDayToGoogleDoc(data, today)}
              className="inline-flex items-center gap-2 rounded-xl border border-stone-200 bg-white px-4 py-2 text-sm text-stone-500 hover:text-stone-800 hover:border-stone-400 transition-all shadow-sm">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6zm-1 1.5L18.5 9H13V3.5zM6 20V4h5v7h7v9H6z"/></svg>
              Save to Google Doc
            </button>
          </div>
        </div>

        {/* Yesterday's wins banner */}
        {yesterday && !data.brainDump && (
          <Card className="mb-6 border-stone-200 bg-gradient-to-br from-stone-50 to-amber-50">
            <p className="text-xs font-semibold uppercase tracking-widest text-amber-600 mb-3">🌅 Yesterday</p>
            {/* AI recap — shown when loaded, fades in */}
            {yesterdayRecap && (
              <p className="text-base text-stone-700 leading-relaxed mb-4" style={{ fontFamily: "var(--font-playfair)" }}>
                {yesterdayRecap}
              </p>
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
          <Card className="mb-6 border-amber-200 bg-amber-50">
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
        {data.midDayFeeling && (
          <Card className={`mb-6 border-amber-100 bg-amber-50 transition-opacity ${data.done["midday"] ? "opacity-50" : ""}`}>
            <div className="flex items-center justify-between mb-2">
              <SectionLabel>Mid-Day Check-In</SectionLabel>
              <DoneToggle sectionKey="midday" done={!!data.done["midday"]} onToggle={toggleSection} />
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
        <Card className={`mb-6 transition-opacity ${data.done["brainDump"] ? "opacity-50" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Brain Dump</SectionLabel>
            {data.brainDump.trim() && (
              <DoneToggle sectionKey="brainDump" done={!!data.done["brainDump"]} onToggle={toggleSection} />
            )}
          </div>
          <textarea
            autoFocus
            className="w-full bg-transparent border-none outline-none resize-none text-stone-700 placeholder-stone-300 text-base leading-relaxed"
            rows={6}
            placeholder="Just start typing. Brain dump. Or, use text to speech."
            value={data.brainDump}
            onChange={(e) => handleBrainDumpChange(e.target.value)}
          />
          {nudge && (
            <p className="mt-2 text-xs text-amber-600 leading-relaxed border-t border-stone-100 pt-2 transition-all">
              {nudge}
            </p>
          )}
          {data.brainDump.trim() && (
            <div className="mt-3 flex items-center justify-between">
              <button onClick={generatePlan} disabled={isParsing}
                className="text-sm text-stone-500 hover:text-stone-800 transition-colors disabled:opacity-40">
                {isParsing ? "Generating plan..." : "Generate plan from this →"}
              </button>
              {parseError && <span className="text-xs text-rose-400">{parseError}</span>}
            </div>
          )}
        </Card>

        {/* Today's Plan */}
        <Card className={`mb-6 transition-opacity ${data.done["plan"] ? "opacity-50" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Today&apos;s Plan</SectionLabel>
            <DoneToggle sectionKey="plan" done={!!data.done["plan"]} onToggle={toggleSection} />
          </div>
          <Field label="Top Priority" value={data.topPriority} onChange={update("topPriority")} placeholder="The one thing that matters most today" />
          <Field label="Secondary Moves" value={data.secondaryMoves} onChange={update("secondaryMoves")} placeholder="Other things you want to get done..." multiline rows={3} />
          <Field label="Nice-to-haves" value={data.niceToHaves} onChange={update("niceToHaves")} placeholder="If there's time and energy..." multiline rows={3} />
        </Card>

        {/* Generated Content */}
        {hasGeneratedContent && (
          <>
            {/* Schedule */}
            {data.schedule.length > 0 && (
              <Card className={`mb-6 transition-opacity ${data.done["schedule"] ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel>What Your Day Should Look Like</SectionLabel>
                  <DoneToggle sectionKey="schedule" done={!!data.done["schedule"]} onToggle={toggleSection} />
                </div>
                <div>
                  {data.schedule.map((block, i) => (
                    <div key={i} className="flex gap-4 py-3 border-b border-stone-100 last:border-0">
                      <span className="text-xs text-stone-400 pt-0.5 shrink-0 w-28 tabular-nums">{block.time}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-stone-700">{block.task}</p>
                        {block.note && <p className="text-xs text-stone-400 mt-1 leading-relaxed">→ {block.note}</p>}
                      </div>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Texts to Send */}
            {data.texts.length > 0 && (
              <Card className={`mb-6 transition-opacity ${data.done["texts"] ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel>Texts to Send</SectionLabel>
                  <DoneToggle sectionKey="texts" done={!!data.done["texts"]} onToggle={toggleSection} />
                </div>
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
                        <div className="ml-auto"><CopyButton text={t.draft} /></div>
                      </div>
                      <p className={`text-sm text-stone-600 leading-relaxed whitespace-pre-wrap pl-8 transition-all duration-300 ${t.done ? "line-through decoration-stone-400" : ""}`}>
                        {t.draft}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Emails to Send */}
            {data.emails.length > 0 && (
              <Card className={`mb-6 transition-opacity ${data.done["emails"] ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between mb-3">
                  <SectionLabel>Emails to Send</SectionLabel>
                  <DoneToggle sectionKey="emails" done={!!data.done["emails"]} onToggle={toggleSection} />
                </div>
                <div className="space-y-4">
                  {data.emails.map((e, i) => (
                    <div key={i}
                      className="rounded-xl border border-stone-200 bg-white p-4 cursor-pointer hover:border-stone-300 hover:shadow-sm transition-all group"
                      onClick={() => setEmailModal(e)}>
                      <div className="flex items-start justify-between mb-2 gap-3">
                        <div>
                          <p className="text-xs font-semibold text-stone-400 uppercase tracking-wide">To: {e.to}</p>
                          <p className="text-sm font-medium text-stone-600 mt-0.5">{e.subject}</p>
                        </div>
                        <span className="text-xs text-stone-300 group-hover:text-stone-500 transition-colors shrink-0 pt-0.5">Open →</span>
                      </div>
                      <p className="text-sm text-stone-400 leading-relaxed line-clamp-2 mt-2 pt-2 border-t border-stone-100">
                        {e.draft}
                      </p>
                    </div>
                  ))}
                </div>
              </Card>
            )}

            {/* Project Plan */}
            {data.projectPlan && (
              <Card className={`mb-6 transition-opacity ${data.done["projectPlan"] ? "opacity-50" : ""}`}>
                <div className="flex items-center justify-between mb-4">
                  <SectionLabel>Project Plan</SectionLabel>
                  <div className="flex items-center gap-2">
                    <DoneToggle sectionKey="projectPlan" done={!!data.done["projectPlan"]} onToggle={toggleSection} />
                    <CopyButton text={data.projectPlan} label="Copy" />
                  </div>
                </div>
                <div>{renderBullets(data.projectPlan)}</div>
              </Card>
            )}
          </>
        )}

        {/* Shot List */}
        <Card className={`mb-6 transition-opacity ${data.done["shotList"] ? "opacity-50" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Shot List</SectionLabel>
            <div className="flex items-center gap-2">
              <DoneToggle sectionKey="shotList" done={!!data.done["shotList"]} onToggle={toggleSection} />
              {data.shotList.length > 0 && (
                <GhostButton onClick={() => printList("Shot List", data.shotList.map(s => s.text))}>
                  🖨 Print
                </GhostButton>
              )}
            </div>
          </div>
          <div className="space-y-2 mb-3">
            {data.shotList.map((item, i) => (
              <div key={i} className={`flex items-center gap-3 group rounded-xl px-3 py-2 transition-all ${item.done ? "opacity-50" : "hover:bg-stone-100"}`}>
                <button onClick={() => toggleShotDone(i)}
                  className={`w-5 h-5 rounded-full border-2 shrink-0 flex items-center justify-center transition-all ${item.done ? "bg-stone-400 border-stone-400" : "border-stone-300 hover:border-stone-600"}`}>
                  {item.done && <span className="text-white text-xs">✓</span>}
                </button>
                <span className={`text-sm text-stone-700 flex-1 ${item.done ? "line-through decoration-stone-400" : ""}`}>{item.text}</span>
                <button onClick={() => removeShotItem(i)} className="text-stone-300 hover:text-rose-400 opacity-0 group-hover:opacity-100 transition-all text-xs">✕</button>
              </div>
            ))}
          </div>
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
        </Card>

        {/* Interview Gameplan */}
        <Card className={`mb-6 transition-opacity ${data.done["interviews"] ? "opacity-50" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-3">
              <SectionLabel>Gameplan for Interviews</SectionLabel>
              <DoneToggle sectionKey="interviews" done={!!data.done["interviews"]} onToggle={toggleSection} />
            </div>
            <div className="flex gap-2">
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
            onChange={(e) => update("interviewGameplan")(e.target.value)}
          />
        </Card>

        {/* Project Links */}
        <Card className="mb-6">
          <SectionLabel>Project Links</SectionLabel>
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
        </Card>

        {/* Quick Email Composer */}
        <Card className={`mb-6 transition-opacity ${data.done["composeEmail"] ? "opacity-50" : ""}`}>
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>Quick Email</SectionLabel>
            {(data.composeEmail.draft || data.composeEmail.notes) && (
              <DoneToggle sectionKey="composeEmail" done={!!data.done["composeEmail"]} onToggle={toggleSection} />
            )}
          </div>
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
              onChange={(e) => updateCompose("notes")(e.target.value)}
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
                onChange={(e) => updateCompose("draft")(e.target.value)}
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
        </Card>

        {/* Prompt Builder */}
        {(data.done["composeEmail"] || data.promptBuilder.brief) && (
          <Card className={`mb-6 transition-opacity ${data.done["promptBuilder"] ? "opacity-50" : ""}`}>
            <div className="flex items-center justify-between mb-3">
              <div>
                <SectionLabel>Build a Prompt</SectionLabel>
                {data.done["composeEmail"] && !data.promptBuilder.brief && (
                  <p className="text-xs text-amber-500 -mt-2 mb-1">Next up 👇</p>
                )}
              </div>
              {(data.promptBuilder.prompt || data.promptBuilder.brief) && (
                <DoneToggle sectionKey="promptBuilder" done={!!data.done["promptBuilder"]} onToggle={toggleSection} />
              )}
            </div>
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
                }}
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
                  }}
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
          </Card>
        )}

        {/* Reflection */}
        <Card className="mb-8">
          <div className="flex items-center justify-between mb-3">
            <SectionLabel>End of Day Reflection</SectionLabel>
          </div>
          <Field label="How did today feel?" value={data.howItFelt} onChange={update("howItFelt")} placeholder="A few words, or a few paragraphs..." multiline rows={3} />
          <Field label="Did you move something important forward?" value={data.movedForward} onChange={update("movedForward")} placeholder="Even a small step counts..." multiline rows={3} />
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
        </Card>

        {/* Footer */}
        <div className="flex items-center justify-between text-sm text-stone-400">
          <span className={`transition-opacity duration-500 ${saved ? "opacity-100" : "opacity-0"}`}>Saved</span>
          <button onClick={() => setShowBreak(true)} className="text-stone-300 hover:text-stone-500 transition-colors text-xs">☕ Test break</button>
        </div>

      </div>

      {/* End of Day overlay */}
      {showEodCelebration && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center px-6 py-12 overflow-y-auto"
          style={{ background: "linear-gradient(135deg, #1c1917 0%, #292524 50%, #1c1917 100%)" }}>
          <div className="w-full max-w-lg text-center">
            <p className="text-5xl mb-6">🎉</p>
            <h1 className="text-4xl font-black text-white mb-3" style={{ fontFamily: "var(--font-playfair)" }}>
              Woot! You won the day!
            </h1>
            <p className="text-stone-400 text-lg mb-10">That&rsquo;s all for today. See you in the AM.</p>

            {/* Tomorrow's briefing */}
            {data.tomorrowBriefing && (
              <div className="rounded-2xl border border-stone-700 bg-stone-800/60 p-6 text-left space-y-4 mb-8">
                <p className="text-xs font-semibold uppercase tracking-widest text-amber-400">Your briefing for tomorrow</p>

                {data.tomorrowBriefing.topPriority && (
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Top priority</p>
                    <p className="text-sm text-stone-200">{data.tomorrowBriefing.topPriority}</p>
                  </div>
                )}

                {data.tomorrowBriefing.completed.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Completed today</p>
                    <ul className="space-y-1">
                      {data.tomorrowBriefing.completed.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-stone-300">
                          <span className="text-emerald-400 mt-0.5">✓</span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.tomorrowBriefing.open.length > 0 && (
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Still open</p>
                    <ul className="space-y-1">
                      {data.tomorrowBriefing.open.map((item, i) => (
                        <li key={i} className="flex items-start gap-2 text-sm text-stone-300">
                          <span className="text-amber-400 mt-0.5">→</span>{item}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                {data.tomorrowBriefing.secondaryMoves && (
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Secondary moves</p>
                    <p className="text-sm text-stone-300">{data.tomorrowBriefing.secondaryMoves}</p>
                  </div>
                )}

                {data.tomorrowBriefing.movedForward && (
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">Moved forward on</p>
                    <p className="text-sm text-stone-300 italic">&ldquo;{data.tomorrowBriefing.movedForward}&rdquo;</p>
                  </div>
                )}

                {data.tomorrowBriefing.howItFelt && (
                  <div>
                    <p className="text-xs text-stone-500 uppercase tracking-wide mb-1">How it felt</p>
                    <p className="text-sm text-stone-300 italic">&ldquo;{data.tomorrowBriefing.howItFelt}&rdquo;</p>
                  </div>
                )}
              </div>
            )}

            <p className="text-stone-600 text-sm">Rest up. Tomorrow is a new day.</p>
          </div>
        </div>
      )}

    </main>
  );
}
