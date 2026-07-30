import Dashboard from "./dashboard";
import { getSnapshot } from "@/lib/linear";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getSnapshot();
  return <Dashboard initialSnapshot={snapshot} />;
}
