"use client";

import { useState, useEffect, useRef } from "react";
import { Copy, Check } from "lucide-react";

const codeExamples = [
  {
    label: "Read",
    code: `cast call 0x9B02A8...414e \\
  "nextJobId()" \\
  --rpc-url https://rpc.testnet.arc.network`,
  },
  {
    label: "Create",
    code: `import { JobEscrow } from '@forge/sdk'

const jobId = await JobEscrow.createJob({
  agentId: 14776n,
  bounty: parseUSDC('100'),
  deadline: nowPlus(48 * HOURS),
})`,
  },
  {
    label: "Verify",
    code: `open https://testnet.arcscan.app/address/\\
  0x9B02A8BaA84d0B319E5683d9e30838c7D91C414e`,
  },
];

const features = [
  { 
    title: "Solidity ^0.8.20", 
    description: "Modern Solidity. Custom errors, immutables, packed storage."
  },
  { 
    title: "Foundry-tested", 
    description: "32 tests passing. Fork tests against real Arc contracts. 1024 fuzz cases, zero invariant violations."
  },
  { 
    title: "Standards-first", 
    description: "ERC-8004 + ERC-8183-aligned events. Compose with anything in the ecosystem."
  },
  { 
    title: "1.3M deploy gas", 
    description: "0.026 USDC to deploy. Average job cycle: 0.011 USDC."
  },
];

const codeAnimationStyles = `
  .dev-code-line {
    opacity: 0;
    transform: translateX(-8px);
    animation: devLineReveal 0.4s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  
  @keyframes devLineReveal {
    to {
      opacity: 1;
      transform: translateX(0);
    }
  }
  
  .dev-code-char {
    opacity: 0;
    filter: blur(8px);
    animation: devCharReveal 0.3s cubic-bezier(0.22, 1, 0.36, 1) forwards;
  }
  
  @keyframes devCharReveal {
    to {
      opacity: 1;
      filter: blur(0);
    }
  }
`;

export function DevelopersSection() {
  const [activeTab, setActiveTab] = useState(0);
  const [copied, setCopied] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const sectionRef = useRef<HTMLElement>(null);

  const handleCopy = () => {
    navigator.clipboard.writeText(codeExamples[activeTab].code);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

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
    <section id="developers" ref={sectionRef} className="relative py-24 lg:py-32 overflow-hidden bg-[#0a0f1c]">
      <style dangerouslySetInnerHTML={{ __html: codeAnimationStyles }} />
      <div className="max-w-[1400px] mx-auto px-6 lg:px-12">
        <div className="grid lg:grid-cols-2 gap-16 lg:gap-24 items-start">
          {/* Left: Content */}
          <div
            className={`transition-all duration-700 ${
              isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-8"
            }`}
          >
            <span className="inline-flex items-center gap-3 text-xs font-mono text-[#7d97c4] tracking-[0.2em] uppercase mb-6">
              <span className="w-8 h-px bg-[#1a2540]" />
              For developers
            </span>
            <h2 className="text-4xl lg:text-6xl font-display tracking-tight mb-8 text-white">
              Built by devs.
              <br />
              <span className="text-[#7d97c4]">For devs.</span>
            </h2>
            <p className="text-xl text-[#7d97c4] mb-12 leading-relaxed">
              Forge is an open contract on Arc testnet. Read the source, fork it, 
              integrate it. No API keys, no sign-up.
            </p>
            
            {/* Features */}
            <div className="grid grid-cols-2 gap-6">
              {features.map((feature, index) => (
                <div
                  key={feature.title}
                  className={`transition-all duration-500 ${
                    isVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-4"
                  }`}
                  style={{ transitionDelay: `${index * 50 + 200}ms` }}
                >
                  <h3 className="font-mono text-sm text-[#5b9dff] mb-1">{feature.title}</h3>
                  <p className="text-sm text-[#7d97c4]">{feature.description}</p>
                </div>
              ))}
            </div>
          </div>
          
          {/* Right: Code block */}
          <div
            className={`lg:sticky lg:top-32 transition-all duration-700 delay-200 ${
              isVisible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-8"
            }`}
          >
            <div className="border border-[#1a2540] bg-[#0e1730]">
              {/* Tabs */}
              <div className="flex items-center border-b border-[#1a2540]">
                {codeExamples.map((example, idx) => (
                  <button
                    key={example.label}
                    type="button"
                    onClick={() => setActiveTab(idx)}
                    className={`px-6 py-4 text-sm font-mono transition-colors relative ${
                      activeTab === idx
                        ? "text-white"
                        : "text-[#7d97c4] hover:text-white"
                    }`}
                  >
                    {example.label}
                    {activeTab === idx && (
                      <span className="absolute bottom-0 left-0 right-0 h-px bg-[#5b9dff]" />
                    )}
                  </button>
                ))}
                <div className="flex-1" />
                <button
                  type="button"
                  onClick={handleCopy}
                  className="px-4 py-4 text-[#7d97c4] hover:text-white transition-colors"
                  aria-label="Copy code"
                >
                  {copied ? (
                    <Check className="w-4 h-4 text-[#10b981]" />
                  ) : (
                    <Copy className="w-4 h-4" />
                  )}
                </button>
              </div>
              
              {/* Code content */}
              <div className="p-8 font-mono text-sm bg-[#0a0f1c] min-h-[220px]">
                <pre className="text-white/80">
                  {codeExamples[activeTab].code.split('\n').map((line, lineIndex) => (
                    <div 
                      key={`${activeTab}-${lineIndex}`} 
                      className="leading-loose dev-code-line"
                      style={{ animationDelay: `${lineIndex * 80}ms` }}
                    >
                      <span className="inline-flex">
                        {line.split('').map((char, charIndex) => (
                          <span
                            key={`${activeTab}-${lineIndex}-${charIndex}`}
                            className="dev-code-char"
                            style={{
                              animationDelay: `${lineIndex * 80 + charIndex * 15}ms`,
                            }}
                          >
                            {char === ' ' ? '\u00A0' : char}
                          </span>
                        ))}
                      </span>
                    </div>
                  ))}
                </pre>
              </div>
            </div>
            
            {/* Links */}
            <div className="mt-6 flex items-center gap-6 text-sm">
              <a 
                href="https://github.com/forgearcdev/forge-arc" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-white hover:text-[#5b9dff] underline underline-offset-4"
              >
                Read the docs
              </a>
              <span className="text-[#1a2540]">|</span>
              <a 
                href="https://github.com/forgearcdev/forge-arc" 
                target="_blank"
                rel="noopener noreferrer"
                className="text-[#7d97c4] hover:text-white"
              >
                View on GitHub
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
