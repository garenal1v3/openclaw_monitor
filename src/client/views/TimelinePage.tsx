import { useEffect, useState } from "react";
import type { AgentStatus, MonitorEvent } from "@shared/types";
import { Timeline } from "../components/Timeline";

interface Props {
  agents: AgentStatus[];
}

export function TimelinePage({ agents }: Props) {
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch("/api/events?limit=500");
        if (res.ok) {
          const data = (await res.json()) as MonitorEvent[];
          setEvents(data);
        }
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400 text-sm">
        Loading timeline...
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col">
      <Timeline events={events} agents={agents} />
    </div>
  );
}
