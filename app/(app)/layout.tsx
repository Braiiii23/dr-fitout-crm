import Nav from "@/components/Nav";
import NavProgress from "@/components/NavProgress";
import TableLabels from "@/components/TableLabels";
import AssistantWidget from "@/components/AssistantWidget";
import ViewOnlyBanner from "@/components/ViewOnlyBanner";
import { getTeamView } from "@/lib/team-view";
import { requireUser } from "@/lib/auth";
export const dynamic = "force-dynamic";
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const user = await requireUser();
  // DR Fitout theme (lavender / purple on dark) for everyone.
  const viewer = user.role === "TEAM";
  // The team login only sees Accounts when the admin has switched it on (Users page).
  const hide = viewer && !(await getTeamView()).accounts ? ["/accounts"] : [];
  return (
    <div data-brand="DR" data-theme="admin" data-viewer={viewer ? "true" : undefined} className="min-h-screen">
      <Nav user={user} hide={hide} />
      <ViewOnlyBanner role={user.role} />
      <NavProgress />
      <main className="app-main mx-auto max-w-[1500px] p-4">{children}</main>
      <TableLabels />
      <AssistantWidget name={user.name} />
    </div>
  );
}
