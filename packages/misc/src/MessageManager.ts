import { v4 as uuidv4 } from "uuid";

interface Message {
    type: string;
    payload?: unknown;
}

interface HandlerEntry<CONTEXT extends object, MESSAGE extends Message, FROM> {
    id: HandlerId;
    handler: MessageHandler<CONTEXT, MESSAGE, FROM>;
}

type HandlerId = string;

export type HandlerHandle<MESSAGE extends Message, K extends MESSAGE["type"]> = [K, HandlerId];

/**
 * NOTE: K parameter is special because it allows registerHandle to tightly specific the type of the handler function
 * it sends to be the same as the type. Without it, in this circumstance, typescript cannot sufficiently narrow the type.
 */
type MessageHandler<
    CONTEXT extends object,
    MESSAGE extends Message,
    FROM,
    K extends MESSAGE["type"] = MESSAGE["type"]
> = (
    context: CONTEXT,
    payload: Extract<MESSAGE, { type: K }>["payload"],
    from: FROM
) => void | Promise<void>;

export class MessageManager<
    CONTEXT extends object,
    MESSAGE extends Message,
    FROM extends object = never
> {
    private readonly _received: { message: MESSAGE; from: FROM }[];
    private readonly _context: CONTEXT;
    private readonly _messageHandlers: Map<MESSAGE["type"], HandlerEntry<CONTEXT, MESSAGE, FROM>[]>;

    private _processingMessages: boolean;

    constructor(context: CONTEXT) {
        this._received = [];
        this._context = context;
        this._messageHandlers = new Map<MESSAGE["type"], HandlerEntry<CONTEXT, MESSAGE, FROM>[]>();
        this._processingMessages = false;
    }

    get isProcessing() {
        return this._processingMessages;
    }

    get length() {
        return this._received.length + (this.isProcessing ? 1 : 0);
    }

    private findMessageHandlerEntries(
        type: MESSAGE["type"]
    ): HandlerEntry<CONTEXT, MESSAGE, FROM>[] | undefined {
        return this._messageHandlers.get(type);
    }

    private async processNextMessage() {
        let entry: { message: MESSAGE; from: FROM } | undefined;

        this._processingMessages = true;
        try {
            while ((entry = this._received.shift())) {
                const { message, from } = entry;

                const { type } = message;
                // An unhandled type must not abort the loop: that would strand every
                // message queued behind it.
                const messageHandlerEntries = this.findMessageHandlerEntries(type) ?? [];
                if (messageHandlerEntries.length === 0) {
                    console.warn("No message handler(s) registered for", type);
                    continue;
                }

                console.info("+++ Processing message", message.type, message.payload);
                for (const { handler } of messageHandlerEntries) {
                    try {
                        await handler(this._context, message.payload, from);
                    } catch (error) {
                        console.error(
                            "Error processing message",
                            message.type,
                            message.payload,
                            error
                        );
                    }
                }
                console.info("--- Processed message", message.type, message.payload);
            }
        } finally {
            this._processingMessages = false;
        }
    }

    /**
     * Register a new message handler and returns a typle of its type and id for easy
     * unregistering.
     */
    registerHandler<TYPE extends MESSAGE["type"]>(
        type: TYPE,
        handler: MessageHandler<CONTEXT, MESSAGE, FROM, TYPE>
    ): HandlerHandle<MESSAGE, TYPE> {
        const handlerId = uuidv4();

        const existingHandlers = this.findMessageHandlerEntries(type) ?? [];
        existingHandlers.push({ id: handlerId, handler });
        this._messageHandlers.set(type, existingHandlers);

        console.info("Registered message handler for type", type, "id", handlerId);
        return [type, handlerId];
    }

    /**
     * Unregister an existing handler from the manager (returns `true` is handler was found and removed, otherwise
     * `false`).
     */
    unregisterHandler<TYPE extends MESSAGE["type"]>([type, handleId]: HandlerHandle<
        MESSAGE,
        TYPE
    >): boolean {
        const existingHandlers = this.findMessageHandlerEntries(type);
        if (!existingHandlers) {
            return false;
        }

        const filteredHandlers = existingHandlers.filter(({ id }) => id !== handleId);
        if (filteredHandlers.length === existingHandlers.length) {
            return false;
        }

        this._messageHandlers.set(type, filteredHandlers);

        console.info("Unregistered message handler for type", type, "id", handleId);

        return true;
    }

    /**
     * Unregisters an array of registered handlers, returning an array of booleans where `true` indicates that
     * the handler was removed, otherwise `false`.
     */
    unregisterHandlers<TYPE extends MESSAGE["type"]>(
        registeredHandlers: HandlerHandle<MESSAGE, TYPE>[]
    ): boolean[] {
        return registeredHandlers.map((registeredHandler) =>
            this.unregisterHandler(registeredHandler)
        );
    }

    /**
     * Queue a new message for processing.
     */
    enqueueMessage(message: MESSAGE, from: FROM) {
        console.info(">>> Enqueuing message", message.type, message.payload);
        this._received.push({ message, from });

        if (this.isProcessing === false) {
            // Intentionally not awaited!
            this.processNextMessage();
        }
    }
}
