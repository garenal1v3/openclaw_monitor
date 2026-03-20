import { useState } from "react";
import type { AgentStatus, MonitorEvent, Interaction } from "@shared/types";
import { AgentGraph } from "../components/AgentGraph";
import { EventFeed } from "../components/EventFeed";
import { AgentDetail } from "../components/AgentDetail";

interface Props {
  agents: AgentStatus[];
  events: MonitorEvent[];
  interactions: Interaction[];
}

export function Dashboard({ agents, events, interactions }: Props) {
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  return (
    <div className="flex h-full relative">
      <div className="flex-[7] min-w-0">
        <AgentGraph
          agents={agents}
          interactions={interactions}
          onSelectAgent={setSelectedAgent}
        />
      </div>
      <div className="flex-[3] min-w-0 border-l border-gray-800">
        <EventFeed events={events} />
      </div>
      {selectedAgent && (
        <AgentDetail
          agentId={selectedAgent}
          agents={agents}
          events={events}
          onClose={() => setSelectedAgent(null)}
        />
      )}
    </div>
  );
}
