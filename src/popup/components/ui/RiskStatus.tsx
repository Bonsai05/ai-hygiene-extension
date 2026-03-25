import { useEffect, useState } from 'react';
import { Shield, AlertTriangle, AlertCircle } from 'lucide-react';

type RiskLevel = 'safe' | 'warning' | 'danger';

interface MLRiskResult {
    level: RiskLevel;
    mlScore: number | null;
    modelVersion: string | null;
}

export function RiskStatus() {
    const [riskLevel, setRiskLevel] = useState<RiskLevel>('safe');
    const [riskMessage, setRiskMessage] = useState<string>("You're browsing safely");
    const [mlScore, setMlScore] = useState<number | null>(null);

    useEffect(() => {
        const handleMessage = (message: Record<string, unknown>) => {
            if (message.type === 'mlRiskResult') {
                const result = message as unknown as MLRiskResult;
                const score = result.mlScore ?? 0;

                if (result.level === 'danger' || score >= 0.7) {
                    setRiskLevel('danger');
                    setRiskMessage("This site looks dangerous!");
                } else if (score < 0.3) {
                    setRiskLevel('safe');
                    setRiskMessage("You're browsing safely");
                } else {
                    setRiskLevel('warning');
                    setRiskMessage("Double-check before sharing info here");
                }
                setMlScore(score);
            }
        };

        chrome.runtime.onMessage.addListener(handleMessage);

        // Fetch current risk state on mount
        chrome.runtime.sendMessage({ type: 'getRiskLevel' }).then((response) => {
            if (response?.level) {
                setRiskLevel(response.level);
                if (response.level === 'danger') {
                    setRiskMessage("This site looks dangerous!");
                } else if (response.level === 'warning') {
                    setRiskMessage("Double-check before sharing info here");
                } else {
                    setRiskMessage("You're browsing safely");
                }
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
            color: 'text-success',
            borderColor: 'border-success',
            bgColor: 'bg-success/10',
        },
        warning: {
            icon: AlertTriangle,
            label: 'Caution',
            color: 'text-warning',
            borderColor: 'border-warning',
            bgColor: 'bg-warning/10',
        },
        danger: {
            icon: AlertCircle,
            label: 'High Risk',
            color: 'text-destructive',
            borderColor: 'border-destructive',
            bgColor: 'bg-destructive/10',
        },
    };

    const config = configs[riskLevel];
    const Icon = config.icon;

    return (
        <div className={`p-4 border-2 ${config.borderColor} ${config.bgColor} flex flex-col gap-2`}>
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
                        {riskMessage}
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
