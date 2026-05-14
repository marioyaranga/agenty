import { redirect } from "next/navigation";

import { InAppNotificationsHost } from "@/components/in-app-notifications-host";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export default async function AppGroupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getUser();

  if (error || !data.user) {
    redirect("/login");
  }

  return (
    <>
      <InAppNotificationsHost userId={data.user.id} />
      {children}
    </>
  );
}
