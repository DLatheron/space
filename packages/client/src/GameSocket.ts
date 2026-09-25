import { ClientId, ClientToServerMessage, GameId } from "@space/shared-data";

export type GameSocketConnectOptions = {
    onOpen?: () => void;
    onClose?: () => void;
    onMessage?: (data: unknown) => void;
    signal?: AbortSignal;
};

function sendJson(ws: WebSocket, message: ClientToServerMessage) {
    if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify(message));
    }
}

export class GameSocket {
    private readonly _gameId: GameId;
    private readonly _clientId: ClientId;

    private _ws: WebSocket | null;
    private _onClose: (() => void) | null = null;
    private _intentionalClose = false;
    private _abortCleanup: (() => void) | null = null;

    constructor(gameId: GameId, clientId: ClientId) {
        this._gameId = gameId;
        this._clientId = clientId;
        this._ws = null;
    }

    connect(options: GameSocketConnectOptions): this {
        this.disconnect();

        const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
        const params = new URLSearchParams({
            gameId: this._gameId,
            clientId: this._clientId
        });
        const url = `${proto}//${window.location.host}/ws/game?${params.toString()}`;
        console.info(
            "Attempting connection to:",
            this._gameId,
            "from:",
            this._clientId,
            "at:",
            url
        );
        const ws = new WebSocket(url);
        this._ws = ws;
        this._onClose = options?.onClose ?? null;
        this._intentionalClose = false;

        if (options?.signal) {
            const onAbort = () => this.disconnect();
            if (options.signal.aborted) {
                onAbort();
                return this;
            }
            options.signal.addEventListener("abort", onAbort, { once: true });
            this._abortCleanup = () => options.signal?.removeEventListener("abort", onAbort);
        }

        ws.onopen = () => {
            options?.onOpen?.();
        };

        ws.onmessage = (ev) => {
            options?.onMessage?.(ev.data);
        };

        ws.onclose = () => {
            if (this._intentionalClose) {
                return;
            }

            this._cleanupConnectionState();
            this._onClose?.();
            this._onClose = null;
        };

        ws.onerror = (error) => {
            console.error("Socket error", error);
            this.disconnect();
        };

        return this;
    }

    disconnect(): void {
        if (!this._ws) {
            return;
        }

        this._intentionalClose = true;
        const ws = this._ws;
        this._ws = null;

        ws.onopen = null;
        ws.onmessage = null;
        ws.onerror = null;
        ws.onclose = null;
        ws.close();

        this._cleanupConnectionState();
        this._onClose?.();
        this._onClose = null;
    }

    private _cleanupConnectionState(): void {
        this._abortCleanup?.();
        this._abortCleanup = null;
    }

    send(message: ClientToServerMessage) {
        if (this._ws?.readyState === WebSocket.OPEN) {
            sendJson(this._ws, message);
        }
    }
}
