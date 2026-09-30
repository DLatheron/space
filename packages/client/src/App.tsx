import { useCallback, useEffect, useMemo, useState } from "react";
import { Outlet, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import {
    buildItemName,
    ClientQueryParams,
    GameId,
    parseURLSearchParams,
    ServerToClientMessage,
    sumResources
} from "@space/shared-data";
import { GameSocket } from "./GameSocket.js";
import type { GameActions } from "./gameActions.js";
import { Server, useClientId, useServerMessageManager, useServerSocket } from "./hooks/index.js";
import { MainMenu } from "./pages/MainMenu.js";
import type { GameOutletContext } from "./pages/PlanetPage.js";
import { HexMapView } from "./components/HexMapView.js";
import { BattleDialog } from "./components/BattleDialog.js";
import { formatResources } from "./components/format.js";
import { ResourceBar } from "./components/ResourceBar.js";
import { InfoPane } from "./components/InfoPane.js";
import { HexWorld, type HexClickAction } from "./world/HexWorld.js";
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
    const navigate = useNavigate();
    const location = useLocation();

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
                    `map init — ${payload.width}×${payload.height}, side ${payload.sideId}, ${payload.visible.length} visible, turn ${payload.turn.turn}`
                );
            }),
            messageManager.registerHandler("server:economy:state", (_ctx, payload) => {
                world.applyEconomyState(payload);
                const total = sumResources(payload.locations.map((l) => l.stockpile));
                const transit = sumResources(payload.supplyShips.map((s) => s.cargo));
                appendLog(
                    `economy — ${formatResources(total)} across ${payload.locations.length} locations, ${formatResources(transit)} in transit on ${payload.supplyShips.length} supply ships, ships ${payload.shipCount}/${payload.shipCap}`
                );
            }),
            messageManager.registerHandler("server:tiles:update", (_ctx, payload) => {
                world.applyTilesUpdate(payload);
                appendLog(
                    `tiles update — ${payload.tiles.length} tiles, ${payload.visible.length} visible`
                );
            }),
            messageManager.registerHandler("server:turn:state", (_ctx, payload) => {
                world.applyTurnState(payload);
                setSideId(payload.yourSideId);
                const ready = Object.entries(payload.sideReady)
                    .map(([side, isReady]) => `${side}:${isReady ? "ready" : "…"}`)
                    .join(" ");
                appendLog(`turn state — turn ${payload.turn} ${ready}`);
            }),
            messageManager.registerHandler("server:ship:moved", (_ctx, payload) => {
                world.applyShipMoved(payload);
                appendLog(
                    `ship moved — ${payload.shipId} ${payload.from.q},${payload.from.r} → ${payload.to.q},${payload.to.r} in ${payload.path.length} steps (MP ${payload.movementPoints})`
                );
            }),
            messageManager.registerHandler("server:battle:start", (_ctx, payload) => {
                world.applyBattleStart(payload);
                appendLog(
                    `battle start — ${payload.attackerSideId} vs ${payload.defenderSideId} at ${payload.q},${payload.r}${payload.youAreAttacker ? " (you attack)" : ""}`
                );
            }),
            messageManager.registerHandler("server:battle:resolved", (_ctx, payload) => {
                world.applyBattleResolved(payload);
                appendLog(
                    `battle resolved — ${payload.winnerSideId} wins at ${payload.q},${payload.r}, destroyed ${payload.destroyedShipIds.join(", ") || "nothing"}${payload.destroyedUnitIds.length ? ` and units ${payload.destroyedUnitIds.join(", ")}` : ""}`
                );
            }),
            messageManager.registerHandler("server:supply:moved", (_ctx, payload) => {
                world.applySupplyMoved(payload);
                appendLog(
                    `supply moved — ${payload.supplyShipId} ${payload.from.q},${payload.from.r} → ${payload.to.q},${payload.to.r} in ${payload.path.length} steps`
                );
            }),
            messageManager.registerHandler("server:ground:start", (_ctx, payload) => {
                world.applyGroundStart(payload);
                appendLog(
                    `ground battle start — ${payload.attackerSideId} invades ${payload.locationId}${payload.youAreAttacker ? " (you attack)" : ""}`
                );
            }),
            messageManager.registerHandler("server:ground:resolved", (_ctx, payload) => {
                world.applyGroundResolved(payload);
                appendLog(
                    `ground battle resolved — ${payload.winnerSideId} wins at ${payload.locationId}${payload.captured ? " (captured)" : ""}, destroyed ${payload.destroyedUnitIds.join(", ") || "nothing"}`
                );
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

    const endTurn = useCallback(() => {
        sendMessage({ type: "client:turn:end", payload: {} });
        world.markOwnSideReady();
        appendLog("end turn");
    }, [sendMessage, world, appendLog]);

    const actions = useMemo<GameActions>(
        () => ({
            build: (locationId, item, priority) => {
                sendMessage({
                    type: "client:location:build",
                    payload: { locationId, item, priority }
                });
                appendLog(`build — ${buildItemName(item)} on ${locationId} (${priority})`);
            },
            cancel: (locationId, orderId) => {
                sendMessage({ type: "client:location:cancel", payload: { locationId, orderId } });
                appendLog(`cancel — order ${orderId} on ${locationId}`);
            },
            setPriority: (locationId, orderId, priority) => {
                sendMessage({
                    type: "client:order:priority",
                    payload: { locationId, orderId, priority }
                });
                appendLog(`priority — order ${orderId} on ${locationId} → ${priority}`);
            },
            moveOrder: (locationId, orderId, direction) => {
                sendMessage({
                    type: "client:order:move",
                    payload: { locationId, orderId, direction }
                });
                appendLog(`move — order ${orderId} on ${locationId} ${direction}`);
            },
            colonise: (locationId, shipId) => {
                sendMessage({ type: "client:location:colonise", payload: { locationId, shipId } });
                appendLog(`colonise — ${locationId} with ${shipId}`);
            },
            load: (shipId, unitIds) => {
                sendMessage({ type: "client:unit:load", payload: { shipId, unitIds } });
                appendLog(`load — ${unitIds.join(", ")} onto ${shipId}`);
            },
            unload: (shipId, locationId, unitIds) => {
                sendMessage({
                    type: "client:unit:unload",
                    payload: { shipId, locationId, unitIds }
                });
                appendLog(`unload — ${unitIds.join(", ")} from ${shipId} to ${locationId}`);
            },
            invade: (locationId, shipIds) => {
                sendMessage({ type: "client:invade", payload: { locationId, shipIds } });
                appendLog(`invade — ${locationId} from ${shipIds.join(", ")}`);
            },
            resolveBattle: (battleId, winnerSideId) => {
                sendMessage({ type: "client:battle:resolve", payload: { battleId, winnerSideId } });
                appendLog(`resolve battle — ${battleId} → ${winnerSideId} wins`);
            },
            resolveGroundBattle: (battleId, winnerSideId) => {
                sendMessage({ type: "client:ground:resolve", payload: { battleId, winnerSideId } });
                appendLog(`resolve ground battle — ${battleId} → ${winnerSideId} wins`);
            }
        }),
        [sendMessage, appendLog]
    );

    const outletContext = useMemo<GameOutletContext>(() => ({ world, actions }), [world, actions]);

    const openLocation = useCallback(
        (locationId: string) => {
            navigate({
                pathname: `/location/${encodeURIComponent(locationId)}`,
                search: location.search
            });
        },
        [navigate, location.search]
    );

    const onMapAction = useCallback(
        (action: HexClickAction) => {
            switch (action.type) {
                case "move":
                    sendMessage({
                        type: "client:ship:move",
                        payload: { shipId: action.shipId, to: action.to }
                    });
                    appendLog(`move — ${action.shipId} → ${action.to.q},${action.to.r}`);
                    break;
                case "open-location":
                    openLocation(action.locationId);
                    break;
                case "inspect":
                    appendLog(`inspect — ${action.entityId}`);
                    break;
                case "select":
                case "deselect":
                case "none":
                    break;
            }
        },
        [sendMessage, appendLog, openLocation]
    );

    useEffect(() => {
        if (!connected && location.pathname !== "/") {
            navigate({ pathname: "/", search: location.search }, { replace: true });
        }
    }, [connected, location.pathname, location.search, navigate]);

    const inGame = connected && mapReady;

    return (
        <div className={`app${inGame ? " app--game" : ""}`}>
            {!inGame && (
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
                </header>
            )}

            {!connected && (
                <MainMenu
                    defaultGameId={gameId}
                    onCreateGame={startCreate}
                    onJoinGame={startJoin}
                />
            )}

            {inGame && (
                <div className="app__game">
                    <div className="app__map-stage">
                        <HexMapView world={world} onAction={onMapAction} />
                        <ResourceBar world={world} />
                        <div className="app__map-chrome">
                            <p className="app__status app__status--overlay">
                                {gameId ?? "…"}
                                {sideId ? ` · ${sideId}` : ""}
                            </p>
                            <div className="app__actions">
                                <button type="button" onClick={ping}>
                                    Ping
                                </button>
                                <button type="button" onClick={leaveGame}>
                                    Leave
                                </button>
                            </div>
                        </div>
                        <BattleDialog
                            world={world}
                            onResolve={actions.resolveBattle}
                            onResolveGround={actions.resolveGroundBattle}
                        />
                        <Outlet context={outletContext} />
                    </div>
                    <InfoPane
                        world={world}
                        onEndTurn={endTurn}
                        actions={actions}
                        onOpenLocation={openLocation}
                    />
                </div>
            )}

            {!inGame && (
                <section className="app__log">
                    <h2>Message log</h2>
                    <ul>
                        {log.map((line, index) => (
                            <li key={`${index}-${line}`}>{line}</li>
                        ))}
                    </ul>
                </section>
            )}
        </div>
    );
}
