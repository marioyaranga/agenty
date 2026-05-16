"use client";

import { createContext, useContext } from "react";

type WebGroundingCtx = {
  enabled: boolean;
  toggle: () => void;
};

export const WebGroundingContext = createContext<WebGroundingCtx>({
  enabled: false,
  toggle: () => {},
});

export function useWebGrounding() {
  return useContext(WebGroundingContext);
}
