"use client";

import { useEffect, useState, useRef } from "react";
import { Shield, Lock, Clock, Zap } from "lucide-react";

const securityFeatures = [
  {
    icon: Shield,
    title: "Slither static analysis",
    description: "101 detectors run. Zero HIGH or MEDIUM findings. Only documented LOW timestamp warnings remain.",
  },
  {
    icon: Lock,
    title: "CEI + ReentrancyGuard",
    description: "Defense in depth. Every state mutation follows Checks-Effects-Interactions ordering, plus OpenZeppelin's ReentrancyGuard on every external entry point.",
  },
  {
    icon: Clock,
    title: "Permissionless refunds",
    description: "After a job's deadline, anyone can call claimRefund. No admin keys, no upgrade paths, no custodians.",
  },
  {
    icon: Zap,
    title: "ERC-8183 event compatibility",
    description: "Job lifecycle events match ERC-8183 exactly. Any indexer that understands the standard works with Forge automatically.",
  },
];

const certifications = ["VERIFIED ON ARCSCAN", "SLITHER CLEAN", "32 TESTS PASSING", "FORK TESTED"];

export function SecuritySection() {
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
    <section id="security" ref={sectionRef} className="relative py-24 lg:py-32 bg-[#0e1730] overflow-hidden">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24">
          {/* Left: Content */}
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <span className="inline-flex items-center gap-3 text-xs font-mono text-[#7d97c4] tracking-[0.2em] uppercase mb-6">
              <span className="w-8 h-px bg-[#1a2540]" />
              Verified onchain
            </span>
            <h2 className="text-4xl lg:text-6xl font-display tracking-tight mb-8 text-white">
              Trust the
              <br />
              code.
            </h2>
            <p className="text-xl text-[#7d97c4] leading-relaxed mb-12">
              Forge&apos;s contract is open-source, statically analyzed, and tested 
              end-to-end against live Arc testnet. Every interaction verifiable 
              in real time on the explorer.
            </p>

            {/* Certifications */}
            <div className="flex flex-wrap gap-3">
              {certifications.map((cert, index) => (
                <span
                  key={cert}
                  className={`px-4 py-2 border border-[#5b9dff]/30 text-xs font-mono text-[#5b9dff] transition-all duration-500 ${
                    isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                  }`}
                  style={{ transitionDelay: `${index * 50 + 200}ms` }}
                >
                  {cert}
                </span>
              ))}
            </div>
          </div>

          {/* Right: Features */}
          <div className="grid gap-6">
            {securityFeatures.map((feature, index) => (
              <div
                key={feature.title}
                className={`p-6 border border-[#1a2540] bg-[#0a0f1c] hover:border-[#5b9dff]/30 transition-all duration-500 group ${
                  isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
                }`}
                style={{ transitionDelay: `${index * 100}ms` }}
              >
                <div className="flex items-start gap-4">
                  <div className="shrink-0 w-10 h-10 flex items-center justify-center border border-[#1a2540] group-hover:bg-[#5b9dff] group-hover:border-[#5b9dff] group-hover:text-[#0a0f1c] transition-colors duration-300 text-[#5b9dff]">
                    <feature.icon className="w-5 h-5" />
                  </div>
                  <div>
                    <h3 className="text-lg font-medium mb-1 text-white group-hover:translate-x-1 transition-transform duration-300">
                      {feature.title}
                    </h3>
                    <p className="text-[#7d97c4]">{feature.description}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
