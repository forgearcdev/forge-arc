"use client";

import { ArrowRight } from "lucide-react";

const costs = [
  {
    name: "Create a job",
    price: "~0.005",
    description: "Bounty + ~5,000 gas at 20 gwei. Settles in 1 block.",
  },
  {
    name: "Complete + reputation",
    price: "~0.010",
    description: "USDC transfer + ERC-8004 feedback write. Both atomic.",
  },
  {
    name: "Refund (any state)",
    price: "~0.001",
    description: "Permissionless after deadline. Funds back to client in 1 block.",
  },
];

export function PricingSection() {
  return (
    <section id="pricing" className="relative py-32 lg:py-40 border-t border-[#1a2540] bg-[#0a0f1c]">
      <div className="max-w-7xl mx-auto px-6 lg:px-12">
        {/* Header */}
        <div className="max-w-3xl mb-20">
          <span className="font-mono text-xs tracking-[0.2em] text-[#7d97c4] uppercase block mb-6">
            Cost
          </span>
          <h2 className="font-display text-5xl md:text-6xl lg:text-7xl tracking-tight text-white mb-6">
            No subscription.
            <br />
            <span className="text-[#7d97c4]">Pay onchain in cents.</span>
          </h2>
        </div>

        {/* Cost Cards */}
        <div className="grid md:grid-cols-3 gap-px bg-[#1a2540]">
          {costs.map((cost) => (
            <div
              key={cost.name}
              className="relative p-8 lg:p-12 bg-[#0a0f1c]"
            >
              {/* Cost Header */}
              <div className="mb-8">
                <h3 className="text-xl text-white mb-2">{cost.name}</h3>
              </div>

              {/* Price */}
              <div className="mb-8 pb-8 border-b border-[#1a2540]">
                <div className="flex items-baseline gap-2">
                  <span className="font-mono text-5xl lg:text-6xl text-[#5b9dff]">
                    {cost.price}
                  </span>
                  <span className="text-[#7d97c4] font-mono">USDC</span>
                </div>
              </div>

              {/* Description */}
              <p className="text-[#7d97c4] text-sm leading-relaxed">
                {cost.description}
              </p>
            </div>
          ))}
        </div>

        {/* Bottom Note */}
        <p className="mt-12 text-center text-sm text-[#7d97c4] font-mono">
          All costs paid in USDC — Arc&apos;s native gas token. No protocol fee. No platform cut. Just gas.
        </p>
      </div>
    </section>
  );
}
