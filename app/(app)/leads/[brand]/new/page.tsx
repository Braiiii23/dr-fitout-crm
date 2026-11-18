import { notFound } from "next/navigation";
import { prisma } from "@/lib/db";
import { requireUser } from "@/lib/auth";
import { BRANDS, brandFromSlug } from "@/lib/constants";
import { PageTitle } from "@/components/ui";
import LeadForm from "@/components/LeadForm";
import { saveLead } from "../../actions";
export default async function NewLead({ params }: { params: Promise<{ brand: string }> }) {
  await requireUser(["ADMIN", "BDM"]);
  const brand = brandFromSlug((await params).brand); if (!brand) notFound();
  const setters = await prisma.setter.findMany({ orderBy: { name: "asc" } });
  return (<div className="max-w-5xl"><PageTitle title={`New ${BRANDS[brand].name} lead`} /><LeadForm brand={brand} setters={setters} action={saveLead} /></div>);
}
