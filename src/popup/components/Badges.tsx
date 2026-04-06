// src/popup/components/Badges.tsx — Phase 2A
// Changes:
//   1. Renders tier indicator (coloured dot: bronze/silver/gold) on earned badges
//   2. Badge type updated to match new storage.ts (tier + category fields)
//   3. Tooltip shows tier and category in addition to description
//   4. Unearnerd badges show lock overlay instead of just opacity (STILL ONLY OPAQUE)

import { Shield, Lock, Eye, Zap, Award, LockKeyhole, CheckCircle, AlertCircle } from "lucide-react";
import type { BadgeTier, BadgeCategory } from "../../lib/storage";

export interface Badge {
  id: string;
  name: string;
  icon: "shield" | "lock" | "eye" | "key" | "zap" | "award" | "check" | "alert";
  earned: boolean;
  description: string;
  tier: BadgeTier;
  category: BadgeCategory;
  earnedAt?: number;
}

interface BadgeGridProps {
  badges: Badge[];
}

const iconMap = {
  shield: Shield,
  lock: Lock,
  eye: Eye,
  key: LockKeyhole,
  zap: Zap,
  award: Award,
  check: CheckCircle,
  alert: AlertCircle,
};

const tierColors: Record<BadgeTier, string> = {
  bronze: "#cd7f32",
  silver: "#9ca3af",
  gold:   "#eab308",
};

const categoryLabels: Record<BadgeCategory, string> = {
  streak:   "Streak",
  threat:   "Threat",
  recovery: "Recovery",
  habit:    "Habit",
};

export function BadgeGrid({ badges }: BadgeGridProps) {
  const earned = badges.filter(b => b.earned);
  const unearned = badges.filter(b => !b.earned);

  return (
    <div className="space-y-4 border-2 border-border bg-background p-4 relative">
      <div className="flex items-center justify-between">
        <h3 className="text-xs text-muted-foreground uppercase font-mono font-bold tracking-widest">
          YOUR BADGES
        </h3>
        <span className="text-xs font-mono text-muted-foreground">
          {earned.length}/{badges.length}
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3">
        {/* Earned badges first */}
        {earned.map((badge) => (
          <BadgeCell key={badge.id} badge={badge} />
        ))}
        {/* Unearned badges after */}
        {unearned.map((badge) => (
          <BadgeCell key={badge.id} badge={badge} />
        ))}
      </div>
    </div>
  );
}

function BadgeCell({ badge }: { badge: Badge }) {
  const Icon = iconMap[badge.icon];
  const tierColor = tierColors[badge.tier];

  return (
    <div className="relative group cursor-pointer" title={`${badge.name} (${badge.tier} ${categoryLabels[badge.category]})\n${badge.description}`}>
      <div className={`flex flex-col items-center justify-center p-4 border-2 transition-all relative overflow-hidden bg-background h-24
        ${badge.earned ? "border-border" : "border-border opacity-40"}`}
      >
        <Icon className={`size-6 mb-2 relative z-10 ${badge.earned ? "text-foreground" : "text-muted-foreground"}`} />
        <span className={`text-[10px] text-center tracking-wide font-bold font-mono relative z-10 leading-tight
          ${badge.earned ? "text-foreground" : "text-muted-foreground"}`}>
          {badge.name}
        </span>

        {/* Tier colour dot — shown on earned badges only */}
        {badge.earned && (
          <div
            className="absolute top-1.5 right-1.5 size-2.5 rounded-full"
            style={{ backgroundColor: tierColor }}
            title={badge.tier}
          />
        )}

        {/* Lock icon on unearned */}
        {!badge.earned && (
          <div className="absolute inset-0 flex items-end justify-center pb-1.5 opacity-30 pointer-events-none">
            <Lock className="size-3 text-muted-foreground" />
          </div>
        )}

        {/* Hover tooltip */}
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-background border-2 border-border
          text-[10px] text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity
          pointer-events-none z-30 font-mono shadow-md max-w-[160px] text-wrap text-center">
          <p className="font-bold mb-0.5">{badge.name}</p>
          <p className="opacity-70 capitalize">{badge.tier} · {categoryLabels[badge.category]}</p>
          <p className="mt-1 opacity-80 whitespace-normal">{badge.description}</p>
        </div>
      </div>
    </div>
  );
}