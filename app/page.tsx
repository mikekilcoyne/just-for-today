"use client";

import dynamic from "next/dynamic";

const HomeClient = dynamic(() => import("./HomeClient"), {
  ssr: false,
  loading: () => (
    <main className="min-h-screen px-4 py-12 md:py-20">
      <div className="mx-auto max-w-2xl">
        <div className="rounded-2xl border border-stone-200 bg-stone-50 p-8 text-center">
          <p className="text-sm uppercase tracking-[0.2em] text-stone-400">Just for Today</p>
          <p className="mt-3 text-stone-500">Loading your day…</p>
        </div>
      </div>
    </main>
  ),
});

export default function Page() {
  return <HomeClient />;
}
