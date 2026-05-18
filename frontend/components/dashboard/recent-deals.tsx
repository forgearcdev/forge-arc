"use client";

import { cn } from "@/lib/utils";
import { ArrowUpRight, CheckCircle2, Clock, XCircle, Wallet } from "lucide-react";

const jobs = [
  {
    task: "Code review",
    agent: "summarizer-v2",
    value: "45",
    status: "completed",
    date: "2 hours ago",
  },
  {
    task: "Data analysis",
    agent: "copywriter-gpt",
    value: "120",
    status: "submitted",
    date: "5 hours ago",
  },
  {
    task: "Translation",
    agent: "translator-ml",
    value: "200",
    status: "funded",
    date: "1 day ago",
  },
  {
    task: "Smart contract audit",
    agent: "auditor-sec",
    value: "500",
    status: "expired",
    date: "2 days ago",
  },
  {
    task: "Social media copy",
    agent: "copywriter-gpt",
    value: "120",
    status: "completed",
    date: "3 days ago",
  },
];

const statusConfig = {
  completed: {
    icon: CheckCircle2,
    color: "text-success",
    bg: "bg-success/10",
    label: "Completed",
  },
  submitted: {
    icon: Clock,
    color: "text-accent",
    bg: "bg-accent/10",
    label: "Submitted",
  },
  funded: {
    icon: Wallet,
    color: "text-muted-foreground",
    bg: "bg-secondary",
    label: "Funded",
  },
  expired: {
    icon: XCircle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    label: "Expired",
  },
};

export function RecentDeals() {
  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Recent Jobs</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Latest activity</p>
        </div>
        <button className="flex items-center gap-1 text-sm text-accent hover:text-accent/80 font-medium transition-colors group">
          View all
          <ArrowUpRight className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
        </button>
      </div>

      <div className="space-y-3">
        {jobs.map((job, index) => {
          const status = statusConfig[job.status as keyof typeof statusConfig];
          const StatusIcon = status.icon;

          return (
            <div
              key={`${job.task}-${index}`}
              className="group flex items-center justify-between p-3 rounded-lg hover:bg-secondary/50 transition-all duration-200 cursor-pointer animate-in fade-in slide-in-from-left-2"
              style={{ animationDelay: `${(index + 3) * 100}ms`, animationFillMode: "both" }}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-secondary flex items-center justify-center text-sm font-semibold text-muted-foreground group-hover:bg-accent/10 group-hover:text-accent transition-all duration-200 font-mono">
                  {job.agent.slice(0, 2).toUpperCase()}
                </div>
                <div>
                  <p className="text-sm font-medium text-foreground">{job.task}</p>
                  <p className="text-xs text-muted-foreground font-mono">{job.agent} <span className="font-sans">•</span> {job.date}</p>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold font-mono text-foreground">{job.value} <span className="text-xs text-muted-foreground">USDC</span></span>
                <div className={cn("flex items-center gap-1 px-2 py-1 rounded-md text-xs font-medium", status.bg, status.color)}>
                  <StatusIcon className="w-3 h-3" />
                  {status.label}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
