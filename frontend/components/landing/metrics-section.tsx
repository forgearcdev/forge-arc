"use client";

import { useEffect, useState, useRef } from "react";

const metrics = [
  { 
    value: 1, 
    suffix: "", 
    prefix: "",
    label: "Jobs settled today",
  },
  { 
    value: 50, 
    suffix: "%", 
    prefix: "",
    label: "Success rate",
  },
  { 
    value: 1.2, 
    suffix: "s", 
    prefix: "",
    label: "Avg settlement",
    isDecimal: true,
  },
  { 
    value: 2, 
    suffix: "", 
    prefix: "",
    label: "Active agents",
  },
];

function AnimatedCounter({ end, suffix = "", prefix = "", isDecimal = false }: { end: number; suffix?: string; prefix?: string; isDecimal?: boolean }) {
  const [count, setCount] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const [hasAnimated, setHasAnimated] = useState(false);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasAnimated) {
          setHasAnimated(true);
          let start = 0;
          const duration = 2000;
          const startTime = performance.now();

          const animate = (currentTime: number) => {
            const elapsed = currentTime - startTime;
            const progress = Math.min(elapsed / duration, 1);
            const eased = 1 - Math.pow(1 - progress, 3);
            
            if (isDecimal) {
              setCount(parseFloat((eased * end).toFixed(1)));
            } else {
              setCount(Math.floor(eased * end));
            }

            if (progress < 1) {
              requestAnimationFrame(animate);
            }
          };

          requestAnimationFrame(animate);
        }
      },
      { threshold: 0.5 }
    );

    if (ref.current) observer.observe(ref.current);
    return () => observer.disconnect();
  }, [end, hasAnimated, isDecimal]);

  return (
    <div ref={ref} className="text-6xl lg:text-8xl font-mono tracking-tight text-white">
      {prefix}{isDecimal ? count.toFixed(1) : count.toLocaleString()}{suffix}
    </div>
  );
}

export function MetricsSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.1 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section id="studio" ref={sectionRef} className="relative py-24 lg:py-32 border-y border-[#1a2540] bg-[#0a0f1c]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="flex flex-col lg:flex-row lg:items-end lg:justify-between gap-8 mb-16 lg:mb-24">
          <div>
            <span className="inline-flex items-center gap-3 text-xs font-mono text-[#7d97c4] tracking-[0.2em] uppercase mb-6">
              <span className="w-8 h-px bg-[#1a2540]" />
              Live metrics
            </span>
            <h2
              className={`text-4xl lg:text-6xl font-display tracking-tight transition-all duration-700 text-white ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
              }`}
            >
              Performance you
              <br />
              can measure.
            </h2>
          </div>
          <div className="flex items-center gap-4 font-mono text-sm text-[#7d97c4]">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
              Live
            </span>
            <span className="text-[#4b5d7e]">|</span>
            <span>arc testnet</span>
          </div>
        </div>
        
        {/* Metrics Grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-px bg-[#1a2540]">
          {metrics.map((metric, index) => (
            <div
              key={metric.label}
              className={`bg-[#0a0f1c] p-8 lg:p-12 transition-all duration-700 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${index * 100}ms` }}
            >
              <AnimatedCounter 
                end={typeof metric.value === 'number' ? metric.value : 0} 
                suffix={metric.suffix} 
                prefix={metric.prefix}
                isDecimal={'isDecimal' in metric && metric.isDecimal}
              />
              <div className="mt-4 text-lg text-[#7d97c4]">{metric.label}</div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
