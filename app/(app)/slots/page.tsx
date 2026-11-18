import { redirect } from "next/navigation";
// Free slots are now worked out from Braiden's calendar. Availability settings live on the Calendar page.
export default function SlotsMoved() { redirect("/calendar#availability"); }
