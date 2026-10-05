import type {
    BuildItem,
    GroundUnitType,
    ShipType,
    SpaceStructureType,
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
    warehouse: "installations/warehouse.webp",
    defensive_battery: "installations/defensive-turrets.jpg",
    shield_generator: "installations/shield-generator.avif",
    orbital_platform: "installations/orbital-platform.jpg"
};

const SHIP_IMAGES: Partial<Record<ShipType, string>> = {
    scout: "ships/scout-ship.jpg",
    frigate: "ships/frigate.jpeg",
    colony_ship: "ships/colony-ship.webp",
    transport: "ships/transport-ship.webp",
    fighter_squadron: "ships/fighter-squadron.webp",
    advanced_fighter_squadron: "ships/advanced-fighter-squadron.webp",
    bomber_squadron: "ships/tie-bomber.avif",
    star_destroyer: "ships/star-destroyer.jpeg",
    super_star_destroyer: "ships/super-star-destroyer.webp",
    builder: "ships/builder.webp"
};

const SPACE_STRUCTURE_IMAGES: Partial<Record<SpaceStructureType, string>> = {
    sensor_array: "space-structures/sensor-array.jpg",
    space_station: "space-structures/space-station.jpg",
    missile_battery: "space-structures/missile-battery.jpg",
    space_dock: "space-structures/space-dock.jpg",
    stargate: "space-structures/stargate.jpg"
};

const GROUND_UNIT_IMAGES: Partial<Record<GroundUnitType, string>> = {
    infantry: "ships/infantry.jpg",
    armour: "ships/armour.jpg"
};

const SUPPLY_SHIP_IMAGE = "ships/cargo-ship.webp";

/** Techs without a picture show the Thumbnail initials badge. */
const TECH_IMAGES: Partial<Record<TechId, string>> = {
    supply_speed_1: "research/improved-drives.jpg",
    supply_speed_2: "research/advanced-drives.png",
    supply_capacity_1: "research/expanded-holds.jpg",
    supply_capacity_2: "research/bulk-freighters.jpg",
    ground_forces: "research/ground-forces.jpg",
    advanced_shipyard: "research/advanced-shipbuilding.jpg",
    transports: "research/troop-transports.webp",
    enhancement_tier_2: "research/refits.jpg",
    enhancement_tier_3: "research/advanced-refits.jpg",
    hyperdrive_calibration_1: "research/hyperdrive-calibration-i.jpg",
    hyperdrive_calibration_2: "research/hyperdrive-calibration-ii.avif",
    evasive_manoeuvres_1: "research/evasive-manoeuvres-i.jpg",
    evasive_manoeuvres_2: "research/evasive-manoeuvres-ii.jpg",
    armoured_freighters: "research/armoured-freighters.jpg",
    damage_control_1: "research/damage-control-i.webp",
    damage_control_2: "research/damage-control-ii.webp",
    capital_ship_engineering: "research/captital-ship-engineering.webp",
    space_construction: "research/space-construction.webp",
    sensor_arrays_2: "research/deep-space-sensors.webp",
    sensor_arrays_3: "research/long-range-sensors.webp",
    space_stations_1: "research/space-stations.webp",
    space_stations_2: "research/fortified-stations.webp",
    space_stations_3: "research/battle-stations.webp",
    missile_batteries: "research/missile-batteries.webp",
    stargates: "research/stargates.webp"
};

export type ImageSubject =
    | { kind: "structure"; structureType: StructureType }
    | { kind: "ship"; shipType: ShipType }
    | { kind: "groundUnit"; unitType: GroundUnitType }
    | { kind: "spaceStructure"; structureType: SpaceStructureType }
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
        case "spaceStructure":
            return url(SPACE_STRUCTURE_IMAGES[subject.structureType]);
        case "supplyShip":
            return url(SUPPLY_SHIP_IMAGE);
    }
}

export function techImage(techId: TechId): string | undefined {
    return url(TECH_IMAGES[techId]);
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
        case "spaceStructure":
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
                case "spaceStructure":
                    return imageUrl({
                        kind: "spaceStructure",
                        structureType: target.structureType
                    });
            }
        }
    }
}
