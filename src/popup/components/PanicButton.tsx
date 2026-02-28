interface PanicButtonProps {
    onClick: () => void;
}

export function PanicButton({ onClick }: PanicButtonProps) {
    return (
        <div className="w-full">
            <button
                onClick={onClick}
                className="w-full border-4 border-border bg-destructive hover:bg-destructive/90 transition-colors p-4 font-['Syne'] font-bold text-lg text-white"
            >
                I Think I Messed Up
            </button>
        </div>
    );
}