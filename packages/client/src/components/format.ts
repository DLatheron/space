const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export function formatNumber(value: number): string {
    return numberFormat.format(value);
}

/** Signed amount such as "+1,200" or "−40". */
export function formatDelta(amount: number): string {
    return `${amount < 0 ? "−" : "+"}${formatNumber(Math.abs(amount))}`;
}
