import Link from "next/link";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import ClientForm from "@/components/ClientForm";
import { createClient } from "../actions";
import type { Client } from "@prisma/client";

export default async function NewClient({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["ADMIN", "BDM", "PM", "ACCOUNTS"]);
  const sp = await searchParams;
  // "Make client from lead": prefill from the lead.
  const lead = sp.lead ? await prisma.lead.findUnique({ where: { id: sp.lead } }) : null;
  const pre = lead ? ({ name: lead.company ?? lead.leadName ?? "", contactName: lead.leadName, contactRole: lead.role, phone: lead.phone, email: lead.email, address: lead.location, status: lead.stage === "Signed" ? "Active" : "Prospect" } as unknown as Client) : null;
  return (
    <div className="max-w-5xl">
      <PageTitle title="New client" sub={lead ? `From lead: ${lead.leadName ?? ""} · ${lead.company ?? ""}` : undefined}><Link prefetch={false} href="/clients" className="btn-ghost">← Clients</Link></PageTitle>
      <ClientForm client={pre} action={createClient} submit="Add client" leadId={lead?.id} />
    </div>
  );
}
