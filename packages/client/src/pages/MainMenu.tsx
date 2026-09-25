import { useState, type FormEvent } from "react";
import { GameId } from "@space/shared-data";

type MainMenuProps = {
    defaultGameId?: GameId;
    onCreateGame: () => void;
    onJoinGame: (gameId: GameId) => void;
};

export function MainMenu({ defaultGameId, onCreateGame, onJoinGame }: MainMenuProps) {
    const [joinId, setJoinId] = useState(defaultGameId ?? "AAAA-0000");

    const handleJoin = (event: FormEvent) => {
        event.preventDefault();
        const parsed = GameId.safeParse(joinId.trim().toUpperCase());
        if (!parsed.success) {
            console.error("Invalid game id", joinId);
            return;
        }
        onJoinGame(parsed.data);
    };

    return (
        <section className="main-menu">
            <button type="button" onClick={onCreateGame}>
                Create game
            </button>
            <form className="main-menu__join" onSubmit={handleJoin}>
                <label>
                    Game id
                    <input
                        value={joinId}
                        onChange={(event) => setJoinId(event.target.value)}
                        placeholder="XXXX-XXXX"
                        spellCheck={false}
                    />
                </label>
                <button type="submit">Join game</button>
            </form>
            <p className="main-menu__hint">
                Or open with <code>?mode=create</code> / <code>?mode=join&amp;game-id=…</code> to
                auto-connect.
            </p>
        </section>
    );
}
