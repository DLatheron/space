import { useEffect, useRef } from "react";
import { useHexWorldVersion } from "../hooks/index.js";
import { HexWorld, type HexClickAction } from "../world/HexWorld.js";
import { ParallaxBackground } from "../world/ParallaxBackground.js";
import { CanvasLoop } from "./CanvasLoop.js";
import "./HexMapView.css";

/** CSS pixels the pointer may travel before a press becomes a pan instead of a click. */
const CLICK_DRAG_THRESHOLD = 5;
const NOTICE_MS = 3500;

type HexMapViewProps = {
    world: HexWorld;
    onAction?: (action: HexClickAction) => void;
};

export function HexMapView({ world, onAction }: HexMapViewProps) {
    useHexWorldVersion(world);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const parallaxRef = useRef(new ParallaxBackground());
    const onActionRef = useRef(onAction);
    const pointerDown = useRef(false);
    const dragging = useRef(false);
    const start = useRef<{ x: number; y: number } | null>(null);
    const last = useRef<{ x: number; y: number } | null>(null);

    useEffect(() => {
        onActionRef.current = onAction;
    }, [onAction]);

    useEffect(() => {
        const parallax = parallaxRef.current;
        parallax.load().catch((error) => {
            console.error("Failed to load parallax textures", error);
        });
    }, []);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const resize = () => {
            const parent = canvas.parentElement;
            const w = parent?.clientWidth ?? window.innerWidth;
            const h = parent?.clientHeight ?? window.innerHeight;
            const dpr = window.devicePixelRatio || 1;
            canvas.width = Math.floor(w * dpr);
            canvas.height = Math.floor(h * dpr);
            canvas.style.width = `${w}px`;
            canvas.style.height = `${h}px`;
        };

        resize();
        window.addEventListener("resize", resize);
        const observer = typeof ResizeObserver !== "undefined" ? new ResizeObserver(resize) : null;
        if (canvas.parentElement && observer) {
            observer.observe(canvas.parentElement);
        }

        const stop = CanvasLoop(canvasRef, ({ canvas, context }) => {
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, canvas.width, canvas.height);
            parallaxRef.current.render(context, canvas);
            world.render(canvas, context);
        });

        return () => {
            stop();
            window.removeEventListener("resize", resize);
            observer?.disconnect();
        };
    }, [world]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const screenFromEvent = (e: PointerEvent) => {
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            return {
                x: (e.clientX - rect.left) * dpr,
                y: (e.clientY - rect.top) * dpr
            };
        };

        const updateHover = (e: PointerEvent) => {
            if (dragging.current) return;
            const hex = world.pickHex(screenFromEvent(e), canvas);
            world.setHoveredHex(hex);
        };

        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            pointerDown.current = true;
            dragging.current = false;
            start.current = { x: e.clientX, y: e.clientY };
            last.current = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!pointerDown.current || !last.current || !start.current) {
                updateHover(e);
                return;
            }
            if (!dragging.current) {
                const travelled = Math.hypot(
                    e.clientX - start.current.x,
                    e.clientY - start.current.y
                );
                if (travelled < CLICK_DRAG_THRESHOLD) return;
                dragging.current = true;
            }
            const dx = e.clientX - last.current.x;
            const dy = e.clientY - last.current.y;
            last.current = { x: e.clientX, y: e.clientY };
            const dpr = window.devicePixelRatio || 1;
            const sdx = dx * dpr;
            const sdy = dy * dpr;
            world.panByScreenDelta(sdx, sdy);
            // Same screen delta drives parallax — not map camera.x/y (zoom-safe).
            parallaxRef.current.panByScreenDelta(sdx, sdy);
        };
        const endPointer = (e: PointerEvent) => {
            const wasClick = pointerDown.current && !dragging.current;
            pointerDown.current = false;
            dragging.current = false;
            start.current = null;
            last.current = null;
            if (canvas.hasPointerCapture(e.pointerId)) {
                canvas.releasePointerCapture(e.pointerId);
            }
            return wasClick;
        };
        const onPointerUp = (e: PointerEvent) => {
            if (!endPointer(e)) {
                updateHover(e);
                return;
            }
            const action = world.handleClick(screenFromEvent(e), canvas);
            onActionRef.current?.(action);
            updateHover(e);
        };
        const onPointerCancel = (e: PointerEvent) => {
            endPointer(e);
        };
        const onPointerLeave = () => {
            if (pointerDown.current) return;
            world.setHoveredHex(null);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && world.hyperjumpTargetingId) {
                world.cancelHyperjumpTargeting();
                return;
            }
            if (e.key === "Escape" && (world.selectedShipId || world.inspectedEntityId)) {
                world.selectShip(null);
                onActionRef.current?.({ type: "deselect" });
            }
        };
        const onWheel = (e: WheelEvent) => {
            e.preventDefault();
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const factor = e.deltaY < 0 ? 1.05 : 1 / 1.05;
            const screen = {
                x: (e.clientX - rect.left) * dpr,
                y: (e.clientY - rect.top) * dpr
            };
            world.zoomAt(factor, screen, canvas);
            parallaxRef.current.zoomAt(factor, screen.x, screen.y);
        };

        canvas.addEventListener("pointerdown", onPointerDown);
        canvas.addEventListener("pointermove", onPointerMove);
        canvas.addEventListener("pointerup", onPointerUp);
        canvas.addEventListener("pointercancel", onPointerCancel);
        canvas.addEventListener("pointerleave", onPointerLeave);
        canvas.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKeyDown);

        return () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerCancel);
            canvas.removeEventListener("pointerleave", onPointerLeave);
            canvas.removeEventListener("wheel", onWheel);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [world]);

    const notice = world.notice;
    useEffect(() => {
        if (!notice) return;
        const timer = window.setTimeout(() => world.clearNotice(notice.id), NOTICE_MS);
        return () => window.clearTimeout(timer);
    }, [world, notice]);

    const targeting = world.hyperjumpTargeting;

    return (
        <div className="hex-map-view">
            <canvas
                ref={canvasRef}
                className={`hex-map-view__canvas${targeting ? " hex-map-view__canvas--targeting" : ""}`}
            />
            {(targeting || notice) && (
                <div className="hex-map-view__banners">
                    {targeting && (
                        <div className="hex-map-view__banner hex-map-view__banner--targeting">
                            <span>
                                Hyperdrive targeting: click an explored hex within range to jump
                                to · Esc to cancel
                            </span>
                            <button type="button" onClick={() => world.cancelHyperjumpTargeting()}>
                                Cancel
                            </button>
                        </div>
                    )}
                    {notice && (
                        <div
                            key={notice.id}
                            className="hex-map-view__banner hex-map-view__banner--notice"
                            role="status"
                        >
                            {notice.text}
                        </div>
                    )}
                </div>
            )}
            <div className="hex-map-view__hint">
                {world.selectedShipId
                    ? "Click any explored hex to move there (multi-turn routes continue at end of turn) · Click the ship's hex to cycle · Esc to deselect"
                    : "Drag to pan · Scroll to zoom · Click to select / inspect (again to cycle) · Esc to clear"}
            </div>
        </div>
    );
}
