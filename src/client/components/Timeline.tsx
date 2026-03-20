import { useRef, useEffect, useState } from "react";
import { DataSet } from "vis-data";
import { Timeline as VisTimeline } from "vis-timeline/standalone";
import "vis-timeline/styles/vis-timeline-graph2d.min.css";
import type { AgentStatus, MonitorEvent } from "@shared/types";

interface Props {
  events: MonitorEvent[];
  agents: AgentStatus[];
}

function eventClassName(eventType: MonitorEvent["eventType"]): string {
  switch (eventType) {
    case "message_received":
    case "message_sent":
      return "tl-blue";
    case "tool_call":
    case "tool_result":
      return "tl-orange";
    case "reasoning":
      return "tl-purple";
    default:
      return "tl-gray";
  }
}

function truncate(s: string | null, max: number): string {
  if (!s) return "";
  return s.length > max ? s.slice(0, max) + "..." : s;
}

export function Timeline({ events, agents }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const timelineRef = useRef<VisTimeline | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<MonitorEvent | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const agentIds = new Set<string>();
    for (const a of agents) agentIds.add(a.agentId);
    for (const e of events) {
      if (e.agentId) agentIds.add(e.agentId);
    }

    const groups = new DataSet(
      Array.from(agentIds).map((id) => ({
        id,
        content: agents.find((a) => a.agentId === id)?.name || id,
        style: "color: #d1d5db; font-size: 12px;",
      })),
    );

    const items = new DataSet(
      events
        .filter((e) => e.agentId)
        .map((e) => ({
          id: e.id,
          group: e.agentId!,
          start: new Date(e.timestamp),
          content: truncate(e.content || e.toolName || e.eventType, 30),
          className: eventClassName(e.eventType),
          title: `${e.eventType}: ${truncate(e.content || "", 100)}`,
        })),
    );

    const timeline = new VisTimeline(containerRef.current, items, groups, {
      stack: false,
      orientation: { axis: "top" },
      zoomMin: 1000 * 10,
      zoomMax: 1000 * 60 * 60 * 2,
      margin: { item: 4 },
      template: (item: { content: string } | undefined) => {
        if (!item) return "";
        return `<span class="text-xs font-mono">${item.content}</span>`;
      },
    });

    timeline.on("select", (properties: { items: string[] }) => {
      const selectedId = properties.items[0];
      if (selectedId) {
        const ev = events.find((e) => e.id === selectedId) || null;
        setSelectedEvent(ev);
      } else {
        setSelectedEvent(null);
      }
    });

    timelineRef.current = timeline;

    return () => {
      timeline.destroy();
      timelineRef.current = null;
    };
  }, [events, agents]);

  return (
    <div className="flex flex-col h-full">
      <style>{`
        .tl-blue { background-color: #1e40af; border-color: #3b82f6; color: #bfdbfe; }
        .tl-orange { background-color: #92400e; border-color: #f59e0b; color: #fde68a; }
        .tl-purple { background-color: #581c87; border-color: #a855f7; color: #e9d5ff; }
        .tl-gray { background-color: #374151; border-color: #6b7280; color: #d1d5db; }
        .vis-timeline { border: none !important; background: #030712 !important; }
        .vis-panel.vis-background { background: #030712 !important; }
        .vis-panel.vis-center { background: #030712 !important; }
        .vis-panel.vis-left { background: #111827 !important; }
        .vis-labelset .vis-label { border-bottom-color: #1f2937 !important; }
        .vis-foreground .vis-group { border-bottom-color: #1f2937 !important; }
        .vis-time-axis .vis-text { color: #9ca3af !important; fill: #9ca3af !important; }
        .vis-time-axis .vis-grid { border-color: #1f2937 !important; }
        .vis-item { border-radius: 3px !important; font-size: 11px !important; }
        .vis-item.vis-selected { border-color: #3b82f6 !important; box-shadow: 0 0 6px #3b82f680 !important; }
      `}</style>
      <div ref={containerRef} className="flex-1 min-h-[300px]" />
      {selectedEvent && (
        <div className="border-t border-gray-800 bg-gray-900 p-3 max-h-48 overflow-y-auto">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-semibold text-gray-300">
              {selectedEvent.eventType} — {selectedEvent.agentId}
            </span>
            <button
              onClick={() => setSelectedEvent(null)}
              className="text-xs text-gray-500 hover:text-white"
            >
              x
            </button>
          </div>
          {selectedEvent.content && (
            <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-words">
              {selectedEvent.content}
            </pre>
          )}
          {selectedEvent.toolName && (
            <div className="text-xs text-gray-400 mt-1">
              Tool: {selectedEvent.toolName}
            </div>
          )}
          {selectedEvent.toolInput && (
            <pre className="text-xs font-mono text-gray-400 mt-1 whitespace-pre-wrap">
              {formatJson(selectedEvent.toolInput)}
            </pre>
          )}
          {selectedEvent.toolOutput && (
            <pre className="text-xs font-mono text-gray-400 mt-1 whitespace-pre-wrap">
              {formatJson(selectedEvent.toolOutput)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function formatJson(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}
