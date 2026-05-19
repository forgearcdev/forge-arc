"use client";

import React from "react";
import Link from "next/link";

import { cn } from "@/lib/utils";
import type { Section } from "@/app/app/page";
import {
  LayoutDashboard,
  Briefcase,
  Bot,
  Activity,
  ChevronLeft,
  ChevronRight,
  Settings,
} from "lucide-react";

interface SidebarProps {
  activeSection: Section;
  onSectionChange: (section: Section) => void;
  collapsed: boolean;
  onCollapsedChange: (collapsed: boolean) => void;
}

const navItems: { id: Section; label: string; icon: React.ElementType }[] = [
  { id: "overview", label: "Overview", icon: LayoutDashboard },
  { id: "pipeline", label: "Jobs", icon: Briefcase },
  { id: "customers", label: "Agents", icon: Bot },
  { id: "team", label: "My Activity", icon: Activity },
  { id: "settings", label: "Settings", icon: Settings },
];

// Forge logo - stylized F with glowing dots
function ForgeLogo() {
  return (
    <svg
      width="24"
      height="24"
      viewBox="0 0 24 24"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className="shrink-0"
    >
      {/* Main F shape */}
      <path
        d="M6 4h12v3H9v4h7v3H9v6H6V4z"
        fill="currentColor"
        className="text-accent"
      />
      {/* Glowing dots at endpoints */}
      <circle cx="18" cy="5.5" r="2" fill="#5b9dff" className="animate-pulse" />
      <circle cx="16" cy="12.5" r="1.5" fill="#5b9dff" opacity="0.8" />
      <circle cx="6" cy="20" r="1.5" fill="#5b9dff" opacity="0.6" />
    </svg>
  );
}

export function Sidebar({
  activeSection,
  onSectionChange,
  collapsed,
  onCollapsedChange,
}: SidebarProps) {
  return (
    <aside
      className={cn(
        "fixed left-0 top-0 z-40 h-screen bg-sidebar border-r border-sidebar-border transition-all duration-300 ease-out flex flex-col",
        collapsed ? "w-[72px]" : "w-[260px]"
      )}
    >
      {/* Logo — clicking returns to the public landing page at `/`. The
       *  sidebar nav items below remain as state-toggle buttons (they swap
       *  the active dashboard section, NOT the URL — single-page dashboard
       *  at /app holds its current state via useState in app/app/page.tsx). */}
      <div className="h-16 flex items-center px-4 border-b border-sidebar-border">
        <Link
          href="/"
          aria-label="Back to forge landing page"
          className="flex items-center gap-3 rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-accent transition-opacity hover:opacity-80"
        >
          <div className="w-9 h-9 rounded-lg flex items-center justify-center shrink-0 bg-accent/10">
            <ForgeLogo />
          </div>
          <span
            className={cn(
              "font-semibold text-lg text-sidebar-foreground whitespace-nowrap transition-all duration-300",
              collapsed ? "opacity-0 w-0" : "opacity-100 w-auto"
            )}
          >
            forge
          </span>
        </Link>
      </div>

      {/* Navigation */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-hidden">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = activeSection === item.id;

          return (
            <button
              key={item.id}
              onClick={() => onSectionChange(item.id)}
              className={cn(
                "w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-200 group relative",
                isActive
                  ? "bg-sidebar-accent text-sidebar-foreground"
                  : "text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50"
              )}
            >
              {/* Active indicator */}
              <span
                className={cn(
                  "absolute left-0 top-1/2 -translate-y-1/2 w-1 h-6 rounded-r-full bg-accent transition-all duration-300",
                  isActive ? "opacity-100" : "opacity-0"
                )}
              />
              <Icon
                className={cn(
                  "w-5 h-5 shrink-0 transition-transform duration-200",
                  isActive ? "text-accent" : "group-hover:scale-110"
                )}
              />
              <span
                className={cn(
                  "whitespace-nowrap transition-all duration-300",
                  collapsed ? "opacity-0 w-0 overflow-hidden" : "opacity-100"
                )}
              >
                {item.label}
              </span>
            </button>
          );
        })}
      </nav>

      {/* Collapse button */}
      <div className="p-3 border-t border-sidebar-border">
        <button
          onClick={() => onCollapsedChange(!collapsed)}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all duration-200"
        >
          {collapsed ? (
            <ChevronRight className="w-5 h-5" />
          ) : (
            <>
              <ChevronLeft className="w-5 h-5" />
              <span>Collapse</span>
            </>
          )}
        </button>
      </div>
    </aside>
  );
}
