import type { AxialCoord, BattleId, BattleInfo, EntityId, SideId } from "@space/shared-data";
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
          /** Battle started by this move, if it ended in a hex holding enemy ships. */
          battle: BattleInfo | null;
      }
    | { ok: false; error: string };

export type BattleResolveResult =
    | { ok: true; battle: BattleInfo; loserSideId: SideId; destroyedShipIds: EntityId[] }
    | { ok: false; error: string };

function shipsAt(entities: EntityManager, hex: AxialCoord): EntityOf<"ship">[] {
    return entities
        .entitiesAt(hex.q, hex.r)
        .filter((entity): entity is EntityOf<"ship"> => entity.kind === "ship");
}

/** Whether `hex` (true server state) holds any ship not belonging to `sideId`. */
export function hasEnemyShips(entities: EntityManager, hex: AxialCoord, sideId: SideId): boolean {
    return shipsAt(entities, hex).some((ship) => ship.sideId !== sideId);
}

/**
 * Pending battles. A ship stepping into a hex with enemy ships stops there and
 * starts a battle, which the attacker (mover's side) resolves by naming a winner.
 * While pending, involved ships are locked and nothing may move into the hex.
 * Turns may still end; the battle simply carries over.
 */
export class BattleManager {
    private readonly _entities: EntityManager;
    private readonly _battles = new Map<BattleId, BattleInfo>();
    private _nextId = 1;

    constructor(entities: EntityManager) {
        this._entities = entities;
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
     * ships (or an ongoing battle); ending in enemy ships starts a battle.
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
                !!this.findAt(hex) || (!!sideId && hasEnemyShips(this._entities, hex, sideId))
        });
        if (!move.ok) return move;
        if (this.findAt(move.to)) {
            return { ok: false, error: `A battle is in progress at ${move.to.q},${move.to.r}` };
        }

        applyShipMove(this._entities, move);
        return { ok: true, move, battle: this._startIfContested(move.ship) };
    }

    private _startIfContested(attacker: EntityOf<"ship">): BattleInfo | null {
        const ships = shipsAt(this._entities, attacker);
        const defenderSideId = ships.find((ship) => ship.sideId !== attacker.sideId)?.sideId;
        if (!defenderSideId) return null;

        const battle: BattleInfo = {
            battleId: `battle-${this._nextId++}`,
            q: attacker.q,
            r: attacker.r,
            attackerSideId: attacker.sideId,
            defenderSideId,
            attackerShipIds: ships.filter((s) => s.sideId === attacker.sideId).map((s) => s.id),
            defenderShipIds: ships.filter((s) => s.sideId === defenderSideId).map((s) => s.id)
        };
        this._battles.set(battle.battleId, battle);
        return battle;
    }

    /**
     * Resolve a battle on behalf of `bySideId` (must be the attacker). Every ship of
     * the losing side in the hex is removed from the entity manager.
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
        const destroyedShipIds = shipsAt(this._entities, battle)
            .filter((ship) => ship.sideId === loserSideId)
            .map((ship) => ship.id);
        for (const id of destroyedShipIds) this._entities.remove(id);
        this._battles.delete(battleId);

        return { ok: true, battle, loserSideId, destroyedShipIds };
    }
}
