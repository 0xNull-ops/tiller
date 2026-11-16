import { createContext, useContext, useState, type ReactNode } from "react";

type Connection = { source: string; target: string } | null;
const HoverContext = createContext<{
  connection: Connection;
  setConnection: (connection: Connection) => void;
}>({ connection: null, setConnection: () => {} });
export function WorkflowConnectionHover({ children }: { children: ReactNode }) {
  const [connection, setConnection] = useState<Connection>(null);
  return (
    <HoverContext value={{ connection, setConnection }}>
      <div className="relative flex h-full min-h-0 flex-col">{children}</div>
    </HoverContext>
  );
}
export const useConnectionHover = () => useContext(HoverContext);
