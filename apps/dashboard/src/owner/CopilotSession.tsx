import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Hex, PrivateKeyAccount } from 'viem';
import type { SellSession } from '../../../../packages/core/src/copilot.js';
import { LedgerContext } from './LedgerContext.js';
function useLocalSession() {
  const sessionKey = useRef<PrivateKeyAccount | undefined>(undefined);
  const delegation = useRef<SellSession | undefined>(undefined);
  const [ownerSignature, setOwnerSignature] = useState<Hex>();
  const clear = useCallback(() => {
    sessionKey.current = undefined;
    delegation.current = undefined;
    setOwnerSignature(undefined);
  }, []);
  return { sessionKey, delegation, ownerSignature, setOwnerSignature, clear };
}
const SessionContext = createContext<ReturnType<typeof useLocalSession> | null>(
  null,
);
export function CopilotSessionProvider({ children }: { children: ReactNode }) {
  const session = useLocalSession(),
    address = useContext(LedgerContext)?.address;
  useEffect(() => {
    session.clear();
    return () => {
      session.sessionKey.current = undefined;
      session.delegation.current = undefined;
    };
  }, [address, session.clear]);
  return (
    <SessionContext.Provider value={session}>
      {children}
    </SessionContext.Provider>
  );
}
export function useCopilotSession() {
  const shared = useContext(SessionContext),
    local = useLocalSession();
  return shared ?? local;
}
