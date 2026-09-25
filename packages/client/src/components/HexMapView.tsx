import { useEffect, useRef } from "react";
import { HexWorld } from "../world/HexWorld.js";
import { ParallaxBackground } from "../world/ParallaxBackground.js";
import { CanvasLoop } from "./CanvasLoop.js";
import "./HexMapView.css";

type HexMapViewProps = {
    world: HexWorld;
};

export function HexMapView({ world }: HexMapViewProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const parallaxRef = useRef(new ParallaxBackground());
    const dragging = useRef(false);
    const last = useRef<{ x: number; y: number } | null>(null);

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

        const stop = CanvasLoop(
            canvasRef,
            ({ canvas, context, offscreenCanvases, offscreenContexts }) => {
                context.setTransform(1, 0, 0, 1, 0, 0);
                context.clearRect(0, 0, canvas.width, canvas.height);
                parallaxRef.current.render(context, canvas);
                world.render(canvas, context, offscreenCanvases, offscreenContexts);
            }
        );

        return () => {
            stop();
            window.removeEventListener("resize", resize);
        };
    }, [world]);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const onPointerDown = (e: PointerEvent) => {
            dragging.current = true;
            last.current = { x: e.clientX, y: e.clientY };
            canvas.setPointerCapture(e.pointerId);
        };
        const onPointerMove = (e: PointerEvent) => {
            if (!dragging.current || !last.current) return;
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
        const onPointerUp = (e: PointerEvent) => {
            dragging.current = false;
            last.current = null;
            canvas.releasePointerCapture(e.pointerId);
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
        canvas.addEventListener("pointercancel", onPointerUp);
        canvas.addEventListener("wheel", onWheel, { passive: false });

        return () => {
            canvas.removeEventListener("pointerdown", onPointerDown);
            canvas.removeEventListener("pointermove", onPointerMove);
            canvas.removeEventListener("pointerup", onPointerUp);
            canvas.removeEventListener("pointercancel", onPointerUp);
            canvas.removeEventListener("wheel", onWheel);
        };
    }, [world]);

    return (
        <div className="hex-map-view">
            <canvas ref={canvasRef} className="hex-map-view__canvas" />
            <div className="hex-map-view__hint">Drag to pan · Scroll to zoom</div>
        </div>
    );
}
