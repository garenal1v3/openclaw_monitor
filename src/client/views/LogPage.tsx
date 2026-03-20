import { useState, useEffect, useCallback } from "react";
import type { MonitorEvent } from "@shared/types";
import { MessageLog } from "../components/MessageLog";

const PAGE_SIZE = 100;

export function LogPage() {
  const [events, setEvents] = useState<MonitorEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(true);
  const [agentFilter, setAgentFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [search, setSearch] = useState("");

  const fetchEvents = useCallback(
    async (append: boolean) => {
      setLoading(true);
      try {
        const params = new URLSearchParams();
        params.set("limit", String(PAGE_SIZE));
        if (agentFilter) params.set("agent", agentFilter);
        if (typeFilter) params.set("type", typeFilter);
        if (append && events.length > 0) {
          const oldest = events[events.length - 1];
          params.set("since", String(oldest.timestamp));
        }

        const res = await fetch(`/api/events?${params}`);
        if (res.ok) {
          const data = (await res.json()) as MonitorEvent[];
          if (append) {
            setEvents((prev) => [...prev, ...data]);
          } else {
            setEvents(data);
          }
          setHasMore(data.length >= PAGE_SIZE);
        }
      } catch {
        // silently ignore
      } finally {
        setLoading(false);
      }
    },
    [agentFilter, typeFilter, events],
  );

  useEffect(() => {
    fetchEvents(false);
    // Only re-fetch from scratch when filters change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agentFilter, typeFilter]);

  const filteredEvents = search
    ? events.filter(
        (e) =>
          e.content?.toLowerCase().includes(search.toLowerCase()) ||
          e.toolName?.toLowerCase().includes(search.toLowerCase()) ||
          e.agentId?.toLowerCase().includes(search.toLowerCase()),
      )
    : events;

  return (
    <div className="h-full flex flex-col p-4 gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <input
          type="text"
          placeholder="Agent ID..."
          value={agentFilter}
          onChange={(e) => setAgentFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 w-36 focus:outline-none focus:border-gray-500"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 focus:outline-none focus:border-gray-500"
        >
          <option value="">All types</option>
          <option value="message_received">message_received</option>
          <option value="message_sent">message_sent</option>
          <option value="tool_call">tool_call</option>
          <option value="tool_result">tool_result</option>
          <option value="reasoning">reasoning</option>
          <option value="command">command</option>
          <option value="lifecycle">lifecycle</option>
        </select>
        <input
          type="text"
          placeholder="Search content..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-2 py-1 text-xs text-gray-200 flex-1 min-w-[200px] focus:outline-none focus:border-gray-500"
        />
      </div>

      <div className="flex-1 overflow-y-auto">
        <MessageLog
          events={filteredEvents}
          onLoadMore={() => fetchEvents(true)}
          hasMore={hasMore}
          loading={loading}
        />
      </div>
    </div>
  );
}
