"use client";

import { useState, useEffect } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const data = [
  { day: "Mon", volume: 2860 },
  { day: "Tue", volume: 3205 },
  { day: "Wed", volume: 2870 },
  { day: "Thu", volume: 4230 },
  { day: "Fri", volume: 3890 },
  { day: "Sat", volume: 2140 },
  { day: "Sun", volume: 5105 },
];

export function RevenueChart() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 300);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-[380px] animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h3 className="text-base font-semibold text-foreground">USDC Volume</h3>
          <p className="text-sm text-muted-foreground mt-0.5">Daily USDC paid to agents</p>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <div className="flex items-center gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-chart-1" />
            <span className="text-muted-foreground">Volume</span>
          </div>
        </div>
      </div>

      <div className={`h-[280px] transition-opacity duration-700 ${isLoaded ? 'opacity-100' : 'opacity-0'}`}>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="volumeGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#5b9dff" stopOpacity={0.4} />
                <stop offset="100%" stopColor="#5b9dff" stopOpacity={0} />
              </linearGradient>
            </defs>
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
              formatter={(value: number) => [`${value.toLocaleString()} USDC`, ""]}
            />
            <Area
              type="monotone"
              dataKey="volume"
              stroke="#5b9dff"
              strokeWidth={2}
              fill="url(#volumeGradient)"
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
