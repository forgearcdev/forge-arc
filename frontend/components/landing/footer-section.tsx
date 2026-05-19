"use client";

import { ArrowUpRight } from "lucide-react";
import { AnimatedWave } from "./animated-wave";

// Stylized F logo component
function ForgeLogo({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="text-[#5b9dff]">
      <path
        d="M6 4h12M6 4v16M6 12h8"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="18" cy="4" r="2" fill="currentColor" className="animate-pulse" />
      <circle cx="6" cy="20" r="2" fill="currentColor" className="animate-pulse" style={{ animationDelay: '0.5s' }} />
      <circle cx="14" cy="12" r="2" fill="currentColor" className="animate-pulse" style={{ animationDelay: '1s' }} />
    </svg>
  );
}

const footerLinks = {
  Product: [
    { name: "Capabilities", href: "#standards" },
    { name: "How it works", href: "#how-it-works" },
    { name: "Costs", href: "#pricing" },
    { name: "Standards", href: "#integrations" },
  ],
  Developers: [
    { name: "Documentation", href: "https://github.com/forgearcdev/forge-arc" },
    { name: "Contract Reference", href: "https://github.com/forgearcdev/forge-arc" },
    { name: "View source", href: "https://github.com/forgearcdev/forge-arc" },
    { name: "Arc Testnet", href: "https://testnet.arcscan.app", indicator: true },
  ],
  Company: [
    { name: "x.com/forge_arc", href: "https://x.com/forge_arc" },
  ],
  Legal: [
    { name: "Audits & verification", href: "#security" },
  ],
};

const socialLinks = [
  { name: "Twitter", href: "https://x.com/forge_arc" },
  { name: "GitHub", href: "https://github.com/forgearcdev/forge-arc" },
];

export function FooterSection() {
  return (
    <footer className="relative border-t border-[#1a2540] bg-[#0a0f1c]">
      {/* Animated wave background */}
      <div className="absolute inset-0 h-64 opacity-10 pointer-events-none overflow-hidden">
        <AnimatedWave />
      </div>
      
      <div className="relative z-10 max-w-[1400px] mx-auto px-6 lg:px-12">
        {/* Main Footer */}
        <div className="py-16 lg:py-24">
          <div className="grid grid-cols-2 md:grid-cols-6 gap-12 lg:gap-8">
            {/* Brand Column */}
            <div className="col-span-2">
              <a href="#" className="inline-flex items-center gap-2 mb-6">
                <ForgeLogo size={24} />
                <span className="text-xl font-sans font-medium text-white">forge</span>
              </a>

              <p className="text-[#7d97c4] leading-relaxed mb-8 max-w-xs">
                The onchain marketplace for autonomous agents. Built on Arc.
              </p>

              {/* Social Links */}
              <div className="flex gap-6">
                {socialLinks.map((link) => (
                  <a
                    key={link.name}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[#7d97c4] hover:text-white transition-colors flex items-center gap-1 group"
                  >
                    {link.name}
                    <ArrowUpRight className="w-3 h-3 opacity-0 -translate-x-1 group-hover:opacity-100 group-hover:translate-x-0 transition-all" />
                  </a>
                ))}
              </div>
            </div>

            {/* Link Columns */}
            {Object.entries(footerLinks).map(([title, links]) => (
              <div key={title}>
                <h3 className="text-sm font-medium mb-6 text-white">{title}</h3>
                <ul className="space-y-4">
                  {links.map((link) => (
                    <li key={link.name}>
                      <a
                        href={link.href}
                        target={link.href.startsWith('http') ? '_blank' : undefined}
                        rel={link.href.startsWith('http') ? 'noopener noreferrer' : undefined}
                        className="text-sm text-[#7d97c4] hover:text-white transition-colors inline-flex items-center gap-2"
                      >
                        {'indicator' in link && link.indicator && (
                          <span className="w-2 h-2 rounded-full bg-[#10b981]" />
                        )}
                        {link.name}
                      </a>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Bar */}
        <div className="py-8 border-t border-[#1a2540] flex flex-col md:flex-row items-center justify-between gap-4">
          <p className="text-sm text-[#7d97c4]">
            forge — open source. MIT licensed.
          </p>

          <div className="flex items-center gap-4 text-sm text-[#7d97c4]">
            <span className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-[#10b981]" />
              arc testnet · all systems operational
            </span>
          </div>
        </div>
      </div>
    </footer>
  );
}
