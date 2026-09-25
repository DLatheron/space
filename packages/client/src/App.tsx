import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import {
    ClientQueryParams,
    GameId,
    parseURLSearchParams,
    ServerToClientMessage
} from "@space/shared-data";
import { GameSocket } from "./GameSocket.js";
import { Server, useClientId, useServerMessageManager, useServerSocket } from "./hooks/index.js";
import { MainMenu } from "./pages/MainMenu.js";
import { HexMapView } from "./components/HexMapView.js";
import { HexWorld } from "./world/HexWorld.js";
import "./App.css";

export function App() {
    const { clientId } = useClientId();
    const [searchParams, setSearchParams] = useSearchParams();
    const validatedSearchParams = parseURLSearchParams(ClientQueryParams, searchParams);
    const { name, mode } = validatedSearchParams;
    const clientName = name ?? "Pilot";

    const [log, setLog] = useState<string[]>([]);
    const [sideId, setSideId] = useState<string | null>(null);
    const [mapReady, setMapReady] = useState(false);

    const world = useMemo(() => new HexWorld(), []);

    const appendLog = useCallback((line: string) => {
        setLog((prev) => [...prev.slice(-49), line]);
    }, []);

    const { messageManager, sendMessage, setGameSocket } = useServerMessageManager();

    useEffect(() => {
        const handles = [
            messageManager.registerHandler("server:hello", (_ctx, payload) => {
                appendLog(`hello — game ${payload.gameId}`);
            }),
            messageManager.registerHandler("server:pong", (_ctx, payload) => {
                appendLog(`pong — nonce ${payload.nonce}`);
            }),
            messageManager.registerHandler("server:client:connected", (_ctx, payload) => {
                appendLog(`client connected — ${payload.client.name}`);
            }),
            messageManager.registerHandler("server:client:disconnected", (_ctx, payload) => {
                appendLog(`client disconnected — ${payload.client.name}`);
            }),
            messageManager.registerHandler("server:error", (_ctx, payload) => {
                appendLog(`error — ${payload.message}`);
            }),
            messageManager.registerHandler("server:map:init", (_ctx, payload) => {
                world.applyMapInit(payload);
                setSideId(payload.sideId);
                setMapReady(true);
                appendLog(
                    `map init — ${payload.width}×${payload.height}, side ${payload.sideId}, ${payload.visible.length} visible`
                );
            }),
            messageManager.registerHandler("server:tiles:update", (_ctx, payload) => {
                world.applyTilesUpdate(payload);
                appendLog(`tiles update — ${payload.tiles.length} tiles, ${payload.visible.length} visible`);
            })
        ];

        return () => {
            messageManager.unregisterHandlers(handles);
        };
    }, [messageManager, appendLog, world]);

    const onConnected = useCallback(
        (gameSocket: GameSocket) => {
            setGameSocket(gameSocket);
            appendLog("socket connected");
        },
        [setGameSocket, appendLog]
    );

    const onDisconnected = useCallback(
        (unexpected: boolean) => {
            setGameSocket(null);
            setMapReady(false);
            setSideId(null);
            appendLog(unexpected ? "socket disconnected unexpectedly" : "socket disconnected");
        },
        [setGameSocket, appendLog]
    );

    const onMessage = useCallback(
        (data: unknown) => {
            try {
                const message = ServerToClientMessage.parse(JSON.parse(String(data)));
                messageManager.enqueueMessage(message, Server);
            } catch (error) {
                console.error("Failed to parse server message", data, error);
                appendLog("failed to parse server message");
            }
        },
        [messageManager, appendLog]
    );

    const { connected, gameId, createGame, joinGame, leaveGame } = useServerSocket({
        clientId,
        clientName,
        onConnected,
        onDisconnected,
        onMessage
    });

    const startCreate = useCallback(() => {
        setSearchParams((params) => {
            params.set("mode", "create");
            return params;
        });
        createGame();
    }, [setSearchParams, createGame]);

    const startJoin = useCallback(
        (targetGameId: GameId) => {
            setSearchParams((params) => {
                params.set("mode", "join");
                params.set("game-id", targetGameId);
                return params;
            });
            joinGame(targetGameId);
        },
        [setSearchParams, joinGame]
    );

    const ping = useCallback(() => {
        const nonce = Date.now();
        sendMessage({ type: "client:ping", payload: { nonce } });
        appendLog(`ping — nonce ${nonce}`);
    }, [sendMessage, appendLog]);

    return (
        <div className="app">
            <header className="app__header">
                <div>
                    <h1>Space</h1>
                    <p className="app__status">
                        {connected
                            ? `Connected to ${gameId ?? "…"}${sideId ? ` · side ${sideId}` : ""}`
                            : mode
                              ? `Connecting (${mode})…`
                              : "Not connected"}
                    </p>
                </div>
                {connected && (
                    <div className="app__actions">
                        <button type="button" onClick={ping}>
                            Ping
                        </button>
                        <button type="button" onClick={leaveGame}>
                            Leave
                        </button>
                    </div>
                )}
            </header>

            {!connected && (
                <MainMenu
                    defaultGameId={gameId}
                    onCreateGame={startCreate}
                    onJoinGame={startJoin}
                />
            )}

            {connected && mapReady && <HexMapView world={world} />}

            <section className="app__log">
                <h2>Message log</h2>
                <ul>
                    {log.map((line, index) => (
                        <li key={`${index}-${line}`}>{line}</li>
                    ))}
                </ul>
            </section>
        </div>
    );
}
