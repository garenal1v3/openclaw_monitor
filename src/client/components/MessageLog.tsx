import { useState } from "react";
import type { MonitorEvent } from "@shared/types";

interface Props {
  events: MonitorEvent[];
  onLoadMore: () => void;
  hasMore: boolean;
  loading: boolean;
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    month: "short",
    day: "numeric",
  });
}

function truncate(s: string | null, max: number): string {
  if (!s) return "-";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

function typeColor(eventType: MonitorEvent["eventType"]): string {
  switch (eventType) {
    case "message_received":
    case "message_sent":
      return "text-blue-400";
    case "tool_call":
    case "tool_result":
      return "text-orange-400";
    case "reasoning":
      return "text-purple-400";
    default:
      return "text-gray-400";
  }
}

function EventRow({ event }: { event: MonitorEvent }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <tr
        className="hover:bg-gray-800/50 cursor-pointer border-b border-gray-800/50"
        onClick={() => setExpanded(!expanded)}
      >
        <td className="px-2 py-1.5 text-xs text-gray-500 whitespace-nowrap">
          {formatTimestamp(event.timestamp)}
        </td>
        <td className="px-2 py-1.5 text-xs text-gray-300 whitespace-nowrap">
          {event.agentId || "-"}
        </td>
        <td
          className={`px-2 py-1.5 text-xs whitespace-nowrap ${typeColor(event.eventType)}`}
        >
          {event.eventType}
        </td>
        <td className="px-2 py-1.5 text-xs text-gray-300 font-mono truncate max-w-md">
          {truncate(event.content || event.toolName || "", 100)}
        </td>
      </tr>
      {expanded && (
        <tr className="bg-gray-900">
          <td colSpan={4} className="px-4 py-3">
            <div className="space-y-2">
              {event.content && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">
                    Content
                  </span>
                  <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-words bg-gray-950 p-2 rounded">
                    {event.content}
                  </pre>
                </div>
              )}
              {event.toolName && (
                <div className="text-xs text-gray-400">
                  Tool: <span className="text-gray-200">{event.toolName}</span>
                  {event.toolCallId && (
                    <span className="ml-2 text-gray-500">
                      (id: {event.toolCallId})
                    </span>
                  )}
                </div>
              )}
              {event.toolInput && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">
                    Tool Input
                  </span>
                  <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap break-words bg-gray-950 p-2 rounded">
                    {formatJson(event.toolInput)}
                  </pre>
                </div>
              )}
              {event.toolOutput && (
                <div>
                  <span className="text-xs text-gray-500 block mb-1">
                    Tool Output
                  </span>
                  <pre className="text-xs font-mono text-gray-400 whitespace-pre-wrap break-words bg-gray-950 p-2 rounded">
                    {formatJson(event.toolOutput)}
                  </pre>
                </div>
              )}
              {event.fromAgent && (
                <div className="text-xs text-gray-400">
                  From: {event.fromAgent}
                  {event.toAgent && <span> -&gt; {event.toAgent}</span>}
                </div>
              )}
              {event.model && (
                <div className="text-xs text-gray-400">
                  Model: {event.model}
                </div>
              )}
              {(event.inputTokens !== null || event.outputTokens !== null) && (
                <div className="text-xs text-gray-400">
                  Tokens: {event.inputTokens ?? 0} in / {event.outputTokens ?? 0}{" "}
                  out
                </div>
              )}
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

export function MessageLog({ events, onLoadMore, hasMore, loading }: Props) {
  return (
    <div>
      <table className="w-full">
        <thead>
          <tr className="border-b border-gray-700 text-left">
            <th className="px-2 py-1.5 text-xs font-medium text-gray-400 w-36">
              Time
            </th>
            <th className="px-2 py-1.5 text-xs font-medium text-gray-400 w-32">
              Agent
            </th>
            <th className="px-2 py-1.5 text-xs font-medium text-gray-400 w-32">
              Type
            </th>
            <th className="px-2 py-1.5 text-xs font-medium text-gray-400">
              Content
            </th>
          </tr>
        </thead>
        <tbody>
          {events.map((ev) => (
            <EventRow key={ev.id} event={ev} />
          ))}
        </tbody>
      </table>

      {events.length === 0 && !loading && (
        <div className="text-center text-xs text-gray-500 py-8">
          No events found
        </div>
      )}

      <div className="text-center py-3">
        {loading && (
          <span className="text-xs text-gray-400">Loading...</span>
        )}
        {!loading && hasMore && (
          <button
            onClick={onLoadMore}
            className="text-xs text-blue-400 hover:text-blue-300 px-3 py-1 border border-gray-700 rounded hover:border-gray-600"
          >
            Load more
          </button>
        )}
      </div>
    </div>
  );
}
