import type { SideId, TurnState } from "@space/shared-data";
import type { EconomyAdvance, EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";

export type EndTurnResult = {
    advanced: boolean;
    state: TurnState;
    /** Economy results of the advance (present when `advanced` and an economy is attached). */
    economy?: EconomyAdvance;
};

/**
 * Simultaneous turns: each side marks itself ready (any time, even with MP left).
 * Once every side is ready the turn advances, all ships regain full MP and the
 * economy (income, build queues, spawns) moves forward.
 */
export class TurnManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager | undefined;
    private readonly _sideReady = new Map<SideId, boolean>();
    private _turn = 1;

    constructor(sideIds: Iterable<SideId>, entities: EntityManager, economy?: EconomyManager) {
        this._entities = entities;
        this._economy = economy;
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
        if (!allReady) return { advanced: false, state: this.state() };
        const economy = this._advance();
        return { advanced: true, state: this.state(), economy };
    }

    private _advance(): EconomyAdvance | undefined {
        for (const sideId of this._sideReady.keys()) this._sideReady.set(sideId, false);
        for (const ship of this._entities.ofKind("ship")) {
            ship.movementPoints = ship.maxMovementPoints;
        }
        this._turn += 1;
        return this._economy?.advanceTurn();
    }
}
