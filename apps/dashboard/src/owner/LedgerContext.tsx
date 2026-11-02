import { createContext, useState, type ReactNode } from 'react';
import type { Address } from 'viem';
export const LedgerContext = createContext<
  { address?: Address; setAddress: (address?: Address) => void; accountIndex: number; setAccountIndex: (index: number) => void } | undefined
>(undefined);
export function LedgerProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  const [accountIndex, setIndex] = useState(0);
  const setAccountIndex = (index: number) => { setAddress(undefined); setIndex(index); };
  return (
    <LedgerContext.Provider value={{ address, setAddress, accountIndex, setAccountIndex }}>
      {children}
    </LedgerContext.Provider>
  );
}
