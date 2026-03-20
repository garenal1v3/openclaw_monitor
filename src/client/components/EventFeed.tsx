import { useEffect, useRef } from "react";
import type { MonitorEvent } from "@shared/types";

interface Props {
  events: MonitorEvent[];
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", {
    hour12: false,
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function eventColor(eventType: MonitorEvent["eventType"]): string {
  switch (eventType) {
    case "message_received":
    case "message_sent":
      return "text-blue-400";
    case "tool_call":
    case "tool_result":
      return "text-orange-400";
    case "reasoning":
      return "text-purple-400";
    case "command":
    case "lifecycle":
    default:
      return "text-gray-400";
  }
}

function truncate(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

function eventSummary(ev: MonitorEvent): string {
  const agent = ev.agentId || "?";
  const to = ev.toAgent ? ` -> ${ev.toAgent}` : "";
  const content = ev.content || ev.toolName || ev.eventType;
  return `${agent}${to}: ${truncate(content, 80)}`;
}

export function EventFeed({ events }: Props) {
  const topRef = useRef<HTMLDivElement>(null);
  const prevCountRef = useRef(0);

  useEffect(() => {
    if (events.length > prevCountRef.current) {
      topRef.current?.scrollIntoView({ behavior: "smooth" });
    }
    prevCountRef.current = events.length;
  }, [events.length]);

  const displayed = events.slice(0, 100);

  return (
    <div className="h-full overflow-y-auto p-2">
      <h2 className="text-sm font-semibold text-gray-300 mb-2 px-1">
        Event Feed
      </h2>
      <div ref={topRef} />
      <div className="space-y-0.5">
        {displayed.map((ev) => (
          <div
            key={ev.id}
            className={`text-xs font-mono px-1 py-0.5 rounded hover:bg-gray-800/50 ${eventColor(ev.eventType)}`}
          >
            <span className="text-gray-500">[{formatTime(ev.timestamp)}]</span>{" "}
            {eventSummary(ev)}
          </div>
        ))}
        {displayed.length === 0 && (
          <div className="text-xs text-gray-500 px-1">No events yet</div>
        )}
      </div>
    </div>
  );
}
