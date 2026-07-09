import { notFound } from "next/navigation";
import { type Dir, type PageKey, type Theme, PvChrome } from "../../components";
import { DashboardBody, HistoryBody, LogBody } from "../../bodies";

const DIRS: Dir[] = ["a", "b", "c"];
const PAGES: PageKey[] = ["dashboard", "log", "history"];

export function generateStaticParams() {
  return DIRS.flatMap((dir) => PAGES.map((page) => ({ dir, page })));
}

export default async function PreviewPage({
  params,
  searchParams,
}: {
  params: Promise<{ dir: string; page: string }>;
  searchParams: Promise<{ theme?: string; chrome?: string }>;
}) {
  const { dir, page } = await params;
  const sp = await searchParams;
  if (!DIRS.includes(dir as Dir) || !PAGES.includes(page as PageKey)) notFound();

  const theme: Theme = sp.theme === "light" ? "light" : "dark";
  const chrome = sp.chrome !== "0";
  const d = dir as Dir;
  const p = page as PageKey;

  return (
    <PvChrome dir={d} page={p} theme={theme} chrome={chrome}>
      {p === "dashboard" && <DashboardBody dir={d} />}
      {p === "log" && <LogBody dir={d} />}
      {p === "history" && <HistoryBody dir={d} />}
    </PvChrome>
  );
}
