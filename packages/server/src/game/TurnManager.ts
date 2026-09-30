import type { SideId, TurnState } from "@space/shared-data";
import type { EconomyAdvance, EconomyManager } from "./EconomyManager.js";
import type { EntityManager } from "./EntityManager.js";
import type { EntityOf } from "./map/types.js";
import type { SupplyManager, SupplyMoveResult } from "./SupplyManager.js";

export type SupplyAdvance = SupplyMoveResult & {
    /** Supply ships launched carrying released population home. */
    returning: EntityOf<"supply_ship">[];
    /** Supply ships launched by the dispatch step. */
    dispatched: EntityOf<"supply_ship">[];
};

export type EndTurnResult = {
    advanced: boolean;
    state: TurnState;
    /** Economy results of the advance (present when `advanced` and an economy is attached). */
    economy?: EconomyAdvance;
    /** Supply results of the advance (present when `advanced` and supply is attached). */
    supply?: SupplyAdvance;
};

/**
 * Simultaneous turns: each side marks itself ready (any time, even with MP left). Once every
 * side is ready the turn advances, all ships regain full MP and the end of turn runs:
 *
 * 1. builds that were fully funded at the previous end of turn (ready) complete;
 * 2. installations and base income add to local stockpiles;
 * 3. supply ships move, re-planning around known enemies;
 * 4. arriving cargo goes into the destination's stockpile;
 * 5. builds draw from their local stockpile by priority, capped at their per-turn rate.
 *    Builds that become fully funded are ready: they stay queued (without holding a build
 *    slot, so the next queued build starts funding at once) and complete in next turn's
 *    step 1, so a build takes at least `buildTurns + 1` end turns;
 * 6. released population is sent home;
 * 7. dispatch: demand by priority, nearest source, reserve cargo, pack ships;
 * 8. ships launched in steps 6 and 7 make their first move (as in steps 3 and 4). Cargo
 *    they deliver is only used by next turn's funding.
 */
export class TurnManager {
    private readonly _entities: EntityManager;
    private readonly _economy: EconomyManager | undefined;
    private readonly _supply: SupplyManager | undefined;
    private readonly _sideReady = new Map<SideId, boolean>();
    private _turn = 1;

    constructor(
        sideIds: Iterable<SideId>,
        entities: EntityManager,
        economy?: EconomyManager,
        supply?: SupplyManager
    ) {
        this._entities = entities;
        this._economy = economy;
        this._supply = supply;
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
        const { economy, supply } = this._advance();
        return { advanced: true, state: this.state(), economy, supply };
    }

    private _advance(): { economy?: EconomyAdvance; supply?: SupplyAdvance } {
        for (const sideId of this._sideReady.keys()) this._sideReady.set(sideId, false);
        for (const ship of this._entities.ofKind("ship")) {
            ship.movementPoints = ship.maxMovementPoints;
        }
        this._turn += 1;
        if (!this._economy) return {};

        const economy = this._economy.completeReady();
        this._economy.produce();
        const moved = this._supply?.move();
        this._economy.fund();
        if (!this._supply || !moved) return { economy };
        const returning = this._supply.returnPopulation();
        const dispatched = this._supply.dispatch();
        const departed = this._supply.move([...returning, ...dispatched].map((s) => s.id));
        return {
            economy,
            supply: {
                moves: [...moved.moves, ...departed.moves],
                arrivals: [...moved.arrivals, ...departed.arrivals],
                battles: [...moved.battles, ...departed.battles],
                returning,
                dispatched
            }
        };
    }
}
