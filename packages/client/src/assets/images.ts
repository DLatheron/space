import type {
    BuildItem,
    GroundUnitType,
    ShipType,
    StructureType,
    TechId
} from "@space/shared-data";

/** Served by the game server from `packages/server/public` (proxied by Vite in development). */
const PUBLIC_BASE = "/public";

/** Types without an entry (or whose file fails to load) get an initials badge (see `Thumbnail`). */
const STRUCTURE_IMAGES: Partial<Record<StructureType, string>> = {
    habitat: "installations/habitat.jpg",
    mine: "installations/mine.webp",
    trade_hub: "installations/trade-hub.jpg",
    shipyard: "installations/starship-construction-yard.jpg",
    advanced_shipyard: "installations/adv-starship-construction-yard.jpg",
    docks: "installations/docks.jpg",
    science_academy: "installations/science-academy.jpg",
    barracks: "installations/barracks.webp",
    vault: "installations/vault.jpg",
    depot: "installations/depot.jpg",
    archive: "installations/archive.jpg",
    quarters: "installations/quarters.webp",
    warehouse: "installations/warehouse.webp"
};

const SHIP_IMAGES: Partial<Record<ShipType, string>> = {
    scout: "ships/scout-ship.jpg",
    frigate: "ships/frigate.jpeg",
    colony_ship: "ships/colony-ship.webp",
    transport: "ships/transport-ship.webp",
    fighter_squadron: "ships/fighter-squadron.webp",
    advanced_fighter_squadron: "ships/advanced-fighter-squadron.webp",
    star_destroyer: "ships/star-destroyer.jpeg"
};

const GROUND_UNIT_IMAGES: Partial<Record<GroundUnitType, string>> = {
    infantry: "ships/infantry.jpg",
    armour: "ships/armour.jpg"
};

const SUPPLY_SHIP_IMAGE = "ships/cargo-ship.webp";

/** Every tech has a picture, so a new tech must be given one here. */
const TECH_IMAGES: Record<TechId, string> = {
    supply_speed_1: "research/improved-drives.jpg",
    supply_speed_2: "research/advanced-drives.png",
    supply_capacity_1: "research/expanded-holds.jpg",
    supply_capacity_2: "research/bulk-freighters.jpg",
    ground_forces: "research/ground-forces.jpg",
    advanced_shipyard: "research/advanced-shipbuilding.jpg",
    transports: "research/troop-transports.webp",
    enhancement_tier_2: "research/refits.jpg",
    enhancement_tier_3: "research/advanced-refits.jpg"
};

export type ImageSubject =
    | { kind: "structure"; structureType: StructureType }
    | { kind: "ship"; shipType: ShipType }
    | { kind: "groundUnit"; unitType: GroundUnitType }
    | { kind: "supplyShip" };

function url(path: string | undefined): string | undefined {
    return path ? `${PUBLIC_BASE}/${path}` : undefined;
}

export function imageUrl(subject: ImageSubject): string | undefined {
    switch (subject.kind) {
        case "structure":
            return url(STRUCTURE_IMAGES[subject.structureType]);
        case "ship":
            return url(SHIP_IMAGES[subject.shipType]);
        case "groundUnit":
            return url(GROUND_UNIT_IMAGES[subject.unitType]);
        case "supplyShip":
            return url(SUPPLY_SHIP_IMAGE);
    }
}

export function techImage(techId: TechId): string {
    return `${PUBLIC_BASE}/${TECH_IMAGES[techId]}`;
}

/** Picture for a build option or order; upgrades show their target. */
export function buildItemImage(item: BuildItem): string | undefined {
    switch (item.kind) {
        case "structure":
            return imageUrl(item);
        case "ship":
            return imageUrl(item);
        case "groundUnit":
            return imageUrl(item);
        case "research":
            return techImage(item.techId);
        case "enhancement": {
            const target = item.target;
            switch (target.kind) {
                case "installation":
                    return imageUrl({ kind: "structure", structureType: target.structureType });
                case "ship":
                    return imageUrl({ kind: "ship", shipType: target.shipType });
                case "groundUnit":
                    return imageUrl({ kind: "groundUnit", unitType: target.unitType });
            }
        }
    }
}
