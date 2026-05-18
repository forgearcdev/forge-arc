"use client";

import { useState } from "react";
import { cn } from "@/lib/utils";
import { Plus, MoreHorizontal, Clock, Coins, Bot, Briefcase, CheckCircle2, AlertCircle } from "lucide-react";
import { RequiresWallet } from "@/components/requires-wallet";

interface Job {
  id: string;
  task: string;
  value: number;
  agent: string;
  hoursInStage: number;
  deadline: string;
}

interface Stage {
  id: string;
  name: string;
  jobs: Job[];
  total: number;
}

const initialStages: Stage[] = [
  {
    id: "funded",
    name: "Funded",
    total: 865,
    jobs: [
      { id: "1", task: "API documentation", value: 145, agent: "writer-ai", hoursInStage: 3, deadline: "24h" },
      { id: "2", task: "Bug triage", value: 78, agent: "debugger-x", hoursInStage: 5, deadline: "12h" },
      { id: "3", task: "UI mockup review", value: 92, agent: "designer-ml", hoursInStage: 1, deadline: "48h" },
    ],
  },
  {
    id: "submitted",
    name: "Submitted",
    total: 456,
    jobs: [
      { id: "4", task: "Smart contract audit", value: 325, agent: "auditor-sec", hoursInStage: 7, deadline: "2h" },
      { id: "5", task: "Translation EN-ES", value: 89, agent: "translator-ml", hoursInStage: 4, deadline: "6h" },
    ],
  },
  {
    id: "review",
    name: "In Review",
    total: 557,
    jobs: [
      { id: "6", task: "Code optimization", value: 267, agent: "optimizer-v3", hoursInStage: 12, deadline: "1h" },
      { id: "7", task: "Data analysis", value: 195, agent: "data-analyst", hoursInStage: 8, deadline: "4h" },
      { id: "8", task: "Content writing", value: 95, agent: "copywriter-gpt", hoursInStage: 6, deadline: "8h" },
    ],
  },
  {
    id: "completed",
    name: "Completed",
    total: 1279,
    jobs: [
      { id: "9", task: "Security scan", value: 445, agent: "scanner-ai", hoursInStage: 15, deadline: "-" },
      { id: "10", task: "Performance test", value: 212, agent: "perf-agent", hoursInStage: 10, deadline: "-" },
    ],
  },
];

function JobCard({ job, index, isCompleted }: { job: Job; index: number; isCompleted?: boolean }) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className="group bg-background border border-border rounded-lg p-4 cursor-grab active:cursor-grabbing hover:border-accent/50 transition-all duration-200 animate-in fade-in slide-in-from-bottom-2"
      style={{ animationDelay: `${index * 50}ms`, animationFillMode: "both" }}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-md bg-secondary flex items-center justify-center">
            <Briefcase className="w-4 h-4 text-muted-foreground" />
          </div>
          <span className="text-sm font-medium text-foreground truncate max-w-[120px]">{job.task}</span>
        </div>
        <button className={cn(
          "w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-secondary transition-all duration-200",
          isHovered ? "opacity-100" : "opacity-0"
        )}>
          <MoreHorizontal className="w-4 h-4" />
        </button>
      </div>

      <div className="flex items-center gap-2 text-sm text-foreground font-semibold mb-3 font-mono">
        <Coins className="w-3.5 h-3.5 text-accent" />
        {job.value} <span className="text-xs text-muted-foreground font-normal">USDC</span>
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-1 font-mono">
          <Bot className="w-3 h-3" />
          {job.agent}
        </div>
        <div className="flex items-center gap-1">
          <Clock className="w-3 h-3" />
          {job.hoursInStage}h
        </div>
      </div>

      {/* Deadline indicator */}
      {!isCompleted && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center justify-between text-xs">
            <span className="text-muted-foreground">Deadline</span>
            <div className={cn(
              "flex items-center gap-1 font-medium",
              job.deadline === "1h" || job.deadline === "2h" ? "text-destructive" : "text-muted-foreground"
            )}>
              {(job.deadline === "1h" || job.deadline === "2h") && <AlertCircle className="w-3 h-3" />}
              {job.deadline}
            </div>
          </div>
        </div>
      )}

      {isCompleted && (
        <div className="mt-3 pt-3 border-t border-border">
          <div className="flex items-center gap-1 text-xs text-success">
            <CheckCircle2 className="w-3 h-3" />
            <span>Payment released</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function PipelineSection() {
  const [stages] = useState(initialStages);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-sm text-muted-foreground">Manage and track active jobs on the marketplace</p>
        </div>
        <RequiresWallet message="Connect wallet to post a job">
          <button className="flex items-center gap-2 px-4 py-2 bg-accent text-accent-foreground rounded-lg text-sm font-medium hover:bg-accent/90 transition-colors duration-200">
            <Plus className="w-4 h-4" />
            Post Job
          </button>
        </RequiresWallet>
      </div>

      {/* Pipeline board */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        {stages.map((stage, stageIndex) => (
          <div
            key={stage.id}
            className="bg-card border border-border rounded-xl p-4 min-h-[500px] animate-in fade-in slide-in-from-bottom-4 duration-500"
            style={{ animationDelay: `${stageIndex * 100}ms`, animationFillMode: "both" }}
          >
            {/* Stage header */}
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-foreground">{stage.name}</h3>
                <span className="px-2 py-0.5 bg-secondary rounded-md text-xs font-medium text-muted-foreground">
                  {stage.jobs.length}
                </span>
              </div>
              <span className="text-xs font-medium font-mono text-muted-foreground">
                {stage.total} USDC
              </span>
            </div>

            {/* Jobs */}
            <div className="space-y-3">
              {stage.jobs.map((job, jobIndex) => (
                <JobCard key={job.id} job={job} index={jobIndex} isCompleted={stage.id === "completed"} />
              ))}
            </div>

            {/* Add job to stage */}
            {stage.id === "funded" && (
              <RequiresWallet message="Connect wallet to post a job">
                <button className="w-full mt-3 flex items-center justify-center gap-2 py-2 rounded-lg border border-dashed border-border text-sm text-muted-foreground hover:text-foreground hover:border-accent/50 hover:bg-secondary/50 transition-all duration-200">
                  <Plus className="w-4 h-4" />
                  Post job
                </button>
              </RequiresWallet>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
