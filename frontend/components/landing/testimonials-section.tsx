"use client";

import { useEffect, useState, useRef } from "react";

// Replace testimonials with "Built on Arc" centered pill
export function TestimonialsSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  useEffect(() => {
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setIsVisible(true);
      },
      { threshold: 0.2 }
    );

    if (sectionRef.current) observer.observe(sectionRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section ref={sectionRef} className="relative py-24 lg:py-32 border-t border-[#1a2540] bg-[#0a0f1c]">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        <div 
          className={`flex justify-center transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
          }`}
        >
          <a 
            href="https://arc.network"
            target="_blank"
            rel="noopener noreferrer"
            className="px-8 py-4 border border-[#5b9dff]/50 text-[#5b9dff] font-mono text-sm uppercase tracking-[0.2em] hover:bg-[#5b9dff]/10 hover:border-[#5b9dff] hover:shadow-[0_0_20px_rgba(91,157,255,0.3)] transition-all duration-300"
          >
            Built on Arc
          </a>
        </div>
      </div>
    </section>
  );
}
