# Just for Today

> A daily ritual. Not a productivity app.

Built for people with ADHD who want to stop managing complicated systems and just **do the thing**. You dump your brain, it gives you a plan. You do the plan. You feel like a human being.

---

## What it does

- **Brain Dump** — type everything in your head, hit one button, get a real plan
- **Today's Plan** — top priority, secondary moves, nice-to-haves
- **Schedule** — time-blocked day generated from your brain dump
- **Texts & Emails** — drafts ready to copy-paste or open directly in Hey
- **Shot List** — checkable items with confetti when you finish them
- **Interview Gameplan** — prep questions and printable one-pagers
- **Morning Recap** — short AI-written recap of yesterday to orient your day
- **End of Day Reflection** — close the loop and brief tomorrow-you

All data stays in your browser. No database, no login, no cloud.

---

## Getting Started

### 1. Clone and install

```bash
git clone <your-repo-url>
cd just-for-today
npm install
```

### 2. Set up your API key

```bash
cp .env.local.example .env.local
```

Open `.env.local` and add your [Anthropic API key](https://console.anthropic.com/):

```
ANTHROPIC_API_KEY=sk-ant-...
```

The AI features (plan generation, nudges, email drafts, morning recap) use Claude. Without a key, those features will silently no-op — you can still use the app manually.

### 3. Run it

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

---

## Optional: run locally with Ollama

If you want to run 100% offline without an API key:

1. Install [Ollama](https://ollama.com/) and pull a model: `ollama pull llama3.2`
2. Add to `.env.local`:
   ```
   USE_OLLAMA=true
   OLLAMA_URL=http://localhost:11434
   OLLAMA_MODEL=llama3.2
   ```

---

## Stack

- [Next.js 16](https://nextjs.org/) (App Router)
- [Tailwind CSS v4](https://tailwindcss.com/)
- [Anthropic Claude](https://anthropic.com/) via `@anthropic-ai/sdk`
- `canvas-confetti` for the important stuff

---

## Deploy

Easiest path is [Vercel](https://vercel.com/). Add `ANTHROPIC_API_KEY` as an environment variable in your project settings.

---

Built by [Michael Kilcoyne](https://www.instagram.com/themichaelkilcoyne/) ❤️
