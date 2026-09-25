import { ClientId } from "@space/shared-data";
import { Client } from "./Client.js";

export class ClientManager {
    private readonly _clients = new Map<ClientId, Client>();

    get clients(): Client[] {
        return Array.from(this._clients.values());
    }

    addClient(client: Client): void {
        this._clients.set(client.id, client);
    }

    removeClient(clientId: ClientId): boolean {
        return this._clients.delete(clientId);
    }

    getClient(clientId: ClientId): Client {
        const client = this.findClient(clientId);
        if (!client) {
            throw new Error(`Client not found: ${clientId}`);
        }
        return client;
    }

    findClient(clientId: ClientId): Client | undefined {
        return this._clients.get(clientId);
    }
}
