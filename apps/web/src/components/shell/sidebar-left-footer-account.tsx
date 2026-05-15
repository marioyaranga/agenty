"use client";

/**
 * Pie del sidebar (patrón tipo shadcn sidebar-07): un único disparador con menú
 * que agrupa usuario, espacio de trabajo, configuración, auditoría y cierre de sesión.
 */
import { useRouter } from "next/navigation";
import {
  ChevronsUpDown,
  ClipboardList,
  LogOut,
  Settings,
} from "lucide-react";

import { signOutAndRedirect } from "@/components/logout-button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { useWorkspace } from "@/lib/contexts/workspace-context";

function initialsFromEmail(email: string) {
  const local = email.split("@")[0]?.trim() ?? "";
  if (!local) return "?";
  const parts = local.split(/[.\-_]/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]![0]! + parts[1]![0]!).toUpperCase();
  }
  return local.slice(0, 2).toUpperCase();
}

type SidebarLeftFooterAccountProps = {
  userEmail: string;
  showAudit: boolean;
};

export function SidebarLeftFooterAccount({
  userEmail,
  showAudit,
}: SidebarLeftFooterAccountProps) {
  const router = useRouter();
  const { tenants, activeTenantId, setActiveTenantId } = useWorkspace();

  const activeTenant = tenants.find((t) => t.tenantId === activeTenantId);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger
            nativeButton={false}
            render={
              <SidebarMenuButton
                size="lg"
                tooltip={{
                  children: activeTenant?.name ?? "Cuenta",
                }}
                className="data-open:bg-sidebar-accent data-open:text-sidebar-accent-foreground"
              >
                <Avatar size="sm" className="rounded-lg">
                  <AvatarFallback className="rounded-lg text-xs">
                    {initialsFromEmail(userEmail)}
                  </AvatarFallback>
                </Avatar>
                <div className="grid flex-1 min-w-0 text-left text-sm leading-tight">
                  <span className="truncate font-medium">
                    {activeTenant?.name ?? "Sin espacio"}
                  </span>
                  <span className="truncate text-xs text-muted-foreground">
                    {userEmail}
                  </span>
                </div>
                <ChevronsUpDown className="ml-auto shrink-0" />
              </SidebarMenuButton>
            }
          />
          <DropdownMenuContent
            className="min-w-56"
            side="top"
            align="start"
            sideOffset={8}
          >
            <div className="px-2 py-1.5">
              <p className="text-sm font-medium leading-none truncate">
                {userEmail}
              </p>
              <p className="text-xs text-muted-foreground mt-0.5">Usuario</p>
            </div>
            <DropdownMenuSeparator />

            {tenants.length > 0 ? (
              <>
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Espacio de trabajo
                </DropdownMenuLabel>
                <DropdownMenuRadioGroup
                  value={activeTenantId ?? ""}
                  onValueChange={(id) => {
                    if (id) setActiveTenantId(id);
                  }}
                >
                  {tenants.map((t) => (
                    <DropdownMenuRadioItem
                      key={t.tenantId}
                      value={t.tenantId}
                      className="flex-col items-stretch gap-0.5"
                    >
                      <span className="w-full truncate">{t.name}</span>
                      <span className="w-full text-xs font-normal text-muted-foreground capitalize">
                        {t.role}
                      </span>
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
                <DropdownMenuSeparator />
              </>
            ) : null}

            <DropdownMenuItem onClick={() => router.push("/settings")}>
              <Settings />
              Configuración
            </DropdownMenuItem>
            {showAudit ? (
              <DropdownMenuItem onClick={() => router.push("/audit")}>
                <ClipboardList />
                Auditoría
              </DropdownMenuItem>
            ) : null}
            <DropdownMenuSeparator />
            <DropdownMenuItem
              variant="destructive"
              onClick={() => void signOutAndRedirect(router)}
            >
              <LogOut />
              Cerrar sesión
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
