"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  ClipboardList,
  FileText,
  MessageSquare,
  Settings,
} from "lucide-react";

import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { LogoutButton } from "@/components/logout-button";

const NAV_ITEMS = [
  { href: "/chat", label: "Chat", icon: MessageSquare },
  { href: "/documents", label: "Documentos", icon: FileText },
  { href: "/settings", label: "Configuración", icon: Settings },
] as const;

const AUDIT_ITEM = { href: "/audit", label: "Auditoría", icon: ClipboardList };

export function SidebarLeft({ showAudit }: { showAudit: boolean }) {
  const pathname = usePathname();
  const items = showAudit ? [...NAV_ITEMS, AUDIT_ITEM] : NAV_ITEMS;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <span className="truncate px-2 text-sm font-bold text-sidebar-foreground group-data-[collapsible=icon]:hidden">
          workyAI
        </span>
      </SidebarHeader>

      <SidebarContent>
        <SidebarGroup>
          <SidebarMenu>
            {items.map(({ href, label, icon: Icon }) => (
              <SidebarMenuItem key={href}>
                <SidebarMenuButton
                  render={<Link href={href} />}
                  isActive={
                    pathname === href || pathname.startsWith(href + "/")
                  }
                  tooltip={label}
                >
                  <Icon />
                  <span>{label}</span>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <LogoutButton />
      </SidebarFooter>
    </Sidebar>
  );
}
