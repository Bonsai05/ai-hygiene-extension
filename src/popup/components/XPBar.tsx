export interface XPProgressBarProps {
    currentXP: number;
    maxXP: number;
    level: number;
}

export function XPProgressBar({ currentXP, maxXP, level }: XPProgressBarProps) {
    const percentage = (currentXP / maxXP) * 100;

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

            {/* Custom progress bar box */}
            <div className="relative h-8 bg-background border-2 border-border flex items-center">
                <div
                    className="h-full border-r-2 border-border"
                    style={{
                        width: `${percentage}%`,
                        backgroundColor: '#3a3a3a',
                        backgroundImage: 'repeating-linear-gradient(-45deg, rgba(0,0,0,0.1), rgba(0,0,0,0.1) 6px, transparent 6px, transparent 12px)'
                    }}
                />
            </div>

            <div className="relative flex items-end justify-between text-xs font-mono font-bold">
                <p className="text-muted-foreground">
                    <span className="text-foreground">{currentXP}</span> / {maxXP} XP
                </p>
                <p className="text-foreground tracking-wide">
                    Safe Surfer
                </p>
            </div>
        </div>
    );
}