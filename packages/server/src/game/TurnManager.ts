import type { SideId, TurnState } from "@space/shared-data";
import type { EntityManager } from "./EntityManager.js";

export type EndTurnResult = { advanced: boolean; state: TurnState };

/**
 * Simultaneous turns: each side marks itself ready (any time, even with MP left).
 * Once every side is ready the turn advances and all ships regain full MP.
 */
export class TurnManager {
    private readonly _entities: EntityManager;
    private readonly _sideReady = new Map<SideId, boolean>();
    private _turn = 1;

    constructor(sideIds: Iterable<SideId>, entities: EntityManager) {
        this._entities = entities;
        for (const sideId of sideIds) this._sideReady.set(sideId, false);
    }

    get turn(): number {
        return this._turn;
    }

    isReady(sideId: SideId): boolean {
        return this._sideReady.get(sideId) ?? false;
    }

    state(): TurnState {
        return { turn: this._turn, sideReady: Object.fromEntries(this._sideReady) };
    }

    endTurn(sideId: SideId): EndTurnResult {
        if (!this._sideReady.has(sideId)) {
            throw new Error(`Unknown side ${sideId}`);
        }
        this._sideReady.set(sideId, true);

        const allReady = [...this._sideReady.values()].every(Boolean);
        if (allReady) this._advance();
        return { advanced: allReady, state: this.state() };
    }

    private _advance() {
        for (const sideId of this._sideReady.keys()) this._sideReady.set(sideId, false);
        for (const ship of this._entities.ofKind("ship")) {
            ship.movementPoints = ship.maxMovementPoints;
        }
        this._turn += 1;
    }
}
