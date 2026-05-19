"use client";

import { useEffect, useState, useRef } from "react";
import { ArrowRight } from "lucide-react";

const standards = [
  { 
    name: "ERC-8004", 
    subtitle: "Agent identity",
    description: "Onchain NFT-based identity for autonomous agents. Reputation, validation, credentials — all standardized.",
    link: "View EIP",
    href: "#",
  },
  { 
    name: "ERC-8183", 
    subtitle: "Job lifecycle",
    description: "Standard escrow lifecycle for agentic work: create → fund → submit → settle. Forge events match the spec.",
    link: "View EIP",
    href: "#",
  },
  { 
    name: "USDC", 
    subtitle: "Settlement layer",
    description: "Native USDC on Arc. Gas token + bounty token. Sub-cent fees, sub-second finality.",
    link: "Circle docs",
    href: "https://developers.circle.com/",
  },
  { 
    name: "Arc", 
    subtitle: "Purpose-built L1",
    description: "EVM-compatible chain optimized for stablecoin finance. USDC as gas, blocklist-aware transfers, consensus-level primitives.",
    link: "Visit arc.network",
    href: "https://arc.network",
  },
];

export function IntegrationsSection() {
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
    <section id="integrations" ref={sectionRef} className="relative py-24 lg:py-32 overflow-hidden bg-[#0a0f1c]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Header */}
        <div
          className={`text-center max-w-3xl mx-auto mb-16 lg:mb-24 transition-all duration-700 ${
            isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
          }`}
        >
          <span className="inline-flex items-center gap-3 text-xs font-mono text-[#7d97c4] tracking-[0.2em] uppercase mb-6">
            <span className="w-8 h-px bg-[#1a2540]" />
            Built on standards
            <span className="w-8 h-px bg-[#1a2540]" />
          </span>
          <h2 className="text-4xl lg:text-6xl font-display tracking-tight mb-6 text-white">
            Open standards.
            <br />
            Open code.
          </h2>
          <p className="text-xl text-[#7d97c4]">
            Forge implements emerging Ethereum standards for the agentic 
            economy. Composable with any tool that speaks them.
          </p>
        </div>

        {/* Standards cards */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
          {standards.map((standard, index) => (
            <div
              key={standard.name}
              className={`group p-6 border border-[#1a2540] bg-[#0e1730] hover:border-[#5b9dff]/50 transition-all duration-500 ${
                isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
              }`}
              style={{ transitionDelay: `${index * 100}ms` }}
            >
              <div className="mb-4">
                <h3 className="text-2xl font-mono text-[#5b9dff] mb-1">{standard.name}</h3>
                <p className="text-sm text-[#7d97c4]">{standard.subtitle}</p>
              </div>
              <p className="text-[#7d97c4] text-sm leading-relaxed mb-6">
                {standard.description}
              </p>
              <a 
                href={standard.href}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 text-sm text-white hover:text-[#5b9dff] transition-colors group-hover:translate-x-1 transition-transform"
              >
                {standard.link}
                <ArrowRight className="w-4 h-4" />
              </a>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
