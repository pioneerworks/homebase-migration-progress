import { redirect } from "next/navigation";

import Dashboard from "./dashboard";
import { getSnapshot } from "@/lib/linear";
import { getSessionUser } from "@/lib/oidc-session";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getSessionUser().catch(() => null);
  if (!user) redirect("/login?callbackUrl=/");

  const snapshot = await getSnapshot();
  return <Dashboard initialSnapshot={snapshot} user={user} />;
}
