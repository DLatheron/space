import { useEffect, useRef } from "react";
import { HexWorld, type HexClickAction } from "../world/HexWorld.js";
import { ParallaxBackground } from "../world/ParallaxBackground.js";
import { CanvasLoop } from "./CanvasLoop.js";
import "./HexMapView.css";

/** CSS pixels the pointer may travel before a press becomes a pan instead of a click. */
const CLICK_DRAG_THRESHOLD = 5;

type HexMapViewProps = {
    world: HexWorld;
    onAction?: (action: HexClickAction) => void;
};

export function HexMapView({ world, onAction }: HexMapViewProps) {
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

        const stop = CanvasLoop(canvasRef, ({ canvas, context }) => {
            context.setTransform(1, 0, 0, 1, 0, 0);
            context.clearRect(0, 0, canvas.width, canvas.height);
            parallaxRef.current.render(context, canvas);
            world.render(canvas, context);
        });

        return () => {
            stop();
            window.removeEventListener("resize", resize);
        };
    }, [world]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onPointerDown = (e: PointerEvent) => {
            if (e.button !== 0) return;
            pointerDown.current = true;
            dragging.current = false;
            start.current = { x: e.clientX, y: e.clientY };
            last.current = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!pointerDown.current || !last.current || !start.current) return;
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
            if (!endPointer(e)) return;
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const screen = {
                x: (e.clientX - rect.left) * dpr,
                y: (e.clientY - rect.top) * dpr
            };
            const action = world.handleClick(screen, canvas);
            onActionRef.current?.(action);
        };
        const onPointerCancel = (e: PointerEvent) => {
            endPointer(e);
        };
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Escape" && world.selectedShipId) {
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
        canvas.addEventListener("wheel", onWheel, { passive: false });
        window.addEventListener("keydown", onKeyDown);

        return () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerCancel);
            canvas.removeEventListener("wheel", onWheel);
            window.removeEventListener("keydown", onKeyDown);
        };
    }, [world]);

    return (
        <div className="hex-map-view">
            <canvas ref={canvasRef} className="hex-map-view__canvas" />
            <div className="hex-map-view__hint">
                Drag to pan · Scroll to zoom · Click ship to select · Click hex to move · Esc to
                deselect
            </div>
        </div>
    );
}
