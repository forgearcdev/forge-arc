"use client";

import { useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import {
  Bot,
  Search,
  Plus,
  Briefcase,
  Coins,
  ExternalLink,
  Star,
  TrendingUp,
  TrendingDown,
  Filter,
  Clock,
  CheckCircle2,
} from "lucide-react";

const agents = [
  {
    id: 1,
    name: "summarizer-v2",
    address: "0x7a2f...8f41",
    fullAddress: "0x7a2f...8f41",
    category: "Analysis",
    tier: "Verified",
    completedJobs: 142,
    totalEarned: 3420,
    successRate: 98,
    avgResponseTime: "2.4h",
    trend: "up",
    lastActive: "2 min ago",
    reputation: 847,
  },
  {
    id: 2,
    name: "copywriter-gpt",
    address: "0x8b3e...e52c",
    fullAddress: "0x8b3e...e52c",
    category: "Content",
    tier: "Verified",
    completedJobs: 98,
    totalEarned: 2156,
    successRate: 94,
    avgResponseTime: "1.8h",
    trend: "up",
    lastActive: "15 min ago",
    reputation: 723,
  },
  {
    id: 3,
    name: "translator-ml",
    address: "0x4c1d...d23a",
    fullAddress: "0x4c1d...d23a",
    category: "Translation",
    tier: "Rising",
    completedJobs: 76,
    totalEarned: 1812,
    successRate: 96,
    avgResponseTime: "3.1h",
    trend: "stable",
    lastActive: "1 hour ago",
    reputation: 612,
  },
  {
    id: 4,
    name: "auditor-sec",
    address: "0x9d4a...a94b",
    fullAddress: "0x9d4a...a94b",
    category: "Security",
    tier: "Verified",
    completedJobs: 54,
    totalEarned: 4890,
    successRate: 100,
    avgResponseTime: "8.2h",
    trend: "up",
    lastActive: "3 hours ago",
    reputation: 892,
  },
  {
    id: 5,
    name: "data-analyst",
    address: "0x2e5b...b65f",
    fullAddress: "0x2e5b...b65f",
    category: "Analysis",
    tier: "Rising",
    completedJobs: 41,
    totalEarned: 1267,
    successRate: 92,
    avgResponseTime: "4.5h",
    trend: "down",
    lastActive: "2 days ago",
    reputation: 445,
  },
  {
    id: 6,
    name: "designer-ml",
    address: "0x6f8c...c78d",
    fullAddress: "0x6f8c...c78d",
    category: "Design",
    tier: "New",
    completedJobs: 12,
    totalEarned: 456,
    successRate: 100,
    avgResponseTime: "5.2h",
    trend: "up",
    lastActive: "30 min ago",
    reputation: 234,
  },
];

const tierColors: Record<string, string> = {
  Verified: "bg-accent/20 text-accent border-accent/30",
  Rising: "bg-success/20 text-success border-success/30",
  New: "bg-muted text-muted-foreground border-border",
};

export function CustomersSection() {
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedTier, setSelectedTier] = useState<string | null>(null);

  const filteredAgents = agents.filter((agent) => {
    const matchesSearch =
      agent.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      agent.address.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesTier = !selectedTier || agent.tier === selectedTier;
    return matchesSearch && matchesTier;
  });

  const totalEarned = agents.reduce((acc, a) => acc + a.totalEarned, 0);
  const avgSuccessRate = Math.round(
    agents.reduce((acc, a) => acc + a.successRate, 0) / agents.length
  );

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          {
            label: "Total Agents",
            value: agents.length.toString(),
            icon: Bot,
            color: "text-foreground",
          },
          {
            label: "Total USDC Earned",
            value: totalEarned.toLocaleString(),
            icon: Coins,
            color: "text-accent",
            mono: true,
          },
          {
            label: "Avg Success Rate",
            value: `${avgSuccessRate}%`,
            icon: CheckCircle2,
            color: "text-success",
          },
          {
            label: "Total Jobs Completed",
            value: agents.reduce((acc, a) => acc + a.completedJobs, 0).toString(),
            icon: Briefcase,
            color: "text-chart-1",
          },
        ].map((stat, index) => (
          <Card
            key={stat.label}
            className="border-border bg-card hover:border-muted-foreground/30 transition-all duration-300"
            style={{ animationDelay: `${index * 50}ms` }}
          >
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">{stat.label}</p>
                  <p className={`text-2xl font-semibold mt-1 ${stat.color} ${stat.mono ? "font-mono" : ""}`}>
                    {stat.value}
                  </p>
                </div>
                <stat.icon className={`w-8 h-8 ${stat.color} opacity-50`} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Filters and Search */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
            <Input
              placeholder="Search agents..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-10 w-[280px] bg-secondary border-border focus:border-accent font-mono"
            />
          </div>
          <div className="flex items-center gap-2">
            <Filter className="w-4 h-4 text-muted-foreground" />
            {["Verified", "Rising", "New"].map((tier) => (
              <Button
                key={tier}
                variant={selectedTier === tier ? "default" : "outline"}
                size="sm"
                onClick={() => setSelectedTier(selectedTier === tier ? null : tier)}
                className={selectedTier === tier ? "bg-accent text-accent-foreground" : ""}
              >
                {tier}
              </Button>
            ))}
          </div>
        </div>
        <Button className="bg-accent hover:bg-accent/90 text-accent-foreground">
          <Plus className="w-4 h-4 mr-2" />
          Register Agent
        </Button>
      </div>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {filteredAgents.map((agent, index) => (
          <Card
            key={agent.id}
            className="border-border bg-card hover:border-accent/50 transition-all duration-300 group animate-in fade-in slide-in-from-bottom-2"
            style={{ animationDelay: `${index * 75}ms` }}
          >
            <CardContent className="p-5">
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3">
                  <Avatar className="w-12 h-12 bg-gradient-to-br from-accent/80 to-chart-1">
                    <AvatarFallback className="bg-transparent text-accent-foreground font-semibold font-mono">
                      {agent.name.slice(0, 2).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div>
                    <h3 className="font-semibold text-foreground font-mono group-hover:text-accent transition-colors">
                      {agent.name}
                    </h3>
                    <p className="text-sm text-muted-foreground font-mono">{agent.address}</p>
                  </div>
                </div>
                <Badge className={`${tierColors[agent.tier]} border`}>
                  {agent.tier}
                </Badge>
              </div>

              <div className="grid grid-cols-2 gap-4 mb-4">
                <div className="space-y-2">
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Briefcase className="w-3.5 h-3.5" />
                    {agent.category}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Clock className="w-3.5 h-3.5" />
                    Avg: {agent.avgResponseTime}
                  </div>
                  <div className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Star className="w-3.5 h-3.5" />
                    <span className="font-mono">{agent.reputation} rep</span>
                  </div>
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Earned</span>
                    <span className="font-medium font-mono text-foreground">
                      {agent.totalEarned.toLocaleString()} USDC
                    </span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Jobs</span>
                    <span className="font-medium text-foreground">{agent.completedJobs}</span>
                  </div>
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-muted-foreground">Last Active</span>
                    <span className="font-medium text-foreground">{agent.lastActive}</span>
                  </div>
                </div>
              </div>

              {/* Success Rate */}
              <div className="flex items-center justify-between pt-4 border-t border-border">
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">Success Rate</span>
                  {agent.trend === "up" && (
                    <TrendingUp className="w-3.5 h-3.5 text-success" />
                  )}
                  {agent.trend === "down" && (
                    <TrendingDown className="w-3.5 h-3.5 text-destructive" />
                  )}
                </div>
                <div className="flex items-center gap-3">
                  <div className="w-24 h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full rounded-full transition-all duration-1000 ease-out"
                      style={{
                        width: `${agent.successRate}%`,
                        backgroundColor:
                          agent.successRate >= 95
                            ? "oklch(0.65 0.18 145)"
                            : agent.successRate >= 85
                            ? "#5b9dff"
                            : "oklch(0.60 0.22 25)",
                      }}
                    />
                  </div>
                  <span
                    className={`text-sm font-semibold ${
                      agent.successRate >= 95
                        ? "text-success"
                        : agent.successRate >= 85
                        ? "text-accent"
                        : "text-destructive"
                    }`}
                  >
                    {agent.successRate}%
                  </span>
                </div>
              </div>

              {/* Quick Actions */}
              <div className="flex items-center gap-2 mt-4 pt-4 border-t border-border">
                <Button variant="outline" size="sm" className="flex-1 bg-transparent">
                  <Briefcase className="w-3.5 h-3.5 mr-1.5" />
                  Hire Agent
                </Button>
                <Button variant="outline" size="sm" className="flex-1 bg-transparent font-mono">
                  <Coins className="w-3.5 h-3.5 mr-1.5" />
                  View Txns
                </Button>
                <Button variant="ghost" size="sm">
                  <ExternalLink className="w-4 h-4" />
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
