import { useCallback, useEffect, useState } from "react";
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
import "./App.css";

export function App() {
    const { clientId } = useClientId();
    const [searchParams, setSearchParams] = useSearchParams();
    const validatedSearchParams = parseURLSearchParams(ClientQueryParams, searchParams);
    const { name, mode } = validatedSearchParams;
    const clientName = name ?? "Pilot";

    const [log, setLog] = useState<string[]>([]);
    const [lastPong, setLastPong] = useState<number | null>(null);

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
                setLastPong(payload.nonce);
                appendLog(`pong — nonce ${payload.nonce}`);
            }),
            messageManager.registerHandler("server:client:connected", (_ctx, payload) => {
                appendLog(`client connected — ${payload.client.name} (${payload.client.id})`);
            }),
            messageManager.registerHandler("server:client:disconnected", (_ctx, payload) => {
                appendLog(`client disconnected — ${payload.client.name} (${payload.client.id})`);
            }),
            messageManager.registerHandler("server:error", (_ctx, payload) => {
                appendLog(`error — ${payload.message}`);
            })
        ];

        return () => {
            messageManager.unregisterHandlers(handles);
        };
    }, [messageManager, appendLog]);

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
                <h1>Space</h1>
                <p className="app__status">
                    {connected
                        ? `Connected to ${gameId ?? "…"}`
                        : mode
                          ? `Connecting (${mode})…`
                          : "Not connected"}
                </p>
            </header>

            {!connected && (
                <MainMenu
                    defaultGameId={gameId}
                    onCreateGame={startCreate}
                    onJoinGame={startJoin}
                />
            )}

            {connected && (
                <section className="app__game">
                    <p>
                        Client: <code>{clientId}</code>
                    </p>
                    <p>
                        Game: <code>{gameId}</code>
                    </p>
                    {lastPong !== null && (
                        <p>
                            Last pong: <code>{lastPong}</code>
                        </p>
                    )}
                    <div className="app__actions">
                        <button type="button" onClick={ping}>
                            Ping
                        </button>
                        <button type="button" onClick={leaveGame}>
                            Leave
                        </button>
                    </div>
                </section>
            )}

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
