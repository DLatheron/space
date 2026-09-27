import { z } from "zod";

export const ClientId = z.uuid();
export type ClientId = z.infer<typeof ClientId>;

export const GameId = z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
export type GameId = z.infer<typeof GameId>;

export const SideId = z.string().min(1);
export type SideId = z.infer<typeof SideId>;

export const EntityId = z.string().min(1);
export type EntityId = z.infer<typeof EntityId>;

export const ClientSummary = z.object({
    id: ClientId,
    name: z.string()
});
export type ClientSummary = z.infer<typeof ClientSummary>;

export const AxialCoord = z.object({
    q: z.number().int(),
    r: z.number().int()
});
export type AxialCoord = z.infer<typeof AxialCoord>;

export const HexKey = z.string().regex(/^-?\d+,-?\d+$/);
export type HexKey = z.infer<typeof HexKey>;

export const SystemId = z.string().min(1);
export type SystemId = z.infer<typeof SystemId>;

export const EntityKind = z.enum([
    "ship",
    "planet",
    "moon",
    "large_asteroid",
    "sun",
    "asteroid_belt",
    "wormhole",
    "black_hole",
    "hyperspace_tunnel"
]);
export type EntityKind = z.infer<typeof EntityKind>;

const EntityBase = z.object({
    id: EntityId,
    name: z.string().optional(),
    q: z.number().int(),
    r: z.number().int(),
    /** Visual variant / size hint for placeholders (0–2). */
    scale: z.number().positive().max(2).optional()
});

const HazardLevel = z.number().min(0);

export const PLANET_LEVEL_MIN = 1;
export const PLANET_LEVEL_MAX = 20;

/** Ship class; stats and animation speeds live in `SHIP_TYPES`. */
export const ShipType = z.enum(["scout", "frigate", "colony_ship"]);
export type ShipType = z.infer<typeof ShipType>;

/** Pointy-top direction index 0–5: 0 = east, counter-clockwise on screen (see `axialNeighbor`). */
export const HexDirection = z.number().int().min(0).max(5);
export type HexDirection = z.infer<typeof HexDirection>;

export const ShipEntity = EntityBase.extend({
    kind: z.literal("ship"),
    shipType: ShipType,
    /** Direction the ship is facing; updated to the last step of each move. */
    facing: HexDirection,
    sideId: SideId,
    movementPoints: z.number().int().min(0),
    maxMovementPoints: z.number().int().min(0),
    hp: z.number().min(0).optional()
});
export type ShipEntity = z.infer<typeof ShipEntity>;

export const PlanetEntity = EntityBase.extend({
    kind: z.literal("planet"),
    sideId: SideId.nullable(),
    systemId: SystemId,
    /** Fixed for the game; also the number of structure slots. */
    level: z.number().int().min(PLANET_LEVEL_MIN).max(PLANET_LEVEL_MAX)
});
export type PlanetEntity = z.infer<typeof PlanetEntity>;

export const MoonEntity = EntityBase.extend({
    kind: z.literal("moon"),
    sideId: SideId.nullable(),
    systemId: SystemId,
    parentPlanetId: EntityId.optional()
});
export type MoonEntity = z.infer<typeof MoonEntity>;

export const LargeAsteroidEntity = EntityBase.extend({
    kind: z.literal("large_asteroid"),
    sideId: SideId.nullable(),
    systemId: SystemId,
    mineable: z.boolean().optional()
});
export type LargeAsteroidEntity = z.infer<typeof LargeAsteroidEntity>;

export const SunEntity = EntityBase.extend({
    kind: z.literal("sun"),
    systemId: SystemId,
    hazardLevel: HazardLevel
});
export type SunEntity = z.infer<typeof SunEntity>;

export const AsteroidBeltEntity = EntityBase.extend({
    kind: z.literal("asteroid_belt"),
    systemId: SystemId.optional(),
    hazardLevel: HazardLevel
});
export type AsteroidBeltEntity = z.infer<typeof AsteroidBeltEntity>;

export const WormholeEntity = EntityBase.extend({
    kind: z.literal("wormhole"),
    /** Id of the paired wormhole exit, if linked. */
    pairId: EntityId.optional(),
    hazardLevel: HazardLevel
});
export type WormholeEntity = z.infer<typeof WormholeEntity>;

export const BlackHoleEntity = EntityBase.extend({
    kind: z.literal("black_hole"),
    hazardLevel: HazardLevel
});
export type BlackHoleEntity = z.infer<typeof BlackHoleEntity>;

export const HyperspaceTunnelEntity = EntityBase.extend({
    kind: z.literal("hyperspace_tunnel"),
    fromSystemId: SystemId,
    toSystemId: SystemId,
    /** Builder side, if any. */
    sideId: SideId.optional(),
    active: z.boolean()
});
export type HyperspaceTunnelEntity = z.infer<typeof HyperspaceTunnelEntity>;

export const EntitySummary = z.discriminatedUnion("kind", [
    ShipEntity,
    PlanetEntity,
    MoonEntity,
    LargeAsteroidEntity,
    SunEntity,
    AsteroidBeltEntity,
    WormholeEntity,
    BlackHoleEntity,
    HyperspaceTunnelEntity
]);
export type EntitySummary = z.infer<typeof EntitySummary>;

export type EntityOfKind<K extends EntityKind> = Extract<EntitySummary, { kind: K }>;

export const TurnState = z.object({
    turn: z.number().int().min(1),
    sideReady: z.record(SideId, z.boolean())
});
export type TurnState = z.infer<typeof TurnState>;

export const BattleId = z.string().min(1);
export type BattleId = z.infer<typeof BattleId>;

/** A pending battle: a ship moved into a hex holding enemy ships. */
export const BattleInfo = z.object({
    battleId: BattleId,
    q: z.number().int(),
    r: z.number().int(),
    /** Side of the moving ship; only its clients may resolve the battle. */
    attackerSideId: SideId,
    defenderSideId: SideId,
    attackerShipIds: z.array(EntityId),
    defenderShipIds: z.array(EntityId)
});
export type BattleInfo = z.infer<typeof BattleInfo>;

export const FogState = z.enum(["unexplored", "explored", "visible"]);
export type FogState = z.infer<typeof FogState>;

/** Client-facing view of a single hex (never sent for unexplored). */
export const TileView = z.object({
    q: z.number().int(),
    r: z.number().int(),
    fog: z.enum(["explored", "visible"]),
    entities: z.array(EntitySummary)
});
export type TileView = z.infer<typeof TileView>;
