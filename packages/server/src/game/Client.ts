import type { ClientId, ServerToClientMessage, SideId } from "@space/shared-data";
import { WebSocket } from "ws";
import type { Game } from "./Game.js";

export const SOCKET_CLOSED_DUE_TO_GAME_DELETION = 4000;
export const SOCKET_REPLACED_BY_NEW_CONNECTION = 4001;

export class Client {
    private readonly _game: Game;
    private readonly _id: ClientId;
    private _name: string;
    private _sideId: SideId | null;
    private _socket: WebSocket | null;

    constructor({ id, name }: { id: ClientId; name: string }, game: Game) {
        this._game = game;
        this._id = id;
        this._name = name;
        this._sideId = null;
        this._socket = null;
    }

    get id(): ClientId {
        return this._id;
    }

    get name(): string {
        return this._name;
    }

    set name(value: string) {
        this._name = value;
    }

    get sideId(): SideId | null {
        return this._sideId;
    }

    set sideId(value: SideId | null) {
        this._sideId = value;
    }

    get socket(): WebSocket | null {
        return this._socket;
    }

    assignSocket(value: WebSocket) {
        if (this._socket && this._socket !== value) {
            this._socket.removeAllListeners();
            this._socket.close(SOCKET_REPLACED_BY_NEW_CONNECTION, "Replaced by new connection");
        }

        // eslint-disable-next-line @typescript-eslint/no-this-alias -- needs aliasing to prevent errors inside lambdas.
        const client = this;
        const { id, _game: game } = client;

        this._socket = value;

        value.on("message", function message(data: MessageEvent) {
            game.receiveMessage(data, client);
        });

        value.on("close", function close() {
            if (client._socket !== value) {
                return;
            }

            client._socket = null;
            game.clientDisconnected(client);
            game.removeClient(id);
        });

        value.on("error", function error(error: unknown) {
            console.error(error);
        });

        game.clientConnected(this);
    }

    sendMessage(message: ServerToClientMessage): void {
        if (!this._socket) {
            return;
        }

        if (this._socket.readyState === WebSocket.OPEN) {
            this._socket.send(JSON.stringify(message));
        }
    }

    forceDisconnect() {
        if (!this._socket) {
            return;
        }

        this._socket.close(SOCKET_CLOSED_DUE_TO_GAME_DELETION);
        this._socket = null;
    }
}
