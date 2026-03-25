import { Shield, Lock, Eye, Zap, Award, LockKeyhole, CheckCircle, AlertCircle } from 'lucide-react';

export interface Badge {
    id: string;
    name: string;
    icon: 'shield' | 'lock' | 'eye' | 'key' | 'zap' | 'award' | 'check' | 'alert';
    earned: boolean;
    description: string;
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

export function BadgeGrid({ badges }: BadgeGridProps) {
    return (
        <div className="space-y-4 border-2 border-border bg-background p-4 relative">
            <h3 className="text-xs text-muted-foreground uppercase font-mono font-bold tracking-widest">
                YOUR BADGES
            </h3>

            <div className="grid grid-cols-3 gap-3">
                {badges.map((badge) => {
                    const Icon = iconMap[badge.icon];
                    return (
                        <div
                            key={badge.id}
                            className="relative group cursor-pointer"
                            title={badge.description}
                        >
                            <div
                                className={`flex flex-col items-center justify-center p-4 border-2 transition-all relative overflow-hidden bg-background h-24 ${badge.earned ? 'border-border' : 'border-border opacity-40'
                                    }`}
                            >
                                <Icon
                                    className={`size-6 mb-2 relative z-10 ${badge.earned ? 'text-foreground' : 'text-muted-foreground'
                                        }`}
                                />
                                <span
                                    className={`text-[10px] text-center tracking-wide font-bold font-mono relative z-10 leading-tight ${badge.earned ? 'text-foreground' : 'text-muted-foreground'
                                        }`}
                                >
                                    {badge.name}
                                </span>

                                {/* Earned indicator (black square block) */}
                                {badge.earned && (
                                    <div className="absolute top-0 right-0 size-3 bg-border" />
                                )}

                                {/* Hover tooltip */}
                                <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 px-3 py-2 bg-background border-2 border-border text-[10px] text-foreground whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-30 font-mono shadow-md">
                                    {badge.description}
                                </div>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
}