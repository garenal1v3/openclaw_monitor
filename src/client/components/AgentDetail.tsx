import type { AgentStatus, MonitorEvent } from "@shared/types";

interface Props {
  agentId: string;
  agents: AgentStatus[];
  events: MonitorEvent[];
  onClose: () => void;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function truncate(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function TokenBar({ total, context }: { total: number; context: number }) {
  if (context === 0) {
    return <span className="text-xs text-gray-500">No context data</span>;
  }
  const pct = Math.min((total / context) * 100, 100);
  const barColor =
    pct >= 80 ? "bg-red-500" : pct >= 60 ? "bg-yellow-500" : "bg-green-500";

  return (
    <div>
      <div className="flex justify-between text-xs text-gray-400 mb-1">
        <span>
          {total.toLocaleString()} / {context.toLocaleString()} tokens
        </span>
        <span>{pct.toFixed(0)}%</span>
      </div>
      <div className="w-full h-2 bg-gray-700 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full ${barColor}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function AgentDetail({ agentId, agents, events, onClose }: Props) {
  const agent = agents.find((a) => a.agentId === agentId);
  const agentEvents = events
    .filter((e) => e.agentId === agentId)
    .slice(0, 20);

  return (
    <div className="fixed top-0 right-0 h-full w-96 bg-gray-900 border-l border-gray-800 shadow-2xl z-50 flex flex-col overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
        <h2 className="text-sm font-semibold truncate">
          {agent?.name || agentId}
        </h2>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-white text-lg leading-none"
        >
          x
        </button>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto flex-1">
        {agent ? (
          <>
            <div className="space-y-2">
              <div className="flex items-center gap-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${
                    agent.status === "active" ? "bg-green-500" : "bg-gray-500"
                  }`}
                />
                <span className="text-xs text-gray-300 capitalize">
                  {agent.status}
                </span>
              </div>
              {agent.model && (
                <div className="text-xs text-gray-400">
                  Model: <span className="text-gray-200">{agent.model}</span>
                </div>
              )}
              <div className="text-xs text-gray-400">
                Sessions:{" "}
                <span className="text-gray-200">{agent.sessionCount}</span>
              </div>
            </div>

            <div>
              <h3 className="text-xs font-medium text-gray-400 mb-2">
                Token Usage
              </h3>
              <TokenBar
                total={agent.totalTokens}
                context={agent.contextTokens}
              />
            </div>
          </>
        ) : (
          <div className="text-xs text-gray-500">Agent not found</div>
        )}

        <div>
          <h3 className="text-xs font-medium text-gray-400 mb-2">
            Recent Events ({agentEvents.length})
          </h3>
          <div className="space-y-1">
            {agentEvents.map((ev) => (
              <div
                key={ev.id}
                className="text-xs font-mono text-gray-300 py-0.5"
              >
                <span className="text-gray-500">
                  [{formatTime(ev.timestamp)}]
                </span>{" "}
                <span className="text-gray-400">{ev.eventType}</span>{" "}
                {truncate(ev.content || ev.toolName || "", 50)}
              </div>
            ))}
            {agentEvents.length === 0 && (
              <div className="text-xs text-gray-500">No events</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
