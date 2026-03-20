import { useState, useEffect } from "react";
import { useMonitor } from "./hooks/useMonitor";
import { Dashboard } from "./views/Dashboard";
import { TimelinePage } from "./views/TimelinePage";
import { LogPage } from "./views/LogPage";

type Route = "dashboard" | "timeline" | "log";

function hashToRoute(hash: string): Route {
  switch (hash) {
    case "#/timeline":
      return "timeline";
    case "#/log":
      return "log";
    default:
      return "dashboard";
  }
}

function NavLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <a
      href={href}
      className={`px-3 py-1.5 rounded text-sm transition-colors ${
        active
          ? "bg-gray-700 text-white"
          : "text-gray-400 hover:text-gray-200 hover:bg-gray-800"
      }`}
    >
      {children}
    </a>
  );
}

export function App() {
  const [route, setRoute] = useState<Route>(() =>
    hashToRoute(window.location.hash),
  );
  const monitor = useMonitor();

  useEffect(() => {
    function onHashChange() {
      setRoute(hashToRoute(window.location.hash));
    }
    window.addEventListener("hashchange", onHashChange);
    return () => window.removeEventListener("hashchange", onHashChange);
  }, []);

  return (
    <div className="min-h-screen flex flex-col bg-gray-950 text-gray-100">
      <nav className="flex items-center gap-4 px-4 py-2 bg-gray-900 border-b border-gray-800">
        <span className="font-semibold text-lg tracking-tight mr-4">
          OpenClaw Monitor
        </span>
        <NavLink href="#/" active={route === "dashboard"}>
          Dashboard
        </NavLink>
        <NavLink href="#/timeline" active={route === "timeline"}>
          Timeline
        </NavLink>
        <NavLink href="#/log" active={route === "log"}>
          Log
        </NavLink>
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <span
            className={`inline-block w-2 h-2 rounded-full ${
              monitor.connected ? "bg-green-500" : "bg-red-500"
            }`}
          />
          {monitor.connected ? "Connected" : "Disconnected"}
        </div>
      </nav>

      <main className="flex-1 overflow-hidden">
        {route === "dashboard" && (
          <Dashboard
            agents={monitor.agents}
            events={monitor.events}
            interactions={monitor.interactions}
          />
        )}
        {route === "timeline" && <TimelinePage agents={monitor.agents} />}
        {route === "log" && <LogPage />}
      </main>
    </div>
  );
}
