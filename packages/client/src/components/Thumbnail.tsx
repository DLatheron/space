import { useState } from "react";
import "./Thumbnail.css";

export type ThumbnailSize = "sm" | "md" | "lg" | "banner" | "fill";

type ThumbnailProps = {
    src: string | undefined;
    /** Name of what is pictured; its initials stand in when there is no image. */
    label: string;
    size?: ThumbnailSize;
    /** Colour of the initials badge. */
    tone?: "default" | "research";
    className?: string;
};

function initials(label: string): string {
    const words = label.split(/[\s_-]+/).filter(Boolean);
    const letters =
        words.length > 1 ? words[0]!.charAt(0) + words[1]!.charAt(0) : label.slice(0, 2);
    return letters.toUpperCase();
}

/** Decorative picture (the name is always shown beside it); never renders a broken image. */
export function Thumbnail({
    src,
    label,
    size = "md",
    tone = "default",
    className
}: ThumbnailProps) {
    const [failedSrc, setFailedSrc] = useState<string>();
    const classes = `thumbnail thumbnail--${size}${className ? ` ${className}` : ""}`;
    if (!src || failedSrc === src) {
        return (
            <span
                className={`${classes} thumbnail--fallback thumbnail--${tone}`}
                aria-hidden="true"
            >
                {initials(label)}
            </span>
        );
    }
    return (
        <img
            className={classes}
            src={src}
            alt=""
            loading="lazy"
            decoding="async"
            draggable={false}
            onError={() => setFailedSrc(src)}
        />
    );
}
