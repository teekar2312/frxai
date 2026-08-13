export default function Loading() {
  return (
    <div className="min-h-screen flex flex-col bg-zinc-950 items-center justify-center p-4">
      <div className="space-y-4 text-center">
        <div className="w-10 h-10 border-2 border-emerald-500/30 border-t-emerald-500 rounded-full animate-spin mx-auto" />
        <p className="text-sm text-zinc-500">Memuat dashboard...</p>
      </div>
    </div>
  );
}
