import { useEffect, useState } from 'react';
import { Shield, AlertTriangle, AlertCircle } from 'lucide-react';

type RiskLevel = 'safe' | 'warning' | 'danger';

interface MLRiskResult {
    level: RiskLevel;
    mlScore: number | null;
    modelVersion: string | null;
}

export interface RiskIndicatorProps {
    level?: RiskLevel;
}

export function RiskIndicator({ level = 'safe' }: RiskIndicatorProps) {
    const [riskLevel, setRiskLevel] = useState<RiskLevel>(level);
    const [mlScore, setMlScore] = useState<number | null>(null);

    useEffect(() => {
        const handleMessage = (message: Record<string, unknown>) => {
            if (message.type === 'mlRiskResult') {
                const result = message as unknown as MLRiskResult;
                // If heuristic says danger, always show danger regardless of ML score
                if (result.level === 'danger') {
                    setRiskLevel('danger');
                } else if (result.mlScore !== null && result.mlScore > 0.75) {
                    // High ML confidence for phishing → upgrade to danger
                    setRiskLevel('danger');
                } else if (result.level === 'warning' || (result.mlScore !== null && result.mlScore > 0.4)) {
                    setRiskLevel('warning');
                } else {
                    setRiskLevel('safe');
                }
                setMlScore(result.mlScore);
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);

        // Fetch current risk state on mount
        chrome.runtime.sendMessage({ type: 'getRiskLevel' }).then((response) => {
            if (response?.level) {
                setRiskLevel(response.level);
            }
        }).catch(() => {});

        return () => {
            chrome.runtime.onMessage.removeListener(handleMessage);
        };
    }, []);

    const configs = {
        safe: {
            icon: Shield,
            label: 'Low Risk',
            message: "You're browsing safely",
            color: 'text-success',
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
            message: "This site looks dangerous!",
            color: 'text-destructive',
            borderColor: 'border-destructive',
        },
    };

    const config = configs[riskLevel];
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
                    {mlScore !== null && (
                        <span className="text-xs text-muted-foreground mt-0.5 font-mono">
                            ML confidence: {(mlScore * 100).toFixed(1)}%
                        </span>
                    )}
                </div>
            </div>
        </div>
    );
}
