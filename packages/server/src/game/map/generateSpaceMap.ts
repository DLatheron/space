import {
    axialDirectionTowards,
    axialDistance,
    axialNeighbor,
    axialRange,
    createSeededRng,
    type Axial
} from "@space/maths";
import {
    HOME_PLANET_LEVEL,
    PLANET_LEVEL_MAX,
    PLANET_LEVEL_MIN,
    SHIP_TYPES,
    type EntityId,
    type ShipType,
    type SideId,
    type SystemId
} from "@space/shared-data";
import { EntityManager } from "../EntityManager.js";
import { createEmptyMap, findTileByAxial, type SpaceMap } from "./SpaceMap.js";
import type { EntityOf, MapTile } from "./types.js";

export { findTileByAxial, forEachTile, tileKey, type SpaceMap } from "./SpaceMap.js";

const SYSTEM_NAMES = [
    "Sol",
    "Vega",
    "Altair",
    "Rigel",
    "Deneb",
    "Sirius",
    "Procyon",
    "Antares",
    "Castor",
    "Pollux",
    "Arcturus",
    "Capella",
    "Mira",
    "Spica",
    "Bellatrix",
    "Achernar"
];

const STARTING_SHIP_TYPES: readonly ShipType[] = ["scout", "frigate"];

/** Hexes kept clear of system centres along the map edge. */
const EDGE_MARGIN = 5;
const SYSTEM_RADIUS = 5;

export type StarSystem = {
    id: SystemId;
    name: string;
    center: Axial;
    homeSideId: SideId | null;
};

export type GeneratedGalaxy = {
    map: SpaceMap;
    entities: EntityManager;
    systems: StarSystem[];
    /** Each side's home planet, which starts with `STARTING_STOCKPILE`. */
    homePlanets: Partial<Record<SideId, EntityId>>;
};

type GenContext = {
    rng: () => number;
    map: SpaceMap;
    entities: EntityManager;
    newId: (kind: string) => EntityId;
};

function randInt(rng: () => number, min: number, max: number): number {
    return min + Math.floor(rng() * (max - min + 1));
}

function shuffled<T>(rng: () => number, items: readonly T[]): T[] {
    const result = items.slice();
    for (let i = result.length - 1; i > 0; i--) {
        const j = Math.floor(rng() * (i + 1));
        [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
}

/** Hexes exactly `radius` away from `center`. */
function ring(center: Axial, radius: number): Axial[] {
    return axialRange(center, radius).filter((hex) => axialDistance(center, hex) === radius);
}

function emptyTileAt(ctx: GenContext, hex: Axial): MapTile | undefined {
    const tile = findTileByAxial(ctx.map, hex.q, hex.r);
    return tile && tile.entityIds.length === 0 ? tile : undefined;
}

/** First empty on-map tile from a shuffled candidate list. */
function pickEmptyFrom(ctx: GenContext, candidates: Axial[]): MapTile | undefined {
    for (const hex of shuffled(ctx.rng, candidates)) {
        const tile = emptyTileAt(ctx, hex);
        if (tile) return tile;
    }
    return undefined;
}

function pickEmptyAnywhere(
    ctx: GenContext,
    predicate: (tile: MapTile) => boolean
): MapTile | undefined {
    for (let attempt = 0; attempt < 400; attempt++) {
        const tile =
            ctx.map.tiles[Math.floor(ctx.rng() * ctx.map.width)][
                Math.floor(ctx.rng() * ctx.map.height)
            ];
        if (tile.entityIds.length === 0 && predicate(tile)) return tile;
    }
    return undefined;
}

function placeSystemCentres(ctx: GenContext, count: number): Axial[] {
    const { map, rng } = ctx;
    const centres: Axial[] = [];
    let minSpacing = 12;
    for (let attempt = 0; centres.length < count && attempt < 2000; attempt++) {
        if (attempt > 0 && attempt % 400 === 0) minSpacing -= 1;
        const col = randInt(rng, EDGE_MARGIN, map.width - 1 - EDGE_MARGIN);
        const row = randInt(rng, EDGE_MARGIN, map.height - 1 - EDGE_MARGIN);
        const tile = map.tiles[col][row];
        const hex = { q: tile.q, r: tile.r };
        if (centres.every((other) => axialDistance(other, hex) >= minSpacing)) {
            centres.push(hex);
        }
    }
    return centres;
}

/** Pick one home system per side, maximising spread between them. */
function chooseHomeSystems(systems: StarSystem[], sideIds: SideId[]): void {
    if (systems.length === 0 || sideIds.length === 0) return;
    const chosen: StarSystem[] = [];

    if (sideIds.length >= 2 && systems.length >= 2) {
        let best: [StarSystem, StarSystem] = [systems[0], systems[1]];
        let bestDistance = -1;
        for (let i = 0; i < systems.length; i++) {
            for (let j = i + 1; j < systems.length; j++) {
                const d = axialDistance(systems[i].center, systems[j].center);
                if (d > bestDistance) {
                    bestDistance = d;
                    best = [systems[i], systems[j]];
                }
            }
        }
        chosen.push(...best);
    } else {
        chosen.push(systems[0]);
    }

    while (chosen.length < sideIds.length && chosen.length < systems.length) {
        let farthest = systems.find((s) => !chosen.includes(s))!;
        let farthestDistance = -1;
        for (const system of systems) {
            if (chosen.includes(system)) continue;
            const d = Math.min(...chosen.map((c) => axialDistance(c.center, system.center)));
            if (d > farthestDistance) {
                farthestDistance = d;
                farthest = system;
            }
        }
        chosen.push(farthest);
    }

    chosen.forEach((system, index) => {
        system.homeSideId = sideIds[index] ?? null;
    });
}

function populateSystem(ctx: GenContext, system: StarSystem): EntityOf<"planet">[] {
    const { rng, entities, newId } = ctx;
    const systemId = system.id;

    entities.add({
        id: newId("sun"),
        kind: "sun",
        name: system.name,
        q: system.center.q,
        r: system.center.r,
        systemId,
        hazardLevel: randInt(rng, 2, 4),
        scale: 0.9 + rng() * 0.3
    });

    if (rng() < 0.25) {
        const companion = pickEmptyFrom(ctx, ring(system.center, 1));
        if (companion) {
            entities.add({
                id: newId("sun"),
                kind: "sun",
                name: `${system.name} B`,
                q: companion.q,
                r: companion.r,
                systemId,
                hazardLevel: randInt(rng, 1, 3),
                scale: 0.55 + rng() * 0.2
            });
        }
    }

    const planets: EntityOf<"planet">[] = [];
    const planetCount = randInt(rng, 2, 5);
    for (let i = 0; i < planetCount; i++) {
        const tile = pickEmptyFrom(ctx, ring(system.center, randInt(rng, 2, 4)));
        if (!tile) continue;
        planets.push(
            entities.add<EntityOf<"planet">>({
                id: newId("planet"),
                kind: "planet",
                name: `${system.name} ${romanNumeral(i + 1)}`,
                q: tile.q,
                r: tile.r,
                sideId: null,
                systemId,
                level: randInt(rng, PLANET_LEVEL_MIN, PLANET_LEVEL_MAX),
                scale: 0.45 + rng() * 0.35
            })
        );
    }

    for (const planet of planets) {
        const moonCount = randInt(rng, 0, 2);
        for (let m = 0; m < moonCount; m++) {
            const tile = pickEmptyFrom(ctx, ring(planet, 1));
            if (!tile) break;
            entities.add({
                id: newId("moon"),
                kind: "moon",
                name: `${planet.name}${String.fromCharCode(97 + m)}`,
                q: tile.q,
                r: tile.r,
                sideId: null,
                systemId,
                parentPlanetId: planet.id,
                scale: 0.25 + rng() * 0.15
            });
        }
    }

    const asteroidCount = randInt(rng, 0, 3);
    for (let i = 0; i < asteroidCount; i++) {
        const tile = pickEmptyFrom(ctx, ring(system.center, randInt(rng, 3, SYSTEM_RADIUS)));
        if (!tile) continue;
        entities.add({
            id: newId("large_asteroid"),
            kind: "large_asteroid",
            q: tile.q,
            r: tile.r,
            sideId: null,
            systemId,
            mineable: rng() < 0.6,
            scale: 0.3 + rng() * 0.3
        });
    }

    if (rng() < 0.35) {
        const arc = ring(system.center, SYSTEM_RADIUS);
        const start = Math.floor(rng() * arc.length);
        const length = randInt(rng, 3, 6);
        for (let i = 0; i < length; i++) {
            const tile = emptyTileAt(ctx, arc[(start + i) % arc.length]);
            if (!tile) continue;
            entities.add({
                id: newId("asteroid_belt"),
                kind: "asteroid_belt",
                q: tile.q,
                r: tile.r,
                systemId,
                hazardLevel: 1
            });
        }
    }

    return planets;
}

function romanNumeral(n: number): string {
    return ["I", "II", "III", "IV", "V", "VI", "VII", "VIII"][n - 1] ?? String(n);
}

function isDeepSpace(systems: StarSystem[], tile: MapTile, clearance: number): boolean {
    return systems.every((s) => axialDistance(s.center, tile) > SYSTEM_RADIUS + clearance);
}

function placeDeepSpaceHazards(ctx: GenContext, systems: StarSystem[]): void {
    const { rng, entities, newId } = ctx;

    const beltCount = randInt(rng, 2, 4);
    for (let b = 0; b < beltCount; b++) {
        const start = pickEmptyAnywhere(ctx, (tile) => isDeepSpace(systems, tile, 1));
        if (!start) break;
        let hex: Axial = start;
        const direction = randInt(rng, 0, 5);
        const length = randInt(rng, 3, 7);
        for (let i = 0; i < length; i++) {
            const tile = emptyTileAt(ctx, hex);
            if (tile) {
                entities.add({
                    id: newId("asteroid_belt"),
                    kind: "asteroid_belt",
                    q: tile.q,
                    r: tile.r,
                    hazardLevel: 1
                });
            }
            hex = axialNeighbor(hex, direction + (rng() < 0.3 ? randInt(rng, -1, 1) : 0));
        }
    }

    const blackHoleCount = randInt(rng, 1, 2);
    for (let i = 0; i < blackHoleCount; i++) {
        const tile = pickEmptyAnywhere(ctx, (t) => isDeepSpace(systems, t, 3));
        if (!tile) break;
        entities.add({
            id: newId("black_hole"),
            kind: "black_hole",
            q: tile.q,
            r: tile.r,
            hazardLevel: 5,
            scale: 0.8 + rng() * 0.4
        });
    }

    const wormholePairs = randInt(rng, 1, 2);
    for (let i = 0; i < wormholePairs; i++) {
        const a = pickEmptyAnywhere(ctx, (t) => isDeepSpace(systems, t, 1));
        if (!a) break;
        const b = pickEmptyAnywhere(
            ctx,
            (t) => isDeepSpace(systems, t, 1) && axialDistance(a, t) >= 15
        );
        if (!b) break;
        const idA = newId("wormhole");
        const idB = newId("wormhole");
        entities.add({
            id: idA,
            kind: "wormhole",
            q: a.q,
            r: a.r,
            pairId: idB,
            hazardLevel: 2
        });
        entities.add({
            id: idB,
            kind: "wormhole",
            q: b.q,
            r: b.r,
            pairId: idA,
            hazardLevel: 2
        });
    }
}

/** Link each system to its nearest neighbour with an (inactive) tunnel mouth at its edge. */
function placeHyperspaceTunnels(ctx: GenContext, systems: StarSystem[]): void {
    const { entities, newId } = ctx;
    const linked = new Set<string>();

    for (const from of systems) {
        const others = systems
            .filter((s) => s !== from)
            .sort(
                (a, b) =>
                    axialDistance(from.center, a.center) - axialDistance(from.center, b.center)
            );
        const to = others[0];
        if (!to) continue;
        const pairKey = [from.id, to.id].sort().join("|");
        if (linked.has(pairKey)) continue;
        linked.add(pairKey);

        const edge = ring(from.center, SYSTEM_RADIUS + 1).sort(
            (a, b) => axialDistance(a, to.center) - axialDistance(b, to.center)
        );
        const tile = edge.map((hex) => emptyTileAt(ctx, hex)).find((t) => t !== undefined);
        if (!tile) continue;
        entities.add({
            id: newId("hyperspace_tunnel"),
            kind: "hyperspace_tunnel",
            name: `${from.name} – ${to.name}`,
            q: tile.q,
            r: tile.r,
            fromSystemId: from.id,
            toSystemId: to.id,
            active: false
        });
    }
}

function placeStartingFleets(
    ctx: GenContext,
    systems: StarSystem[],
    planetsBySystem: Map<SystemId, EntityOf<"planet">[]>
): Partial<Record<SideId, EntityId>> {
    const { entities, newId } = ctx;
    const homes: Partial<Record<SideId, EntityId>> = {};

    for (const system of systems) {
        const sideId = system.homeSideId;
        if (!sideId) continue;

        let home: EntityOf<"planet"> | undefined = planetsBySystem.get(system.id)?.[0];
        if (!home) {
            const tile = pickEmptyFrom(ctx, ring(system.center, 2));
            if (!tile) continue;
            home = entities.add<EntityOf<"planet">>({
                id: newId("planet"),
                kind: "planet",
                name: `${system.name} I`,
                q: tile.q,
                r: tile.r,
                sideId: null,
                systemId: system.id,
                level: HOME_PLANET_LEVEL,
                scale: 0.6
            });
        }
        home.sideId = sideId;
        home.name = `${sideId.charAt(0).toUpperCase()}${sideId.slice(1)} Prime`;
        home.level = HOME_PLANET_LEVEL;
        homes[sideId] = home.id;

        for (let i = 0; i < STARTING_SHIP_TYPES.length; i++) {
            const shipType = STARTING_SHIP_TYPES[i];
            const template = SHIP_TYPES[shipType];
            const tile = pickEmptyFrom(ctx, ring(home, 1)) ?? pickEmptyFrom(ctx, ring(home, 2));
            if (!tile) break;
            entities.add({
                id: newId("ship"),
                kind: "ship",
                shipType,
                name: `${sideId}-${template.name.toLowerCase()}-${i + 1}`,
                q: tile.q,
                r: tile.r,
                facing: axialDirectionTowards(home, tile),
                sideId,
                movementPoints: template.maxMovementPoints,
                maxMovementPoints: template.maxMovementPoints,
                hp: template.hp,
                scale: template.scale
            });
        }
    }
    return homes;
}

/**
 * Seeded procedural galaxy: sun-centred star systems (planets, moons, large
 * asteroids, occasional belts), deep-space hazards between them, inactive
 * hyperspace tunnels, and a starting fleet per side at its home system.
 */
export function generateSpaceMap(options: {
    width: number;
    height: number;
    hexSize: number;
    seed: number;
    sideIds: SideId[];
}): GeneratedGalaxy {
    const { width, height, hexSize, seed, sideIds } = options;
    const rng = createSeededRng(seed);
    const map = createEmptyMap({ width, height, hexSize, seed });
    const entities = new EntityManager(map);

    let nextSeq = 1;
    const ctx: GenContext = {
        rng,
        map,
        entities,
        newId: (kind) => `${kind}-${nextSeq++}`
    };

    const area = width * height;
    const systemCount = Math.max(sideIds.length, Math.round(area / 350) + randInt(rng, 0, 2));
    const names = shuffled(rng, SYSTEM_NAMES);
    const systems: StarSystem[] = placeSystemCentres(ctx, systemCount).map((center, i) => ({
        id: `system-${i + 1}`,
        name:
            names[i % names.length] +
            (i >= names.length ? ` ${Math.floor(i / names.length) + 1}` : ""),
        center,
        homeSideId: null
    }));

    chooseHomeSystems(systems, sideIds);

    const planetsBySystem = new Map<SystemId, EntityOf<"planet">[]>();
    for (const system of systems) {
        planetsBySystem.set(system.id, populateSystem(ctx, system));
    }

    placeHyperspaceTunnels(ctx, systems);
    placeDeepSpaceHazards(ctx, systems);
    const homePlanets = placeStartingFleets(ctx, systems, planetsBySystem);

    return { map, entities, systems, homePlanets };
}
