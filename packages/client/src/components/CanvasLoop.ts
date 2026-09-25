import type { RefObject } from "react";

export interface CanvasLoopProps {
    canvas: HTMLCanvasElement;
    context: CanvasRenderingContext2D;

    offscreenCanvases: OffscreenCanvas[];
    offscreenContexts: OffscreenCanvasRenderingContext2D[];

    frameDelta: number;
    time: number;
}

export function CanvasLoop(
    canvasRef: RefObject<HTMLCanvasElement | null>,
    loopFn?: (props: CanvasLoopProps) => void
) {
    const canvas = canvasRef.current;
    if (!canvas) {
        return () => {};
    }
    const context = canvas.getContext("2d");
    if (!context) {
        return () => {};
    }

    const offscreenCanvases = [
        new OffscreenCanvas(canvas.width, canvas.height),
        new OffscreenCanvas(canvas.width, canvas.height)
    ];

    const offscreenContexts = [
        offscreenCanvases[0].getContext("2d")!,
        offscreenCanvases[1].getContext("2d")!
    ];

    let accumulatedTime = 0;
    let raf = 0;
    let cancelled = false;

    function loop(time: number): void {
        if (cancelled) return;
        const frameDelta = time - accumulatedTime;

        loopFn?.({
            canvas: canvas!,
            context: context!,
            offscreenCanvases,
            offscreenContexts,
            frameDelta,
            time
        });

        accumulatedTime = time;
        raf = requestAnimationFrame(loop);
    }

    raf = requestAnimationFrame(loop);

    return () => {
        cancelled = true;
        cancelAnimationFrame(raf);
    };
}
