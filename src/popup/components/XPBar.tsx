// XPBar.tsx — Fixed version
// Shows XP progress WITHIN the current level (resets to 0 on level up)

export interface XPProgressBarProps {
  currentXP: number;  // XP earned within this level (from xpProgressInLevel)
  maxXP: number;      // XP needed to complete this level
  level: number;
  levelTitle?: string;
}

export function XPProgressBar({ currentXP, maxXP, level, levelTitle }: XPProgressBarProps) {
  const safeMax = maxXP > 0 ? maxXP : 1;
  const percentage = Math.min(100, (currentXP / safeMax) * 100);

  return (
    <div className="space-y-4 border-2 border-border bg-background p-4 relative overflow-hidden">
      <div className="relative flex items-center justify-between uppercase font-bold text-xs">
        <span className="text-muted-foreground tracking-widest font-mono">
          DIGITAL HYGIENE XP
        </span>
        <span className="text-foreground font-['Syne'] tracking-wider">
          Level {level}
        </span>
      </div>
      {/* Progress bar */}
      <div className="relative h-8 bg-background border-2 border-border flex items-center">
        <div
          className="h-full border-r-2 border-border transition-all duration-500"
          style={{
            width: `${percentage}%`,
            backgroundColor: 'hsl(var(--primary))',
            backgroundImage: 'repeating-linear-gradient(-45deg, rgba(0,0,0,0.1), rgba(0,0,0,0.1) 6px, transparent 6px, transparent 12px)'
          }}
        />
      </div>
      <div className="relative flex items-end justify-between text-xs font-mono font-bold">
        <p className="text-muted-foreground">
          <span className="text-foreground">{currentXP}</span> / {maxXP} XP
        </p>
        <p className="text-foreground tracking-wide">
          {levelTitle ?? `Level ${level}`}
        </p>
      </div>
    </div>
  );
}