"use client";

import { useState, useEffect } from "react";

const stages = [
  { name: "Funded", value: 67, count: 8, color: "bg-muted-foreground" },
  { name: "Submitted", value: 25, count: 3, color: "bg-chart-1" },
  { name: "Completed (24h)", value: 100, count: 24, color: "bg-success" },
];

export function PipelineOverview() {
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => setIsLoaded(true), 400);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="bg-card border border-border rounded-xl p-5 h-[380px] animate-in fade-in slide-in-from-bottom-4 duration-500 delay-100">
      <div className="mb-6">
        <h3 className="text-base font-semibold text-foreground">Job Lifecycle</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Active jobs by state</p>
      </div>

      <div className="space-y-5">
        {stages.map((stage, index) => (
          <div key={stage.name} className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-foreground">{stage.name}</span>
              <div className="flex items-center gap-2">
                <span className="text-sm font-mono text-muted-foreground">{stage.count}</span>
                {stage.name !== "Completed (24h)" && (
                  <span className="text-sm font-semibold text-foreground">{stage.value}%</span>
                )}
              </div>
            </div>
            <div className="h-2 bg-secondary rounded-full overflow-hidden">
              <div
                className={`h-full ${stage.color} rounded-full transition-all duration-1000 ease-out`}
                style={{
                  width: isLoaded ? `${stage.value}%` : "0%",
                  transitionDelay: `${index * 150}ms`,
                }}
              />
            </div>
          </div>
        ))}
      </div>

      {/* Total escrowed value */}
      <div className="mt-6 pt-5 border-t border-border">
        <div className="flex items-center justify-between">
          <span className="text-sm text-muted-foreground">Total Escrowed</span>
          <span className="text-xl font-bold font-mono text-foreground">1,247 <span className="text-sm font-normal text-muted-foreground">USDC</span></span>
        </div>
      </div>
    </div>
  );
}
