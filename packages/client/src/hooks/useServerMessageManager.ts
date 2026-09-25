import { MessageManager } from "@space/misc";
import { ClientToServerMessage, ServerToClientMessage } from "@space/shared-data";
import { GameSocket } from "../GameSocket.js";
import { useCallback } from "react";

interface Server {
    name: "Server";
}

export const Server: Server = {
    name: "Server"
};

interface ServerMessageContext {
    name: string;
}

const context: ServerMessageContext = {
    name: "Not used at the moment"
};

const globalMessageManager = new MessageManager<
    ServerMessageContext,
    ServerToClientMessage,
    Server
>(context);

let globalGameSocket: GameSocket | null = null;

export function useServerMessageManager() {
    const sendMessage = useCallback((message: ClientToServerMessage) => {
        globalGameSocket?.send(message);
    }, []);
    const setGameSocket = useCallback((gameSocket: GameSocket | null) => {
        globalGameSocket = gameSocket;
    }, []);

    return {
        messageManager: globalMessageManager,
        sendMessage,
        setGameSocket
    };
}
