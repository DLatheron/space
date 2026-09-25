import {
    ClientId,
    ClientQueryParams,
    CreateGameResponseBody,
    GameId,
    JoinGameResponseBody,
    parseURLSearchParams
} from "@space/shared-data";
import { useCallback, useEffect, useRef, useState } from "react";
import { GameSocket } from "../GameSocket.js";
import { useSearchParams } from "react-router-dom";

type CreateGameOptions = {
    signal?: AbortSignal;
};

type JoinGameOptions = {
    signal?: AbortSignal;
};

export interface ServerSocketOptions {
    clientId?: ClientId;
    clientName: string;

    onConnected?: (gameSocket: GameSocket) => void;
    onDisconnected?: (unexpected: boolean) => void;

    onMessage?: (data: unknown) => void;

    createGameRetryIntervalInMs?: number;
    joinGameRetryIntervalInMs?: number;
}

async function throwErrorResponse(res: Response): Promise<never> {
    const data: unknown = await res.json().catch(() => ({}));

    const message =
        typeof data === "object" &&
        data !== null &&
        "error" in data &&
        typeof (data as { error: unknown }).error === "string"
            ? (data as { error: string }).error
            : `Request failed (${res.status})`;
    console.error(message);
    throw new Error(message);
}

async function createGame({
    clientId,
    name,
    options
}: {
    clientId: ClientId;
    name: string;
    options: CreateGameOptions;
}): Promise<CreateGameResponseBody> {
    const { signal } = options;

    const res = await fetch("/api/game/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, name }),
        signal
    });

    if (!res.ok) {
        await throwErrorResponse(res);
    }

    const data: unknown = await res.json().catch(() => ({}));
    return CreateGameResponseBody.parse(data);
}

async function joinGame({
    gameId,
    clientId,
    name,
    options
}: {
    gameId: GameId;
    clientId: ClientId;
    name: string;
    options: JoinGameOptions;
}): Promise<JoinGameResponseBody> {
    const { signal } = options;

    const res = await fetch("/api/game/join", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ gameId, clientId, name }),
        signal
    });

    if (!res.ok) {
        await throwErrorResponse(res);
    }

    const data: unknown = await res.json().catch(() => ({}));
    return JoinGameResponseBody.parse(data);
}

export function useServerSocket(options: ServerSocketOptions) {
    const {
        clientId,
        clientName,
        onConnected,
        onDisconnected,
        onMessage,
        createGameRetryIntervalInMs = 2500,
        joinGameRetryIntervalInMs = 2500
    } = options;

    const [searchParams, setSearchParams] = useSearchParams();
    const validatedSearchParams = parseURLSearchParams(ClientQueryParams, searchParams);
    const { "game-id": gameId, mode } = validatedSearchParams;

    const [connected, setConnected] = useState(false);

    const gameSocketRef = useRef<GameSocket>(null);
    const abortControllerRef = useRef<AbortController>(null);
    const connectionGenerationRef = useRef(0);
    const connectAttemptInFlightRef = useRef(false);

    const handleCreateGameRef = useRef<(clientId: ClientId) => Promise<void>>(async () => {});
    const handleJoinGameRef = useRef<(gameId: GameId, clientId: ClientId) => Promise<void>>(
        async () => {}
    );

    const isCurrentConnection = useCallback((generation: number) => {
        return generation === connectionGenerationRef.current;
    }, []);

    const beginConnectAttempt = useCallback(() => {
        connectionGenerationRef.current += 1;
        connectAttemptInFlightRef.current = true;

        abortControllerRef.current?.abort();
        gameSocketRef.current?.disconnect();
        gameSocketRef.current = null;
        setConnected(false);

        return connectionGenerationRef.current;
    }, []);

    const clearConnectAttemptInFlight = useCallback(
        (generation: number) => {
            if (isCurrentConnection(generation)) {
                connectAttemptInFlightRef.current = false;
            }
        },
        [isCurrentConnection]
    );

    const createSocket = useCallback(
        ({
            gameId,
            clientId,
            generation,
            onOpen,
            onClose,
            onMessage,
            signal
        }: {
            gameId: GameId;
            clientId: ClientId;
            generation: number;
            onOpen: (gameSocket: GameSocket) => void;
            onClose: (unexpected: boolean) => void;
            onMessage: (data: unknown) => void;
            signal?: AbortSignal;
        }): GameSocket => {
            if (!gameId || !clientId) {
                throw new Error("gameId and clientId must set to create a socket");
            }

            const gameSocket = new GameSocket(gameId, clientId);
            console.info("Socket created for", gameId, "from", clientId);

            gameSocket.connect({
                onOpen: () => {
                    if (!isCurrentConnection(generation) || signal?.aborted) {
                        return;
                    }

                    onOpen(gameSocket);
                },
                onClose: () => {
                    if (!isCurrentConnection(generation)) {
                        return;
                    }

                    if (signal?.aborted) {
                        onClose(false);
                    } else {
                        onClose(true);
                    }
                },
                onMessage: (data) => {
                    if (!isCurrentConnection(generation)) {
                        return;
                    }

                    onMessage(data);
                },
                signal
            });

            return gameSocket;
        },
        [isCurrentConnection]
    );

    const handleCreateGame = useCallback(
        async (clientId: ClientId) => {
            console.info("Attempting to create game");

            const generation = beginConnectAttempt();

            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            try {
                const { gameId: createdGameId } = await createGame({
                    clientId,
                    name: clientName,
                    options: { signal: abortController.signal }
                });

                if (!isCurrentConnection(generation)) {
                    return;
                }

                setSearchParams((searchParams) => {
                    searchParams.set("game-id", createdGameId);
                    return searchParams;
                });
                console.info(`Created game with id: ${createdGameId}`);

                const gameSocket = createSocket({
                    gameId: createdGameId,
                    clientId,
                    generation,
                    onOpen: (gameSocket: GameSocket) => {
                        console.info("Socket connected");
                        setConnected(true);
                        clearConnectAttemptInFlight(generation);
                        onConnected?.(gameSocket);
                    },
                    onClose: (unexpected) => {
                        console.info("Socket closed", unexpected && "unexpectedly");
                        setConnected(false);
                        clearConnectAttemptInFlight(generation);
                        onDisconnected?.(unexpected);
                    },
                    onMessage: (data: unknown) => onMessage?.(data),
                    signal: abortController.signal
                });

                if (!isCurrentConnection(generation)) {
                    gameSocket.disconnect();
                    return;
                }

                gameSocketRef.current = gameSocket;
            } catch (error) {
                clearConnectAttemptInFlight(generation);
                if (isCurrentConnection(generation)) {
                    console.error("Failed to create game because:", error);
                }
                throw error;
            }
        },
        [
            beginConnectAttempt,
            clearConnectAttemptInFlight,
            createSocket,
            isCurrentConnection,
            setSearchParams,
            onConnected,
            onDisconnected,
            onMessage,
            clientName
        ]
    );

    handleCreateGameRef.current = handleCreateGame;

    useEffect(() => {
        if (connected || mode !== "create" || !clientId) {
            return;
        }

        let cancelled = false;

        const tryCreateGame = () => {
            if (cancelled || connectAttemptInFlightRef.current) {
                return;
            }

            handleCreateGameRef.current(clientId).catch((error) => {
                console.error("Create failed with", error);
            });
        };

        const createGameTimer = window.setInterval(tryCreateGame, createGameRetryIntervalInMs);
        tryCreateGame();

        return () => {
            cancelled = true;
            clearInterval(createGameTimer);
        };
    }, [connected, clientId, mode, createGameRetryIntervalInMs]);

    const handleJoinGame = useCallback(
        async (gameId: GameId, clientId: ClientId) => {
            console.info("Attempting to join game");

            const generation = beginConnectAttempt();

            const abortController = new AbortController();
            abortControllerRef.current = abortController;

            try {
                const { gameId: joinedGameId } = await joinGame({
                    gameId,
                    clientId,
                    name: clientName,
                    options: { signal: abortController.signal }
                });

                if (!isCurrentConnection(generation)) {
                    return;
                }

                setSearchParams((searchParams) => {
                    searchParams.set("game-id", joinedGameId);
                    return searchParams;
                });
                console.info(`Joined game with id: ${joinedGameId}`);

                const gameSocket = createSocket({
                    gameId: joinedGameId,
                    clientId,
                    generation,
                    onOpen: (gameSocket: GameSocket) => {
                        console.info("Socket connected");
                        setConnected(true);
                        clearConnectAttemptInFlight(generation);
                        onConnected?.(gameSocket);
                    },
                    onClose: (unexpected) => {
                        console.info("Socket closed", unexpected && "unexpectedly");
                        setConnected(false);
                        clearConnectAttemptInFlight(generation);
                        onDisconnected?.(unexpected);
                    },
                    onMessage: (data: unknown) => onMessage?.(data),
                    signal: abortController.signal
                });

                if (!isCurrentConnection(generation)) {
                    gameSocket.disconnect();
                    return;
                }

                gameSocketRef.current = gameSocket;
            } catch (error) {
                clearConnectAttemptInFlight(generation);
                if (isCurrentConnection(generation)) {
                    console.error(`Failed to join game ${gameId} because:`, error);
                }
                throw error;
            }
        },
        [
            beginConnectAttempt,
            clearConnectAttemptInFlight,
            createSocket,
            isCurrentConnection,
            setSearchParams,
            onConnected,
            onDisconnected,
            onMessage,
            clientName
        ]
    );

    handleJoinGameRef.current = handleJoinGame;

    useEffect(() => {
        if (connected || mode !== "join" || !clientId || !gameId) {
            return;
        }

        let cancelled = false;

        const tryJoinGame = () => {
            if (cancelled || connectAttemptInFlightRef.current) {
                return;
            }

            handleJoinGameRef.current(gameId, clientId).catch((error) => {
                console.error("Join failed with", error);
            });
        };

        const joinGameTimer = window.setInterval(tryJoinGame, joinGameRetryIntervalInMs);
        tryJoinGame();

        return () => {
            cancelled = true;
            clearInterval(joinGameTimer);
        };
    }, [connected, gameId, clientId, mode, joinGameRetryIntervalInMs]);

    useEffect(() => {
        return () => {
            connectionGenerationRef.current += 1;
            abortControllerRef.current?.abort();

            gameSocketRef.current?.disconnect();
            gameSocketRef.current = null;
        };
    }, []);

    const leaveGame = useCallback(() => {
        connectionGenerationRef.current += 1;
        connectAttemptInFlightRef.current = false;

        const hadSocket = gameSocketRef.current !== null;

        abortControllerRef.current?.abort();
        gameSocketRef.current?.disconnect();
        gameSocketRef.current = null;

        setSearchParams((searchParams) => {
            searchParams.delete("mode");
            searchParams.delete("game-id");
            return searchParams;
        });

        setConnected(false);

        if (!hadSocket) {
            onDisconnected?.(false);
        }
    }, [onDisconnected, setSearchParams]);

    return {
        connected,
        gameId,
        createGame: useCallback(() => {
            if (!clientId) {
                throw new Error("clientId must be set");
            }
            handleCreateGame(clientId);
        }, [clientId, handleCreateGame]),
        joinGame: useCallback(
            (gameId: GameId) => {
                if (!clientId) {
                    throw new Error("clientId must be set");
                }
                handleJoinGame(gameId, clientId);
            },
            [clientId, handleJoinGame]
        ),
        leaveGame
    };
}
