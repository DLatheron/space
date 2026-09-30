import type { AxialCoord, BattleId, BattleInfo, EntityId, SideId } from "@space/shared-data";
import type { EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";
import {
    applyShipMove,
    validateShipMove,
    type MovePlanOptions,
    type MoveValidation
} from "./moveShip.js";

export type BattleMoveResult =
    | {
          ok: true;
          move: Extract<MoveValidation, { ok: true }>;
          /** Battle started by this move, if it ended in a hex holding enemy vessels. */
          battle: BattleInfo | null;
      }
    | { ok: false; error: string };

export type BattleResolveResult =
    | {
          ok: true;
          battle: BattleInfo;
          loserSideId: SideId;
          /** Ships and supply ships (whose cargo is lost). */
          destroyedShipIds: EntityId[];
          /** Ground units lost aboard destroyed transports. */
          destroyedUnitIds: EntityId[];
      }
    | { ok: false; error: string };

type Vessel = EntityOf<"ship"> | EntityOf<"supply_ship">;

function shipsAt(entities: EntityManager, hex: AxialCoord): EntityOf<"ship">[] {
    return entities
        .entitiesAt(hex.q, hex.r)
        .filter((entity): entity is EntityOf<"ship"> => entity.kind === "ship");
}

function vesselsAt(entities: EntityManager, hex: AxialCoord): Vessel[] {
    return entities
        .entitiesAt(hex.q, hex.r)
        .filter(
            (entity): entity is Vessel => entity.kind === "ship" || entity.kind === "supply_ship"
        );
}

/** Whether `hex` (true server state) holds any ship not belonging to `sideId`; supply ships don't count. */
export function hasEnemyWarships(
    entities: EntityManager,
    hex: AxialCoord,
    sideId: SideId
): boolean {
    return shipsAt(entities, hex).some((ship) => ship.sideId !== sideId);
}

/** Whether `hex` (true server state) holds any ship or supply ship not belonging to `sideId`. */
export function hasEnemyVessels(entities: EntityManager, hex: AxialCoord, sideId: SideId): boolean {
    return vesselsAt(entities, hex).some((vessel) => vessel.sideId !== sideId);
}

/**
 * Pending battles. A ship stepping into a hex with enemy ships or supply ships stops there
 * and starts a battle, which the attacker (mover's side) resolves by naming a winner. A
 * supply ship blundering into enemy ships also starts one, with the enemy as attacker.
 * While pending, involved vessels are locked and nothing may move into the hex. Turns may
 * still end; the battle simply carries over.
 */
export class BattleManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager | undefined;
    private readonly _battles = new Map<BattleId, BattleInfo>();
    private _nextId = 1;

    constructor(entities: EntityManager, economy?: EconomyManager) {
        this._entities = entities;
        this._economy = economy;
    }

    get(battleId: BattleId): BattleInfo | undefined {
        return this._battles.get(battleId);
    }

    pending(): BattleInfo[] {
        return [...this._battles.values()];
    }

    /** Pending battles in which `sideId` is a combatant. */
    involving(sideId: SideId): BattleInfo[] {
        return this.pending().filter(
            (battle) => battle.attackerSideId === sideId || battle.defenderSideId === sideId
        );
    }

    findAt(hex: AxialCoord): BattleInfo | undefined {
        for (const battle of this._battles.values()) {
            if (battle.q === hex.q && battle.r === hex.r) return battle;
        }
        return undefined;
    }

    findByShip(shipId: EntityId): BattleInfo | undefined {
        for (const battle of this._battles.values()) {
            if (
                battle.attackerShipIds.includes(shipId) ||
                battle.defenderShipIds.includes(shipId)
            ) {
                return battle;
            }
        }
        return undefined;
    }

    /**
     * Validate and apply a move. The path is cut at the first hex holding enemy
     * vessels (or an ongoing battle); ending in enemy vessels starts a battle.
     */
    moveShip(
        sideId: SideId | null,
        shipId: EntityId,
        to: AxialCoord,
        options: MovePlanOptions = {}
    ): BattleMoveResult {
        if (this.findByShip(shipId)) {
            return { ok: false, error: `Ship ${shipId} is locked in battle` };
        }
        const move = validateShipMove(this._entities, sideId, shipId, to, {
            ...options,
            stopAt: (hex) =>
                !!this.findAt(hex) || (!!sideId && hasEnemyVessels(this._entities, hex, sideId))
        });
        if (!move.ok) return move;
        if (this.findAt(move.to)) {
            return { ok: false, error: `A battle is in progress at ${move.to.q},${move.to.r}` };
        }

        applyShipMove(this._entities, move);
        return { ok: true, move, battle: this._startIfContested(move.ship) };
    }

    /**
     * A supply ship moved into a hex holding enemy ships: the enemy attacks, and every
     * vessel of the supply ship's side in the hex defends. Returns null if the hex is quiet.
     */
    startSupplyAmbush(supplyShip: EntityOf<"supply_ship">): BattleInfo | null {
        if (this.findAt(supplyShip)) return null;
        const attackerSideId = shipsAt(this._entities, supplyShip).find(
            (ship) => ship.sideId !== supplyShip.sideId
        )?.sideId;
        if (!attackerSideId) return null;
        return this._create(supplyShip, attackerSideId, supplyShip.sideId);
    }

    private _startIfContested(attacker: EntityOf<"ship">): BattleInfo | null {
        const defenderSideId = vesselsAt(this._entities, attacker).find(
            (vessel) => vessel.sideId !== attacker.sideId
        )?.sideId;
        if (!defenderSideId) return null;
        return this._create(attacker, attacker.sideId, defenderSideId);
    }

    private _create(hex: AxialCoord, attackerSideId: SideId, defenderSideId: SideId): BattleInfo {
        const vessels = vesselsAt(this._entities, hex);
        const battle: BattleInfo = {
            battleId: `battle-${this._nextId++}`,
            q: hex.q,
            r: hex.r,
            attackerSideId,
            defenderSideId,
            attackerShipIds: vessels.filter((v) => v.sideId === attackerSideId).map((v) => v.id),
            defenderShipIds: vessels.filter((v) => v.sideId === defenderSideId).map((v) => v.id)
        };
        this._battles.set(battle.battleId, battle);
        return battle;
    }

    /**
     * Resolve a battle on behalf of `bySideId` (must be the attacker). Every ship and supply
     * ship of the losing side in the hex is removed: supply ship cargo is lost, crews go
     * home and units aboard transports are destroyed.
     */
    resolve(
        battleId: BattleId,
        bySideId: SideId | null,
        winnerSideId: SideId
    ): BattleResolveResult {
        const battle = this._battles.get(battleId);
        if (!battle) return { ok: false, error: `Unknown battle ${battleId}` };
        if (bySideId !== battle.attackerSideId) {
            return { ok: false, error: "Only the attacking side can resolve this battle" };
        }
        const { attackerSideId, defenderSideId } = battle;
        if (winnerSideId !== attackerSideId && winnerSideId !== defenderSideId) {
            return { ok: false, error: `Side ${winnerSideId} is not part of this battle` };
        }

        const loserSideId = winnerSideId === attackerSideId ? defenderSideId : attackerSideId;
        const losers = vesselsAt(this._entities, battle).filter((v) => v.sideId === loserSideId);
        const destroyedUnitIds =
            this._economy?.onShipsDestroyed(
                losers.filter((v): v is EntityOf<"ship"> => v.kind === "ship")
            ) ?? [];
        const destroyedShipIds = losers.map((v) => v.id);
        for (const id of destroyedShipIds) this._entities.remove(id);
        this._battles.delete(battleId);

        return { ok: true, battle, loserSideId, destroyedShipIds, destroyedUnitIds };
    }
}
