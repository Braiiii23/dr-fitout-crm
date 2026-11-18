import { redirect } from "next/navigation";
// Setter statements now live in Accounts (Setter pay).
export default function StatementsMoved() { redirect("/accounts#setter-pay"); }
