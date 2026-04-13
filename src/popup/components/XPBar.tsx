// XPBar.tsx — Shows XP progress within the current level

interface XPBarProps {
  currentXP: number;   // XP earned within this level (0..100)
  maxXP: number;       // Always 100
  level: number;
  levelTitle?: string;
}

export function XPProgressBar({ currentXP, maxXP, level, levelTitle }: XPBarProps) {
  const pct = Math.min(100, Math.max(0, (currentXP / Math.max(1, maxXP)) * 100));

  return (
    <div className="border-2 border-border bg-background p-4 space-y-3">
      <div className="flex items-center justify-between text-xs font-bold uppercase">
        <span className="text-muted-foreground tracking-widest font-mono">DIGITAL HYGIENE XP</span>
        <span className="text-foreground font-['Syne'] tracking-wider">Level {level}</span>
      </div>

      {/* Progress bar */}
      <div className="relative h-8 bg-muted border-2 border-border overflow-hidden">
        <div
          className="h-full border-r-2 border-border transition-all duration-500"
          style={{
            width: `${pct}%`,
            backgroundColor: "hsl(var(--primary))",
            backgroundImage: "repeating-linear-gradient(-45deg, rgba(0,0,0,0.08), rgba(0,0,0,0.08) 6px, transparent 6px, transparent 12px)",
          }}
        />
      </div>

      <div className="flex items-end justify-between text-xs font-mono font-bold">
        <p className="text-muted-foreground">
          <span className="text-foreground">{currentXP}</span> / {maxXP} XP
        </p>
        <p className="text-foreground tracking-wide">{levelTitle ?? `Level ${level}`}</p>
      </div>
    </div>
  );
}