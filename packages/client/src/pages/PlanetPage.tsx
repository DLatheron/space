import { useCallback, useEffect } from "react";
import { useLocation, useNavigate, useOutletContext, useParams } from "react-router-dom";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld } from "../world/HexWorld.js";
import "./PlanetPage.css";

export type GameOutletContext = {
    world: HexWorld;
};

export function PlanetPage() {
    const { planetId } = useParams<{ planetId: string }>();
    const { world } = useOutletContext<GameOutletContext>();
    const navigate = useNavigate();
    const location = useLocation();
    useHexWorldVersion(world);

    const planet = planetId ? world.findEntity(planetId, "planet") : undefined;

    const back = useCallback(() => {
        navigate({ pathname: "/", search: location.search });
    }, [navigate, location.search]);

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape") back();
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [back]);

    return (
        <div className="planet-page">
            <section className="planet-page__panel">
                <header className="planet-page__header">
                    <h2>{planet?.name ?? "Unknown planet"}</h2>
                    <button type="button" onClick={back}>
                        Back to map
                    </button>
                </header>
                <dl className="planet-page__facts">
                    <dt>Id</dt>
                    <dd>
                        <code>{planetId}</code>
                    </dd>
                    <dt>Owner</dt>
                    <dd>{planet ? (planet.sideId ?? "Unclaimed") : "—"}</dd>
                    <dt>System</dt>
                    <dd>{planet?.systemId ?? "—"}</dd>
                    <dt>Location</dt>
                    <dd>{planet ? `${planet.q}, ${planet.r}` : "—"}</dd>
                    <dt>Food</dt>
                    <dd>{planet?.food ?? "—"}</dd>
                    <dt>Industry</dt>
                    <dd>{planet?.industry ?? "—"}</dd>
                </dl>
                {!planet && (
                    <p className="planet-page__muted">
                        This planet is not in your known map (it may be out of sight).
                    </p>
                )}
                <p className="planet-page__muted">Production and management coming soon.</p>
            </section>
        </div>
    );
}
