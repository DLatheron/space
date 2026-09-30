import { z } from "zod";
import { Resources } from "./Resources.js";

export const ClientId = z.uuid();
export type ClientId = z.infer<typeof ClientId>;

export const GameId = z.string().regex(/^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
export type GameId = z.infer<typeof GameId>;

export const SideId = z.string().min(1);
export type SideId = z.infer<typeof SideId>;

export const EntityId = z.string().min(1);
export type EntityId = z.infer<typeof EntityId>;

/** Id of a build order (see `BuildOrder`). */
export const OrderId = z.string().min(1);
export type OrderId = z.infer<typeof OrderId>;

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
    "supply_ship",
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

/** Structure slots on a moon / mineable large asteroid when the entity doesn't say. */
export const MOON_DEFAULT_SLOTS = 3;
export const LARGE_ASTEROID_DEFAULT_SLOTS = 2;

/** Per-instance enhancement tier of an installation, ship or ground unit; everything starts at 1. */
export const ENHANCEMENT_TIER_MIN = 1;
export const ENHANCEMENT_TIER_MAX = 3;
export const EnhancementTier = z.number().int().min(ENHANCEMENT_TIER_MIN).max(ENHANCEMENT_TIER_MAX);
export type EnhancementTier = z.infer<typeof EnhancementTier>;

/** Ship class; stats live in `EconomyBalance.ships`, names and animation in `SHIP_TYPE_INFO`. */
export const ShipType = z.enum(["scout", "frigate", "colony_ship", "transport"]);
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
    hp: z.number().min(0).optional(),
    /** Absent means tier 1. */
    tier: EnhancementTier.optional(),
    /** Ground units aboard; transports only. */
    carriedUnitIds: z.array(EntityId).optional()
});
export type ShipEntity = z.infer<typeof ShipEntity>;

/** Reserves part of a supply ship's cargo for one build order at its destination. */
export const CargoReservation = z.object({
    orderId: OrderId,
    amount: Resources
});
export type CargoReservation = z.infer<typeof CargoReservation>;

/**
 * Autonomous cargo carrier. The destination is fixed at dispatch; the route is re-planned
 * every turn around hexes the side believes hold enemies.
 */
export const SupplyShipEntity = EntityBase.extend({
    kind: z.literal("supply_ship"),
    sideId: SideId,
    facing: HexDirection,
    /** Location (planet, moon or asteroid) the cargo was loaded at. */
    originId: EntityId,
    destinationId: EntityId,
    cargo: Resources,
    /** Empty for population returning home, which isn't tied to an order. */
    reservedFor: z.array(CargoReservation),
    /** Hexes per turn. */
    speed: z.number().int().min(0),
    /** Maximum total units of cargo (all resource types together). */
    capacity: z.number().int().min(0),
    /** Planned hexes ahead, excluding the current hex; only sent to the owning side. */
    route: z.array(AxialCoord).optional(),
    /** At its destination, waiting for stockpile room to unload the rest of its cargo. */
    waiting: z.boolean().optional()
});
export type SupplyShipEntity = z.infer<typeof SupplyShipEntity>;

export const PlanetEntity = EntityBase.extend({
    kind: z.literal("planet"),
    sideId: SideId.nullable(),
    systemId: SystemId,
    /** Fixed for the game; also the number of structure slots. */
    level: z.number().int().min(PLANET_LEVEL_MIN).max(PLANET_LEVEL_MAX),
    /** Ground unit ids stationed here; absent means none. */
    garrison: z.array(EntityId).optional()
});
export type PlanetEntity = z.infer<typeof PlanetEntity>;

export const MoonEntity = EntityBase.extend({
    kind: z.literal("moon"),
    sideId: SideId.nullable(),
    systemId: SystemId,
    parentPlanetId: EntityId.optional(),
    /** Structure slots; absent means `MOON_DEFAULT_SLOTS`. */
    slots: z.number().int().min(0).optional(),
    garrison: z.array(EntityId).optional()
});
export type MoonEntity = z.infer<typeof MoonEntity>;

export const LargeAsteroidEntity = EntityBase.extend({
    kind: z.literal("large_asteroid"),
    sideId: SideId.nullable(),
    systemId: SystemId,
    /** Only mineable asteroids can be colonised and built on. */
    mineable: z.boolean().optional(),
    /** Structure slots when mineable; absent means `LARGE_ASTEROID_DEFAULT_SLOTS`. */
    slots: z.number().int().min(0).optional(),
    garrison: z.array(EntityId).optional()
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
    SupplyShipEntity,
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

/**
 * A pending battle: a ship moved into a hex holding enemy ships. Defender ids may include
 * supply ships and transports.
 */
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
