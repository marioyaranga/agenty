"use client";

import { useCallback, useRef, useState } from "react";

/** Mide el ancho y alto en px del elemento referenciado (ResizeObserver). */
export function useElementSize<T extends HTMLElement>() {
  const [size, setSize] = useState({ width: 0, height: 0 });
  const observerRef = useRef<ResizeObserver | null>(null);

  const ref = useCallback((node: T | null) => {
    observerRef.current?.disconnect();
    observerRef.current = null;
    if (!node) return;

    const update = () => {
      setSize({
        width: Math.max(0, Math.floor(node.clientWidth)),
        height: Math.max(0, Math.floor(node.clientHeight)),
      });
    };

    update();
    const observer = new ResizeObserver(update);
    observer.observe(node);
    observerRef.current = observer;
  }, []);

  return { ref, width: size.width, height: size.height };
}
