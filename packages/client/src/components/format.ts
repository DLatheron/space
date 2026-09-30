import { RESOURCE_KEYS, type ResourceKey, type Resources } from "@space/shared-data";

const numberFormat = new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 });

export const RESOURCE_LABELS: Record<ResourceKey, string> = {
    money: "Money",
    materials: "Materials",
    population: "Population",
    science: "Science"
};

export const RESOURCE_SHORT_LABELS: Record<ResourceKey, string> = {
    money: "Money",
    materials: "Mat",
    population: "Pop",
    science: "Sci"
};

export function formatNumber(value: number): string {
    return numberFormat.format(value);
}

/** Signed amount such as "+1,200" or "−40". */
export function formatDelta(amount: number): string {
    return `${amount < 0 ? "−" : "+"}${formatNumber(Math.abs(amount))}`;
}

/** Non-zero amounts such as "40 Money, 10 Pop"; `empty` when everything is zero. */
export function formatResources(resources: Resources, empty = "nothing"): string {
    const parts = RESOURCE_KEYS.filter((key) => resources[key] > 0).map(
        (key) => `${formatNumber(resources[key])} ${RESOURCE_SHORT_LABELS[key]}`
    );
    return parts.length ? parts.join(", ") : empty;
}
