import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { Flash, PageTitle } from "@/components/ui";
import ConceptForm from "@/components/ConceptForm";
import { createConcept } from "../actions";

export default async function NewConcept({ searchParams }: { searchParams: Promise<Record<string, string>> }) {
  await requireUser(["ADMIN", "BDM", "PM", "ESTIMATOR"]);
  const sp = await searchParams;
  return (
    <div className="max-w-6xl">
      <PageTitle title="New concept"><Link prefetch={false} href="/concepts" className="btn-ghost">← Concepts</Link></PageTitle>
      <Flash msg={sp.err} kind="err" />
      <ConceptForm action={createConcept} submit="Save concept" />
    </div>
  );
}
