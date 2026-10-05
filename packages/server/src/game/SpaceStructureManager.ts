import { axialDistance } from "@space/maths";
import {
    canConstruct,
    canEnterStargate,
    SPACE_STRUCTURE_INFO,
    spaceStructureStats,
    type AxialCoord,
    type CombatResult,
    type EconomyBalance,
    type EntityId,
    type SideId,
    type SpaceStructureType
} from "@space/shared-data";
import { defaultEconomyBalance } from "../config/config.schema.js";
import { hasEnemyVessels, isDefendedHex } from "./Battle.js";
import {
    isAlive,
    orbitalStrike,
    shipFighter,
    structureFighter,
    supplyFighter,
    toParticipant,
    type Fighter
} from "./combat.js";
import { destroyVessels, type Vessel } from "./destroyShips.js";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";

export type ConstructResult =
    { ok: true; structure: EntityOf<"space_structure"> } | { ok: false; error: string };

export type StargateEvent = {
    shipId: EntityId;
    sideId: SideId;
    from: AxialCoord;
    to: AxialCoord;
    fromGateId: EntityId;
    toGateId: EntityId;
};

export type StargateResult = ({ ok: true } & StargateEvent) | { ok: false; error: string };

export type SpaceStructureOptions = {
    /** Random numbers in [0, 1) for evasion and damage rolls; defaults to `Math.random`. */
    rng?: () => number;
    /** Turn combat counts against (see `TurnManager.combatTurn`); defaults to 1. */
    turn?: () => number;
};

/**
 * Space structures built by Builders: construction sites (funded through the economy like
 * any order), ranged fire from armed structures at end of turn, and stargate travel.
 */
export class SpaceStructureManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager;
    private readonly _balance: EconomyBalance;
    private readonly _rng: () => number;
    private readonly _turn: () => number;
    private _nextSeq = 1;

    constructor(
        entities: EntityManager,
        economy: EconomyManager,
        options: SpaceStructureOptions = {}
    ) {
        this._entities = entities;
        this._economy = economy;
        this._balance = economy.balance ?? defaultEconomyBalance();
        this._rng = options.rng ?? Math.random;
        this._turn = options.turn ?? (() => 1);
    }

    /** Start a `type` construction site on the Builder's hex (see `canConstruct`). */
    construct(sideId: SideId | null, shipId: EntityId, type: SpaceStructureType): ConstructResult {
        if (!sideId || !this._economy.sideIds.includes(sideId)) {
            return { ok: false, error: "You are not assigned to a side" };
        }
        const builder = this._entities.getOfKind(shipId, "ship");
        if (!builder || builder.sideId !== sideId) {
            return { ok: false, error: `Unknown ship ${shipId}` };
        }
        const check = canConstruct(
            builder,
            type,
            this._entities.entitiesAt(builder.q, builder.r),
            this._economy.research.techs(sideId),
            this._balance
        );
        if (!check.ok) return { ok: false, error: check.reason };

        let id: EntityId;
        do {
            id = `structure-${this._nextSeq++}`;
        } while (this._entities.get(id));
        const number =
            this._entities
                .ofKind("space_structure")
                .filter((s) => s.sideId === sideId && s.structureType === type).length + 1;
        const structure = this._entities.add<EntityOf<"space_structure">>({
            id,
            kind: "space_structure",
            structureType: type,
            name: `${SPACE_STRUCTURE_INFO[type].name} ${number}`,
            q: builder.q,
            r: builder.r,
            sideId,
            constructing: true
        });
        this._economy.startConstruction(structure);
        return { ok: true, structure };
    }

    /**
     * Travel instantly from the friendly Stargate on the ship's hex to `gateId`, another
     * completed friendly Stargate; the ship (and any ships it carries) arrives with no
     * movement left. Refused when enemies hold the exit.
     */
    stargate(sideId: SideId | null, shipId: EntityId, gateId: EntityId): StargateResult {
        const ship = this._entities.getOfKind(shipId, "ship");
        if (!ship || !sideId || ship.sideId !== sideId) {
            return { ok: false, error: `Unknown ship ${shipId}` };
        }
        const entry = this._entities
            .entitiesAt(ship.q, ship.r)
            .find(
                (e): e is EntityOf<"space_structure"> =>
                    e.kind === "space_structure" && e.structureType === "stargate"
            );
        const check = canEnterStargate(ship, entry);
        if (!check.ok) return { ok: false, error: check.reason };
        const exit = this._entities.getOfKind(gateId, "space_structure");
        if (
            !exit ||
            exit.structureType !== "stargate" ||
            exit.sideId !== sideId ||
            exit.constructing
        ) {
            return { ok: false, error: "Pick another of your completed Stargates" };
        }
        if (exit.id === entry!.id) return { ok: false, error: "The ship is already there" };
        if (isDefendedHex(this._entities, this._economy, exit, sideId)) {
            return { ok: false, error: "Enemies hold the exit Stargate" };
        }
        const from = { q: ship.q, r: ship.r };
        const to = { q: exit.q, r: exit.r };
        this._entities.move(ship.id, to);
        ship.movementPoints = 0;
        delete ship.moveOrder;
        this._economy.onShipMoved(ship);
        return { ok: true, shipId, sideId, from, to, fromGateId: entry!.id, toGateId: exit.id };
    }

    /**
     * End of turn: every completed armed structure fires once at the nearest hex within its
     * `fireRadius` holding enemy ships or supply ships, sharing its attack among them with no
     * return fire (supply ships may evade). Destroyed vessels are removed.
     */
    fireRanged(): CombatResult[] {
        const results: CombatResult[] = [];
        for (const structure of this._entities.ofKind("space_structure")) {
            if (structure.constructing || !this._entities.get(structure.id)) continue;
            const stats = spaceStructureStats(
                structure.structureType,
                structure.tier ?? 1,
                this._balance
            );
            if (stats.attack <= 0 || stats.fireRadius <= 0) continue;
            const target = this._nearestEnemyHex(structure, stats.fireRadius, structure.sideId);
            if (!target) continue;
            results.push(this._fire(structure, target));
        }
        return results;
    }

    private _nearestEnemyHex(
        from: AxialCoord,
        radius: number,
        sideId: SideId
    ): AxialCoord | undefined {
        let best: { hex: AxialCoord; d: number } | undefined;
        const seen = new Set<string>();
        for (const vessel of [
            ...this._entities.ofKind("ship"),
            ...this._entities.ofKind("supply_ship")
        ]) {
            if (vessel.sideId === sideId) continue;
            if (vessel.kind === "ship" && vessel.carriedBy) continue;
            const key = `${vessel.q},${vessel.r}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const d = axialDistance(from, vessel);
            if (d > radius) continue;
            if (!best || d < best.d) best = { hex: { q: vessel.q, r: vessel.r }, d };
        }
        return best && hasEnemyVessels(this._entities, best.hex, sideId) ? best.hex : undefined;
    }

    private _fire(structure: EntityOf<"space_structure">, hex: AxialCoord): CombatResult {
        const shooter = structureFighter(structure, "attacker", this._balance);
        const targets: Fighter[] = this._entities
            .entitiesAt(hex.q, hex.r)
            .filter(
                (e): e is Vessel =>
                    (e.kind === "ship" || e.kind === "supply_ship") && e.sideId !== structure.sideId
            )
            .map((v) =>
                v.kind === "ship"
                    ? shipFighter(v, "defender", this._balance)
                    : supplyFighter(
                          v,
                          "defender",
                          this._balance,
                          this._economy.research.techs(v.sideId)
                      )
            );
        for (const t of targets) {
            if (t.evasion > 0 && this._rng() < t.evasion) {
                t.attacked += 1;
                t.evadedCount += 1;
            }
        }
        const exposed = targets.filter((t) => t.evadedCount === 0);
        orbitalStrike([shooter], exposed, this._balance.combat, this._rng);

        const turn = this._turn();
        structure.lastCombatTurn = turn;
        const lost: Vessel[] = [];
        for (const f of targets) {
            const vessel = this._entities.get(f.id);
            if (vessel?.kind !== "ship" && vessel?.kind !== "supply_ship") continue;
            vessel.lastCombatTurn = turn;
            if (!isAlive(f)) lost.push(vessel);
            else if (f.hp < f.maxHp) vessel.hp = f.hp;
        }
        const destroyed = lost.length
            ? destroyVessels(this._entities, this._economy, lost)
            : { destroyedShipIds: [], destroyedUnitIds: [] };
        const fighters = [shooter, ...targets];
        return {
            kind: "space",
            cause: "ranged",
            hex: { q: hex.q, r: hex.r },
            from: { q: structure.q, r: structure.r },
            attackerSideId: structure.sideId,
            defenderSideIds: [...new Set(targets.map((t) => t.sideId))],
            participants: fighters.map(toParticipant),
            destroyedIds: destroyed.destroyedShipIds,
            destroyedUnitIds: destroyed.destroyedUnitIds,
            outcome: targets.every((t) => !isAlive(t)) ? "attacker_won" : "inconclusive",
            attackerMovedIn: false,
            rounds: 1
        };
    }
}
