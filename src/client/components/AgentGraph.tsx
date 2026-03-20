import { useRef, useEffect } from "react";
import cytoscape, { type Core, type ElementDefinition } from "cytoscape";
import type { AgentStatus, Interaction } from "@shared/types";

interface Props {
  agents: AgentStatus[];
  interactions: Interaction[];
  onSelectAgent: (id: string) => void;
}

function buildElements(
  agents: AgentStatus[],
  interactions: Interaction[],
): ElementDefinition[] {
  const nodes: ElementDefinition[] = agents.map((a) => ({
    data: {
      id: a.agentId,
      label: a.name || a.agentId,
      status: a.status,
    },
  }));

  const edges: ElementDefinition[] = interactions.map((i) => ({
    data: {
      id: `${i.fromAgent}->${i.toAgent}`,
      source: i.fromAgent,
      target: i.toAgent,
      count: i.count,
      width: Math.min(Math.max(i.count, 1), 5),
    },
  }));

  return [...nodes, ...edges];
}

const STYLE: cytoscape.Stylesheet[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      "text-valign": "bottom",
      "text-margin-y": 8,
      color: "#d1d5db",
      "font-size": "11px",
      "background-color": "#6b7280",
      width: 36,
      height: 36,
      "border-width": 2,
      "border-color": "#374151",
    },
  },
  {
    selector: "node[status = 'active']",
    style: {
      "background-color": "#22c55e",
      "border-color": "#16a34a",
    },
  },
  {
    selector: "edge",
    style: {
      width: "data(width)",
      label: "data(count)",
      "font-size": "9px",
      color: "#9ca3af",
      "text-background-opacity": 1,
      "text-background-color": "#030712",
      "text-background-padding": "2px",
      "line-color": "#4b5563",
      "target-arrow-color": "#4b5563",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
    },
  },
  {
    selector: "node:selected",
    style: {
      "border-color": "#3b82f6",
      "border-width": 3,
    },
  },
];

export function AgentGraph({ agents, interactions, onSelectAgent }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const cy = cytoscape({
      container: containerRef.current,
      elements: buildElements(agents, interactions),
      style: STYLE,
      layout: { name: "cose", animate: false } as cytoscape.LayoutOptions,
      userZoomingEnabled: true,
      userPanningEnabled: true,
    });

    cy.on("tap", "node", (evt) => {
      const nodeId = evt.target.id() as string;
      onSelectAgent(nodeId);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
    // Only run on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;

    const existingNodeIds = new Set(cy.nodes().map((n) => n.id()));
    const newNodeIds = new Set(agents.map((a) => a.agentId));

    for (const a of agents) {
      if (existingNodeIds.has(a.agentId)) {
        const node = cy.getElementById(a.agentId);
        node.data("label", a.name || a.agentId);
        node.data("status", a.status);
      } else {
        cy.add({
          data: {
            id: a.agentId,
            label: a.name || a.agentId,
            status: a.status,
          },
        });
      }
    }

    for (const id of existingNodeIds) {
      if (!newNodeIds.has(id)) {
        cy.getElementById(id).remove();
      }
    }

    const existingEdgeIds = new Set(cy.edges().map((e) => e.id()));
    const newEdgeIds = new Set(
      interactions.map((i) => `${i.fromAgent}->${i.toAgent}`),
    );

    for (const i of interactions) {
      const edgeId = `${i.fromAgent}->${i.toAgent}`;
      if (existingEdgeIds.has(edgeId)) {
        const edge = cy.getElementById(edgeId);
        edge.data("count", i.count);
        edge.data("width", Math.min(Math.max(i.count, 1), 5));
      } else {
        cy.add({
          data: {
            id: edgeId,
            source: i.fromAgent,
            target: i.toAgent,
            count: i.count,
            width: Math.min(Math.max(i.count, 1), 5),
          },
        });
      }
    }

    for (const id of existingEdgeIds) {
      if (!newEdgeIds.has(id)) {
        cy.getElementById(id).remove();
      }
    }

    if (agents.length > 0 && agents.length !== existingNodeIds.size) {
      cy.layout({ name: "cose", animate: true } as cytoscape.LayoutOptions).run();
    }
  }, [agents, interactions]);

  return (
    <div
      ref={containerRef}
      className="w-full h-full"
      style={{ backgroundColor: "#030712" }}
    />
  );
}
