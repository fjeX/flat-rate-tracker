import Link from "next/link";

export function ComingSoon({ title }: { title: string }) {
  return (
    <main className="mx-auto max-w-3xl p-8 text-center">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-zinc-400">
        This screen is coming in a later build step.
      </p>
      <Link
        href="/dashboard"
        className="mt-6 inline-block text-sm text-orange-400 hover:text-orange-300"
      >
        ← Back to Dashboard
      </Link>
    </main>
  );
}
