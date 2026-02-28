
import { Shield, AlertTriangle, AlertCircle } from 'lucide-react';

type RiskLevel = 'safe' | 'warning' | 'danger';

export interface RiskIndicatorProps {
    level?: RiskLevel;
}

export function RiskIndicator({ level = 'safe' }: RiskIndicatorProps) {
    const configs = {
        safe: {
            icon: Shield,
            label: 'Low Risk',
            message: "You're browsing safely",
            color: 'text-success', // Assuming you'll add text-success to tailwind.config
            borderColor: 'border-success',
        },
        warning: {
            icon: AlertTriangle,
            label: 'Caution',
            message: "Double-check before sharing info here",
            color: 'text-warning',
            borderColor: 'border-warning',
        },
        danger: {
            icon: AlertCircle,
            label: 'High Risk',
            message: "This site might not be trustworthy",
            color: 'text-destructive',
            borderColor: 'border-destructive',
        },
    };

    const config = configs[level];
    const Icon = config.icon;

    return (
        <div className="p-4 border-2 border-border bg-background flex flex-col gap-2">
            <h2 className="text-xs text-muted-foreground uppercase font-mono tracking-widest font-bold">
                RISK STATUS
            </h2>

            <div className="flex items-center gap-4">
                <div className={`size-12 border-2 ${config.borderColor} flex items-center justify-center bg-background`}>
                    <Icon className={`${config.color} size-6`} />
                </div>

                <div className="flex flex-col">
                    <span className={`${config.color} font-bold text-base font-['Syne']`}>
                        {config.label}
                    </span>
                    <span className="text-muted-foreground text-sm font-mono mt-0.5">
                        {config.message}
                    </span>
                </div>
            </div>
        </div>
    );
}