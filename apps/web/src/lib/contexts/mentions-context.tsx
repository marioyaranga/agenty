"use client";

import {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
  type ReactNode,
  type MutableRefObject,
} from "react";

export type Mention = {
  id: string;
  name: string;
  type: "document";
};

type MentionsContextValue = {
  mentions: Mention[];
  addMention: (m: Mention) => void;
  removeMention: (id: string) => void;
  clearMentions: () => void;
  mentionsRef: MutableRefObject<Mention[]>;
};

const MentionsContext = createContext<MentionsContextValue | null>(null);

export function MentionsProvider({ children }: { children: ReactNode }) {
  const [mentions, setMentions] = useState<Mention[]>([]);
  const mentionsRef = useRef<Mention[]>([]);

  const addMention = useCallback((m: Mention) => {
    setMentions((prev) => {
      if (prev.some((p) => p.id === m.id)) return prev;
      const next = [...prev, m];
      mentionsRef.current = next;
      return next;
    });
  }, []);

  const removeMention = useCallback((id: string) => {
    setMentions((prev) => {
      const next = prev.filter((p) => p.id !== id);
      mentionsRef.current = next;
      return next;
    });
  }, []);

  const clearMentions = useCallback(() => {
    setMentions([]);
    mentionsRef.current = [];
  }, []);

  return (
    <MentionsContext value={{ mentions, addMention, removeMention, clearMentions, mentionsRef }}>
      {children}
    </MentionsContext>
  );
}

export function useMentions() {
  const ctx = useContext(MentionsContext);
  if (!ctx) throw new Error("useMentions debe usarse dentro de MentionsProvider");
  return ctx;
}
