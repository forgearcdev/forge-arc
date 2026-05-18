"use client";

import { useState, useEffect } from "react";
import { cn } from "@/lib/utils";
import { Briefcase, Coins, TrendingUp, Clock, CheckCircle2, XCircle, Wallet, ExternalLink } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

interface Activity {
  id: string;
  type: "job_posted" | "job_completed" | "payment_received" | "job_expired";
  title: string;
  agent?: string;
  amount: number;
  timestamp: string;
  txHash?: string;
}

const activities: Activity[] = [
  { id: "1", type: "payment_received", title: "Payment received for Code review", agent: "summarizer-v2", amount: 45, timestamp: "2 hours ago", txHash: "0x8f2a...3b4c" },
  { id: "2", type: "job_completed", title: "Job completed: Data analysis", agent: "copywriter-gpt", amount: 120, timestamp: "5 hours ago", txHash: "0x7e1b...2a3d" },
  { id: "3", type: "job_posted", title: "Posted job: Translation EN-FR", amount: 200, timestamp: "1 day ago" },
  { id: "4", type: "job_expired", title: "Job expired: Smart contract audit", amount: 500, timestamp: "2 days ago" },
  { id: "5", type: "payment_received", title: "Payment received for Social media copy", agent: "copywriter-gpt", amount: 120, timestamp: "3 days ago", txHash: "0x6d0c...1e2f" },
  { id: "6", type: "job_completed", title: "Job completed: Bug triage", agent: "debugger-x", amount: 78, timestamp: "4 days ago", txHash: "0x5c9d...0f1e" },
];

const weeklyData = [
  { day: "Mon", spent: 245, earned: 120 },
  { day: "Tue", spent: 0, earned: 78 },
  { day: "Wed", spent: 500, earned: 200 },
  { day: "Thu", spent: 120, earned: 0 },
  { day: "Fri", spent: 0, earned: 45 },
  { day: "Sat", spent: 200, earned: 0 },
  { day: "Sun", spent: 0, earned: 120 },
];

const activityConfig = {
  job_posted: {
    icon: Briefcase,
    color: "text-accent",
    bg: "bg-accent/10",
    label: "Posted",
  },
  job_completed: {
    icon: CheckCircle2,
    color: "text-success",
    bg: "bg-success/10",
    label: "Completed",
  },
  payment_received: {
    icon: Wallet,
    color: "text-success",
    bg: "bg-success/10",
    label: "Received",
  },
  job_expired: {
    icon: XCircle,
    color: "text-destructive",
    bg: "bg-destructive/10",
    label: "Expired",
  },
};

export function TeamSection() {
  const [chartLoaded, setChartLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setChartLoaded(true), 400);
    return () => clearTimeout(timer);
  }, []);

  const totalSpent = weeklyData.reduce((acc, d) => acc + d.spent, 0);
  const totalEarned = weeklyData.reduce((acc, d) => acc + d.earned, 0);

  return (
    <div className="space-y-6">
      {/* Header stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-accent/10 flex items-center justify-center">
              <Coins className="w-5 h-5 text-accent" />
            </div>
            <span className="text-sm text-muted-foreground">USDC Spent (7d)</span>
          </div>
          <p className="text-2xl font-bold font-mono text-foreground">{totalSpent.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">USDC</span></p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-success/10 flex items-center justify-center">
              <TrendingUp className="w-5 h-5 text-success" />
            </div>
            <span className="text-sm text-muted-foreground">USDC Earned (7d)</span>
          </div>
          <p className="text-2xl font-bold font-mono text-foreground">{totalEarned.toLocaleString()} <span className="text-sm font-normal text-muted-foreground">USDC</span></p>
        </div>
        <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-chart-1/10 flex items-center justify-center">
              <Briefcase className="w-5 h-5 text-chart-1" />
            </div>
            <span className="text-sm text-muted-foreground">Jobs This Week</span>
          </div>
          <p className="text-2xl font-bold text-foreground">{activities.length}</p>
        </div>
      </div>

      {/* Weekly chart */}
      <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-150">
        <div className="flex items-center justify-between mb-6">
          <div>
            <h3 className="text-base font-semibold text-foreground">Weekly Activity</h3>
            <p className="text-sm text-muted-foreground mt-0.5">USDC spent vs earned</p>
          </div>
          <div className="flex items-center gap-4 text-xs">
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-chart-1" />
              <span className="text-muted-foreground">Spent</span>
            </div>
            <div className="flex items-center gap-1.5">
              <div className="w-2.5 h-2.5 rounded-full bg-success" />
              <span className="text-muted-foreground">Earned</span>
            </div>
          </div>
        </div>
        <div className={`h-[250px] transition-opacity duration-700 ${chartLoaded ? 'opacity-100' : 'opacity-0'}`}>
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={weeklyData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="oklch(0.20 0.02 250)" vertical={false} />
              <XAxis
                dataKey="day"
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(0.60 0.02 250)", fontSize: 12 }}
                dy={10}
              />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "oklch(0.60 0.02 250)", fontSize: 12, fontFamily: "JetBrains Mono, monospace" }}
                tickFormatter={(value) => `${value}`}
                dx={-10}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: "oklch(0.11 0.02 250)",
                  border: "1px solid oklch(0.20 0.02 250)",
                  borderRadius: "8px",
                  fontSize: "12px",
                  fontFamily: "JetBrains Mono, monospace",
                }}
                labelStyle={{ color: "oklch(0.95 0 0)", fontWeight: 600 }}
                itemStyle={{ color: "oklch(0.60 0.02 250)" }}
                formatter={(value: number) => [`${value} USDC`, ""]}
              />
              <Bar dataKey="spent" fill="#5b9dff" radius={[4, 4, 0, 0]} />
              <Bar dataKey="earned" fill="oklch(0.65 0.18 145)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Recent activity */}
      <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-200">
        <h3 className="text-base font-semibold text-foreground mb-4">Recent Activity</h3>
        <div className="space-y-3">
          {activities.map((activity, index) => {
            const config = activityConfig[activity.type];
            const Icon = config.icon;

            return (
              <div
                key={activity.id}
                className="group flex items-center justify-between p-3 rounded-lg hover:bg-secondary/50 transition-all duration-200 animate-in fade-in slide-in-from-left-2"
                style={{ animationDelay: `${(index + 3) * 100}ms`, animationFillMode: "both" }}
              >
                <div className="flex items-center gap-3">
                  <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", config.bg)}>
                    <Icon className={cn("w-5 h-5", config.color)} />
                  </div>
                  <div>
                    <p className="text-sm font-medium text-foreground">{activity.title}</p>
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      {activity.agent && <span className="font-mono">{activity.agent}</span>}
                      {activity.agent && <span>•</span>}
                      <Clock className="w-3 h-3" />
                      {activity.timestamp}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <span className={cn(
                    "text-sm font-semibold font-mono",
                    activity.type === "payment_received" || activity.type === "job_completed" ? "text-success" : 
                    activity.type === "job_expired" ? "text-destructive" : "text-foreground"
                  )}>
                    {activity.type === "payment_received" || activity.type === "job_completed" ? "+" : 
                     activity.type === "job_posted" ? "-" : ""}{activity.amount} <span className="text-xs text-muted-foreground">USDC</span>
                  </span>
                  {activity.txHash && (
                    <button className="flex items-center gap-1 text-xs font-mono text-muted-foreground hover:text-accent transition-colors">
                      <ExternalLink className="w-3 h-3" />
                      {activity.txHash}
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
