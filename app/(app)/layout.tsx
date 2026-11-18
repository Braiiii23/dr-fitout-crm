import Nav from "@/components/Nav";
import NavProgress from "@/components/NavProgress";
import TableLabels from "@/components/TableLabels";
import AssistantWidget from "@/components/AssistantWidget";
import ViewOnlyBanner from "@/components/ViewOnlyBanner";
import { getTeamView } from "@/lib/team-view";
import { requireUser } from "@/lib/auth";
import { getBrand } from "@/lib/brand";
export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  const brand = await getBrand();
  // Jessie (SETTER) keeps light company theme; Braiden (ADMIN) gets polished dark chrome.
  const theme = user.role === "SETTER" ? "setter" : user.role === "ADMIN" ? "admin" : undefined;
  const viewer = user.role === "TEAM";
  const teamView = viewer ? await getTeamView() : undefined;
  return (
    <div data-brand={brand === "DR" ? "DR" : "ENP"} data-theme={theme} data-viewer={viewer ? "true" : undefined} className="min-h-screen">
      <Nav user={user} brand={brand} teamView={teamView} />
      <ViewOnlyBanner role={user.role} />
      <NavProgress />
      <main className="app-main mx-auto max-w-[1500px] p-4">{children}</main>
      <TableLabels />
      <AssistantWidget name={user.name} />
    </div>
  );
}
