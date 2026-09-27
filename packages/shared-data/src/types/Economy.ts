import { z } from "zod";
import { EntityId, PLANET_LEVEL_MAX, PLANET_LEVEL_MIN, ShipType } from "./PrimitiveTypes.js";
import { SHIP_TYPES } from "./ShipTypes.js";

export const Resources = z.object({
    food: z.number().min(0),
    gold: z.number().min(0),
    resources: z.number().min(0)
});
export type Resources = z.infer<typeof Resources>;

export const RESOURCE_KEYS = [
    "food",
    "gold",
    "resources"
] as const satisfies readonly (keyof Resources)[];

export const StructureType = z.enum([
    "farm",
    "mine",
    "trade_hub",
    "shipyard",
    "advanced_shipyard",
    "docks"
]);
export type StructureType = z.infer<typeof StructureType>;

export const BuildItem = z.discriminatedUnion("kind", [
    z.object({ kind: z.literal("structure"), structureType: StructureType }),
    z.object({ kind: z.literal("ship"), shipType: ShipType })
]);
export type BuildItem = z.infer<typeof BuildItem>;

export const QueueEntry = z.object({
    item: BuildItem,
    turnsRemaining: z.number().int().min(0),
    totalTurns: z.number().int().min(1)
});
export type QueueEntry = z.infer<typeof QueueEntry>;

/** Private to the owning side; never part of the shared entity data. */
export const PlanetEconomy = z.object({
    planetId: EntityId,
    level: z.number().int().min(PLANET_LEVEL_MIN).max(PLANET_LEVEL_MAX),
    structures: z.array(StructureType),
    /** First-in, first-out; only the head entry progresses each turn. */
    queue: z.array(QueueEntry)
});
export type PlanetEconomy = z.infer<typeof PlanetEconomy>;

export const EconomyState = z.object({
    stockpile: Resources,
    lastIncome: Resources,
    /** Built ships plus ships still in a build queue. */
    shipCount: z.number().int().min(0),
    shipCap: z.number().int().min(0),
    planets: z.array(PlanetEconomy)
});
export type EconomyState = z.infer<typeof EconomyState>;

export type StructureTypeDefinition = {
    name: string;
    description: string;
    cost: Resources;
    buildTurns: number;
    /** Structures that must already be built (not merely queued) on the same planet. */
    requires: StructureType[];
    /** Per-turn output added to the owner's income. */
    produces?: Partial<Resources>;
    shipCapBonus?: number;
    unlocksShips?: ShipType[];
    /** At most one per planet (built or queued). */
    unique?: boolean;
};

export const STARTING_STOCKPILE: Resources = { food: 1000, gold: 1000, resources: 1000 };
export const HOME_PLANET_LEVEL = 10;
export const PLANET_BASE_INCOME_PER_LEVEL: Resources = { food: 5, gold: 5, resources: 5 };

export const STRUCTURE_TYPES: Record<StructureType, StructureTypeDefinition> = {
    farm: {
        name: "Farm",
        description: "Produces food each turn.",
        cost: { food: 0, gold: 50, resources: 100 },
        buildTurns: 2,
        requires: [],
        produces: { food: 40 }
    },
    mine: {
        name: "Mine",
        description: "Produces resources each turn.",
        cost: { food: 50, gold: 100, resources: 0 },
        buildTurns: 2,
        requires: [],
        produces: { resources: 40 }
    },
    trade_hub: {
        name: "Trade Hub",
        description: "Produces gold each turn.",
        cost: { food: 50, gold: 0, resources: 100 },
        buildTurns: 2,
        requires: [],
        produces: { gold: 40 }
    },
    shipyard: {
        name: "Shipyard",
        description: "Builds Scouts and Colony Ships.",
        cost: { food: 50, gold: 150, resources: 200 },
        buildTurns: 3,
        requires: [],
        unlocksShips: ["scout", "colony_ship"],
        unique: true
    },
    advanced_shipyard: {
        name: "Advanced Shipyard",
        description: "Builds Frigates.",
        cost: { food: 100, gold: 250, resources: 300 },
        buildTurns: 4,
        requires: ["shipyard"],
        unlocksShips: ["frigate"],
        unique: true
    },
    docks: {
        name: "Docks",
        description: "Raises the ship cap by 1.",
        cost: { food: 50, gold: 100, resources: 150 },
        buildTurns: 2,
        requires: ["shipyard"],
        shipCapBonus: 1
    }
};

export function zeroResources(): Resources {
    return { food: 0, gold: 0, resources: 0 };
}

export function addResources(a: Resources, b: Partial<Resources>): Resources {
    return {
        food: a.food + (b.food ?? 0),
        gold: a.gold + (b.gold ?? 0),
        resources: a.resources + (b.resources ?? 0)
    };
}

export function subtractResources(a: Resources, b: Partial<Resources>): Resources {
    return {
        food: a.food - (b.food ?? 0),
        gold: a.gold - (b.gold ?? 0),
        resources: a.resources - (b.resources ?? 0)
    };
}

export function canAfford(stockpile: Resources, cost: Resources): boolean {
    return RESOURCE_KEYS.every((k) => stockpile[k] >= cost[k]);
}

export function buildItemCost(item: BuildItem): Resources {
    return item.kind === "structure"
        ? STRUCTURE_TYPES[item.structureType].cost
        : SHIP_TYPES[item.shipType].cost;
}

export function buildItemTurns(item: BuildItem): number {
    return item.kind === "structure"
        ? STRUCTURE_TYPES[item.structureType].buildTurns
        : SHIP_TYPES[item.shipType].buildTurns;
}

export function buildItemName(item: BuildItem): string {
    return item.kind === "structure"
        ? STRUCTURE_TYPES[item.structureType].name
        : SHIP_TYPES[item.shipType].name;
}

/** Structure slots taken on a planet: built structures plus structures still queued. */
export function slotsUsed(planet: Pick<PlanetEconomy, "structures" | "queue">): number {
    return (
        planet.structures.length + planet.queue.filter((e) => e.item.kind === "structure").length
    );
}

export function countQueuedShips(planets: Pick<PlanetEconomy, "queue">[]): number {
    let count = 0;
    for (const planet of planets) {
        count += planet.queue.filter((e) => e.item.kind === "ship").length;
    }
    return count;
}

/** Ships allowed for a side owning `planets`: `1 + floor(level / 5)` per planet plus structure bonuses. */
export function shipCapFor(planets: Pick<PlanetEconomy, "level" | "structures">[]): number {
    let cap = 0;
    for (const planet of planets) {
        cap += 1 + Math.floor(planet.level / 5);
        for (const s of planet.structures) {
            cap += STRUCTURE_TYPES[s].shipCapBonus ?? 0;
        }
    }
    return cap;
}

/** Per-turn income: base per planet level plus the output of built structures. */
export function incomeFor(planets: Pick<PlanetEconomy, "level" | "structures">[]): Resources {
    let income = zeroResources();
    for (const planet of planets) {
        income = addResources(income, {
            food: PLANET_BASE_INCOME_PER_LEVEL.food * planet.level,
            gold: PLANET_BASE_INCOME_PER_LEVEL.gold * planet.level,
            resources: PLANET_BASE_INCOME_PER_LEVEL.resources * planet.level
        });
        for (const s of planet.structures) {
            income = addResources(income, STRUCTURE_TYPES[s].produces ?? {});
        }
    }
    return income;
}

export type CanBuildResult = { ok: true } | { ok: false; reason: string };

export type BuildContext = {
    stockpile: Resources;
    /** Built ships plus ships already queued on any planet. */
    shipCount: number;
    shipCap: number;
};

export function canBuild(
    economy: BuildContext,
    planet: PlanetEconomy,
    item: BuildItem
): CanBuildResult {
    const built = new Set(planet.structures);
    if (item.kind === "structure") {
        const def = STRUCTURE_TYPES[item.structureType];
        const missing = def.requires.find((s) => !built.has(s));
        if (missing) {
            return { ok: false, reason: `Requires ${STRUCTURE_TYPES[missing].name}` };
        }
        if (def.unique) {
            const queued = planet.queue.some(
                (e) => e.item.kind === "structure" && e.item.structureType === item.structureType
            );
            if (built.has(item.structureType) || queued) {
                return { ok: false, reason: `Only one ${def.name} per planet` };
            }
        }
        if (slotsUsed(planet) >= planet.level) {
            return { ok: false, reason: "No free structure slots" };
        }
    } else {
        const def = SHIP_TYPES[item.shipType];
        const missing = def.requires.find((s) => !built.has(s));
        if (missing) {
            return { ok: false, reason: `Requires ${STRUCTURE_TYPES[missing].name}` };
        }
        if (economy.shipCount >= economy.shipCap) {
            return { ok: false, reason: "Ship cap reached" };
        }
    }
    if (!canAfford(economy.stockpile, buildItemCost(item))) {
        return { ok: false, reason: "Not enough resources" };
    }
    return { ok: true };
}
