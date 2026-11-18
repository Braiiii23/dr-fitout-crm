import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { PageTitle } from "@/components/ui";
import LeaseForm from "@/components/LeaseForm";
import { leaseOptions } from "@/lib/lease-options";
import { createLease } from "../actions";

export default async function NewLease({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["ADMIN", "BDM", "PM", "ACCOUNTS"]);
  const sp = await searchParams;
  const { clients, leads } = await leaseOptions();
  return (
    <div className="max-w-6xl">
      <PageTitle title="New lease"><Link prefetch={false} href="/leases" className="btn-ghost">← Leases</Link></PageTitle>
      <LeaseForm clients={clients} leads={leads} defaults={{ clientId: sp.client, leadId: sp.lead }} action={createLease} submit="Add lease" />
    </div>
  );
}
