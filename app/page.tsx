import { redirect } from "next/navigation";
import { isAuthed } from "@/lib/session";

/** Root — send authed users to the dashboard, everyone else to login. */
export default async function Home() {
  redirect((await isAuthed()) ? "/dashboard/cockpit" : "/login");
}
