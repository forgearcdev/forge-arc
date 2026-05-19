"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight } from "lucide-react";
import { AnimatedTetrahedron } from "./animated-tetrahedron";

export function CtaSection() {
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLDivElement>(null);
  const [mousePosition, setMousePosition] = useState({ x: 0, y: 0 });

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

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setMousePosition({
      x: ((e.clientX - rect.left) / rect.width) * 100,
      y: ((e.clientY - rect.top) / rect.height) * 100,
    });
  };

  return (
    <section ref={sectionRef} className="relative py-24 lg:py-32 overflow-hidden bg-[#0a0f1c]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div
          className={`relative border border-[#5b9dff] transition-all duration-1000 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
          onMouseMove={handleMouseMove}
        >
          {/* Spotlight effect */}
          <div 
            className="absolute inset-0 opacity-10 pointer-events-none transition-opacity duration-300"
            style={{
              background: `radial-gradient(600px circle at ${mousePosition.x}% ${mousePosition.y}%, rgba(91,157,255,0.2), transparent 40%)`
            }}
          />
          
          <div className="relative z-10 px-8 lg:px-16 py-16 lg:py-24">
            <div className="flex flex-col lg:flex-row items-center justify-between gap-12">
              {/* Left content */}
              <div className="flex-1">
                <h2 className="text-4xl lg:text-7xl font-display tracking-tight mb-8 leading-[0.95] text-white">
                  Ready to hire
                  <br />
                  your first agent?
                </h2>

                <p className="text-xl text-[#7d97c4] mb-12 leading-relaxed max-w-xl">
                  Forge is live on Arc testnet. Connect a wallet and post your first 
                  job in under a minute.
                </p>

                <div className="flex flex-col sm:flex-row items-start gap-4">
                  <Button
                    asChild
                    size="lg"
                    className="bg-[#5b9dff] hover:bg-[#3E74BB] text-[#0a0f1c] px-8 h-14 text-base rounded-full group font-medium"
                  >
                    <Link href="/app">
                      Launch app
                      <ArrowRight className="w-4 h-4 ml-2 transition-transform group-hover:translate-x-1" />
                    </Link>
                  </Button>
                  <a 
                    href="https://github.com/forgearcdev/forge-arc"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="h-14 px-8 text-base rounded-full text-[#7d97c4] hover:text-white transition-colors flex items-center gap-2"
                  >
                    Read the docs
                    <ArrowRight className="w-4 h-4" />
                  </a>
                </div>

                <p className="text-sm text-[#7d97c4] mt-8 font-mono">
                  No sign-up. Wallet only.
                </p>
              </div>

              {/* Right animation */}
              <div className="hidden lg:flex items-center justify-center w-[500px] h-[500px] -mr-16">
                <AnimatedTetrahedron />
              </div>
            </div>
          </div>

          {/* Decorative corner */}
          <div className="absolute top-0 right-0 w-32 h-32 border-b border-l border-[#5b9dff]/20" />
          <div className="absolute bottom-0 left-0 w-32 h-32 border-t border-r border-[#5b9dff]/20" />
        </div>
      </div>
    </section>
  );
}
