import { useContext, useEffect, useId, useRef, type MouseEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { ModalHostContext } from "./modalHost.js";
import "./Modal.css";

type ModalProps = {
    title: ReactNode;
    onClose: () => void;
    children: ReactNode;
    /** Pinned under the title, above the scrolling body (e.g. a priority picker). */
    toolbar?: ReactNode;
    className?: string;
};

/**
 * Popup over the current screen: closes on its X, Escape or a click on its own backdrop, and
 * swallows both so the screen underneath stays open. Only the body scrolls.
 */
export function Modal({ title, onClose, children, toolbar, className }: ModalProps) {
    const host = useContext(ModalHostContext);
    const titleId = useId();
    const panelRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        // Capture phase on window runs before (and stops) screens' own Escape handlers.
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            e.preventDefault();
            e.stopPropagation();
            onClose();
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [onClose]);

    useEffect(() => {
        panelRef.current?.focus();
    }, []);

    // Only a press that starts and ends on the backdrop closes, so a drag out of the panel doesn't.
    const pressedBackdrop = useRef(false);
    const onBackdropMouseDown = (e: MouseEvent) => {
        pressedBackdrop.current = e.target === e.currentTarget;
    };
    const onBackdropClick = (e: MouseEvent) => {
        if (pressedBackdrop.current && e.target === e.currentTarget) onClose();
        pressedBackdrop.current = false;
    };

    return createPortal(
        <div className="modal" onMouseDown={onBackdropMouseDown} onClick={onBackdropClick}>
            <div
                ref={panelRef}
                className={`modal__panel${className ? ` ${className}` : ""}`}
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header className="modal__header">
                    <h2 id={titleId}>{title}</h2>
                    <button
                        type="button"
                        className="modal__close"
                        aria-label="Close"
                        title="Close (Esc)"
                        onClick={onClose}
                    >
                        ×
                    </button>
                </header>
                {toolbar && <div className="modal__toolbar">{toolbar}</div>}
                <div className="modal__body">{children}</div>
            </div>
        </div>,
        host ?? document.body
    );
}
