import { redirect } from "next/navigation";

/** /dashboard → Cockpit (the default view). */
export default function DashboardIndex() {
  redirect("/dashboard/cockpit");
}
