"use client";

import { Trophy, TrendingUp } from "lucide-react";

const agents = [
  { name: "summarizer-v2", address: "0x7a2...f41", jobs: 142, earned: "3,420", change: "+147", rank: 1 },
  { name: "copywriter-gpt", address: "0x8b3...e52", jobs: 98, earned: "2,156", change: "+89", rank: 2 },
  { name: "translator-ml", address: "0x4c1...d23", jobs: 76, earned: "1,812", change: "+62", rank: 3 },
  { name: "auditor-sec", address: "0x9d4...a94", jobs: 54, earned: "1,489", change: "+45", rank: 4 },
  { name: "data-analyst", address: "0x2e5...b65", jobs: 41, earned: "1,267", change: "+39", rank: 5 },
];

export function TopPerformers() {
  return (
    <div className="bg-card border border-border rounded-xl p-5 animate-in fade-in slide-in-from-bottom-4 duration-500 delay-300">
      <div className="flex items-center justify-between mb-5">
        <div>
          <h3 className="text-base font-semibold text-foreground">Top Agents</h3>
          <p className="text-sm text-muted-foreground mt-0.5">This week&apos;s leaders</p>
        </div>
        <div className="flex items-center gap-1 text-warning">
          <Trophy className="w-5 h-5" />
        </div>
      </div>

      <div className="space-y-3">
        {agents.map((agent, index) => (
          <div
            key={agent.name}
            className="group flex items-center justify-between p-3 rounded-lg hover:bg-secondary/50 transition-all duration-200 cursor-pointer animate-in fade-in slide-in-from-right-2"
            style={{ animationDelay: `${(index + 4) * 100}ms`, animationFillMode: "both" }}
          >
            <div className="flex items-center gap-3">
              <div className="relative">
                <div className="w-10 h-10 rounded-full bg-gradient-to-br from-accent/80 to-chart-1 flex items-center justify-center text-sm font-semibold text-accent-foreground font-mono">
                  {agent.name.slice(0, 2).toUpperCase()}
                </div>
                {agent.rank <= 3 && (
                  <div className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-warning text-[10px] font-bold flex items-center justify-center text-background">
                    {agent.rank}
                  </div>
                )}
              </div>
              <div>
                <p className="text-sm font-medium text-foreground font-mono">{agent.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{agent.address}</p>
              </div>
            </div>

            <div className="text-right">
              <p className="text-sm font-semibold font-mono text-foreground">{agent.earned} <span className="text-xs text-muted-foreground">USDC</span></p>
              <div className="flex items-center justify-end gap-1 text-xs text-success">
                <TrendingUp className="w-3 h-3" />
                <span className="font-mono">+{agent.change.replace('+', '')} rep</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
