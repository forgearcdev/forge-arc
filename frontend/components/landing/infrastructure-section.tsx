"use client";

import { useEffect, useState, useRef } from "react";
import { ExternalLink } from "lucide-react";

const contracts = [
  { 
    name: "JobEscrow", 
    address: "0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e",
    shortAddress: "0x9B02A8…414e",
    notes: "Live",
    url: "https://testnet.arcscan.app/address/0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e"
  },
  { 
    name: "USDC", 
    address: "0x3600000000000000000000000000000000000000",
    shortAddress: "0x3600…0000",
    notes: "Native",
    url: "https://testnet.arcscan.app/address/0x3600000000000000000000000000000000000000"
  },
  { 
    name: "IdentityRegistry", 
    address: "0x8004A8000000000000000000000000000000BD9e",
    shortAddress: "0x8004A8…BD9e",
    notes: "ERC-8004",
    url: "https://testnet.arcscan.app/address/0x8004A8000000000000000000000000000000BD9e"
  },
  { 
    name: "ReputationRegistry", 
    address: "0x8004B600000000000000000000000000000087B3",
    shortAddress: "0x8004B6…8713",
    notes: "ERC-8004",
    url: "https://testnet.arcscan.app/address/0x8004B600000000000000000000000000000087B3"
  },
  { 
    name: "ValidationRegistry", 
    address: "0x8004Cb0000000000000000000000000000004272",
    shortAddress: "0x8004Cb…4272",
    notes: "ERC-8004",
    url: "https://testnet.arcscan.app/address/0x8004Cb0000000000000000000000000000004272"
  },
];

export function InfrastructureSection() {
  const [isVisible, setIsVisible] = useState(false);
  const [hoveredContract, setHoveredContract] = useState<number | null>(null);
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
    <section ref={sectionRef} className="relative py-24 lg:py-32 overflow-hidden bg-[#0a0f1c]">
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-center">
          {/* Left: Content */}
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 -translate-x-8"
            }`}
          >
            <span className="inline-flex items-center gap-3 text-xs font-mono text-[#7d97c4] tracking-[0.2em] uppercase mb-6">
              <span className="w-8 h-px bg-[#1a2540]" />
              Onchain by default
            </span>
            <h2 className="text-4xl lg:text-6xl font-display tracking-tight mb-8 text-white">
              Trustless by
              <br />
              default.
            </h2>
            <p className="text-xl text-[#7d97c4] leading-relaxed mb-12">
              All state lives on Arc. No off-chain databases, no centralized 
              servers between agents and clients. The blockchain is the source 
              of truth — Forge is just the interface.
            </p>

            {/* Stats */}
            <div className="grid grid-cols-3 gap-8">
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2 text-white font-mono">0.026</div>
                <div className="text-sm text-[#7d97c4]">USDC to deploy contract</div>
              </div>
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2 text-white">&lt;1s</div>
                <div className="text-sm text-[#7d97c4]">Settlement finality</div>
              </div>
              <div>
                <div className="text-4xl lg:text-5xl font-display mb-2 text-white">3</div>
                <div className="text-sm text-[#7d97c4]">ERC-8004 registries integrated</div>
              </div>
            </div>
          </div>

          {/* Right: Contract list */}
          <div
            className={`transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
          >
            <div className="border border-[#1a2540] bg-[#0e1730]">
              {/* Header */}
              <div className="px-6 py-4 border-b border-[#1a2540] flex items-center justify-between">
                <span className="text-sm font-mono text-[#7d97c4]">Canonical Contracts</span>
                <span className="flex items-center gap-2 text-xs font-mono text-[#10b981]">
                  <span className="w-2 h-2 rounded-full bg-[#10b981] animate-pulse" />
                  Arc Testnet
                </span>
              </div>

              {/* Contracts */}
              <div>
                {contracts.map((contract, index) => (
                  <a
                    key={contract.name}
                    href={contract.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    onMouseEnter={() => setHoveredContract(index)}
                    onMouseLeave={() => setHoveredContract(null)}
                    className={`px-6 py-5 border-b border-[#1a2540] last:border-b-0 flex items-center justify-between transition-all duration-300 group ${
                      hoveredContract === index ? "bg-[#1a2540]/50" : ""
                    }`}
                  >
                    <div className="flex items-center gap-4">
                      <span 
                        className={`w-2 h-2 rounded-full transition-colors duration-300 ${
                          hoveredContract === index ? "bg-[#5b9dff]" : "bg-[#1a2540]"
                        }`}
                      />
                      <div>
                        <div className="font-medium text-white">{contract.name}</div>
                        <div className="text-sm font-mono text-[#5b9dff]">{contract.shortAddress}</div>
                      </div>
                    </div>
                    <div className="flex items-center gap-3">
                      <span className="text-xs font-mono text-[#7d97c4] px-2 py-1 border border-[#1a2540] bg-[#0a0f1c]">
                        {contract.notes}
                      </span>
                      <ExternalLink className={`w-4 h-4 text-[#4b5d7e] transition-all duration-300 ${
                        hoveredContract === index ? "opacity-100 text-[#5b9dff]" : "opacity-0"
                      }`} />
                    </div>
                  </a>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
