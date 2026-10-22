import { redirect } from "next/navigation";
import { getVerifiedUser } from "@/lib/auth/guards";

export default async function Home() {
  redirect((await getVerifiedUser()) ? "/extractions" : "/login");
}
