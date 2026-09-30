import { z } from "zod";

export const Resources = z.object({
    money: z.number().min(0),
    materials: z.number().min(0),
    population: z.number().min(0),
    science: z.number().min(0)
});
export type Resources = z.infer<typeof Resources>;

export const RESOURCE_KEYS = [
    "money",
    "materials",
    "population",
    "science"
] as const satisfies readonly (keyof Resources)[];
export type ResourceKey = (typeof RESOURCE_KEYS)[number];

export function zeroResources(): Resources {
    return { money: 0, materials: 0, population: 0, science: 0 };
}

export function addResources(a: Resources, b: Partial<Resources>): Resources {
    return {
        money: a.money + (b.money ?? 0),
        materials: a.materials + (b.materials ?? 0),
        population: a.population + (b.population ?? 0),
        science: a.science + (b.science ?? 0)
    };
}

export function subtractResources(a: Resources, b: Partial<Resources>): Resources {
    return {
        money: a.money - (b.money ?? 0),
        materials: a.materials - (b.materials ?? 0),
        population: a.population - (b.population ?? 0),
        science: a.science - (b.science ?? 0)
    };
}

/** Per-resource `max(0, a - b)`. */
export function subtractClamped(a: Resources, b: Partial<Resources>): Resources {
    return mapResources((k) => Math.max(0, a[k] - (b[k] ?? 0)));
}

export function minResources(a: Resources, b: Resources): Resources {
    return mapResources((k) => Math.min(a[k], b[k]));
}

export function sumResources(list: readonly Partial<Resources>[]): Resources {
    return list.reduce<Resources>((acc, r) => addResources(acc, r), zeroResources());
}

export function scaleResources(r: Resources, factor: number): Resources {
    return mapResources((k) => Math.floor(r[k] * factor));
}

export function mapResources(fn: (key: ResourceKey) => number): Resources {
    return {
        money: fn("money"),
        materials: fn("materials"),
        population: fn("population"),
        science: fn("science")
    };
}

/** Sum of every resource; supply ship capacity counts all types together. */
export function resourceUnits(r: Resources): number {
    return r.money + r.materials + r.population + r.science;
}

export function isZeroResources(r: Resources): boolean {
    return RESOURCE_KEYS.every((k) => r[k] === 0);
}

export function canAfford(stockpile: Resources, cost: Resources): boolean {
    return RESOURCE_KEYS.every((k) => stockpile[k] >= cost[k]);
}
