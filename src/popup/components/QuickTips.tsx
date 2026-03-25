import { Lightbulb, Sparkles, AlertTriangle } from 'lucide-react';

export interface QuickTip {
    id: string;
    text: string;
    type: 'info' | 'success' | 'warning';
}

interface QuickTipsProps {
    tips: QuickTip[];
}

export function QuickTips({ tips }: QuickTipsProps) {
    const colorMap = {
        info: 'border-warning text-warning',
        success: 'border-success text-success',
        warning: 'border-destructive text-destructive',
    };

    const IconMap = {
        info: Lightbulb,
        success: Sparkles,
        warning: AlertTriangle,
    };

    return (
        <div className="space-y-2">
            {tips.map((tip) => {
                const Icon = IconMap[tip.type];
                return (
                    <div
                        key={tip.id}
                        className={`border-l-4 border-y-2 border-r-2 ${colorMap[tip.type]} bg-background p-3 relative overflow-hidden`}
                    >
                        <div className="relative flex items-start gap-3">
                            <Icon className={`size-4 mt-0.5 flex-shrink-0`} />
                            <p className="text-xs text-foreground font-mono flex-1 leading-relaxed">
                                {tip.text}
                            </p>
                        </div>
                    </div>
                );
            })}
        </div>
    );
}
