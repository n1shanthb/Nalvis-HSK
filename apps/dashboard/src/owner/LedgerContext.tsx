import { createContext, useState, type ReactNode } from 'react';
import type { Address } from 'viem';
export const LedgerContext = createContext<
  { address?: Address; setAddress: (address?: Address) => void } | undefined
>(undefined);
export function LedgerProvider({ children }: { children: ReactNode }) {
  const [address, setAddress] = useState<Address>();
  return (
    <LedgerContext.Provider value={{ address, setAddress }}>
      {children}
    </LedgerContext.Provider>
  );
}
